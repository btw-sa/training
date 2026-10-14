/* ui-learner.js — public pages and everything a staff member uses. */

/* ---------------- public ---------------- */
PAGES.login = () => {
  const pf = S.pf.login || (S.pf.login = {});
  const down = LIVE && !PUB;
  return `<div class="login"><div class="login-card">
    <div class="login-art">
      <span class="grid-motif" aria-hidden="true"></span>
      ${WORDMARK.replace('aria-hidden="true"', 'role="img" aria-label="BTW, by the way"')}
      <div class="stack" style="gap:10px"><h1>${t('login_title')}</h1><p class="serif" style="opacity:.9;max-width:36ch;font-size:1.05rem">${t('login_sub')}</p></div>
      <span class="eyebrow" style="color:inherit;opacity:.75">${t('app_name')}</span>
    </div>
    <form class="login-form" data-form="login" novalidate>
      <div class="row between"><h2>${t('sign_in')}</h2>${prefButtons()}</div>
      ${down ? `<div class="notice bad" role="alert">${icon('alert')}<span>${esc(!S.bootError || S.bootError.code === 'network' ? t('server_unreachable') : errMsg(S.bootError))}${S.bootError ? `<br><small class="mono" dir="ltr">${esc(S.bootError.message || S.bootError.code)}</small>` : ''}</span></div>` : ''}
      ${pf.error ? `<div class="notice bad" role="alert">${icon('alert')}<span>${esc(pf.error)}</span></div>` : ''}
      ${field(t('identifier'), input('identifier', pf.id || '', { id: 'f-identifier', ph: t('identifier_ph'), dir: 'ltr', ac: 'username', invalid: !!pf.error }))}
      ${field(t('password'), pwInput('password', { id: 'f-password', ac: 'current-password', value: pf.pw || '', invalid: !!pf.error }))}
      ${btn(t('sign_in'), null, { type: 'submit', kind: 'primary', block: true, icon: 'key' })}
      <p class="small muted">${t('login_help')}</p>
      <div class="row">${btn(t('verify_link'), 'go', { data: { r: 'verify' }, sm: true, kind: 'ghost', icon: 'award' })}${btn(t('privacy_link'), 'go', { data: { r: 'privacy' }, sm: true, kind: 'ghost', icon: 'shield' })}${LIVE ? btn(t('admin_recover_link'), 'go', { data: { r: 'recover' }, sm: true, kind: 'ghost', icon: 'lock' }) : ''}</div>
    </form></div></div>`;
};
F.login = async d => {
  busy(1);
  try {
    let r;
    if (LIVE) r = await Net.op('login', { identifier: d.identifier, password: d.password });
    else { r = api.login(d.identifier, d.password); persist(); }
    S.loginPw = r.mustChange ? d.password : null;   // kept in memory only, to confirm the temporary password once
    S.pf.login = {};
    signIn(LIVE ? db.meta.me : r.userId);
  } catch (e) {
    persist();
    S.pf.login = { id: d.identifier, error: errMsg(e) };
    render();
    const pw = document.getElementById('f-password'); if (pw) pw.focus();
  } finally { busy(-1); }
};

// First run: the owner creates the one Administrator account. On the live site this needs the
// setup code kept in Supabase, so nobody else can claim a new installation.
PAGES.setup = () => {
  const e = S.pf.setupErr || {};
  const err = k => (e[k] ? t('field_err_' + e[k]) : '');
  return `<div class="login"><div class="login-card" style="max-width:640px;grid-template-columns:1fr">
    <form class="login-form" data-form="setup" novalidate>
      <div class="row between">${WORDMARK}${prefButtons()}</div>
      <div class="stack" style="gap:6px"><span class="eyebrow">${t('setup_eyebrow')}</span><h2>${t('setup_title')}</h2><p class="muted">${LIVE ? t('setup_sub_live') : t('setup_sub_local')}</p></div>
      ${e._msg ? `<div class="notice bad" role="alert">${icon('alert')}<span>${esc(e._msg)}</span></div>` : ''}
      ${LIVE ? field(t('setup_code'), pwInput('code', { id: 'f-code', ac: 'off', invalid: !!e.code }), { hint: t('setup_code_hint'), err: e.code ? t('err_bad_setup_code') : '' }) : ''}
      <div class="form-grid">
        ${field(t('name') + ' · ' + t('arabic'), input('nameAr', S.pf.setupDraft && S.pf.setupDraft.nameAr, { dir: 'rtl', id: 'f-nameAr' }))}
        ${field(t('name') + ' · ' + t('english'), input('nameEn', S.pf.setupDraft && S.pf.setupDraft.nameEn, { dir: 'ltr', id: 'f-nameEn', invalid: !!e.nameEn }), { err: err('nameEn') })}
      </div>
      ${field(t('email'), input('email', S.pf.setupDraft && S.pf.setupDraft.email, { dir: 'ltr', type: 'email', ac: 'username', ph: 'name@btw.sa', id: 'f-email', invalid: !!e.email }), { err: err('email') })}
      ${field(t('password'), pwInput('password', { id: 'f-password', invalid: !!e.password }), { hint: t('setup_pw_hint'), err: err('password') })}
      ${field(t('confirm_password'), pwInput('confirm', { id: 'f-confirm' }))}
      ${btn(t('setup_btn'), null, { type: 'submit', kind: 'primary', block: true, icon: 'shield' })}
      <p class="small muted">${t('setup_note')}</p>
    </form></div></div>`;
};
F.setup = async d => {
  S.pf.setupDraft = { nameAr: d.nameAr, nameEn: d.nameEn, email: d.email };
  if (d.password !== d.confirm) { S.pf.setupErr = { password: 'pw_mismatch' }; render(); return; }
  const admin = { name: { en: d.nameEn, ar: d.nameAr }, email: d.email, password: d.password, lang: S.lang };
  busy(1);
  try {
    if (LIVE) { await Net.op('setup', { code: d.code, admin }); PUB = Object.assign({}, PUB, { needsSetup: false }); }
    else { const r = api.setupAdmin(admin); persist(); S.userId = r.userId; LS.set('btw-user', r.userId); }
    S.pf.setupErr = null; S.pf.setupDraft = null;
    toast(t('setup_done'), 'good');
    signIn(S.userId);
  } catch (e) {
    S.pf.setupErr = e.code === 'invalid' && e.detail ? { ...e.detail } : e.code === 'bad_setup_code' ? { code: true } : { _msg: errMsg(e) };
    render();
  } finally { busy(-1); }
};

