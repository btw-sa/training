/* ui-canvas.js — certificate and summary report drawn on canvas (handles Arabic shaping natively), then placed in a PDF.
   Styled on the BTW identity: off-white paper, black frame and wordmark, cream beige label, burnt orange and olive accents,
   the /BY, THE, WAY/ framing and the packaging grid. */
// Certificate links and QR codes open this site's check page: <site>/#verify=<number>.
function siteBase() {
  if (CFG.siteUrl) return String(CFG.siteUrl).replace(/[#?].*$/, '');
  try { if (/^https?:$/.test(location.protocol)) return location.origin + location.pathname; } catch (e) { /* sandboxed */ }
  return '';
}
const verifyUrl = no => (siteBase() || 'https://') + '#verify=' + encodeURIComponent(no);
const PRINT = { paper: '#F2F2EF', offwhite: '#EBECE9', ink: '#121314', cream: '#D1C7B8', orange: '#944823', olive: '#50694C', muted: '#5B5C59', line: '#CFCFC9', bad: '#A3261D' };
const FONT_D = '"Nunito Sans", "Tajawal", "Avenir Next", Avenir, sans-serif';
const FONT_B = '"Nunito Sans", "Tajawal", "Segoe UI", Tahoma, sans-serif';
const FONT_S = '"Literata", Georgia, serif';
const FONT_M = '"IBM Plex Mono", ui-monospace, Menlo, monospace';

let fontsPromise = null;
function fontsReady() {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  if (!fontsPromise) {
    fontsPromise = Promise.race([
      Promise.all(['900 120px "Nunito Sans"', '800 60px "Nunito Sans"', '600 30px "Nunito Sans"', '400 30px "Nunito Sans"', '800 60px "Tajawal"', '500 30px "Tajawal"',
        'italic 300 30px "Literata"', '500 30px "IBM Plex Mono"'].map(f => document.fonts.load(f, 'BTW Aa شهادة 123'))),
      new Promise(r => setTimeout(r, 3000))
    ]).catch(() => {});
  }
  return fontsPromise;
}
function fitFont(ctx, text, weight, size, family, maxW, style) {
  let s = size;
  ctx.font = `${style || ''} ${weight} ${s}px ${family}`;
  while (s > 14 && ctx.measureText(text).width > maxW) { s -= 2; ctx.font = `${style || ''} ${weight} ${s}px ${family}`; }
  return s;
}
function say(ctx, text, x, y, o) {
  ctx.save();
  ctx.direction = o.rtl ? 'rtl' : 'ltr';
  ctx.textAlign = o.align || 'center';
  ctx.fillStyle = o.color || PRINT.ink;
  if ('letterSpacing' in ctx) ctx.letterSpacing = o.track ? o.track + 'px' : '0px';
  if (o.max) fitFont(ctx, text, o.weight || 400, o.size, o.family || FONT_B, o.max, o.style);
  else ctx.font = `${o.style || ''} ${o.weight || 400} ${o.size}px ${o.family || FONT_B}`;
  ctx.fillText(text, x, y);
  ctx.restore();
}
const isAr = s => /[؀-ۿ]/.test(s || '');

// The packaging grid: thin black lines in a box.
function gridBox(ctx, x, y, w, h, cell, color, alpha) {
  ctx.save();
  ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.lineWidth = 1.5;
  for (let gx = x + cell; gx < x + w - 1; gx += cell) { ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx, y + h); ctx.stroke(); }
  for (let gy = y + cell; gy < y + h - 1; gy += cell) { ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x + w, gy); ctx.stroke(); }
  ctx.restore();
}

