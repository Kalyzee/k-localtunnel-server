import Debug from 'debug';
import { EventEmitter } from 'events';
import dgram from 'dgram';

import { FRAME_DATA, FRAME_SESSION_CLOSE, encodeFrame, createFrameParser } from './UdpFrameCodec.js';

const DEFAULT_SESSION_TIMEOUT = 30000; // 30s

// Manages the public-facing UDP socket for a single UDP tunnel.
// Takes a TunnelAgent instance to get tunnel sockets from its pool.
// Each unique source IP:port gets its own tunnel socket (session).
// Datagrams are framed (length-prefixed) over the TCP tunnel.
class UdpTunnelAgent extends EventEmitter {
    constructor(options = {}) {
        super();

        this.agent = options.agent;
        this.debug = Debug(`lt:UdpTunnelAgent[${options.clientId}]`);
        this.sessionTimeout = options.sessionTimeout || DEFAULT_SESSION_TIMEOUT;

        this.publicSocket = dgram.createSocket('udp4');
        this.publicPort = null;
        this.closed = false;

        // Map<"ip:port", Session>
        this.sessions = new Map();
        // Map<"ip:port", Buffer[]> — datagrams queued while waiting for a tunnel socket
        this.pendingSessions = new Map();
    }

    stats() {
        return {
            activeSessions: this.sessions.size,
        };
    }

    listen(publicPort) {
        this._setupPublicSocket();

        return new Promise((resolve, reject) => {
            this.publicSocket.once('error', (err) => {
                reject(err);
            });
            this.publicSocket.bind(publicPort || 0, () => {
                const addr = this.publicSocket.address();
                this.publicPort = addr.port;
                this.debug('public udp socket listening on port: %d', this.publicPort);
                resolve({ publicPort: this.publicPort });
            });
        });
    }

    _setupPublicSocket() {
        this.publicSocket.on('message', (msg, rinfo) => {
            this._onMessage(msg, rinfo);
        });

        this.publicSocket.on('error', (err) => {
            this.debug('public socket error: %s', err.message);
        });
    }

    _onMessage(msg, rinfo) {
        const key = `${rinfo.address}:${rinfo.port}`;

        // Existing session — forward datagram
        const session = this.sessions.get(key);
        if (session) {
            this._resetTimer(session);
            this._sendFrame(session.tunnelSocket, rinfo.address, rinfo.port, msg);
            return;
        }

        // Session being created — queue datagram
        if (this.pendingSessions.has(key)) {
            this.pendingSessions.get(key).push({ addr: rinfo.address, port: rinfo.port, msg });
            return;
        }

        // New session — acquire tunnel socket
        this.pendingSessions.set(key, [{ addr: rinfo.address, port: rinfo.port, msg }]);
        this.debug('new udp session from %s', key);

        this.agent.createConnection({}, (err, tunnelSocket) => {
            const queued = this.pendingSessions.get(key);
            this.pendingSessions.delete(key);

            if (err || !tunnelSocket) {
                this.debug('no tunnel socket for session %s, dropping %d datagrams', key, queued?.length || 0);
                return;
            }

            if (tunnelSocket.destroyed) {
                this.debug('tunnel socket destroyed for session %s', key);
                return;
            }

            const session = {
                key,
                addr: rinfo.address,
                port: rinfo.port,
                tunnelSocket,
                parser: createFrameParser(),
                timer: null,
                closed: false,
            };

            this.sessions.set(key, session);
            this._resetTimer(session);

            // Handle response frames from client
            tunnelSocket.on('data', (chunk) => {
                if (session.closed) return;
                this._resetTimer(session);
                const frames = session.parser(chunk);
                for (const frame of frames) {
                    if (frame.type === FRAME_DATA) {
                        this.publicSocket.send(frame.payload, session.port, session.addr);
                    }
                }
            });

            tunnelSocket.once('close', () => {
                this._cleanupSession(session);
            });

            tunnelSocket.once('error', () => {
                this._cleanupSession(session);
            });

            // Flush queued datagrams
            if (queued) {
                for (const item of queued) {
                    this._sendFrame(tunnelSocket, item.addr, item.port, item.msg);
                }
            }
        });
    }

    _sendFrame(tunnelSocket, addr, port, payload) {
        if (tunnelSocket.destroyed) return;
        const frame = encodeFrame(FRAME_DATA, { addr, port }, payload);
        tunnelSocket.write(frame);
    }

    _resetTimer(session) {
        if (session.timer) clearTimeout(session.timer);
        session.timer = setTimeout(() => {
            this.debug('session %s timed out', session.key);
            // Notify client
            if (!session.tunnelSocket.destroyed) {
                const frame = encodeFrame(FRAME_SESSION_CLOSE, { addr: session.addr, port: session.port });
                session.tunnelSocket.write(frame);
            }
            this._cleanupSession(session);
        }, this.sessionTimeout);
        session.timer.unref();
    }

    _cleanupSession(session) {
        if (session.closed) return;
        session.closed = true;
        if (session.timer) clearTimeout(session.timer);
        this.sessions.delete(session.key);
        if (!session.tunnelSocket.destroyed) {
            session.tunnelSocket.destroy();
        }
        this.debug('session %s cleaned up (remaining: %d)', session.key, this.sessions.size);
    }

    destroy() {
        this.closed = true;
        for (const session of this.sessions.values()) {
            this._cleanupSession(session);
        }
        for (const [key, queued] of this.pendingSessions) {
            this.pendingSessions.delete(key);
        }
        try { this.publicSocket.close(); } catch (e) {}
    }
}

export default UdpTunnelAgent;
