/* ui-core.js — state, helpers, shell, routing, modals. Concatenated with the other ui-*.js files into one script. */
const { t } = I18N;
const STORE_KEY = 'btw-training-v5';
const LS = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked: keep going in memory */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
};

// Two ways to run, same screens:
//  • Live site (config.js has the Supabase address): data lives on the server. The browser keeps only
//    the signed-in person's own copy for reading; every change goes to the server, which checks it again.
//  • On this device (no config): a trial copy kept in this browser only, for trying things out.
const CFG = (typeof window !== 'undefined' && window.BTW_CONFIG) || {};
const LIVE = !!(CFG.supabaseUrl && CFG.publishableKey && !/YOUR-PROJECT|PASTE/i.test(CFG.supabaseUrl + CFG.publishableKey));
let db, api, DL = null;
let PUB = null;   // live: what the sign-in page may show before anyone signs in
const IN_ARTIFACT = !!(window.claude && window.claude.use);

// Before sign-in on the live site there is no data in the browser, only the business name and texts.
function publicDb(pub) {
  const d = Core.seed(Date.now());
  if (pub && pub.settings) Object.assign(d.settings, pub.settings);
  d.rules = [];
  d.meta.public = true;
  return d;
}

const Net = {
  token: null,
  queue: Promise.resolve(),
  url() { return String(CFG.supabaseUrl).replace(/\/+$/, '') + '/functions/v1/' + (CFG.functionName || 'btw-api'); },
  setToken(tk) { this.token = tk || null; if (tk) LS.set('btw-session', tk); else LS.del('btw-session'); },
  async op(op, body = {}) {
    const headers = { 'Content-Type': 'application/json', apikey: CFG.publishableKey };
    if (/^eyJ/.test(CFG.publishableKey)) headers.Authorization = 'Bearer ' + CFG.publishableKey;   // older "anon" keys
    if (this.token) headers['x-btw-session'] = this.token;
    let res, j;
    try { res = await fetch(this.url(), { method: 'POST', headers, body: JSON.stringify({ op, ...body }) }); }
    catch (e) { throw new Core.ApiError('network', 'No connection to the server.'); }
    try { j = await res.json(); } catch (e) { j = null; }
    // Replies not in our own format come from Supabase itself: the function is missing (404) or
    // Supabase's JWT check is still on for it (401). Both are setup problems, not the person's fault.
    if (!j || (!res.ok && !(j && j.error))) throw new Core.ApiError('server_config', 'Server setup problem (HTTP ' + res.status + ').', { status: res.status });
    if (!res.ok || (j && j.error)) {
      const e = (j && j.error) || {};
      if (e.code === 'unauthenticated' && this.token) { this.setToken(null); setTimeout(() => sessionEnded(), 0); }
      throw new Core.ApiError(e.code || 'server_error', e.message || ('HTTP ' + res.status), e.detail);
    }
    if (j.token) this.setToken(j.token);
    if (j.view) applyView(j.view);
    return j;
  },
  // Changes go one at a time, in order.
  serial(fn) { const p = this.queue.then(fn, fn); this.queue = p.catch(() => {}); return p; }
};

function makeApi() {
  const local = Core.createBackend(db);
  if (!LIVE) return local;
  const w = {};
  Object.keys(local).forEach(k => { w[k] = local[k]; });
  [...Core.MUTATIONS, ...Core.SERVER_READS].forEach(name => {
    w[name] = (actorId, ...args) => Net.serial(() => Net.op('call', { fn: name, args })).then(j => j.result);
  });
  Core.LIVE_UNAVAILABLE.forEach(name => { w[name] = () => Promise.reject(new Core.ApiError('not_available')); });
  return w;
}
function applyView(v) {
  db = v;
  api = makeApi();
  S.userId = v.meta && v.meta.me ? v.meta.me : null;
  _meCache = null;
}
function sessionEnded() {
  if (!LIVE) return;
  db = publicDb(PUB); api = makeApi();
  S.userId = null; S.modal = null; S.exam = null;
  toast(t('err_unauthenticated'), 'bad');
  go('login');
}

