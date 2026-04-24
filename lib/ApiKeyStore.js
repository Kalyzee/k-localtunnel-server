import crypto from 'crypto';
import Debug from 'debug';
import mongoose from 'mongoose';
import ApiKey from './ApiKey.js';
import { connectMongo, isMongoConnected } from './mongo.js';

const debug = Debug('lt:ApiKeyStore');

const KEY_REGEX = /^key_([a-f0-9]{24})_([A-Za-z0-9_-]+)$/;
const DATA_BYTES = 32;

function hashData(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function toDto(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    name: doc.name,
    active: doc.active,
    expiresAt: doc.expiresAt ? doc.expiresAt.toISOString() : null,
    usageCount: doc.usageCount ?? 0,
    lastUsedAt: doc.lastUsedAt ? doc.lastUsedAt.toISOString() : null,
    lastIp: doc.lastIp ?? null,
    createdAt: doc.createdAt ? doc.createdAt.toISOString() : null,
    updatedAt: doc.updatedAt ? doc.updatedAt.toISOString() : null,
  };
}

class ApiKeyStore {
  constructor() {}

  get connected() {
    return isMongoConnected();
  }

  async connect(uri) {
    await connectMongo(uri);
    debug('ready');
  }

  /**
   * Create a new API key. The plaintext key is returned once and never persisted.
   * @returns {Promise<{ id: string, key: string, name: string }>}
   */
  async create({ name, expiresAt = null }) {
    if (!name || !name.trim()) throw new Error('name is required');
    const data = crypto.randomBytes(DATA_BYTES).toString('base64url');
    const keyHash = hashData(data);
    const doc = await ApiKey.create({
      name: name.trim(),
      keyHash,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    });
    const key = `key_${doc._id.toString()}_${data}`;
    debug('created key %s (name=%s)', doc._id, doc.name);
    return { ...toDto(doc), key };
  }

  /**
   * Verify a raw API key string. Returns the document on success, null otherwise.
   * Does NOT update usage stats — call touch() after on a successful request.
   */
  async verify(rawKey) {
    if (typeof rawKey !== 'string') return null;
    const match = KEY_REGEX.exec(rawKey);
    if (!match) return null;
    const [, idHex, data] = match;

    let id;
    try {
      id = new mongoose.Types.ObjectId(idHex);
    } catch {
      return null;
    }

    const doc = await ApiKey.findById(id).lean();
    if (!doc) return null;
    if (!doc.active) return null;
    if (doc.expiresAt && doc.expiresAt.getTime() <= Date.now()) return null;

    const providedHash = hashData(data);
    if (!safeEqualHex(providedHash, doc.keyHash)) return null;

    return doc;
  }

  /** Update usage stats for a key after a successful authenticated request. */
  async touch(id, ip) {
    try {
      await ApiKey.updateOne(
        { _id: id },
        { $inc: { usageCount: 1 }, $set: { lastUsedAt: new Date(), lastIp: ip ?? null } }
      );
    } catch (err) {
      debug('touch failed for %s: %s', id, err.message);
    }
  }

  async list() {
    const docs = await ApiKey.find({}, { keyHash: 0 }).sort({ createdAt: -1 }).lean();
    return docs.map(toDto);
  }

  async get(id) {
    const doc = await ApiKey.findById(id, { keyHash: 0 }).lean();
    return toDto(doc);
  }

  async update(id, patch) {
    const allowed = {};
    if (typeof patch.name === 'string' && patch.name.trim()) allowed.name = patch.name.trim();
    if (typeof patch.active === 'boolean') allowed.active = patch.active;
    if (patch.expiresAt === null) allowed.expiresAt = null;
    else if (typeof patch.expiresAt === 'string' || patch.expiresAt instanceof Date) {
      const d = new Date(patch.expiresAt);
      if (isNaN(d.getTime())) throw new Error('Invalid expiresAt');
      allowed.expiresAt = d;
    }
    if (Object.keys(allowed).length === 0) throw new Error('No valid fields to update');
    const doc = await ApiKey.findByIdAndUpdate(id, allowed, { new: true, projection: { keyHash: 0 } }).lean();
    return toDto(doc);
  }

  async delete(id) {
    const doc = await ApiKey.findByIdAndDelete(id, { projection: { keyHash: 0 } }).lean();
    return toDto(doc);
  }
}

export default ApiKeyStore;
