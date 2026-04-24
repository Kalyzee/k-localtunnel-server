import Debug from 'debug';
import mongoose from 'mongoose';

const debug = Debug('lt:mongo');

let connectPromise = null;

/**
 * Connect mongoose once. Subsequent calls return the same in-flight promise,
 * so every store sharing this helper ends up on the same connection.
 */
export function connectMongo(uri) {
  if (connectPromise) return connectPromise;
  if (!uri) return Promise.reject(new Error('mongoUri is required'));
  debug('connecting to %s', uri.replace(/\/\/[^@]*@/, '//***@'));
  connectPromise = mongoose.connect(uri).then(() => {
    debug('connected');
  }).catch((err) => {
    connectPromise = null; // allow retry after a failure
    throw err;
  });
  return connectPromise;
}

export function isMongoConnected() {
  return mongoose.connection.readyState === 1;
}

export async function disconnectMongo() {
  if (!connectPromise) return;
  await mongoose.disconnect();
  connectPromise = null;
}
