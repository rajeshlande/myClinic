import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Guards on `supabase/schema.sql`.
 *
 * These are not a substitute for running the file — `supabase/schema-tests.sql`
 * does that against a real Postgres. They are the cheap checks that catch the two
 * mistakes that stopped schema 8 from applying at all, plus a few structural
 * properties the file depends on, in the second it takes `npm test` to run.
 */
const sql = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');

/** SQL with `--` comments removed, so prose about a bug is not read as the bug. */
const code = sql.replace(/--[^\n]*/g, '');

/** The body of `create or replace function public.<name>(` up to its closing `$$;`. */
function functionBody(name) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start !== -1, `public.${name}() is not defined in schema.sql`);
  const end = sql.indexOf('$$;', start);
  return sql.slice(start, end);
}

test('btrim/ltrim/rtrim are never given the BOTH/FROM form', () => {
  // `btrim(x, '-')` is a function with two arguments. `trim(both '-' from x)` is
  // the standard form. Mixing them is a syntax error, and because the migration
  // runs its body through EXECUTE the error surfaces as "at or near both" on a
  // half-applied database rather than at the line that caused it.
  const offenders = [...code.matchAll(/\b(btrim|ltrim|rtrim)\s*\(\s*(both|leading|trailing)\b/gi)];
  assert.deepEqual(offenders.map((m) => m[0]), []);
  for (const m of code.matchAll(/\b(btrim|ltrim|rtrim)\s*\(([^();]*\bfrom\b[^();]*)\)/gi)) {
    assert.fail(`invalid ${m[1]}() call: ${m[0]}`);
  }
});

test('the slug rule lives in one function and the migration calls it', () => {
  assert.match(sql, /create or replace function public\.clinic_slug\(\s*p_name text\s*\)/);
  const body = functionBody('clinic_slug');
  // the fallback the URL needs when a name has no ASCII letters at all
  assert.match(body, /'clinic'/, 'clinic_slug should fall back to a literal slug');
  assert.match(body, /btrim\([\s\S]*'-'[\s\S]*\)/, "clinic_slug should trim end hyphens with btrim(x, '-')");
  assert.match(sql, /base := left\(public\.clinic_slug\(r\.name\), 32\);/);
});

test('public_book does not name a variable after a column', () => {
  // `code text;` next to `patients.code` makes every reference ambiguous, and the
  // failure only appears when a stranger books with a phone nobody has used yet.
  const body = functionBody('public_book');
  assert.doesNotMatch(body, /^\s*code\s+text/m, 'a variable named `code` is ambiguous with patients.code');
  assert.match(body, /patient_code text;/);
  assert.match(body, /patient_code := 'PT-'/);
});

test('every security definer function pins search_path', () => {
  const re = /create or replace function public\.(\w+)\([^]*?\$\$/g;
  const unpinned = [];
  for (const m of sql.matchAll(re)) {
    const head = m[0];
    if (!/security definer/i.test(head)) continue;
    if (!/set search_path/i.test(head)) unpinned.push(m[1]);
  }
  assert.deepEqual(unpinned, [], `definer functions without a pinned search_path: ${unpinned.join(', ')}`);
});

test('the five booking RPCs are executable by anon and nothing else is granted to it', () => {
  // A set, not a list: schema 17 drops public_book to change its signature and
  // re-grants it afterwards, so the same function is granted twice by design.
  const granted = [...new Set(
    [...sql.matchAll(/grant execute on function public\.(\w+)\([^)]*\) to anon/gi)].map((m) => m[1]),
  )];
  assert.deepEqual(granted.sort(), [
    'public_book', 'public_booking_busy', 'public_booking_lookup', 'public_cancel_booking', 'public_clinic_profile',
  ]);
});

test('the booking RPC that took a new argument re-grants itself after the drop', () => {
  // Dropping a function drops its privileges with it. The migration that replaced
  // public_book with an 8-argument version has to grant it back, or the public
  // booking page stops working on the next deploy.
  const block = sql.slice(sql.indexOf('§17 · THE AUDIT FIXES'));
  assert.match(block, /drop function if exists public\.public_book\(text, uuid, date, time, text, text, text\)/);
  assert.match(block, /grant execute on function public\.public_book\(text, uuid, date, time, text, text, text, uuid\) to anon/);
  assert.match(block, /p_client uuid default null/);
});

test('the operator licence switch is not granted to the tenant', () => {
  const block = sql.slice(sql.indexOf('§17 · THE AUDIT FIXES'));
  assert.match(block, /revoke all on function public\.set_license_status\(uuid, text\) from public, authenticated/);
  assert.match(block, /grant execute on function public\.set_license_status\(uuid, text\) to service_role/);
});

test('the booking RPCs are revoked from public before being handed to anon', () => {
  for (const fn of ['public_clinic_profile', 'public_booking_busy', 'public_book', 'public_booking_lookup', 'public_cancel_booking']) {
    assert.match(
      sql,
      new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public;`, 'i'),
      `${fn} should be revoked from public`,
    );
  }
});

test('schema 8 does not skip itself when its own objects are missing', () => {
  // A paste that stopped half-way can leave app_meta at 8 with the functions gone.
  // The migration therefore asks for public_book as well as the version number.
  const block = sql.slice(sql.indexOf('do $migration$', sql.indexOf('§8 · PUBLIC BOOKING')));
  assert.match(block, /public\.app_schema_version\(\) >= 8[\s\S]{0,400}proname = 'public_book'/);
});

test('the file is one transaction, so a failure leaves nothing behind', () => {
  assert.match(sql.trimStart(), /^--[^\n]*\n[\s\S]*?\nbegin;/);
  assert.match(sql.trimEnd(), /commit;$/);
});

test('every dollar-quoted block is closed', () => {
  const tags = new Map();
  for (const m of sql.matchAll(/\$([a-z_]*)\$/gi)) {
    const tag = m[1] || '';
    tags.set(tag, (tags.get(tag) || 0) + 1);
  }
  for (const [tag, count] of tags) {
    assert.equal(count % 2, 0, `dollar-quote $${tag}$ opens ${count} times (even expected)`);
  }
});

/** The `create table ... ( … );` block for one table. */
function tableBlock(name) {
  const start = sql.indexOf(`create table if not exists public.${name} (`);
  assert.notEqual(start, -1, `public.${name} is not created in schema.sql`);
  const end = sql.indexOf('\n);', start);
  return sql.slice(start, end);
}

test('the offline capability map matches the columns the schema actually has', async () => {
  // This is the guard for the outage that started it all: the client stamped
  // client_updated_at on every table and sent client_id to every table, but only
  // some of them declare those columns. PostgREST answers 400 / PGRST204 and the
  // outbox retried forever.
  const { OFFLINE_COLUMNS } = await import('../src/lib/offline.js');
  for (const [table, caps] of Object.entries(OFFLINE_COLUMNS)) {
    const block = tableBlock(table);
    assert.equal(/\bclient_id\b/.test(block), caps.client_id,
      `${table}.client_id: client says ${caps.client_id}, schema says ${/\bclient_id\b/.test(block)}`);
    assert.equal(/\bclient_updated_at\b/.test(block), caps.client_updated_at,
      `${table}.client_updated_at: client says ${caps.client_updated_at}, schema says ${/\bclient_updated_at\b/.test(block)}`);
  }
});

test('the migration registry knows about schema 8', () => {
  assert.match(sql, /\(8, 'public-booking', '1\.11\.0'/);
  assert.match(sql, /set schema_version = 8/);
});

test('schema 20 branch policies keep the schema 17 cross-clinic guards', () => {
  // Replacing the visit/invoice policies for branch access must not silently
  // re-open IDOR: a row may still only name a patient and doctor of its clinic.
  const block = sql.slice(sql.indexOf('§20 · v1.41.0'));
  for (const [table, count] of [['appointments', 2], ['consultations', 2], ['invoices', 1]]) {
    const matches = [...block.matchAll(new RegExp(
      `where p\\.id = patient_id and p\\.clinic_id = ${table}\\.clinic_id`, 'g',
    ))];
    assert.equal(matches.length, count, `${table} must keep ${count} patient-ownership check(s)`);
  }
  assert.match(block, /where sd\.id = doctor_id and sd\.clinic_id = appointments\.clinic_id/);
  assert.match(block, /where sd\.id = doctor_id and sd\.clinic_id = consultations\.clinic_id/);
  assert.match(block, /doctor_id is null or exists \(select 1 from public\.staff sd/);
});

test('schema 20 adds branches without changing create_clinic() or destructive SQL', () => {
  const block = sql.slice(sql.indexOf('§20 · v1.41.0'));
  assert.match(block, /set schema_version = 20/);
  assert.match(block, /\(20, 'branches', '1\.41\.0'/);
  assert.match(block, /create table if not exists public\.branches \(/);
  assert.match(block, /create table if not exists public\.staff_branches \(/);
  assert.match(block, /alter table public\.profiles add column if not exists active_branch_id/);
  for (const table of ['appointments', 'consultations', 'invoices']) {
    assert.match(block, new RegExp(`alter table public\\.${table} add column if not exists branch_id`));
  }
  for (const fn of ['create_branch', 'set_staff_branches', 'set_active_branch']) {
    assert.match(block, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to authenticated`));
  }
  assert.match(block, /create trigger appointments_tag_branch/);
  assert.match(block, /create trigger clinics_default_branch/);
  assert.match(block, /create trigger staff_default_branch/);
  assert.match(block, /create trigger branches_owner_assignment/);
  assert.match(block, /execute function public\.tag_branch\(\)/);
  assert.doesNotMatch(block, /delete\s+from/i, 'schema 20 retires assignments with active=false, not DELETE');
  // The final function body is untouched: default branches are made by a trigger.
  const start = sql.lastIndexOf('create or replace function public.create_clinic(');
  const createClinic = sql.slice(start, sql.indexOf('$$;', start));
  assert.match(createClinic, /public\.next_clinic_slug\(clinic_name\)/);
  assert.doesNotMatch(createClinic, /public\.branches/, 'create_clinic() keeps its schema-19 body');
});
