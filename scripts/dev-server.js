// Local stand-in for the live site: serves site/ and runs the real server code (server/handler.js)
// with an in-memory database and file store in place of Supabase. For testing on your computer only.
// Usage: npm run build && node scripts/dev-server.js [--port 8788] [--setup-code dev-setup-code]
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const Core = require('../web/src/core.js');
const { createServer } = require('../server/handler.js');
const { memoryStore, memoryFiles } = require('../server/dev-adapters.js');

const arg = (name, dflt) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : dflt; };
const PORT = Number(arg('port', process.env.PORT || 8788));
const SETUP_CODE = arg('setup-code', process.env.SETUP_CODE || 'dev-setup-code');
const BASE = `http://127.0.0.1:${PORT}`;
const SITE = path.join(__dirname, '..', 'site');

const store = memoryStore();
const files = memoryFiles(BASE);
const server = createServer({ Core, store, files, env: { SETUP_CODE, SESSION_SECRET: 'dev-only-session-secret-0123456789', PBKDF2_ITER: '100000' }, log: (...a) => console.log('[api]', ...a) });

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.pdf': 'application/pdf' };
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info, x-btw-session, x-upsert', 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS' };

http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', async () => {
    const raw = Buffer.concat(chunks);
    const url = new URL(req.url, BASE);
    const p = decodeURIComponent(url.pathname);
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    if (p === '/functions/v1/btw-api' && req.method === 'POST') {
      let body = {};
      try { body = JSON.parse(raw.toString('utf8') || '{}'); } catch (e) { res.writeHead(400, cors); return res.end('{}'); }
      const out = await server.handle({ body, session: req.headers['x-btw-session'] || null });
      res.writeHead(out.status, { ...cors, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(out.body));
    }
    let m;
    if ((m = p.match(/^\/storage\/v1\/object\/upload\/sign\/cards\/(.+)$/)) && req.method === 'PUT') {
      if (!files.take(url.searchParams.get('token'), 'put', m[1])) { res.writeHead(400, cors); return res.end('{"message":"bad token"}'); }
      const err = files.put(m[1], raw, req.headers['content-type']);
      res.writeHead(err ? 400 : 200, { ...cors, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(err ? { message: err } : { Key: 'cards/' + m[1] }));
    }
    if ((m = p.match(/^\/storage\/v1\/object\/sign\/cards\/(.+)$/)) && req.method === 'GET') {
      const o = files.get(m[1]);
      if (!o || !files.take(url.searchParams.get('token'), 'get', m[1])) { res.writeHead(400, cors); return res.end('{"message":"bad token"}'); }
      res.writeHead(200, { ...cors, 'Content-Type': 'application/pdf' });
      return res.end(o.bytes);
    }
    if (p === '/config.js') {
      res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store' });
      return res.end(`window.BTW_CONFIG = { supabaseUrl: '${BASE}', publishableKey: 'sb_publishable_dev' };`);
    }
    const file = path.join(SITE, p === '/' ? 'index.html' : p);
    if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
}).listen(PORT, '127.0.0.1', () => console.log(`BTW Training (local live-site stand-in) on ${BASE}  · setup code: ${SETUP_CODE}`));
