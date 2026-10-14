// Run: node --test web/test/
// Exercises the permission engine and mock backend that the prototype runs on.
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../src/core.js');
const { seedDemo, DEMO_PASSWORD } = require('./fixtures.js');

const NOW = Date.parse('2026-10-12T09:00:00Z');
function fresh(at = NOW) {
  let t = at;
  const db = seedDemo(at);
  const api = Core.createBackend(db, { now: () => t, random: () => 0.42 });
  return { db, api, advance: days => { t += days * 86400000; } };
}
const code = fn => { try { fn(); return 'ok'; } catch (e) { return e.code || e.message; } };
// A section quiz opens only after every card in the section has been viewed.
const viewCards = (api, db, userId, sectionId) => db.files.filter(f => f.sectionId === sectionId).forEach(f => api.markFileViewed(userId, f.id));

test('role defaults: Admin all, Operations without system areas, Area Manager only by grant, Staff none', () => {
  const { api } = fresh();
  const admin = api.me('u1').perms, it = api.me('u2').perms, ops = api.me('u3').perms, am = api.me('u4').perms, st = api.me('s1').perms;
  assert.equal(admin.length, Core.PERMISSIONS.length);
  assert.ok(!it.includes('access.grant') && it.includes('audit.view') && it.includes('settings.system'));
  for (const p of ['settings.system', 'settings.kpi', 'integrations.manage', 'data.backup', 'audit.view', 'access.grant']) assert.ok(!ops.includes(p), p);
  for (const p of ['users.edit', 'content.edit', 'certs.revoke', 'reports.export', 'settings.training']) assert.ok(ops.includes(p), p);
  assert.deepEqual(am.sort(), Core.createBackend(seedDemo(NOW))._db.grants.u4.perms.slice().sort());
  assert.equal(st.length, 0);
});

test('Area Manager sees only people in granted locations; others look not found', () => {
  const { api } = fresh();
  const ids = api.listUsers('u4').map(u => u.id).sort();
  assert.deepEqual(ids, ['s1', 's11', 's2', 's3', 's4', 's5', 's6', 'u1', 'u2', 'u3', 'u4'].sort());
  // u1..u3 are listed because their home location is Olaya; editing them is still blocked by rank:
  assert.equal(code(() => api.updateUser('u4', 'u3', { title: 'x' })), 'forbidden_rank');
  assert.equal(code(() => api.getUser('u4', 's7')), 'not_found');
  assert.equal(code(() => api.setUserStatus('u4', 's9', 'inactive')), 'not_found');
  assert.equal(api.search('u4', 'Abdulaziz').people.length, 0);
});

test('Area Manager adds Staff only, only inside scope; change is audited', () => {
  const { api, db } = fresh();
  assert.equal(code(() => api.createUser('u4', { password: 'Start2026', name: { en: 'New Person' }, email: 'np@btw.example', role: 'staff', locationId: 'l3' })), 'forbidden_scope');
  assert.equal(code(() => api.createUser('u4', { password: 'Start2026', name: { en: 'New Person' }, email: 'np@btw.example', role: 'area_manager', locationId: 'l1' })), 'forbidden_rank');
  const u = api.createUser('u4', { password: 'Start2026', name: { en: 'New Person', ar: 'شخص جديد' }, email: 'np@btw.example', role: 'staff', locationId: 'l2', teamId: 't3' });
  assert.equal(u.createdBy, 'u4');
  const log = db.audit.find(a => a.entityId === u.id && a.action === 'user.create');
  assert.ok(log && log.actorId === 'u4' && log.after.email === 'np@btw.example');
  assert.equal(code(() => api.updateUser('u4', u.id, { locationId: 'l4', teamId: null })), 'forbidden_scope');
  assert.equal(code(() => api.updateUser('u4', u.id, { role: 'area_manager' })), 'forbidden_role');
  // Role-based assignment picked up the new starter automatically.
  assert.ok(db.enrollments.some(e => e.userId === u.id && e.courseId === 'c1'));
});

test('Area Manager without the user permission cannot add people', () => {
  const { api } = fresh();
  assert.equal(code(() => api.createUser('u5', { password: 'Start2026', name: { en: 'X' }, email: 'x@y.co', role: 'staff', locationId: 'l4' })), 'forbidden_role');
});

test('Staff cannot read anyone else, but can read themselves', () => {
  const { api } = fresh();
  assert.equal(code(() => api.listUsers('s1')), 'forbidden_role');
  assert.equal(code(() => api.getUser('s1', 's2')), 'forbidden_role');
  assert.equal(api.getUser('s1', 's1').user.id, 's1');
  assert.equal(code(() => api.kpis('s1')), 'forbidden_role');
  assert.equal(code(() => api.listCerts('s1')), 'forbidden_role');
  assert.equal(api.search('s1', 'Majed').people.length, 0);
  assert.equal(code(() => api.learnerCourse('s1', 'c4')), 'not_found');
});