// Lost Admin password (live site): reset it with the setup code from Supabase.
PAGES.recover = () => {
  const e = S.pf.recoverErr || '';
  return `<div class="login"><div class="login-card" style="max-width:560px;grid-template-columns:1fr">
    <form class="login-form" data-form="recover" novalidate>
      <div class="row between">${WORDMARK}${prefButtons()}</div>
      <div class="stack" style="gap:6px"><h2>${t('recover_title')}</h2><p class="muted">${t('recover_sub')}</p></div>
      ${e ? `<div class="notice bad" role="alert">${icon('alert')}<span>${esc(e)}</span></div>` : ''}
      ${field(t('setup_code'), pwInput('code', { id: 'f-code', ac: 'off' }))}
      ${field(t('email'), input('email', '', { dir: 'ltr', type: 'email', ac: 'username', id: 'f-email' }))}
      ${field(t('new_password'), pwInput('password', { id: 'f-password' }), { hint: t('setup_pw_hint') })}
      ${field(t('confirm_password'), pwInput('confirm', { id: 'f-confirm' }))}
      ${btn(t('recover_btn'), null, { type: 'submit', kind: 'primary', block: true, icon: 'key' })}
      ${btn(t('back'), 'go', { data: { r: 'login' }, kind: 'ghost', icon: 'back' })}
    </form></div></div>`;
};
F.recover = async d => {
  if (d.password !== d.confirm) { S.pf.recoverErr = t('field_err_pw_mismatch'); render(); return; }
  busy(1);
  try { await Net.op('recover', { code: d.code, email: d.email, password: d.password }); S.pf.recoverErr = ''; toast(t('password_changed'), 'good'); signIn(S.userId); }
  catch (e) { S.pf.recoverErr = e.detail && e.detail.password ? t('field_err_' + e.detail.password) : errMsg(e); render(); }
  finally { busy(-1); }
};

PAGES.firstPassword = () => {
  const u = currentUser();
  const e = S.pf.firstPwErr || '';
  return `<div class="login"><div class="login-card" style="max-width:560px;grid-template-columns:1fr">
    <form class="login-form" data-form="firstPassword" novalidate>
      <div class="row between">${WORDMARK}${prefButtons()}</div>
      <div class="stack" style="gap:6px"><h2>${t('first_pw_title')}</h2><p class="muted">${t('first_pw_sub')}</p></div>
      <div class="cred small">${esc(L(u.name))} · <span class="mono" dir="ltr">${esc(u.code || u.email)}</span></div>
      ${e ? `<div class="notice bad" role="alert">${icon('alert')}<span>${esc(e)}</span></div>` : ''}
      ${S.loginPw ? '' : field(t('current_password'), pwInput('current', { id: 'f-current', ac: 'current-password' }))}
      ${field(t('new_password'), pwInput('next', { id: 'f-next' }), { hint: t('pw_rules') })}
      ${field(t('confirm_password'), pwInput('confirm', { id: 'f-confirm' }))}
      ${btn(t('save_continue'), null, { type: 'submit', kind: 'primary', block: true, icon: 'check' })}
      ${btn(t('sign_out'), 'signOut', { kind: 'ghost', icon: 'logout' })}
    </form></div></div>`;
};
F.firstPassword = async d => {
  if (d.next !== d.confirm) { S.pf.firstPwErr = t('field_err_pw_mismatch'); render(); return; }
  busy(1);
  try {
    await api.changeOwnPassword(S.userId, S.loginPw || d.current, d.next);
    persist(); S.loginPw = null; S.pf.firstPwErr = ''; _meCache = null;
    toast(t('password_changed'), 'good'); go('home');
  } catch (err) {
    S.pf.firstPwErr = err.detail && err.detail.password ? t('field_err_' + err.detail.password) : errMsg(err);
    render();
  } finally { busy(-1); }
};

PAGES.verify = () => {
  const q = S.pf.verifyQ || '';
  const r = S.pf.verifyR;
  let res = '';
  if (r) {
    if (!r.found) res = `<div class="notice bad">${icon('alert')}<span>${t('verify_not_found')}</span></div>`;
    else {
      const tone = r.status === 'valid' ? 'good' : r.status === 'revoked' ? 'bad' : 'warn';
      res = `<div class="card stack"><div class="notice ${tone}">${icon(r.status === 'valid' ? 'check' : 'alert')}<b>${t('verify_found_' + r.status)}</b></div>
        <div class="form-grid">
          ${kv(t('cert_id'), `<span class="mono">${esc(r.no)}</span>`)}
          ${kv(t('holder'), esc(L(r.holderInitials)))}
          ${kv(t('course'), esc(L(r.courseTitle)))}
          ${kv(t('course_version'), esc(fmtNum(r.version)))}
          ${kv(t('completed_date'), esc(fmtDate(r.completedOn)))}
          ${kv(t('issued_by'), esc(L(r.business)))}
          ${r.revokedOn ? kv(t('st_revoked'), esc(fmtDate(r.revokedOn))) : ''}
        </div></div>`;
    }
  }
  return `<div class="page" style="max-width:720px">${S.userId ? backLink('home') : backLink('login')}
    ${pageHead(t('verify_title'), t('verify_sub'))}
    <form class="card stack" data-form="verify"><div class="row top"><div class="grow">${input('cert', q, { ph: (db.settings.certPrefix || 'BTW') + '-2026-XXXX-XXXX', dir: 'ltr' })}</div>${btn(t('verify_btn'), null, { type: 'submit', kind: 'primary', icon: 'search' })}</div><p class="tiny muted">${t('rate_note')}</p></form>
    ${res}</div>`;
};
F.verify = async d => {
  S.pf.verifyQ = d.cert;
  busy(1);
  try { S.pf.verifyR = LIVE ? await Net.op('verify', { no: d.cert || '' }) : api.verifyCertificate(d.cert || ''); }
  catch (e) { S.pf.verifyR = null; toast(errMsg(e), 'bad'); }
  finally { busy(-1); }
  render();
};
function kv(k, v) { return `<div class="stack" style="gap:2px"><span class="eyebrow">${esc(k)}</span><span>${v}</span></div>`; }

