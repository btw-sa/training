// Database permission tests: runs the real migrations in an embedded Postgres 16 (PGlite)
// and calls them as each kind of user, the same way the app's API requests would.
// Run: node --test supabase/tests/rls.test.js   (needs: npm install @electric-sql/pglite)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PGlite } = require(process.env.PGLITE_PATH || '@electric-sql/pglite');

const dir = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(dir, p), 'utf8');
const AUTH = { admin: 'aaaaaaaa-0000-0000-0000-000000000001', it: 'aaaaaaaa-0000-0000-0000-000000000002', ops: 'aaaaaaaa-0000-0000-0000-000000000003', nora: 'aaaaaaaa-0000-0000-0000-000000000004', faisal: 'aaaaaaaa-0000-0000-0000-000000000005', sara: 'aaaaaaaa-0000-0000-0000-000000000011', yousef: 'aaaaaaaa-0000-0000-0000-000000000012', abdulaziz: 'aaaaaaaa-0000-0000-0000-000000000013', mona: 'aaaaaaaa-0000-0000-0000-000000000014' };
const P = { admin: '00000000-0000-0000-0000-0000000000a1', it: '00000000-0000-0000-0000-0000000000a2', ops: '00000000-0000-0000-0000-0000000000a3', nora: '00000000-0000-0000-0000-0000000000a4', faisal: '00000000-0000-0000-0000-0000000000a5', sara: '00000000-0000-0000-0000-0000000000b1', yousef: '00000000-0000-0000-0000-0000000000b2', abdulaziz: '00000000-0000-0000-0000-0000000000b3', mona: '00000000-0000-0000-0000-0000000000b4' };
const L = { olaya: '10000000-0000-0000-0000-000000000001', malqa: '10000000-0000-0000-0000-000000000002', khobar: '10000000-0000-0000-0000-000000000003', tahlia: '10000000-0000-0000-0000-000000000004' };
const COURSE = '30000000-0000-0000-0000-000000000001', S1 = '31000000-0000-0000-0000-000000000001', S2 = '31000000-0000-0000-0000-000000000002';
const QUIZ = '32000000-0000-0000-0000-000000000001', FINAL = '32000000-0000-0000-0000-000000000002', SKILL = '35000000-0000-0000-0000-000000000001';

