// POST — returns a short-lived (1 hour) drive.file access token for Google's picker,
// only to callers who may attach files. The refresh token never leaves the server.
import { callerClient, cors, json } from '../_shared/http.ts';
import { driveAccessToken } from '../_shared/google.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const caller = callerClient(req);
  const { data: perms } = await caller.rpc('my_permissions');
  if (!Array.isArray(perms) || !perms.includes('files.manage')) return json({ error: 'forbidden' }, 403);
  try {
    return json({ access_token: await driveAccessToken(), expires_in: 3600 });
  } catch (e) {
    return json({ error: (e as Error).message }, 503);
  }
});
