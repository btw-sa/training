/* ui-admin.js — roles and access, locations, settings, data and backups, audit log. */

/* ---------------- roles and access ---------------- */
PAGES.access = () => {
  const ams = db.users.filter(u => u.role === 'area_manager' && !u.stub);
  const st = S.pf.access || (S.pf.access = { amId: ams[0] && ams[0].id });
  const canGrant = can('access.grant');
  const am = ams.find(u => u.id === st.amId);
  let editor = '';
  if (am) {
    const g = api.getGrant(S.userId, am.id);
    if (!st.draft || st.draft._for !== am.id) st.draft = { ...g, courses: g.courses || [], courseMode: g.courses && g.courses.length ? 'some' : 'all', _for: am.id };
    const d = st.draft;
    const groups = ['people', 'content', 'training', 'certs', 'reports'];
    const permBoxes = groups.map(gr => {
      const ps = Core.PERMISSIONS.filter(p => p.group === gr && p.grantable);
      return `<div class="stack" style="gap:0"><div class="eyebrow">${esc(gr === 'people' ? t('people') : gr === 'content' ? t('courses') : gr === 'training' ? t('training') : gr === 'certs' ? t('certificates') : t('reports'))}</div>${ps.map(p => checkbox('perm', d.perms.includes(p.key), esc(L(p.label)), { value: p.key, disabled: !canGrant, onChange: 'grantPerm', id: 'gp-' + p.key })).join('')}</div>`;
    }).join('');
    const scopeLocs = db.locations.map(l => checkbox('loc', d.locations.includes(l.id), esc(L(l.name)) + ` <span class="muted small">${esc(L(l.city))}</span>`, { value: l.id, disabled: !canGrant, onChange: 'grantScope', id: 'gl-' + l.id })).join('');
    const scopeTeams = db.teams.filter(x => !d.locations.includes(x.locationId)).map(x => checkbox('team', d.teams.includes(x.id), esc(L(x.name)) + ` <span class="muted small">${esc(locName(x.locationId))}</span>`, { value: x.id, disabled: !canGrant, onChange: 'grantScope', id: 'gt-' + x.id })).join('');
    const outside = db.users.filter(u => u.role === 'staff' && u.status === 'active' && !d.locations.includes(u.locationId) && !d.teams.includes(u.teamId));
    const scopePeople = outside.map(u => checkbox('user', d.users.includes(u.id), esc(L(u.name)) + ` <span class="muted small">${esc(locName(u.locationId))}</span>`, { value: u.id, disabled: !canGrant, onChange: 'grantScope', id: 'gu-' + u.id })).join('');
    const courseBoxes = d.courseMode === 'some' ? db.courses.map(c => checkbox('course', d.courses.includes(c.id), esc(L(c.title)), { value: c.id, disabled: !canGrant, onChange: 'grantScope', id: 'gc-' + c.id })).join('') : '';
    editor = `<section class="card stack"><div class="row between"><div class="row"><span class="avatar">${esc(initials(am.name.en))}</span><div><h2>${esc(L(am.name))}</h2><span class="small muted">${esc(am.title)}</span></div></div>${canGrant ? btn(t('save'), 'saveGrant', { kind: 'primary', icon: 'check' }) : `<span class="locked">${icon('lock')}${t('admin_only_grant')}</span>`}</div>
      <div class="grid2"><div class="stack"><h3>${t('granted_perms')}</h3><div class="grid2" style="gap:6px 16px">${permBoxes}</div></div>
      <div class="stack"><h3>${t('scope')}</h3><div class="eyebrow">${t('scope_locations')}</div><div>${scopeLocs}</div>
        ${scopeTeams ? `<div class="eyebrow">${t('scope_teams')}</div><div>${scopeTeams}</div>` : ''}
        <details><summary class="small">${t('scope_people')} (${fmtNum(d.users.length)})</summary><div>${scopePeople || `<p class="small muted">${t('none')}</p>`}</div></details>
        <div class="eyebrow">${t('scope_courses')}</div>${select('courseMode', [['all', t('all_courses')], ['some', t('selected_courses')]], d.courseMode, { onChange: 'grantCourseMode', disabled: !canGrant, id: 'g-cm' })}<div>${courseBoxes}</div></div></div>
      <p class="small muted">${t('server_checked')}</p></section>`;
  }
  const roles = Core.ROLES;
  const cell = (role, p) => {
    if (role === 'area_manager') return p.grantable ? `<td class="grant">${t('grant_word')}</td>` : '<td class="no">—</td>';
    if (role === 'staff') return ['progress.view', 'certs.view'].includes(p.key) ? `<td class="grant" style="color:var(--muted)">${t('own_word')}</td>` : '<td class="no">—</td>';
    return Core.ROLE_PERMS[role].includes(p.key) ? '<td class="yes">✓</td>' : '<td class="no">—</td>';
  };
  const matrix = table([{ label: t('action') }, ...roles.map(r => ({ label: roleName(r) }))], Core.PERMISSIONS.map(p => `<tr><td>${esc(L(p.label))}</td>${roles.map(r => cell(r, p)).join('')}</tr>`), { cls: 'matrix' });
  return `<div class="page">${pageHead(t('access'), t('access_sub'))}
    ${ams.length ? `<div class="row">${ams.map(u => btn(L(u.name), 'pickAm', { data: { am: u.id }, kind: u.id === st.amId ? 'primary' : '', icon: 'users' })).join('')}</div>` : `<div class="notice">${icon('info')}<span>${t('no_area_managers')}</span></div>`}
    ${editor}
    <section class="stack"><div><h2>${t('matrix')}</h2><p class="small muted">${t('matrix_sub')}</p><p class="small muted">${t('ops_settings_note')}</p></div>${matrix}</section></div>`;
};
A.pickAm = d => { S.pf.access.amId = d.am; S.pf.access.draft = null; render(); };
C.grantPerm = (v, el) => { const d = S.pf.access.draft; d.perms = el.checked ? [...new Set([...d.perms, el.value])] : d.perms.filter(p => p !== el.value); };
C.grantScope = (v, el) => {
  const d = S.pf.access.draft; const key = { loc: 'locations', team: 'teams', user: 'users', course: 'courses' }[el.name];
  d[key] = el.checked ? [...new Set([...d[key], el.value])] : d[key].filter(x => x !== el.value);
  if (key === 'locations') render();
};
C.grantCourseMode = v => { S.pf.access.draft.courseMode = v; render(); };
A.saveGrant = async () => {
  const st = S.pf.access; const d = st.draft;
  if (await call(() => api.setGrant(S.userId, st.amId, { perms: d.perms, locations: d.locations, teams: d.teams, users: d.users, courses: d.courseMode === 'some' ? d.courses : null }), t('grant_saved'))) { st.draft = null; render(); }
};
/* ---------------- locations ---------------- */
PAGES.locations = () => {
  const cards = db.locations.map(l => {
    const teams = db.teams.filter(x => x.locationId === l.id);
    const n = db.users.filter(u => u.locationId === l.id && u.status === 'active').length;
    return `<div class="card stack"><div class="row between"><div><h3>${esc(L(l.name))}</h3><span class="small muted">${esc(L(l.city))} · ${t('people_count', { n: fmtNum(n) })}</span></div><div class="row" style="gap:4px">${btn('', 'editLocation', { sm: true, kind: 'ghost', icon: 'edit', aria: t('edit'), data: { loc: l.id } })}${btn(t('add_team'), 'addTeam', { sm: true, icon: 'plus', data: { loc: l.id } })}</div></div>
      <div class="row">${teams.map(x => `<span class="pill accent">${esc(L(x.name))}</span>`).join('') || `<span class="muted small">${t('no_team')}</span>`}</div></div>`;
  }).join('');
  return `<div class="page">${pageHead(t('locations'), t('locations_sub'), btn(t('add_location'), 'addLocation', { kind: 'primary', icon: 'plus' }))}<div class="grid2">${cards}</div></div>`;
};
A.addLocation = () => openModal('location');
A.editLocation = d => openModal('location', { locationId: d.loc });
A.addTeam = d => openModal('team', { locationId: d.loc });
MODALS.location = m => {
  const l = (m.locationId && db.locations.find(x => x.id === m.locationId)) || { name: { en: '', ar: '' }, city: { en: '', ar: '' } };
  return {
  title: m.locationId ? t('edit') + ' · ' + L(l.name) : t('add_location'),
  body: `<form id="loc-form" data-form="location" class="form-grid">${field(t('name') + ' · ' + t('english'), input('en', l.name.en, { dir: 'ltr' }))}${field(t('name') + ' · ' + t('arabic'), input('ar', l.name.ar, { dir: 'rtl' }))}${field(t('city') + ' · ' + t('english'), input('cen', (l.city || {}).en || '', { dir: 'ltr' }))}${field(t('city') + ' · ' + t('arabic'), input('car', (l.city || {}).ar || '', { dir: 'rtl' }))}</form>`,
  foot: `${btn(t('cancel'), 'closeModal')}<button class="btn primary" type="submit" form="loc-form">${t('save')}</button>`
  };
};
F.location = async d => { const id = S.modal.locationId || null; if (await call(() => api.saveLocation(S.userId, { id, name: { en: d.en || d.ar, ar: d.ar || d.en }, city: { en: d.cen, ar: d.car || d.cen } }), id ? t('saved') : t('created'))) { closeModal(); render(); } };
MODALS.team = m => ({
  title: t('add_team') + ' · ' + locName(m.locationId),
  body: `<form id="team-form" data-form="team" class="form-grid">${field(t('name') + ' · ' + t('english'), input('en', '', { dir: 'ltr' }))}${field(t('name') + ' · ' + t('arabic'), input('ar', '', { dir: 'rtl' }))}</form>`,
  foot: `${btn(t('cancel'), 'closeModal')}<button class="btn primary" type="submit" form="team-form">${t('save')}</button>`
});
F.team = async d => { if (await call(() => api.saveTeam(S.userId, { locationId: S.modal.locationId, name: { en: d.en, ar: d.ar || d.en } }), t('created'))) { closeModal(); render(); } };