test('nobody manages someone at or above their own role, except Admins', () => {
  const { api } = fresh();
  assert.equal(code(() => api.updateUser('u2', 'u1', { title: 'x' })), 'forbidden_rank');
  assert.equal(code(() => api.createUser('u2', { password: 'Start2026', name: { en: 'A' }, email: 'a1@y.co', role: 'admin', locationId: 'l1' })), 'forbidden_rank');
  assert.equal(code(() => api.createUser('u2', { password: 'Start2026', name: { en: 'A' }, email: 'a2@y.co', role: 'it_manager', locationId: 'l1' })), 'forbidden_rank');
  assert.equal(code(() => api.createUser('u2', { password: 'Start2026', name: { en: 'A' }, email: 'a3@y.co', role: 'ops_manager', locationId: 'l1' })), 'ok');
  assert.equal(code(() => api.createUser('u3', { password: 'Start2026', name: { en: 'A' }, email: 'a4@y.co', role: 'it_manager', locationId: 'l1' })), 'forbidden_rank');
  assert.equal(code(() => api.updateUser('u3', 'u4', { title: 'Area Manager, Riyadh North' })), 'ok');
  assert.equal(code(() => api.updateUser('u3', 'u3', { role: 'admin' })), 'forbidden_rank');
});

test('the last active Admin cannot be deactivated or demoted', () => {
  const { api } = fresh();
  assert.equal(code(() => api.setUserStatus('u1', 'u1', 'inactive')), 'forbidden_rank');
  const a2 = api.createUser('u1', { password: 'Start2026', name: { en: 'Second Admin' }, email: 'admin2@y.co', role: 'admin', locationId: 'l1' });
  assert.equal(code(() => api.setUserStatus(a2.id, 'u1', 'inactive')), 'ok');
  assert.equal(code(() => api.updateUser('u1', a2.id, { role: 'staff' })), 'unauthenticated'); // u1 is now inactive
  assert.equal(code(() => api.setUserStatus(a2.id, 'u1', 'active')), 'ok');
  assert.equal(code(() => api.updateUser('u1', a2.id, { role: 'staff' })), 'ok');
  assert.equal(code(() => api.updateUser('u1', 'u1', { role: 'staff' })), 'forbidden_rank');
});

test('people with training history are deactivated, not removed', () => {
  const { api } = fresh();
  assert.equal(code(() => api.removeUser('u3', 's2')), 'has_history');
  const u = api.createUser('u3', { password: 'Start2026', name: { en: 'Temp' }, email: 'temp@y.co', role: 'staff', locationId: 'l1' });
  assert.equal(code(() => api.removeUser('u3', u.id)), 'ok');
  assert.equal(code(() => api.removeUser('u4', 's6')), 'forbidden_role');
});

test('only Admins grant Area Manager access, and only grantable permissions', () => {
  const { api } = fresh();
  assert.equal(code(() => api.setGrant('u2', 'u4', { perms: ['users.view'] })), 'forbidden_role');
  assert.equal(code(() => api.setGrant('u3', 'u4', { perms: ['users.view'] })), 'forbidden_role');
  assert.equal(code(() => api.setGrant('u1', 'u4', { perms: ['settings.system'] })), 'invalid');
  assert.equal(code(() => api.setGrant('u1', 's1', { perms: ['users.view'] })), 'invalid');
  api.setGrant('u1', 'u4', { perms: ['users.view'], locations: ['l1'] });
  assert.ok(!api.listUsers('u4').some(u => u.locationId === 'l2'));
  assert.equal(code(() => api.createUser('u4', { password: 'Start2026', name: { en: 'X' }, email: 'x2@y.co', role: 'staff', locationId: 'l1' })), 'forbidden_role');
});

test('course-limited Area Manager edits only the courses granted', () => {
  const { api } = fresh();
  assert.equal(code(() => api.saveSection('u5', { courseId: 'c4', title: { en: 'Seasonal menu' } })), 'ok');
  assert.equal(code(() => api.saveSection('u5', { courseId: 'c1', title: { en: 'Hack' } })), 'forbidden_scope');
  assert.equal(code(() => api.createCourse('u5', { title: { en: 'New' } })), 'forbidden_scope');
  assert.equal(code(() => api.publishCourse('u5', 'c4')), 'forbidden_role');
});

test('exam questions never carry the correct answer to the learner', () => {
  const { api, db } = fresh();
  viewCards(api, db, 's6', 's_c1_1');
  const s = api.startAttempt('s6', 'x1');
  const json = JSON.stringify(s);
  assert.ok(!/"correct"/.test(json));
  assert.equal(s.questions.length, 4);
});

test('server-side grading, attempt limits, retake rule and time limit', () => {
  const { api, db, advance } = fresh();
  const ex = db.exams.find(x => x.id === 'x1');
  const right = Object.fromEntries(ex.questions.map(q => [q.id, q.choices.find(c => c.correct).id]));
  const wrong = Object.fromEntries(ex.questions.map(q => [q.id, q.choices.find(c => !c.correct).id]));
  ['s_c1_1', 's_c1_2'].forEach(sid => viewCards(api, db, 's6', sid));
  viewCards(api, db, 's4', 's_c1_3');
  let s = api.startAttempt('s6', 'x1');
  let r = api.submitAttempt('s6', s.attemptId, wrong);
  assert.equal(r.scorePct, 0); assert.equal(r.passed, false);
  assert.ok(r.review, 'review shown after submit for this quiz');
  assert.equal(code(() => api.submitAttempt('s6', s.attemptId, right)), 'conflict');
  s = api.startAttempt('s6', 'x1'); api.submitAttempt('s6', s.attemptId, wrong);
  s = api.startAttempt('s6', 'x1'); api.submitAttempt('s6', s.attemptId, wrong);
  assert.equal(code(() => api.startAttempt('s6', 'x1')), 'attempts_used');
  // Retake not allowed
  db.exams.find(x => x.id === 'x3').allowRetake = false;
  s = api.startAttempt('s4', 'x3'); api.submitAttempt('s4', s.attemptId, {});
  assert.equal(code(() => api.startAttempt('s4', 'x3')), 'attempts_used');
  // Time limit: submitting after expiry scores zero
  const x2 = db.exams.find(x => x.id === 'x2');
  const right2 = Object.fromEntries(x2.questions.map(q => [q.id, q.choices.find(c => c.correct).id]));
  s = api.startAttempt('s6', 'x2'); advance(11 / 1440);
  r = api.submitAttempt('s6', s.attemptId, right2);
  assert.equal(r.late, true); assert.equal(r.scorePct, 0);
  // Final is locked until every required section is done
  assert.equal(code(() => api.startAttempt('s6', 'x5')), 'locked');
  // Someone not enrolled cannot start
  assert.equal(code(() => api.startAttempt('u2', 'x1')), 'not_found');
});

