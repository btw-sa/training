// BTW Training — connection settings for the live site.
// After you set up Supabase (see docs/go-live.md), paste two values from
// Supabase → Project Settings → API (or "API Keys"):
//   supabaseUrl     the Project URL, like https://abcdefghijklmnop.supabase.co
//   publishableKey  the publishable key (sb_publishable_…) or, on older projects, the "anon public" key.
// Both are safe to publish: they only let the browser call the training server, which checks
// every request itself. NEVER put the secret / service_role key here.
window.BTW_CONFIG = {
  supabaseUrl: 'https://YOUR-PROJECT.supabase.co',
  publishableKey: 'PASTE-YOUR-PUBLISHABLE-KEY',
  // Optional: the site address used in certificate QR codes, e.g. 'https://btw-sa.github.io/training/'
  siteUrl: ''
};