/* ---------------- settings ---------------- */
PAGES.settings = () => {
  const s = api.getSettings(S.userId);
  const lockNote = perm => (can(perm) ? '' : `<div class="notice">${icon('lock')}<span class="small">${t('section_locked')} · ${esc(lockReason('forbidden_role'))}</span></div>`);
  const tr = !can('settings.training'), kp = !can('settings.kpi'), sy = !can('settings.system');
  return `<div class="page" style="max-width:960px">${pageHead(t('settings'), t('settings_sub'))}
    <form class="card stack" data-form="setTraining"><h2>${t('set_training')}</h2>${lockNote('settings.training')}<div class="form-grid">
      ${field(t('cert_line') + ' · ' + t('english'), input('cen', s.certificateLine.en, { dir: 'ltr', disabled: tr }))}${field(t('cert_line') + ' · ' + t('arabic'), input('car', s.certificateLine.ar, { dir: 'rtl', disabled: tr }))}
      ${field(t('default_due'), input('defaultDueDays', s.defaultDueDays, { type: 'number', min: 1, max: 365, disabled: tr }))}
      ${field(t('card_seconds'), input('cardMinSeconds', s.cardMinSeconds == null ? 5 : s.cardMinSeconds, { type: 'number', min: 0, max: 120, disabled: tr }), { hint: t('card_seconds_hint') })}</div>
      ${checkbox('sequential', s.sequential, t('sequential'), { disabled: tr })}${tr ? '' : `<div>${btn(t('save'), null, { type: 'submit', kind: 'primary' })}</div>`}</form>
    <form class="card stack" data-form="setKpi"><h2>${t('set_kpi')}</h2>${lockNote('settings.kpi')}<div class="form-grid">
      ${field(t('th_overdue'), input('overdueDays', s.kpi.overdueDays, { type: 'number', min: 0, max: 60, disabled: kp }))}${field(t('th_failed'), input('failedAttempts', s.kpi.failedAttempts, { type: 'number', min: 1, max: 10, disabled: kp }))}
      ${field(t('th_low'), input('lowAverage', s.kpi.lowAverage, { type: 'number', min: 1, max: 100, disabled: kp }))}${field(t('th_np'), input('needsPracticeDays', s.kpi.needsPracticeDays, { type: 'number', min: 1, max: 90, disabled: kp }))}
      ${field(t('th_inactive'), input('inactiveDays', s.kpi.inactiveDays, { type: 'number', min: 1, max: 90, disabled: kp }))}${field(t('th_min'), input('minSignals', s.kpi.minSignals, { type: 'number', min: 2, max: 5, disabled: kp }))}</div>
      ${kp ? '' : `<div>${btn(t('save'), null, { type: 'submit', kind: 'primary' })}</div>`}</form>
    <form class="card stack" data-form="setSystem"><h2>${t('set_system')}</h2>${lockNote('settings.system')}<div class="form-grid">
      ${field(t('business_en'), input('ben', s.business.en, { dir: 'ltr', disabled: sy }))}${field(t('business_ar'), input('bar', s.business.ar, { dir: 'rtl', disabled: sy }))}
      ${field(t('cert_prefix'), input('certPrefix', s.certPrefix, { dir: 'ltr', disabled: sy }))}${field(t('default_lang'), select('defaultLang', [['ar', 'العربية'], ['en', 'English']], s.defaultLang, { disabled: sy }))}
      ${field(t('ret_users'), input('ru', s.retention.inactiveUserYears, { type: 'number', min: 1, max: 10, disabled: sy }))}${field(t('ret_audit'), input('ra', s.retention.auditYears, { type: 'number', min: 1, max: 10, disabled: sy }))}
      ${field(t('privacy_en'), textarea('pen', s.privacy.en, { dir: 'ltr', rows: 5, disabled: sy }), { full: true })}${field(t('privacy_ar'), textarea('par', s.privacy.ar, { dir: 'rtl', rows: 5, disabled: sy }), { full: true })}</div>
      ${sy ? '' : `<div>${btn(t('save'), null, { type: 'submit', kind: 'primary' })}</div>`}</form></div>`;
};
F.setTraining = async d => { if (await call(() => api.updateSettings(S.userId, 'training', { certificateLine: { en: d.cen, ar: d.car }, defaultDueDays: Number(d.defaultDueDays), cardMinSeconds: Number(d.cardMinSeconds), sequential: !!d.sequential }), t('saved'))) render(); };
F.setKpi = async d => { if (await call(() => api.updateSettings(S.userId, 'kpi', { kpi: { overdueDays: d.overdueDays, failedAttempts: d.failedAttempts, lowAverage: d.lowAverage, needsPracticeDays: d.needsPracticeDays, inactiveDays: d.inactiveDays, minSignals: d.minSignals } }), t('saved'))) render(); };
F.setSystem = async d => { if (await call(() => api.updateSettings(S.userId, 'system', { business: { en: d.ben, ar: d.bar }, certPrefix: String(d.certPrefix || '').toUpperCase(), defaultLang: d.defaultLang, retention: { inactiveUserYears: Number(d.ru), auditYears: Number(d.ra) }, privacy: { en: d.pen, ar: d.par } }), t('saved'))) render(); };

