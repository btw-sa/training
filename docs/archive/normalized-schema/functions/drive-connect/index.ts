// Connects the company Google account for Drive (drive.file scope), once, by an Admin or IT Manager.
//   GET  ?start=1   (with the caller's session in the "state" cookie flow handled by the app)
//   GET  ?code=…    Google redirects here after consent; the refresh token is stored in Vault.
// The app shows the "what the app can access" explanation before sending the person here.
import { callerClient, json, serviceClient, SITE_URL } from '../_shared/http.ts';
import { DRIVE_SCOPE } from '../_shared/google.ts';

const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')!;
const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')!;
const REDIRECT = Deno.env.get('SUPABASE_URL') + '/functions/v1/drive-connect';
const STATE_SECRET = Deno.env.get('DRIVE_STATE_SECRET')!;   // random 32+ chars, set with `supabase secrets set`

async function sign(v: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(STATE_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(v));
  return btoa(String.fromCharCode(...new Uint8Array(mac))).replace(/[+/=]/g, '');
}

Deno.serve(async req => {
  const u = new URL(req.url);
  if (req.method === 'POST') {
    // Step 1: the app calls this with the user's session; we check permission and return Google's consent URL.
    const { data: perms } = await callerClient(req).rpc('my_permissions');
    if (!Array.isArray(perms) || !perms.includes('integrations.manage')) return json({ error: 'forbidden' }, 403);
    const { data: me } = await callerClient(req).rpc('my_profile_id');
    const payload = `${me}.${Date.now()}`;
    const state = `${payload}.${await sign(payload)}`;
    const consent = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    consent.search = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: REDIRECT, response_type: 'code', scope: `openid email ${DRIVE_SCOPE}`,
      access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false', state }).toString();
    return json({ url: consent.toString() });
  }
  // Step 2: Google's redirect back.
  const code = u.searchParams.get('code'); const state = u.searchParams.get('state') ?? '';
  const [profileId, ts, mac] = state.split('.');
  const back = (q: string) => Response.redirect(`${SITE_URL}/admin/integrations?drive=${q}`, 302);
  if (!code || !profileId || !mac || mac !== await sign(`${profileId}.${ts}`) || Date.now() - Number(ts) > 10 * 60 * 1000) return back('invalid');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT, grant_type: 'authorization_code' })
  });
  if (!res.ok) return back('failed');
  const tok = await res.json();
  if (!tok.refresh_token || !String(tok.scope ?? '').includes(DRIVE_SCOPE)) return back('scope');
  const info = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${tok.access_token}` } }).then(r => r.json());
  const { error } = await serviceClient().rpc('store_drive_refresh_token', { p_token: tok.refresh_token, p_account: info.email ?? null, p_by: profileId });
  return back(error ? 'failed' : 'connected');
});
