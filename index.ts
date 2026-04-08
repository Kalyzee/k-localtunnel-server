import { randomBytes } from "crypto";
import Debug from "debug";
import express, { Request, Response } from "express";
import type { IncomingMessage, ServerResponse } from "http";
import http from "http";
import { hri } from "human-readable-ids";
import type { Socket } from "net";
import tldjs from "tldjs";
import ClientManager from "./lib/ClientManager.js";
import getAdminHtml from "./lib/adminHtml.js";

const debug = Debug("localtunnel:server");

export interface AuthFilterConfig {
  pattern: string;
  authorized: boolean;
  priority?: number;
}

export interface TunnelServerOptions {
  maxTcpSockets?: number;
  domain?: string;
  secure?: boolean;
  landing?: string;
  authKey?: string;
  adminUsername?: string;
  adminPassword?: string;
  disableApi?: boolean;
  uniquePortTcpServer?: number;
  defaultFilters?: AuthFilterConfig[];
}

export interface TunnelServerInstance {
  server: http.Server<typeof IncomingMessage, typeof ServerResponse>;
  getClients(): string[];
}

interface AuthFilter {
  id: string;
  pattern: string;
  regex: RegExp;
  authorized: boolean;
  priority: number;
}

interface SseClient {
  res: Response;
  ids: string[];
  /** Last known authorization state per ID, to only send changes */
  lastAuthState: Map<string, boolean>;
}

interface PendingTunnel {
  id: string;
  sseClients: Set<SseClient>;
}

