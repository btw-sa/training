/* ui-manage.js — manager pages. Every list and action is already limited by the backend; buttons here only mirror it. */

/* ---------------- shared filters ---------------- */
function scopedLocations() {
  const m = me();
  if (m.scope.global) return db.locations;
  const teams = db.teams.filter(x => m.scope.teams.includes(x.id)).map(x => x.locationId);
  return db.locations.filter(l => m.scope.locations.includes(l.id) || teams.includes(l.id));
}
function scopedTeams(locationId) {
  const m = me();
  return db.teams.filter(x => (!locationId || x.locationId === locationId) && (m.scope.global || m.scope.locations.includes(x.locationId) || m.scope.teams.includes(x.id)));
}
function filterBar(f, o = {}) {
  const locs = scopedLocations();
  const teams = scopedTeams(f.locationId);
  const people = o.people ? api.listUsers(S.userId, { locationId: f.locationId, teamId: f.teamId, status: 'active' }).filter(u => u.id !== S.userId) : [];
  const courses = db.courses.filter(c => c.status !== 'draft');
  return `<div class="card filters">
    ${field(t('location'), select('locationId', [['', t('all')], ...locs.map(l => [l.id, L(l.name)])], f.locationId || '', { onChange: 'dashFilter', id: 'df-loc' }))}
    ${field(t('team'), select('teamId', [['', t('all')], ...teams.map(x => [x.id, L(x.name)])], f.teamId || '', { onChange: 'dashFilter', id: 'df-team' }))}
    ${o.people ? field(t('people'), select('userId', [['', t('all')], ...people.map(u => [u.id, L(u.name)])], f.userId || '', { onChange: 'dashFilter', id: 'df-user' })) : ''}
    ${field(t('course'), select('courseId', [['', t('all')], ...courses.map(c => [c.id, L(c.title)])], f.courseId || '', { onChange: 'dashFilter', id: 'df-course' }))}
    ${field(t('from'), input('from', f.from || '', { type: 'date', id: 'df-from' }).replace('<input', '<input data-on-change="dashFilter"'))}
    ${field(t('to'), input('to', f.to || '', { type: 'date', id: 'df-to' }).replace('<input', '<input data-on-change="dashFilter"'))}
    <div>${btn(t('clear'), 'dashClear', { sm: true, kind: 'ghost', icon: 'x' })}</div></div>`;
}
C.dashFilter = (v, el) => { S.dash[el.name] = v || ''; if (el.name === 'locationId') { S.dash.teamId = ''; S.dash.userId = ''; } if (el.name === 'teamId') S.dash.userId = ''; render(); };
A.dashClear = () => { S.dash = {}; render(); };
const cleanFilters = f => Object.fromEntries(Object.entries(f).filter(([, v]) => v));

/* ---------------- dashboard ---------------- */
function kpiTile(key, value, label, foot, attention) {
  return `<div class="kpi ${attention ? 'attention' : ''}"><button class="icon-btn info" data-act="kpiInfo" data-k="${key}" aria-label="${esc(t('calc'))}: ${esc(label)}">${icon('info', 'sm')}</button><span class="v">${value}</span><span class="l">${esc(label)}</span>${foot ? `<span class="f">${esc(foot)}</span>` : ''}</div>`;
}
const KPI_DEF = { completion: ['kpi_completion', 'def_completion'], overdue: ['kpi_overdue', 'def_overdue'], avg: ['kpi_avg', 'def_avg'], pass: ['kpi_pass', 'def_pass'], first: ['kpi_first', 'def_first'], retakes: ['kpi_retakes', 'def_retakes'], days: ['kpi_days', 'def_days'], signoffs: ['kpi_signoffs', 'def_signoffs'] };
A.kpiInfo = d => openModal('kpiInfo', { k: d.k });
MODALS.kpiInfo = m => {
  const [l, def] = KPI_DEF[m.k];
  const k = api.kpis(S.userId, cleanFilters(S.dash));
  const nums = {
    completion: `${fmtNum(k.completionRate.num)} ÷ ${fmtNum(k.completionRate.den)} = ${fmtPct(k.completionRate.value)}`,
    overdue: `${fmtNum(k.overdue.value)} / ${fmtNum(k.overdue.den)}`,
    avg: `n = ${fmtNum(k.avgScore.n)} → ${fmtPct(k.avgScore.value)}`,
    pass: `${fmtNum(k.passRate.num)} ÷ ${fmtNum(k.passRate.den)} = ${fmtPct(k.passRate.value)}`,
    first: `${fmtNum(k.firstAttemptPass.num)} ÷ ${fmtNum(k.firstAttemptPass.den)} = ${fmtPct(k.firstAttemptPass.value)}`,
    retakes: `${fmtNum(k.retakes.value)} / ${fmtNum(k.retakes.attempts)}`,
    days: `n = ${fmtNum(k.medianDays.n)} → ${fmtNum(k.medianDays.value)}`,
    signoffs: `${fmtNum(k.signoffs.passed)} ÷ ${fmtNum(k.signoffs.total)} = ${fmtPct(k.signoffs.value)}`
  }[m.k];
  return { title: t(l), body: `<p>${esc(t(def))}</p><div class="diff num" dir="ltr">${esc(nums)}</div><p class="small muted">${t('in_view', { n: fmtNum(k.people) })}</p>`, foot: btn(t('close'), 'closeModal') };
};

PAGES.dashboard = () => {
  const f = S.dash;
  const k = api.kpis(S.userId, cleanFilters(f));
  const m = me();
  const accessCard = m.user.role === 'area_manager' ? `<details class="card"><summary>${icon('shield', 'sm')}&nbsp;${t('your_access')}: ${esc([...m.scope.locations.map(locName), ...m.scope.teams.map(teamName)].join(' · ') || '—')}</summary><div class="stack" style="margin-top:10px"><div class="row">${Core.GRANTABLE.map(p => { const on = m.perms.includes(p); const meta = Core.PERMISSIONS.find(x => x.key === p); return `<span class="pill ${on ? 'good' : ''}">${on ? icon('check', 'sm') : icon('lock', 'sm')}${esc(L(meta.label))}</span>`; }).join('')}</div><p class="small muted">${t('server_checked')}</p></div></details>` : '';
  const courseBars = k.byCourse.length ? k.byCourse.map(r => `<div class="hbar"><span class="lbl" title="${esc(L(r.title))}">${esc(L(r.title))}</span><span class="track" title="${fmtNum(r.completed)} / ${fmtNum(r.assigned)}"><span class="fill" style="width:${(r.completed / Math.max(1, r.assigned)) * 100}%"></span><span class="fill over" style="inset-inline-start:${(r.completed / Math.max(1, r.assigned)) * 100}%;width:${(r.overdue / Math.max(1, r.assigned)) * 100}%;opacity:.85"></span></span><span class="num small">${fmtPct(r.rate)}</span></div>`).join('') : empty(t('no_data'));
  const so = k.signoffs;
  const soBar = so.total ? `<div class="stack-bar" role="img" aria-label="${esc(`${t('st_passed')} ${so.passed}, ${t('st_needs_practice')} ${so.needs_practice}, ${t('st_not_assessed')} ${so.not_assessed}`)}"><span style="width:${so.passed / so.total * 100}%;background:var(--good)"></span><span style="width:${so.needs_practice / so.total * 100}%;background:var(--warn)"></span><span style="width:${so.not_assessed / so.total * 100}%;background:var(--line)"></span></div><div class="legend"><span><i style="background:var(--good)"></i>${t('st_passed')} ${fmtNum(so.passed)}</span><span><i style="background:var(--warn)"></i>${t('st_needs_practice')} ${fmtNum(so.needs_practice)}</span><span><i style="background:var(--line)"></i>${t('st_not_assessed')} ${fmtNum(so.not_assessed)}</span></div>` : empty(t('no_data'));
  const support = k.support.length ? `<div class="list">${k.support.map(s => `<div class="li"><span class="avatar">${esc(initials(s.name.en))}</span><span class="grow"><b>${esc(L(s.name))}</b> <span class="small muted">${esc(locName(s.locationId))}</span><div class="row" style="margin-top:6px;gap:6px">${s.signals.map(sigText).map(x => `<span class="signal">${esc(x)}</span>`).join('')}</div></span>${can('users.view') ? btn(t('open_person'), 'go', { sm: true, data: { r: 'person', 'user-id': s.userId } }) : ''}</div>`).join('')}</div>` : `<p class="muted small">${t('support_none')}</p>`;
  const th = k.thresholds;
  const review = `<div class="list">${k.review.map(r => `<div class="li">${icon('layers')}<span class="grow"><b>${esc(L(r.title))}</b><div class="small muted">${t('version_n', { n: fmtNum(r.version) })} · ${r.reviewDue ? esc(fmtDate(r.reviewDue)) : t('no_review')}</div></span>${pill(r.status === 'overdue' ? 'overdue' : r.status === 'due_soon' ? 'awaiting' : r.status === 'ok' ? 'completed' : 'not_started', t('rs_' + r.status))}</div>`).join('')}</div>`;
  const people = table([{ label: t('name') }, { label: t('location') }, { label: t('assigned'), num: true }, { label: t('completed'), num: true }, { label: t('rate'), num: true }, { label: t('kpi_overdue'), num: true }, { label: t('avg'), num: true }, { label: t('attempts'), num: true }],
    k.byPerson.map(r => `<tr ${can('users.view') ? `class="click" data-act="go" data-r="person" data-user-id="${r.userId}"` : ''}><td><b>${esc(L(r.name))}</b></td><td>${esc(locName(r.locationId))}</td><td class="num">${fmtNum(r.assigned)}</td><td class="num">${fmtNum(r.completed)}</td><td class="num">${fmtPct(r.rate)}</td><td class="num">${r.overdue ? `<span class="pill warn">${fmtNum(r.overdue)}</span>` : fmtNum(0)}</td><td class="num">${r.avgScore == null ? '—' : fmtPct(r.avgScore)}</td><td class="num">${fmtNum(r.attempts)}</td></tr>`));
  const secTable = table([{ label: t('course') }, { label: t('section_editor') }, { label: t('enrolled'), num: true }, { label: t('started'), num: true }, { label: t('completed'), num: true }, { label: t('rate'), num: true }],
    k.bySection.filter(r => r.enrolled).map(r => `<tr><td>${esc(L(r.course))}</td><td>${fmtNum(r.pos)}. ${esc(L(r.title))}</td><td class="num">${fmtNum(r.enrolled)}</td><td class="num">${fmtNum(r.started)}</td><td class="num">${fmtNum(r.completed)}</td><td class="num">${fmtPct(r.rate)}</td></tr>`));
  return `<div class="page">${pageHead(t('dashboard'), t('dash_sub'), can('reports.export') ? btn(t('reports'), 'go', { data: { r: 'reports' }, icon: 'download' }) : gbtn('reports.export', {}, t('reports'), 'go'))}
    ${accessCard}${filterBar(f, { people: true })}
    <div class="tiles">
      ${kpiTile('completion', fmtPct(k.completionRate.value), t('kpi_completion'), `${fmtNum(k.completionRate.num)} / ${fmtNum(k.completionRate.den)}`)}
      ${kpiTile('overdue', fmtNum(k.overdue.value), t('kpi_overdue'), `/ ${fmtNum(k.overdue.den)}`, k.overdue.value > 0)}
      ${kpiTile('avg', fmtPct(k.avgScore.value), t('kpi_avg'), `n = ${fmtNum(k.avgScore.n)}`)}
      ${kpiTile('pass', fmtPct(k.passRate.value), t('kpi_pass'), `${fmtNum(k.passRate.num)} / ${fmtNum(k.passRate.den)}`)}
      ${kpiTile('first', fmtPct(k.firstAttemptPass.value), t('kpi_first'), `${fmtNum(k.firstAttemptPass.num)} / ${fmtNum(k.firstAttemptPass.den)}`)}
      ${kpiTile('retakes', fmtNum(k.retakes.value), t('kpi_retakes'), `/ ${fmtNum(k.retakes.attempts)}`)}
      ${kpiTile('days', fmtNum(k.medianDays.value), t('kpi_days'), `n = ${fmtNum(k.medianDays.n)}`)}
      ${kpiTile('signoffs', fmtPct(so.value), t('kpi_signoffs'), `${fmtNum(so.passed)} / ${fmtNum(so.total)}`)}
    </div>
    <div class="grid2">
      <section class="card stack"><h2>${t('by_course')}</h2><div>${courseBars}</div><div class="legend"><span><i style="background:var(--accent)"></i>${t('completed')}</span><span><i style="background:var(--warn)"></i>${t('kpi_overdue')}</span><span>${t('bar_full')}</span></div></section>
      <section class="card stack"><h2>${t('signoff_mix')}</h2>${soBar}<div class="divider"></div><h2>${t('review_status')}</h2>${review}</section>
    </div>
    <section class="card stack"><div><h2>${t('support_title')}</h2><p class="small muted">${t('support_sub', { n: fmtNum(th.minSignals) })}</p></div>${support}
      <details><summary class="small">${t('criteria')}</summary><ul class="small muted" style="margin:8px 0 0;padding-inline-start:20px">
        <li>${t('th_overdue')}: ${fmtNum(th.overdueDays)}</li><li>${t('th_failed')}: ${fmtNum(th.failedAttempts)}</li><li>${t('th_low')}: ${fmtNum(th.lowAverage)}</li><li>${t('th_np')}: ${fmtNum(th.needsPracticeDays)}</li><li>${t('th_inactive')}: ${fmtNum(th.inactiveDays)}</li><li>${t('th_min')}: ${fmtNum(th.minSignals)}</li></ul></details></section>
    <section class="stack"><h2>${t('by_person')}</h2>${people}</section>
    <section class="stack"><h2>${t('by_section')}</h2>${secTable}</section>
  </div>`;
};
function sigText(s) {
  if (s.code === 'overdue') return t('sig_overdue', { n: fmtNum(s.n), d: fmtNum(s.days) });
  if (s.code === 'repeat_fail') return t('sig_repeat_fail', { exam: L(s.exam) });
  if (s.code === 'low_avg') return t('sig_low_avg', { s: fmtNum(s.avg), n: fmtNum(s.n) });
  if (s.code === 'needs_practice') return t('sig_needs_practice', { skill: L(s.skill) });
  if (s.code === 'inactive') return t('sig_inactive', { d: fmtNum(s.days) });
  return s.code;
}