test('full journey: sections, final, sign-offs, then a certificate; verification shows initials only', () => {
  const { api, db } = fresh();
  const pass = id => { const ex = db.exams.find(x => x.id === id); const s = api.startAttempt('s6', id); return api.submitAttempt('s6', s.attemptId, Object.fromEntries(ex.questions.map(q => [q.id, q.choices.find(c => c.correct).id]))); };
  ['s_c1_2', 's_c1_3', 's_c1_4'].forEach(sid => assert.equal(code(() => api.startAttempt('s6', db.exams.find(x => x.sectionId === sid).id)), 'locked', 'quiz waits for the cards'));
  ['s_c1_1', 's_c1_2', 's_c1_3', 's_c1_4'].forEach(sid => viewCards(api, db, 's6', sid));
  ['x1', 'x2', 'x3', 'x4'].forEach(pass);
  const fin = pass('x5');
  assert.equal(fin.passed, true); assert.equal(fin.certificate, null, 'sign-offs still pending');
  assert.ok(api.learnerCourse('s6', 'c1').detail.awaitingSignoff);
  assert.equal(code(() => api.setSignoff('u5', 'k1', 's6', 'passed')), 'not_found'); // outside u5 scope
  api.setSignoff('u4', 'k1', 's6', 'passed'); api.setSignoff('u4', 'k2', 's6', 'passed');
  const r = api.setSignoff('u4', 'k3', 's6', 'passed', 'Clean group heads, logged.');
  assert.ok(r.certificate && /^BTW-2026-/.test(r.certificate.no));
  const v = api.verifyCertificate(r.certificate.no.toLowerCase());
  assert.equal(v.status, 'valid'); assert.equal(v.holderInitials.en, 'D. A.');
  assert.ok(!JSON.stringify(v).includes('Dana') && !JSON.stringify(v).includes('@'));
  assert.equal(api.verifyCertificate('BTW-2026-NOPE-NOPE').found, false);
  assert.equal(code(() => api.getCertificate('s1', r.certificate.id)), 'forbidden_role');
  assert.equal(api.getCertificate('s6', r.certificate.id).no, r.certificate.no);
});

test('revoke and reissue need permission, scope and a reason', () => {
  const { api, db } = fresh();
  const cert = db.certs.find(c => c.userId === 's2');
  assert.equal(code(() => api.revokeCert('u4', cert.id, 'Wrong person')), 'forbidden_role');
  assert.equal(code(() => api.revokeCert('u3', cert.id, '')), 'invalid');
  const n = api.reissueCert('u3', cert.id, 'Name spelling corrected');
  assert.equal(api.verifyCertificate(cert.no).status, 'replaced');
  api.revokeCert('u3', n.id, 'Issued in error after record correction');
  assert.equal(api.verifyCertificate(n.no).status, 'revoked');
  assert.ok(db.audit.some(a => a.action === 'certificate.revoke' && a.reason));
});

test('CSV import previews, validates and skips duplicates before importing', () => {
  const { api } = fresh();
  const csv = [
    'employee_code,full_name_en,full_name_ar,email,phone,location,team,job_title,role',
    'RY-2001,Noura Saad,نورة سعد,noura.s@btw.example,,Olaya,Olaya bar,Barista,staff',
    'RY-2002,"Bakr, Faris",فارس بكر,faris@btw.example,+966 55 000 0000,Al Malqa,,Barista,',
    'RY-2003,Dup Email,,sara@btw.example,,Olaya,,Barista,staff',
    'RY-2004,In File Dup,,noura.s@btw.example,,Olaya,,Barista,staff',
    'RY-2005,Wrong Place,,wp@btw.example,,Mars,,Barista,staff',
    'RY-2006,Out Of Scope,,oos@btw.example,,Tahlia,,Barista,staff',
    'RY-2007,Too Senior,,ts@btw.example,,Olaya,,Manager,area_manager',
    'RY-2008,Bad Email,,not-an-email,,Olaya,,Barista,staff'
  ].join('\n');
  const p = api.previewImport('u4', csv);
  const st = Object.fromEntries(p.rows.map(r => [r.data.code, r]));
  assert.equal(st['RY-2001'].status, 'ready');
  assert.equal(st['RY-2002'].status, 'ready');
  assert.equal(st['RY-2003'].status, 'duplicate');
  assert.equal(st['RY-2004'].status, 'duplicate');
  assert.ok(st['RY-2005'].problems.includes('unknown_location'));
  assert.ok(st['RY-2006'].problems.includes('outside_scope'));
  assert.ok(st['RY-2007'].problems.includes('role_not_allowed'));
  assert.ok(st['RY-2008'].problems.includes('email:email_format'));
  const r = api.commitImport('u4', csv, 'Temp2026');
  assert.deepEqual(r, { created: 2, skipped: 6 });
  assert.equal(code(() => api.previewImport('u5', csv)), 'forbidden_role');
  assert.equal(code(() => api.previewImport('u3', 'name,email\nA,b@c.co')), 'invalid');
});

