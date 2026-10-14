// POST { current, next } — a signed-in person replaces their own password (required after a temporary one).
// The current password is checked again, so a session left open on a shared tablet cannot change it.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { callerClient, cors, json, serviceClient } from '../_shared/http.ts';
import { passwordProblem } from '../_shared/password.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const { current, next } = await req.json().catch(() => ({}));
  const problem = passwordProblem(next);
  if (problem) return json({ error: 'invalid', field: 'password', code: problem }, 400);
  if (next === current) return json({ error: 'invalid', field: 'password', code: 'pw_same' }, 400);

  const { data: who } = await callerClient(req).auth.getUser();
  if (!who?.user?.email) return json({ error: 'unauthenticated' }, 401);

  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: wrong } = await anon.auth.signInWithPassword({ email: who.user.email, password: String(current ?? '') });
  if (wrong) return json({ error: 'bad_credentials' }, 401);

  const admin = serviceClient();
  const { error } = await admin.auth.admin.updateUserById(who.user.id, { password: next });
  if (error) return json({ error: 'password_failed' }, 502);
  await admin.rpc('record_own_password_change', { p_auth_user: who.user.id });
  return json({ ok: true });
});