async function boot() {
  LS.del('btw-training-proto-v4');          // the old sample-data copy
  if (!LIVE) {
    let parsed = null;
    try { const raw = LS.get(STORE_KEY); parsed = raw && JSON.parse(raw); } catch (e) { parsed = null; }
    db = parsed && parsed.meta && parsed.meta.schema >= 5 ? Core.upgrade(parsed) : Core.seed(Date.now());
    api = Core.createBackend(db);
    S.userId = LS.get('btw-user') || null;
    return;
  }
  Net.token = LS.get('btw-session');
  try { PUB = (await Net.op('public')); } catch (e) { PUB = null; S.bootError = e; }
  db = publicDb(PUB); api = makeApi(); S.userId = null;
  if (Net.token && PUB) { try { await Net.op('view'); } catch (e) { if (e.code !== 'unauthenticated') S.bootError = e; } }
}
const needsSetup = () => (LIVE ? !!(PUB && PUB.needsSetup) : api.needsSetup());
let saveTimer = null;
function persist() { if (LIVE) return; clearTimeout(saveTimer); saveTimer = setTimeout(() => { saveTimer = null; LS.set(STORE_KEY, JSON.stringify(db)); }, 120); }
// Never lose the last change in the trial copy when the tab closes or reloads.
window.addEventListener('pagehide', () => { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; LS.set(STORE_KEY, JSON.stringify(db)); } });
function eraseDevice() { LS.del(STORE_KEY); LS.del('btw-user'); db = Core.seed(Date.now()); api = Core.createBackend(db); S.userId = null; if (window.CardStore) CardStore.clear(); }

const S = {
  lang: LS.get('btw-lang') === 'en' ? 'en' : 'ar',
  theme: LS.get('btw-theme') === 'dark' ? 'dark' : 'light',     // light is the default; dark is optional
  userId: null,
  busy: 0,
  route: { name: 'login' },
  modal: null,
  pf: {},             // per-page UI state
  dash: {},           // dashboard + report filters
  exam: null,         // running attempt
  examResult: null,
  examDraft: null,
  formErr: {},
  driveConsentSeen: false
};

/* ---------------- formatting ---------------- */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const L = o => (o ? (o[S.lang] || o.en || o.ar || '') : '');
const locale = () => (S.lang === 'ar' ? 'ar-SA-u-ca-gregory' : 'en-GB');
function fmtDate(v) {
  if (!v) return '';
  const d = new Date(v.length === 10 ? v + 'T12:00:00Z' : v);
  return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Riyadh' }).format(d);
}
function fmtDateTime(v) {
  if (!v) return '';
  return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Riyadh' }).format(new Date(v));
}
const fmtNum = n => (n == null ? '—' : new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(n));
const fmtPct = n => (n == null ? '—' : fmtNum(n) + (S.lang === 'ar' ? '٪' : '%'));
function fmtSize(b) {
  if (!b) return '—';
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0; let n = b;
  while (n >= 1024 && i < 3) { n /= 1024; i++; }
  return fmtNum(Math.round(n * 10) / 10) + ' ' + u[i];
}
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const userName = id => { const u = db.users.find(x => x.id === id); return u ? L(u.name) : (id === 'system' || !id ? t('system') : id); };
const locName = id => L((db.locations.find(l => l.id === id) || {}).name);
const teamName = id => L((db.teams.find(x => x.id === id) || {}).name);
const roleName = r => L(Core.ROLE_LABEL[r]);
const initials = n => String(n || '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();

/* ---------------- icons ---------------- */
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  book: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 21.5A2.5 2.5 0 0 1 6.5 19H20v3H6.5"/>',
  award: '<circle cx="12" cy="9" r="6"/><path d="m8.5 14-1.5 8 5-3 5 3-1.5-8"/>',
  check: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.2 9a3 3 0 0 1 5.6 1c0 2-3 2.5-3 4.5"/><path d="M12 18h.01"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15v3M12 10v8M17 6v12"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.8c1.6.8 2.6 2.5 3 5.2"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
  clipboard: '<rect x="5" y="4" width="14" height="18" rx="2"/><path d="M9 4V2.5h6V4"/><path d="m9 13 2 2 4-4"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  flag: '<path d="M4 22V3"/><path d="M4 4h13l-2 4 2 4H4"/>',
  shield: '<path d="M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5z"/><path d="m9 12 2 2 4-4"/>',
  pin: '<path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  chev: '<path d="m9 18 6-6-6-6"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  upload: '<path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M4 3h16"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  cup: '<path d="M4 9h13v5a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6z"/><path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H17"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>',
  play: '<path d="m7 4 13 8-13 8z"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  moon: '<path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 9.2-9.2M17 6l3 3M14 9l2 2"/>'
};
const icon = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;
const WORDMARK = '<span class="wordmark" aria-hidden="true"><b>BTW</b><i>/BY, THE, WAY/</i></span>';
const LOGO = WORDMARK;