export function createTunnelInstance(options: TunnelServerOptions = {}): TunnelServerInstance {
  const validHosts = options.domain ? [options.domain] : undefined;
  const myTldjs = tldjs.fromUserSettings({ validHosts });

  const landingPage = options.landing ?? "https://localtunnel.github.io/www/";
  const schema = options.secure ? "https" : "http";

  const manager = new ClientManager(options);

  // --- Filter-based authorization system ---
  let filterIdCounter = 0;
  const filters: AuthFilter[] = [];

  // Load default filters from options
  if (options.defaultFilters) {
    for (const f of options.defaultFilters) {
      filters.push({
        id: String(++filterIdCounter),
        pattern: f.pattern,
        regex: new RegExp(f.pattern),
        authorized: f.authorized,
        priority: f.priority ?? 0,
      });
    }
    debug("Loaded %d default filters", filters.length);
  }

  function getSortedFilters(): AuthFilter[] {
    return [...filters].sort((a, b) => b.priority - a.priority);
  }

  // Tracks SSE-connected IDs and their watching clients
  const pendingTunnels = new Map<string, PendingTunnel>();

  function isIdAuthorized(tunnelId: string): boolean {
    for (const filter of getSortedFilters()) {
      if (filter.regex.test(tunnelId)) {
        return filter.authorized;
      }
    }
    // No filter matched → not authorized
    return false;
  }

  /** Re-evaluate all pending IDs against current filters and notify SSE clients of changes */
  function reEvaluateAllPending() {
    Array.from(pendingTunnels.entries()).forEach(([tunnelId, pending]) => {
      const nowAuthorized = isIdAuthorized(tunnelId);

      Array.from(pending.sseClients).forEach((sseClient) => {
        const prev = sseClient.lastAuthState.get(tunnelId);
        if (prev !== nowAuthorized) {
          sseClient.lastAuthState.set(tunnelId, nowAuthorized);
          sseClient.res.write(`data: ${JSON.stringify({ id: tunnelId, authorized: nowAuthorized })}\n\n`);
        }
      });

      // If revoked, also close active tunnel on server side
      if (!nowAuthorized && manager.hasClient(tunnelId)) {
        manager.removeClient(tunnelId);
        debug("Tunnel %s closed due to filter change", tunnelId);
      }
    });
  }

  function removeSseClient(sseClient: SseClient) {
    for (const id of sseClient.ids) {
      const pending = pendingTunnels.get(id);
      if (!pending) continue;
      pending.sseClients.delete(sseClient);
      if (pending.sseClients.size === 0) {
        pendingTunnels.delete(id);
      }
    }
  }

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

  function isAdminUnauthorized(req: Request, res: Response): boolean {
    if (!options.adminUsername && !options.adminPassword) return false;
    const authHeader = req.headers["authorization"] as string | undefined;
    if (!authHeader || !authHeader.startsWith("Basic ")) {
      res.set("WWW-Authenticate", 'Basic realm="Tunnel Admin"');
      res.status(401).json({ error: "Unauthorized" });
      return true;
    }
    const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf-8");
    const separatorIndex = decoded.indexOf(":");
    const username = decoded.slice(0, separatorIndex);
    const password = decoded.slice(separatorIndex + 1);
    if (username !== (options.adminUsername ?? "") || password !== (options.adminPassword ?? "")) {
      res.set("WWW-Authenticate", 'Basic realm="Tunnel Admin"');
      res.status(401).json({ error: "Invalid credentials" });
      return true;
    }
    return false;
  }

  function generateClientToken(): string | undefined {
    if (!options.authKey) return undefined;
    return randomBytes(32).toString("hex");
  }


  // ---------------- ADMIN UI ----------------
  app.get("/admin", (req, res) => {
    res.send(getAdminHtml());
  });

  // ---------------- AUTHORIZATION FILTER API (admin) ----------------

  // List all filters (sorted by priority)
  app.get("/api/filters", (req, res) => {
    if (isAdminUnauthorized(req, res)) return;
    res.json(getSortedFilters().map((f) => ({ id: f.id, pattern: f.pattern, authorized: f.authorized, priority: f.priority })));
  });

  // Add a filter
  app.post("/api/filters", (req, res) => {
    if (isAdminUnauthorized(req, res)) return;
    const { pattern, authorized, priority } = req.body;
    if (typeof pattern !== "string" || !pattern.trim()) {
      res.status(400).json({ error: "Missing or invalid 'pattern'" });
      return;
    }
    if (typeof authorized !== "boolean") {
      res.status(400).json({ error: "Missing or invalid 'authorized' (boolean)" });
      return;
    }
    const prio = typeof priority === "number" ? priority : 0;
    try {
      const regex = new RegExp(pattern);
      const filter: AuthFilter = { id: String(++filterIdCounter), pattern, regex, authorized, priority: prio };
      filters.push(filter);
      debug("Filter added: %s (authorized=%s, priority=%d)", pattern, authorized, prio);
      reEvaluateAllPending();
      res.status(201).json({ id: filter.id, pattern, authorized, priority: prio });
    } catch (e: any) {
      res.status(400).json({ error: `Invalid regex: ${e.message}` });
    }
  });

  // Update a filter
  app.put("/api/filters/:filterId", (req, res) => {
    if (isAdminUnauthorized(req, res)) return;
    const idx = filters.findIndex((f) => f.id === req.params.filterId);
    if (idx === -1) {
      res.status(404).json({ error: "Filter not found" });
      return;
    }
    const { pattern, authorized, priority } = req.body;
    try {
      if (typeof pattern === "string" && pattern.trim()) {
        filters[idx].pattern = pattern;
        filters[idx].regex = new RegExp(pattern);
      }
      if (typeof authorized === "boolean") {
        filters[idx].authorized = authorized;
      }
      if (typeof priority === "number") {
        filters[idx].priority = priority;
      }
      debug("Filter %s updated", req.params.filterId);
      reEvaluateAllPending();
      const f = filters[idx];
      res.json({ id: f.id, pattern: f.pattern, authorized: f.authorized, priority: f.priority });
    } catch (e: any) {
      res.status(400).json({ error: `Invalid regex: ${e.message}` });
    }
  });

  // Delete a filter
  app.delete("/api/filters/:filterId", (req, res) => {
    if (isAdminUnauthorized(req, res)) return;
    const idx = filters.findIndex((f) => f.id === req.params.filterId);
    if (idx === -1) {
      res.status(404).json({ error: "Filter not found" });
      return;
    }
    const removed = filters.splice(idx, 1)[0];
    debug("Filter %s removed: %s", removed.id, removed.pattern);
    reEvaluateAllPending();
    res.json({ id: removed.id, pattern: removed.pattern, authorized: removed.authorized, priority: removed.priority });
  });

  // List pending tunnel IDs with their current authorization status and socket count
  app.get("/api/tunnels/pending", (req, res) => {
    if (isAdminUnauthorized(req, res)) return;
    const result = Array.from(pendingTunnels.values()).map((p) => {
      const client = manager.getClient(p.id);
      const stats = client ? client.stats() : null;
      const type = client?.type || '-';
      const connected = !!client;
      let endpoint = '-';
      if (connected) {
        if ((type === 'tcp' || type === 'udp') && client?.publicPort) {
          const host = options.domain || req.headers.host?.split(':')[0] || 'localhost';
          endpoint = `${type}://${host}:${client.publicPort}`;
        } else if (type === 'http') {
          endpoint = `${schema}://${p.id}.${req.headers.host}`;
        }
      }

      return {
        id: p.id,
        type,
        endpoint,
        target: client?.target || undefined,
        authorized: isIdAuthorized(p.id),
        connected,
        connectedSockets: stats ? stats.connectedSockets : 0,
        activeExternalConnections: stats?.activeExternalConnections ?? undefined,
        activeSessions: stats?.activeSessions ?? undefined,
      };
    });
    res.json(result);
  });

  app.use((req, res, next) => {
    if (isUnauthorized(req, res)) return;
    next();
  });

  // ---------------- SSE ENDPOINT ----------------
  // Client connects with a list of IDs and receives authorization events
  app.get("/api/sse", (req, res) => {
    const idsParam = req.query["ids"] as string | undefined;
    if (!idsParam) {
      res.status(400).json({ error: "Missing 'ids' query parameter" });
      return;
    }

    const ids = idsParam.split(",").map((id) => id.trim()).filter(Boolean);
    if (ids.length === 0) {
      res.status(400).json({ error: "No valid IDs provided" });
      return;
    }

    // Setup SSE
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.flushHeaders();

    const sseClient: SseClient = { res, ids, lastAuthState: new Map() };

    // Register IDs as pending and attach SSE client
    for (const id of ids) {
      let pending = pendingTunnels.get(id);
      if (!pending) {
        pending = { id, sseClients: new Set() };
        pendingTunnels.set(id, pending);
      }
      pending.sseClients.add(sseClient);

      // Evaluate current authorization and notify immediately
      const authorized = isIdAuthorized(id);
      sseClient.lastAuthState.set(id, authorized);
      res.write(`data: ${JSON.stringify({ id, authorized })}\n\n`);
    }

    debug("SSE client connected for IDs: %s", ids.join(", "));

    // Heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      res.write(": heartbeat\n\n");
    }, 30000);

    req.on("close", () => {
      debug("SSE client disconnected");
      clearInterval(heartbeat);
      removeSseClient(sseClient);
    });
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

    // Check authorization before allowing tunnel creation
    if (!isIdAuthorized(clientId)) {
      res.status(403).json({ error: "Tunnel ID not authorized" });
      return;
    }

    const tunnelType = (req.query["type"] as string) || (req.headers["x-lt-type"] as string) || "http";
    if (tunnelType !== "http" && tunnelType !== "tcp" && tunnelType !== "udp") {
      res.status(400).json({ error: "Invalid tunnel type. Must be 'http', 'tcp', or 'udp'" });
      return;
    }

    const requestedPublicPort = req.query["tcp_port"] || req.query["udp_port"]
      ? parseInt((req.query["tcp_port"] || req.query["udp_port"]) as string, 10)
      : undefined;

    if (requestedPublicPort !== undefined && isNaN(requestedPublicPort)) {
      res.status(400).json({ error: "Invalid port parameter" });
      return;
    }

    const target = req.headers["x-lt-target"] as string | undefined;

    debug("Creating new client %s (type=%s, target=%s)", clientId, tunnelType, target);

    try {
      const token = generateClientToken();
      const info = await manager.newClient(clientId, token, tunnelType, requestedPublicPort, target);
      if (tunnelType === "http") {
        info.url = `${schema}://${info.id}.${req.headers.host}`;
      }
      res.json(info);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ---------------- HANDLERS ----------------

  const requestHandler = (req: IncomingMessage, res: ServerResponse) => {
    const hostname = req.headers.host;
    debug("Request handler : " + hostname + " method : " + req.method);
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

    if (client.type === 'tcp') {
      res.statusCode = 400;
      res.end("This tunnel is TCP-only. Connect via TCP to the assigned public port.");
      return;
    }

    if (client.type === 'udp') {
      res.statusCode = 400;
      res.end("This tunnel is UDP-only. Send UDP datagrams to the assigned public port.");
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