/* ---------------- people ---------------- */
PAGES.people = () => {
  const f = S.pf.people || (S.pf.people = {});
  const list = api.listUsers(S.userId, cleanFilters(f));
  const locs = scopedLocations();
  const rows = list.map(u => `<tr class="click" data-act="go" data-r="person" data-user-id="${u.id}"><td><div class="row" style="flex-wrap:nowrap"><span class="avatar">${esc(initials(u.name.en))}</span><span><b>${esc(L(u.name))}</b><div class="small muted">${esc(u.email || u.code)}</div></span></div></td><td>${rolePill(u.role)}</td><td>${esc(locName(u.locationId))}${u.teamId ? `<div class="small muted">${esc(teamName(u.teamId))}</div>` : ''}</td><td>${pill(u.status)}</td><td class="mono small">${esc(u.code)}</td></tr>`);
  return `<div class="page">${pageHead(t('people'), t('people_sub'), `${gbtn('users.import', {}, t('import_csv'), 'go', { data: { r: 'import' }, icon: 'upload' })}${gbtn('users.edit', {}, t('add_person'), 'go', { data: { r: 'personEdit' }, icon: 'plus', kind: 'primary' })}`)}
    <div class="card filters">
      ${field(t('search'), input('q', f.q || '', { ph: t('name') + ', ' + t('email'), onInput: 'peopleQ', id: 'people-q', type: 'search' }))}
      ${field(t('location'), select('locationId', [['', t('all')], ...locs.map(l => [l.id, L(l.name)])], f.locationId || '', { onChange: 'peopleF', id: 'pf-loc' }))}
      ${field(t('role'), select('role', [['', t('all')], ...Core.ROLES.map(r => [r, roleName(r)])], f.role || '', { onChange: 'peopleF', id: 'pf-role' }))}
      ${field(t('status'), select('status', [['', t('all')], ['active', t('st_active')], ['inactive', t('st_inactive')]], f.status || '', { onChange: 'peopleF', id: 'pf-status' }))}
    </div>
    <p class="small muted">${fmtNum(list.length)} · ${me().scope.global ? t('scope_all') : t('location_limited')}</p>
    ${table([{ label: t('name') }, { label: t('role') }, { label: t('location') }, { label: t('status') }, { label: t('employee_code') }], rows)}</div>`;
};
I.peopleQ = v => { S.pf.people.q = v; render(); };
C.peopleF = (v, el) => { S.pf.people[el.name] = v; render(); };

