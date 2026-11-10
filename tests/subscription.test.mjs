import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  GRACE_DAYS, PLAN_LIMITS, TRIAL_DAYS, billingPeriod, canAddSeat, canWrite,
  daysUntil, extendPeriod, formatExpiry, licenseHeadline, licenseState, planPrice,
  seatUsage, upgradeCost,
} from '../src/lib/license.mjs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const PAGE = read('../src/pages/Subscription.jsx');
const STORE = read('../src/lib/store.jsx');
// Since v1.32.0 the demo-mode subscription arithmetic lives in the licensing
// adapter; the provider is checked for delegating to it, not for containing it.
const ADAPTER = read('../src/lib/licensing-adapter.js');
const LAYOUT = read('../src/components/AppLayout.jsx');

const NOW = new Date('2026-11-04T09:00:00Z');
const activeRow = (over = {}) => ({
  status: 'active', plan: 'growth', interval: 'monthly',
  current_period_end: '2026-12-01T00:00:00Z', collection_ref: '', ...over,
});

/* ------------------------------------------------------------------ the shape */

test('the licence view keeps the interval and the payment reference', () => {
  // Dropping these two is what made a yearly clinic display, quote and renew as
  // monthly, and lose the UPI reference it had just recorded.
  const yearly = licenseState(activeRow({ interval: 'yearly', collection_ref: 'UPI 4213' }), NOW);
  assert.equal(yearly.interval, 'yearly');
  assert.equal(yearly.collectionRef, 'UPI 4213');

  const monthly = licenseState(activeRow(), NOW);
  assert.equal(monthly.interval, 'monthly');
  assert.equal(monthly.collectionRef, '');

  // anything unknown is monthly, never a crash
  assert.equal(licenseState(activeRow({ interval: 'weekly' }), NOW).interval, 'monthly');
  assert.equal(licenseState(activeRow({ interval: null }), NOW).interval, 'monthly');
  // a missing row still answers the whole shape
  const none = licenseState(null, NOW);
  assert.deepEqual(
    { status: none.status, interval: none.interval, collectionRef: none.collectionRef },
    { status: 'expired', interval: 'monthly', collectionRef: '' },
  );
});

test('a payment buys the subscription interval, not a price toggle', () => {
  assert.deepEqual(billingPeriod({ interval: 'yearly' }), { interval: 'yearly', months: 12, days: 365, label: '12 months', short: 'yr' });
  assert.equal(billingPeriod({ interval: 'monthly' }).months, 1);
  assert.equal(billingPeriod(null).months, 1);
  assert.equal(billingPeriod({ interval: 'yearly' }).months, 12, 'yearly renews for a year');
});

test('extending a period never moves it backwards', () => {
  // before the end: the new end is that end plus the term
  assert.equal(
    new Date(extendPeriod('2026-12-01T00:00:00Z', 1, NOW)).toISOString(),
    '2027-01-01T00:00:00.000Z',
  );
  // already lapsed: the term starts now, not in the past
  assert.equal(
    new Date(extendPeriod('2026-09-01T00:00:00Z', 1, NOW)).toISOString(),
    '2026-12-04T09:00:00.000Z',
  );
  // no end at all
  assert.equal(
    new Date(extendPeriod(null, 1, NOW)).toISOString(),
    '2026-12-04T09:00:00.000Z',
  );
  // twelve months is twelve calendar months, matching make_interval(months => 12)
  assert.equal(
    new Date(extendPeriod('2026-12-01T00:00:00Z', 12, NOW)).toISOString(),
    '2027-12-01T00:00:00.000Z',
  );
  // a nonsense term still buys one month rather than nothing
  assert.equal(new Date(extendPeriod(null, 0, NOW)).toISOString(), '2026-12-04T09:00:00.000Z');
});

/* ------------------------------------------------------------------- pricing */

test('yearly is two months free and prices never drift', () => {
  assert.equal(planPrice('solo', { interval: 'monthly' }), 99900);
  assert.equal(planPrice('growth', { interval: 'monthly' }), 249900);
  assert.equal(planPrice('chain', { interval: 'monthly' }), 599900);
  for (const plan of ['solo', 'growth', 'chain']) {
    assert.equal(planPrice(plan, { interval: 'yearly' }), Math.round(planPrice(plan, { interval: 'monthly' }) * 12 * 0.8));
  }
  assert.equal(planPrice('nope'), null);
});

test('upgradeCost states the direction and the delta', () => {
  const up = upgradeCost('solo', 'growth', { interval: 'monthly' });
  assert.equal(up.direction, 'upgrade');
  assert.equal(up.delta, 249900 - 99900);

  const down = upgradeCost('growth', 'solo', { interval: 'monthly' });
  assert.equal(down.direction, 'downgrade');
  assert.equal(down.delta, 99900 - 249900);

  assert.equal(upgradeCost('growth', 'growth').direction, 'same');
  assert.equal(upgradeCost('growth', 'nope'), null);
});

/* -------------------------------------------------------------------- state */