/* ---------------- backups and data ---------------- */
PAGES.data = () => {
  const s = db.settings.retention;
  const where = LIVE
    ? `<div class="notice">${icon('db')}<span class="small">${t('data_live_note')}</span></div>`
    : `<div class="notice warn">${icon('alert')}<span class="small">${t('data_local_note')}</span></div>`;
  return `<div class="page" style="max-width:960px">${pageHead(t('data'), t('data_sub'), btn(t('full_export'), 'fullExport', { kind: 'primary', icon: 'download' }))}
    ${where}
    <div class="grid2"><section class="card stack"><h2>${t('backups')}</h2><p class="small">${LIVE ? t('backups_live') : t('backups_local')}</p></section>
    <section class="card stack"><h2>${t('retention')}</h2><p class="small">${t('ret_users')}: <b>${fmtNum(s.inactiveUserYears)}</b></p><p class="small">${t('ret_audit')}: <b>${fmtNum(s.auditYears)}</b></p><div>${btn(t('settings'), 'go', { sm: true, data: { r: 'settings' }, icon: 'gear' })}</div><p class="tiny muted">${t('full_export_note')}</p></section></div>
    ${LIVE ? '' : `<details class="card"><summary>${t('erase_device')}</summary><div class="stack" style="margin-top:10px"><p class="small muted">${t('erase_device_note')}</p><div>${btn(t('erase_device'), 'eraseDevice', { kind: 'danger', icon: 'trash' })}</div></div></details>`}</div>`;
};
A.fullExport = async () => { const r = await call(() => api.fullExport(S.userId)); if (r && await saveFile(r.filename, r.json, 'application/json')) toast(t('saved'), 'good'); };
A.eraseDevice = () => openModal('confirm', { title: t('erase_device'), body: t('erase_device_note'), ok: t('erase_device'), danger: true, onOk: () => { eraseDevice(); closeModal(); go('setup'); } });

