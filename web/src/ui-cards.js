/* ui-cards.js — product cards: PDF storage, uploads, and the in-app card viewer. */

/* ---------------- where card PDFs live ---------------- */
// Live site: a private Supabase Storage bucket, reached through short-lived signed links.
// Trial copy: this browser's IndexedDB (falls back to memory if the browser blocks it).
const CardStore = (() => {
  const mem = new Map();
  let dbp = null;
  function open() {
    if (!dbp) {
      dbp = new Promise((res, rej) => {
        try {
          const r = indexedDB.open('btw-cards', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('pdf');
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        } catch (e) { rej(e); }
      });
      dbp.catch(() => { /* memory fallback */ });
    }
    return dbp;
  }
  async function tx(mode, fn) {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction('pdf', mode);
      const req = fn(t.objectStore('pdf'));
      t.oncomplete = () => res(req ? req.result : undefined);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }
  return {
    async put(path, buf) { try { await tx('readwrite', st => st.put(buf, path)); } catch (e) { mem.set(path, buf); } },
    async get(path) { try { const v = await tx('readonly', st => st.get(path)); if (v) return v; } catch (e) { /* memory */ } return mem.get(path) || null; },
    async keep(used) {
      try {
        const keys = await tx('readonly', st => st.getAllKeys());
        const drop = (keys || []).filter(k => !used.has(k));
        if (drop.length) await tx('readwrite', st => { drop.forEach(k => st.delete(k)); return null; });
      } catch (e) { /* ignore */ }
      [...mem.keys()].forEach(k => { if (!used.has(k)) mem.delete(k); });
    },
    async clear() { try { await tx('readwrite', st => st.clear()); } catch (e) { /* ignore */ } mem.clear(); }
  };
})();
window.CardStore = CardStore;
function sweepLocalCards() { if (!LIVE && db) CardStore.keep(new Set(db.files.filter(f => f.path).map(f => f.path))); }

const randHex = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join('');
const MAX_PDF = 50 * 1024 * 1024;

// "01 - Espresso.pdf" → { n: 1, title: "Espresso" }. Arabic-Indic digits work too.
function parseCardName(name) {
  const base = String(name || '').replace(/\.pdf$/i, '').replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660)).replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
  const m = base.match(/^(\d{1,4})\s*[-–—.)\]:]?\s*(.*)$/);
  if (m && m[2]) return { n: Number(m[1]), title: m[2].trim() };
  return { n: m ? Number(m[1]) : null, title: base || 'Card' };
}
function sortCards(list) {
  return list.slice().sort((a, b) => (a.n == null) - (b.n == null) || (a.n || 0) - (b.n || 0) || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

// Sends the PDFs to storage and returns what addCards / replaceFile need.
async function uploadPdfs(sectionId, items, onProgress) {
  const out = [];
  if (LIVE) {
    for (let start = 0; start < items.length; start += 50) {
      const chunk = items.slice(start, start + 50);
      const { uploads } = await Net.op('uploadUrls', { sectionId, count: chunk.length });
      for (let i = 0; i < chunk.length; i++) {
        let res;
        try { res = await fetch(uploads[i].url, { method: 'PUT', headers: { 'Content-Type': 'application/pdf', 'x-upsert': 'false', apikey: CFG.publishableKey }, body: chunk[i].file }); }
        catch (e) { throw new Core.ApiError('upload_failed', 'Upload failed.'); }
        if (!res.ok) throw new Core.ApiError('upload_failed', 'Upload failed (' + res.status + ').');
        out.push({ path: uploads[i].path, title: chunk[i].title, size: chunk[i].file.size });
        if (onProgress) onProgress(out.length, items.length);
      }
    }
  } else {
    for (const it of items) {
      const path = `${sectionId}/${randHex(12)}.pdf`;
      await CardStore.put(path, await it.file.arrayBuffer());
      out.push({ path, title: it.title, size: it.file.size });
      if (onProgress) onProgress(out.length, items.length);
    }
  }
  return out;
}

/* ---------------- uploading (section editor) ---------------- */
A.pickCards = d => { const el = document.getElementById('card-files'); if (el) { el.dataset.section = d.section; el.dataset.replace = ''; el.multiple = true; el.value = ''; el.click(); } };
A.replaceCard = d => { const el = document.getElementById('card-files'); if (el) { el.dataset.section = d.section; el.dataset.replace = d.file; el.multiple = false; el.value = ''; el.click(); } };
C.cardFiles = (v, el) => {
  const all = Array.from(el.files || []);
  if (!all.length) return;
  const bad = all.filter(f => !/\.pdf$/i.test(f.name) && f.type !== 'application/pdf');
  const big = all.filter(f => f.size > MAX_PDF);
  const ok = all.filter(f => !bad.includes(f) && !big.includes(f));
  const items = sortCards(ok.map(f => ({ file: f, name: f.name, size: f.size, ...parseCardName(f.name) })));
  openModal('uploadCards', { sectionId: el.dataset.section, replace: el.dataset.replace || null, items, skipped: [...bad, ...big].map(f => f.name), progress: null });
};
MODALS.uploadCards = m => {
  const rows = m.items.map((it, i) => `<div class="li upload-row"><span class="card-n">${fmtNum(m.replace ? 1 : i + 1)}</span><span class="ftype pdf">PDF</span>
    <span class="grow stack" style="gap:2px;min-width:0"><input class="input" data-upload-title="${i}" value="${esc(it.title)}" aria-label="${esc(t('card_title'))}"><span class="tiny muted" dir="ltr" style="overflow-wrap:anywhere">${esc(it.name)} · ${esc(fmtSize(it.size))}</span></span>
    ${m.replace || m.progress ? '' : btn('', 'dropUpload', { sm: true, kind: 'ghost', icon: 'x', aria: t('remove'), data: { i } })}</div>`).join('');
  const prog = m.progress ? `<div class="stack" style="gap:6px"><div class="row between small"><b>${t('uploading')}</b><span class="num">${fmtNum(m.progress.done)} / ${fmtNum(m.progress.total)}</span></div>${bar((m.progress.done / Math.max(1, m.progress.total)) * 100)}</div>` : '';
  return {
    title: m.replace ? t('replace_card') : t('upload_cards'), wide: true,
    body: `${m.replace ? '' : `<p class="small muted">${t('upload_cards_hint')}</p>`}
      ${m.skipped.length ? `<div class="notice warn">${icon('alert')}<span class="small">${esc(t('upload_skipped', { n: fmtNum(m.skipped.length) }))}: <span dir="ltr">${esc(m.skipped.join(', '))}</span></span></div>` : ''}
      ${prog}<div class="list">${rows || empty(t('no_files'), 'file')}</div>`,
    foot: `${btn(t('cancel'), 'closeModal', { disabled: !!m.progress })}${btn(m.replace ? t('replace') : t('upload_n', { n: fmtNum(m.items.length) }), 'doUpload', { kind: 'primary', icon: 'upload', disabled: !m.items.length || !!m.progress })}`
  };
};
A.dropUpload = d => { const m = S.modal; readTitles(m); m.items.splice(Number(d.i), 1); renderModal(); };
function readTitles(m) { document.querySelectorAll('[data-upload-title]').forEach(inp => { const it = m.items[Number(inp.dataset.uploadTitle)]; if (it) it.title = inp.value.trim() || it.title; }); }
A.doUpload = async () => {
  const m = S.modal; if (!m || m.progress) return;
  readTitles(m);
  m.progress = { done: 0, total: m.items.length }; renderModal();
  let uploaded;
  try {
    uploaded = await uploadPdfs(m.sectionId, m.items, (done, total) => { if (S.modal === m) { m.progress = { done, total }; renderModal(); } });
  } catch (e) {
    toast(errMsg(e), 'bad'); m.progress = null; renderModal(); return;
  }
  const r = m.replace
    ? await call(() => api.replaceFile(S.userId, m.replace, uploaded[0]), t('saved'))
    : await call(() => api.addCards(S.userId, m.sectionId, uploaded));
  if (r) {
    if (!m.replace) toast(t('cards_added', { n: fmtNum(r.length) }), 'good');
    sweepLocalCards();
    closeModal(); render();
  } else { m.progress = null; renderModal(); }
};
A.renameCard = d => { const f = db.files.find(x => x.id === d.file); if (f) openModal('renameCard', { fileId: f.id, title: f.title }); };
MODALS.renameCard = m => ({
  title: t('rename'),
  body: `<form id="rename-form" data-form="renameCard">${field(t('card_title'), input('title', m.title))}</form>`,
  foot: `${btn(t('cancel'), 'closeModal')}<button class="btn primary" type="submit" form="rename-form">${t('save')}</button>`
});
F.renameCard = async d => { if (await call(() => api.renameFile(S.userId, S.modal.fileId, d.title), t('saved'))) { closeModal(); render(); } };

/* ---------------- PDF rendering ---------------- */
// pdf.js from jsDelivr (an exact copy of the npm package), including the fonts and character maps
// it needs for PDFs that do not embed their fonts.
const PDFJS_PKG = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/';
const PDFJS = PDFJS_PKG + 'build/';
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.crossOrigin = 'anonymous';
    s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
}
let pdfLibP = null;
// The worker script is loaded as a normal script, so pdf.js runs on the page itself (no separate
// worker file needed on GitHub Pages or inside the Claude preview).
function pdfLib() {
  if (!pdfLibP) {
    pdfLibP = (async () => {
      if (!window.pdfjsLib) await loadScript(PDFJS + 'pdf.min.js');
      if (!window.pdfjsWorker) await loadScript(PDFJS + 'pdf.worker.min.js');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
      return window.pdfjsLib;
    })();
    pdfLibP.catch(() => { pdfLibP = null; });
  }
  return pdfLibP;
}
const pdfDocs = new Map();   // fileId -> Promise<PDFDocumentProxy>
async function cardBytes(file) {
  if (!file.path) throw new Core.ApiError('not_found', 'This card has no PDF.');
  if (LIVE) {
    const { url } = await Net.op('cardUrl', { fileId: file.id });
    let res;
    try { res = await fetch(url); } catch (e) { throw new Core.ApiError('network', 'No connection.'); }
    if (!res.ok) throw new Core.ApiError('not_found', 'The card could not be loaded.');
    return new Uint8Array(await res.arrayBuffer());
  }
  const buf = await CardStore.get(file.path);
  if (!buf) throw new Core.ApiError('card_missing', 'This card is not stored in this browser.');
  return new Uint8Array(buf.slice ? buf.slice(0) : buf);
}
function cardDoc(file) {
  const key = file.id + ':' + (file.path || '');
  if (!pdfDocs.has(key)) {
    const p = (async () => { const lib = await pdfLib(); return lib.getDocument({ data: await cardBytes(file), isEvalSupported: false, standardFontDataUrl: PDFJS_PKG + 'standard_fonts/', cMapUrl: PDFJS_PKG + 'cmaps/', cMapPacked: true }).promise; })();
    p.catch(() => pdfDocs.delete(key));
    pdfDocs.set(key, p);
    if (pdfDocs.size > 30) { const [k0, p0] = pdfDocs.entries().next().value; pdfDocs.delete(k0); p0.then(d => d.destroy()).catch(() => {}); }
  }
  return pdfDocs.get(key);
}
let renderSeq = 0;
async function drawCard(file, host, zoom) {
  const seq = ++renderSeq;
  host.innerHTML = `<div class="viewer-wait"><span class="spinner" aria-hidden="true"></span><span>${esc(t('loading_card'))}</span></div>`;
  let doc;
  try { doc = await cardDoc(file); }
  catch (e) {
    if (seq !== renderSeq) return false;
    host.innerHTML = `<div class="viewer-wait">${icon('alert')}<span>${esc(errMsg(e))}</span>${btn(t('retry'), 'viewerRetry', { sm: true, icon: 'refresh' })}</div>`;
    return false;
  }
  if (seq !== renderSeq) return false;
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const W = Math.max(200, host.clientWidth - 8), H = Math.max(200, host.clientHeight - 8);
  const frag = document.createDocumentFragment();
  const jobs = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    if (seq !== renderSeq) return false;
    const base = page.getViewport({ scale: 1 });
    const fit = doc.numPages === 1 ? Math.min(W / base.width, H / base.height) : W / base.width;
    const vp = page.getViewport({ scale: fit * zoom * dpr });
    const c = document.createElement('canvas');
    c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    c.style.width = Math.floor(vp.width / dpr) + 'px'; c.style.height = Math.floor(vp.height / dpr) + 'px';
    c.dir = 'ltr';   // pdf.js draws glyph by glyph; an inherited right-to-left direction shifts letters
    c.setAttribute('role', 'img'); c.setAttribute('aria-label', file.title + (doc.numPages > 1 ? ` · ${p}/${doc.numPages}` : ''));
    frag.appendChild(c);
    jobs.push(page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise);
  }
  host.innerHTML = '';
  host.appendChild(frag);
  try { await Promise.all(jobs); } catch (e) { if (seq === renderSeq) console.error(e); return false; }
  return seq === renderSeq;
}

