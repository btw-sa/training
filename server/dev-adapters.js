/*
 * dev-adapters.js — stand-ins for Supabase used by the tests and the local dev server:
 * an in-memory database row with the same optimistic locking as btw_save_state(), and a
 * private file store that only answers signed, expiring links.
 */
'use strict';
const crypto = require('crypto');

function memoryStore(o = {}) {
  let row = null;
  const audit = [];
  const history = [];
  return {
    async load() { return row ? { doc: JSON.parse(JSON.stringify(row.doc)), version: row.version } : null; },
    async save(version, doc, entries) {
      if (o.beforeSave) await o.beforeSave();
      if ((row ? row.version : 0) !== Number(version)) return null;
      row = { doc: JSON.parse(JSON.stringify(doc)), version: Number(version) + 1 };
      (entries || []).forEach(e => audit.push(e));
      history.push(row.version);
      return row.version;
    },
    _audit: audit, _row: () => row, _history: history,
    _bump() { if (row) row = { doc: row.doc, version: row.version + 1 }; }
  };
}

function memoryFiles(baseUrl) {
  const objects = new Map();   // path -> { bytes, type, createdAt }
  const tokens = new Map();    // token -> { path, kind, exp }
  const tok = (path, kind, seconds) => { const t = crypto.randomBytes(18).toString('hex'); tokens.set(t, { path, kind, exp: Date.now() + seconds * 1000 }); return t; };
  return {
    async signDownload(path, seconds) { return `${baseUrl}/storage/v1/object/sign/cards/${path}?token=${tok(path, 'get', seconds || 3600)}`; },
    async signUpload(path) { return `${baseUrl}/storage/v1/object/upload/sign/cards/${path}?token=${tok(path, 'put', 7200)}`; },
    async list(prefix) {
      const out = [];
      objects.forEach((v, k) => { if (k.startsWith(prefix + '/') && !k.slice(prefix.length + 1).includes('/')) out.push({ name: k.slice(prefix.length + 1), size: v.bytes.length, createdAt: v.createdAt }); });
      return out;
    },
    async remove(paths) { paths.forEach(p => objects.delete(p)); },
    async sweep(used, olderThanMs) { [...objects.keys()].forEach(k => { if (!used.has(k) && Date.parse(objects.get(k).createdAt) < olderThanMs) objects.delete(k); }); },
    // HTTP side, used by the dev server
    take(token, kind, path) {
      const t = tokens.get(token);
      if (!t || t.kind !== kind || t.path !== path || t.exp < Date.now()) return false;
      if (kind === 'put') tokens.delete(token);
      return true;
    },
    put(path, bytes, type) {
      if (objects.has(path)) return 'exists';
      if (!/^application\/pdf\b/.test(type || '')) return 'type';
      if (bytes.length > 50 * 1024 * 1024) return 'size';
      objects.set(path, { bytes, type, createdAt: new Date().toISOString() });
      return null;
    },
    get(path) { return objects.get(path) || null; },
    _objects: objects
  };
}

module.exports = { memoryStore, memoryFiles };
