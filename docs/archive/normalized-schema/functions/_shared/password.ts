// Password rules, the same in the app and on the server: at least 8 characters, letters and numbers.
export function passwordProblem(pw: unknown): string | null {
  const s = typeof pw === 'string' ? pw : '';
  if (s.length < 8) return 'pw_short';
  if (s.length > 72) return 'pw_long';
  if (!/[A-Za-z؀-ۿ]/.test(s) || !/[0-9٠-٩]/.test(s)) return 'pw_weak';
  return null;
}

// Staff without a work email still need an address inside Supabase Auth. No email is ever sent to it.
// Set LOGIN_EMAIL_DOMAIN to a subdomain you control, e.g. staff.yourdomain.com.
export function loginEmailFor(profile: { id: string; email: string | null }): string {
  if (profile.email) return profile.email.toLowerCase();
  const domain = Deno.env.get('LOGIN_EMAIL_DOMAIN') ?? 'staff.yourdomain.com';
  return `${profile.id}@${domain}`;
}

export function clientIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  return fwd ? fwd.split(',')[0].trim() : null;
}
