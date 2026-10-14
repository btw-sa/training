/*
 * handler.js — the live site's server. Runs inside one Supabase Edge Function (Deno) and in the
 * Node dev server used by the tests. It loads the training data, runs the same permission engine
 * as the browser copy (core.js) on the FULL data, saves the result, and returns to the signed-in
 * person only their own scoped copy.
 *
 *   Browser ──POST {op, …}──▶ handle() ──▶ Core (permission checks) ──▶ store.save (optimistic lock)
 *                               │                                         └─▶ audit_log rows
 *                               └─▶ files (Supabase Storage, private bucket "cards", signed URLs)
 *
 * Secrets used here never reach the browser: the service key (store/files adapters), SESSION_SECRET
 * (signs session tokens) and SETUP_CODE (creates the first Admin, or resets the Admin password).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BtwServer = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const enc = new TextEncoder();
  const DAY = 86400000;
  const SESSION_DAYS = 7;
  const SETUP_LOCK_AFTER = 5, SETUP_LOCK_MIN = 15;
  const AUDIT_KEEP_IN_DOC = 500;

  const toHex = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
  const fromHex = h => new Uint8Array((h.match(/../g) || []).map(x => parseInt(x, 16)));
  const b64u = bytes => {
    let s = ''; const a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const fromB64u = s => {
    const b = atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4));
    const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
    return a;
  };
  function sameText(a, b) {
    const x = String(a), y = String(b);
    let d = x.length ^ y.length;
    for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
    return d === 0;
  }
  const riyadhDay = t => new Date(t + 3 * 3600000).toISOString().slice(0, 10);

  function createServer(deps) {
    const { Core, store, files } = deps;
    const env = deps.env || {};
    const cryptoImpl = deps.crypto || globalThis.crypto;
    const subtle = cryptoImpl.subtle;
    const now = deps.now || (() => Date.now());
    const log = deps.log || (() => {});
    const ITER = Math.max(100000, Number(env.PBKDF2_ITER) || 600000);
    const ApiError = Core.ApiError;

    const secureRandom = () => cryptoImpl.getRandomValues(new Uint32Array(1))[0] / 4294967296;
    const randomHex = n => toHex(cryptoImpl.getRandomValues(new Uint8Array(n)));

    /* ---------- passwords: PBKDF2-SHA256, computed before the engine runs ---------- */

    async function pbkdf2(pw, saltHex, iter) {
      const key = await subtle.importKey('raw', enc.encode(String(pw)), 'PBKDF2', false, ['deriveBits']);
      const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations: iter }, key, 256);
      return toHex(bits);
    }

    // The engine is synchronous; hashing is not. So we look at the request first, hash every
    // password it could need, and hand the engine a lookup table.
    async function preparePasswords(doc, makes, verifies) {
      const made = new Map();
      for (const pw of makes) {
        if (typeof pw !== 'string' || !pw || pw.length > 200 || made.has(pw)) continue;
        const salt = randomHex(16);
        made.set(pw, { salt, iter: ITER, hash: await pbkdf2(pw, salt, ITER) });
      }
      const checked = new Map();
      for (const v of verifies) {
        const auth = v.auth;
        const pw = typeof v.pw === 'string' ? v.pw.slice(0, 200) : '';
        if (auth && auth.algo === 'pbkdf2-sha256' && auth.salt) checked.set(auth.salt + '\n' + pw, await pbkdf2(pw, auth.salt, auth.iter || ITER));
        else await pbkdf2(pw || 'x', '00', ITER); // same work for unknown accounts
      }
      return {
        make(pw, by, mustChange, at) {
          const m = made.get(pw);
          if (!m) throw new ApiError('invalid', 'Password could not be processed.');
          return { algo: 'pbkdf2-sha256', iter: m.iter, salt: m.salt, hash: m.hash, setAt: at, setBy: by, mustChange: !!mustChange, lastSignInAt: null };
        },
        verify(auth, pw) {
          const h = checked.get(auth.salt + '\n' + String(pw == null ? '' : pw).slice(0, 200));
          return !!h && sameText(h, auth.hash);
        }
      };
    }

    function passwordNeeds(doc, op, body, actor) {
      const makes = [], verifies = [];
      const findLogin = id => {
        const key = String(id || '').trim().toLowerCase();
        return key ? doc.users.find(x => (x.email && x.email.toLowerCase() === key) || (x.code && x.code.toLowerCase() === key)) : null;
      };
      if (op === 'login') { const u = findLogin(body.identifier); verifies.push({ auth: u && u.status === 'active' ? u.auth : null, pw: body.password }); }
      if (op === 'setup') makes.push(body.admin && body.admin.password);
      if (op === 'recover') makes.push(body.password);
      if (op === 'call') {
        const a = body.args || [];
        if (body.fn === 'createUser') makes.push(a[0] && a[0].password);
        if (body.fn === 'setPassword') makes.push(a[1]);
        if (body.fn === 'commitImport') makes.push(a[1]);
        if (body.fn === 'changeOwnPassword') { verifies.push({ auth: actor && actor.auth, pw: a[0] }); makes.push(a[1]); }
      }
      return { makes, verifies };
    }

    /* ---------- sessions: HMAC-signed tokens ---------- */

    let hmacKey = null;
    async function key() {
      if (!hmacKey) {
        const secret = env.SESSION_SECRET || env.SERVICE_KEY;
        if (!secret || String(secret).length < 16) throw new ApiError('server_config', 'The server is missing SESSION_SECRET.');
        hmacKey = await subtle.importKey('raw', enc.encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      }
      return hmacKey;
    }
    async function sign(text) { return b64u(await subtle.sign('HMAC', await key(), enc.encode(text))); }
    async function issueToken(u) {
      const payload = b64u(enc.encode(JSON.stringify({ u: u.id, s: u.sessionVer || 0, i: now(), e: now() + SESSION_DAYS * DAY })));
      return payload + '.' + await sign(payload);
    }
    async function readToken(token, doc) {
      if (!token || typeof token !== 'string' || token.length > 2000) return null;
      const [payload, sig] = token.split('.');
      if (!payload || !sig || !sameText(await sign(payload), sig)) return null;
      let p; try { p = JSON.parse(new TextDecoder().decode(fromB64u(payload))); } catch (e) { return null; }
      if (!p || typeof p.e !== 'number' || p.e < now()) return null;
      const u = doc.users.find(x => x.id === p.u);
      if (!u || u.status !== 'active' || (u.sessionVer || 0) !== p.s) return null;
      return { user: u, issuedAt: p.i || 0 };
    }

    async function setupCodeOk(code) {
      const want = env.SETUP_CODE;
      if (!want || String(want).length < 8) throw new ApiError('setup_disabled', 'Add a SETUP_CODE secret (8+ characters) in Supabase first.');
      return sameText(await sign('setup:' + String(code || '')), await sign('setup:' + want));
    }

    /* ---------- load, run, save ---------- */

    async function loadDoc() {
      const row = await store.load();
      if (!row) return { doc: Core.seed(now()), version: 0 };
      return { doc: Core.upgrade(row.doc), version: Number(row.version) };
    }

    // Runs `work` on fresh data, saves if anything changed, retries if someone else saved first.
    async function transaction(work, o = {}) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const { doc, version } = await loadDoc();
        const before = JSON.stringify(doc);
        const auditLen = doc.audit.length;
        const pathsBefore = new Set(doc.files.filter(f => f.path).map(f => f.path));
        let result, error = null;
        try { result = await work(doc); }
        catch (e) { if (e instanceof ApiError) error = e; else throw e; }
        const after = JSON.stringify(doc);
        const changed = after !== before && (!error || o.saveOnError);
        if (changed) {
          const fresh = doc.audit.slice(0, Math.max(0, doc.audit.length - auditLen));
          if (doc.audit.length > AUDIT_KEEP_IN_DOC) doc.audit = doc.audit.slice(0, AUDIT_KEEP_IN_DOC);
          const saved = await store.save(version, error && o.saveOnError ? o.saveOnError(JSON.parse(before), doc) : doc, fresh);
          if (saved == null) { log('conflict, retrying'); continue; }
          const pathsAfter = new Set(doc.files.filter(f => f.path).map(f => f.path));
          const gone = [...pathsBefore].filter(p => !pathsAfter.has(p));
          if (gone.length && files) { try { await files.remove(gone); } catch (e) { log('storage cleanup failed', e); } }
        }
        if (error) throw error;
        return { doc, result };
      }
      throw new ApiError('busy', 'The server is busy. Try again.');
    }

    // Once a day, on the first request: reminders, and old unused uploads.
    async function daily(doc) {
      const today = riyadhDay(now());
      if (doc.meta.lastDaily === today) return false;
      doc.meta.lastDaily = today;
      try { Core.createBackend(doc, { now, random: secureRandom }).runReminders(null); } catch (e) { log('reminders failed', e); }
      if (files && files.sweep) {
        try {
          const used = new Set(doc.files.filter(f => f.path).map(f => f.path));
          await files.sweep(used, now() - DAY);
        } catch (e) { log('sweep failed', e); }
      }
      return true;
    }

    const view = (doc, userId) => {
      const v = Core.createBackend(doc, { now }).scopedView(userId);
      v.meta.serverTime = new Date(now()).toISOString();
      return v;
    };

    async function authed(session) {
      const { doc } = await loadDoc();
      const s = await readToken(session, doc);
      if (!s) throw new ApiError('unauthenticated', 'Sign in again.');
      return s;
    }

    /* ---------- operations ---------- */

    const ops = {
      async public() {
        const { doc } = await loadDoc();
        return Core.createBackend(doc, { now }).publicInfo();
      },

      async verify(body) {
        const { doc } = await loadDoc();
        return Core.createBackend(doc, { now }).verifyCertificate(String(body.no || '').slice(0, 40));
      },

      async login(body) {
        let out;
        await transaction(async doc => {
          const pw = await preparePasswords(doc, ...Object.values(passwordNeeds(doc, 'login', body)));
          const api = Core.createBackend(doc, { now, random: secureRandom, passwords: pw });
          const r = api.login(String(body.identifier || '').slice(0, 200), String(body.password || '').slice(0, 200));
          const u = doc.users.find(x => x.id === r.userId);
          out = { token: await issueToken(u), mustChange: r.mustChange, view: view(doc, u.id) };
        }, { saveOnError: (_b, d) => d });
        return out;
      },

      async setup(body) {
        let out;
        await transaction(async doc => {
          checkSetupLock(doc);
          if (!(await setupCodeOk(body.code))) { recordSetupFail(doc); throw new ApiError('bad_setup_code', 'The setup code is not correct.'); }
          const pw = await preparePasswords(doc, ...Object.values(passwordNeeds(doc, 'setup', body)));
          const api = Core.createBackend(doc, { now, random: secureRandom, passwords: pw });
          const r = api.setupAdmin(body.admin || {});
          const u = doc.users.find(x => x.id === r.userId);
          out = { token: await issueToken(u), view: view(doc, u.id) };
        }, { saveOnError: (_b, d) => d });
        return out;
      },

      async recover(body) {
        let out;
        await transaction(async doc => {
          checkSetupLock(doc);
          if (!(await setupCodeOk(body.code))) { recordSetupFail(doc); throw new ApiError('bad_setup_code', 'The setup code is not correct.'); }
          const pw = await preparePasswords(doc, ...Object.values(passwordNeeds(doc, 'recover', body)));
          const api = Core.createBackend(doc, { now, random: secureRandom, passwords: pw });
          const r = api.recoverAdmin(body.email, body.password);
          const u = doc.users.find(x => x.id === r.userId);
          out = { token: await issueToken(u), view: view(doc, u.id) };
        }, { saveOnError: (_b, d) => d });
        return out;
      },

      async view(body, session) {
        let out;
        await transaction(async doc => {
          const s = await readToken(session, doc);
          if (!s) throw new ApiError('unauthenticated', 'Sign in again.');
          await daily(doc);
          out = { view: view(doc, s.user.id) };
          if (now() - s.issuedAt > DAY) out.token = await issueToken(s.user);
        });
        return out;
      },

      async call(body, session) {
        const fn = String(body.fn || '');
        const args = Array.isArray(body.args) ? body.args : [];
        if (Core.LIVE_UNAVAILABLE.includes(fn)) throw new ApiError('not_available', 'This is not available on the live site yet.');
        if (!Core.MUTATIONS.includes(fn) && !Core.SERVER_READS.includes(fn)) throw new ApiError('invalid', 'Unknown action.');
        if (Core.SERVER_READS.includes(fn)) {
          const s = await authed(session);
          const { doc } = await loadDoc();
          return { result: Core.createBackend(doc, { now })[fn](s.user.id, ...args) };
        }
        let out;
        await transaction(async doc => {
          const s = await readToken(session, doc);
          if (!s) throw new ApiError('unauthenticated', 'Sign in again.');
          if (fn === 'addCards' || fn === 'replaceFile') await checkUploads(fn, args);
          await daily(doc);
          const actor = s.user;
          const pw = await preparePasswords(doc, ...Object.values(passwordNeeds(doc, 'call', body, actor)));
          const api = Core.createBackend(doc, { now, random: secureRandom, passwords: pw });
          const sv = actor.sessionVer || 0;
          const result = api[fn](actor.id, ...args);
          out = { result: result === undefined ? null : result, view: view(doc, actor.id) };
          if ((actor.sessionVer || 0) !== sv && actor.status === 'active') out.token = await issueToken(actor);
        });
        return out;
      },

      // A short-lived link to one product card PDF, for someone allowed to open it.
      async cardUrl(body, session) {
        const { doc } = await loadDoc();
        const s = await readToken(session, doc);
        if (!s) throw new ApiError('unauthenticated', 'Sign in again.');
        const f = Core.createBackend(doc, { now }).canViewFile(s.user.id, String(body.fileId || ''));
        if (!f.path) throw new ApiError('not_found', 'This file is not an uploaded card.');
        return { url: await files.signDownload(f.path, 3600), title: f.title };
      },

      // Upload slots for new card PDFs in one section (the browser uploads straight to storage).
      async uploadUrls(body, session) {
        const { doc } = await loadDoc();
        const s = await readToken(session, doc);
        if (!s) throw new ApiError('unauthenticated', 'Sign in again.');
        const sec = doc.sections.find(x => x.id === body.sectionId);
        if (!sec) throw new ApiError('not_found');
        const chk = Core.createBackend(doc, { now }).check(s.user.id, 'files.manage', { courseId: sec.courseId });
        if (!chk.ok) throw new ApiError(chk.code, 'You cannot add files to this course.');
        const n = Math.min(50, Math.max(1, Number(body.count) || 1));
        const uploads = [];
        for (let i = 0; i < n; i++) {
          const path = `${sec.id}/${randomHex(12)}.pdf`;
          uploads.push({ path, url: await files.signUpload(path) });
        }
        return { uploads };
      }
    };

    function checkSetupLock(doc) {
      const fails = (doc.meta.setupFails || []).filter(t => Date.parse(t) > now() - SETUP_LOCK_MIN * 60000);
      if (fails.length >= SETUP_LOCK_AFTER) throw new ApiError('login_locked', 'Too many attempts. Try again in 15 minutes.');
    }
    function recordSetupFail(doc) {
      doc.meta.setupFails = (doc.meta.setupFails || []).filter(t => Date.parse(t) > now() - DAY).concat(new Date(now()).toISOString());
    }

    // Uploaded PDFs must really be in storage before they are recorded; sizes come from storage.
    async function checkUploads(fn, args) {
      const items = fn === 'addCards' ? (Array.isArray(args[1]) ? args[1] : []) : (args[1] && args[1].path ? [args[1]] : []);
      if (!items.length) return;
      const byFolder = {};
      items.forEach(c => { const p = String(c && c.path || ''); const i = p.indexOf('/'); if (i > 0) (byFolder[p.slice(0, i)] = byFolder[p.slice(0, i)] || []).push(c); });
      for (const folder of Object.keys(byFolder)) {
        const listed = await files.list(folder);
        const found = new Map(listed.map(o => [folder + '/' + o.name, o]));
        byFolder[folder].forEach(c => {
          const o = found.get(c.path);
          if (!o) throw new ApiError('invalid', 'An uploaded file is missing. Upload it again.', { path: c.path });
          if (o.size != null) c.size = o.size;
        });
      }
      if (items.some(c => !String(c && c.path || '').includes('/'))) throw new ApiError('invalid', 'Upload a PDF file.');
    }

    const STATUS = { unauthenticated: 401, forbidden_role: 403, forbidden_scope: 403, forbidden_rank: 403, not_found: 404, conflict: 409, has_history: 409, last_admin: 409, login_locked: 429, busy: 503, server_config: 500, setup_disabled: 503, not_available: 501 };

    async function handle(req) {
      const op = String((req.body && req.body.op) || '');
      if (!Object.prototype.hasOwnProperty.call(ops, op)) return { status: 400, body: { error: { code: 'invalid', message: 'Unknown operation.' } } };
      try {
        const body = await ops[op](req.body || {}, req.session || null);
        return { status: 200, body };
      } catch (e) {
        if (e instanceof ApiError) return { status: STATUS[e.code] || 400, body: { error: { code: e.code, message: e.message, detail: e.detail === undefined ? null : e.detail } } };
        log('server error', e && (e.stack || e.message || e));
        return { status: 500, body: { error: { code: 'server_error', message: 'Something went wrong on the server.' } } };
      }
    }

    return { handle, _issueToken: issueToken, _pbkdf2: pbkdf2 };
  }

  /* ---------- Supabase adapters (plain HTTPS; used by the Edge Function) ---------- */

  function supabaseAdapters(url, serviceKey, fetchImpl) {
    const f = fetchImpl || fetch;
    const base = String(url).replace(/\/+$/, '');
    const headers = { apikey: serviceKey, 'Content-Type': 'application/json' };
    if (/^eyJ/.test(serviceKey)) headers.Authorization = 'Bearer ' + serviceKey;   // legacy JWT key; new sb_secret_ keys go in apikey only
    const bucket = 'cards';
    const encPath = p => String(p).split('/').map(encodeURIComponent).join('/');
    async function ok(r, what) {
      if (r.ok) return r;
      let t = ''; try { t = await r.text(); } catch (e) { /* ignore */ }
      throw new Error(`${what} failed: ${r.status} ${t.slice(0, 300)}`);
    }
    const store = {
      async load() {
        const r = await ok(await f(`${base}/rest/v1/app_state?id=eq.1&select=doc,version`, { headers }), 'load');
        const rows = await r.json();
        return rows && rows[0] ? rows[0] : null;
      },
      async save(version, doc, audit) {
        const r = await ok(await f(`${base}/rest/v1/rpc/btw_save_state`, { method: 'POST', headers, body: JSON.stringify({ p_version: version, p_doc: doc, p_audit: audit || [] }) }), 'save');
        const v = await r.json();
        return v == null ? null : Number(v);
      }
    };
    const files = {
      async signDownload(path, seconds) {
        const r = await ok(await f(`${base}/storage/v1/object/sign/${bucket}/${encPath(path)}`, { method: 'POST', headers, body: JSON.stringify({ expiresIn: seconds || 3600 }) }), 'sign');
        const j = await r.json();
        return base + '/storage/v1' + j.signedURL;
      },
      async signUpload(path) {
        const r = await ok(await f(`${base}/storage/v1/object/upload/sign/${bucket}/${encPath(path)}`, { method: 'POST', headers, body: '{}' }), 'upload sign');
        const j = await r.json();
        return base + '/storage/v1' + j.url;
      },
      async list(prefix) {
        const r = await ok(await f(`${base}/storage/v1/object/list/${bucket}`, { method: 'POST', headers, body: JSON.stringify({ prefix, limit: 1000, offset: 0 }) }), 'list');
        const rows = await r.json();
        return rows.filter(o => o.id || o.metadata).map(o => ({ name: o.name, size: o.metadata && o.metadata.size != null ? Number(o.metadata.size) : null, createdAt: o.created_at || null }));
      },
      async remove(paths) {
        if (!paths.length) return;
        await ok(await f(`${base}/storage/v1/object/${bucket}`, { method: 'DELETE', headers, body: JSON.stringify({ prefixes: paths }) }), 'remove');
      },
      // Deletes uploads that were never attached to a card (for example, an upload that was abandoned).
      async sweep(used, olderThanMs) {
        const r = await ok(await f(`${base}/storage/v1/object/list/${bucket}`, { method: 'POST', headers, body: JSON.stringify({ prefix: '', limit: 1000, offset: 0 }) }), 'list');
        const folders = (await r.json()).filter(o => !o.id && o.name).map(o => o.name).slice(0, 100);
        const drop = [];
        for (const folder of folders) {
          (await files.list(folder)).forEach(o => {
            const p = folder + '/' + o.name;
            if (!used.has(p) && o.createdAt && Date.parse(o.createdAt) < olderThanMs) drop.push(p);
          });
        }
        if (drop.length) await files.remove(drop.slice(0, 500));
      }
    };
    return { store, files };
  }

  return { createServer, supabaseAdapters };
});
