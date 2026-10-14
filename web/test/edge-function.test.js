// Runs the generated Edge Function file (supabase/functions/btw-api/index.ts) under Deno against a
// stand-in for Supabase's HTTP APIs, and drives it the way the browser does.
// Needs Deno: set DENO_BIN, or have `deno` on PATH. Skipped otherwise.
// Run: node scripts/build-function.js && node --test web/test/edge-function.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { spawn, execFileSync } = require('child_process');
const { startMockSupabase } = require('./mock-supabase.js');

const fnFile = path.join(__dirname, '..', '..', 'supabase', 'functions', 'btw-api', 'index.ts');
let deno = process.env.DENO_BIN || 'deno';
let haveDeno = true;
try { execFileSync(deno, ['--version'], { stdio: 'ignore' }); } catch (e) { haveDeno = false; }

const KEYS = [
  { name: 'legacy service_role key', env: { SUPABASE_SERVICE_ROLE_KEY: 'eyJmock-service-key-0123456789' }, key: 'eyJmock-service-key-0123456789', bearer: true },
  { name: 'new secret key', env: { SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_mock_0123456789abcdef' }), SUPABASE_SERVICE_ROLE_KEY: 'eyJstale-legacy-key-should-not-be-used' }, key: 'sb_secret_mock_0123456789abcdef', bearer: false }
];
for (const K of KEYS) test('edge function under Deno (' + K.name + '): setup, sign-in, card upload and signed links, CORS', { skip: !haveDeno && 'Deno not installed' }, async () => {
  process.env.MOCK_SERVICE_KEY = K.key;
  assert.ok(fs.existsSync(fnFile), 'run scripts/build-function.js first');
  const sb = await startMockSupabase();
  const port = 18000 + Math.floor(Math.random() * 1000);
  const child = spawn(deno, ['run', '--allow-net', '--allow-env', '--no-prompt', fnFile], {
    env: { ...process.env, DENO_NO_UPDATE_CHECK: '1', NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost', BTW_DEV_PORT: String(port), SUPABASE_URL: `http://127.0.0.1:${sb.port}`, ...K.env, SETUP_CODE: 'kettle-orbit-42', PBKDF2_ITER: '100000', ALLOWED_ORIGIN: 'https://btw.example' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '';
  child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 100; i++) { try { await fetch(base, { method: 'OPTIONS' }); break; } catch (e) { await new Promise(r => setTimeout(r, 100)); } }
    const post = async (body, session) => {
      const r = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://btw.example', apikey: 'sb_publishable_x', ...(session ? { 'x-btw-session': session } : {}) }, body: JSON.stringify(body) });
      return { status: r.status, body: await r.json(), headers: r.headers };
    };
    // CORS preflight for the site's origin
    const pre = await fetch(base, { method: 'OPTIONS', headers: { origin: 'https://btw.example', 'access-control-request-headers': 'content-type,x-btw-session,apikey' } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), 'https://btw.example');
    assert.match(pre.headers.get('access-control-allow-headers'), /x-btw-session/);
    // Another website is refused.
    const evil = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{"op":"public"}' });
    assert.equal(evil.status, 403);

    assert.equal((await post({ op: 'public' })).body.needsSetup, true);
    const setup = await post({ op: 'setup', code: 'kettle-orbit-42', admin: { name: { en: 'Owner' }, email: 'owner@btw.sa', password: '10203040' } });
    assert.equal(setup.status, 200, JSON.stringify(setup.body) + out);
    const tok = setup.body.token;
    assert.equal(sb.state().version, 1);
    assert.ok(sb.calls.filter(c => c.path.startsWith('/rest/')).every(c => c.apikey === K.key && c.auth === (K.bearer ? 'Bearer ' + K.key : null)), 'service key used server-side, Bearer only for JWT keys');
    const login = await post({ op: 'login', identifier: 'owner@btw.sa', password: '10203040' });
    assert.equal(login.status, 200);
    // Course with one section, then two card uploads straight to storage.
    const call = (fn, ...args) => post({ op: 'call', fn, args }, tok);
    const course = (await call('createCourse', { title: { en: 'Products', ar: 'المنتجات' } })).body.result;
    const sec = (await call('saveSection', { courseId: course.id, title: { en: 'Hot drinks' } })).body.result;
    const slots = (await post({ op: 'uploadUrls', sectionId: sec.id, count: 2 }, tok)).body.uploads;
    assert.equal(slots.length, 2);
    for (const s of slots) {
      const put = await fetch(s.url, { method: 'PUT', headers: { 'content-type': 'application/pdf', 'x-upsert': 'false' }, body: Buffer.from('%PDF-1.4 card') });
      assert.equal(put.status, 200);
    }
    const added = await call('addCards', sec.id, slots.map((s, i) => ({ path: s.path, title: 'Card ' + (i + 1) })));
    assert.equal(added.status, 200, JSON.stringify(added.body));
    const link = await post({ op: 'cardUrl', fileId: added.body.result[0].id }, tok);
    assert.equal(link.status, 200);
    const pdf = await fetch(link.body.url);
    assert.equal(Buffer.from(await pdf.arrayBuffer()).toString(), '%PDF-1.4 card');
    // Removing a card removes the PDF from storage.
    await call('removeFile', added.body.result[1].id);
    assert.equal(sb.objects.size, 1);
    // Audit rows reached the audit table.
    assert.ok(sb.audit.some(a => a.action === 'system.setup') && sb.audit.some(a => a.action === 'file.upload'));
    // Errors come back as clean JSON.
    const bad = await post({ op: 'call', fn: 'createUser', args: [{}] }, 'nonsense.token');
    assert.equal(bad.status, 401); assert.equal(bad.body.error.code, 'unauthenticated');
  } finally {
    const exited = new Promise(r => child.once('exit', r));
    child.kill('SIGKILL');
    await exited;
    child.stdout.destroy(); child.stderr.destroy();
    await sb.close();
  }
});
