export function connectMongo(uri: string): Promise<void>;
export function isMongoConnected(): boolean;
export function disconnectMongo(): Promise<void>;
