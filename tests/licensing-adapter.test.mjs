import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { DEFAULT_PLAN, FALLBACK_PLAN } from '../src/lib/plans.mjs';
import { TRIAL_DAYS, canWrite, licenseState } from '../src/lib/license.mjs';
import { CENTRAL_MANAGED_MESSAGE } from '../src/lib/central-sync.mjs';
import {
  CENTRAL_UNAVAILABLE_SUBSCRIPTION, WRITE_BLOCKED_MESSAGE, assertCanWrite, assertPlanIsLocal,
  demoPlanChange, demoRenewal, demoTrial, resolveLicense, seatUsageCounts, writeGate,
} from '../src/lib/licensing-adapter.js';

/**
 * The licence the app acts on.
 *
 * `license.mjs` already decides what a subscription means and is tested on its own.
 * What these tests cover is the composition that used to sit inside `store.jsx`:
 * whose answer wins, which writes are refused, and the exact row a demo click
 * writes. All of it is now injected and clocked, so none of it needs a browser.
 */

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const NOW = new Date('2026-11-02T09:00:00.000Z');
const inDays = (n) => new Date(NOW.getTime() + n * 86400000).toISOString();
const activeRow = (over = {}) => ({
  plan: 'growth', status: 'active', interval: 'monthly',
  current_period_start: inDays(-10), current_period_end: inDays(20), ...over,
});

/* ------------------------------------------------------- whose answer wins */

test('with Central off, the licence is the clinic row and nothing else', () => {
  const license = resolveLicense({ subscription: activeRow() });
  assert.equal(license.status, 'active');
  assert.equal(license.plan, 'growth');
  // and no row at all is "expired", not "no licence object"
  assert.equal(resolveLicense({}).status, 'expired');
});

test('with Central on, the clinic row is ignored — even when it claims a paid plan', () => {
  // this is the whole point of Central: a plan the clinic can write is a plan it
  // can award itself
  const license = resolveLicense({
    subscription: activeRow({ plan: 'chain', status: 'active' }),
    central: { enabled: true, subscription: null },
  });
  assert.equal(license.status, 'read_only', 'Central saying nothing must read as read-only');
  assert.equal(license.plan, FALLBACK_PLAN, 'and must not keep the clinic\'s own plan');
  assert.equal(canWrite(license), false);

  // when Central does answer, that answer is the licence
  const verified = resolveLicense({
    subscription: activeRow({ plan: 'solo' }),
    central: { enabled: true, subscription: activeRow({ plan: 'growth', interval: 'yearly' }) },
  });
  assert.equal(verified.plan, 'growth');
  assert.equal(verified.interval, 'yearly');
  assert.equal(canWrite(verified), true);
});

test('the "Central has not answered" row is one frozen constant, not a literal per call', () => {
  assert.deepEqual({ ...CENTRAL_UNAVAILABLE_SUBSCRIPTION }, { status: 'read_only', plan: FALLBACK_PLAN, interval: 'yearly' });
  assert.ok(Object.isFrozen(CENTRAL_UNAVAILABLE_SUBSCRIPTION));
  // resolving twice must not hand back the same mutable object to be edited by a caller
  const a = resolveLicense({ central: { enabled: true } });
  const b = resolveLicense({ central: { enabled: true } });
  assert.notEqual(a, b);
  assert.equal(a.status, b.status);
});

/* --------------------------------------------------------------- seat usage */

test('seat counts split doctors from front desk and count the branch itself', () => {
  const staff = [
    { role: 'owner' }, { role: 'doctor' }, { role: 'doctor', active: false },
    { role: 'frontdesk' }, { role: 'frontdesk', active: false }, { role: 'frontdesk', active: true },
  ];
  // two active front desk rows: one says active, one says nothing — only `false` hides a seat
  assert.deepEqual(seatUsageCounts(staff), { doctors: 2, frontdesk: 2, branches: 1 });
  assert.deepEqual(seatUsageCounts([]), { doctors: 0, frontdesk: 0, branches: 1 });
  assert.deepEqual(seatUsageCounts(undefined), { doctors: 0, frontdesk: 0, branches: 1 });
  // `active: false` is the only thing that hides a seat; a missing flag is active
  assert.equal(seatUsageCounts([{ role: 'doctor' }, { role: 'doctor', active: null }]).doctors, 2);
});