/* ---------------- building blocks ---------------- */
const STATUS_TONE = {
  not_started: '', in_progress: 'accent', completed: 'good', overdue: 'warn', awaiting: 'ochre', draft: '', published: 'good', archived: '',
  active: 'good', inactive: 'bad', valid: 'good', revoked: 'bad', replaced: '', open: 'warn', resolved: 'good', passed: 'good',
  needs_practice: 'warn', not_assessed: '', succeeded: 'good', failed: 'bad', running: 'accent', ready: 'good', duplicate: 'warn', error: 'bad'
};
const pill = (status, label) => `<span class="pill ${STATUS_TONE[status] || ''}"><span class="dot"></span>${esc(label || t('st_' + status))}</span>`;
const rolePill = r => `<span class="pill ${r === 'staff' ? '' : r === 'area_manager' ? 'ochre' : 'accent'}">${esc(roleName(r))}</span>`;
function attrs(o) { return Object.entries(o || {}).filter(([, v]) => v !== undefined && v !== null && v !== false).map(([k, v]) => (v === true ? k : `${k}="${esc(v)}"`)).join(' '); }
function dataAttrs(d) { return Object.entries(d || {}).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' '); }
function btn(label, act, o = {}) {
  const cls = ['btn', o.kind || '', o.sm ? 'sm' : '', o.block ? 'block' : ''].join(' ');
  return `<button type="${o.type || 'button'}" class="${cls}" ${act ? `data-act="${act}"` : ''} ${dataAttrs(o.data)} ${attrs({ disabled: o.disabled, 'aria-label': o.aria, id: o.id })}>${o.icon ? icon(o.icon, 'sm') : ''}${label ? `<span>${esc(label)}</span>` : ''}</button>`;
}
function lockReason(code) {
  const u = currentUser();
  if (code === 'forbidden_role') return u && u.role === 'area_manager' ? t('lock_grant') : t('lock_role');
  if (code === 'forbidden_scope') return t('lock_scope');
  if (code === 'forbidden_rank') return t('lock_rank');
  return t('lock_role');
}
// A guarded button: works when the server-side rule would allow it, otherwise a visibly locked button that explains why.
function gbtn(perm, ctx, label, act, o = {}) {
  const r = api.check(S.userId, perm, ctx || {});
  if (r.ok) return btn(label, act, o);
  const reason = lockReason(r.code);
  return `<button type="button" class="btn ${o.sm ? 'sm' : ''}" aria-disabled="true" data-act="explainLock" data-reason="${esc(reason)}" title="${esc(reason)}">${icon('lock', 'sm')}<span>${esc(label)}</span></button>`;
}
const can = (perm, ctx) => api.check(S.userId, perm, ctx || {}).ok;
const canAny = perms => perms.some(p => can(p));
function field(label, control, o = {}) {
  return `<label class="field" ${o.full ? 'style="grid-column:1/-1"' : ''}><span>${esc(label)}${o.opt ? ` <small>(${t('optional')})</small>` : ''}</span>${control}${o.hint ? `<small>${esc(o.hint)}</small>` : ''}${o.err ? `<span class="err">${esc(o.err)}</span>` : ''}</label>`;
}
const input = (name, value, o = {}) => `<input class="input" name="${name}" ${attrs({ id: o.id || 'f-' + name, value: value == null ? '' : value, type: o.type || 'text', placeholder: o.ph, required: o.req, min: o.min, max: o.max, dir: o.dir, disabled: o.disabled, 'aria-invalid': o.invalid ? 'true' : null, autocomplete: o.ac || 'off', inputmode: o.im, 'data-on-input': o.onInput, 'data-bind': o.bind, step: o.step })}>`;
function select(name, options, value, o = {}) {
  return `<select class="input" name="${name}" ${attrs({ id: o.id || 'f-' + name, disabled: o.disabled, 'data-on-change': o.onChange, 'data-bind': o.bind })}>${options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
}
const textarea = (name, value, o = {}) => `<textarea class="input" name="${name}" ${attrs({ id: o.id || 'f-' + name, rows: o.rows || 3, dir: o.dir, disabled: o.disabled, placeholder: o.ph, 'data-bind': o.bind })}>${esc(value || '')}</textarea>`;
const checkbox = (name, checked, label, o = {}) => `<label class="check ${o.disabled ? 'disabled' : ''}"><input type="checkbox" name="${name}" ${attrs({ checked: !!checked, disabled: o.disabled, value: o.value, 'data-bind': o.bind, 'data-on-change': o.onChange, id: o.id })}><span>${label}</span></label>`;
const empty = (msg, ic = 'info') => `<div class="empty">${icon(ic)}<span>${esc(msg)}</span></div>`;
function pageHead(title, sub, actions) {
  return `<div class="page-head"><div class="grow"><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div>${actions ? `<div class="row">${actions}</div>` : ''}</div>`;
}
const backLink = (route, params) => `<button class="back" data-act="go" data-r="${route}" ${dataAttrs(params)}>${icon('back', 'flip sm')}${t('back')}</button>`;
function bar(p, cls = '') { return `<div class="bar ${cls}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p || 0)}"><i style="width:${Math.max(0, Math.min(100, p || 0))}%"></i></div>`; }
function table(cols, rows, o = {}) {
  return `<div class="table-wrap"><table ${o.cls ? `class="${o.cls}"` : ''}><thead><tr>${cols.map(c => `<th ${c.num ? 'class="num"' : ''} scope="col">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${cols.length}">${empty(o.empty || t('no_data'))}</td></tr>`}</tbody></table></div>`;
}

/* ---------------- errors and calls ---------------- */
function errMsg(e) {
  if (!e || !e.code) return (e && e.message) || t('err_invalid');
  if (e.code === 'invalid') {
    if (S.lang === 'en' && e.message && e.message !== 'invalid') return e.message;
    return t('err_invalid');
  }
  const k = 'err_' + e.code;
  return I18N.has(k) ? t(k) : (e.message || e.code);
}
// Runs one action. On the live site the action goes to the server; the page waits (and blocks
// double clicks) until the answer comes back, unless `quiet` is set for background updates.
async function call(fn, okMsg, o = {}) {
  if (!o.quiet) busy(1);
  try {
    const r = await fn();
    persist();
    if (okMsg) toast(okMsg, 'good');
    return r === undefined || r === null ? true : r;
  } catch (e) {
    if (e && e.code === 'invalid' && e.detail && !Array.isArray(e.detail)) S.formErr = e.detail;
    toast(errMsg(e), 'bad');
    if (!(e instanceof Core.ApiError)) console.error(e);
    return undefined;
  } finally { if (!o.quiet) busy(-1); }
}
// Reads that run while drawing a page.
function readSafe(fn) { try { return fn(); } catch (e) { toast(errMsg(e), 'bad'); return undefined; } }
function busy(n) {
  S.busy = Math.max(0, S.busy + n);
  const v = document.getElementById('busy');
  if (v) v.hidden = S.busy === 0;
  document.documentElement.toggleAttribute('aria-busy', S.busy > 0);
}
function toast(msg, kind = '') {
  const box = document.getElementById('toasts'); if (!box) return;
  const el = document.createElement('div');
  el.className = 'toast ' + kind; el.setAttribute('role', kind === 'bad' ? 'alert' : 'status');
  el.innerHTML = `${icon(kind === 'bad' ? 'alert' : kind === 'good' ? 'check' : 'info', 'sm')}<span>${esc(msg)}</span>`;
  box.appendChild(el);
  setTimeout(() => el.remove(), kind === 'bad' ? 6000 : 3500);
}

/* ---------------- session ---------------- */
let _meCache = null;
function currentUser() { return S.userId ? db.users.find(u => u.id === S.userId && u.status === 'active' && !u.stub) : null; }
function me() { if (!_meCache) _meCache = api.me(S.userId); return _meCache; }
function signIn(id) {
  S.userId = id; if (!LIVE) LS.set('btw-user', id); _meCache = null;
  const u = currentUser();
  if (u && !LS.get('btw-lang')) S.lang = u.lang || 'ar';
  go(u && me().mustChange ? 'firstPassword' : 'home');
}
function signOut(prefill) {
  if (LIVE) { Net.setToken(null); db = publicDb(PUB); api = makeApi(); }
  else LS.del('btw-user');
  S.userId = null; _meCache = null; S.modal = null; S.loginPw = null; S.exam = null; S.examResult = null;
  S.pf = {}; S.pf.login = prefill || {};
  go('login');
}

/* ---------------- navigation ---------------- */
const NAV = [
  { group: 'nav_learn', items: [
    { r: 'home', icon: 'home', label: 'home' },
    { r: 'training', icon: 'book', label: 'training' },
    { r: 'certs', icon: 'award', label: 'certificates' },
    { r: 'skills', icon: 'check', label: 'skills' },
    { r: 'help', icon: 'help', label: 'help_short' }
  ] },
  { group: 'nav_manage', items: [
    { r: 'dashboard', icon: 'chart', label: 'dashboard', any: ['reports.view'] },
    { r: 'people', icon: 'users', label: 'people', any: ['users.view'] },
    { r: 'courses', icon: 'layers', label: 'courses', any: ['content.edit', 'content.publish', 'files.manage', 'exams.manage', 'assign.manage'] },
    { r: 'assign', icon: 'send', label: 'assign', any: ['assign.manage'] },
    { r: 'signoffs', icon: 'clipboard', label: 'signoffs', any: ['signoff.manage'] },
    { r: 'certsAdmin', icon: 'award', label: 'certs_manage', any: ['certs.view'] },
    { r: 'reports', icon: 'download', label: 'reports', any: ['reports.export'] },
    { r: 'reminders', icon: 'bell', label: 'reminders', any: ['reminders.manage'] },
    { r: 'issues', icon: 'flag', label: 'issues', any: ['issues.manage'], count: () => db.issues.filter(i => i.status === 'open').length }
  ] },
  { group: 'nav_admin', items: [
    { r: 'access', icon: 'shield', label: 'access', any: ['access.grant', 'users.role'] },
    { r: 'locations', icon: 'pin', label: 'locations', any: ['org.manage'] },
    { r: 'settings', icon: 'gear', label: 'settings', any: ['settings.training', 'settings.kpi', 'settings.system'] },
    { r: 'data', icon: 'db', label: 'data', any: ['data.backup'] },
    { r: 'audit', icon: 'list', label: 'audit', any: ['audit.view'] }
  ] }
];
const ROUTE_PERMS = {};
NAV.forEach(g => g.items.forEach(i => { if (i.any) ROUTE_PERMS[i.r] = i.any; }));
Object.assign(ROUTE_PERMS, {
  person: ['users.view'], personEdit: ['users.edit'], import: ['users.import'], courseEdit: ROUTE_PERMS.courses,
  sectionEdit: ROUTE_PERMS.courses, examEdit: ['exams.manage']
});
const navAllowed = item => !item.any || canAny(item.any);
const PARENT = { course: 'training', section: 'training', exam: 'training', examResult: 'training', cert: 'certs', person: 'people', personEdit: 'people', import: 'people', courseEdit: 'courses', sectionEdit: 'courses', examEdit: 'courses', notifications: 'home', profile: 'home', verify: 'home', privacy: 'home', more: 'more' };

function go(name, params = {}) {
  if (S.route.name === 'exam' && name !== 'exam' && name !== 'examResult') stopTimer();
  S.route = { name, ...params };
  S.formErr = {};
  render();
  try { window.scrollTo({ top: 0 }); } catch (e) { window.scrollTo(0, 0); }
}

function navHtml() {
  const cur = PARENT[S.route.name] || S.route.name;
  return NAV.map(g => {
    const items = g.items.filter(navAllowed);
    if (!items.length) return '';
    return `<nav class="nav-group" aria-label="${esc(t(g.group))}"><div class="eyebrow">${t(g.group)}</div>${items.map(i => {
      const n = i.count ? i.count() : 0;
      return `<button class="nav-item" data-act="go" data-r="${i.r}" ${cur === i.r ? 'aria-current="page"' : ''}>${icon(i.icon)}<span>${t(i.label)}</span>${n ? `<span class="count">${fmtNum(n)}</span>` : ''}</button>`;
    }).join('')}</nav>`;
  }).join('');
}

function bottomItems() {
  const m = me();
  const manageItems = NAV[1].items.filter(navAllowed);
  const items = [NAV[0].items[0]];
  if (manageItems.length) items.push(...manageItems.slice(0, 3));
  else items.push(NAV[0].items[1], NAV[0].items[2], NAV[0].items[4]);
  items.push({ r: 'more', icon: 'menu', label: 'more' });
  return items.filter(Boolean).slice(0, 5);
}
function bottomBar() {
  const cur = PARENT[S.route.name] || S.route.name;
  const items = bottomItems();
  const inBar = items.some(i => i.r === cur);
  return `<nav class="bottombar" aria-label="${esc(t('more'))}">${items.map(i => `<button data-act="go" data-r="${i.r}" ${(cur === i.r || (i.r === 'more' && !inBar)) ? 'aria-current="page"' : ''}>${icon(i.icon)}<span>${t(i.label)}</span></button>`).join('')}</nav>`;
}

function header() {
  const u = currentUser();
  const unread = u ? db.notifications.filter(n => n.userId === u.id && !n.readAt).length : 0;
  return `<header class="topbar"><div class="topbar-in">
    <button class="brand" data-act="go" data-r="${u ? 'home' : 'login'}" aria-label="${esc(L(db.settings.business) + ' · ' + t('app_name'))}">${WORDMARK}<span class="brand-name">${t('app_name')}<span class="brand-sub">${esc(L(db.settings.business))}</span></span></button>
    <span class="spacer"></span>
    ${u ? `<button class="icon-btn" data-act="openSearch" aria-label="${esc(t('search'))}">${icon('search')}</button>
    <button class="icon-btn" data-act="go" data-r="notifications" aria-label="${esc(t('notifications'))}">${icon('bell')}${unread ? `<span class="badge">${unread > 9 ? '9+' : fmtNum(unread)}</span>` : ''}</button>` : ''}
    ${prefButtons()}
    ${u ? `<button class="who" data-act="openAccount" aria-label="${esc(L(u.name))}"><span class="avatar">${esc(initials(u.name.en))}</span><span class="who-text"><b>${esc(L(u.name))}</b><span>${esc(roleName(u.role))}</span></span></button>` : ''}
  </div></header>`;
}
// Theme (light by default, dark optional) sits right beside the language button.
function prefButtons() {
  const dark = S.theme === 'dark';
  return `<span class="prefs"><button class="icon-btn theme-btn" data-act="toggleTheme" aria-pressed="${dark}" aria-label="${esc(dark ? t('light_mode') : t('dark_mode'))}" title="${esc(dark ? t('light_mode') : t('dark_mode'))}">${icon(dark ? 'sun' : 'moon')}</button><button class="icon-btn lang-btn" data-act="toggleLang" lang="${S.lang === 'ar' ? 'en' : 'ar'}">${t('language')}</button></span>`;
}
// The trial copy says so on every page; the live site needs no banner.
const ribbon = () => (LIVE ? '' : `<div class="ribbon"><b>${t('local_mode')}</b><span class="ribbon-note">${t('local_mode_note')}</span></div>`);

/* ---------------- rendering ---------------- */
const PAGES = {};      // filled by the page modules
const MODALS = {};
const AFTER = [];      // post-render hooks

function render() {
  _meCache = null;
  I18N.setLang(S.lang);
  const root = document.documentElement;
  root.lang = S.lang; root.dir = S.lang === 'ar' ? 'rtl' : 'ltr';
  root.setAttribute('data-theme', S.theme === 'dark' ? 'dark' : 'light');
  document.title = 'BTW · ' + t('app_name');

  const active = document.activeElement;
  const focusId = active && active.id && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') ? active.id : null;
  const caret = focusId ? active.selectionStart : null;

  const app = document.getElementById('app');
  const u = currentUser();
  if (!u && S.userId) { S.userId = null; LS.del('btw-user'); }
  let body;
  const r = S.route.name;
  const publicRoutes = ['login', 'verify', 'privacy', 'setup', 'recover'];
  if (!u && !publicRoutes.includes(r)) S.route = { name: 'login' };
  // A new installation starts with creating the Administrator.
  if (!u && needsSetup() && !['setup', 'privacy'].includes(S.route.name)) S.route = { name: 'setup' };
  if (!u && !needsSetup() && S.route.name === 'setup') S.route = { name: 'login' };
  // A temporary password set by a manager must be replaced before anything else.
  if (u && me().mustChange && S.route.name !== 'firstPassword') S.route = { name: 'firstPassword' };
  const page = PAGES[S.route.name] || PAGES.home;
  let content;
  try {
    const need = ROUTE_PERMS[S.route.name];
    content = u && need && !canAny(need) ? notAllowed() : page();
  } catch (e) {
    if (e instanceof Core.ApiError) content = `<div class="page">${backLink('home')}<div class="card">${empty(errMsg(e), 'lock')}</div></div>`;
    else { console.error(e); content = `<div class="page"><div class="card">${empty(String(e.message || e), 'alert')}</div></div>`; }
  }
  if (!u || S.route.name === 'firstPassword') body = `${ribbon()}${['login', 'firstPassword', 'setup', 'recover'].includes(S.route.name) ? content : `${header()}<main class="main" id="main">${content}</main>`}`;
  else if (S.route.name === 'cards') body = `${ribbon()}${content}`;
  else body = `${ribbon()}${header()}<div class="layout"><aside class="rail">${navHtml()}</aside><main class="main" id="main">${content}</main></div>${bottomBar()}`;
  app.innerHTML = body + `<div id="busy" class="busy-veil" ${S.busy ? '' : 'hidden'}><span class="spinner" aria-hidden="true"></span></div>`;
  renderModal();
  if (focusId) { const el = document.getElementById(focusId); if (el) { el.focus(); try { if (caret != null) el.setSelectionRange(caret, caret); } catch (e) { /* not a text input */ } } }
  AFTER.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
}
function notAllowed() {
  return `<div class="page">${backLink('home')}<div class="card"><div class="empty">${icon('lock')}<b>${esc(lockReason('forbidden_role'))}</b><span>${t('server_checked')}</span></div></div></div>`;
}

function renderModal() {
  const host = document.getElementById('modal-root');
  if (!S.modal) { host.innerHTML = ''; return; }
  const fn = MODALS[S.modal.kind];
  if (!fn) { host.innerHTML = ''; return; }
  const m = fn(S.modal);
  host.innerHTML = `<div class="scrim" data-act="scrim"><div class="modal ${m.wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="modal-h"><h2 id="modal-title" class="grow">${esc(m.title)}</h2><button class="icon-btn" data-act="closeModal" aria-label="${esc(t('close'))}">${icon('x')}</button></div>
    <div class="modal-b">${m.body}</div>${m.foot ? `<div class="modal-f">${m.foot}</div>` : ''}</div></div>`;
  const first = host.querySelector('[autofocus], .modal-b input:not([type=checkbox]):not([type=radio]), .modal-b textarea, .modal-b select, .modal-f .btn.primary');
  if (first) setTimeout(() => first.focus(), 20);
}
function openModal(kind, data = {}) { S.modal = { kind, ...data }; S.formErr = {}; renderModal(); }
function closeModal() { S.modal = null; renderModal(); }

/* ---------------- events ---------------- */
const A = {};   // click actions
const F = {};   // form submit handlers
const C = {};   // change handlers
const I = {};   // input handlers

function formData(form) {
  const o = {};
  new FormData(form).forEach((v, k) => {
    if (k in o) { o[k] = [].concat(o[k], v); } else o[k] = v;
  });
  form.querySelectorAll('input[type=checkbox][name]').forEach(cb => { if (!(cb.name in o) && !cb.value) o[cb.name] = false; if (cb.checked && cb.value === 'on') o[cb.name] = true; });
  return o;
}
function setPath(obj, path, val) {
  const ks = path.split('.');
  let o = obj;
  ks.slice(0, -1).forEach(k => { o = o[isNaN(k) ? k : Number(k)]; });
  o[ks[ks.length - 1]] = val;
}

const NAV_ACTS = new Set(['go', 'closeModal', 'scrim', 'toggleLang', 'toggleTheme', 'togglePw', 'explainLock']);
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  if (S.busy && !NAV_ACTS.has(el.dataset.act)) { e.preventDefault(); return; }
  if (el.dataset.act === 'scrim' && e.target !== el) return;
  const fn = A[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el.dataset, el, e); }
});
document.addEventListener('submit', e => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  if (S.busy) return;
  const fn = F[form.dataset.form];
  if (fn) fn(formData(form), form);
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset && el.dataset.bind && S.bindTarget) {
    setPath(S.bindTarget(), el.dataset.bind, el.type === 'checkbox' ? el.checked : el.value);
  }
  const name = el.dataset && el.dataset.onChange;
  if (name && C[name]) C[name](el.type === 'checkbox' ? el.checked : el.value, el);
});
let inputTimer = null;
document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset && el.dataset.bind && S.bindTarget && el.type !== 'checkbox' && el.type !== 'radio') setPath(S.bindTarget(), el.dataset.bind, el.value);
  const name = el.dataset && el.dataset.onInput;
  if (name && I[name]) { clearTimeout(inputTimer); inputTimer = setTimeout(() => I[name](el.value, el), 220); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.modal) { closeModal(); }
});

A.go = d => { const { r, ...rest } = d; const p = {}; Object.keys(rest).forEach(k => { if (!['act'].includes(k)) p[k] = rest[k]; }); go(r, p); };
A.closeModal = () => closeModal();
A.scrim = () => closeModal();
A.explainLock = d => toast(d.reason + ' · ' + t('server_checked'));
A.toggleLang = () => { S.lang = S.lang === 'ar' ? 'en' : 'ar'; LS.set('btw-lang', S.lang); render(); };
A.toggleTheme = () => { S.theme = S.theme === 'dark' ? 'light' : 'dark'; LS.set('btw-theme', S.theme); render(); };
A.togglePw = (d, el) => {
  const inp = el.parentElement.querySelector('input'); if (!inp) return;
  inp.type = inp.type === 'password' ? 'text' : 'password';
  el.setAttribute('aria-label', inp.type === 'password' ? t('show_password') : t('hide_password'));
  el.innerHTML = icon(inp.type === 'password' ? 'eye' : 'x', 'sm');
};
A.openAccount = () => openModal('account');
A.signOut = () => signOut();
A.confirmOk = () => { const m = S.modal; if (m && m.onOk) m.onOk(); };
A.openSearch = () => openModal('search', { q: '' });

MODALS.confirm = m => ({
  title: m.title,
  body: `<p>${esc(m.body || '')}</p>${m.extra || ''}`,
  foot: `${btn(t('cancel'), 'closeModal')}${btn(m.ok || t('save'), 'confirmOk', { kind: m.danger ? 'danger' : 'primary' })}`
});

MODALS.account = () => {
  const u = currentUser();
  return {
    title: L(u.name),
    body: `<div class="row">${rolePill(u.role)}<span class="muted small">${esc(locName(u.locationId))}${u.teamId ? ' · ' + esc(teamName(u.teamId)) : ''}</span></div>
      <p class="small muted mono" dir="ltr">${esc([u.code, u.email].filter(Boolean).join(' · '))}</p>
      <div class="row">${btn(t('profile'), 'go', { data: { r: 'profile' }, icon: 'users', sm: true })}${btn(t('privacy'), 'go', { data: { r: 'privacy' }, icon: 'shield', sm: true })}${btn(t('verify'), 'go', { data: { r: 'verify' }, icon: 'award', sm: true })}</div>`,
    foot: btn(t('sign_out'), 'signOut', { icon: 'logout' })
  };
};

MODALS.search = m => ({
  title: t('search'),
  wide: true,
  body: `<input class="input" id="search-q" placeholder="${esc(t('search_ph'))}" data-on-input="search" value="${esc(m.q || '')}" autofocus autocomplete="off"><p class="small muted">${t('search_hint')}</p><div id="search-results">${searchResults(m.q || '')}</div>`
});
I.search = v => { if (S.modal) S.modal.q = v; const box = document.getElementById('search-results'); if (box) box.innerHTML = searchResults(v); };
function searchResults(q) {
  if (!q || q.trim().length < 2) return '';
  const r = api.search(S.userId, q);
  const sec = (title, items) => (items.length ? `<div class="stack"><div class="eyebrow">${esc(title)}</div><div class="list">${items.join('')}</div></div>` : '');
  const html = [
    sec(t('people'), r.people.map(p => `<button class="li" data-act="searchGo" data-r="person" data-user-id="${p.id}"><span class="avatar">${esc(initials(p.name.en))}</span><span class="grow"><b>${esc(L(p.name))}</b><div class="small muted">${esc(roleName(p.role))} · ${esc(locName(p.locationId))}</div></span>${icon('chev', 'flip sm')}</button>`)),
    sec(t('courses'), r.courses.map(c => `<button class="li" data-act="searchGo" data-r="${c.manage ? 'courseEdit' : 'course'}" data-course-id="${c.id}">${icon('layers')}<span class="grow"><b>${esc(L(c.title))}</b><div class="small">${pill(c.status)}</div></span>${icon('chev', 'flip sm')}</button>`)),
    sec(t('course_sections'), r.sections.map(s => `<button class="li" data-act="searchGo" data-r="${s.manage ? 'sectionEdit' : 'section'}" data-course-id="${s.courseId}" data-section-id="${s.id}">${icon('book')}<span class="grow"><b>${esc(L(s.title))}</b><div class="small muted">${esc(L(s.course))}</div></span>${icon('chev', 'flip sm')}</button>`)),
    sec(t('certificates'), r.certificates.map(c => `<button class="li" data-act="searchGo" data-r="cert" data-cert-id="${c.id}">${icon('award')}<span class="grow"><b class="mono">${esc(c.no)}</b><div class="small muted">${esc(L(c.holder))} · ${esc(L(c.courseTitle))}</div></span>${pill(c.status)}</button>`))
  ].join('');
  return html || empty(t('no_results'));
}
A.searchGo = d => { closeModal(); const p = {}; if (d.userId) p.userId = d.userId; if (d.courseId) p.courseId = d.courseId; if (d.sectionId) p.sectionId = d.sectionId; if (d.certId) p.certId = d.certId; go(d.r, p); };

/* ---------------- downloads ---------------- */
async function saveFile(filename, data, mime) {
  if (DL) {
    try { await DL.save({ filename, data }); return true; }
    catch (e) { toast(e && e.code === 'declined' ? t('pdf_declined') : t('download_unavailable'), e && e.code === 'declined' ? '' : 'bad'); return false; }
  }
  if (!IN_ARTIFACT) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  }
  toast(t('download_unavailable'), 'bad');
  return false;
}
async function copyText(txt) {
  try { await navigator.clipboard.writeText(txt); toast(t('copied'), 'good'); }
  catch (e) { openModal('confirm', { title: t('copy_link'), body: '', extra: `<input class="input mono" value="${esc(txt)}" readonly onfocus="this.select()">`, ok: t('close'), onOk: closeModal }); }
}

// Password field with a show / hide button.
function pwInput(name, o = {}) {
  return `<span class="pw"><input class="input" type="password" name="${name}" ${attrs({ id: o.id || 'f-' + name, autocomplete: o.ac || 'new-password', 'aria-invalid': o.invalid ? 'true' : null, dir: 'ltr', value: o.value || null, required: o.req })}><button type="button" data-act="togglePw" aria-label="${esc(t('show_password'))}">${icon('eye', 'sm')}</button></span>`;
}
const pwErrText = c => (c ? t('field_err_' + c) : '');