/* ---------------- the viewer ---------------- */
const VIEW = { zoom: 1, timers: {}, tick: null };

function viewerData() {
  const { courseId, sectionId } = S.route;
  const preview = String(S.route.preview || '') === '1';
  if (preview) {
    const v = api.getCourseManage(S.userId, courseId);
    const s = v.sections.find(x => x.id === sectionId);
    if (!s) throw new Core.ApiError('not_found');
    return { preview, course: v.course, section: s, files: s.files, viewed: new Set(s.files.map(f => f.id)), exam: null, done: false };
  }
  const v = api.learnerCourse(S.userId, courseId);
  const s = v.sections.find(x => x.id === sectionId);
  if (!s) throw new Core.ApiError('not_found');
  return { preview, course: v.course, section: s, files: s.files, viewed: new Set(s.viewed), exam: s.exam, done: s.done };
}

PAGES.cards = () => {
  const d = viewerData();
  const n = d.files.length;
  const back = d.preview ? { r: 'sectionEdit', 'section-id': d.section.id } : { r: 'section', 'course-id': d.course.id, 'section-id': d.section.id };
  const closeBtn = `<button class="icon-btn" data-act="go" ${dataAttrs(back)} aria-label="${esc(t('close_viewer'))}">${icon('x')}</button>`;
  if (!n) return `<div class="viewer"><header class="viewer-top">${closeBtn}<b class="grow">${esc(L(d.section.title))}</b></header><div class="viewer-stage">${empty(t('no_files'), 'file')}</div></div>`;
  if (String(S.route.finished || '') === '1' && !d.preview) return viewerDone(d, back);
  const i = Math.max(0, Math.min(n - 1, Number(S.route.i) || 0));
  const f = d.files[i];
  const seen = d.viewed.has(f.id);
  const count = d.files.filter(x => d.viewed.has(x.id)).length;
  const last = i === n - 1;
  const nextLabel = last ? (d.preview ? t('close') : t('finish_cards')) : t('next_card');
  return `<div class="viewer" data-file="${esc(f.id)}">
    <header class="viewer-top">${closeBtn}
      <div class="grow" style="min-width:0"><span class="eyebrow">${esc(L(d.section.title))}${d.preview ? ' · ' + esc(t('preview')) : ''}</span><b class="viewer-title">${esc(f.title)}</b></div>
      <span class="viewer-count" aria-label="${esc(t('card_of', { a: fmtNum(i + 1), b: fmtNum(n) }))}">${esc(t('card_of', { a: fmtNum(i + 1), b: fmtNum(n) }))}</span>
    </header>
    <div class="viewer-dots" aria-hidden="true">${d.files.map((x, j) => `<i class="${j === i ? 'cur' : ''} ${d.viewed.has(x.id) ? 'seen' : ''}"></i>`).join('')}</div>
    <main class="viewer-stage" id="viewer-stage" tabindex="-1"><div class="viewer-canvas" id="viewer-canvas" dir="ltr"></div></main>
    <footer class="viewer-bar">
      ${btn(t('prev_card'), 'cardGo', { data: { i: i - 1 }, disabled: i === 0, icon: 'back' })}
      <div class="row zoom" style="gap:4px">${btn('', 'zoom', { sm: true, kind: 'ghost', data: { z: -1 }, aria: t('zoom_out'), icon: 'minus' })}<span class="small num" id="zoom-label">${fmtPct(Math.round(VIEW.zoom * 100))}</span>${btn('', 'zoom', { sm: true, kind: 'ghost', data: { z: 1 }, aria: t('zoom_in'), icon: 'plus' })}</div>
      <button type="button" class="btn primary" id="viewer-next" data-act="cardNext" data-i="${i + 1}" ${seen || d.preview ? '' : 'disabled'}><span>${esc(nextLabel)}</span>${icon('chev', 'flip sm')}</button>
    </footer>
    <div class="viewer-foot small muted">${d.preview ? '' : esc(t('cards_seen', { a: fmtNum(count), b: fmtNum(n) }))}</div>
  </div>`;
};