PAGES.privacy = () => `<div class="page" style="max-width:760px">${S.userId ? backLink('home') : backLink('login')}${pageHead(t('privacy'))}<div class="card"><p style="max-width:65ch">${esc(L(db.settings.privacy))}</p></div></div>`;

/* ---------------- home ---------------- */
function ring(p) {
  const r = 30, c = 2 * Math.PI * r, off = c * (1 - (p || 0) / 100);
  return `<svg class="ring" viewBox="0 0 76 76" role="img" aria-label="${fmtPct(p)}"><circle class="t" cx="38" cy="38" r="${r}"/><circle class="p" cx="38" cy="38" r="${r}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 38 38)"/><text x="38" y="44" text-anchor="middle">${esc(fmtNum(p))}${S.lang === 'ar' ? '٪' : '%'}</text></svg>`;
}
function statusOf(item) { return item.awaitingSignoff ? 'awaiting' : item.status; }
function dueLine(e, status) {
  if (e.completedAt) return t('completed_on', { date: fmtDate(e.completedAt) });
  if (status === 'overdue') return t('overdue_since', { date: fmtDate(e.dueOn) });
  return e.dueOn ? t('due_on', { date: fmtDate(e.dueOn) }) : '';
}
function courseCard(it) {
  const st = statusOf(it);
  return `<button class="course-card ${it.status === 'overdue' ? 'overdue' : ''}" data-act="go" data-r="course" data-course-id="${it.course.id}">
    <div class="row between top"><h3>${esc(L(it.course.title))}</h3>${pill(st === 'awaiting' ? 'awaiting' : it.status)}</div>
    <div class="row small muted"><span>${t('sections_done', { a: fmtNum(it.sectionsDone), b: fmtNum(it.sectionsTotal) })}</span><span>·</span><span>${esc(dueLine(it.enrollment, it.status))}</span></div>
    ${bar(it.percent, it.status === 'completed' ? 'ochre' : '')}</button>`;
}
function continueTarget(it) {
  if (it.nextSectionId) return { r: 'section', courseId: it.course.id, sectionId: it.nextSectionId, label: t('next_up', { section: L((db.sections.find(s => s.id === it.nextSectionId) || {}).title) }) };
  if (!it.finalPassed) return { r: 'course', courseId: it.course.id, label: t('final_next') };
  return { r: 'course', courseId: it.course.id, label: t('awaiting_signoff_next') };
}

PAGES.home = () => {
  const u = currentUser();
  const h = api.learnerHome(S.userId);
  const c = h.continueItem;
  let hero;
  if (c) {
    const tgt = continueTarget(c);
    hero = `<section class="hero-continue">${ring(c.percent)}<div class="stack" style="gap:8px"><span class="sub">${t('continue_training')}</span><h2>${esc(L(c.course.title))}</h2><span class="sub">${esc(tgt.label)} · ${esc(dueLine(c.enrollment, c.status))}</span><div>${btn(c.status === 'not_started' ? t('start') : t('resume'), 'go', { data: { r: tgt.r, 'course-id': tgt.courseId, 'section-id': tgt.sectionId || '' }, icon: 'play' })}</div></div></section>`;
  } else if (h.items.length) hero = `<div class="notice good">${icon('check')}<b>${t('all_done')}</b></div>`;
  else hero = '';
  const notes = h.notifications.filter(n => !n.readAt).slice(0, 4);
  const certs = h.certificates;
  const managerPanel = managerSnapshot();
  return `<div class="page">
    <div class="page-head"><div><span class="eyebrow">${esc(fmtDate(new Date().toISOString()))}</span><h1>${t('hello', { name: esc(L(u.name).split(' ')[0]) })}</h1></div></div>
    ${hero}
    ${managerPanel}
    <div class="grid2">
      <section class="stack"><div class="row between"><h2>${t('assigned_training')}</h2>${h.items.length ? btn(t('training'), 'go', { data: { r: 'training' }, sm: true, kind: 'ghost' }) : ''}</div>
        ${h.items.length ? h.items.slice(0, 4).map(courseCard).join('') : `<div class="card">${empty(t('no_training'), 'book')}</div>`}</section>
      <section class="stack">
        <div class="card stack"><div class="row between"><h2>${t('reminders_for_you')}</h2>${btn(t('notifications'), 'go', { data: { r: 'notifications' }, sm: true, kind: 'ghost' })}</div>
          ${notes.length ? `<div class="list">${notes.map(noteItem).join('')}</div>` : `<p class="muted small">${t('no_reminders')}</p>`}</div>
        <div class="card stack"><div class="row between"><h2>${t('certificate_status')}</h2>${certs.length ? btn(t('my_certificates'), 'go', { data: { r: 'certs' }, sm: true, kind: 'ghost' }) : ''}</div>
          ${certs.length ? certs.slice(-3).reverse().map(certMini).join('') : `<p class="muted small">${t('no_certs_yet')}</p>`}</div>
      </section>
    </div></div>`;
};
function managerSnapshot() {
  if (!can('reports.view')) return '';
  const k = api.kpis(S.userId, {});
  const m = me();
  const scope = m.scope.global ? t('scope_all') : [...m.scope.locations.map(locName), ...m.scope.teams.map(teamName)].join(' · ');
  return `<section class="card stack"><div class="row between"><div><h2>${t('dashboard')}</h2><p class="small muted">${esc(scope)}</p></div>${btn(t('dashboard'), 'go', { data: { r: 'dashboard' }, sm: true, icon: 'chart' })}</div>
    <div class="tiles">
      ${kpiTile('completion', fmtPct(k.completionRate.value), t('kpi_completion'), `${fmtNum(k.completionRate.num)} / ${fmtNum(k.completionRate.den)}`)}
      ${kpiTile('overdue', fmtNum(k.overdue.value), t('kpi_overdue'), '', k.overdue.value > 0)}
      ${kpiTile('pass', fmtPct(k.passRate.value), t('kpi_pass'), `${fmtNum(k.passRate.num)} / ${fmtNum(k.passRate.den)}`)}
      <div class="kpi ${k.support.length ? 'attention' : ''}"><span class="v">${fmtNum(k.support.length)}</span><span class="l">${t('support_title')}</span></div>
    </div></section>`;
}
function noteItem(n) {
  const link = n.link || '';
  const [kind, id] = link.split(':');
  const act = kind === 'course' ? `data-act="go" data-r="course" data-course-id="${id}"` : kind === 'cert' ? `data-act="go" data-r="cert" data-cert-id="${id}"` : kind === 'certs' ? `data-act="go" data-r="certs"` : '';
  return `<${act ? 'button' : 'div'} class="li" ${act}>${icon(n.kind === 'certificate' ? 'award' : n.kind === 'assigned' ? 'send' : 'bell')}<span class="grow"><b>${esc(L(n.title))}</b><div class="small muted">${esc(L(n.body))}</div><div class="tiny muted">${esc(fmtDateTime(n.at))}</div></span>${!n.readAt ? '<span class="dot" style="color:var(--accent)"></span>' : ''}</${act ? 'button' : 'div'}>`;
}
function certMini(c) {
  return `<button class="li cert-mini" data-act="go" data-r="cert" data-cert-id="${c.id}" style="border:0;padding:8px 0"><span class="seal">${icon('award')}</span><span class="grow"><b>${esc(L(c.courseTitle))}</b><div class="small muted">${esc(fmtDate(c.completedOn))} · <span class="mono" dir="ltr" style="white-space:nowrap">${esc(c.no)}</span></div></span>${pill(c.status)}</button>`;
}