PAGES.person = () => {
  const r = api.getUser(S.userId, S.route.userId);
  const u = r.user;
  const self = u.id === S.userId;
  const ctx = { userId: u.id };
  const training = r.enrollments ? table([{ label: t('course') }, { label: t('status') }, { label: t('progress') }, { label: t('due_date') }, { label: '' }],
    r.enrollments.filter(e => e.active).map(e => `<tr><td><b>${esc(L(e.course))}</b><div class="small muted">${t('version_n', { n: fmtNum(e.version) })}</div></td><td>${pill(e.awaitingSignoff ? 'awaiting' : e.status)}</td><td style="min-width:140px">${bar(e.percent)}<span class="tiny muted">${t('sections_done', { a: fmtNum(e.sectionsDone), b: fmtNum(e.sectionsTotal) })}</span></td><td>${esc(fmtDate(e.dueOn))}</td><td>${!e.completedAt ? gbtn('records.correct', ctx, t('correct'), 'correctSection', { sm: true, data: { user: u.id, course: e.courseId } }) : ''}</td></tr>`)) : '';
  const attempts = r.attempts ? table([{ label: t('exam') }, { label: t('attempts') }, { label: t('score'), num: true }, { label: t('result') }, { label: t('date') }, { label: '' }],
    r.attempts.slice().reverse().map(a => `<tr><td>${esc(L(a.exam))}</td><td class="num">${fmtNum(a.no)}</td><td class="num">${fmtPct(a.scorePct)}${a.corrected ? ' *' : ''}</td><td>${pill(a.passed ? 'passed' : 'failed', a.passed ? t('st_passed') : t('st_failed'))}</td><td>${esc(fmtDateTime(a.submittedAt))}</td><td>${gbtn('records.correct', ctx, t('correct'), 'correctAttempt', { sm: true, data: { attempt: a.id } })}</td></tr>`)) : '';
  const signoffs = r.signoffs ? (r.signoffs.length ? `<div class="list">${r.signoffs.slice().reverse().map(s => `<div class="li"><span class="grow"><b>${esc(L(s.skill))}</b><div class="small muted">${esc(t('signed_by', { status: t('st_' + s.status), who: userName(s.by), date: fmtDate(s.at) }))}${s.notes ? ' · ' + esc(s.notes) : ''}</div></span>${pill(s.status)}</div>`).join('')}</div>` : empty(t('no_data'))) : '';
  const certs = r.certs ? (r.certs.length ? `<div class="list">${r.certs.slice().reverse().map(c => `<button class="li" data-act="go" data-r="cert" data-cert-id="${c.id}">${icon('award')}<span class="grow"><b>${esc(L(c.courseTitle))}</b><div class="small muted mono">${esc(c.no)}</div></span>${pill(c.status)}</button>`).join('')}</div>` : empty(t('no_data'))) : '';
  const corrections = r.corrections && r.corrections.length ? `<section class="stack"><h2>${t('person_corrections')}</h2><div class="list">${r.corrections.map(c => `<div class="li">${icon('edit')}<span class="grow"><b>${esc(c.entity)} · ${esc(String(c.old))} → ${esc(String(c.new))}</b><div class="small muted">${esc(c.reason)} · ${esc(userName(c.by))} · ${esc(fmtDateTime(c.at))}</div></span></div>`).join('')}</div></section>` : '';
  return `<div class="page">${backLink('people')}
    <div class="page-head"><div class="row"><span class="avatar" style="width:52px;height:52px;font-size:1.1rem">${esc(initials(u.name.en))}</span><div><h1>${esc(L(u.name))}</h1><div class="row small">${rolePill(u.role)}${pill(u.status)}<span class="muted">${esc(locName(u.locationId))}${u.teamId ? ' · ' + esc(teamName(u.teamId)) : ''}</span></div></div></div>
      <div class="row">${self ? '' : gbtn('users.edit', ctx, t('edit'), 'go', { data: { r: 'personEdit', 'user-id': u.id }, icon: 'edit' })}${self ? '' : (u.status === 'active' ? gbtn('users.deactivate', ctx, t('deactivate'), 'setStatus', { data: { user: u.id, status: 'inactive' }, kind: 'danger' }) : gbtn('users.deactivate', ctx, t('reactivate'), 'setStatus', { data: { user: u.id, status: 'active' } }))}</div></div>
    <div class="card form-grid">${kv(t('employee_code'), `<span class="mono">${esc(u.code || '—')}</span>`)}${kv(t('email'), esc(u.email || '—'))}${kv(t('phone'), esc(u.phone || '—'))}${kv(t('job_title'), esc(u.title || '—'))}${kv(t('hire_date'), esc(fmtDate(u.hireDate) || '—'))}</div>
    <p class="tiny muted">${esc(t('created_by_line', { who: userName(u.createdBy), date: fmtDate(u.createdAt), who2: userName(u.updatedBy), date2: fmtDate(u.updatedAt) }))}</p>
    ${signInCard(u, self, ctx)}
    ${r.enrollments ? `<section class="stack"><h2>${t('person_training')}</h2>${training}</section>` : `<div class="notice">${icon('lock')}<span>${t('person_training')}: ${esc(lockReason('forbidden_role'))}</span></div>`}
    ${r.attempts ? `<section class="stack"><h2>${t('person_attempts')}</h2>${attempts}</section>` : ''}
    <div class="grid2">${r.signoffs ? `<section class="stack"><h2>${t('person_signoffs')}</h2>${signoffs}</section>` : ''}${r.certs ? `<section class="stack"><h2>${t('person_certs')}</h2>${certs}</section>` : ''}</div>
    ${corrections}
    ${!self ? `<details class="card"><summary>${t('remove_person')}</summary><div class="stack" style="margin-top:10px"><p class="small muted">${t('remove_person_note')}</p><div>${gbtn('users.remove', ctx, t('remove_person'), 'removePerson', { data: { user: u.id }, kind: 'danger', icon: 'trash' })}</div></div></details>` : ''}
  </div>`;
};
function signInCard(u, self, ctx) {
  const lg = u.login || {};
  const status = lg.hasPassword ? (lg.mustChange ? pill('awaiting', t('pw_status_temp')) : pill('active', t('pw_status_set'))) : pill('inactive', t('pw_status_none'));
  const action = self ? btn(t('change_password'), 'go', { data: { r: 'profile' }, icon: 'key' }) : gbtn('users.edit', ctx, t('set_password'), 'setPw', { data: { user: u.id }, icon: 'key' });
  return `<section class="card stack"><div class="row between top"><div class="stack" style="gap:4px"><h2>${t('sign_in_section')}</h2><p class="small muted">${t('sign_in_with')}: <span class="mono" dir="ltr">${esc([u.code, u.email].filter(Boolean).join(' · ') || '—')}</span></p></div>${action}</div>
    <div class="row small">${status}${lg.setAt ? `<span class="muted">${esc(t('pw_set_by', { who: userName(lg.setBy), date: fmtDate(lg.setAt) }))}</span>` : ''}<span class="muted">${t('last_sign_in')}: ${lg.lastSignInAt ? esc(fmtDateTime(lg.lastSignInAt)) : t('never')}</span></div></section>`;
}
A.setPw = d => openModal('setPw', { userId: d.user });
MODALS.setPw = m => {
  const u = db.users.find(x => x.id === m.userId);
  const e = S.formErr && S.formErr.password;
  return {
    title: t('set_password'),
    body: `<form id="pw-form" data-form="setPw" class="stack" novalidate>
      <div class="cred small"><b>${esc(L(u.name))}</b><span>${t('sign_in_with')}: <span class="mono" dir="ltr">${esc([u.code, u.email].filter(Boolean).join(' · '))}</span></span></div>
      ${e ? `<div class="notice bad" role="alert">${icon('alert')}<span>${esc(t('field_err_' + e))}</span></div>` : ''}
      ${field(t('new_password'), pwInput('next', { id: 'f-set-next', invalid: !!e }), { hint: t('pw_rules') })}
      ${field(t('confirm_password'), pwInput('confirm', { id: 'f-set-confirm' }))}
      ${checkbox('mustChange', true, `<b>${t('must_change')}</b><br><span class="small muted">${t('must_change_hint')}</span>`, { id: 'f-set-must' })}</form>`,
    foot: `${btn(t('cancel'), 'closeModal')}<button class="btn primary" type="submit" form="pw-form">${icon('key', 'sm')}${t('save')}</button>`
  };
};
F.setPw = async d => {
  const m = S.modal; const u = db.users.find(x => x.id === m.userId);
  if (d.next !== d.confirm) { S.formErr = { password: 'pw_mismatch' }; renderModal(); return; }
  const r = await call(() => api.setPassword(S.userId, m.userId, d.next, !!d.mustChange));
  if (r) { closeModal(); toast(t('password_set', { name: L(u.name).split(' ')[0] }), 'good'); render(); }
  else renderModal();
};
A.setStatus = d => {
  const u = db.users.find(x => x.id === d.user);
  openModal('confirm', { title: d.status === 'inactive' ? t('deactivate') : t('reactivate'), body: L(u.name), ok: d.status === 'inactive' ? t('deactivate') : t('reactivate'), danger: d.status === 'inactive', onOk: async () => { if (await call(() => api.setUserStatus(S.userId, d.user, d.status), d.status === 'inactive' ? t('deactivated') : t('reactivated'))) { closeModal(); render(); } } });
};
A.removePerson = d => openModal('confirm', { title: t('remove_person'), body: t('remove_person_note'), ok: t('remove_person'), danger: true, onOk: async () => { if (await call(() => api.removeUser(S.userId, d.user), t('removed'))) { closeModal(); go('people'); } } });
A.correctAttempt = d => openModal('correct', { kind: 'attempt', id: d.attempt });
A.correctSection = d => openModal('correct', { kind: 'section', userId: d.user, courseId: d.course });
MODALS.correct = m => {
  let body;
  if (m.kind === 'attempt') {
    const a = db.attempts.find(x => x.id === m.id);
    const ex = db.exams.find(x => x.id === a.examId);
    body = `${kv(t('exam'), esc(L(ex.title)) + ' · ' + t('attempt_n', { n: fmtNum(a.no) }) + ' · ' + fmtPct(a.scorePct))}${field(t('new_score'), input('value', a.scorePct, { type: 'number', min: 0, max: 100, im: 'numeric' }))}`;
  } else {
    const secs = db.sections.filter(s => s.courseId === m.courseId).sort((x, y) => x.pos - y.pos);
    body = `${field(t('mark_section_done'), select('id', secs.map(s => [s.id, `${s.pos}. ${L(s.title)}`]), secs[0] && secs[0].id))}<input type="hidden" name="value" value="1">`;
  }
  return {
    title: t('correct_record'),
    body: `<form id="correct-form" data-form="correct" class="stack">${body}${field(t('reason'), textarea('reason', '', { rows: 3 }), { hint: t('reason_hint') })}</form>`,
    foot: `${btn(t('cancel'), 'closeModal')}<button class="btn primary" type="submit" form="correct-form">${t('save')}</button>`
  };
};
F.correct = async d => {
  const m = S.modal;
  const payload = m.kind === 'attempt' ? { kind: 'attempt', id: m.id, value: d.value, reason: d.reason } : { kind: 'section', id: d.id, userId: m.userId, value: true, reason: d.reason };
  const r = await call(() => api.correctRecord(S.userId, payload), t('correction_saved'));
  if (r) { if (r.certificate) toast(t('cert_earned'), 'good'); closeModal(); render(); }
};

