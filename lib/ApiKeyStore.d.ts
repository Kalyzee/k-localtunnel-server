export interface ApiKeyDto {
  id: string;
  name: string;
  active: boolean;
  expiresAt: string | null;
  usageCount: number;
  lastUsedAt: string | null;
  lastIp: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ApiKeyWithSecret extends ApiKeyDto {
  /** Plaintext API key — only returned at creation time. */
  key: string;
}

export interface ApiKeyDoc {
  _id: unknown;
  name: string;
  keyHash: string;
  expiresAt: Date | null;
  active: boolean;
  usageCount: number;
  lastUsedAt: Date | null;
  lastIp: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export default class ApiKeyStore {
  constructor();
  readonly connected: boolean;
  connect(uri: string): Promise<void>;
  create(input: { name: string; expiresAt?: string | Date | null }): Promise<ApiKeyWithSecret>;
  verify(rawKey: string): Promise<ApiKeyDoc | null>;
  touch(id: unknown, ip: string | null | undefined): Promise<void>;
  list(): Promise<ApiKeyDto[]>;
  get(id: string): Promise<ApiKeyDto | null>;
  update(
    id: string,
    patch: { name?: string; active?: boolean; expiresAt?: string | Date | null }
  ): Promise<ApiKeyDto | null>;
  delete(id: string): Promise<ApiKeyDto | null>;
}