PAGES.training = () => {
  const h = api.learnerHome(S.userId);
  const groups = ['overdue', 'in_progress', 'not_started', 'completed'].map(g => {
    const items = h.items.filter(i => i.status === g);
    if (!items.length) return '';
    return `<section class="stack"><h2>${t('group_' + g)} <span class="muted small">(${fmtNum(items.length)})</span></h2><div class="grid3">${items.map(courseCard).join('')}</div></section>`;
  }).join('');
  return `<div class="page">${pageHead(t('assigned_training'))}${groups || `<div class="card">${empty(t('no_training'), 'book')}</div>`}</div>`;
};

/* ---------------- course ---------------- */
PAGES.course = () => {
  const v = api.learnerCourse(S.userId, S.route.courseId);
  const { course, enrollment: e, detail: d } = v;
  const st = d.awaitingSignoff ? 'awaiting' : d.status;
  const secs = v.sections.map((s, i) => {
    const cur = !s.done && d.nextSectionId === s.id;
    const quiz = s.exam ? (s.exam.passed ? pill('passed', t('passed_label') + ' · ' + fmtPct(s.exam.bestScore)) : s.exam.attemptsUsed ? pill('in_progress', t('best_score', { s: fmtNum(s.exam.bestScore) })) : `<span class="pill">${t('has_quiz')}</span>`) : '';
    return `<button class="sec" data-act="go" data-r="section" data-course-id="${course.id}" data-section-id="${s.id}"><span class="sec-n ${s.done ? 'done' : cur ? 'cur' : ''}">${s.done ? icon('check', 'sm') : fmtNum(i + 1)}</span><span class="stack" style="gap:4px"><b>${esc(L(s.title))}</b><span class="row small muted"><span>${esc(t('cards_seen', { a: fmtNum(s.cardsViewed), b: fmtNum(s.cardsTotal) }))}</span>${quiz}</span></span>${icon('chev', 'flip sm')}</button>`;
  }).join('');
  const f = v.final;
  let finalCard = '';
  if (f) {
    const action = f.passed ? pill('passed', t('passed_label') + ' · ' + fmtPct(f.bestScore))
      : !f.unlocked ? `<span class="locked">${icon('lock')}${t('final_locked')}</span>`
      : f.canStart ? btn(f.attemptsUsed ? t('retake') : t('start_final'), 'startExam', { kind: 'primary', data: { exam: f.id }, icon: 'play' })
      : `<span class="locked">${icon('lock')}${t('err_attempts_used')}</span>`;
    finalCard = `<section class="card stack"><div class="row between top"><div><span class="eyebrow">${t('final_assessment')}</span><h2>${esc(L(f.title))}</h2><p class="small muted">${t('exam_rules', { q: fmtNum(f.questionCount), p: fmtNum(f.passPct), t: f.timeLimitMin ? fmtNum(f.timeLimitMin) + ' ' + t('minutes') : t('no_time_limit') })} · ${f.maxAttempts ? t('attempts_left', { n: fmtNum(f.attemptsLeft) }) : t('unlimited_attempts')}${f.bestScore != null ? ' · ' + t('best_score', { s: fmtNum(f.bestScore) }) : ''}</p></div>${action}</div></section>`;
  }
  const skills = v.skills.length ? `<section class="card stack"><div><h2>${t('practical_title')}</h2><p class="small muted">${t('practical_note')}</p></div><div class="list">${v.skills.map(skillRow).join('')}</div></section>` : '';
  const cert = v.certificate ? `<section class="card cert-mini" style="border-color:var(--ochre)"><span class="seal">${icon('award')}</span><span><span class="eyebrow">${t('your_certificate')}</span><div><b class="mono">${esc(v.certificate.no)}</b></div></span>${btn(t('view_certificate'), 'go', { data: { r: 'cert', 'cert-id': v.certificate.id }, kind: 'ochre', sm: true })}</section>` : '';
  return `<div class="page">${backLink('training')}
    <div class="page-head"><div class="grow"><div class="row small">${pill(st === 'awaiting' ? 'awaiting' : d.status)}<span class="muted">${t('version_n', { n: fmtNum(e.version) })} · ${esc(dueLine(e, d.status))}</span></div><h1 style="margin-top:8px">${esc(L(course.title))}</h1><p>${esc(L(course.desc))}</p></div></div>
    <div class="card stack" style="gap:8px"><div class="row between small"><b>${t('progress')}</b><span class="num">${fmtPct(d.percent)}</span></div>${bar(d.percent, 'lg')}</div>
    ${cert}
    <section class="stack"><h2>${t('course_sections')}</h2><div class="list">${secs}</div></section>
    ${finalCard}${skills}</div>`;
};
function skillRow(k) {
  const so = k.signoff;
  const st = so ? so.status : 'not_assessed';
  return `<div class="li"><span class="grow"><b>${esc(L(k.title))}</b><div class="small muted">${esc(L(k.desc))}</div>${so ? `<div class="tiny muted">${esc(t('signed_by', { status: t('st_' + so.status), who: userName(so.by), date: fmtDate(so.at) }))}${so.notes ? ' · ' + esc(so.notes) : ''}</div>` : ''}</span>${pill(st)}</div>`;
}