test('dashboard respects scope; support flags need several signals and show reasons', () => {
  const { api } = fresh();
  const k = api.kpis('u4');
  const people = k.byPerson.map(r => r.userId);
  assert.ok(people.every(id => ['s1', 's2', 's3', 's4', 's5', 's6'].includes(id)), people.join());
  const flagged = Object.fromEntries(k.support.map(s => [s.userId, s.signals.map(x => x.code)]));
  assert.ok(flagged.s4 && flagged.s4.length >= 2, 'Yousef flagged with reasons');
  assert.ok(flagged.s3, 'Lama flagged');
  assert.ok(!flagged.s1, 'one overdue course alone does not flag Sara');
  assert.ok(k.completionRate.den > 0 && k.completionRate.value === Math.round(k.completionRate.num / k.completionRate.den * 1000) / 10);
  const all = api.kpis('u3');
  assert.ok(all.byPerson.some(r => r.userId === 's9'));
  assert.ok(all.review.some(r => r.courseId === 'c3' && r.status === 'overdue'));
  assert.ok(all.review.some(r => r.courseId === 'c2' && r.status === 'due_soon'));
  const csv = api.exportReport('u4', 'people').csv;
  assert.ok(!csv.includes('Mona') && csv.includes('Sara'));
  assert.equal(code(() => api.exportReport('u5', 'people')), 'forbidden_role');
});

test('reminders never duplicate and send at most one per person per day', () => {
  const { api, db, advance } = fresh();
  const first = api.runReminders('u3');
  assert.ok(first.created > 0);
  const counts = {};
  db.notifications.filter(n => n.kind === 'reminder' && n.at.startsWith('2026-10-12')).forEach(n => { counts[n.userId] = (counts[n.userId] || 0) + 1; });
  assert.ok(Object.values(counts).every(c => c === 1));
  assert.equal(api.runReminders('u3').created, 0);
  advance(1);
  const next = api.runReminders('u3');
  const keys = db.notifications.map(n => n.key).filter(Boolean);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(next.created >= 0);
  assert.equal(code(() => api.runReminders('s1')), 'forbidden_role');
});

test('Drive outage fails the export clearly, keeps data, and a retry succeeds', () => {
  const { api, db } = fresh();
  const usersBefore = JSON.stringify(db.users);
  api.simulateDriveOutage('u2', true);
  const x = api.exportToDrive('u3', 'courses');
  assert.equal(x.status, 'failed'); assert.equal(x.error, 'drive_unavailable');
  assert.equal(JSON.stringify(db.users), usersBefore);
  api.simulateDriveOutage('u2', false);
  const r = api.retryExport('u3', x.id);
  assert.equal(r.status, 'succeeded'); assert.equal(r.attempts, 2); assert.ok(r.driveFile.name.endsWith('.csv'));
  assert.equal(code(() => api.simulateDriveOutage('u3', true)), 'forbidden_role');
  const full = api.fullExport('u2').json;
  assert.ok(!full.includes('vault://'));
  assert.equal(code(() => api.fullExport('u3')), 'forbidden_role');
});

test('settings are split: Operations edits training settings only; thresholds stay sane', () => {
  const { api } = fresh();
  assert.equal(code(() => api.updateSettings('u3', 'training', { sequential: true })), 'ok');
  assert.equal(code(() => api.updateSettings('u3', 'system', { certPrefix: 'XX' })), 'forbidden_role');
  assert.equal(code(() => api.updateSettings('u3', 'kpi', { kpi: {} })), 'forbidden_role');
  assert.equal(code(() => api.updateSettings('u3', 'training', { business: { en: 'X', ar: 'X' } })), 'forbidden_role');
  const k = { overdueDays: 7, failedAttempts: 2, lowAverage: 70, needsPracticeDays: 14, inactiveDays: 14, minSignals: 1 };
  assert.equal(code(() => api.updateSettings('u1', 'kpi', { kpi: k })), 'invalid');
  assert.equal(code(() => api.updateSettings('u1', 'kpi', { kpi: { ...k, minSignals: 3 } })), 'ok');
});

test('audit log is visible to Admin and IT only', () => {
  const { api } = fresh();
  assert.equal(code(() => api.listAudit('s1')), 'forbidden_role');
  assert.equal(code(() => api.listAudit('u3')), 'forbidden_role');
  assert.equal(code(() => api.listAudit('u4')), 'forbidden_role');
  assert.ok(api.listAudit('u2').length > 0);
});

