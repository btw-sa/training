// Builds web/dist/index.html: one self-contained page from web/src/*.
// Usage: node scripts/build-prototype.js
const fs = require('fs');
const path = require('path');
const src = p => fs.readFileSync(path.join(__dirname, '..', 'web', 'src', p), 'utf8');

const ui = ['ui-core.js', 'ui-learner.js', 'ui-manage.js', 'ui-admin.js', 'ui-cards.js', 'ui-canvas.js', 'ui-init.js'].map(src).join('\n');
// Two builds from the same source:
//   web/dist/index.html  one file, no server: a trial copy that keeps data in the browser.
//   site/                GitHub Pages: index.html + config.js (Supabase address and public key).
const page = (o = {}) => `${o.head || ''}<title>BTW Training</title>
<meta name="description" content="BTW staff training: product cards, quizzes, certificates and progress.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&family=Literata:ital,opsz,wght@1,7..72,300;1,7..72,400&family=Nunito+Sans:opsz,wght@6..12,400;6..12,600;6..12,700;6..12,800;6..12,900&family=Tajawal:wght@400;500;700;800&display=swap">
<style>
${src('styles.css')}
</style>
<div id="app"><div class="login"><p>Loading…</p></div></div>
<div id="modal-root"></div>
<div id="toasts" class="toasts" aria-live="polite"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js"></script>
${o.config || ''}<script>
${src('core.js')}
</script>
<script>
${src('i18n.js')}
</script>
<script>
(function () {
'use strict';
${ui}
})();
</script>
`;
const root = path.join(__dirname, '..');
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); console.log('wrote', path.relative(root, file), (text.length / 1024).toFixed(1) + ' KB'); };

// 1) Trial copy (also what the Claude preview shows).
write(path.join(root, 'web', 'dist', 'index.html'), page());

// 2) GitHub Pages site. Content-Security-Policy: scripts only from this site and cdnjs; network calls
//    only to Supabase (and pdf.js fonts from jsDelivr). Inline scripts are allowed because the app ships as one page.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com https://cdn.jsdelivr.net data: blob:",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://*.supabase.co https://*.supabase.in https://cdn.jsdelivr.net http://127.0.0.1:* http://localhost:*",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join('; ');
const head = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="referrer" content="strict-origin-when-cross-origin">
<meta name="theme-color" content="#121314">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%23121314'/%3E%3Ctext x='32' y='41' font-family='Arial' font-weight='900' font-size='22' text-anchor='middle' fill='%23EBECE9'%3EBTW%3C/text%3E%3C/svg%3E">
`;
const site = path.join(root, 'site');
write(path.join(site, 'index.html'), '<!doctype html>\n<html lang="ar" dir="rtl">\n<head>\n' + head + '</head>\n<body>\n' + page({ config: '<script src="config.js"></script>\n' }) + '</body>\n</html>\n');
// config.js (at the top of the repository) is the one file you edit after setting up Supabase.
const cfgSrc = fs.existsSync(path.join(root, 'config.js')) ? path.join(root, 'config.js') : path.join(root, 'web', 'public', 'config.example.js');
write(path.join(site, 'config.js'), fs.readFileSync(cfgSrc, 'utf8'));
write(path.join(site, '.nojekyll'), '');
