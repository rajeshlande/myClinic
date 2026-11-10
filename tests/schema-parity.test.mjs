import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLAN_IDS, PLAN_LIMITS, PLAN_PRICE_PAISE, DEFAULT_PLAN, planPrice } from '../src/lib/plans.mjs';

/*
 * Step 2 of docs/ARCHITECTURE.md §3 — the gap the architecture review called the
 * highest-value one in the design.
 *
 * Every business rule in this app exists twice on purpose: once in Postgres (the
 * authority) and once in `src/lib` (the mirror, so the UI never offers what the
 * server will reject). Seat caps, prices, plan ids and licence statuses were all
 * duplicated with **nothing testing the pair**, so drift was silent: the screen
 * would show five doctor seats while the trigger allowed three, and every test
 * stayed green.
 *
 * There is no database in CI — but the rules are readable text. These tests parse
 * `supabase/schema.sql` and compare it with the client's vocabulary. No network,
 * no Postgres, no new dependency: the same technique as `function-imports.test.mjs`.
 *
 * When one of these fails, it is not the test that is wrong. Either the SQL changed
 * and the client must follow, or the client changed and the migration must.
 */

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const schema = readFileSync(join(root, 'supabase', 'schema.sql'), 'utf8');
const license = readFileSync(join(root, 'src', 'lib', 'license.mjs'), 'utf8');

/** The body of a `create or replace function public.<name>(...)` definition. */
function functionBody(name) {
  const start = schema.indexOf(`create or replace function public.${name}(`);
  if (start === -1) return '';
  const bodyStart = schema.indexOf('$$', start);
  const bodyEnd = schema.indexOf('$$', bodyStart + 2);
  return schema.slice(bodyStart + 2, bodyEnd);
}

/** The `status` check constraint of clinic_subscriptions — not of appointments. */
function statusConstraint() {
  const table = schema.slice(schema.indexOf('create table if not exists public.clinic_subscriptions'));
  const block = table.slice(0, table.indexOf('create index', 0) + 1 || 4000);
  return /status text not null default '(\w+)' check \(status in \(([^)]*)\)\)/.exec(block);
}

test('the two authority functions still exist under the names the client mirrors', () => {
  // A rename is silent in SQL and fatal here: an empty body would make every
  // comparison below vacuously pass.
  assert.ok(functionBody('plan_seat_limit').length > 0, 'plan_seat_limit() is missing from schema.sql');
  assert.ok(functionBody('plan_price_paise').length > 0, 'plan_price_paise() is missing from schema.sql');
});

test('seat caps in SQL match PLAN_LIMITS', () => {
  const body = functionBody('plan_seat_limit');
  const rows = [...body.matchAll(
    /when '(\w+)'\s+then case p_kind\s+when 'doctors' then (\d+)\s+when 'frontdesk' then (\d+)\s+when 'branches' then (\d+) end/g,
  )];
  const unlimited = [...body.matchAll(/when '(\w+)'\s+then null/g)].map((m) => m[1]);

  const fromSql = Object.fromEntries(rows.map((m) => [m[1], { doctors: Number(m[2]), frontdesk: Number(m[3]), branches: Number(m[4]) }]));
  for (const plan of unlimited) fromSql[plan] = { doctors: null, frontdesk: null, branches: null };

  assert.deepEqual(Object.keys(fromSql).sort(), [...PLAN_IDS].sort(),
    'the SQL and the client must know the same plans');
  assert.deepEqual(fromSql, Object.fromEntries(Object.entries(PLAN_LIMITS).map(([k, v]) => [k, { ...v }])),
    'PLAN_LIMITS in src/lib/plans.mjs has drifted from plan_seat_limit() in schema.sql');
});

test('prices in SQL match PLAN_PRICE_PAISE and the yearly discount', () => {
  const body = functionBody('plan_price_paise');
  const rows = [...body.matchAll(
    /when p_plan = '(\w+)'\s+then case when p_interval = 'yearly' then (\d+)\s+else (\d+) end/g,
  )];
  assert.equal(rows.length, PLAN_IDS.length, 'every plan needs a price row in plan_price_paise()');

  for (const [, plan, yearly, monthly] of rows) {
    assert.equal(Number(monthly), PLAN_PRICE_PAISE[plan], `${plan}: monthly price`);
    assert.equal(Number(yearly), planPrice(plan, { interval: 'yearly' }), `${plan}: yearly price`);
  }
});

test('the plan column constraint lists exactly the plans the client knows', () => {
  const lists = [...schema.matchAll(/check \(plan in \(([^)]*)\)\)/g)]
    .map((m) => [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]).sort());
  assert.ok(lists.length >= 2, 'both plan columns carry the constraint');
  for (const list of lists) assert.deepEqual(list, [...PLAN_IDS].sort());
});

test('the default plan in SQL is the client default', () => {
  const defaults = [...schema.matchAll(/plan text not null default '(\w+)'/g)].map((m) => m[1]);
  assert.ok(defaults.length >= 1);
  for (const value of defaults) assert.equal(value, DEFAULT_PLAN);
});

test('licence statuses in SQL match the statuses the client implements', () => {
  // The client's list is its own JSDoc typedef — the contract the mirror code reads
  // against. Parsing it means adding a status in one place without the other fails.
  const typedef = /@typedef \{([^}]+)\} LicenseStatus/.exec(license);
  assert.ok(typedef, 'license.mjs must keep its LicenseStatus typedef');
  const fromClient = typedef[1].split('|').map((s) => s.replace(/'/g, '').trim()).sort();

  const constraint = statusConstraint();
  assert.ok(constraint, 'clinic_subscriptions.status must keep its check constraint');
  const fromSql = [...constraint[2].matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();

  assert.deepEqual(fromSql, fromClient,
    'a status added on one side only is a state the other cannot represent');
});

test('every status the SQL knows is handled by name in the client', () => {
  const constraint = statusConstraint();
  for (const [, status] of constraint[2].matchAll(/'(\w+)'/g)) {
    assert.ok(license.includes(`'${status}'`), `license.mjs never mentions the status ${status}`);
  }
});
