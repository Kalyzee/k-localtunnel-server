import Debug from 'debug';

import net from 'net';
import Client from './Client.js';
import TunnelAgent from './TunnelAgent.js';
import TcpTunnelAgent from './TcpTunnelAgent.js';
import UdpTunnelAgent from './UdpTunnelAgent.js';

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
                this.debug('Timeout handshake');
                destroy();
            }, 200);
            socket.once('data', chunk => {
                const clientId = TunnelAgent.getClientIdFromHandshake(chunk);
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
                agent.verifyHandshake(chunk, (success, msg) => {
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
    // type: 'http' (default) or 'tcp'
    // requestedPublicPort: optional port for TCP tunnels
    _getMaxSockets(type, requestedMaxConn) {
        // Server-side limit per type (fallback to global max_sockets)
        const globalMax = this.opt.max_sockets || 10;
        let serverMax;
        if (type === 'http') serverMax = this.opt.max_http_sockets ?? globalMax;
        else if (type === 'tcp') serverMax = this.opt.max_tcp_sockets ?? globalMax;
        else if (type === 'udp') serverMax = this.opt.max_udp_sockets ?? globalMax;
        else serverMax = globalMax;

        // Client can request fewer sockets, never more
        if (requestedMaxConn && requestedMaxConn > 0) {
            return Math.min(requestedMaxConn, serverMax);
        }
        return serverMax;
    }

    async newClient(id, token, type = 'http', requestedPublicPort, target, requestedMaxConn) {
        const clients = this.clients;
        const stats = this.stats;

        if (clients[id]) {
            throw new Error("Client id is already used");
        }

        const maxSockets = this._getMaxSockets(type, requestedMaxConn);

        if (type === 'tcp') {
            return this._newTcpClient(id, token, maxSockets, requestedPublicPort, target);
        }

        if (type === 'udp') {
            return this._newUdpClient(id, token, maxSockets, requestedPublicPort, target);
        }

        return this._newHttpClient(id, token, maxSockets, target);
    }

    async _newHttpClient(id, token, maxSockets, target) {
        const clients = this.clients;
        const stats = this.stats;

        const agent = new TunnelAgent({
            clientId: id,
            maxSockets: 10,
            token,
            server: this.server
        });

        const client = new Client({
            id,
            agent,
            type: 'http',
            target,
        });

        clients[id] = client;

        client.once('close', () => {
            this.removeClient(id);
        });

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
                type: 'http',
            };
        }
        catch (err) {
            this.removeClient(id);
            throw err;
        }
    }

    _isPublicPortInUse(port) {
        return Object.values(this.clients).some(
            (c) => (c.type === 'tcp' || c.type === 'udp') && c.publicPort === port
        );
    }

    async _newTcpClient(id, token, maxSockets, requestedPublicPort, target) {
        const clients = this.clients;
        const stats = this.stats;

        if (requestedPublicPort !== undefined && this._isPublicPortInUse(requestedPublicPort)) {
            throw new Error(`Port ${requestedPublicPort} is already in use by another tunnel`);
        }

        // Same TunnelAgent as HTTP mode for client socket pool
        const agent = new TunnelAgent({
            clientId: id,
            maxTcpSockets: maxSockets,
            token,
            server: this.server,
        });

        // Public-facing TCP server
        const tcpAgent = new TcpTunnelAgent({
            agent,
            clientId: id,
        });

        const client = new Client({
            id,
            agent,
            tcpAgent,
            type: 'tcp',
            target,
        });

        clients[id] = client;

        client.once('close', () => {
            this.removeClient(id);
        });

        try {
            // Start TunnelAgent (client connections)
            let port = this.port;
            if (this.server) {
                const promise = this.serverListening ?? this.listen(port);
                await promise;
            } else {
                const info = await agent.listen();
                port = info.port;
            }

            // Start TcpTunnelAgent (public server)
            const publicInfo = await tcpAgent.listen(requestedPublicPort);
            client.publicPort = publicInfo.publicPort;

            ++stats.tunnels;
            return {
                id: id,
                port: port,
                public_port: publicInfo.publicPort,
                max_conn_count: maxSockets,
                token,
                type: 'tcp',
            };
        }
        catch (err) {
            this.removeClient(id);
            throw err;
        }
    }

    async _newUdpClient(id, token, maxSockets, requestedPublicPort, target) {
        const clients = this.clients;
        const stats = this.stats;

        if (requestedPublicPort !== undefined && this._isPublicPortInUse(requestedPublicPort)) {
            throw new Error(`Port ${requestedPublicPort} is already in use by another tunnel`);
        }

        const agent = new TunnelAgent({
            clientId: id,
            maxTcpSockets: maxSockets,
            token,
            server: this.server,
        });

        const udpAgent = new UdpTunnelAgent({
            agent,
            clientId: id,
        });

        const client = new Client({
            id,
            agent,
            udpAgent,
            type: 'udp',
            target,
        });

        clients[id] = client;

        client.once('close', () => {
            this.removeClient(id);
        });

        try {
            // Start TunnelAgent (client connections)
            let port = this.port;
            if (this.server) {
                const promise = this.serverListening ?? this.listen(port);
                await promise;
            } else {
                const info = await agent.listen();
                port = info.port;
            }

            // Start UdpTunnelAgent (public UDP socket)
            const publicInfo = await udpAgent.listen(requestedPublicPort);
            client.publicPort = publicInfo.publicPort;

            ++stats.tunnels;
            return {
                id: id,
                port: port,
                public_port: publicInfo.publicPort,
                max_conn_count: maxSockets,
                token,
                type: 'udp',
            };
        }
        catch (err) {
            this.removeClient(id);
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