/* ---------------- section ---------------- */
PAGES.section = () => {
  const v = api.learnerCourse(S.userId, S.route.courseId);
  const idx = v.sections.findIndex(s => s.id === S.route.sectionId);
  const s = v.sections[idx];
  if (!s) throw new Core.ApiError('not_found');
  const seen = new Set(s.viewed);
  const firstNew = s.files.findIndex(f => !seen.has(f.id));
  const cards = s.files.length ? `<div class="list cards-list">${s.files.map((f, i) => `<button class="li" data-act="openCard" data-i="${i}"><span class="card-n ${seen.has(f.id) ? 'done' : ''}">${seen.has(f.id) ? icon('check', 'sm') : fmtNum(i + 1)}</span><span class="grow"><b>${esc(f.title)}</b></span>${seen.has(f.id) ? `<span class="small muted">${t('viewed')}</span>` : ''}${icon('chev', 'flip sm')}</button>`).join('')}</div>` : `<div class="card">${empty(t('no_files'), 'file')}</div>`;
  const startLabel = !s.cardsViewed ? t('start_cards') : s.cardsDone ? t('review_cards') : t('continue_cards');
  const cardHead = s.files.length ? `<section class="card stack cards-head"><div class="row between"><div><span class="eyebrow">${t('product_cards')}</span><h2>${esc(t('cards_seen', { a: fmtNum(s.cardsViewed), b: fmtNum(s.cardsTotal) }))}</h2></div>${btn(startLabel, 'openCard', { kind: s.cardsDone ? '' : 'primary', data: { i: firstNew >= 0 ? firstNew : 0 }, icon: 'play' })}</div>${bar(s.cardsTotal ? (s.cardsViewed / s.cardsTotal) * 100 : 0)}</section>` : '';
  let action;
  if (s.exam) {
    const x = s.exam;
    const right = x.passed ? pill('passed', t('passed_label') + ' · ' + fmtPct(x.bestScore))
      : x.locked ? `<span class="locked">${icon('lock')}${esc(t('quiz_after_cards', { n: fmtNum(s.cardsTotal - s.cardsViewed) }))}</span>`
      : x.canStart ? btn(x.attemptsUsed ? t('retake') : t('start_quiz'), 'startExam', { kind: 'primary', data: { exam: x.id }, icon: 'play' })
      : `<span class="locked">${icon('lock')}${t('err_attempts_used')}</span>`;
    action = `<section class="card stack"><div class="row between top"><div><span class="eyebrow">${t('quiz')}</span><h2>${esc(L(x.title))}</h2><p class="small muted">${t('quiz_meta', { q: fmtNum(x.questionCount), p: fmtNum(x.passPct) })} · ${x.timeLimitMin ? fmtNum(x.timeLimitMin) + ' ' + t('minutes') : t('no_time_limit')} · ${x.maxAttempts ? t('attempts_left', { n: fmtNum(x.attemptsLeft) }) : t('unlimited_attempts')}${x.bestScore != null ? ' · ' + t('best_score', { s: fmtNum(x.bestScore) }) : ''}</p></div>${right}</div><p class="tiny muted">${t('exam_server_note')}</p></section>`;
  } else {
    action = `<section class="card row between">${s.done ? `<div class="row">${pill('completed', t('section_done'))}</div>` : `<span class="muted small">${s.cardsDone ? esc(L(s.intro)) : esc(t('quiz_after_cards', { n: fmtNum(s.cardsTotal - s.cardsViewed) }))}</span>`}${s.done ? '' : (s.cardsDone ? btn(t('mark_done'), 'completeSection', { kind: 'primary', data: { section: s.id }, icon: 'check' }) : '')}</section>`;
  }
  const prev = v.sections[idx - 1], next = v.sections[idx + 1];
  return `<div class="page">${backLink('course', { 'course-id': v.course.id })}
    <div class="page-head"><div class="grow"><span class="eyebrow">${esc(L(v.course.title))} · ${fmtNum(idx + 1)} / ${fmtNum(v.sections.length)}</span><h1 style="margin-top:6px">${esc(L(s.title))}</h1><p>${esc(L(s.intro))}</p></div>${s.done ? pill('completed') : ''}</div>
    ${cardHead}
    ${action}
    <section class="stack"><h2>${t('product_cards')}</h2>${cards}</section>
    <div class="row between">${prev ? btn(t('prev_section'), 'go', { data: { r: 'section', 'course-id': v.course.id, 'section-id': prev.id }, icon: 'back' }) : '<span></span>'}${btn(t('report_problem'), 'reportProblem', { data: { section: s.id }, kind: 'ghost', icon: 'flag' })}${next ? btn(t('next_section'), 'go', { data: { r: 'section', 'course-id': v.course.id, 'section-id': next.id }, kind: 'primary' }) : btn(t('back_to_course'), 'go', { data: { r: 'course', 'course-id': v.course.id } })}</div>
  </div>`;
};
A.openCard = d => go('cards', { courseId: S.route.courseId, sectionId: S.route.sectionId, i: Number(d.i) || 0 });
const FORMAT = { pdf: 'PDF', video: 'MP4', image: 'IMG', doc: 'DOC' };
A.completeSection = async d => { const r = await call(() => api.completeSection(S.userId, d.section), t('section_done')); if (r) { if (r.certificate) toast(t('cert_earned'), 'good'); if (S.route.name === 'cards') go('course', { courseId: S.route.courseId }); else render(); } };
A.reportProblem = d => openModal('reportProblem', { sectionId: d.section });
MODALS.reportProblem = m => {
  const s = db.sections.find(x => x.id === m.sectionId);
  const files = db.files.filter(f => f.sectionId === s.id);
  return {
    title: t('report_problem'),
    body: `<p class="muted small">${t('report_problem_sub')}</p><form id="problem-form" data-form="reportProblem" class="stack">
      ${field(t('problem_about'), select('fileId', [['', t('whole_section')], ...files.map(f => [f.id, f.title])], ''))}
      ${field(t('problem_msg'), textarea('message', '', { rows: 4 }))}
      <input type="hidden" name="sectionId" value="${esc(s.id)}"></form>`,
    foot: `${btn(t('cancel'), 'closeModal')}<button class="btn primary" type="submit" form="problem-form">${icon('send', 'sm')}${t('send')}</button>`
  };
};
F.reportProblem = async d => { if (await call(() => api.reportIssue(S.userId, d), t('problem_sent'))) closeModal(); };

