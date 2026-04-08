import Debug from 'debug';
import { EventEmitter } from 'events';
import net from 'net';
import pump from 'pump';

// Manages the public-facing TCP server for a single TCP tunnel.
// Takes a TunnelAgent instance to get tunnel sockets from its pool.
// When an external connection arrives, a socket is taken from the agent's pool
// and the two are piped bidirectionally.
class TcpTunnelAgent extends EventEmitter {
    constructor(options = {}) {
        super();

        this.agent = options.agent;
        this.debug = Debug(`lt:TcpTunnelAgent[${options.clientId}]`);

        this.publicServer = net.createServer();
        this.publicPort = null;
        this.closed = false;

        // Track active piped pairs for cleanup
        this.activePairs = new Set();
    }

    stats() {
        return {
            activeExternalConnections: this.activePairs.size,
        };
    }

    listen(publicPort) {
        this._setupPublicServer();

        return new Promise((resolve, reject) => {
            this.publicServer.once('error', (err) => {
                reject(err);
            });
            const listener = () => {
                this.publicPort = this.publicServer.address().port;
                this.debug('public tcp server listening on port: %d', this.publicPort);
                resolve({ publicPort: this.publicPort });
            };
            if (publicPort) this.publicServer.listen(publicPort, listener);
            else this.publicServer.listen(listener);
        });
    }

    _setupPublicServer() {
        this.publicServer.on('connection', (externalSocket) => {
            this.debug('new external connection from %s:%s', externalSocket.remoteAddress, externalSocket.remotePort);

            // Get a tunnel socket from the agent's pool
            this.agent.createConnection({}, (err, tunnelSocket) => {
                if (err || !tunnelSocket) {
                    this.debug('no tunnel socket available, rejecting external connection');
                    externalSocket.destroy();
                    return;
                }

                if (tunnelSocket.destroyed) {
                    this.debug('tunnel socket was destroyed, rejecting external connection');
                    externalSocket.destroy();
                    return;
                }

                this.debug('pairing external connection with tunnel socket');

                const pair = { external: externalSocket, tunnel: tunnelSocket };
                this.activePairs.add(pair);

                const cleanup = () => {
                    this.activePairs.delete(pair);
                };

                pump(externalSocket, tunnelSocket, cleanup);
                pump(tunnelSocket, externalSocket, cleanup);
            });
        });

        this.publicServer.on('error', (err) => {
            if (err.code == 'ECONNRESET' || err.code == 'ETIMEDOUT') {
                return;
            }
            this.debug('public server error: %s', err.message);
        });
    }

    destroy() {
        this.closed = true;
        for (const pair of this.activePairs) {
            try { pair.external.destroy(); } catch (e) {}
            try { pair.tunnel.destroy(); } catch (e) {}
        }
        this.activePairs.clear();
        this.publicServer?.close();
    }
}

export default TcpTunnelAgent;
