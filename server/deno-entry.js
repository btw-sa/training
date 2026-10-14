/*
 * Supabase Edge Function entry (Deno). Appended after core.js and handler.js by
 * scripts/build-function.js to make supabase/functions/btw-api/index.ts — one file you can paste
 * into the Supabase dashboard editor. Turn OFF "Verify JWT" for this function: it checks its own
 * signed sessions.
 *
 * Secrets (Supabase → Edge Functions → Secrets):
 *   SETUP_CODE      required. 8+ characters. Needed once to create the first Admin, and to reset
 *                   the Admin password if it is ever lost. Keep it somewhere safe.
 *   SESSION_SECRET  optional. 32+ random characters that sign sign-in sessions (defaults to the
 *                   service key). Changing it signs everyone out.
 *   ALLOWED_ORIGIN  optional. Your site address, e.g. https://btw-training.github.io — limits which
 *                   website may call this function. Several can be separated by commas.
 * SUPABASE_URL and the service key are provided by Supabase automatically.
 */
const envGet = k => (Deno.env.get(k) || '').trim();
// New projects provide secret keys as JSON in SUPABASE_SECRET_KEYS; older ones the legacy service_role key.
function serviceKey() {
  try {
    const all = JSON.parse(envGet('SUPABASE_SECRET_KEYS') || '{}');
    const k = all.default || Object.values(all)[0];
    if (k) return String(k);
  } catch (e) { /* not set */ }
  return envGet('SUPABASE_SERVICE_ROLE_KEY') || envGet('SUPABASE_SECRET_KEY');
}
const SERVICE_KEY = serviceKey();
const adapters = BtwServer.supabaseAdapters(envGet('SUPABASE_URL'), SERVICE_KEY);
const server = BtwServer.createServer({
  Core: globalThis.Core,
  store: adapters.store,
  files: adapters.files,
  env: { SETUP_CODE: envGet('SETUP_CODE'), SESSION_SECRET: envGet('SESSION_SECRET'), SERVICE_KEY, PBKDF2_ITER: envGet('PBKDF2_ITER') },
  log: (...a) => console.log('[btw-api]', ...a)
});
const ALLOWED = envGet('ALLOWED_ORIGIN').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);

const handler = async req => {
  const origin = req.headers.get('origin') || '';
  const allow = !ALLOWED.length ? '*' : (ALLOWED.includes(origin) ? origin : ALLOWED[0]);
  const cors = {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info, x-btw-session',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return reply(405, { error: { code: 'invalid', message: 'Use POST.' } });
  if (ALLOWED.length && origin && !ALLOWED.includes(origin)) return reply(403, { error: { code: 'forbidden_origin', message: 'This website may not use this server.' } });
  let body;
  try {
    const text = await req.text();
    if (text.length > 8 * 1024 * 1024) return reply(413, { error: { code: 'invalid', message: 'Request too large.' } });
    body = JSON.parse(text || '{}');
  } catch (e) { return reply(400, { error: { code: 'invalid', message: 'Send JSON.' } }); }
  const out = await server.handle({ body, session: req.headers.get('x-btw-session') });
  return reply(out.status, out.body);
};

// BTW_DEV_PORT is only for the automated tests; Supabase runs the handler on its own address.
const devPort = Number(envGet('BTW_DEV_PORT'));
if (devPort) Deno.serve({ port: devPort, hostname: '127.0.0.1', onListen() {} }, handler);
else Deno.serve(handler);