function viewerDone(d, back) {
  const n = d.files.length;
  const x = d.exam;
  let cta;
  if (x && x.passed) cta = `${pill('passed', t('passed_label') + ' · ' + fmtPct(x.bestScore))}${btn(t('back_to_course'), 'go', { data: { r: 'course', 'course-id': d.course.id }, kind: 'primary' })}`;
  else if (x && x.canStart) cta = btn(x.attemptsUsed ? t('retake') : t('start_quiz'), 'startExam', { kind: 'primary', data: { exam: x.id }, icon: 'play' });
  else if (x) cta = `<span class="locked">${icon('lock')}${t('err_attempts_used')}</span>`;
  else cta = d.done ? btn(t('back_to_course'), 'go', { data: { r: 'course', 'course-id': d.course.id }, kind: 'primary' }) : btn(t('mark_done'), 'completeSection', { kind: 'primary', data: { section: d.section.id }, icon: 'check' });
  return `<div class="viewer"><header class="viewer-top"><button class="icon-btn" data-act="go" ${dataAttrs(back)} aria-label="${esc(t('close_viewer'))}">${icon('x')}</button><b class="grow">${esc(L(d.section.title))}</b></header>
    <div class="viewer-done"><span class="seal big">${icon('check')}</span><h1>${esc(t('cards_all_done', { n: fmtNum(n) }))}</h1>
      <p class="muted">${x ? esc(t('cards_quiz_next', { q: fmtNum(x.questionCount), p: fmtNum(x.passPct) })) : esc(t('cards_no_quiz'))}</p>
      <div class="row" style="justify-content:center">${cta}${btn(t('review_cards'), 'cardGo', { data: { i: 0 }, icon: 'back' })}</div></div></div>`;
}