PAGES.personEdit = () => {
  const id = S.route.userId;
  const m = me();
  const u = id ? api.getUser(S.userId, id).user : { name: { en: '', ar: '' }, email: '', code: '', phone: '', role: 'staff', locationId: (scopedLocations()[0] || {}).id, teamId: '', title: '', hireDate: today(), lang: db.settings.defaultLang };
  const draft = S.pf.personDraft && S.pf.personDraft._id === (id || 'new') ? S.pf.personDraft : (S.pf.personDraft = { ...u, _id: id || 'new' });
  const e = S.formErr || {};
  const roles = m.assignableRoles.filter(r => r === 'staff' || m.perms.includes('users.role'));
  const roleOpts = (id && !roles.includes(u.role)) ? [[u.role, roleName(u.role)]] : roles.map(r => [r, roleName(r)]);
  const locs = scopedLocations();
  const fe = k => (e[k] ? t('field_err_' + e[k]) : '');
  return `<div class="page" style="max-width:860px">${backLink(id ? 'person' : 'people', id ? { 'user-id': id } : {})}
    ${pageHead(id ? t('edit') + ' · ' + L(u.name) : t('add_person'), t('minimal_data'))}
    <form class="card stack" data-form="person">
      <div class="form-grid">
        ${field(t('name_en'), input('nameEn', draft.name.en, { dir: 'ltr', invalid: e.nameEn }), { err: fe('nameEn') })}
        ${field(t('name_ar'), input('nameAr', draft.name.ar, { dir: 'rtl' }), { opt: true })}
        ${field(t('email'), input('email', draft.email, { type: 'email', dir: 'ltr', invalid: e.email, ac: 'off' }), { err: fe('email') })}
        ${field(t('employee_code'), input('code', draft.code, { dir: 'ltr', invalid: e.code }), { err: fe('code'), hint: t('login_id_hint') })}
        ${field(t('phone'), input('phone', draft.phone, { type: 'tel', dir: 'ltr', invalid: e.phone }), { opt: true, err: fe('phone') })}
        ${field(t('job_title'), input('title', draft.title), { opt: true })}
        ${field(t('role'), select('role', roleOpts, draft.role, { disabled: id === S.userId }), { hint: t('role_limited', { roles: roles.map(roleName).join(', ') }) })}
        ${field(t('location'), select('locationId', locs.map(l => [l.id, L(l.name)]), draft.locationId, { onChange: 'personLoc' }), { hint: m.scope.global ? '' : t('location_limited'), err: fe('locationId') })}
        ${field(t('team'), select('teamId', [['', t('no_team')], ...scopedTeams(draft.locationId).map(x => [x.id, L(x.name)])], draft.teamId || ''), { err: fe('teamId') })}
        ${field(t('hire_date'), input('hireDate', draft.hireDate || '', { type: 'date' }), { opt: true })}
        ${field(t('pref_language'), select('lang', [['ar', 'العربية'], ['en', 'English']], draft.lang || 'ar'))}
      </div>
      ${id ? '' : `<div class="divider"></div><div class="stack" style="gap:4px"><h3>${t('sign_in_section')}</h3><p class="small muted">${t('account_hint')}</p></div>
      <div class="form-grid">${field(t('password'), pwInput('password', { id: 'f-new-password', invalid: !!e.password }), { hint: t('pw_rules'), err: fe('password') })}${field(t('confirm_password'), pwInput('confirm', { id: 'f-new-confirm' }))}</div>
      ${checkbox('mustChange', draft.mustChange !== false, `<b>${t('must_change')}</b><br><span class="small muted">${t('must_change_hint')}</span>`, { id: 'f-new-must' })}`}
      <div class="row between"><span class="small muted">${t('server_checked')}</span><div class="row">${btn(t('cancel'), 'go', { data: id ? { r: 'person', 'user-id': id } : { r: 'people' } })}${btn(t('save'), null, { type: 'submit', kind: 'primary' })}</div></div>
    </form></div>`;
};
C.personLoc = (v, el) => {
  const form = el.form;
  const d = formData(form);
  Object.assign(S.pf.personDraft, { name: { en: d.nameEn, ar: d.nameAr }, email: d.email, code: d.code, phone: d.phone, title: d.title, role: d.role || S.pf.personDraft.role, locationId: v, teamId: '', hireDate: d.hireDate, lang: d.lang });
  render();
};
F.person = async d => {
  const id = S.route.userId;
  const payload = { name: { en: d.nameEn, ar: d.nameAr }, email: d.email, code: d.code, phone: d.phone, title: d.title, locationId: d.locationId, teamId: d.teamId || null, hireDate: d.hireDate, lang: d.lang };
  if (d.role) payload.role = d.role;
  Object.assign(S.pf.personDraft, payload, { mustChange: !!d.mustChange });
  if (!id && d.password !== d.confirm) { S.formErr = { password: 'pw_mismatch' }; toast(t('field_err_pw_mismatch'), 'bad'); render(); return; }
  const r = await call(() => (id ? api.updateUser(S.userId, id, payload) : api.createUser(S.userId, { role: 'staff', ...payload, password: d.password, mustChange: !!d.mustChange })), id ? t('saved') : t('created'));
  if (r) { S.pf.personDraft = null; go('person', { userId: r.id }); }
  else render();
};

/* ---------------- CSV import ---------------- */
PAGES.import = () => {
  const st = S.pf.import || (S.pf.import = { text: '', preview: null });
  const p = st.preview;
  const rows = p ? p.rows.map(r => `<tr><td class="num">${fmtNum(r.line)}</td><td>${esc(r.data.name.en)}${r.data.name.ar ? `<div class="small muted">${esc(r.data.name.ar)}</div>` : ''}</td><td class="small">${esc(r.data.email || r.data.code)}</td><td>${esc(locName(r.data.locationId) || '—')}</td><td>${pill(r.status, t('st_' + r.status))}</td><td class="small">${r.problems.map(x => esc(probText(x))).join(' · ')}</td></tr>`) : [];
  return `<div class="page">${backLink('people')}${pageHead(t('import_title'), t('import_sub'))}
    <div class="card stack"><div class="row between"><span class="small muted">${t('import_columns')}: <span class="mono" dir="ltr">${Core.IMPORT_COLUMNS.join(', ')}</span></span><div class="row">${btn(t('download_template'), 'importTemplate', { sm: true, icon: 'download' })}<label class="btn sm">${icon('upload', 'sm')}${t('choose_file')}<input type="file" accept=".csv,text/csv" class="sr" id="csv-file" data-on-change="csvFile"></label></div></div>
      <textarea class="input mono" id="csv-text" rows="7" dir="ltr" data-on-input="csvText" placeholder="employee_code,full_name_en,...">${esc(st.text)}</textarea>
      <div class="row">${btn(t('preview'), 'importPreview', { kind: p ? '' : 'primary', icon: 'eye' })}</div>
      ${p ? `<div class="divider"></div><div class="form-grid" style="align-items:end">${field(t('temp_password'), pwInput('temp', { id: 'f-temp' }), { hint: t('temp_password_hint') })}<div>${btn(t('import_n', { n: fmtNum(p.ready) }), 'importCommit', { kind: 'primary', icon: 'upload', disabled: !p.ready })}</div></div>` : ''}</div>
    ${p ? `<section class="stack"><h2>${t('preview')}</h2>${table([{ label: t('line'), num: true }, { label: t('name') }, { label: t('email') }, { label: t('location') }, { label: t('status') }, { label: t('details') }], rows)}</section>` : ''}</div>`;
};
function probText(x) {
  if (I18N.has('prob_' + x)) return t('prob_' + x);
  const [k, v] = x.split(':');
  return (I18N.has('field_err_' + v) ? t('field_err_' + v) : v) + ` (${k})`;
}
A.importTemplate = () => saveFile('btw-people-template.csv', Core.toCSV(Core.IMPORT_COLUMNS, []), 'text/csv');
I.csvText = v => { S.pf.import.text = v; S.pf.import.preview = null; };
C.csvFile = (v, el) => { const f = el.files && el.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { S.pf.import.text = String(rd.result || ''); S.pf.import.preview = null; render(); }; rd.readAsText(f); };
A.importPreview = async () => { const el = document.getElementById('csv-text'); if (el) S.pf.import.text = el.value; const p = await call(() => api.previewImport(S.userId, S.pf.import.text)); if (p) { S.pf.import.preview = p; render(); } };
A.importCommit = async () => { const temp = (document.getElementById('f-temp') || {}).value || ''; const r = await call(() => api.commitImport(S.userId, S.pf.import.text, temp)); if (r) { toast(t('import_done', { a: fmtNum(r.created), b: fmtNum(r.skipped) }), 'good'); S.pf.import = { text: '', preview: null }; go('people'); } };

/* ---------------- courses ---------------- */
PAGES.courses = () => {
  const list = api.listCoursesManage(S.userId);
  const cards = list.map(c => {
    const rv = c.reviewStatus === 'overdue' ? `<span class="pill warn">${t('review_overdue', { date: fmtDate(c.reviewDue) })}</span>` : c.reviewStatus === 'due_soon' ? `<span class="pill ochre">${t('review_soon', { date: fmtDate(c.reviewDue) })}</span>` : c.reviewDue ? `<span class="pill">${t('review_due', { date: fmtDate(c.reviewDue) })}</span>` : `<span class="pill">${t('no_review')}</span>`;
    return `<div class="card stack"><div class="row between top"><div class="grow"><span class="eyebrow mono">${esc(c.code)}</span><h3 style="margin-top:4px">${esc(L(c.title))}</h3></div>${pill(c.status)}</div>
      <div class="row small muted"><span>${t('version_n', { n: fmtNum(c.version) })}</span><span>·</span><span>${t('sections_count', { n: fmtNum(c.sections) })}</span><span>·</span><span>${t('enrolled_completed', { a: fmtNum(c.enrolled), b: fmtNum(c.completed) })}</span></div>
      <div class="row">${rv}</div>
      <div class="row">${btn(c.editable ? t('edit') : t('view'), 'go', { data: { r: 'courseEdit', 'course-id': c.id }, sm: true, kind: 'primary', icon: c.editable ? 'edit' : 'eye' })}${gbtn('content.edit', { courseId: c.id }, t('duplicate'), 'dupCourse', { sm: true, data: { course: c.id }, icon: 'copy' })}${c.status === 'published' && can('assign.manage', { courseId: c.id }) ? btn(t('assign'), 'go', { sm: true, data: { r: 'assign', course: c.id }, icon: 'send' }) : ''}</div></div>`;
  }).join('');
  return `<div class="page">${pageHead(t('courses'), t('courses_sub'), gbtn('content.edit', {}, t('new_course'), 'newCourse', { icon: 'plus', kind: 'primary' }))}<div class="grid2">${cards || empty(t('no_data'))}</div></div>`;
};
A.newCourse = () => openModal('newCourse');
MODALS.newCourse = () => ({
  title: t('new_course'),
  body: `<form id="nc-form" data-form="newCourse" class="form-grid">${field(t('title_en'), input('en', '', { dir: 'ltr' }))}${field(t('title_ar'), input('ar', '', { dir: 'rtl' }))}${field(t('course_code'), input('code', '', { dir: 'ltr', ph: 'BAR-220' }), { opt: true })}${field(t('due_days'), input('dueDays', db.settings.defaultDueDays || 14, { type: 'number', min: 1, max: 365 }))}</form>`,
  foot: `${btn(t('cancel'), 'closeModal')}<button class="btn primary" type="submit" form="nc-form">${t('save')}</button>`
});
F.newCourse = async d => { const c = await call(() => api.createCourse(S.userId, { title: { en: d.en, ar: d.ar }, code: d.code, dueDays: d.dueDays }), t('created')); if (c) { closeModal(); go('courseEdit', { courseId: c.id }); } };
A.dupCourse = async d => { const c = await call(() => api.duplicateCourse(S.userId, d.course), t('duplicated')); if (c) go('courseEdit', { courseId: c.id }); };

