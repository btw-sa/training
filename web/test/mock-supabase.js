// A small stand-in for the parts of Supabase the server talks to (PostgREST table + RPC, Storage),
// speaking the same HTTP shapes. Used to run the real Edge Function file under Deno in tests.
'use strict';
const http = require('http');
const crypto = require('crypto');

function startMockSupabase(port = 0) {
  let row = null;
  const audit = [];
  const objects = new Map();
  const tokens = new Map();
  const calls = [];
  const send = (res, status, body, type = 'application/json') => {
    res.writeHead(status, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' });
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
  };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const url = new URL(req.url, 'http://x');
      const p = decodeURIComponent(url.pathname);
      calls.push({ method: req.method, path: p, apikey: req.headers.apikey || null, auth: req.headers.authorization || null });
      if (req.method === 'OPTIONS') return send(res, 204, '', 'text/plain');
      const serviceOk = req.headers.apikey === process.env.MOCK_SERVICE_KEY;
      const json = () => (raw.length ? JSON.parse(raw.toString('utf8')) : {});
      // PostgREST
      if (p === '/rest/v1/app_state' && req.method === 'GET') {
        if (!serviceOk) return send(res, 401, { message: 'no' });
        return send(res, 200, row ? [{ doc: row.doc, version: row.version }] : []);
      }
      if (p === '/rest/v1/rpc/btw_save_state' && req.method === 'POST') {
        if (!serviceOk) return send(res, 401, { message: 'no' });
        const b = json();
        if ((row ? row.version : 0) !== Number(b.p_version)) return send(res, 200, null);
        row = { doc: b.p_doc, version: Number(b.p_version) + 1 };
        (b.p_audit || []).forEach(a => audit.push(a));
        return send(res, 200, row.version);
      }
      // Storage
      let m;
      if ((m = p.match(/^\/storage\/v1\/object\/upload\/sign\/cards\/(.+)$/))) {
        const path = m[1];
        if (req.method === 'POST') {
          if (!serviceOk) return send(res, 401, { message: 'no' });
          const t = crypto.randomBytes(12).toString('hex'); tokens.set(t, { path, kind: 'put' });
          return send(res, 200, { url: `/object/upload/sign/cards/${path}?token=${t}` });
        }
        if (req.method === 'PUT') {
          const t = tokens.get(url.searchParams.get('token'));
          if (!t || t.kind !== 'put' || t.path !== path) return send(res, 400, { message: 'bad token' });
          if (!/application\/pdf/.test(req.headers['content-type'] || '')) return send(res, 415, { message: 'mime' });
          tokens.delete(url.searchParams.get('token'));
          objects.set(path, { bytes: raw, createdAt: new Date().toISOString() });
          return send(res, 200, { Key: 'cards/' + path });
        }
      }
      if ((m = p.match(/^\/storage\/v1\/object\/sign\/cards\/(.+)$/))) {
        const path = m[1];
        if (req.method === 'POST') {
          if (!serviceOk) return send(res, 401, { message: 'no' });
          if (!objects.has(path)) return send(res, 400, { message: 'Object not found' });
          const t = crypto.randomBytes(12).toString('hex'); tokens.set(t, { path, kind: 'get' });
          return send(res, 200, { signedURL: `/object/sign/cards/${path}?token=${t}` });
        }
        if (req.method === 'GET') {
          const t = tokens.get(url.searchParams.get('token'));
          if (!t || t.kind !== 'get' || t.path !== path || !objects.has(path)) return send(res, 400, { message: 'bad token' });
          return send(res, 200, objects.get(path).bytes, 'application/pdf');
        }
      }
      if (p === '/storage/v1/object/list/cards' && req.method === 'POST') {
        if (!serviceOk) return send(res, 401, { message: 'no' });
        const prefix = json().prefix || '';
        const out = [];
        if (!prefix) { const folders = new Set([...objects.keys()].map(k => k.split('/')[0])); folders.forEach(f => out.push({ name: f, id: null })); }
        else objects.forEach((v, k) => { if (k.startsWith(prefix + '/')) out.push({ name: k.slice(prefix.length + 1), id: 'x', created_at: v.createdAt, metadata: { size: v.bytes.length, mimetype: 'application/pdf' } }); });
        return send(res, 200, out);
      }
      if (p === '/storage/v1/object/cards' && req.method === 'DELETE') {
        if (!serviceOk) return send(res, 401, { message: 'no' });
        (json().prefixes || []).forEach(k => objects.delete(k));
        return send(res, 200, []);
      }
      send(res, 404, { message: 'not mocked: ' + req.method + ' ' + p });
    });
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port, state: () => row, audit, objects, calls, close: () => new Promise(r => { server.closeAllConnections(); server.close(r); }) })));
}

module.exports = { startMockSupabase };
