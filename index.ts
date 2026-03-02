import { randomBytes } from "crypto";
import Debug from "debug";
import express, { Request, Response } from "express";
import type { IncomingMessage, ServerResponse } from "http";
import http from "http";
import { hri } from "human-readable-ids";
import type { Socket } from "net";
import tldjs from "tldjs";
import ClientManager from "./lib/ClientManager.js";

const debug = Debug("localtunnel:server");

export interface TunnelServerOptions {
  maxTcpSockets?: number;
  domain?: string;
  secure?: boolean;
  landing?: string;
  authKey?: string;
  disableApi?: boolean;
}

export interface TunnelServerInstance {
  server: http.Server<typeof IncomingMessage, typeof ServerResponse>;
  getClients(): string[];
}

export function createTunnelInstance(options: TunnelServerOptions = {}): TunnelServerInstance {
  const validHosts = options.domain ? [options.domain] : undefined;
  const myTldjs = tldjs.fromUserSettings({ validHosts });

  const landingPage = options.landing ?? "https://localtunnel.github.io/www/";
  const schema = options.secure ? "https" : "http";

  const manager = new ClientManager(options);

  const app = express();
  app.use(express.json());

  function getClientIdFromHostname(hostname: string) {
    return myTldjs.getSubdomain(hostname);
  }

  function isUnauthorized(req: Request, res: Response): boolean {
    if (!options.authKey) return false;
    const key = req.headers["x-lt-auth"] as string | undefined;
    if (key !== options.authKey) {
      res.status(401).json({ error: "Unauthorized" });
      return true;
    }
    return false;
  }

  function generateClientToken(): string | undefined {
    if (!options.authKey) return undefined;
    return randomBytes(32).toString("hex");
  }

  app.use((req, res, next) => {
    if (isUnauthorized(req, res)) return;
    next();
  });

  // ---------------- API ROUTES ----------------
  if (options?.disableApi) {
    const router = express.Router();

    router.get("/api/status", (req, res) => {
      const stats = manager.stats;
      res.json({
        tunnels: stats.tunnels,
        mem: process.memoryUsage(),
      });
    });

    router.get("/api/tunnels/:id/status", (req, res) => {
      const clientId = req.params.id;
      const client = manager.getClient(clientId);
      if (!client) return res.sendStatus(404);

      const stats = client.stats();
      res.json({ connected_sockets: stats.connectedSockets });
    });

    app.use(router);
  }

  // ROOT endpoint
  app.get("/", async (req, res) => {
    const isNewClientRequest = req.query["new"] !== undefined;

    if (!isNewClientRequest) {
      res.redirect(landingPage);
      return;
    }

    let clientId: string | undefined;

    const headerId = req.headers["x-lt-client-id"] as string | undefined;

    if (headerId) {
      if (manager.getClient(headerId)) {
        res.status(409).json({ error: "Client Id already used" });
        return;
      }
      clientId = headerId;
    } else {
      let success = false;
      let attempts = 0;
      while (!success && attempts < 15) {
        const id = hri.random();
        if (!manager.getClient(id)) {
          clientId = id;
          success = true;
        }
        attempts++;
      }

      if (!success || !clientId) {
        res.status(500).json({ error: "Impossible to generate client id" });
        return;
      }
    }

    debug("Creating new client %s", clientId);

    const token = generateClientToken();
    const info = await manager.newClient(clientId, token);
    info.url = `${schema}://${info.id}.${req.headers.host}`;

    res.json(info);
  });

  // ---------------- HANDLERS ----------------

  const requestHandler = (req: IncomingMessage, res: ServerResponse) => {
    const hostname = req.headers.host;
    if (!hostname) {
      res.statusCode = 400;
      res.end("Host header is required");
      return;
    }

    const clientId = getClientIdFromHostname(hostname);

    // fallback vers Express app
    if (!clientId) {
      app(req as any, res as any);
      return;
    }

    const client = manager.getClient(clientId);
    if (!client) {
      res.statusCode = 404;
      res.end("404");
      return;
    }

    client.handleRequest(req, res);
  };

  const upgradeHandler = (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const hostname = req.headers.host;
    if (!hostname) {
      socket.destroy();
      return;
    }

    const clientId = getClientIdFromHostname(hostname);
    if (!clientId) {
      socket.destroy();
      return;
    }

    const client = manager.getClient(clientId);
    if (!client) {
      socket.destroy();
      return;
    }

    client.handleUpgrade(req, socket, head);
  };

  const server = http.createServer();

  // Attach listeners
  server.on("request", requestHandler);
  server.on("upgrade", upgradeHandler);

  debug("LocalTunnel attached");

  return {
    server,
    getClients() {
      return Array.from(manager.clients.keys());
    },
  };
}
