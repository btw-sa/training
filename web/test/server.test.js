// Run: node --test web/test/server.test.js
// The live site's server (server/handler.js) with in-memory stand-ins for the Supabase database
// and storage: setup code, sessions, scoped copies, permission checks, uploads, concurrency.
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../src/core.js');
const { createServer } = require('../../server/handler.js');
const { memoryStore, memoryFiles } = require('../../server/dev-adapters.js');

const ENV = { SETUP_CODE: 'kettle-orbit-42', SESSION_SECRET: 'x'.repeat(40), PBKDF2_ITER: '100000' };
function boot(o = {}) {
  let t = Date.parse('2026-10-14T08:00:00Z');
  const store = memoryStore(o.store);
  const files = memoryFiles('http://dev');
  const server = createServer({ Core, store, files, env: { ...ENV, ...(o.env || {}) }, now: () => t });
  const call = async (op, body = {}, session = null) => server.handle({ body: { op, ...body }, session });
  return { server, store, files, call, advance: ms => { t += ms; } };
}
const OWNER = { name: { en: 'Ibrahim', ar: 'إبراهيم' }, email: 'owner@btw.sa', password: '10203040' };
async function withAdmin(o) {
  const b = boot(o);
  const r = await b.call('setup', { code: ENV.SETUP_CODE, admin: OWNER });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { ...b, admin: r.body.token, adminId: r.body.view.meta.me, view: r.body.view };
}
const fn = (b, token, name, ...args) => b.call('call', { fn: name, args }, token);

test('first run: the site asks for setup; only the setup code creates the Admin, once', async () => {
  const b = boot();
  assert.deepEqual((await b.call('public')).body.needsSetup, true);
  assert.equal((await b.call('setup', { code: 'wrong-code-1', admin: OWNER })).body.error.code, 'bad_setup_code');
  const ok = await b.call('setup', { code: ENV.SETUP_CODE, admin: OWNER });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token && ok.body.view.meta.me);
  assert.equal((await b.call('public')).body.needsSetup, false);
  assert.equal((await b.call('setup', { code: ENV.SETUP_CODE, admin: { ...OWNER, email: 'b@btw.sa' } })).body.error.code, 'conflict');
  // The stored password is a PBKDF2 hash, never the password itself.
  const u = b.store._row().doc.users[0];
  assert.equal(u.auth.algo, 'pbkdf2-sha256');
  assert.ok(!JSON.stringify(b.store._row().doc).includes('10203040'));
  assert.ok(!JSON.stringify(ok.body).includes(u.auth.hash));
});

test('without a SETUP_CODE secret nobody can create the Admin', async () => {
  const b = boot({ env: { SETUP_CODE: '' } });
  const r = await b.call('setup', { code: '', admin: OWNER });
  assert.equal(r.body.error.code, 'setup_disabled');
});

test('guessing the setup code is limited to 5 tries per 15 minutes', async () => {
  const b = boot();
  for (let i = 0; i < 5; i++) assert.equal((await b.call('setup', { code: 'guess' + i, admin: OWNER })).body.error.code, 'bad_setup_code');
  assert.equal((await b.call('setup', { code: ENV.SETUP_CODE, admin: OWNER })).body.error.code, 'login_locked');
  b.advance(16 * 60000);
  assert.equal((await b.call('setup', { code: ENV.SETUP_CODE, admin: OWNER })).status, 200);
});

test('sign in, sessions and sign-out everywhere', async () => {
  const b = await withAdmin();
  assert.equal((await b.call('login', { identifier: 'OWNER@btw.sa', password: '10203040' })).status, 200);
  const bad = await b.call('login', { identifier: 'owner@btw.sa', password: 'nope' });
  assert.equal(bad.status, 400); assert.equal(bad.body.error.code, 'bad_credentials');
  assert.equal((await b.call('login', { identifier: 'ghost@btw.sa', password: 'nope' })).body.error.code, 'bad_credentials');
  // Tampered or missing tokens are refused.
  assert.equal((await b.call('view', {}, null)).status, 401);
  const [p, s] = b.admin.split('.');
  assert.equal((await b.call('view', {}, p + 'x.' + s)).status, 401);
  assert.equal((await b.call('view', {}, b.admin)).status, 200);
  // Expired after 7 days.
  b.advance(8 * 86400000);
  assert.equal((await b.call('view', {}, b.admin)).status, 401);
});

