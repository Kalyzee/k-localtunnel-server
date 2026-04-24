// lib/ClientManager.d.ts
export interface ClientManagerOptions {
  domain?: string;
  secure?: boolean;
  landing?: string;
  [key: string]: any;
}

export interface ClientInfo {
  id: string;
  url: string;
  type: 'http' | 'tcp' | 'udp';
  public_port?: number;
  [key: string]: any;
}

export interface Client {
  type: 'http' | 'tcp' | 'udp';
  publicPort: number | null;
  target: string | null;
  handleRequest(req: any, res: any): void;
  handleUpgrade(req: any, socket: any, head?: any): void;
  stats(): { connectedSockets: number; activeExternalConnections?: number; activeSessions?: number };
}

export default class ClientManager {
  constructor(opt?: ClientManagerOptions);
  stats: { tunnels: number };
  clients: Map<string, Client>;
  getClient(id: string): Client | undefined;
  hasClient(id: string): boolean;
  removeClient(id: string): void;
  newClient(id: string, token?: string, type?: 'http' | 'tcp' | 'udp', requestedPublicPort?: number, target?: string, requestedMaxConn?: number): Promise<ClientInfo>;
}