test('publishing a new version with "retrain required" re-enrolls everyone on the old version', () => {
  const { api, db } = fresh();
  const holders = db.enrollments.filter(e => e.courseId === 'c1' && e.active).map(e => e.userId);
  const r = api.publishCourse('u3', 'c1', 'New grinder model', true);
  assert.equal(r.course.version, 3); assert.equal(r.retrained, holders.length);
  assert.ok(db.enrollments.filter(e => e.courseId === 'c1' && e.active).every(e => e.version === 3));
  assert.ok(db.notifications.some(n => n.userId === 's2' && n.kind === 'retrain'));
  assert.ok(db.certs.some(c => c.userId === 's2' && c.courseId === 'c1' && c.version === 2 && c.status === 'valid'), 'old certificate stays valid');
  const r2 = api.publishCourse('u3', 'c2', 'Typo fixes', false);
  assert.equal(r2.retrained, 0);
});

test('files are only linked and unlinked; exams are validated', () => {
  const { api, db } = fresh();
  const added = api.addFiles('u3', 's_c4_2', [{ driveId: 'drv-1', title: 'Cold brew batch card', mime: 'application/pdf' }, { driveId: 'drv-1', title: 'dup', mime: 'application/pdf' }]);
  assert.equal(added.length, 1); assert.equal(added[0].kind, 'pdf');
  assert.equal(code(() => api.addFiles('u4', 's_c4_2', [{ driveId: 'd2', title: 'x' }])), 'forbidden_role');
  assert.equal(code(() => api.removeFile('u3', added[0].id)), 'ok');
  assert.equal(code(() => api.saveExam('u3', { sectionId: 's_c4_2', passPct: 80, review: 'none', questions: [{ type: 'mc', prompt: { en: 'Q' }, choices: [{ text: { en: 'A' }, correct: true }, { text: { en: 'B' }, correct: true }] }] })), 'invalid');
  assert.equal(code(() => api.saveExam('u3', { sectionId: 's_c4_2', passPct: 80, review: 'none', questions: [{ type: 'tf', prompt: { en: 'Cold brew steeps 12–18 hours.' }, choices: [{ text: { en: 'True' }, correct: true }, { text: { en: 'False' } }] }] })), 'ok');
  assert.equal(code(() => api.removeExam('u3', 'x1')), 'has_history');
  const before = db.courses.length;
  const dup = api.duplicateCourse('u3', 'c1');
  assert.equal(db.courses.length, before + 1);
  assert.equal(api.getCourseManage('u3', dup.id).sections.length, 4);
  assert.equal(code(() => api.deleteCourse('u3', 'c1')), 'has_history');
  assert.equal(code(() => api.deleteCourse('u3', dup.id)), 'ok');
});

test('record corrections need a reason and are logged', () => {
  const { api, db } = fresh();
  const t = db.attempts.find(x => x.userId === 's4' && x.examId === 'x2');
  assert.equal(code(() => api.correctRecord('u3', { kind: 'attempt', id: t.id, value: 85, reason: '' })), 'invalid');
  assert.equal(code(() => api.correctRecord('u4', { kind: 'attempt', id: t.id, value: 85, reason: 'Paper exam marked manually' })), 'forbidden_role');
  api.correctRecord('u3', { kind: 'attempt', id: t.id, value: 85, reason: 'Paper exam marked manually' });
  assert.ok(db.corrections.some(c => c.entityId === t.id && c.old === 60 && c.new === 85));
  assert.ok(db.audit.some(a => a.action === 'record.correct' && a.reason === 'Paper exam marked manually'));
});

test('CSV export neutralises spreadsheet formulas', () => {
  const csv = Core.toCSV(['a'], [['=HYPERLINK("x")'], ['+1'], ['plain']]);
  assert.ok(csv.includes("'=HYPERLINK") && csv.includes("'+1") && csv.includes('plain'));
});

test('learner home sorts overdue first and offers a next step', () => {
  const { api } = fresh();
  const h = api.learnerHome('s1');
  assert.equal(h.items[0].status, 'overdue');
  assert.ok(h.continueItem);
  assert.equal(h.certificates.length, 1);
});

test('sign in with employee code or email and the password a manager set', () => {
  const { api } = fresh();
  assert.equal(api.login('RY-1103', DEMO_PASSWORD).userId, 's1');
  assert.equal(api.login('  sara@btw.example ', DEMO_PASSWORD).userId, 's1');
  assert.equal(api.login('ry-1103', DEMO_PASSWORD).userId, 's1', 'codes are not case-sensitive');
  assert.equal(code(() => api.login('RY-1103', 'wrong-pass1')), 'bad_credentials');
  assert.equal(code(() => api.login('NOBODY-1', DEMO_PASSWORD)), 'bad_credentials', 'unknown accounts get the same answer');
  assert.equal(code(() => api.login('RY-1099', DEMO_PASSWORD)), 'bad_credentials', 'deactivated accounts cannot sign in');
  assert.equal(code(() => api.login('', '')), 'bad_credentials');
});

test('five wrong passwords lock the account for 15 minutes; a manager reset unlocks it', () => {
  const { api, advance, db } = fresh();
  for (let i = 0; i < 5; i++) assert.equal(code(() => api.login('RY-1104', 'nope12345')), 'bad_credentials');
  assert.equal(code(() => api.login('RY-1104', DEMO_PASSWORD)), 'login_locked');
  assert.ok(db.audit.some(a => a.action === 'auth.locked'));
  advance(16 / 1440);
  assert.equal(api.login('RY-1104', DEMO_PASSWORD).userId, 's2');
  for (let i = 0; i < 5; i++) code(() => api.login('majed@btw.example', 'nope12345'));
  assert.equal(code(() => api.login('majed@btw.example', DEMO_PASSWORD)), 'login_locked');
  api.setPassword('u4', 's2', 'Fresh2026', true);
  assert.equal(api.login('majed@btw.example', 'Fresh2026').mustChange, true);
});

