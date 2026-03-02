// lib/ClientManager.d.ts
export interface ClientManagerOptions {
  domain?: string;
  secure?: boolean;
  landing?: string;
  authKey?: string;
}

export interface ClientInfo {
  id: string;
  url: string;
  [key: string]: any;
}

export interface Client {
  handleRequest(req: any, res: any): void;
  handleUpgrade(req: any, socket: any, head?: any): void;
  stats(): { connectedSockets: number };
}

// La classe que tu avais en JS, déclarée ici juste pour les types
export default class ClientManager {
  constructor(opt?: ClientManagerOptions);
  stats: { tunnels: number };
  clients: Mat<string, Client>;
  getClient(id: string): Client | undefined;
  newClient(id: string, token?: string): Promise<ClientInfo>;
}