A.cardGo = d => { const r = S.route; go('cards', { courseId: r.courseId, sectionId: r.sectionId, preview: r.preview || '', i: Math.max(0, Number(d.i) || 0) }); };
A.cardNext = d => {
  const r = S.route;
  const v = viewerData();
  const i = Number(d.i);
  if (i >= v.files.length) {
    if (v.preview) { go('sectionEdit', { sectionId: r.sectionId }); return; }
    if (v.files.every(f => v.viewed.has(f.id))) go('cards', { courseId: r.courseId, sectionId: r.sectionId, finished: '1' });
    else { const j = v.files.findIndex(f => !v.viewed.has(f.id)); toast(t('cards_left')); go('cards', { courseId: r.courseId, sectionId: r.sectionId, i: j }); }
    return;
  }
  go('cards', { courseId: r.courseId, sectionId: r.sectionId, preview: r.preview || '', i });
};
A.zoom = d => { VIEW.zoom = Math.max(0.5, Math.min(3, Math.round((VIEW.zoom + Number(d.z) * 0.25) * 100) / 100)); const lab = document.getElementById('zoom-label'); if (lab) lab.textContent = fmtPct(Math.round(VIEW.zoom * 100)); paintViewer(); };
A.viewerRetry = () => { pdfDocs.clear(); paintViewer(); };

