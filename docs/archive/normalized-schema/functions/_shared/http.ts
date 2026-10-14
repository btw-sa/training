// Shared helpers for the Edge Functions (Deno runtime on Supabase).
import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://training.yourdomain.com';
const url = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Only the app's own site may call these functions from a browser.
export function cors(res: Response): Response {
  res.headers.set('Access-Control-Allow-Origin', SITE_URL);
  res.headers.set('Access-Control-Allow-Headers', 'authorization, content-type, apikey, x-client-info');
  res.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.headers.set('Vary', 'Origin');
  return res;
}
export const json = (body: unknown, status = 200) =>
  cors(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

// A client that acts as the signed-in caller, so row-level security applies to everything it reads.
export function callerClient(req: Request): SupabaseClient {
  return createClient(url, anonKey, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
}
// Service-role client: bypasses row-level security. Use only after the caller has been checked.
export function serviceClient(): SupabaseClient {
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}