/* ---------------- exam ---------------- */
let timerHandle = null;
function stopTimer() { clearInterval(timerHandle); timerHandle = null; }
A.startExam = async d => {
  const s = await call(() => api.startAttempt(S.userId, d.exam));
  if (!s) return;
  const ex = db.exams.find(x => x.id === d.exam);
  S.exam = { ...s, examId: d.exam, courseId: ex.courseId, sectionId: ex.sectionId, answers: (S.exam && S.exam.attemptId === s.attemptId && S.exam.answers) || {} };
  go('exam');
};
PAGES.exam = () => {
  const x = S.exam;
  if (!x) return `<div class="page">${backLink('training')}${empty(t('err_not_found'))}</div>`;
  const qs = x.questions.map((q, i) => `<fieldset class="card q" style="border:1px solid var(--line)"><legend class="sr">${t('question_of', { a: i + 1, b: x.questions.length })}</legend>
      <span class="eyebrow">${t('question_of', { a: fmtNum(i + 1), b: fmtNum(x.questions.length) })}</span><p class="q-prompt">${esc(L(q.prompt))}</p>
      <div class="stack" style="gap:8px">${q.choices.map(c => `<label class="opt"><input type="radio" name="q-${q.id}" value="${c.id}" data-on-change="answer" data-q="${q.id}" ${x.answers[q.id] === c.id ? 'checked' : ''}><span>${esc(L(c.text))}</span></label>`).join('')}</div></fieldset>`).join('');
  const answered = Object.keys(x.answers).length;
  return `<div class="page" style="max-width:780px">
    <div class="examhead"><div class="row between"><div><span class="eyebrow">${t('attempt_n', { n: fmtNum(x.no) })} · ${t('pass_mark', { p: fmtNum(x.exam.passPct) })}</span><h1 style="font-size:1.3rem;margin-top:4px">${esc(L(x.exam.title))}</h1></div>${x.expiresAt ? `<span class="timer" id="timer" aria-live="off">--:--</span>` : ''}</div>
    <div class="row between small muted" style="margin-top:8px"><span id="answered">${t('answered_of', { a: fmtNum(answered), b: fmtNum(x.questions.length) })}</span><span>${t('exam_server_note')}</span></div></div>
    ${qs}
    <div class="row between">${btn(t('back_to_course'), 'go', { data: { r: 'course', 'course-id': x.courseId } })}${btn(t('submit'), 'submitExam', { kind: 'primary', icon: 'send' })}</div></div>`;
};
C.answer = (v, el) => {
  if (!S.exam) return;
  S.exam.answers[el.dataset.q] = v;
  const a = document.getElementById('answered');
  if (a) a.textContent = t('answered_of', { a: fmtNum(Object.keys(S.exam.answers).length), b: fmtNum(S.exam.questions.length) });
};
A.submitExam = () => {
  const x = S.exam; if (!x) return;
  const missing = x.questions.length - Object.keys(x.answers).length;
  if (missing > 0) openModal('confirm', { title: t('submit'), body: t('submit_unanswered', { n: fmtNum(missing) }), ok: t('submit_anyway'), onOk: () => { closeModal(); finishExam(); } });
  else finishExam();
};
async function finishExam(auto) {
  const x = S.exam; if (!x) return;
  stopTimer();
  const r = await call(() => api.submitAttempt(S.userId, x.attemptId, x.answers));
  if (!r) return;
  S.examResult = { ...r, examId: x.examId, courseId: x.courseId, sectionId: x.sectionId, title: x.exam.title };
  S.exam = null;
  if (auto) toast(t('time_up'));
  go('examResult');
}
AFTER.push(() => {
  if (S.route.name !== 'exam' || !S.exam || !S.exam.expiresAt) { if (S.route.name !== 'exam') stopTimer(); return; }
  stopTimer();
  const end = Date.parse(S.exam.expiresAt);
  const tick = () => {
    const el = document.getElementById('timer');
    const left = Math.max(0, Math.round((end - Date.now()) / 1000));
    if (el) { el.textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`; el.classList.toggle('low', left <= 60); el.setAttribute('aria-label', t('time_left')); }
    if (left <= 0) finishExam(true);
  };
  tick();
  timerHandle = setInterval(tick, 1000);
});
PAGES.examResult = () => {
  const r = S.examResult;
  if (!r) return `<div class="page">${backLink('training')}</div>`;
  const review = r.review ? `<section class="stack"><h2>${t('review_answers')}</h2>${r.review.map((q, i) => `<div class="card q"><span class="eyebrow">${t('question_of', { a: fmtNum(i + 1), b: fmtNum(r.review.length) })}</span><p class="q-prompt">${esc(L(q.prompt))}</p><div class="stack" style="gap:8px">${q.choices.map(c => `<div class="opt ${c.id === q.correct ? 'right' : c.id === q.chosen ? 'wrong' : ''}">${c.id === q.correct ? icon('check', 'sm') : c.id === q.chosen ? icon('x', 'sm') : '<span style="width:16px"></span>'}<span class="grow">${esc(L(c.text))}</span>${c.id === q.chosen ? `<span class="tiny">${t('your_answer')}</span>` : ''}</div>`).join('')}${!q.chosen ? `<span class="small muted">${t('no_answer')}</span>` : ''}</div></div>`).join('')}</section>` : `<p class="muted small">${t('review_hidden')}</p>`;
  return `<div class="page" style="max-width:780px">
    <section class="card stack" style="text-align:center;justify-items:center;border-color:${r.passed ? 'var(--good)' : 'var(--warn)'}">
      <span class="eyebrow">${esc(L(r.title))}</span><span class="score" style="color:${r.passed ? 'var(--good)' : 'var(--warn)'}">${fmtPct(r.scorePct)}</span>
      <h1>${r.passed ? t('result_pass') : t('result_fail')}</h1><p class="muted">${t('pass_mark', { p: fmtNum(r.passPct) })}${!r.passed && r.attemptsLeft != null ? ' · ' + t('attempts_left', { n: fmtNum(r.attemptsLeft) }) : ''}</p>
      ${r.late ? `<div class="notice warn">${icon('clock')}<span>${t('late_submit')}</span></div>` : ''}
      ${r.certificate ? `<div class="notice good">${icon('award')}<b>${t('cert_earned')}</b></div>` : ''}
      <div class="row" style="justify-content:center">${r.certificate ? btn(t('view_certificate'), 'go', { kind: 'ochre', data: { r: 'cert', 'cert-id': r.certificate.id }, icon: 'award' }) : ''}${!r.passed && r.canRetake ? btn(t('retake'), 'startExam', { kind: 'primary', data: { exam: r.examId }, icon: 'refresh' }) : ''}${btn(t('back_to_course'), 'go', { data: { r: 'course', 'course-id': r.courseId } })}</div>
    </section>${review}</div>`;
};

/* ---------------- certificates ---------------- */
PAGES.certs = () => {
  const list = api.myCertificates(S.userId).reverse();
  return `<div class="page">${pageHead(t('my_certificates'))}${list.length ? `<div class="grid2">${list.map(c => `<button class="course-card" data-act="go" data-r="cert" data-cert-id="${c.id}"><div class="cert-mini"><span class="seal">${icon('award')}</span><span><b>${esc(L(c.courseTitle))}</b><div class="small muted">${esc(fmtDate(c.completedOn))} · ${t('version_n', { n: fmtNum(c.version) })}</div><div class="mono small">${esc(c.no)}</div></span>${pill(c.status)}</div></button>`).join('')}</div>` : `<div class="card">${empty(t('no_certs_yet'), 'award')}</div>`}</div>`;
};
PAGES.cert = () => {
  const c = api.getCertificate(S.userId, S.route.certId);
  const own = c.userId === S.userId;
  const banner = c.status === 'revoked' ? `<div class="notice bad">${icon('alert')}<span>${t('cert_revoked_banner', { date: fmtDate(c.revokedAt) })}</span></div>` : c.status === 'replaced' ? `<div class="notice warn">${icon('alert')}<span>${t('cert_replaced_banner')}</span></div>` : '';
  return `<div class="page" style="max-width:980px">${backLink(own ? 'certs' : 'certsAdmin')}
    ${pageHead(L(c.courseTitle), `${L(c.holder)} · ${fmtDate(c.completedOn)}`, `${btn(t('download_pdf'), 'certPdf', { kind: 'primary', data: { cert: c.id }, icon: 'download' })}${btn(t('copy_link'), 'copyCertLink', { data: { no: c.no }, icon: 'copy' })}`)}
    ${banner}
    <div class="card" style="padding:10px"><img id="cert-img" class="cert-img" alt="${esc(t('cert_title') + ' — ' + L(c.holder) + ' — ' + L(c.courseTitle))}"></div>
    <div class="form-grid card">${kv(t('cert_id'), `<span class="mono">${esc(c.no)}</span>`)}${kv(t('issued_to'), esc(L(c.holder)))}${kv(t('completed_date'), esc(fmtDate(c.completedOn)))}${kv(t('course_version'), esc(fmtNum(c.version)))}${kv(t('status'), pill(c.status))}</div>
  </div>`;
};
AFTER.push(() => {
  if (S.route.name !== 'cert') return;
  const img = document.getElementById('cert-img'); if (!img) return;
  const c = db.certs.find(x => x.id === S.route.certId); if (!c) return;
  drawCertificate(c, S.lang).then(cv => { img.src = cv.toDataURL('image/png'); }).catch(e => console.error(e));
});
A.copyCertLink = d => copyText(verifyUrl(d.no));
A.certPdf = async d => {
  const c = db.certs.find(x => x.id === d.cert); if (!c) return;
  if (!window.jspdf) { toast(t('download_unavailable'), 'bad'); return; }
  toast(t('preparing_pdf'));
  const cv = await drawCertificate(c, S.lang);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  doc.addImage(cv.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 297, 210);
  doc.setProperties({ title: `${c.no} ${c.courseTitle.en}`, subject: 'Certificate of completion', creator: c.business.en });
  if (await saveFile(`certificate-${c.no}.pdf`, doc.output('blob'), 'application/pdf')) toast(t('pdf_ready'), 'good');
};

PAGES.skills = () => {
  const list = api.mySkills(S.userId);
  return `<div class="page">${pageHead(t('my_skills'), t('practical_note'))}${list.length ? `<div class="list">${list.map(k => `<div class="li"><span class="grow"><b>${esc(L(k.title))}</b><div class="small muted">${esc(L(k.course))} · ${esc(L(k.desc))}</div>${k.signoff ? `<div class="tiny muted">${esc(t('signed_by', { status: t('st_' + k.signoff.status), who: userName(k.signoff.by), date: fmtDate(k.signoff.at) }))}${k.signoff.notes ? ' · ' + esc(k.signoff.notes) : ''}</div>` : ''}</span>${pill(k.signoff ? k.signoff.status : 'not_assessed')}</div>`).join('')}</div>` : `<div class="card">${empty(t('no_skills'), 'check')}</div>`}</div>`;
};

/* ---------------- help ---------------- */
PAGES.help = () => {
  const q = S.pf.helpQ || '';
  const list = api.listFaqs(S.userId, q);
  const edit = can('faq.manage');
  return `<div class="page" style="max-width:860px">${pageHead(t('help'), t('help_sub'), edit ? btn(t('add_question'), 'editFaq', { icon: 'plus', kind: 'primary' }) : '')}
    <div class="card">${input('helpq', q, { ph: t('faq_search_ph'), onInput: 'helpSearch', id: 'help-q', type: 'search' })}</div>
    <div class="stack">${list.length ? list.map(f => `<details class="card"><summary><span class="grow">${esc(L(f.q))}</span></summary><p style="margin-top:10px;max-width:68ch">${esc(L(f.a))}</p>${edit ? `<div class="row" style="margin-top:10px">${btn(t('edit'), 'editFaq', { sm: true, data: { faq: f.id }, icon: 'edit' })}${btn(t('delete'), 'deleteFaq', { sm: true, kind: 'danger', data: { faq: f.id }, icon: 'trash' })}</div>` : ''}</details>`).join('') : `<div class="card">${empty(t('no_results'), 'search')}</div>`}</div></div>`;
};
I.helpSearch = v => { S.pf.helpQ = v; render(); };
A.editFaq = d => openModal('faq', { faqId: d.faq || null });
MODALS.faq = m => {
  const f = m.faqId ? db.faqs.find(x => x.id === m.faqId) : { q: { en: '', ar: '' }, a: { en: '', ar: '' }, tags: [] };
  return {
    title: m.faqId ? t('edit') : t('add_question'), wide: true,
    body: `<form id="faq-form" data-form="faq" class="form-grid"><input type="hidden" name="id" value="${esc(m.faqId || '')}">
      ${field(t('question') + ' · ' + t('english'), input('qen', f.q.en, { dir: 'ltr' }))}${field(t('question') + ' · ' + t('arabic'), input('qar', f.q.ar, { dir: 'rtl' }))}
      ${field(t('answer') + ' · ' + t('english'), textarea('aen', f.a.en, { dir: 'ltr', rows: 4 }))}${field(t('answer') + ' · ' + t('arabic'), textarea('aar', f.a.ar, { dir: 'rtl', rows: 4 }))}
      ${field(t('tags'), input('tags', (f.tags || []).join(', ')), { hint: t('tags_hint'), full: true })}</form>`,
    foot: `${btn(t('cancel'), 'closeModal')}<button class="btn primary" type="submit" form="faq-form">${t('save')}</button>`
  };
};
F.faq = async d => { if (await call(() => api.saveFaq(S.userId, { id: d.id || null, q: { en: d.qen, ar: d.qar }, a: { en: d.aen, ar: d.aar }, tags: String(d.tags || '').split(',') }), t('saved'))) { closeModal(); render(); } };
A.deleteFaq = d => openModal('confirm', { title: t('delete'), body: L(db.faqs.find(x => x.id === d.faq).q), ok: t('delete'), danger: true, onOk: async () => { if (await call(() => api.deleteFaq(S.userId, d.faq), t('deleted'))) { closeModal(); render(); } } });

/* ---------------- notifications, profile, more ---------------- */
PAGES.notifications = () => {
  const list = db.notifications.filter(n => n.userId === S.userId);
  return `<div class="page" style="max-width:780px">${backLink('home')}${pageHead(t('notifications'), '', list.some(n => !n.readAt) ? btn(t('mark_all_read'), 'markRead', { icon: 'check' }) : '')}
    ${list.length ? `<div class="list">${list.map(noteItem).join('')}</div>` : `<div class="card">${empty(t('no_reminders'), 'bell')}</div>`}</div>`;
};
A.markRead = async () => { await call(() => api.markNotificationsRead(S.userId)); render(); };

PAGES.profile = () => {
  const r = api.getUser(S.userId, S.userId);
  const u = r.user;
  return `<div class="page" style="max-width:780px">${backLink('home')}${pageHead(t('my_details'), t('details_note'))}
    <div class="card form-grid">${kv(t('name'), esc(L(u.name)))}${kv(t('employee_code'), `<span class="mono">${esc(u.code)}</span>`)}${kv(t('email'), esc(u.email))}${kv(t('role'), rolePill(u.role))}${kv(t('location'), esc(locName(u.locationId)))}${kv(t('team'), esc(u.teamId ? teamName(u.teamId) : '—'))}${kv(t('job_title'), esc(u.title || '—'))}${kv(t('hire_date'), esc(fmtDate(u.hireDate)))}</div>
    <div class="card stack"><h2>${t('sign_in_section')}</h2><p class="small muted">${t('sign_in_with')}: <span class="mono" dir="ltr">${esc([u.code, u.email].filter(Boolean).join(' · '))}</span></p>
      <form class="stack" data-form="ownPassword" novalidate style="max-width:420px">
        ${S.pf.ownPwErr ? `<div class="notice bad" role="alert">${icon('alert')}<span>${esc(S.pf.ownPwErr)}</span></div>` : ''}
        ${field(t('current_password'), pwInput('current', { id: 'f-own-current', ac: 'current-password' }))}
        ${field(t('new_password'), pwInput('next', { id: 'f-own-next' }), { hint: t('pw_rules') })}
        ${field(t('confirm_password'), pwInput('confirm', { id: 'f-own-confirm' }))}
        <div>${btn(t('change_password'), null, { type: 'submit', kind: 'primary', icon: 'key' })}</div></form></div>
    <div class="card stack"><h2>${t('pref_language')}</h2><div class="row">${btn('English', 'setLang', { data: { lang: 'en' }, kind: S.lang === 'en' ? 'primary' : '' })}${btn('العربية', 'setLang', { data: { lang: 'ar' }, kind: S.lang === 'ar' ? 'primary' : '' })}</div></div>
    <div class="row">${btn(t('privacy'), 'go', { data: { r: 'privacy' }, icon: 'shield' })}${btn(t('sign_out'), 'signOut', { icon: 'logout' })}</div></div>`;
};
A.setLang = d => { S.lang = d.lang; LS.set('btw-lang', d.lang); render(); };
F.ownPassword = async d => {
  if (d.next !== d.confirm) { S.pf.ownPwErr = t('field_err_pw_mismatch'); render(); return; }
  busy(1);
  try { await api.changeOwnPassword(S.userId, d.current, d.next); persist(); S.pf.ownPwErr = ''; toast(t('password_changed'), 'good'); render(); }
  catch (err) { S.pf.ownPwErr = err.detail && err.detail.password ? t('field_err_' + err.detail.password) : errMsg(err); render(); }
  finally { busy(-1); }
};

PAGES.more = () => `<div class="page">${pageHead(t('more'))}${NAV.map(g => {
  const items = g.items.filter(navAllowed);
  if (!items.length) return '';
  return `<section class="stack"><div class="eyebrow">${t(g.group)}</div><div class="list">${items.map(i => `<button class="li" data-act="go" data-r="${i.r}">${icon(i.icon)}<span class="grow">${t(i.label)}</span>${icon('chev', 'flip sm')}</button>`).join('')}</div></section>`;
}).join('')}<section class="stack"><div class="list"><button class="li" data-act="go" data-r="profile">${icon('users')}<span class="grow">${t('profile')}</span></button><button class="li" data-act="go" data-r="verify">${icon('award')}<span class="grow">${t('verify')}</span></button><button class="li" data-act="signOut">${icon('logout')}<span class="grow">${t('sign_out')}</span></button></div></section></div>`;