function currentCard() {
  if (S.route.name !== 'cards' || String(S.route.finished || '') === '1') return null;
  try { const d = viewerData(); const i = Math.max(0, Math.min(d.files.length - 1, Number(S.route.i) || 0)); return { d, f: d.files[i], i }; } catch (e) { return null; }
}
// Draws the current card; the "seen" countdown starts only once the card is actually on screen.
async function paintViewer() {
  const c = currentCard(); const host = document.getElementById('viewer-canvas');
  if (!c || !c.f || !host) return;
  const ok = await drawCard(c.f, host, VIEW.zoom);
  if (ok) startCardTimer();
  const nx = c.d.files[c.i + 1];
  if (ok && nx && nx.path) cardDoc(nx).catch(() => {});   // load the next card ahead of time
}

// Each new card must stay on screen for the set number of seconds before it counts as seen.
function startCardTimer() {
  clearInterval(VIEW.tick); VIEW.tick = null;
  const c = currentCard();
  if (!c || !c.f || c.d.preview || c.d.viewed.has(c.f.id)) return;
  const need = Math.max(0, Number(db.settings.cardMinSeconds == null ? 5 : db.settings.cardMinSeconds));
  const key = c.f.id;
  VIEW.timers[key] = VIEW.timers[key] || Date.now();
  const nextBtn = document.getElementById('viewer-next');
  const label = nextBtn ? nextBtn.querySelector('span').textContent : '';
  let sending = false;
  const step = async () => {
    const cc = currentCard();
    const b = document.getElementById('viewer-next');
    if (!b || !cc || !cc.f || cc.f.id !== key) { clearInterval(VIEW.tick); VIEW.tick = null; return; }
    const left = Math.ceil((VIEW.timers[key] + need * 1000 - Date.now()) / 1000);
    if (left > 0) { b.disabled = true; b.querySelector('span').textContent = `${label} (${fmtNum(left)})`; return; }
    if (sending) return;
    sending = true;
    clearInterval(VIEW.tick); VIEW.tick = null;
    b.querySelector('span').textContent = label;
    const r = await call(() => api.markFileViewed(S.userId, key), null, { quiet: true });
    const c2 = currentCard();
    if (!c2 || !c2.f || c2.f.id !== key) return;
    const b2 = document.getElementById('viewer-next');
    if (r) {
      delete VIEW.timers[key];
      if (b2) b2.disabled = false;
      const dots = document.querySelectorAll('.viewer-dots i');
      if (dots[c2.i]) dots[c2.i].classList.add('seen');
      const foot = document.querySelector('.viewer-foot');
      if (foot) foot.textContent = t('cards_seen', { a: fmtNum(c2.d.files.filter(x => c2.d.viewed.has(x.id)).length), b: fmtNum(c2.d.files.length) });
    } else {
      // Not saved (no connection?): try again shortly; the card stays until it is recorded.
      if (b2) b2.querySelector('span').textContent = t('retrying');
      setTimeout(() => { if ((currentCard() || {}).f && currentCard().f.id === key) startCardTimer(); }, 4000);
    }
  };
  step();
  VIEW.tick = setInterval(step, 250);
}