PAGES.courseEdit = () => {
  const v = api.getCourseManage(S.userId, S.route.courseId);
  const c = v.course;
  const ro = !v.canEdit;
  const secs = v.sections.map((s, i) => `<div class="li"><span class="sec-n">${fmtNum(i + 1)}</span><span class="grow"><b>${esc(L(s.title))}</b><div class="small muted">${esc(t('cards_n', { n: fmtNum(s.files.length) }))} · ${s.exam ? t('has_quiz') + ` (${fmtNum(s.exam.questions.length)})` : t('no_quiz')}${s.required ? '' : ' · ' + t('optional')}${s.skill ? ' · ' + t('has_skill') : ''}</div></span>
      <div class="row" style="gap:4px">${v.canEdit ? `${btn('', 'moveSection', { sm: true, kind: 'ghost', icon: 'up', aria: t('move_up'), data: { section: s.id, dir: -1 }, disabled: i === 0 })}${btn('', 'moveSection', { sm: true, kind: 'ghost', icon: 'down', aria: t('move_down'), data: { section: s.id, dir: 1 }, disabled: i === v.sections.length - 1 })}` : ''}${btn(ro && !v.canFiles && !v.canExams ? t('view') : t('edit'), 'go', { sm: true, data: { r: 'sectionEdit', 'section-id': s.id }, icon: 'chev' })}</div></div>`).join('');
  const versions = v.versions.length ? `<div class="list">${v.versions.map(x => `<div class="li"><span class="pill accent">v${fmtNum(x.version)}</span><span class="grow"><b>${esc(x.note || '—')}</b><div class="small muted">${esc(userName(x.publishedBy))} · ${esc(fmtDate(x.publishedAt))} · ${x.retrain ? t('retrain_yes') : t('retrain_no')}</div></span></div>`).join('')}</div>` : `<p class="small muted">${t('st_draft')}</p>`;
  const publishBox = c.version === 0
    ? `<div class="row">${gbtn('content.publish', { courseId: c.id }, t('publish_v1'), 'publishCourse', { kind: 'primary', data: { course: c.id }, icon: 'send' })}</div>`
    : `<form class="stack" data-form="newVersion">${field(t('version_note'), input('note', '', { ph: S.lang === 'ar' ? 'مثال: وصفة جديدة للكولد برو' : 'e.g. New cold brew recipe' }))}${checkbox('retrain', false, `<b>${t('retrain_q')}</b><br><span class="small muted">${t('retrain_hint')}</span>`, { disabled: !v.canPublish })}<div>${v.canPublish ? btn(t('new_version'), null, { type: 'submit', kind: 'primary', icon: 'send' }) : gbtn('content.publish', { courseId: c.id }, t('new_version'), null)}</div></form>`;
  return `<div class="page">${backLink('courses')}
    <div class="page-head"><div class="grow"><div class="row small">${pill(c.status)}<span class="muted mono">${esc(c.code)}</span><span class="muted">${t('version_n', { n: fmtNum(c.version) })}</span></div><h1 style="margin-top:6px">${esc(L(c.title))}</h1></div>
      <div class="row">${c.status === 'published' ? gbtn('content.publish', { courseId: c.id }, t('archive'), 'courseStatus', { data: { course: c.id, status: 'archived' } }) : c.status === 'archived' ? gbtn('content.publish', { courseId: c.id }, t('restore'), 'courseStatus', { data: { course: c.id, status: 'published' } }) : ''}${gbtn('content.edit', { courseId: c.id }, t('duplicate'), 'dupCourse', { data: { course: c.id }, icon: 'copy' })}</div></div>
    ${ro ? `<div class="notice">${icon('lock')}<span>${t('read_only_course')}</span></div>` : ''}
    <form class="card stack" data-form="courseDetails"><h2>${t('course_details')}</h2><div class="form-grid">
      ${field(t('title_en'), input('en', c.title.en, { dir: 'ltr', disabled: ro }))}${field(t('title_ar'), input('ar', c.title.ar, { dir: 'rtl', disabled: ro }))}
      ${field(t('desc_en'), textarea('den', c.desc.en, { dir: 'ltr', disabled: ro }))}${field(t('desc_ar'), textarea('dar', c.desc.ar, { dir: 'rtl', disabled: ro }))}
      ${field(t('course_code'), input('code', c.code, { dir: 'ltr', disabled: ro }))}${field(t('due_days'), input('dueDays', c.dueDays, { type: 'number', min: 1, max: 365, disabled: ro }))}
      ${field(t('review_date'), input('reviewDue', c.reviewDue || '', { type: 'date', disabled: ro }))}</div>
      ${ro ? '' : `<div>${btn(t('save'), null, { type: 'submit', kind: 'primary' })}</div>`}</form>
    <section class="stack"><div class="row between"><h2>${t('course_sections')}</h2>${gbtn('content.edit', { courseId: c.id }, t('add_section'), 'addSection', { icon: 'plus', data: { course: c.id } })}</div><div class="list">${secs || empty(t('no_data'))}</div></section>
    <section class="card row between"><div><span class="eyebrow">${t('final_assessment')}</span><h3>${v.final ? esc(L(v.final.title)) + ` · ${fmtNum(v.final.questions.length)} ${S.lang === 'ar' ? 'أسئلة' : 'questions'} · ${fmtPct(v.final.passPct)}` : '—'}</h3></div>${gbtn('exams.manage', { courseId: c.id }, v.final ? t('edit_final') : t('add_final'), 'go', { data: { r: 'examEdit', 'course-id': c.id }, icon: 'edit' })}</section>
    <div class="grid2"><section class="card stack"><h2>${c.version === 0 ? t('publish') : t('new_version')}</h2>${publishBox}</section><section class="card stack"><h2>${t('versions')}</h2>${versions}</section></div>
    ${v.skills.length ? `<section class="card stack"><h2>${t('practical_title')}</h2><div class="list">${v.skills.map(k => `<div class="li">${icon('clipboard')}<span class="grow"><b>${esc(L(k.title))}</b><div class="small muted">${esc(L(k.desc))}</div></span></div>`).join('')}</div></section>` : ''}
    ${v.canDelete ? `<details class="card"><summary>${t('delete_course')}</summary><div class="stack" style="margin-top:10px"><p class="small muted">${t('delete_course_note')}</p><div>${btn(t('delete_course'), 'deleteCourse', { kind: 'danger', icon: 'trash', data: { course: c.id } })}</div></div></details>` : ''}
  </div>`;
};
F.courseDetails = async d => { if (await call(() => api.updateCourse(S.userId, S.route.courseId, { title: { en: d.en, ar: d.ar }, desc: { en: d.den, ar: d.dar }, code: d.code, dueDays: d.dueDays, reviewDue: d.reviewDue }), t('saved'))) render(); };
A.moveSection = async d => { if (await call(() => api.moveSection(S.userId, d.section, Number(d.dir)))) render(); };
A.addSection = d => openModal('section', { courseId: d.course });
MODALS.section = m => ({
  title: t('add_section'),
  body: `<form id="sec-form" data-form="newSection" class="form-grid">${field(t('section_title_en'), input('en', '', { dir: 'ltr' }))}${field(t('section_title_ar'), input('ar', '', { dir: 'rtl' }))}${field(t('intro_en'), textarea('ien', '', { dir: 'ltr' }))}${field(t('intro_ar'), textarea('iar', '', { dir: 'rtl' }))}</form>`,
  foot: `${btn(t('cancel'), 'closeModal')}<button class="btn primary" type="submit" form="sec-form">${t('save')}</button>`
});
F.newSection = async d => { const s = await call(() => api.saveSection(S.userId, { courseId: S.modal.courseId, title: { en: d.en, ar: d.ar }, intro: { en: d.ien, ar: d.iar } }), t('saved')); if (s) { closeModal(); go('sectionEdit', { sectionId: s.id }); } };
A.publishCourse = async d => { const r = await call(() => api.publishCourse(S.userId, d.course, ''), t('published')); if (r) render(); };
F.newVersion = async d => {
  const r = await call(() => api.publishCourse(S.userId, S.route.courseId, d.note, !!d.retrain));
  if (r) { toast(t('version_published', { n: fmtNum(r.course.version), r: fmtNum(r.retrained) }), 'good'); render(); }
};
A.courseStatus = async d => { if (await call(() => api.setCourseStatus(S.userId, d.course, d.status), d.status === 'archived' ? t('archived') : t('saved'))) render(); };
A.deleteCourse = d => openModal('confirm', { title: t('delete_course'), body: t('delete_course_note'), danger: true, ok: t('delete'), onOk: async () => { if (await call(() => api.deleteCourse(S.userId, d.course), t('deleted'))) { closeModal(); go('courses'); } } });

