// POST { profile_id, password, must_change } — a manager opens someone's account or resets their password.
// Allowed only when the manager may edit that person: "add and edit people", in scope, below the manager's role.
// The password goes straight to Supabase Auth (stored as bcrypt) and is never written to our tables or logs.
import { callerClient, cors, json, serviceClient } from '../_shared/http.ts';
import { loginEmailFor, passwordProblem } from '../_shared/password.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const body = await req.json().catch(() => ({}));
  const { profile_id, password } = body as { profile_id?: string; password?: string };
  const mustChange = body.must_change !== false;
  if (typeof profile_id !== 'string') return json({ error: 'invalid' }, 400);
  const problem = passwordProblem(password);
  if (problem) return json({ error: 'invalid', field: 'password', code: problem }, 400);

  // 1. Permission, checked inside the database as the signed-in manager.
  const caller = callerClient(req);
  const { data: allowed } = await caller.rpc('can_set_password', { p_id: profile_id });
  if (allowed !== true) return json({ error: 'forbidden' }, 403);
  const { data: managerId } = await caller.rpc('my_profile_id');

  // 2. Only now act with the service role.
  const admin = serviceClient();
  const { data: prof } = await admin.from('profiles').select('id, email, auth_user_id, status').eq('id', profile_id).single();
  if (!prof || prof.status !== 'active') return json({ error: 'not_found' }, 404);

  let authUserId = prof.auth_user_id as string | null;
  if (!authUserId) {
    const { data, error } = await admin.auth.admin.createUser({
      email: loginEmailFor(prof), password, email_confirm: true, app_metadata: { profile_id: prof.id }
    });
    if (error || !data.user) return json({ error: 'account_failed' }, 502);
    authUserId = data.user.id;
  } else {
    const { error } = await admin.auth.admin.updateUserById(authUserId, { password });
    if (error) return json({ error: 'password_failed' }, 502);
  }
  const { error: recErr } = await admin.rpc('record_password_set', { p_profile: prof.id, p_by: managerId, p_must_change: mustChange, p_auth_user: authUserId });
  if (recErr) return json({ error: 'record_failed' }, 500);
  return json({ ok: true, must_change: mustChange });
});