let viewerKey = '';
AFTER.push(() => {
  if (S.route.name !== 'cards') { clearInterval(VIEW.tick); VIEW.tick = null; viewerKey = ''; document.documentElement.classList.remove('viewing'); return; }
  document.documentElement.classList.add('viewing');
  const c = currentCard();
  const key = c && c.f ? c.f.id + ':' + VIEW.zoom : '';
  clearInterval(VIEW.tick); VIEW.tick = null;
  paintViewer();
  if (key !== viewerKey) { viewerKey = key; const st = document.getElementById('viewer-stage'); if (st) st.focus({ preventScroll: true }); }
});
// Keyboard and swipe. "Next" follows the reading direction (left in Arabic, right in English).
document.addEventListener('keydown', e => {
  if (S.route.name !== 'cards' || S.modal || /INPUT|TEXTAREA|SELECT/.test((e.target || {}).tagName || '')) return;
  const rtl = document.documentElement.dir === 'rtl';
  const fwd = rtl ? 'ArrowLeft' : 'ArrowRight', bwd = rtl ? 'ArrowRight' : 'ArrowLeft';
  if (e.key === fwd) { const b = document.getElementById('viewer-next'); if (b && !b.disabled) b.click(); }
  else if (e.key === bwd) { const b = document.querySelector('.viewer-bar [data-act=cardGo]'); if (b && !b.disabled) b.click(); }
  else if (e.key === 'Escape') { const b = document.querySelector('.viewer-top [data-act=go]'); if (b) b.click(); }
});
let touch0 = null;
document.addEventListener('touchstart', e => { if (S.route.name === 'cards' && e.touches.length === 1 && VIEW.zoom <= 1) touch0 = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() }; else touch0 = null; }, { passive: true });
document.addEventListener('touchend', e => {
  if (!touch0 || S.route.name !== 'cards') return;
  const tch = e.changedTouches[0]; const dx = tch.clientX - touch0.x, dy = tch.clientY - touch0.y; const dt = Date.now() - touch0.t; touch0 = null;
  if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * 0.7 || dt > 800) return;
  const rtl = document.documentElement.dir === 'rtl';
  const forward = rtl ? dx > 0 : dx < 0;
  if (forward) { const b = document.getElementById('viewer-next'); if (b && !b.disabled) b.click(); }
  else { const b = document.querySelector('.viewer-bar [data-act=cardGo]'); if (b && !b.disabled) b.click(); }
}, { passive: true });
window.addEventListener('resize', () => { if (S.route.name === 'cards') { clearTimeout(VIEW.rz); VIEW.rz = setTimeout(paintViewer, 200); } });
