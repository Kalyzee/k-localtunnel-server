import Debug from 'debug';

import net from 'net';
import Client from './Client.js';
import TunnelAgent from './TunnelAgent.js';

// Manage sets of clients
//
// A client is a "user session" established to service a remote localtunnel client
class ClientManager {
    constructor(opt) {
        this.opt = opt || {};

        // id -> client instance
        this.clients = {};

        // statistics
        this.stats = {
            tunnels: 0
        };

        this.debug = Debug('lt:ClientManager');

        // This is totally wrong :facepalm: this needs to be per-client...
        this.graceTimeout = null;

        if (this.opt.uniquePortTcpServer) {
            this.initServer();
        }
    }

    initServer() {
        this.port = this.opt.uniquePortTcpServer;
        // new tcp server to service requests for this client
        this.server = net.createServer();
    }

    listen(port) {
        if (!this.server) throw new Error('Server undefined');
        const server = this.server;
        if (this.serverListening) {
            throw new Error('already started');
        }

        server.on('close', () => {
            this.debug('Server closed');
            this.close();
            this.initServer();
        });
        server.on('connection', (socket) => {
            let timeout;
            const destroy = () => {
                socket.removeAllListeners();
                TunnelAgent.detroyAfterDelay(socket);
                clearTimeout(timeout);
            };
            timeout = setTimeout(() => {
                this.debug('Timeout credentials');
                destroy();
            }, 200);
            socket.once('data', chunk => {
                const clientId = TunnelAgent.getClientIdFromCredentialsChunk(chunk);
                if (!clientId) {
                    this.debug("Client no found");
                    destroy();
                    return;
                }
                const client = this.clients[clientId];
                if (!client) {
                    this.debug("Client not found: %s (known clients: %s)", clientId, Object.keys(this.clients).join(', ') || 'none');
                    destroy();
                    return;
                }
                const agent = client.agent;
                if (!agent.authorizeNewSocketConnection()) {
                    TunnelAgent.detroyAfterDelay(socket);
                    return;
                }
                agent.verifyCredentialsChunk(chunk, (success, msg) => {
                    this.debug('Client : ' + msg);
                    if (!success) destroy();
                    else agent.onConnection(socket);
                    clearTimeout(timeout);
                });
            });
        });
        server.on('error', (err) => {
            // These errors happen from killed connections, we don't worry about them
            if (err.code == 'ECONNRESET' || err.code == 'ETIMEDOUT') {
                return;
            }
            this.debug(`Error serveur : `, err);
        });

        this.serverListening = new Promise((resolve) => {
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
        return this.serverListening;
    }

    // create a new tunnel with `id`
    // if the id is already used, a random id is assigned
    // if the tunnel could not be created, throws an error
    async newClient(id, token) {
        const clients = this.clients;
        const stats = this.stats;

        // can't ask for id already is use
        if (clients[id]) {
            throw new Error("Client id is already used");
        }

        const maxSockets = this.opt.max_tcp_sockets;
        const agent = new TunnelAgent({
            clientId: id,
            maxSockets: 10,
            token,
            server: this.server
        });

        const client = new Client({
            id,
            agent,
        });

        // add to clients map immediately
        // avoiding races with other clients requesting same id
        clients[id] = client;

        client.once('close', () => {
            this.removeClient(id);
        });

        // try/catch used here to remove client id
        try {
            let port = this.port;
            if (this.server) {
                const promise = this.serverListening ?? this.listen(port);
                await promise;
            } else {
                const info = await agent.listen();
                port = info.port;
            }
            ++stats.tunnels;
            return {
                id: id,
                port: port,
                max_conn_count: maxSockets,
                token,
            };
        }
        catch (err) {
            this.removeClient(id);
            // rethrow error for upstream to handle
            throw err;
        }
    }

    removeClient(id) {
        this.debug('removing client: %s', id);
        const client = this.clients[id];
        if (!client) {
            return;
        }
        --this.stats.tunnels;
        delete this.clients[id];
        client.close();
    }

    hasClient(id) {
        return !!this.clients[id];
    }

    getClient(id) {
        return this.clients[id];
    }

    close() {
        const clientIds = Object.keys(this.clients);
        clientIds.forEach((id) => this.removeClient(id));
        this.server?.close();
        this.serverListening = undefined;
        this.server = undefined;
        this.port = undefined;
    }
}

export default ClientManager;