test('the browser gets a scoped copy; staff see only their own records and no answers', async () => {
  const b = await withAdmin();
  const loc = b.view.locations[0].id;
  const mk = async (code, role) => (await fn(b, b.admin, 'createUser', { name: { en: code }, code, role, locationId: loc, password: 'Temp2026x', mustChange: false })).body.result;
  const s1 = await mk('S-1', 'staff'); await mk('S-2', 'staff');
  const course = (await fn(b, b.admin, 'createCourse', { title: { en: 'Products', ar: 'المنتجات' } })).body.result;
  const sec = (await fn(b, b.admin, 'saveSection', { courseId: course.id, title: { en: 'Hot drinks' } })).body.result;
  await fn(b, b.admin, 'saveExam', { sectionId: sec.id, passPct: 50, timeLimitMin: 0, maxAttempts: 3, allowRetake: true, review: 'after_submit', questions: [{ type: 'tf', prompt: { en: 'Latte has milk' }, choices: [{ text: { en: 'True' }, correct: true }, { text: { en: 'False' } }] }] });
  await fn(b, b.admin, 'saveExam', { courseId: course.id, passPct: 50, timeLimitMin: 0, maxAttempts: 3, allowRetake: true, review: 'none', questions: [{ type: 'tf', prompt: { en: 'Final' }, choices: [{ text: { en: 'True' }, correct: true }, { text: { en: 'False' } }] }] });
  assert.equal((await fn(b, b.admin, 'publishCourse', course.id, 'First')).status, 200);
  assert.equal((await fn(b, b.admin, 'assign', { courseId: course.id, target: { kind: 'user', ids: [s1.id] } })).body.result.created, 1);
  const login = await b.call('login', { identifier: 's-1', password: 'Temp2026x' });
  const v = login.body.view;
  assert.ok(!/"correct"|"hash"|"salt"/.test(JSON.stringify(v)));
  assert.deepEqual(v.users.filter(u => !u.stub).map(u => u.id), [s1.id]);
  assert.equal(v.audit.length, 0);
  // Staff cannot call manager actions even by hand.
  const forged = await fn(b, login.body.token, 'createUser', { name: { en: 'X' }, code: 'X-1', role: 'admin', locationId: loc, password: 'Temp2026x' });
  assert.equal(forged.status, 403);
  // The actor is always the session's person, whatever the browser sends.
  const res = await b.call('call', { fn: 'setUserStatus', args: [s1.id, 'inactive'] }, login.body.token);
  assert.equal(res.status, 403);
  // Unknown and browser-only actions are refused.
  assert.equal((await fn(b, login.body.token, '_db')).body.error.code, 'invalid');
  assert.equal((await fn(b, b.admin, 'connectDrive', {})).body.error.code, 'not_available');
  // Admin sees the audit trail; entries also go to the audit_log table.
  const av = (await b.call('view', {}, b.admin)).body.view;
  assert.ok(av.audit.some(a => a.action === 'course.publish'));
  assert.ok(b.store._audit.some(a => a.action === 'assignment.create'));
});