test('managers create accounts with a password; rules on strength, scope and rank', () => {
  const { api, db } = fresh();
  const base = { name: { en: 'New Barista' }, code: 'RY-3001', role: 'staff', locationId: 'l1' };
  assert.equal(code(() => api.createUser('u4', { ...base })), 'invalid');
  assert.equal(code(() => api.createUser('u4', { ...base, password: 'short1' })), 'invalid');
  assert.equal(code(() => api.createUser('u4', { ...base, password: 'onlyletters' })), 'invalid');
  const u = api.createUser('u4', { ...base, password: 'Bar1sta2026' });
  assert.equal(u.login.hasPassword, true); assert.equal(u.login.mustChange, true, 'temporary by default');
  assert.ok(!('auth' in u) && !JSON.stringify(u).includes(db.users.find(x => x.id === u.id).auth.hash), 'hash never returned');
  assert.equal(api.login('RY-3001', 'Bar1sta2026').mustChange, true);
  assert.ok(!JSON.stringify(db.audit).includes(db.users.find(x => x.id === u.id).auth.hash), 'hash never in the audit log');
  // Reset rules
  assert.equal(code(() => api.setPassword('u4', 's9', 'Reset2026')), 'not_found');        // out of scope
  assert.equal(code(() => api.setPassword('u4', 'u3', 'Reset2026')), 'forbidden_rank');   // above own role
  assert.equal(code(() => api.setPassword('u5', 's9', 'Reset2026')), 'forbidden_role');   // no "add and edit people" grant
  assert.equal(code(() => api.setPassword('s1', 's2', 'Reset2026')), 'forbidden_role');
  assert.equal(code(() => api.setPassword('u2', 'u1', 'Reset2026')), 'forbidden_rank');   // IT cannot reset the Admin
  assert.equal(code(() => api.setPassword('u1', 'u1', 'Reset2026')), 'invalid');          // own: use change password
  api.setPassword('u3', 'u4', 'Reset2026', false);
  assert.equal(api.login('nora@btw.example', 'Reset2026').mustChange, false);
  assert.ok(db.audit.some(a => a.action === 'user.password_set' && a.entityId === 'u4'));
});

test('people change their own password; temporary passwords must be replaced', () => {
  const { api } = fresh();
  api.setPassword('u4', 's1', 'Temp2026', true);
  assert.equal(api.me('s1').mustChange, true);
  assert.equal(code(() => api.changeOwnPassword('s1', 'wrong', 'Mine2026x')), 'bad_credentials');
  assert.equal(code(() => api.changeOwnPassword('s1', 'Temp2026', 'Temp2026')), 'invalid');
  assert.equal(code(() => api.changeOwnPassword('s1', 'Temp2026', 'weak')), 'invalid');
  api.changeOwnPassword('s1', 'Temp2026', 'Mine2026x');
  assert.equal(api.me('s1').mustChange, false);
  assert.equal(code(() => api.login('RY-1103', 'Temp2026')), 'bad_credentials');
  assert.equal(api.login('RY-1103', 'Mine2026x').mustChange, false);
});

test('CSV import needs a temporary password and every imported account must change it', () => {
  const { api } = fresh();
  const csv = 'employee_code,full_name_en,location\nRY-4001,Imported One,Olaya';
  assert.equal(code(() => api.commitImport('u4', csv)), 'invalid');
  assert.equal(code(() => api.commitImport('u4', csv, 'abc')), 'invalid');
  assert.deepEqual(api.commitImport('u4', csv, 'Welcome2026'), { created: 1, skipped: 0 });
  assert.equal(api.login('RY-4001', 'Welcome2026').mustChange, true);
});

test('full data export never contains password hashes', () => {
  const { api } = fresh();
  const json = api.fullExport('u2').json;
  assert.ok(!json.includes('"hash"') && !json.includes('"salt"'));
});

/* ---------------- 14 Oct: clean start, product cards, live-site view ---------------- */

test('a fresh installation has no people and no sample content; the first Admin is created once', () => {
  const db = Core.seed(NOW);
  for (const k of ['users', 'courses', 'sections', 'files', 'exams', 'enrollments', 'certs', 'faqs', 'locations']) assert.equal(db[k].length, 0, k);
  assert.equal(db.integrations.drive.connected, false);
  const api = Core.createBackend(db, { now: () => NOW, random: () => 0.3 });
  assert.equal(api.needsSetup(), true);
  assert.equal(api.publicInfo().needsSetup, true);
  assert.equal(code(() => api.setupAdmin({ name: { en: 'Owner' }, email: 'not-an-email', password: '10203040' })), 'invalid');
  assert.equal(code(() => api.setupAdmin({ name: { en: 'Owner' }, email: 'owner@btw.sa', password: '1234' })), 'invalid');
  const r = api.setupAdmin({ name: { en: 'Owner', ar: 'المالك' }, email: 'Owner@BTW.sa', password: '10203040' });
  assert.equal(api.needsSetup(), false);
  assert.equal(api.me(r.userId).user.role, 'admin');
  assert.equal(api.me(r.userId).perms.length, Core.PERMISSIONS.length);
  assert.equal(api.login('owner@btw.sa', '10203040').userId, r.userId);
  assert.equal(code(() => api.setupAdmin({ name: { en: 'Second' }, email: 'x@btw.sa', password: '12345678' })), 'conflict', 'setup works only once');
  assert.equal(db.locations.length, 1, 'a head-office location is created so people can be added');
  assert.ok(!JSON.stringify(api.me(r.userId)).includes(db.users[0].auth.hash));
  // Recovery (server allows it only with the setup code) replaces the password and signs out other sessions.
  const before = db.users[0].sessionVer;
  api.recoverAdmin('owner@btw.sa', 'NewPass2026');
  assert.ok(db.users[0].sessionVer > before);
  assert.equal(code(() => api.login('owner@btw.sa', '10203040')), 'bad_credentials');
  assert.equal(api.login('owner@btw.sa', 'NewPass2026').userId, r.userId);
  assert.ok(db.audit.some(a => a.action === 'system.setup') && db.audit.some(a => a.action === 'system.recover_admin'));
});

