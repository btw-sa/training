/* ui-init.js — start-up. */
(async () => {
  try { await boot(); }
  catch (e) { console.error(e); S.bootError = e; db = db || Core.seed(Date.now()); api = api || Core.createBackend(db); }
  if (!LS.get('btw-lang') && db.settings && db.settings.defaultLang) S.lang = db.settings.defaultLang === 'en' ? 'en' : 'ar';
  persist();
  sweepLocalCards();
  // A certificate link or QR code: <site>/#verify=BTW-2026-XXXX-XXXX
  const m = /^#verify=([A-Za-z0-9-]{4,40})$/.exec(location.hash || '');
  if (m) { S.route = { name: 'verify' }; render(); F.verify({ cert: decodeURIComponent(m[1]) }); }
  else { S.route = { name: currentUser() ? 'home' : 'login' }; render(); }
  if (IN_ARTIFACT) {
    window.claude.use('downloads').then(d => { DL = d; }).catch(() => { DL = null; });
  }
  // Keep "overdue" and reminders honest if the tab stays open past midnight; on the live site,
  // also pick up changes other people made.
  setInterval(async () => {
    if (S.modal || S.busy || ['exam', 'cards'].includes(S.route.name) || document.hidden) return;
    if (LIVE && S.userId) { try { await Net.serial(() => Net.op('view')); } catch (e) { /* offline: try later */ } }
    render();
  }, 15 * 60 * 1000);
})();