/* -------------------------------------------------------------- write gate */

test('a live clinic writes while the licence says it may', () => {
  for (const status of ['trial', 'active', 'grace']) {
    const license = licenseState({ plan: 'growth', status, current_period_end: inDays(5), trial_ends_at: inDays(5) }, NOW);
    assert.deepEqual(writeGate({ mode: 'live', license }), { writable: true, readOnly: false }, status);
  }
  for (const status of ['read_only', 'expired', 'cancelled']) {
    const license = licenseState({ plan: 'growth', status, current_period_end: inDays(-40) }, NOW);
    assert.deepEqual(writeGate({ mode: 'live', license }), { writable: false, readOnly: true }, status);
  }
});

test('a demo workspace shows itself writable and still refuses on a lapsed trial', () => {
  const fresh = licenseState({ plan: 'growth', status: 'trial', trial_ends_at: inDays(9) }, NOW);
  assert.deepEqual(writeGate({ mode: 'demo', license: fresh }), { writable: true, readOnly: false });

  const lapsed = licenseState({ plan: 'growth', status: 'trial', trial_ends_at: inDays(-1) }, NOW);
  const gate = writeGate({ mode: 'demo', license: lapsed });
  // this divergence is old and deliberate: there is no server to refuse a demo, so
  // the screens stay live, but a write is still blocked
  assert.equal(gate.writable, true);
  assert.equal(gate.readOnly, true);
});

test('the refusal throws one sentence, and only when read-only', () => {
  assert.doesNotThrow(() => assertCanWrite({ readOnly: false }));
  assert.throws(() => assertCanWrite({ readOnly: true }), (e) => e.message === WRITE_BLOCKED_MESSAGE);
  // the message promises what the app actually does: reads and exports still work
  assert.match(WRITE_BLOCKED_MESSAGE, /readable and exportable/);
});

/* ------------------------------------------------------- Central owns the plan */

test('a plan change is refused while Central is configured, with Central\'s own words', () => {
  assert.doesNotThrow(() => assertPlanIsLocal(false));
  assert.throws(() => assertPlanIsLocal(true), (e) => e.message === CENTRAL_MANAGED_MESSAGE);
  // the sentence lives in central-sync.mjs; the adapter must not retype it
  const adapter = read('../src/lib/licensing-adapter.js');
  assert.doesNotMatch(adapter, /This clinic subscription is managed centrally/, 'the refusal was retyped');
});

/* ------------------------------------------------------------ demo arithmetic */

test('a demo plan change starts now and runs one billing period', () => {
  const monthly = demoPlanChange({ current: { collection_ref: 'pay-1' }, plan: 'chain', now: NOW });
  assert.equal(monthly.plan, 'chain');
  assert.equal(monthly.status, 'active');
  assert.equal(monthly.interval, 'monthly');
  assert.equal(monthly.current_period_start, NOW.toISOString());
  // one calendar month on
  assert.equal(new Date(monthly.current_period_end).getUTCMonth(), new Date(NOW).getUTCMonth() + 1);
  assert.equal(monthly.collection_ref, 'pay-1', 'an unrelated field is carried, not dropped');

  const yearly = demoPlanChange({ plan: 'chain', interval: 'yearly', now: NOW });
  assert.equal(yearly.interval, 'yearly');
  assert.equal(new Date(yearly.current_period_end).getUTCFullYear(), new Date(NOW).getUTCFullYear() + 1);

  // the caller's billing details win over the arithmetic
  const withBilling = demoPlanChange({ plan: 'chain', billing: { collection_ref: 'x', amount_paise: 500 }, now: NOW });
  assert.equal(withBilling.collection_ref, 'x');
  assert.equal(withBilling.amount_paise, 500);
});

