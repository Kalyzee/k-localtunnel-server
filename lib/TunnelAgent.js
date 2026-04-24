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

        // all connected tunnel sockets (source of truth)
        this.allSockets = new Set();
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

    static _parseHandshake(chunk, callback) {
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

    static getClientIdFromHandshake(chunk) {
        const credentials = TunnelAgent._parseHandshake(chunk);
        return credentials?.clientId;
    }

    static detroyAfterDelay(socket, delay = 1000) {
        return setTimeout(() => {
            try {
                socket?.destroy();
            } catch (err) { }
        }, delay);
    }

    getConnectedSockets() {
        let count = 0;
        for (const socket of this.allSockets) {
            if (!socket.destroyed) count++;
        }
        return count;
    }

    stats() {
        return {
            connectedSockets: this.getConnectedSockets(),
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
                this.debug('Timeout handshake');
                socket.removeAllListeners();
                TunnelAgent.detroyAfterDelay(socket);
            }, 200);
            socket.once('data', (chunk) => {
                if (!this.authorizeNewSocketConnection()) {
                    TunnelAgent.detroyAfterDelay(socket);
                    return;
                }
                this.verifyHandshake(chunk, (success, msg) => {
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

        return new Promise((resolve, reject) => {
            let settled = false;
            const listener = () => {
                if (settled) return;
                settled = true;
                const port = server.address().port;
                this.debug('tcp server listening on port: %d', port);
                resolve({
                    // port for lt client tcp connections
                    port: port,
                });
            };
            const onBindError = (err) => {
                if (settled) return;
                settled = true;
                this.started = false;
                reject(err);
            };
            server.once('error', onBindError);
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


    verifyHandshake(chunk, callback) {
        const credentials = TunnelAgent._parseHandshake(chunk);
        if (!credentials) {
            callback?.(false, 'Error parsing handshake or no handshake data found');
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
        callback?.(true, 'Handshake valid, connection accepted');
        return true;
    }

    authorizeNewSocketConnection() {
        if (this.getConnectedSockets() >= this.maxTcpSockets) {
            this.debug('no more sockets allowed');
            return false;
        }
        return true;
    }

    // new socket connection from client for tunneling requests to client
    onConnection(socket) {
        if (socket.destroyed) return;

        const wasPreviouslyEmpty = this.getConnectedSockets() === 0;

        this.allSockets.add(socket);

        socket.once('close', (hadError) => {
            this.debug('closed socket (error: %s)', hadError);
            this.allSockets.delete(socket);
            const idx = this.availableSockets.indexOf(socket);
            if (idx >= 0) {
                this.availableSockets.splice(idx, 1);
            }

            const connected = this.getConnectedSockets();
            this.debug('connected sockets: %s', connected);
            if (connected === 0) {
                this.debug('all sockets disconnected');
                this.emit('offline');
            }
        });

        socket.once('error', (err) => {
            socket.destroy();
        });

        if (wasPreviouslyEmpty) {
            this.emit('online');
        }

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
            /*this.waitingCreateConn.push(cb);
            this.debug('waiting connected: %s', this.getConnectedSockets());
            this.debug('waiting available: %s', this.availableSockets.length);*/
            cb(new Error('none socket availabled'));
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