let db;
async function fresh() {
  db = new PGlite();
  await db.exec(read('tests/00_supabase_stub.sql'));
  for (const f of fs.readdirSync(path.join(dir, 'migrations')).sort()) await db.exec(read('migrations/' + f));
  await db.exec(read('seed.sql'));
}
// Run a query as a signed-in user (role "authenticated" with their auth id), like an API request.
async function as(who, sql, params) {
  const id = who === 'anon' ? '' : AUTH[who];
  await db.exec(`set role ${who === 'anon' ? 'anon' : 'authenticated'}; select set_config('request.jwt.claim.sub', '${id}', false);`);
  try { return (await db.query(sql, params)).rows; }
  finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
async function err(who, sql, params) {
  try { await as(who, sql, params); return 'ok'; } catch (e) { return e.message; }
}
const one = async (who, sql, params) => (await as(who, sql, params))[0];

test.before(fresh);

test('staff see only themselves; Area Managers only their locations', async () => {
  assert.deepEqual((await as('sara', 'select id from profiles')).map(r => r.id), [P.sara]);
  const nora = (await as('nora', 'select id from profiles')).map(r => r.id).sort();
  for (const id of [P.sara, P.yousef, P.nora]) assert.ok(nora.includes(id));
  for (const id of [P.abdulaziz, P.mona]) assert.ok(!nora.includes(id), 'out of scope visible');
  const faisal = (await as('faisal', 'select id from profiles')).map(r => r.id);
  assert.ok(faisal.includes(P.mona) && faisal.includes(P.abdulaziz) && !faisal.includes(P.sara));
  assert.equal((await as('ops', 'select count(*)::int n from profiles'))[0].n, 9);
});

test('people are written only through checked functions', async () => {
  assert.match(await err('nora', `insert into profiles (full_name_en, email, location_id) values ('X', 'x@y.co', $1)`, [L.olaya]), /permission denied/);
  assert.match(await err('sara', `update profiles set role = 'admin' where id = $1`, [P.sara]), /permission denied/);
  const body = (loc, role) => JSON.stringify({ full_name_en: 'New Barista', email: `nb.${loc.slice(-1)}.${role}@btw.example`, location_id: loc, role });
  assert.equal(await err('nora', 'select create_user($1::jsonb)', [body(L.khobar, 'staff')]), 'forbidden_scope');
  assert.equal(await err('nora', 'select create_user($1::jsonb)', [body(L.olaya, 'area_manager')]), 'forbidden_rank');
  assert.equal(await err('faisal', 'select create_user($1::jsonb)', [body(L.tahlia, 'staff')]), 'forbidden_role');
  assert.equal(await err('sara', 'select create_user($1::jsonb)', [body(L.olaya, 'staff')]), 'forbidden_role');
  const created = await one('nora', 'select create_user($1::jsonb) id', [body(L.malqa, 'staff')]);
  assert.ok(created.id);
  const audit = (await db.query(`select actor_id, action from audit_log where table_name = 'profiles' and row_id = $1`, [created.id])).rows;
  assert.deepEqual(audit, [{ actor_id: P.nora, action: 'insert' }]);
  assert.equal(await err('nora', `select update_user($1, '{"location_id":"${L.tahlia}"}'::jsonb)`, [created.id]), 'forbidden_scope');
  assert.equal(await err('nora', `select update_user($1, '{"job_title":"x"}'::jsonb)`, [P.mona]), 'not_found');
  assert.equal(await err('it', `select update_user($1, '{"job_title":"x"}'::jsonb)`, [P.admin]), 'forbidden_rank');
  assert.equal(await err('it', 'select create_user($1::jsonb)', [body(L.olaya, 'admin')]), 'forbidden_rank');
  assert.equal(await err('ops', 'select create_user($1::jsonb)', [body(L.olaya, 'it_manager')]), 'forbidden_rank');
  assert.equal(await err('nora', 'select create_user($1::jsonb)', [JSON.stringify({ full_name_en: 'Dup', email: 'sara@btw.example', location_id: L.olaya })]), 'invalid');
});

test('last Admin protected; history means deactivate, not delete', async () => {
  assert.equal(await err('admin', `select set_user_status($1, 'inactive')`, [P.admin]), 'forbidden_rank');
  assert.equal(await err('it', `select set_user_status($1, 'inactive')`, [P.admin]), 'forbidden_rank');
  assert.equal(await err('nora', 'select remove_user($1)', [P.sara]), 'forbidden_role');
  await db.query(`insert into section_progress (user_id, section_id, course_version, completed_at) values ($1, $2, 1, now())`, [P.yousef, S2]);
  assert.equal(await err('ops', 'select remove_user($1)', [P.yousef]), 'has_history');
});

test('only Admins grant Area Manager access, and only grantable permissions', async () => {
  const call = `select set_area_manager_access($1, $2::text[], $3::uuid[], '{}', '{}', '{}')`;
  assert.equal(await err('it', call, [P.faisal, '{users.view}', `{${L.tahlia}}`]), 'forbidden_role');
  assert.equal(await err('ops', call, [P.faisal, '{users.view}', `{${L.tahlia}}`]), 'forbidden_role');
  assert.equal(await err('admin', call, [P.faisal, '{settings.system}', `{${L.tahlia}}`]), 'invalid');
  assert.equal(await err('admin', call, [P.sara, '{users.view}', `{${L.olaya}}`]), 'invalid');
  // Granting a non-grantable key directly is ignored by has_perm even if someone inserts it.
  await db.query(`insert into area_manager_permissions (user_id, permission) values ($1, 'audit.view')`, [P.faisal]);
  assert.equal((await as('faisal', 'select count(*)::int n from audit_log'))[0].n, 0);
});

test('learners never receive correct answers; grading happens in the database', async () => {
  assert.equal((await as('sara', 'select count(*)::int n from choices'))[0].n, 0);
  assert.equal((await as('sara', 'select count(*)::int n from questions'))[0].n, 0);
  assert.equal((await as('ops', 'select count(*)::int n from choices'))[0].n, 8);
  const start = (await one('sara', 'select start_attempt($1) j', [QUIZ])).j;
  assert.ok(!JSON.stringify(start).includes('is_correct'));
  assert.equal(start.questions.length, 2);
  assert.match(await err('sara', `insert into exam_attempts (exam_id, user_id, course_version, attempt_no, question_order, score_pct, passed) values ($1, $2, 1, 9, '{}', 100, true)`, [QUIZ, P.sara]), /permission denied/);
  assert.match(await err('sara', `insert into section_progress (user_id, section_id, course_version, completed_at) values ($1, $2, 1, now())`, [P.sara, S1]), /permission denied/);
  const wrong = { '33000000-0000-0000-0000-000000000001': '34000000-0000-0000-0000-000000000002', '33000000-0000-0000-0000-000000000002': '34000000-0000-0000-0000-000000000003' };
  const r1 = (await one('sara', 'select submit_attempt($1, $2::jsonb) j', [start.attempt_id, JSON.stringify(wrong)])).j;
  assert.equal(r1.score_pct, 50); assert.equal(r1.passed, false); assert.ok(r1.review);
  assert.equal(await err('sara', 'select submit_attempt($1, $2::jsonb)', [start.attempt_id, JSON.stringify(wrong)]), 'conflict');
  assert.equal(await err('sara', 'select start_attempt($1)', [FINAL]), 'locked');
  assert.equal(await err('mona', 'select start_attempt($1)', [QUIZ]), 'not_found');
});

test('full journey issues a certificate; public check shows initials only', async () => {
  const s = (await one('sara', 'select start_attempt($1) j', [QUIZ])).j;
  const right = { '33000000-0000-0000-0000-000000000001': '34000000-0000-0000-0000-000000000001', '33000000-0000-0000-0000-000000000002': '34000000-0000-0000-0000-000000000003' };
  assert.equal((await one('sara', 'select submit_attempt($1, $2::jsonb) j', [s.attempt_id, JSON.stringify(right)])).j.passed, true);
  assert.equal(await err('sara', 'select complete_section($1)', [S1]), 'invalid');
  await as('sara', 'select complete_section($1)', [S2]);
  const f = (await one('sara', 'select start_attempt($1) j', [FINAL])).j;
  const rf = (await one('sara', 'select submit_attempt($1, $2::jsonb) j', [f.attempt_id, JSON.stringify({ '33000000-0000-0000-0000-000000000003': '34000000-0000-0000-0000-000000000005', '33000000-0000-0000-0000-000000000004': '34000000-0000-0000-0000-000000000008' })])).j;
  assert.equal(rf.passed, true); assert.equal(rf.certificate_id, null, 'sign-off still pending');
  assert.equal(await err('faisal', `select set_signoff($1, $2, 'passed')`, [SKILL, P.sara]), 'not_found');
  assert.equal(await err('sara', `select set_signoff($1, $2, 'passed')`, [SKILL, P.sara]), 'forbidden_role');
  const so = (await one('nora', `select set_signoff($1, $2, 'passed', 'Three shots in a row on recipe') j`, [SKILL, P.sara])).j;
  assert.ok(so.certificate_id);
  const cert = await one('sara', 'select cert_no, status from certificates where id = $1', [so.certificate_id]);
  assert.match(cert.cert_no, /^BTW-\d{4}-[2-9A-Z]{4}-[2-9A-Z]{4}$/);
  const v = await one('anon', 'select * from verify_certificate($1)', [cert.cert_no.toLowerCase()]);
  assert.equal(v.status, 'valid'); assert.equal(v.holder_initials_en, 'S. A.');
  assert.ok(!JSON.stringify(v).includes('Sara'));
  assert.match(await err('anon', 'select * from certificates'), /permission denied/);
  assert.equal((await as('mona', 'select count(*)::int n from certificates'))[0].n, 0);
  assert.match(await err('sara', `update certificates set status = 'valid'`), /permission denied/);
  // Revoke needs the permission, scope and a reason.
  assert.equal(await err('nora', 'select revoke_certificate($1, $2)', [so.certificate_id, 'Wrong person']), 'forbidden_role');
  assert.equal(await err('ops', 'select revoke_certificate($1, $2)', [so.certificate_id, '']), 'invalid');
  await as('ops', 'select revoke_certificate($1, $2)', [so.certificate_id, 'Issued in error, audit 14']);
  assert.equal((await one('anon', 'select status from verify_certificate($1)', [cert.cert_no])).status, 'revoked');
  const log = (await db.query(`select reason from audit_log where table_name = 'certificates' and action = 'update' order by id desc limit 1`)).rows[0];
  assert.equal(log.reason, 'Issued in error, audit 14');
});

test('assignments stay inside scope', async () => {
  const call = `select assign_course($1, $2, $3, null, current_date + 7) j`;
  assert.equal(await err('nora', call, [COURSE, 'location', L.khobar]), 'forbidden_scope');
  assert.equal(await err('faisal', call, [COURSE, 'location', L.tahlia]), 'forbidden_role');
  const r = (await one('nora', call, [COURSE, 'location', L.malqa])).j;
  assert.equal(r.skipped, 1); // Yousef already enrolled on this version
  const role = (await one('nora', `select assign_course($1, 'role', null, 'staff', current_date + 7) j`, [COURSE])).j;
  const enrolledNow = (await db.query(`select user_id from enrollments where course_id = $1 and active`, [COURSE])).rows.map(x => x.user_id);
  assert.ok(!enrolledNow.includes(P.mona), 'role assignment by an Area Manager must not reach other regions');
  assert.ok(role.created >= 0);
});

test('settings are split by group; audit log is read-only and Admin/IT only', async () => {
  assert.equal(await err('ops', `select update_settings('system', '{"cert_prefix":"XX"}'::jsonb)`), 'forbidden_role');
  assert.equal(await err('ops', `select update_settings('kpi', '{"kpi":{"minSignals":3}}'::jsonb)`), 'forbidden_role');
  assert.equal(await err('ops', `select update_settings('training', '{"business_name_en":"X"}'::jsonb)`), 'forbidden_role');
  assert.equal(await err('ops', `select update_settings('training', '{"default_due_days":10}'::jsonb)`), 'ok');
  assert.equal(await err('admin', `select update_settings('kpi', '{"kpi":{"minSignals":1}}'::jsonb)`), 'invalid');
  assert.match(await err('ops', `update app_settings set cert_prefix = 'XX'`), /permission denied/);
  assert.equal((await as('ops', 'select count(*)::int n from audit_log'))[0].n, 0);
  assert.equal((await as('sara', 'select count(*)::int n from audit_log'))[0].n, 0);
  assert.ok((await as('it', 'select count(*)::int n from audit_log'))[0].n > 0);
  await assert.rejects(db.query(`update audit_log set reason = 'x'`), /append-only/);
  await assert.rejects(db.query(`delete from audit_log`), /append-only/);
});

test('course status changes only through publish; retrain re-enrolls', async () => {
  assert.match(await err('ops', `update courses set status = 'archived' where id = $1`, [COURSE]), /permission denied/);
  assert.equal(await err('ops', `update courses set title_en = 'Barista Foundations' where id = $1`, [COURSE]), 'ok');
  assert.equal(await err('nora', 'select publish_course($1, $2, true)', [COURSE, 'x']), 'forbidden_role');
  const before = (await db.query(`select count(*)::int n from enrollments where course_id = $1 and active`, [COURSE])).rows[0].n;
  const r = (await one('ops', 'select publish_course($1, $2, true) j', [COURSE, 'New grinder model'])).j;
  assert.equal(r.version, 2); assert.equal(r.retrained, before);
  const versions = (await db.query(`select distinct course_version v from enrollments where course_id = $1 and active`, [COURSE])).rows;
  assert.deepEqual(versions, [{ v: 2 }]);
  assert.equal((await db.query(`select status from certificates where user_id = $1 and status <> 'revoked'`, [P.sara])).rows.length, 0);
});

test('reminders never duplicate and stay at one a day per person', async () => {
  await db.query(`update enrollments set due_on = current_date - 3 where user_id = $1 and active`, [P.yousef]);
  await db.query(`update enrollments set due_on = current_date + 2 where user_id = $1 and active`, [P.abdulaziz]);
  const r1 = (await db.query('select run_reminders() j')).rows[0].j;
  const r2 = (await db.query('select run_reminders() j')).rows[0].j;
  assert.ok(r1.created >= 1); assert.equal(r2.created, 0);
  const perDay = (await db.query(`select user_id, count(*)::int n from notifications where kind = 'reminder' and created_at::date = current_date group by 1`)).rows;
  assert.ok(perDay.every(x => x.n === 1));
  assert.match(await err('ops', 'select run_reminders()'), /permission denied/);
});

test('notifications: own only, and only read_at can change', async () => {
  const mine = await as('yousef', 'select id, user_id from notifications');
  assert.ok(mine.every(n => n.user_id === P.yousef));
  assert.equal((await as('sara', `select count(*)::int n from notifications where user_id = $1`, [P.yousef]))[0].n, 0);
  assert.match(await err('yousef', `update notifications set body_en = 'x'`), /permission denied/);
  assert.equal(await err('yousef', `update notifications set read_at = now()`), 'ok');
});

test('helper calls used by the app and server functions', async () => {
  const perms = (await one('nora', 'select my_permissions() p')).p;
  assert.ok(perms.includes('users.edit') && !perms.includes('certs.revoke') && !perms.includes('audit.view'));
  assert.deepEqual((await one('sara', 'select my_permissions() p')).p, []);
  assert.equal(await err('faisal', `select request_drive_export('report', 'people', '{}'::jsonb)`), 'forbidden_role');
  const id = (await one('nora', `select request_drive_export('report', 'people', '{}'::jsonb) id`)).id;
  assert.equal(await err('nora', 'select retry_drive_export($1)', [id]), 'conflict');
  assert.match(await err('it', 'select get_drive_refresh_token()'), /permission denied/);
});

// ---- sign-in with employee code or email, manager-set passwords ----
async function asService(sql, params) {
  await db.exec('set role service_role');
  try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role'); }
}

test('who may set a password: same rule as editing the person', async () => {
  const can = async (who, target) => (await one(who, 'select can_set_password($1) ok', [target])).ok;
  assert.equal(await can('nora', P.yousef), true);
  assert.equal(await can('nora', P.mona), false, 'outside her branches');
  assert.equal(await can('nora', P.ops), false, 'above her role');
  assert.equal(await can('nora', P.nora), false, 'own password goes through change-password');
  assert.equal(await can('faisal', P.mona), false, 'no "add and edit people" grant');
  assert.equal(await can('it', P.admin), false);
  assert.equal(await can('admin', P.it), true);
  assert.equal(await can('sara', P.yousef), false);
});

test('sign-in lookup and attempt records are server-only', async () => {
  for (const who of ['anon', 'sara', 'admin']) {
    assert.match(await err(who, `select * from resolve_login('RY-1103', null)`), /permission denied/);
    assert.match(await err(who, `select record_login('RY-1103', null, true, null)`), /permission denied/);
    assert.match(await err(who, `select record_password_set($1, $2, true, null)`, [P.sara, P.admin]), /permission denied/);
    assert.match(await err(who, 'select * from login_attempts'), /permission denied/);
  }
});

test('code or email resolves to the account; five failures lock it; a reset unlocks it', async () => {
  const byCode = (await asService(`select * from resolve_login('  ry-1103 ', '10.0.0.1')`))[0];
  assert.equal(byCode.profile_id, P.sara); assert.equal(byCode.locked, false);
  const byEmail = (await asService(`select * from resolve_login('SARA@btw.example', '10.0.0.1')`))[0];
  assert.equal(byEmail.profile_id, P.sara);
  assert.equal((await asService(`select * from resolve_login('nobody-9', '10.0.0.1')`)).length, 0);
  for (let i = 0; i < 5; i++) await asService(`select record_login('RY-1103', '10.0.0.2', false, null)`);
  assert.equal((await asService(`select * from resolve_login('RY-1103', '10.0.0.3')`))[0].locked, true);
  assert.ok((await db.query(`select 1 from audit_log where action = 'sign_in_locked' and row_id = 'ry-1103'`)).rows.length === 1);
  await asService(`select record_password_set($1, $2, true, null)`, [P.sara, P.nora]);
  const after = (await asService(`select * from resolve_login('RY-1103', '10.0.0.3')`))[0];
  assert.equal(after.locked, false); assert.equal(after.must_change, true);
  const log = (await db.query(`select actor_id, reason from audit_log where table_name = 'profiles' and row_id = $1 order by id desc limit 1`, [P.sara])).rows[0];
  assert.equal(log.actor_id, P.nora, 'the manager is recorded as the one who set it');
  assert.equal(log.reason, 'password reset');
  // A successful sign-in clears failures and stamps the time.
  await asService(`select record_login('RY-1103', '10.0.0.3', true, $1)`, [P.sara]);
  assert.ok((await db.query('select last_sign_in_at from profiles where id = $1', [P.sara])).rows[0].last_sign_in_at);
  // Changing one's own password clears the temporary flag.
  await asService(`select record_own_password_change($1)`, [AUTH.sara]);
  assert.equal((await db.query('select must_change_password m from profiles where id = $1', [P.sara])).rows[0].m, false);
  // Deactivated people cannot sign in.
  await db.query(`update profiles set status = 'inactive' where id = $1`, [P.mona]);
  assert.equal((await asService(`select * from resolve_login('WP-4101', null)`)).length, 0);
});

test('one IP address with 30 failures is throttled', async () => {
  for (let i = 0; i < 30; i++) await asService(`select record_login($1, '10.9.9.9', false, null)`, ['guess-' + i]);
  assert.equal((await asService(`select * from resolve_login('RY-1210', '10.9.9.9')`))[0].locked, true);
  assert.equal((await asService(`select * from resolve_login('RY-1210', '10.9.9.8')`))[0].locked, false);
});
