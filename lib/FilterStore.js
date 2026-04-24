import Debug from 'debug';
import { EventEmitter } from 'events';
import Filter from './Filter.js';
import { isMongoConnected } from './mongo.js';

const debug = Debug('lt:FilterStore');

// setTimeout only supports delays up to ~24.8 days; longer delays fire immediately
// with a warning. For anything beyond that we chain timers until the real target.
const MAX_TIMEOUT = 2147483647;

/**
 * Stores authorization filters either in MongoDB (when `mongoUri` was provided)
 * or in-memory. The API is identical in both modes.
 *
 * An in-memory `_cache` is always maintained and used for `isIdAuthorized()`,
 * so the hot path never hits the DB. In Mongo mode, any mutation refreshes the
 * cache from the DB afterwards.
 *
 * Temporary allows: when a filter has `authorized=true` AND `allowUntil=Date`,
 * a timer flips it back to `authorized=false` at that moment and emits `'change'`.
 * Timers are re-armed on init() so a process restart doesn't lose expiries.
 */
class FilterStore extends EventEmitter {
  constructor({ useMongo = false, defaultFilters = [] } = {}) {
    super();
    this.useMongo = useMongo;
    this._defaults = defaultFilters;
    this._cache = [];
    this._counter = 0; // for in-memory IDs
    this._expiryTimers = new Map(); // id -> timer handle
  }

  async init() {
    if (this.useMongo) {
      if (!isMongoConnected()) throw new Error('FilterStore(useMongo): mongoose not connected');
      const count = await Filter.countDocuments();
      if (count === 0 && this._defaults.length) {
        debug('seeding %d default filters into empty DB', this._defaults.length);
        await Filter.insertMany(
          this._defaults.map((f) => ({
            pattern: f.pattern,
            authorized: !!f.authorized,
            priority: typeof f.priority === 'number' ? f.priority : 0,
          }))
        );
      }
      await this._refreshCache();
    } else {
      for (const f of this._defaults) {
        this._cache.push(this._makeEntry(f));
      }
      this._sortCache();
    }

    // Re-apply expiries left over from before (past → flip now, future → arm).
    for (const entry of [...this._cache]) {
      if (entry.authorized && entry.allowUntil) {
        await this._applyExpiry(entry);
      }
    }
    debug('ready with %d filters (mode=%s)', this._cache.length, this.useMongo ? 'mongo' : 'memory');
  }

  async _refreshCache() {
    const docs = await Filter.find({}).lean();
    this._cache = docs.map((d) => ({
      id: String(d._id),
      pattern: d.pattern,
      regex: new RegExp(d.pattern),
      authorized: !!d.authorized,
      priority: typeof d.priority === 'number' ? d.priority : 0,
      allowUntil: d.allowUntil ? new Date(d.allowUntil) : null,
    }));
    this._sortCache();
  }

  _sortCache() {
    this._cache.sort((a, b) => b.priority - a.priority);
  }

  _makeEntry({ pattern, authorized, priority = 0, allowUntil = null }) {
    return {
      id: String(++this._counter),
      pattern,
      regex: new RegExp(pattern),
      authorized: !!authorized,
      priority: typeof priority === 'number' ? priority : 0,
      allowUntil: allowUntil ? new Date(allowUntil) : null,
    };
  }

  _toDto(entry) {
    return {
      id: entry.id,
      pattern: entry.pattern,
      authorized: entry.authorized,
      priority: entry.priority,
      allowUntil: entry.allowUntil ? entry.allowUntil.toISOString() : null,
    };
  }

  list() {
    return this._cache.map((e) => this._toDto(e));
  }

  /** O(n) scan against the in-memory cache, ordered by descending priority. */
  isIdAuthorized(tunnelId) {
    for (const f of this._cache) {
      if (f.regex.test(tunnelId)) return f.authorized;
    }
    return false;
  }

  // --- Expiry scheduling ---

  async _applyExpiry(entry) {
    if (!entry.authorized || !entry.allowUntil) {
      this._clearExpiry(entry.id);
      return;
    }
    const ms = entry.allowUntil.getTime() - Date.now();
    if (ms <= 0) {
      // Already expired — flip immediately.
      await this._flipToDeny(entry.id, /* silent */ false);
      return;
    }
    this._armExpiry(entry.id, ms);
  }

  _armExpiry(id, ms) {
    this._clearExpiry(id);
    if (ms <= MAX_TIMEOUT) {
      const handle = setTimeout(() => this._onExpire(id).catch((err) => debug('expire failed: %s', err.message)), ms);
      if (typeof handle.unref === 'function') handle.unref();
      this._expiryTimers.set(id, handle);
      return;
    }
    // Chain long timeouts: fire after MAX, then check remaining.
    const handle = setTimeout(() => {
      const entry = this._cache.find((e) => e.id === id);
      if (!entry || !entry.authorized || !entry.allowUntil) return;
      this._armExpiry(id, entry.allowUntil.getTime() - Date.now());
    }, MAX_TIMEOUT);
    if (typeof handle.unref === 'function') handle.unref();
    this._expiryTimers.set(id, handle);
  }

