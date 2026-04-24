import { randomBytes } from "crypto";
import Debug from "debug";
import express, { Request, Response } from "express";
import type { IncomingMessage, ServerResponse } from "http";
import http from "http";
import { hri } from "human-readable-ids";
import type { Socket } from "net";
import tldjs from "tldjs";
import ApiKeyStore from "./lib/ApiKeyStore.js";
import ClientManager from "./lib/ClientManager.js";
import FilterStore from "./lib/FilterStore.js";
import getAdminHtml from "./lib/adminHtml.js";
import { connectMongo } from "./lib/mongo.js";

const debug = Debug("localtunnel:server");

export interface AuthFilterConfig {
  pattern: string;
  authorized: boolean;
  priority?: number;
}

export interface TunnelServerOptions {
  maxTcpSockets?: number;
  maxHttpSockets?: number;
  maxTcpTunnelSockets?: number;
  maxUdpSockets?: number;
  domain?: string;
  secure?: boolean;
  landing?: string;
  /** When true, API keys are required (via `x-lt-auth` header) and `mongoUri` must be provided. */
  authRequired?: boolean;
  /** MongoDB connection string for the API key store. Required when `authRequired` is true. */
  mongoUri?: string;
  adminUsername?: string;
  adminPassword?: string;
  disableApi?: boolean;
  uniquePortTcpServer?: number;
  defaultFilters?: AuthFilterConfig[];
}

export interface TunnelServerInstance {
  server: http.Server<typeof IncomingMessage, typeof ServerResponse>;
  getClients(): string[];
  /** Present when `authRequired` is true. */
  apiKeyStore: ApiKeyStore | null;
  /** Always present — uses Mongo if `mongoUri` is set, otherwise in-memory. */
  filterStore: FilterStore;
  /** Must be awaited before `server.listen()`. Connects to Mongo (if needed) and initializes stores. */
  ready(): Promise<void>;
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

  // API key store — instantiated only when authentication is enabled.
  // The caller (bin/server) is responsible for awaiting `.connect(mongoUri)` before
  // starting to listen, so the first request sees a ready store.
  let apiKeyStore: ApiKeyStore | null = null;
  if (options.authRequired) {
    if (!options.mongoUri) {
      throw new Error("authRequired=true requires mongoUri to be set");
    }
    apiKeyStore = new ApiKeyStore();
  }

  // Filter-based authorization system — persisted to Mongo if `mongoUri` is set,
  // otherwise kept in memory. The store maintains an in-memory cache used by
  // `isIdAuthorized`, so the hot path never hits the DB.
  const filterStore = new FilterStore({
    useMongo: !!options.mongoUri,
    defaultFilters: options.defaultFilters,
  });

  // Tracks SSE-connected IDs and their watching clients
  const pendingTunnels = new Map<string, PendingTunnel>();