test('product cards: PDFs uploaded per section, in order; the quiz opens after the last card', () => {
  const { api, db } = fresh();
  const sid = 's_c4_2';
  assert.equal(code(() => api.addCards('s1', sid, [{ path: sid + '/a.pdf', title: 'A' }])), 'forbidden_role');
  assert.equal(code(() => api.addCards('u3', sid, [{ path: 's_c1_1/a.pdf', title: 'A' }])), 'invalid', 'paths belong to the section');
  assert.equal(code(() => api.addCards('u3', sid, [{ path: sid + '/a.png', title: 'A' }])), 'invalid', 'PDF only');
  assert.equal(code(() => api.addCards('u3', sid, [{ path: sid + '/a.pdf', title: 'A', size: 60 * 1024 * 1024 }])), 'invalid', '50 MB limit');
  const added = api.addCards('u3', sid, [{ path: sid + '/1.pdf', title: 'Cold brew' }, { path: sid + '/2.pdf', title: 'Iced latte' }, { path: sid + '/1.pdf', title: 'dup' }]);
  assert.equal(added.length, 2, 'the same upload is not added twice');
  assert.deepEqual(db.files.filter(f => f.sectionId === sid).sort((a, b) => a.pos - b.pos).map(f => f.title), ['Cold brew', 'Iced latte']);
  assert.equal(api.renameFile('u3', added[1].id, '  Iced latte (new) ').title, 'Iced latte (new)');
  assert.equal(code(() => api.renameFile('u3', added[1].id, '')), 'invalid');
  // Area Manager u5 manages files only for c4 — it is in scope.
  assert.equal(api.addCards('u5', sid, [{ path: sid + '/3.pdf', title: 'Ice' }]).length, 1);
  assert.equal(code(() => api.addCards('u5', 's_c1_1', [{ path: 's_c1_1/3.pdf', title: 'Ice' }])), 'forbidden_scope');
  // A learner path through a section with cards and a quiz.
  db.exams.push({ id: 'xq', courseId: 'c1', sectionId: 's_c1_1', kind: 'section', title: { en: 'Q', ar: 'Q' }, passPct: 50, timeLimitMin: 0, maxAttempts: 0, allowRetake: true, review: 'none', shuffle: false, questions: [{ id: 'qq', type: 'tf', prompt: { en: 'p', ar: 'p' }, choices: [{ id: 'y', text: { en: 'T', ar: 'T' }, correct: true }, { id: 'n', text: { en: 'F', ar: 'F' }, correct: false }] }] });
  db.exams = db.exams.filter(x => x.id !== 'x1');
  const sec = () => api.learnerCourse('s6', 'c1').sections.find(s => s.id === 's_c1_1');
  assert.equal(sec().cardsTotal, 2); assert.equal(sec().cardsViewed, 0); assert.equal(sec().exam.locked, true);
  assert.equal(code(() => api.startAttempt('s6', 'xq')), 'locked');
  const files = db.files.filter(f => f.sectionId === 's_c1_1');
  assert.deepEqual(api.markFileViewed('s6', files[0].id), { viewed: 1, total: 2, all: false });
  assert.deepEqual(api.markFileViewed('s6', files[1].id), { viewed: 2, total: 2, all: true });
  assert.equal(sec().exam.locked, false);
  assert.ok(api.startAttempt('s6', 'xq').attemptId);
  // Replacing a card asks people to look at it again.
  api.replaceFile('u3', files[0].id, { path: 's_c1_1/new.pdf', title: 'Updated card', size: 1000 });
  assert.equal(sec().cardsViewed, 1);
  // Who may open a card: enrolled learners and managers of that course; not other staff.
  assert.equal(api.canViewFile('s6', files[0].id).id, files[0].id);
  assert.equal(api.canViewFile('u3', files[0].id).id, files[0].id);
  assert.equal(code(() => api.canViewFile('s7', db.files.find(f => f.sectionId === 's_c3_1').id)), 'not_found');
  // Sections without a quiz complete only after the cards.
  db.exams = db.exams.filter(x => x.sectionId !== 's_c1_4');
  assert.equal(code(() => api.completeSection('s6', 's_c1_4')), 'locked');
  viewCards(api, db, 's6', 's_c1_4');
  assert.equal(api.completeSection('s6', 's_c1_4').done, true);
});