/* ---------------- audit ---------------- */
PAGES.audit = () => {
  const f = S.pf.audit || (S.pf.audit = {});
  const list = api.listAudit(S.userId, cleanFilters(f));
  const ents = [...new Set(db.audit.map(a => a.entity))].sort();
  const rows = list.map(a => `<tr><td class="small">${esc(fmtDateTime(a.at))}</td><td><b>${esc(userName(a.actorId))}</b><div class="tiny muted">${esc(a.actorRole === 'system' ? t('system') : roleName(a.actorRole))}</div></td><td class="mono small">${esc(a.action)}</td><td class="small">${esc(a.entity)}${a.entityId ? ` · <span class="mono">${esc(a.entityId)}</span>` : ''}</td><td>${a.reason ? `<div class="small"><b>${t('reason')}:</b> ${esc(a.reason)}</div>` : ''}<details><summary class="small">${t('details')}</summary><div class="grid2" style="gap:8px;margin-top:6px"><div><span class="eyebrow">${t('before')}</span><div class="diff" dir="ltr">${esc(JSON.stringify(a.before, null, 1) || '—')}</div></div><div><span class="eyebrow">${t('after')}</span><div class="diff" dir="ltr">${esc(JSON.stringify(a.after, null, 1) || '—')}</div></div></div></details></td></tr>`);
  return `<div class="page">${pageHead(t('audit'), t('audit_sub'))}
    <div class="card filters">${field(t('search'), input('q', f.q || '', { type: 'search', onInput: 'auditQ', id: 'audit-q' }))}${field(t('record'), select('entity', [['', t('all')], ...ents.map(e => [e, e])], f.entity || '', { onChange: 'auditF', id: 'audit-ent' }))}</div>
    ${table([{ label: t('when') }, { label: t('who') }, { label: t('what') }, { label: t('record') }, { label: t('details') }], rows)}</div>`;
};
I.auditQ = v => { S.pf.audit.q = v; render(); };
C.auditF = (v, el) => { S.pf.audit[el.name] = v; render(); };
