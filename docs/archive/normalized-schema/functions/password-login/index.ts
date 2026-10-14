// POST { identifier, password } — sign in with an employee code or a work email.
// Returns a Supabase session the app stores with supabase.auth.setSession().
// Unknown accounts, wrong passwords and deactivated accounts all get the same answer.
// Five failures for one identifier in 15 minutes (or 30 from one IP) lock sign-in for 15 minutes.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { cors, json, serviceClient } from '../_shared/http.ts';
import { clientIp } from '../_shared/password.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const { identifier, password } = await req.json().catch(() => ({}));
  if (typeof identifier !== 'string' || typeof password !== 'string' || !identifier.trim() || !password) {
    return json({ error: 'bad_credentials' }, 401);
  }
  const ip = clientIp(req);
  const admin = serviceClient();

  const { data: rows } = await admin.rpc('resolve_login', { p_identifier: identifier, p_ip: ip });
  const found = Array.isArray(rows) ? rows[0] : null;
  if (found?.locked) return json({ error: 'login_locked' }, 429);

  let session = null;
  if (found?.auth_user_id) {
    const { data: u } = await admin.auth.admin.getUserById(found.auth_user_id);
    if (u?.user?.email) {
      const anon = createClient(url, anonKey, { auth: { persistSession: false } });
      const { data, error } = await anon.auth.signInWithPassword({ email: u.user.email, password });
      if (!error) session = data.session;
    }
  }
  await admin.rpc('record_login', { p_identifier: identifier, p_ip: ip, p_ok: !!session, p_profile: found?.profile_id ?? null });
  if (!session) return json({ error: 'bad_credentials' }, 401);
  return json({
    access_token: session.access_token, refresh_token: session.refresh_token, expires_in: session.expires_in,
    must_change: !!found?.must_change
  });
});
