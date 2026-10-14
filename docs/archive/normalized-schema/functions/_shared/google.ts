// Google OAuth + Drive helpers. Scope is drive.file only: the app can reach files and
// folders someone picked in Google's picker, and files the app itself created.
import { serviceClient } from './http.ts';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')!;
const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')!;

// Exchange the stored refresh token (from Vault) for a 1-hour access token.
export async function driveAccessToken(): Promise<string> {
  const { data: refresh, error } = await serviceClient().rpc('get_drive_refresh_token');
  if (error || !refresh) throw new Error('drive_not_connected');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: refresh as string, grant_type: 'refresh_token' })
  });
  if (!res.ok) throw new Error('drive_unavailable');
  const body = await res.json();
  return body.access_token as string;
}

// Create a file in a folder the company account picked. Retries twice on 429/5xx.
export async function uploadToDrive(token: string, folderId: string, name: string, mime: string, content: string): Promise<{ id: string; name: string }> {
  const boundary = 'b' + crypto.randomUUID();
  const meta = JSON.stringify({ name, parents: [folderId], mimeType: mime });
  const body = `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\ncontent-type: ${mime}\r\n\r\n${content}\r\n--${boundary}--`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/related; boundary=${boundary}` },
      body
    });
    if (res.ok) return await res.json();
    if (res.status !== 429 && res.status < 500) throw new Error('drive_rejected_' + res.status);
    await new Promise(r => setTimeout(r, 1000 * attempt * attempt));
  }
  throw new Error('drive_unavailable');
}