/* ---------------- section editor ---------------- */
PAGES.sectionEdit = () => {
  const s0 = db.sections.find(x => x.id === S.route.sectionId);
  if (!s0) throw new Core.ApiError('not_found');
  const v = api.getCourseManage(S.userId, s0.courseId);
  const s = v.sections.find(x => x.id === s0.id);
  const cards = s.files.map((f, i) => `<div class="li card-row"><span class="card-n">${fmtNum(i + 1)}</span><span class="ftype pdf">PDF</span>
      <span class="grow stack" style="gap:2px;min-width:0"><b style="overflow-wrap:anywhere">${esc(f.title)}</b><span class="tiny muted">${f.path ? esc(fmtSize(f.size)) : esc(t('card_no_pdf'))}</span></span>
      <div class="row" style="gap:4px">${btn('', 'previewCard', { sm: true, kind: 'ghost', icon: 'eye', aria: t('preview'), data: { i } })}${v.canFiles ? `${btn('', 'moveFile', { sm: true, kind: 'ghost', icon: 'up', aria: t('move_up'), data: { file: f.id, dir: -1 }, disabled: i === 0 })}${btn('', 'moveFile', { sm: true, kind: 'ghost', icon: 'down', aria: t('move_down'), data: { file: f.id, dir: 1 }, disabled: i === s.files.length - 1 })}${btn('', 'renameCard', { sm: true, kind: 'ghost', icon: 'edit', aria: t('rename'), data: { file: f.id } })}${btn(t('replace'), 'replaceCard', { sm: true, data: { section: s.id, file: f.id } })}${btn('', 'removeFile', { sm: true, kind: 'danger', icon: 'trash', aria: t('remove'), data: { file: f.id } })}` : ''}</div></div>`).join('');
  const ro = !v.canEdit;
  return `<div class="page">${backLink('courseEdit', { 'course-id': v.course.id })}
    ${pageHead(L(s.title), L(v.course.title))}
    <form class="card stack" data-form="sectionDetails"><h2>${t('section_editor')}</h2><div class="form-grid">
      ${field(t('section_title_en'), input('en', s.title.en, { dir: 'ltr', disabled: ro }))}${field(t('section_title_ar'), input('ar', s.title.ar, { dir: 'rtl', disabled: ro }))}
      ${field(t('intro_en'), textarea('ien', s.intro.en, { dir: 'ltr', disabled: ro }))}${field(t('intro_ar'), textarea('iar', s.intro.ar, { dir: 'rtl', disabled: ro }))}</div>
      ${checkbox('required', s.required, t('required_section'), { disabled: ro })}
      ${checkbox('hasSkill', !!s.skill, `<b>${t('section_has_skill')}</b><br><span class="small muted">${t('section_has_skill_hint')}</span>`, { disabled: ro })}
      <div class="form-grid">
        ${field(t('skill_title_en'), input('ken', s.skill ? s.skill.title.en : '', { dir: 'ltr', disabled: ro, ph: s.title.en }))}${field(t('skill_title_ar'), input('kar', s.skill ? s.skill.title.ar : '', { dir: 'rtl', disabled: ro, ph: s.title.ar }))}
        ${field(t('skill_desc_en'), textarea('kden', s.skill ? s.skill.desc.en : '', { dir: 'ltr', disabled: ro }))}${field(t('skill_desc_ar'), textarea('kdar', s.skill ? s.skill.desc.ar : '', { dir: 'rtl', disabled: ro }))}</div>
      <div class="row">${ro ? '' : btn(t('save'), null, { type: 'submit', kind: 'primary' })}${gbtn('content.edit', { courseId: v.course.id }, t('remove'), 'removeSection', { data: { section: s.id }, kind: 'danger', icon: 'trash' })}</div></form>
    <section class="stack"><div class="row between"><div><h2>${t('product_cards')}</h2><p class="small muted">${t('cards_editor_hint')}</p></div>${gbtn('files.manage', { courseId: v.course.id }, t('upload_cards'), 'pickCards', { data: { section: s.id }, icon: 'upload', kind: 'primary' })}</div>
      <input type="file" id="card-files" accept="application/pdf,.pdf" multiple hidden data-on-change="cardFiles" data-section="${esc(s.id)}">
      <div class="list">${cards || empty(t('no_files'), 'file')}</div></section>
    <section class="card row between"><div><span class="eyebrow">${t('quiz')}</span><h3>${s.exam ? `${esc(L(s.exam.title))} · ${fmtNum(s.exam.questions.length)} · ${fmtPct(s.exam.passPct)}` : t('no_quiz')}</h3></div>${gbtn('exams.manage', { courseId: v.course.id }, s.exam ? t('edit') : t('add'), 'go', { data: { r: 'examEdit', 'course-id': v.course.id, 'section-id': s.id }, icon: 'edit' })}</section>
  </div>`;
};
F.sectionDetails = async d => { if (await call(() => api.saveSection(S.userId, { id: S.route.sectionId, title: { en: d.en, ar: d.ar }, intro: { en: d.ien, ar: d.iar }, required: !!d.required, skill: { enabled: !!d.hasSkill, title: { en: d.ken || '', ar: d.kar || '' }, desc: { en: d.kden || '', ar: d.kdar || '' } } }), t('saved'))) render(); };
A.removeSection = d => openModal('confirm', { title: t('remove'), body: t('remove_section_q'), danger: true, ok: t('remove'), onOk: async () => { const cid = db.sections.find(x => x.id === d.section).courseId; if (await call(() => api.removeSection(S.userId, d.section), t('deleted'))) { closeModal(); go('courseEdit', { courseId: cid }); } } });
A.moveFile = async d => { if (await call(() => api.moveFile(S.userId, d.file, Number(d.dir)))) render(); };
A.removeFile = async d => { if (await call(() => api.removeFile(S.userId, d.file), t('file_removed'))) render(); };
A.previewCard = d => { const s0 = db.sections.find(x => x.id === S.route.sectionId); go('cards', { courseId: s0.courseId, sectionId: s0.id, preview: '1', i: Number(d.i) || 0 }); };

/* ---------------- exam editor ---------------- */
function blankQ(type) {
  return type === 'tf'
    ? { type: 'tf', prompt: { en: '', ar: '' }, choices: [{ text: { en: 'True', ar: 'صح' }, correct: true }, { text: { en: 'False', ar: 'خطأ' }, correct: false }] }
    : { type: 'mc', prompt: { en: '', ar: '' }, choices: [{ text: { en: '', ar: '' }, correct: true }, { text: { en: '', ar: '' }, correct: false }, { text: { en: '', ar: '' }, correct: false }] };
}
PAGES.examEdit = () => {
  const { courseId, sectionId } = S.route;
  const key = courseId + ':' + (sectionId || 'final');
  if (!S.examDraft || S.examDraft._key !== key) {
    const ex = sectionId ? db.exams.find(x => x.sectionId === sectionId) : db.exams.find(x => x.courseId === courseId && x.kind === 'final');
    S.examDraft = ex ? JSON.parse(JSON.stringify(ex)) : { title: sectionId ? { en: 'Section quiz', ar: 'اختبار القسم' } : { en: 'Final assessment', ar: 'التقييم النهائي' }, passPct: 80, timeLimitMin: 10, maxAttempts: 3, allowRetake: true, review: 'after_submit', shuffle: !sectionId, questions: [blankQ('mc')] };
    S.examDraft._key = key; S.examDraft.sectionId = sectionId || null; S.examDraft.courseId = courseId;
  }
  S.bindTarget = () => S.examDraft;
  const x = S.examDraft;
  const ctxTitle = sectionId ? L((db.sections.find(s => s.id === sectionId) || {}).title) : t('final_assessment');
  const qs = x.questions.map((q, qi) => `<div class="card stack"><div class="row between"><span class="eyebrow">${t('question_of', { a: fmtNum(qi + 1), b: fmtNum(x.questions.length) })} · ${q.type === 'tf' ? t('q_type_tf') : t('q_type_mc')}</span>${btn('', 'exRemoveQ', { sm: true, kind: 'danger', icon: 'trash', aria: t('remove_question'), data: { q: qi } })}</div>
      <div class="form-grid">${field(t('prompt_en'), input('p' + qi + 'en', q.prompt.en, { dir: 'ltr', bind: `questions.${qi}.prompt.en`, id: `ex-${qi}-pen` }))}${field(t('prompt_ar'), input('p' + qi + 'ar', q.prompt.ar, { dir: 'rtl', bind: `questions.${qi}.prompt.ar`, id: `ex-${qi}-par` }))}</div>
      <span class="tiny muted">${t('pick_correct')}</span><div class="stack" style="gap:8px">${q.choices.map((c, ci) => `<div class="row" style="flex-wrap:nowrap;align-items:center"><label class="check" style="padding:0" title="${esc(t('correct_choice'))}"><input type="radio" name="correct-${qi}" ${c.correct ? 'checked' : ''} data-on-change="exCorrect" data-q="${qi}" data-c="${ci}" aria-label="${esc(t('correct_choice'))}"></label>
        ${q.type === 'tf' ? `<span class="grow">${esc(L(c.text))}</span>` : `<div class="grow form-grid" style="gap:8px">${input(`c${qi}${ci}en`, c.text.en, { dir: 'ltr', ph: t('choice') + ' ' + (ci + 1) + ' · EN', bind: `questions.${qi}.choices.${ci}.text.en`, id: `ex-${qi}-${ci}-en` })}${input(`c${qi}${ci}ar`, c.text.ar, { dir: 'rtl', ph: t('choice') + ' ' + (ci + 1) + ' · ع', bind: `questions.${qi}.choices.${ci}.text.ar`, id: `ex-${qi}-${ci}-ar` })}</div>${q.choices.length > 2 ? btn('', 'exRemoveC', { sm: true, kind: 'ghost', icon: 'x', aria: t('remove'), data: { q: qi, c: ci } }) : ''}`}</div>`).join('')}
      ${q.type === 'mc' && q.choices.length < 6 ? `<div>${btn(t('add_choice'), 'exAddC', { sm: true, kind: 'ghost', icon: 'plus', data: { q: qi } })}</div>` : ''}</div></div>`).join('');
  const errs = S.pf.examErrs;
  return `<div class="page" style="max-width:900px">${backLink(sectionId ? 'sectionEdit' : 'courseEdit', sectionId ? { 'section-id': sectionId } : { 'course-id': courseId })}
    ${pageHead(t('exam_editor'), ctxTitle)}
    ${errs && errs.length ? `<div class="notice bad">${icon('alert')}<span>${esc(t('exam_errors', { list: errs.join(', ') }))}</span></div>` : ''}
    <div class="card stack"><div class="form-grid">
      ${field(t('title_en'), input('ten', x.title.en, { dir: 'ltr', bind: 'title.en', id: 'ex-ten' }))}${field(t('title_ar'), input('tar', x.title.ar, { dir: 'rtl', bind: 'title.ar', id: 'ex-tar' }))}
      ${field(t('pass_pct'), input('passPct', x.passPct, { type: 'number', min: 1, max: 100, bind: 'passPct', id: 'ex-pass' }))}
      ${field(t('time_limit_min'), input('timeLimitMin', x.timeLimitMin, { type: 'number', min: 0, max: 180, bind: 'timeLimitMin', id: 'ex-time' }))}
      ${field(t('max_attempts'), input('maxAttempts', x.maxAttempts, { type: 'number', min: 0, max: 10, bind: 'maxAttempts', id: 'ex-att' }))}
      ${field(t('review_mode'), select('review', [['after_submit', t('review_after_submit')], ['after_pass', t('review_after_pass')], ['none', t('review_none')]], x.review, { bind: 'review', id: 'ex-review' }))}</div>
      <div class="row">${checkbox('allowRetake', x.allowRetake, t('allow_retake'), { bind: 'allowRetake', id: 'ex-retake' })}${checkbox('shuffle', x.shuffle, t('shuffle'), { bind: 'shuffle', id: 'ex-shuffle' })}</div></div>
    ${qs}
    <div class="row">${btn(t('add_mc'), 'exAddQ', { icon: 'plus', data: { type: 'mc' } })}${btn(t('add_tf'), 'exAddQ', { icon: 'plus', data: { type: 'tf' } })}</div>
    <div class="row between card"><span class="small muted">${t('exam_server_note')}</span>${btn(t('save'), 'exSave', { kind: 'primary', icon: 'check' })}</div></div>`;
};
A.exAddQ = d => { S.examDraft.questions.push(blankQ(d.type)); render(); };
A.exRemoveQ = d => { S.examDraft.questions.splice(Number(d.q), 1); render(); };
A.exAddC = d => { S.examDraft.questions[Number(d.q)].choices.push({ text: { en: '', ar: '' }, correct: false }); render(); };
A.exRemoveC = d => { const q = S.examDraft.questions[Number(d.q)]; const wasRight = q.choices[Number(d.c)].correct; q.choices.splice(Number(d.c), 1); if (wasRight) q.choices[0].correct = true; render(); };
C.exCorrect = (v, el) => { const q = S.examDraft.questions[Number(el.dataset.q)]; q.choices.forEach((c, i) => { c.correct = i === Number(el.dataset.c); }); };
A.exSave = async () => {
  const x = S.examDraft;
  busy(1);
  try {
    const saved = await api.saveExam(S.userId, { ...x, id: x.id, sectionId: x.sectionId, courseId: x.courseId });
    persist(); S.pf.examErrs = null; S.examDraft = null; toast(t('exam_saved'), 'good');
    go(x.sectionId ? 'sectionEdit' : 'courseEdit', x.sectionId ? { sectionId: x.sectionId } : { courseId: x.courseId });
    return saved;
  } catch (e) {
    S.pf.examErrs = Array.isArray(e.detail) ? e.detail : null;
    toast(errMsg(e), 'bad'); render();
  } finally { busy(-1); }
};