test('product cards: upload slots, storage check, signed links only for allowed people', async () => {
  const b = await withAdmin();
  const loc = b.view.locations[0].id;
  const staff = (await fn(b, b.admin, 'createUser', { name: { en: 'Sara' }, code: 'S-1', role: 'staff', locationId: loc, password: 'Temp2026x', mustChange: false })).body.result;
  const other = (await fn(b, b.admin, 'createUser', { name: { en: 'Omar' }, code: 'S-2', role: 'staff', locationId: loc, password: 'Temp2026x', mustChange: false })).body.result;
  const course = (await fn(b, b.admin, 'createCourse', { title: { en: 'Products' } })).body.result;
  const sec = (await fn(b, b.admin, 'saveSection', { courseId: course.id, title: { en: 'Cold drinks' } })).body.result;
  const ups = (await b.call('uploadUrls', { sectionId: sec.id, count: 2 }, b.admin)).body.uploads;
  assert.equal(ups.length, 2);
  assert.ok(ups.every(u => u.path.startsWith(sec.id + '/') && u.path.endsWith('.pdf')));
  // Recording a card that was never uploaded is refused.
  assert.equal((await fn(b, b.admin, 'addCards', sec.id, [{ path: ups[0].path, title: 'Iced latte' }])).body.error.code, 'invalid');
  // Upload through the signed links (what the browser does), then record them; sizes come from storage.
  for (const u of ups) { const tok = new URL(u.url).searchParams.get('token'); assert.ok(b.files.take(tok, 'put', u.path)); assert.equal(b.files.put(u.path, Buffer.from('%PDF-1.4 test'), 'application/pdf'), null); }
  const add = await fn(b, b.admin, 'addCards', sec.id, [{ path: ups[0].path, title: 'Iced latte', size: 1 }, { path: ups[1].path, title: 'Cold brew', size: 1 }]);
  assert.equal(add.status, 200);
  assert.deepEqual(add.body.result.map(f => f.size), [13, 13]);
  const cards = add.body.result;
  // Staff not assigned the course cannot get a link; assigned staff and managers can.
  const sTok = (await b.call('login', { identifier: 'S-1', password: 'Temp2026x' })).body.token;
  const oTok = (await b.call('login', { identifier: 'S-2', password: 'Temp2026x' })).body.token;
  assert.equal((await b.call('cardUrl', { fileId: cards[0].id }, sTok)).status, 404);
  await fn(b, b.admin, 'saveExam', { courseId: course.id, passPct: 50, timeLimitMin: 0, maxAttempts: 0, allowRetake: true, review: 'none', questions: [{ type: 'tf', prompt: { en: 'q' }, choices: [{ text: { en: 'T' }, correct: true }, { text: { en: 'F' } }] }] });
  await fn(b, b.admin, 'publishCourse', course.id, '');
  await fn(b, b.admin, 'assign', { courseId: course.id, target: { kind: 'user', ids: [staff.id] } });
  const link = await b.call('cardUrl', { fileId: cards[0].id }, sTok);
  assert.equal(link.status, 200);
  assert.ok(/\/storage\/v1\/object\/sign\/cards\//.test(link.body.url));
  assert.equal((await b.call('cardUrl', { fileId: cards[0].id }, oTok)).status, 404);
  // Staff cannot ask for upload slots.
  assert.equal((await b.call('uploadUrls', { sectionId: sec.id, count: 1 }, sTok)).status, 403);
  // Viewing cards is recorded on the server.
  const mv = await fn(b, sTok, 'markFileViewed', cards[0].id);
  assert.deepEqual(mv.body.result, { viewed: 1, total: 2, all: false });
  // Removing a card deletes its PDF from storage.
  assert.equal(b.files._objects.size, 2);
  await fn(b, b.admin, 'removeFile', cards[1].id);
  assert.equal(b.files._objects.size, 1);
});

test('changing your own password signs out other devices and returns a fresh session', async () => {
  const b = await withAdmin();
  const other = (await b.call('login', { identifier: 'owner@btw.sa', password: '10203040' })).body.token;
  const r = await fn(b, b.admin, 'changeOwnPassword', '10203040', 'Stronger2026');
  assert.equal(r.status, 200); assert.ok(r.body.token);
  assert.equal((await b.call('view', {}, other)).status, 401, 'old sessions end');
  assert.equal((await b.call('view', {}, b.admin)).status, 401);
  assert.equal((await b.call('view', {}, r.body.token)).status, 200);
  assert.equal((await b.call('login', { identifier: 'owner@btw.sa', password: 'Stronger2026' })).status, 200);
  assert.equal((await fn(b, r.body.token, 'changeOwnPassword', 'wrong', 'Another2026')).body.error.code, 'bad_credentials');
});

test('a lost Admin password is reset with the setup code only', async () => {
  const b = await withAdmin();
  assert.equal((await b.call('recover', { code: 'nope', email: 'owner@btw.sa', password: 'Reset2026x' })).body.error.code, 'bad_setup_code');
  const r = await b.call('recover', { code: ENV.SETUP_CODE, email: 'owner@btw.sa', password: 'Reset2026x' });
  assert.equal(r.status, 200);
  assert.equal((await b.call('view', {}, b.admin)).status, 401);
  assert.equal((await b.call('login', { identifier: 'owner@btw.sa', password: 'Reset2026x' })).status, 200);
});

test('two saves at once: the later one is re-run on fresh data, nothing is lost', async () => {
  let bumped = false;
  const holder = {};
  const b = await withAdmin({ store: { beforeSave: async () => { if (holder.arm && !bumped) { bumped = true; holder.store._bump(); } } } });
  holder.store = b.store;
  holder.arm = true;
  const loc = b.view.locations[0].id;
  const r = await fn(b, b.admin, 'createUser', { name: { en: 'Late' }, code: 'L-1', role: 'staff', locationId: loc, password: 'Temp2026x' });
  assert.equal(r.status, 200);
  assert.ok(bumped);
  assert.equal(b.store._row().doc.users.filter(u => u.code === 'L-1').length, 1);
});

test('failed actions change nothing; daily reminders run once a day', async () => {
  const b = await withAdmin();
  const v0 = b.store._row().version;
  assert.equal((await fn(b, b.admin, 'createCourse', { title: {} })).status, 400);
  assert.equal(b.store._row().version, v0, 'not saved');
  b.advance(86400000);
  await b.call('view', {}, b.admin);
  const day = b.store._row().doc.meta.lastDaily;
  const v1 = b.store._row().version;
  await b.call('view', {}, b.admin);
  assert.equal(b.store._row().version, v1, 'second view the same day saves nothing');
  assert.ok(day);
});

test('every action the browser may send exists on the server', () => {
  const api = Core.createBackend(Core.seed());
  for (const f of [...Core.MUTATIONS, ...Core.SERVER_READS]) assert.equal(typeof api[f], 'function', f);
});