// Round stamp, like BTW's "COLD BREW COFFEE * MADE IN HOUSE AT BTW" seal.
function roundel(ctx, cx, cy, r, text) {
  ctx.save();
  ctx.strokeStyle = PRINT.ink; ctx.fillStyle = PRINT.ink; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.42, 0, Math.PI * 2); ctx.stroke();
  // asterisk in the middle
  ctx.lineWidth = 5; ctx.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI;
    ctx.beginPath(); ctx.moveTo(cx - Math.cos(a) * r * 0.24, cy - Math.sin(a) * r * 0.24); ctx.lineTo(cx + Math.cos(a) * r * 0.24, cy + Math.sin(a) * r * 0.24); ctx.stroke();
  }
  // text around the ring
  ctx.font = `800 ${Math.round(r * 0.17)}px ${FONT_D}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const chars = text.split('');
  const step = (Math.PI * 2) / chars.length;
  chars.forEach((ch, i) => {
    const a = -Math.PI / 2 + i * step;
    ctx.save();
    ctx.translate(cx + Math.cos(a) * r * 0.72, cy + Math.sin(a) * r * 0.72);
    ctx.rotate(a + Math.PI / 2);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  });
  ctx.restore();
}

function drawQr(ctx, text, x, y, size) {
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(x, y, size, size);
  if (!window.qrcode) { ctx.strokeStyle = PRINT.line; ctx.strokeRect(x, y, size, size); return; }
  const qr = window.qrcode(0, 'M'); qr.addData(text); qr.make();
  const n = qr.getModuleCount(); const cell = size / (n + 4);
  ctx.fillStyle = PRINT.ink;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(x + (c + 2) * cell, y + (r + 2) * cell, Math.ceil(cell), Math.ceil(cell));
}

async function drawCertificate(c, lang) {
  await fontsReady();
  const W = 2000, H = 1414;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const P = lang === 'ar' ? 'ar' : 'en', Q = P === 'ar' ? 'en' : 'ar';
  const rtl = P === 'ar';
  const X = x => (rtl ? W - x : x);                         // mirror the layout for Arabic
  const start = rtl ? 'right' : 'left';

  ctx.fillStyle = PRINT.paper; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = PRINT.ink; ctx.lineWidth = 14; ctx.strokeRect(34, 34, W - 68, H - 68);
  ctx.lineWidth = 2; ctx.strokeRect(62, 62, W - 124, H - 124);

  // cream label panel on the trailing side, with the packaging grid and the stamp
  const px = rtl ? 62 : W - 62 - 430, pw = 430;
  ctx.fillStyle = PRINT.cream; ctx.fillRect(px, 62, pw, H - 124);
  ctx.strokeStyle = PRINT.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(rtl ? px + pw : px, 62); ctx.lineTo(rtl ? px + pw : px, H - 62); ctx.stroke();
  roundel(ctx, px + pw / 2, 330, 150, 'BTW TRAINING * CERTIFIED BY THE WAY * ');
  gridBox(ctx, px + 55, 560, pw - 110, 280, 40, PRINT.ink, 0.55);
  ctx.fillStyle = PRINT.cream; ctx.fillRect(px + 95, 660, pw - 190, 80);
  ctx.strokeStyle = PRINT.ink; ctx.lineWidth = 2; ctx.strokeRect(px + 95, 660, pw - 190, 80);
  say(ctx, c.completedOn.slice(0, 4), px + pw / 2, 722, { size: 60, weight: 900, family: FONT_D, color: PRINT.ink });
  drawQr(ctx, verifyUrl(c.no), px + (pw - 230) / 2, 900, 230);
  say(ctx, rtl ? 'للتحقق · Check at' : 'Check at · للتحقق', px + pw / 2, 1180, { size: 22, weight: 600, color: PRINT.ink, rtl: false, max: pw - 60 });
  say(ctx, (siteBase() || '').replace(/^https?:\/\//, '').replace(/\/$/, '') || c.no, px + pw / 2, 1212, { size: 18, weight: 500, family: FONT_M, color: PRINT.ink, max: pw - 50 });

  // wordmark
  const x0 = X(140), maxW = 1290;
  say(ctx, 'BTW', x0, 250, { size: 150, weight: 900, family: FONT_D, align: start, track: 4 });
  say(ctx, '/BY, THE, WAY/', x0 + (rtl ? -6 : 6), 300, { size: 26, weight: 400, family: FONT_D, align: start, track: 9, color: PRINT.orange });

  const TITLE = { en: '/CERTIFICATE OF COMPLETION/', ar: 'شهادة إتمام' };
  say(ctx, TITLE[P], x0, 430, { size: P === 'ar' ? 54 : 34, weight: P === 'ar' ? 800 : 600, family: FONT_D, align: start, rtl, track: P === 'ar' ? 0 : 7, max: maxW });
  say(ctx, TITLE[Q], x0, 482, { size: Q === 'ar' ? 34 : 22, weight: 500, family: FONT_D, align: start, rtl: !rtl, color: PRINT.muted, track: Q === 'ar' ? 0 : 6, max: maxW });

  ctx.strokeStyle = PRINT.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0, 525); ctx.lineTo(rtl ? x0 - 180 : x0 + 180, 525); ctx.stroke();

  const nameP = c.holder[P] || c.holder.en, nameQ = c.holder[Q];
  say(ctx, nameP, x0, 640, { size: 104, weight: 800, family: FONT_D, align: start, rtl: isAr(nameP), max: maxW });
  if (nameQ && nameQ !== nameP) say(ctx, nameQ, x0, 708, { size: 44, weight: 500, family: FONT_D, align: start, rtl: isAr(nameQ), color: PRINT.muted, max: maxW });

  const line = db.settings.certificateLine || {};
  say(ctx, line[P] || '', x0, 800, P === 'ar'
    ? { size: 36, weight: 500, family: FONT_B, align: start, rtl: true, color: PRINT.muted, max: maxW }
    : { size: 36, weight: 300, family: FONT_S, style: 'italic', align: start, color: PRINT.muted, max: maxW });
  say(ctx, line[Q] || '', x0, 846, Q === 'ar'
    ? { size: 26, weight: 500, family: FONT_B, align: start, rtl: true, color: PRINT.muted, max: maxW }
    : { size: 26, weight: 300, family: FONT_S, style: 'italic', align: start, color: PRINT.muted, max: maxW });

  say(ctx, c.courseTitle[P], x0, 950, { size: 72, weight: 800, family: FONT_D, align: start, rtl, max: maxW });
  say(ctx, c.courseTitle[Q], x0, 1008, { size: 38, weight: 500, family: FONT_D, align: start, rtl: !rtl, color: PRINT.muted, max: maxW });

  // details row
  const L2 = (en, ar) => (P === 'ar' ? `${ar} · ${en}` : `${en} · ${ar}`);
  const dateStr = new Intl.DateTimeFormat(P === 'ar' ? 'ar-SA-u-ca-gregory' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Riyadh' }).format(new Date(c.completedOn + 'T12:00:00Z'));
  const cols = [
    { label: L2('Completion date', 'تاريخ الإكمال'), value: dateStr, font: FONT_D, rtl },
    { label: L2('Course version', 'نسخة الدورة'), value: P === 'ar' ? 'النسخة ' + new Intl.NumberFormat('ar-SA').format(c.version) : 'Version ' + c.version, font: FONT_D, rtl },
    { label: L2('Certificate ID', 'رقم الشهادة'), value: c.no, font: FONT_M, rtl: false }
  ];
  ctx.strokeStyle = PRINT.ink; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(X(140), 1110); ctx.lineTo(X(140 + 1290), 1110); ctx.stroke();
  cols.forEach((col, i) => {
    const cx = X(140 + i * 440);
    say(ctx, col.label, cx, 1160, { size: 21, weight: 600, color: PRINT.muted, align: start, rtl, max: 410 });
    say(ctx, col.value, cx, 1214, { size: 36, weight: 700, family: col.font, color: PRINT.ink, align: start, rtl: col.rtl, max: 410 });
  });
  say(ctx, `${c.business[P]} · ${c.business[Q]}`, X(140), 1290, { size: 22, weight: 600, color: PRINT.ink, align: start, rtl, max: maxW });

  if (c.status !== 'valid') {
    ctx.save(); ctx.translate(W / 2 - (rtl ? -200 : 200), H / 2); ctx.rotate(-0.36);
    ctx.globalAlpha = 0.16; ctx.fillStyle = PRINT.bad; ctx.textAlign = 'center';
    ctx.font = `900 200px ${FONT_D}`;
    ctx.fillText(c.status === 'revoked' ? (P === 'ar' ? 'ملغاة' : 'REVOKED') : (P === 'ar' ? 'مستبدلة' : 'REPLACED'), 0, 70);
    ctx.restore();
  }
  return cv;
}

async function drawSummary(k) {
  await fontsReady();
  const W = 1240, H = 1754, M = 80;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const rtl = S.lang === 'ar';
  const X = x => (rtl ? W - x : x);
  const al = a => (rtl ? (a === 'left' ? 'right' : a === 'right' ? 'left' : a) : a);
  ctx.fillStyle = PRINT.paper; ctx.fillRect(0, 0, W, H);
  // black header band with the wordmark, as on BTW's dark panels
  ctx.fillStyle = PRINT.ink; ctx.fillRect(0, 0, W, 210);
  gridBox(ctx, rtl ? 0 : W - 380, 0, 380, 210, 35, PRINT.offwhite, 0.18);
  say(ctx, 'BTW', X(M), 120, { size: 84, weight: 900, family: FONT_D, color: PRINT.offwhite, align: al('left'), track: 2 });
  say(ctx, '/BY, THE, WAY/', X(M + (rtl ? -2 : 2)), 160, { size: 18, weight: 400, family: FONT_D, color: '#C46A3C', align: al('left'), track: 6 });
  say(ctx, `${t('reports')} · ${fmtDate(new Date().toISOString())}`, X(W - M), 120, { size: 24, weight: 600, color: PRINT.offwhite, rtl, align: al('right'), max: 460 });
  const u = currentUser();
  const f = k.filters || {};
  const filt = [f.locationId && locName(f.locationId), f.teamId && teamName(f.teamId), f.userId && userName(f.userId), f.courseId && L((db.courses.find(c => c.id === f.courseId) || {}).title), f.from && `${t('from')} ${f.from}`, f.to && `${t('to')} ${f.to}`].filter(Boolean).join(' · ') || t('all');
  say(ctx, `${t('filter')}: ${filt}`, X(M), 268, { size: 20, color: PRINT.muted, rtl, align: al('left'), max: W - 2 * M });
  say(ctx, `${userName(u.id)} · ${roleName(u.role)} · ${t('in_view', { n: fmtNum(k.people) })}`, X(M), 298, { size: 20, color: PRINT.muted, rtl, align: al('left'), max: W - 2 * M });
  const tiles = [
    [t('kpi_completion'), fmtPct(k.completionRate.value), `${fmtNum(k.completionRate.num)} / ${fmtNum(k.completionRate.den)}`],
    [t('kpi_overdue'), fmtNum(k.overdue.value), `/ ${fmtNum(k.overdue.den)}`],
    [t('kpi_avg'), fmtPct(k.avgScore.value), `n = ${fmtNum(k.avgScore.n)}`],
    [t('kpi_pass'), fmtPct(k.passRate.value), `${fmtNum(k.passRate.num)} / ${fmtNum(k.passRate.den)}`],
    [t('kpi_first'), fmtPct(k.firstAttemptPass.value), `${fmtNum(k.firstAttemptPass.num)} / ${fmtNum(k.firstAttemptPass.den)}`],
    [t('kpi_retakes'), fmtNum(k.retakes.value), `/ ${fmtNum(k.retakes.attempts)}`],
    [t('kpi_days'), fmtNum(k.medianDays.value), `n = ${fmtNum(k.medianDays.n)}`],
    [t('kpi_signoffs'), fmtPct(k.signoffs.value), `${fmtNum(k.signoffs.passed)} / ${fmtNum(k.signoffs.total)}`]
  ];
  const tw = (W - 2 * M - 3 * 20) / 4, th = 150;
  tiles.forEach((tl, i) => {
    const col = i % 4, row = Math.floor(i / 4);
    const x0 = rtl ? W - M - (col + 1) * tw - col * 20 : M + col * (tw + 20);
    const y0 = 340 + row * (th + 20);
    ctx.fillStyle = i === 1 && k.overdue.value > 0 ? '#EFE0D6' : '#E4DED4'; ctx.fillRect(x0, y0, tw, th);
    ctx.strokeStyle = PRINT.ink; ctx.lineWidth = 1.5; ctx.strokeRect(x0, y0, tw, th);
    const tx = rtl ? x0 + tw - 18 : x0 + 18;
    say(ctx, tl[1], tx, y0 + 70, { size: 46, weight: 800, family: FONT_D, color: PRINT.ink, rtl, align: al('left') });
    say(ctx, tl[0], tx, y0 + 108, { size: 19, weight: 700, color: PRINT.ink, rtl, align: al('left'), max: tw - 30 });
    say(ctx, tl[2], tx, y0 + 134, { size: 17, color: PRINT.muted, rtl, align: al('left'), max: tw - 30 });
  });
  let y = 710;
  say(ctx, '/' + t('by_course') + '/', X(M), y, { size: 26, weight: 800, family: FONT_D, rtl, align: al('left') });
  y += 26;
  const cols = [[t('course'), 0], [t('assigned'), 520], [t('completed'), 660], [t('rate'), 800], [t('kpi_overdue'), 920], [t('avg'), 1040]];
  const row = (cells, yy, bold) => cells.forEach((cell, i) => say(ctx, String(cell), X(M + cols[i][1]), yy, { size: 19, weight: bold ? 700 : 400, color: bold ? PRINT.muted : PRINT.ink, rtl, align: al('left'), max: i === 0 ? 500 : 120 }));
  y += 30; row(cols.map(c => c[0]), y, true);
  ctx.strokeStyle = PRINT.ink; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(M, y + 12); ctx.lineTo(W - M, y + 12); ctx.stroke();
  k.byCourse.forEach(r => { y += 40; row([L(r.title), fmtNum(r.assigned), fmtNum(r.completed), fmtPct(r.rate), fmtNum(r.overdue), r.avgScore == null ? '—' : fmtPct(r.avgScore)], y); });
  y += 70;
  say(ctx, `/${t('support_title')}/ (${fmtNum(k.support.length)})`, X(M), y, { size: 26, weight: 800, family: FONT_D, rtl, align: al('left') });
  y += 34;
  say(ctx, t('support_sub', { n: fmtNum(k.thresholds.minSignals) }), X(M), y, { size: 17, color: PRINT.muted, rtl, align: al('left'), max: W - 2 * M });
  k.support.slice(0, 12).forEach(s => { y += 44; say(ctx, `${L(s.name)} — ${s.signals.map(sigText).join(' · ')}`, X(M), y, { size: 19, rtl, align: al('left'), max: W - 2 * M }); });
  ctx.fillStyle = PRINT.olive; ctx.fillRect(0, H - 24, W, 24);
  say(ctx, t('def_completion'), X(M), H - 60, { size: 15, color: PRINT.muted, rtl, align: al('left'), max: W - 2 * M });
  return cv;
}