/* ---------------- assign ---------------- */
PAGES.assign = () => {
  const st = S.pf.assign || (S.pf.assign = { kind: 'team', courseId: S.route.course || '', targetId: '', role: 'staff', dueOn: '' });
  if (S.route.course && !st.courseId) st.courseId = S.route.course;
  const courses = db.courses.filter(c => c.status === 'published' && api.check(S.userId, 'assign.manage', { courseId: c.id }).ok);
  const c = db.courses.find(x => x.id === st.courseId);
  const due = st.dueOn || plusDays((c && c.dueDays) || 14);
  let targetCtl;
  if (st.kind === 'user') targetCtl = select('targetId', [['', t('choose')], ...api.listUsers(S.userId, { status: 'active' }).filter(u => u.id !== S.userId).map(u => [u.id, `${L(u.name)} · ${locName(u.locationId)}`])], st.targetId, { onChange: 'assignF', id: 'as-target' });
  else if (st.kind === 'team') targetCtl = select('targetId', [['', t('choose')], ...scopedTeams().map(x => [x.id, `${L(x.name)} · ${locName(x.locationId)}`])], st.targetId, { onChange: 'assignF', id: 'as-target' });
  else if (st.kind === 'location') targetCtl = select('targetId', [['', t('choose')], ...(me().scope.global ? db.locations : db.locations.filter(l => me().scope.locations.includes(l.id))).map(l => [l.id, L(l.name)])], st.targetId, { onChange: 'assignF', id: 'as-target' });
  else targetCtl = select('role', Core.ROLES.map(r => [r, roleName(r)]), st.role, { onChange: 'assignF', id: 'as-role' });
  const past = api.listAssignments(S.userId).slice(0, 12).map(g => {
    const tgt = g.target.kind === 'role' ? roleName(g.target.role) : g.target.kind === 'team' ? teamName(g.target.id) : g.target.kind === 'location' ? locName(g.target.id) : (g.target.ids || [g.target.id]).map(userName).join(', ');
    return `<tr><td><b>${esc(L(g.course))}</b></td><td>${esc(t('target_' + g.target.kind))}: ${esc(tgt)}</td><td>${esc(g.dueOn ? fmtDate(g.dueOn) : '—')}</td><td>${esc(userName(g.assignedBy))}</td><td>${esc(fmtDate(g.at))}</td></tr>`;
  });
  return `<div class="page" style="max-width:960px">${pageHead(t('assign'), t('assign_sub'))}
    <form class="card stack" data-form="assign"><div class="form-grid">
      ${field(t('course'), select('courseId', [['', t('choose')], ...courses.map(x => [x.id, `${L(x.title)} · v${x.version}`])], st.courseId, { onChange: 'assignF', id: 'as-course' }))}
      ${field(t('assign_to'), select('kind', [['user', t('target_user')], ['team', t('target_team')], ['location', t('target_location')], ['role', t('target_role')]], st.kind, { onChange: 'assignF', id: 'as-kind' }))}
      ${field(st.kind === 'role' ? t('role') : t('choose'), targetCtl)}
      ${field(t('due_date'), input('dueOn', due, { type: 'date', min: today(), id: 'as-due' }))}</div>
      <div class="row between"><span class="small muted">${t('server_checked')}</span>${btn(t('assign_btn'), null, { type: 'submit', kind: 'primary', icon: 'send' })}</div></form>
    <section class="stack"><h2>${t('past_assignments')}</h2>${table([{ label: t('course') }, { label: t('assign_to') }, { label: t('due_date') }, { label: t('by') }, { label: t('date') }], past)}</section></div>`;
};
C.assignF = (v, el) => { const st = S.pf.assign; st[el.name] = v; if (el.name === 'kind') st.targetId = ''; if (el.name === 'courseId') st.dueOn = ''; render(); };
F.assign = async d => {
  const st = S.pf.assign;
  if (!d.courseId) { toast(t('err_invalid'), 'bad'); return; }
  const target = st.kind === 'role' ? { kind: 'role', role: d.role || st.role } : { kind: st.kind, id: d.targetId };
  if (st.kind !== 'role' && !d.targetId) { toast(t('err_invalid'), 'bad'); return; }
  const r = await call(() => api.assign(S.userId, { courseId: d.courseId, target, dueOn: d.dueOn }));
  if (r) { toast(t('assigned_result', { a: fmtNum(r.created), b: fmtNum(r.skipped) }), 'good'); render(); }
};

/* ---------------- sign-offs ---------------- */
PAGES.signoffs = () => {
  const f = S.pf.signoffs || (S.pf.signoffs = {});
  const rows = api.listSignoffs(S.userId, cleanFilters(f));
  const courses = db.courses.filter(c => db.skills.some(k => k.courseId === c.id) && c.status === 'published');
  const tr = rows.map(r => `<tr><td><b>${esc(L(r.user.name))}</b><div class="small muted">${esc(locName(r.user.locationId))}</div></td><td>${esc(L(r.skill.title))}<div class="small muted">${esc(L(r.course))}</div></td><td>${pill(r.signoff ? r.signoff.status : 'not_assessed')}${r.signoff ? `<div class="tiny muted">${esc(userName(r.signoff.by))} · ${esc(fmtDate(r.signoff.at))}</div>` : ''}</td><td>${btn(t('set_status'), 'signoff', { sm: true, data: { skill: r.skill.id, user: r.user.id }, icon: 'clipboard' })}</td></tr>`);
  return `<div class="page">${pageHead(t('signoffs'), t('signoffs_sub'))}
    <div class="card filters">${field(t('course'), select('courseId', [['', t('all')], ...courses.map(c => [c.id, L(c.title)])], f.courseId || '', { onChange: 'soF', id: 'so-course' }))}${field(t('location'), select('locationId', [['', t('all')], ...scopedLocations().map(l => [l.id, L(l.name)])], f.locationId || '', { onChange: 'soF', id: 'so-loc' }))}</div>
    ${table([{ label: t('name') }, { label: t('skill') }, { label: t('status') }, { label: '' }], tr)}</div>`;
};
C.soF = (v, el) => { S.pf.signoffs[el.name] = v; render(); };
A.signoff = d => openModal('signoff', { skillId: d.skill, userId: d.user });
MODALS.signoff = m => {
  const k = db.skills.find(x => x.id === m.skillId);
  const u = db.users.find(x => x.id === m.userId);
  const cur = db.signoffs.filter(s => s.skillId === k.id && s.userId === u.id).sort((a, b) => (a.at < b.at ? 1 : -1))[0];
  return {
    title: L(k.title),
    body: `<p><b>${esc(L(u.name))}</b> · <span class="muted">${esc(L(k.desc))}</span></p><form id="so-form" data-form="signoff" class="stack">
      <div class="stack" style="gap:8px">${['passed', 'needs_practice', 'not_assessed'].map(s => `<label class="opt"><input type="radio" name="status" value="${s}" ${(cur ? cur.status : 'passed') === s ? 'checked' : ''}><span>${pill(s)}</span></label>`).join('')}</div>
      ${field(t('notes'), textarea('notes', '', { rows: 3 }), { opt: true })}</form>`,
    foot: `${btn(t('cancel'), 'closeModal')}<button class="btn primary" type="submit" form="so-form">${t('save')}</button>`
  };
};
F.signoff = async d => { const m = S.modal; const r = await call(() => api.setSignoff(S.userId, m.skillId, m.userId, d.status, d.notes), t('signoff_saved')); if (r) { if (r.certificate) toast(t('signoff_cert'), 'good'); closeModal(); render(); } };