  function isIdAuthorized(tunnelId: string): boolean {
    return filterStore.isIdAuthorized(tunnelId);
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

  // When a temporary allow expires, the store flips the filter to deny and emits.
  // We re-run the SSE notification + active-tunnel cleanup just like an admin change would.
  filterStore.on("change", () => reEvaluateAllPending());

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

  /**
   * Verifies the `x-lt-auth` header against the API key store.
   * On success, updates usage stats (fire-and-forget) and returns false.
   * On failure, writes a 401/503 response and returns true.
   */
  async function isUnauthorized(req: Request, res: Response): Promise<boolean> {
    if (!options.authRequired) return false;
    if (!apiKeyStore || !apiKeyStore.connected) {
      res.status(503).json({ error: "Auth backend not ready" });
      return true;
    }
    const rawKey = req.headers["x-lt-auth"] as string | undefined;
    if (!rawKey) {
      res.status(401).json({ error: "Unauthorized" });
      return true;
    }
    const doc = await apiKeyStore.verify(rawKey);
    if (!doc) {
      res.status(401).json({ error: "Unauthorized" });
      return true;
    }
    // Update lastUsed / counter / lastIp in the background — don't block the request.
    apiKeyStore.touch(doc._id, req.ip ?? null);
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
    if (!options.authRequired) return undefined;
    return randomBytes(32).toString("hex");
  }


  // ---------------- ADMIN UI ----------------
  app.get("/admin", (req, res) => {
    res.send(getAdminHtml());
  });

  // ---------------- AUTHORIZATION FILTER API (admin) ----------------

  // List all filters (sorted by priority desc)
  app.get("/api/filters", (req, res) => {
    if (isAdminUnauthorized(req, res)) return;
    res.json(filterStore.list());
  });

  // Add a filter
  app.post("/api/filters", async (req, res) => {
    if (isAdminUnauthorized(req, res)) return;
    const { pattern, authorized, priority, allowUntil } = req.body;
    if (typeof pattern !== "string" || !pattern.trim()) {
      res.status(400).json({ error: "Missing or invalid 'pattern'" });
      return;
    }
    if (typeof authorized !== "boolean") {
      res.status(400).json({ error: "Missing or invalid 'authorized' (boolean)" });
      return;
    }
    try {
      const created = await filterStore.create({ pattern, authorized, priority, allowUntil });
      if (!created) {
        res.status(500).json({ error: "Failed to create filter" });
        return;
      }
      debug("Filter added: %s (authorized=%s, priority=%d)", created.pattern, created.authorized, created.priority);
      reEvaluateAllPending();
      res.status(201).json(created);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Update a filter
  app.put("/api/filters/:filterId", async (req, res) => {
    if (isAdminUnauthorized(req, res)) return;
    try {
      const updated = await filterStore.update(req.params.filterId, req.body ?? {});
      if (!updated) {
        res.status(404).json({ error: "Filter not found" });
        return;
      }
      debug("Filter %s updated", updated.id);
      reEvaluateAllPending();
      res.json(updated);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Delete a filter
  app.delete("/api/filters/:filterId", async (req, res) => {
    if (isAdminUnauthorized(req, res)) return;
    try {
      const removed = await filterStore.delete(req.params.filterId);
      if (!removed) {
        res.status(404).json({ error: "Filter not found" });
        return;
      }
      debug("Filter %s removed: %s", removed.id, removed.pattern);
      reEvaluateAllPending();
      res.json(removed);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ---------------- API KEYS (admin) ----------------
  // These routes manage keys that clients use in `x-lt-auth`. They're only
  // meaningful when the server was started with `authRequired=true`.

  function requireKeyStore(res: Response): ApiKeyStore | null {
    if (!apiKeyStore) {
      res.status(400).json({ error: "API keys are disabled (authRequired=false)" });
      return null;
    }
    if (!apiKeyStore.connected) {
      res.status(503).json({ error: "Auth backend not ready" });
      return null;
    }
    return apiKeyStore;
  }

  // List all API keys (without the plaintext key or its hash)
  app.get("/api/keys", async (req, res) => {
    if (isAdminUnauthorized(req, res)) return;
    const store = requireKeyStore(res);
    if (!store) return;
    try {
      const keys = await store.list();
      res.json(keys);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create a new API key — returns the plaintext key once, in the `key` field
  app.post("/api/keys", async (req, res) => {
    if (isAdminUnauthorized(req, res)) return;
    const store = requireKeyStore(res);
    if (!store) return;
    const { name, expiresAt } = req.body ?? {};
    if (typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "Missing or invalid 'name'" });
      return;
    }
    try {
      const created = await store.create({ name, expiresAt: expiresAt ?? null });
      res.status(201).json(created);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Update name / active / expiresAt
  app.patch("/api/keys/:id", async (req, res) => {
    if (isAdminUnauthorized(req, res)) return;
    const store = requireKeyStore(res);
    if (!store) return;
    try {
      const updated = await store.update(req.params.id, req.body ?? {});
      if (!updated) {
        res.status(404).json({ error: "Key not found" });
        return;
      }
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Delete a key
  app.delete("/api/keys/:id", async (req, res) => {
    if (isAdminUnauthorized(req, res)) return;
    const store = requireKeyStore(res);
    if (!store) return;
    try {
      const removed = await store.delete(req.params.id);
      if (!removed) {
        res.status(404).json({ error: "Key not found" });
        return;
      }
      res.json(removed);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
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

  app.use(async (req, res, next) => {
    if (await isUnauthorized(req, res)) return;
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

    // Heartbeat every 15s. Short enough to keep NAT/LB entries alive and to let
    // the client detect a dead connection quickly (it times out after 45s of no data).
    const heartbeat = setInterval(() => {
      try {
        res.write(": heartbeat\n\n");
      } catch (e) {
        debug("SSE heartbeat write failed: %s", (e as Error).message);
        clearInterval(heartbeat);
        removeSseClient(sseClient);
        try { res.end(); } catch (_) {}
      }
    }, 15000);

    res.on("error", (err) => {
      debug("SSE response error: %s", err.message);
      clearInterval(heartbeat);
      removeSseClient(sseClient);
    });

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
    const requestedMaxConn = req.query["max_conn"]
      ? parseInt(req.query["max_conn"] as string, 10)
      : undefined;

    debug("Creating new client %s (type=%s, target=%s)", clientId, tunnelType, target);

    try {
      const token = generateClientToken();
      const info = await manager.newClient(clientId, token, tunnelType, requestedPublicPort, target, requestedMaxConn);
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

  async function ready() {
    if (options.mongoUri) {
      await connectMongo(options.mongoUri);
    }
    await filterStore.init();
  }

  return {
    server,
    getClients() {
      return Array.from(manager.clients.keys());
    },
    apiKeyStore,
    filterStore,
    ready,
  };
}

