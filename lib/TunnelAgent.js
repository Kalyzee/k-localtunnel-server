import log from 'book';
import Debug from 'debug';
import { Agent } from 'http';
import net from 'net';

const DEFAULT_MAX_SOCKETS = 10;

// Implements an http.Agent interface to a pool of tunnel sockets
// A tunnel socket is a connection _from_ a client that will
// service http requests. This agent is usable wherever one can use an http.Agent
class TunnelAgent extends Agent {
    constructor(options = {}) {
        super({
            keepAlive: true,
            // only allow keepalive to hold on to one socket
            // this prevents it from holding on to all the sockets so they can be used for upgrades
            maxFreeSockets: 1,
        });

        // sockets we can hand out via createConnection
        this.availableSockets = [];

        // when a createConnection cannot return a socket, it goes into a queue
        // once a socket is available it is handed out to the next callback
        this.waitingCreateConn = [];

        this.debug = Debug(`lt:TunnelAgent[${options.clientId}]`);

        // track maximum allowed sockets
        this.connectedSockets = 0;
        this.maxTcpSockets = options.maxTcpSockets || DEFAULT_MAX_SOCKETS;

        // Security
        this.clientId = options.clientId;
        this.token = options.token;

        if (!this.options.server) {
            // new tcp server to service requests for this client
            this.server = net.createServer();
        }


        // flag to avoid double starts
        this.started = false;
        this.closed = false;
    }

    static _parseCredentialsChunk(chunk, callback) {
        const data = chunk.toString();
        let result = undefined;
        let error = undefined;
        let success = false;
        try {
            const json = JSON.parse(data);
            if (json.clientId && json.token) {
                result = { clientId: json.clientId, token: json.token };
                success = true;
            }
        } catch (err) {
            error = err;
            result = undefined;
        }
        callback?.(success, error);
        return result;
    }

    static getClientIdFromCredentialsChunk(chunk) {
        const credentials = TunnelAgent._parseCredentialsChunk(chunk);
        return credentials?.clientId;
    }

    static detroyAfterDelay(socket, delay = 1000) {
        return setTimeout(() => {
            try {
                socket?.destroy();
            } catch (err) { }
        }, delay);
    }

    stats() {
        return {
            connectedSockets: this.connectedSockets,
        };
    }

    listen(port) {
        if (!this.server) throw new Error('Server undefined');
        const server = this.server;
        if (this.started) {
            throw new Error('already started');
        }
        this.started = true;

        server.on('close', this._onClose.bind(this));
        server.on('connection', (socket) => {
            this.onConnection(socket);
            const timeout = setTimeout(() => {
                this.debug('Timeout credentials');
                socket.removeAllListeners();
                TunnelAgent.detroyAfterDelay(socket);
            }, 200);
            socket.once('data', (chunk) => {
                if (!this.authorizeNewSocketConnection()) {
                    TunnelAgent.detroyAfterDelay(socket);
                    return;
                }
                this.verifyCredentialsChunk(chunk, (success, msg) => {
                    this.debug(msg);
                    if (!success) TunnelAgent.detroyAfterDelay(socket);
                    clearTimeout(timeout);
                });
            });
        });
        server.on('error', (err) => {
            // These errors happen from killed connections, we don't worry about them
            if (err.code == 'ECONNRESET' || err.code == 'ETIMEDOUT') {
                return;
            }
            log.error(err);
        });

        return new Promise((resolve) => {
            const listener = () => {
                const port = server.address().port;
                this.debug('tcp server listening on port: %d', port);

                resolve({
                    // port for lt client tcp connections
                    port: port,
                });
            }
            if (port) server.listen(port, listener);
            else server.listen(listener);
        });
    }

    _onClose() {
        this.closed = true;
        this.debug('closed tcp socket');
        // flush any waiting connections
        for (const conn of this.waitingCreateConn) {
            conn(new Error('closed'), null);
        }
        this.waitingCreateConn = [];
        this.emit('end');
    }


    verifyCredentialsChunk(chunk, callback) {
        const credentials = TunnelAgent._parseCredentialsChunk(chunk);
        if (!credentials) {
            callback?.(false, 'Error parse credentials or no credentials found');
            return false;
        }
        if (credentials.clientId !== this.clientId) {
            callback?.(false, `Wrong client Id, close socket`);
            return false;
        }
        if (credentials.token !== this.token) {
            callback?.(false, `Invalid token, close socket`);
            return false;
        }
        callback?.(true, 'Credentials are valide, TCP connexion  accepted');
        return true;
    }

    authorizeNewSocketConnection() {
        // no more socket connections allowed
        if (this.connectedSockets >= this.maxTcpSockets) {
            this.debug('no more sockets allowed');
            return false;
        }
        return true;
    }

    // new socket connection from client for tunneling requests to client
    onConnection(socket) {
        if (socket.destroyed) return;
        socket.once('close', (hadError) => {
            this.debug('closed socket (error: %s)', hadError);
            this.connectedSockets -= 1;
            // remove the socket from available list
            const idx = this.availableSockets.indexOf(socket);
            if (idx >= 0) {
                this.availableSockets.splice(idx, 1);
            }

            this.debug('connected sockets: %s', this.connectedSockets);
            if (this.connectedSockets <= 0) {
                this.debug('all sockets disconnected');
                this.emit('offline');
            }
        });

        // close will be emitted after this
        socket.once('error', (err) => {
            // we do not log these errors, sessions can drop from clients for many reasons
            // these are not actionable errors for our server
            socket.destroy();
        });

        if (this.connectedSockets === 0) {
            this.emit('online');
        }

        this.connectedSockets += 1;
        this.debug('new connection from: %s:%s', socket.address().address, socket.address().port);

        // if there are queued callbacks, give this socket now and don't queue into available
        const fn = this.waitingCreateConn.shift();
        if (fn) {
            this.debug('giving socket to queued conn request');
            setTimeout(() => {
                fn(null, socket);
            }, 0);
            return;
        }

        // make socket available for those waiting on sockets
        this.availableSockets.push(socket);
    }

    // fetch a socket from the available socket pool for the agent
    // if no socket is available, queue
    // cb(err, socket)
    createConnection(options, cb) {
        if (this.closed) {
            cb(new Error('closed'));
            return;
        }

        this.debug('create connection');

        // socket is a tcp connection back to the user hosting the site
        const sock = this.availableSockets.shift();

        // no available sockets
        // wait until we have one
        if (!sock) {
            this.waitingCreateConn.push(cb);
            this.debug('waiting connected: %s', this.connectedSockets);
            this.debug('waiting available: %s', this.availableSockets.length);
            return;
        }

        this.debug('socket given');
        cb(null, sock);
    }

    destroy() {
        this.server?.close();
        super.destroy();
    }
}

export default TunnelAgent;