/* ---------------- certificates admin ---------------- */
PAGES.certsAdmin = () => {
  const f = S.pf.certs || (S.pf.certs = {});
  const list = api.listCerts(S.userId, cleanFilters(f));
  const rows = list.map(c => { const ctx = { userId: c.userId }; return `<tr><td class="mono small">${esc(c.no)}</td><td><b>${esc(L(c.holder))}</b></td><td>${esc(L(c.courseTitle))} <span class="muted small">v${fmtNum(c.version)}</span></td><td>${esc(fmtDate(c.completedOn))}</td><td>${pill(c.status)}</td><td><div class="row" style="gap:6px;flex-wrap:nowrap">${btn(t('view'), 'go', { sm: true, data: { r: 'cert', 'cert-id': c.id }, icon: 'eye' })}${c.status !== 'replaced' ? gbtn('certs.reissue', ctx, t('reissue'), 'certAction', { sm: true, data: { cert: c.id, mode: 'reissue' } }) : ''}${c.status === 'valid' ? gbtn('certs.revoke', ctx, t('revoke'), 'certAction', { sm: true, data: { cert: c.id, mode: 'revoke' }, kind: 'danger' }) : ''}</div></td></tr>`; });
  return `<div class="page">${pageHead(t('certs_manage'), t('certs_sub'), btn(t('verify'), 'go', { data: { r: 'verify' }, icon: 'search' }))}
    <div class="card filters">${field(t('search'), input('q', f.q || '', { type: 'search', onInput: 'certQ', id: 'cert-q', ph: 'YCC-2026-…' }))}${field(t('status'), select('status', [['', t('all')], ['valid', t('st_valid')], ['revoked', t('st_revoked')], ['replaced', t('st_replaced')]], f.status || '', { onChange: 'certF', id: 'cert-st' }))}</div>
    ${table([{ label: t('cert_id') }, { label: t('name') }, { label: t('course') }, { label: t('completed_date') }, { label: t('status') }, { label: '' }], rows)}</div>`;
};
I.certQ = v => { S.pf.certs.q = v; render(); };
C.certF = (v, el) => { S.pf.certs[el.name] = v; render(); };
A.certAction = d => openModal('certAction', { certId: d.cert, mode: d.mode });
MODALS.certAction = m => {
  const c = db.certs.find(x => x.id === m.certId);
  return {
    title: m.mode === 'revoke' ? t('revoke_title') : t('reissue_title'),
    body: `<p><b class="mono">${esc(c.no)}</b><br>${esc(L(c.holder))} · ${esc(L(c.courseTitle))}</p><form id="ca-form" data-form="certAction">${field(t('reason'), textarea('reason', '', { rows: 3 }), { hint: t('reason_hint') })}</form>`,
    foot: `${btn(t('cancel'), 'closeModal')}<button class="btn ${m.mode === 'revoke' ? 'danger' : 'primary'}" type="submit" form="ca-form">${m.mode === 'revoke' ? t('revoke') : t('reissue')}</button>`
  };
};
F.certAction = async d => { const m = S.modal; const r = await call(() => (m.mode === 'revoke' ? api.revokeCert(S.userId, m.certId, d.reason) : api.reissueCert(S.userId, m.certId, d.reason)), m.mode === 'revoke' ? t('revoked') : t('reissued')); if (r) { closeModal(); render(); } };

/* ---------------- reports ---------------- */
PAGES.reports = () => {
  const reps = ['people', 'courses', 'sections', 'support'];
  const hist = api.listExports(S.userId).filter(x => x.kind === 'report').slice(0, 15).map(x => `<tr><td>${esc(t('rep_' + x.report))}</td><td>${esc(userName(x.by))}</td><td class="num">${fmtNum(x.rows)}</td><td>${esc(fmtDateTime(x.finishedAt || x.startedAt))}</td></tr>`);
  return `<div class="page">${pageHead(t('reports'), t('reports_sub'), btn(t('summary_pdf'), 'summaryPdf', { kind: 'primary', icon: 'download' }))}
    ${filterBar(S.dash, { people: true })}<p class="small muted">${t('filters_apply')}</p>
    <div class="grid2">${reps.map(r => `<div class="card row between"><div><h3>${t('rep_' + r)}</h3><p class="small muted">CSV</p></div><div class="row">${btn(t('download_csv'), 'csv', { sm: true, data: { rep: r }, icon: 'download' })}</div></div>`).join('')}</div>
    <section class="stack"><h2>${t('export_history')}</h2>${table([{ label: t('reports') }, { label: t('by') }, { label: t('rows'), num: true }, { label: t('when') }], hist)}</section></div>`;
};
A.csv = async d => { const r = await call(() => api.exportReport(S.userId, d.rep, cleanFilters(S.dash), S.lang)); if (r && await saveFile(r.filename, r.csv, 'text/csv')) { toast(t('csv_saved'), 'good'); render(); } };
A.summaryPdf = async () => {
  if (!window.jspdf) { toast(t('download_unavailable'), 'bad'); return; }
  const k = readSafe(() => api.kpis(S.userId, cleanFilters(S.dash)));
  if (!k) return;
  toast(t('preparing_pdf'));
  const cv = await drawSummary(k);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  doc.addImage(cv.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, 210, 297);
  if (await saveFile(`training-summary-${today()}.pdf`, doc.output('blob'), 'application/pdf')) toast(t('pdf_ready'), 'good');
};

/* ---------------- reminders ---------------- */
PAGES.reminders = () => {
  const rules = api.listRules(S.userId);
  const email = db.integrations.email.provider;
  const cards = rules.map(r => `<div class="card stack"><div class="row between top"><div class="grow"><span class="eyebrow">${t('tr_' + r.trigger)}</span><h3 style="margin-top:4px">${esc(t('rule_summary_' + r.trigger, { d: fmtNum(r.days), e: fmtNum(r.every), m: fmtNum(r.max) }))}</h3></div>${pill(r.active ? 'active' : 'not_started', r.active ? t('active') : t('paused'))}</div>
    <p class="small" style="background:var(--sunk);border-radius:8px;padding:8px 10px">${esc(L(r.template))}</p>
    <div class="row small muted">${r.channels.map(c => `<span class="pill">${t('ch_' + c).split(' (')[0]}</span>`).join('')}${r.scope ? `<span>${esc(r.scope.locations.map(locName).join(', '))}</span>` : ''}</div>
    <div class="row">${btn(t('edit'), 'editRule', { sm: true, data: { rule: r.id }, icon: 'edit' })}${btn(r.active ? t('paused') : t('active'), 'toggleRule', { sm: true, data: { rule: r.id } })}</div></div>`).join('');
  return `<div class="page">${pageHead(t('reminders'), t('reminders_sub'), `${btn(t('run_now'), 'runReminders', { icon: 'play' })}${btn(t('new_rule'), 'editRule', { kind: 'primary', icon: 'plus' })}`)}
    ${!email ? `<div class="notice">${icon('info')}<span class="small">${t('email_off')}</span></div>` : ''}
    <div class="grid2">${cards || empty(t('no_data'))}</div></div>`;
};
A.runReminders = async () => { const r = await call(() => api.runReminders(S.userId)); if (r) { toast(t('run_result', { a: fmtNum(r.created), b: fmtNum(r.skipped) }), 'good'); render(); } };
A.toggleRule = async d => { const r = db.rules.find(x => x.id === d.rule); if (await call(() => api.saveRule(S.userId, { ...r, active: !r.active }), t('saved'))) render(); };
A.editRule = d => openModal('rule', { ruleId: d.rule || null });
MODALS.rule = m => {
  const r = m.ruleId ? db.rules.find(x => x.id === m.ruleId) : { trigger: 'due_soon', days: 2, every: 0, max: 1, channels: ['in_app'], template: { en: '{course} is due on {due}.', ar: 'موعد {course} هو {due}.' }, active: true };
  return {
    title: m.ruleId ? t('edit') : t('new_rule'), wide: true,
    body: `<form id="rule-form" data-form="rule" class="form-grid">
      ${field(t('trigger'), select('trigger', [['assigned', t('tr_assigned')], ['due_soon', t('tr_due_soon')], ['overdue', t('tr_overdue')]], r.trigger))}
      ${field(t('rule_days'), input('days', r.days, { type: 'number', min: 0, max: 60 }))}
      ${field(t('rule_every'), input('every', r.every, { type: 'number', min: 0, max: 30 }))}
      ${field(t('rule_max'), input('max', r.max, { type: 'number', min: 1, max: 10 }))}
      <div class="field" style="grid-column:1/-1"><span>${t('channels')}</span>${checkbox('ch_in_app', r.channels.includes('in_app'), t('ch_in_app'))}${checkbox('ch_email', r.channels.includes('email'), t('ch_email'))}</div>
      ${field(t('template_en'), textarea('ten', r.template.en, { dir: 'ltr' }), { hint: t('template_hint') })}${field(t('template_ar'), textarea('tar', r.template.ar, { dir: 'rtl' }), { hint: t('template_hint') })}
      ${checkbox('active', r.active, t('active'))}</form>`,
    foot: `${btn(t('cancel'), 'closeModal')}<button class="btn primary" type="submit" form="rule-form">${t('save')}</button>`
  };
};
F.rule = async d => {
  const channels = [d.ch_in_app ? 'in_app' : null, d.ch_email ? 'email' : null].filter(Boolean);
  if (await call(() => api.saveRule(S.userId, { id: S.modal.ruleId, trigger: d.trigger, days: d.days, every: d.every, max: d.max, channels: channels.length ? channels : ['in_app'], template: { en: d.ten, ar: d.tar }, active: !!d.active }), t('saved'))) { closeModal(); render(); }
};

/* ---------------- problem reports ---------------- */
PAGES.issues = () => {
  const list = api.listIssues(S.userId);
  return `<div class="page" style="max-width:900px">${pageHead(t('issues'), t('issues_sub'))}${list.length ? `<div class="list">${list.map(i => `<div class="li" style="align-items:flex-start">${icon('flag')}<span class="grow"><b>${esc(i.message)}</b><div class="small muted">${esc(L(i.course) || '')}${i.section ? ' · ' + esc(L(i.section)) : ''}${i.fileId ? ' · ' + esc((db.files.find(f => f.id === i.fileId) || {}).title || '') : ''}</div><div class="tiny muted">${esc(L(i.reporter))} · ${esc(fmtDateTime(i.at))}${i.note ? ' · ' + esc(i.note) : ''}</div></span><div class="stack" style="justify-items:end">${pill(i.status)}${i.status === 'open' ? btn(t('resolve'), 'resolveIssue', { sm: true, data: { issue: i.id }, icon: 'check' }) : ''}${i.sectionId && i.status === 'open' ? btn(t('edit'), 'go', { sm: true, kind: 'ghost', data: { r: 'sectionEdit', 'section-id': i.sectionId } }) : ''}</div></div>`).join('')}</div>` : `<div class="card">${empty(t('no_issues'), 'flag')}</div>`}</div>`;
};
A.resolveIssue = d => openModal('confirm', { title: t('resolve'), body: '', extra: field(t('resolution_note'), `<textarea class="input" id="resolve-note" rows="3"></textarea>`), ok: t('resolve'), onOk: async () => { const note = (document.getElementById('resolve-note') || {}).value; if (await call(() => api.resolveIssue(S.userId, d.issue, note), t('resolved'))) { closeModal(); render(); } } });