test('a stale active row still lapses, and grace is honoured', () => {
  const grace = licenseState(activeRow({ current_period_end: '2026-11-01T00:00:00Z' }), NOW);
  assert.equal(grace.status, 'grace');
  assert.match(licenseHeadline(grace), /grace left/);

  const dead = licenseState(activeRow({ current_period_end: '2026-10-01T00:00:00Z' }), NOW);
  assert.equal(dead.status, 'read_only');
  assert.equal(canWrite(dead), false);

  assert.equal(canWrite(grace), true, `grace (${GRACE_DAYS} days) still writes`);
  assert.equal(canWrite(licenseState(activeRow({ status: 'trial', trial_ends_at: '2026-11-10T00:00:00Z' }), NOW)), true);
});

test('a trial inside its window reads as a trial, and its end drives the clock', () => {
  const trial = licenseState({ status: 'trial', plan: 'growth', interval: 'monthly', trial_ends_at: '2026-11-18T00:00:00Z' }, NOW);
  assert.equal(trial.status, 'trial');
  assert.equal(trial.endsAt, '2026-11-18T00:00:00Z');
  assert.equal(daysUntil(trial.endsAt, NOW), TRIAL_DAYS);
  assert.match(licenseHeadline(trial), /Trial · 14 days left/);
  assert.match(licenseHeadline(licenseState({ status: 'trial', trial_ends_at: '2026-11-04T08:00:00Z' }, NOW)), /ends today|Read-only/);
});

test('seats follow the plan and refuse a seat the plan cannot hold', () => {
  const growth = { status: 'active', plan: 'growth', interval: 'monthly', daysLeft: 30, endsAt: null };
  const usage = { doctors: PLAN_LIMITS.growth.doctors, frontdesk: 1, branches: 1 };
  const rows = seatUsage(growth, usage);
  assert.equal(rows.find((r) => r.id === 'doctors').full, true);
  assert.equal(canAddSeat(growth, usage, 'doctors').allowed, false);
  assert.match(canAddSeat(growth, usage, 'doctors').message, /Upgrade the plan/);
  assert.equal(canAddSeat(growth, usage, 'frontdesk').allowed, true);

  const chain = { ...growth, plan: 'chain' };
  assert.equal(seatUsage(chain, { doctors: 999 }).find((r) => r.id === 'doctors').unlimited, true);
  assert.equal(canAddSeat(chain, { doctors: 999 }, 'doctors').allowed, true);

  const frozen = { ...growth, status: 'read_only' };
  assert.equal(canAddSeat(frozen, { doctors: 1 }, 'doctors').allowed, false);
  assert.match(canAddSeat(frozen, {}, 'doctors').message, /read-only/);
});

test('formatExpiry is a date, not a timestamp', () => {
  assert.match(formatExpiry('2026-12-01T00:00:00Z'), /2026/);
  assert.equal(formatExpiry(null), '—');
  assert.equal(formatExpiry('not a date'), '—');
});

/* ------------------------------------------------------- the screens that use it */

test('the subscription screen renews and quotes from the saved interval', () => {
  // the term of a payment
  assert.match(PAGE, /const term = billingPeriod\(\{ interval: period \}\)/);
  assert.match(PAGE, /await store\.renewSubscription\(\{ reference: reference\.trim\(\), months: term\.months \}\)/);
  // what the status card and the export say
  // v1.35.6: the interval rule moved into current-plan.mjs alongside the plan
  // rule, so the screen has no second source of truth.
  assert.match(PAGE, /const period = currentInterval\(store\)/);
  assert.doesNotMatch(PAGE, /license\?\.interval === 'yearly'/);
  assert.match(PAGE, /money\(planPrice\(plan, \{ interval: period \}\)\)/);
  assert.match(PAGE, /reference: license\?\.collectionRef \?\? ''/);
  // the price toggle lives in the dialog and is named as such
  assert.match(PAGE, /const \[shopPeriod, setShopPeriod\] = useState\(period\)/);
  assert.doesNotMatch(PAGE, /license\?\.collection_ref/, 'the licence view exposes collectionRef');
  assert.doesNotMatch(PAGE, /schema v3 licensing/, 'the header reads the real schema number');
  assert.doesNotMatch(PAGE, /setInterval\(prev => prev\)/, 'a no-op left over from an earlier build');
});

test('the demo workspace honours the term it is given', () => {
  // the old demo branch added a hard-coded 30 days whatever the plan
  for (const body of [STORE, ADAPTER]) {
    assert.doesNotMatch(body, /Math\.max\(from, Date\.now\(\)\) \+ 30 \* 86400000/);
  }
  assert.match(ADAPTER, /extendPeriod\(current\.current_period_end, wanted, now\)/);
  assert.match(ADAPTER, /billingPeriod\(current\)\.months/);
  // and the provider uses it rather than keeping a second copy of the rule
  assert.match(STORE, /demoRenewal\(\{ current: stateRef\.current\.subscription, months, reference \}\)/);
  assert.doesNotMatch(STORE, /extendPeriod\(/, 'store.jsx grew a period calculation back');
});

test('only a seat that can open the subscription is offered it', () => {
  // The panel is not merely disabled for a doctor or front desk — it is absent.
  assert.match(LAYOUT, /\{can\(role, 'clinic:settings'\) \? \(\s*<div className="plan-card">/);
  assert.doesNotMatch(LAYOUT, /clinic owner manages the plan\./);
});