test('a demo renewal buys the plan\'s own term, never a hard-coded month', () => {
  // the regression this guards: a yearly clinic renewed for 30 days and looked broken
  const yearly = demoRenewal({
    current: { plan: 'growth', interval: 'yearly', current_period_end: inDays(30), collection_ref: '' },
    now: NOW,
  });
  const months = (new Date(yearly.current_period_end) - new Date(NOW)) / (30.44 * 86400000);
  assert.ok(months > 11 && months < 14, `renewed for ${months.toFixed(1)} months`);

  // an explicit term is honoured
  const three = demoRenewal({ current: { interval: 'monthly', current_period_end: inDays(10) }, months: 3, now: NOW });
  const span = (new Date(three.current_period_end) - new Date(NOW)) / (30.44 * 86400000);
  assert.ok(span > 2.5 && span < 3.5, `renewed for ${span.toFixed(1)} months`);

  // a nonsense term falls back to the plan's period rather than to zero
  const monthly = demoRenewal({ current: { interval: 'monthly' }, months: 'abc', now: NOW });
  assert.ok(new Date(monthly.current_period_end) > new Date(NOW));
});

test('a demo renewal keeps the reference it already had and records a new one', () => {
  const kept = demoRenewal({ current: { interval: 'monthly', collection_ref: 'old' }, now: NOW });
  assert.equal(kept.collection_ref, 'old');
  const replaced = demoRenewal({ current: { interval: 'monthly', collection_ref: 'old' }, reference: 'new', now: NOW });
  assert.equal(replaced.collection_ref, 'new');
  const fresh = demoRenewal({ current: { interval: 'monthly' }, now: NOW });
  assert.equal(fresh.collection_ref, '');
});

test('a demo trial is the default plan, fourteen days out, and keeps the row', () => {
  const trial = demoTrial({ current: { id: 'sub-1', collection_ref: 'old' }, now: NOW });
  assert.equal(trial.plan, DEFAULT_PLAN);
  assert.equal(trial.status, 'trial');
  assert.equal(trial.id, 'sub-1');
  assert.equal(trial.collection_ref, 'old');
  const days = (new Date(trial.trial_ends_at) - NOW) / 86400000;
  assert.equal(days, TRIAL_DAYS);
  // and the licence reads it back as a trial that can write
  assert.equal(canWrite(licenseState(trial, NOW)), true);
});

/* ------------------------------------------------------------------ ratchet */

test('the provider delegates the licence instead of composing it', () => {
  const store = read('../src/lib/store.jsx');
  for (const moved of ['licenseState(', 'canWrite(', 'billingPeriod(', 'extendPeriod(']) {
    assert.ok(!store.includes(moved), `store.jsx still calls ${moved}`);
  }
  // counting seats moved; turning a count into seat meters did not (that is the pure
  // function, and the provider is the right place to call it once)
  // the counting literals moved; the store still exposes `doctors`/`frontDesk` lists
  // for the UI, which is a different job
  assert.doesNotMatch(store, /branches: 1/, 'store.jsx still builds the seat counts inline');
  assert.doesNotMatch(store, /frontdesk: \(state\.staff/, 'store.jsx still counts front desk seats inline');
  assert.match(store, /seatUsage\(license, licenseUsage\)/);
  assert.match(store, /resolveLicense\(\{/);
  assert.match(store, /seatUsageCounts\(state\.staff\)/);
  assert.match(store, /writeGate\(\{ mode, license \}\)/);
  assert.match(store, /assertPlanIsLocal\(centralEnabled\)/, 'the Central rule must be applied, not restated');
  assert.equal((store.match(/assertPlanIsLocal\(centralEnabled\)/g) ?? []).length, 3, 'three plan actions, three guards');
  // the adapter is a leaf in the direction that matters: no React, no store, no client
  const adapter = read('../src/lib/licensing-adapter.js');
  const code = adapter.replace(/\/\*[\s\S]*?\*\//g, '');   // the doc comment may name store.jsx
  assert.doesNotMatch(code, /from 'react'/);
  assert.doesNotMatch(code, /store\.jsx/);
  assert.doesNotMatch(code, /supabase/i);
  const lines = store.replace(/\n$/, '').split('\n').length;
  assert.ok(lines < 990, `store.jsx is ${lines} lines — the split has been undone`);
});
