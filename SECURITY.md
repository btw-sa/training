# Security notes

## Secrets

| Secret | Where it lives | Never in |
| --- | --- | --- |
| Supabase service key (secret / service_role) | Supabase only; the Edge Function receives it automatically | browser, `config.js`, repository, exports |
| `SETUP_CODE` | Supabase → Edge Functions → Secrets, and your password manager | repository, chat messages, email |
| `SESSION_SECRET` (optional) | Supabase → Edge Functions → Secrets | anywhere else |
| Database password | your password manager | repository |
| Admin and staff passwords | nowhere in plain text: stored as PBKDF2 hashes in the database | code, `config.js`, exports |

The Supabase project URL and the publishable (or "anon") key in `config.js` are public by design:
they only let a browser call the `btw-api` function, which checks every request itself. The database
tables and the `cards` bucket allow nothing to the public roles.

## Accounts

- The first Administrator is created on the site's setup screen, which needs `SETUP_CODE`. After that
  the setup screen refuses to run.
- A lost Administrator password is reset from the sign-in page ("Administrator: forgot password?")
  with `SETUP_CODE`. Everyone else asks their manager to set a new password.
- Five wrong passwords (or setup codes) lock that sign-in for 15 minutes.
- Changing or resetting a password, or deactivating someone, signs that person out on every device.
  Sessions otherwise last 7 days.

## If a secret leaks

1. **Service key:** Supabase → Project Settings → API Keys → rotate / create a new secret key and
   revoke the old one. The Edge Function picks up the new key automatically.
2. **SETUP_CODE:** change it in Supabase → Edge Functions → Secrets.
3. **SESSION_SECRET:** change it; everyone is signed out.
4. Check `audit_log` (Supabase → Table Editor) for the exposure window.

## Reporting a problem

Tell the Administrator directly. Do not open a public issue.