  _clearExpiry(id) {
    const t = this._expiryTimers.get(id);
    if (t) {
      clearTimeout(t);
      this._expiryTimers.delete(id);
    }
  }

  _clearAllExpiries() {
    for (const t of this._expiryTimers.values()) clearTimeout(t);
    this._expiryTimers.clear();
  }

  async _onExpire(id) {
    this._expiryTimers.delete(id);
    await this._flipToDeny(id, false);
  }

  async _flipToDeny(id, silent = false) {
    if (this.useMongo) {
      const doc = await Filter.findByIdAndUpdate(
        id,
        { authorized: false, allowUntil: null },
        { new: true }
      ).lean();
      if (!doc) return;
      await this._refreshCache();
    } else {
      const entry = this._cache.find((e) => e.id === id);
      if (!entry) return;
      entry.authorized = false;
      entry.allowUntil = null;
      this._sortCache();
    }
    debug('filter %s auto-flipped to deny (allow expired)', id);
    if (!silent) this.emit('change', { id, reason: 'expired' });
  }

  // --- CRUD ---

  /**
   * Normalize patch fields. `allowUntil` is only meaningful together with
   * `authorized=true` — any other combination clears it.
   */
  _normalizeAllowUntil(patch, effectiveAuthorized) {
    if (!('allowUntil' in patch)) return undefined;
    if (!effectiveAuthorized) return null; // deny always clears allowUntil
    if (patch.allowUntil === null) return null;
    const d = new Date(patch.allowUntil);
    if (isNaN(d.getTime())) throw new Error('Invalid allowUntil');
    return d;
  }

  async create({ pattern, authorized, priority, allowUntil }) {
    if (typeof pattern !== 'string' || !pattern.trim()) throw new Error('pattern is required');
    if (typeof authorized !== 'boolean') throw new Error('authorized must be a boolean');
    const prio = typeof priority === 'number' ? priority : 0;
    new RegExp(pattern); // validate early

    const normalizedAllow = this._normalizeAllowUntil({ allowUntil }, authorized);
    const allow = normalizedAllow === undefined ? null : normalizedAllow;

    let entry;
    if (this.useMongo) {
      const doc = await Filter.create({
        pattern,
        authorized,
        priority: prio,
        allowUntil: allow,
      });
      await this._refreshCache();
      entry = this._cache.find((e) => e.id === String(doc._id));
    } else {
      entry = this._makeEntry({ pattern, authorized, priority: prio, allowUntil: allow });
      this._cache.push(entry);
      this._sortCache();
    }

    if (entry) await this._applyExpiry(entry);
    return entry ? this._toDto(entry) : null;
  }

  async update(id, patch) {
    const existing = this._cache.find((e) => e.id === id);
    if (!existing) return null;

    // Effective authorized after this update.
    const effectiveAuthorized =
      typeof patch.authorized === 'boolean' ? patch.authorized : existing.authorized;

    const allowed = {};
    if (typeof patch.pattern === 'string' && patch.pattern.trim()) {
      new RegExp(patch.pattern); // validate
      allowed.pattern = patch.pattern;
    }
    if (typeof patch.authorized === 'boolean') allowed.authorized = patch.authorized;
    if (typeof patch.priority === 'number') allowed.priority = patch.priority;

    const normalizedAllow = this._normalizeAllowUntil(patch, effectiveAuthorized);
    if (normalizedAllow !== undefined) {
      allowed.allowUntil = normalizedAllow;
    } else if (typeof patch.authorized === 'boolean' && patch.authorized === false) {
      // Flipping to deny implicitly clears allowUntil even if not in patch.
      allowed.allowUntil = null;
    }

    if (Object.keys(allowed).length === 0) throw new Error('No valid fields to update');

    let entry;
    if (this.useMongo) {
      const doc = await Filter.findByIdAndUpdate(id, allowed, { new: true }).lean();
      if (!doc) return null;
      await this._refreshCache();
      entry = this._cache.find((e) => e.id === id);
    } else {
      if (allowed.pattern) {
        existing.pattern = allowed.pattern;
        existing.regex = new RegExp(allowed.pattern);
      }
      if ('authorized' in allowed) existing.authorized = allowed.authorized;
      if ('priority' in allowed) existing.priority = allowed.priority;
      if ('allowUntil' in allowed) existing.allowUntil = allowed.allowUntil;
      this._sortCache();
      entry = existing;
    }

    if (entry) await this._applyExpiry(entry);
    return entry ? this._toDto(entry) : null;
  }

  async delete(id) {
    this._clearExpiry(id);
    if (this.useMongo) {
      const doc = await Filter.findByIdAndDelete(id).lean();
      if (!doc) return null;
      await this._refreshCache();
      return {
        id: String(doc._id),
        pattern: doc.pattern,
        authorized: !!doc.authorized,
        priority: typeof doc.priority === 'number' ? doc.priority : 0,
        allowUntil: doc.allowUntil ? new Date(doc.allowUntil).toISOString() : null,
      };
    }
    const idx = this._cache.findIndex((e) => e.id === id);
    if (idx < 0) return null;
    const [entry] = this._cache.splice(idx, 1);
    return this._toDto(entry);
  }
}

export default FilterStore;