test('the seconds-per-card setting is a training setting between 0 and 120', () => {
  const { api } = fresh();
  assert.equal(api.updateSettings('u3', 'training', { cardMinSeconds: 8 }).cardMinSeconds, 8);
  assert.equal(code(() => api.updateSettings('u3', 'training', { cardMinSeconds: 500 })), 'invalid');
  assert.equal(code(() => api.updateSettings('s1', 'training', { cardMinSeconds: 3 })), 'forbidden_role');
});

test('live-site copy: each person receives only what they may see, never hashes or answers', () => {
  const { api, db } = fresh();
  const staff = api.scopedView('s1');
  const txt = JSON.stringify(staff);
  assert.ok(!/"hash"|"salt"|"auth"/.test(txt), 'no password material');
  assert.ok(!/"correct"/.test(txt), 'no correct answers for learners');
  assert.ok(staff.exams.every(x => x.questions.every(q => Object.keys(q).join() === 'id')), 'learners get question counts only');
  assert.deepEqual([...new Set(staff.enrollments.map(e => e.userId))], ['s1']);
  assert.deepEqual([...new Set(staff.notifications.map(n => n.userId))], ['s1']);
  assert.deepEqual(staff.users.filter(u => !u.stub).map(u => u.id), ['s1']);
  assert.ok(staff.users.filter(u => u.stub).every(u => Object.keys(u).sort().join() === 'id,name,role,status,stub'), 'others appear as a name only');
  assert.equal(staff.audit.length, 0); assert.equal(staff.loginAttempts.length, 0);
  assert.ok(!('token' in staff.integrations.drive));
  assert.deepEqual(Object.keys(staff.grants), []);
  assert.ok(staff.courses.every(c => db.enrollments.some(e => e.userId === 's1' && e.courseId === c.id)), 'only assigned courses');
  // The same read functions give the same answers on the person's copy.
  const local = Core.createBackend(staff, { now: () => NOW });
  assert.deepEqual(local.learnerHome('s1'), api.learnerHome('s1'));
  assert.deepEqual(local.learnerCourse('s1', 'c1'), api.learnerCourse('s1', 'c1'));
  assert.deepEqual(local.me('s1'), api.me('s1'));
  // Area Manager: people in scope only; Riyadh manager does not see Khobar or Jeddah staff.
  const am = api.scopedView('u4');
  const ids = am.users.filter(u => !u.stub).map(u => u.id).sort();
  assert.deepEqual(ids, api.listUsers('u4').map(u => u.id).sort());
  assert.ok(!am.enrollments.some(e => ['s7', 's8', 's9', 's10'].includes(e.userId)));
  assert.ok(!/"correct"/.test(JSON.stringify(am.exams)), 'no exam editing permission, no answers');
  const amLocal = Core.createBackend(am, { now: () => NOW });
  assert.deepEqual(amLocal.kpis('u4', {}), api.kpis('u4', {}));
  assert.deepEqual(amLocal.listUsers('u4'), api.listUsers('u4'));
  assert.deepEqual(Object.keys(am.grants), ['u4']);
  // Area Manager with exam editing for course c4 gets answers for c4 only.
  const u5 = api.scopedView('u5');
  assert.ok(u5.exams.filter(x => x.courseId === 'c4').every(x => x.questions.every(q => q.choices.some(c => 'correct' in c))));
  assert.ok(u5.exams.filter(x => x.courseId !== 'c4').every(x => !/"correct"/.test(JSON.stringify(x))));
  // Admin: everything except secrets; audit capped.
  const ad = api.scopedView('u1');
  assert.equal(ad.users.length, db.users.length);
  assert.ok(!/"hash"|"salt"/.test(JSON.stringify(ad)));
  const adLocal = Core.createBackend(ad, { now: () => NOW });
  assert.deepEqual(adLocal.kpis('u1', {}), api.kpis('u1', {}));
  assert.deepEqual(adLocal.listAudit('u1'), api.listAudit('u1'));
  assert.deepEqual(adLocal.getCourseManage('u1', 'c1'), api.getCourseManage('u1', 'c1'));
});

test('password hashing can be supplied by the server (stronger hashes, same rules)', () => {
  const made = [];
  const passwords = {
    make: (pw, by, mustChange, at) => { made.push(pw); return { algo: 'test', salt: 's', hash: 'H(' + pw + ')', setAt: at, setBy: by, mustChange, lastSignInAt: null }; },
    verify: (auth, pw) => auth.hash === 'H(' + pw + ')'
  };
  const db = Core.seed(NOW);
  const api = Core.createBackend(db, { now: () => NOW, passwords });
  const r = api.setupAdmin({ name: { en: 'Owner' }, email: 'owner@btw.sa', password: '10203040' });
  assert.equal(db.users[0].auth.hash, 'H(10203040)');
  assert.equal(api.login('owner@btw.sa', '10203040').userId, r.userId);
  assert.equal(code(() => api.login('owner@btw.sa', 'nope')), 'bad_credentials');
  const loc = db.locations[0].id;
  const u = api.createUser(r.userId, { name: { en: 'Sara' }, code: 'B-1', role: 'staff', locationId: loc, password: 'Temp2026x', mustChange: true });
  assert.equal(api.login('b-1', 'Temp2026x').mustChange, true);
  api.changeOwnPassword(u.id, 'Temp2026x', 'Mine2026x');
  assert.equal(api.login('B-1', 'Mine2026x').mustChange, false);
  assert.deepEqual(made, ['10203040', 'Temp2026x', 'Mine2026x']);
});
