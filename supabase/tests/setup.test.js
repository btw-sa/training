// Runs supabase/setup.sql in an embedded Postgres (PGlite) with stand-ins for Supabase's roles and
// storage schema, then checks the save function's locking, history and audit rows, and that the
// public roles cannot touch anything.
// Run: node --test supabase/tests/setup.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');

const STUB = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
grant usage on schema public to anon, authenticated, service_role;
`;
let db;
test.before(async () => {
  db = new PGlite();
  await db.exec(STUB);
  const sql = fs.readFileSync(path.join(__dirname, '..', 'setup.sql'), 'utf8');
  await db.exec(sql);
  await db.exec(sql); // running it twice is safe
});
const save = async (v, doc, audit = []) => (await db.query('select public.btw_save_state($1, $2::jsonb, $3::jsonb) v', [v, JSON.stringify(doc), JSON.stringify(audit)])).rows[0].v;
async function as(role, sql) { await db.exec(`set role ${role}`); try { return await db.query(sql); } finally { await db.exec('reset role'); } }
const err = async (role, sql) => { try { await as(role, sql); return 'ok'; } catch (e) { return e.message; } };

test('first save creates the row; later saves need the version they read', async () => {
  assert.equal(Number(await save(0, { a: 1 })), 1);
  assert.equal(await save(0, { a: 2 }), null, 'a second "first save" is refused');
  assert.equal(Number(await save(1, { a: 2 }, [{ at: '2026-10-14T08:00:00Z', action: 'user.create', actorId: 'u1' }])), 2);
  assert.equal(await save(1, { a: 3 }), null, 'stale copy is refused');
  const row = (await db.query('select doc, version from app_state')).rows[0];
  assert.deepEqual(row.doc, { a: 2 }); assert.equal(Number(row.version), 2);
  const audit = (await db.query('select action, actor_id from audit_log')).rows;
  assert.deepEqual(audit, [{ action: 'user.create', actor_id: 'u1' }]);
});

test('history keeps the last 10 saves (plus one per day)', async () => {
  let v = Number((await db.query('select version from app_state')).rows[0].version);
  for (let i = 0; i < 15; i++) v = Number(await save(v, { i }));
  const n = (await db.query('select count(*)::int n from app_state_history')).rows[0].n;
  assert.ok(n <= 11 && n >= 10, 'kept ' + n);
});

test('the public roles cannot read or write anything', async () => {
  for (const role of ['anon', 'authenticated']) {
    assert.match(await err(role, 'select * from app_state'), /permission denied/);
    assert.match(await err(role, 'select * from audit_log'), /permission denied/);
    assert.match(await err(role, 'select * from app_state_history'), /permission denied/);
    assert.match(await err(role, `select public.btw_save_state(1, '{}'::jsonb, '[]'::jsonb)`), /permission denied/);
  }
  assert.equal(await err('service_role', 'select count(*) from app_state'), 'ok');
});

test('the cards bucket is private and PDF only', async () => {
  const b = (await db.query(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'cards'`)).rows[0];
  assert.equal(b.public, false); assert.equal(Number(b.file_size_limit), 52428800); assert.deepEqual(b.allowed_mime_types, ['application/pdf']);
});
