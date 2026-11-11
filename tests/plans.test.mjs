import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CENTRAL_TIER_TO_PLAN, DEFAULT_PLAN, FALLBACK_PLAN, PLANS, PLAN_BLURB, PLAN_IDS, PLAN_LABEL,
  PLAN_LIMITS, PLAN_PRICE_PAISE, PLAN_SEATS, PLAN_SIDEBAR_LABEL, SALES_PLAN, TIER_SEAT_LIMITS,
  isPlanId, planForTier, planId, planLabel, planLimits, planNeedsSales, planPrice, planRow, planSidebarLabel,
} from '../src/lib/plans.mjs';
import { PLAN_LIMITS as REEXPORTED_LIMITS, PLAN_ORDER, planPrice as reexportedPrice, seatUsage, canAddSeat } from '../src/lib/license.mjs';
import { PLANS as LOGIC_PLANS } from '../src/lib/logic.mjs';
import { CENTRAL_TIER_TO_PLAN as SYNC_TIERS } from '../src/lib/central-sync.mjs';

/*
 * Step 1 of docs/ARCHITECTURE.md §3.
 *
 * The three plan ids used to be written down in eight files, each re-deriving its
 * own label and its own seat caps with a nested ternary. Adding a plan was a
 * nine-file edit, and a missed file showed itself as a price on one screen that
 * disagreed with the cap on the next.
 *
 * These tests do two jobs: they pin the vocabulary's meaning, and they fail if a
 * quoted plan id ever appears outside `plans.mjs` again.
 */

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, 'src');

/** Every source file under src/, recursively. */
function sourceFiles(dir = src) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(mjs|js|jsx)$/.test(name) ? [full] : [];
  });
}

test('the vocabulary is defined once, in the order plans are sold', () => {
  assert.deepEqual([...PLAN_IDS], ['solo', 'growth', 'chain']);
  assert.equal(DEFAULT_PLAN, 'growth', 'the middle plan is the safe assumption');
  assert.equal(FALLBACK_PLAN, 'solo', 'but a licence failure must never read as an upgrade');
  assert.equal(SALES_PLAN, 'chain');
  assert.ok(isPlanId('growth'));
  assert.equal(isPlanId('platinum'), false);
});

test('no other source file contains a quoted plan id', () => {
  const offenders = sourceFiles()
    .filter((file) => !file.endsWith('plans.mjs'))
    .flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      const hits = [...text.matchAll(/['"](solo|growth|chain)['"]/g)].map((m) => m[1]);
      return hits.length ? [`${file.replace(`${root}/`, '')} → ${[...new Set(hits)].join(', ')}`] : [];
    });
  assert.deepEqual(offenders, [],
    'a plan id outside plans.mjs is a second source of truth — import it instead');
});

test('the catalogue cannot drift from the maps beside it', () => {
  assert.deepEqual(PLANS.map((p) => p.id), [...PLAN_IDS]);
  for (const row of PLANS) {
    assert.equal(row.price_paise, PLAN_PRICE_PAISE[row.id], `${row.id}: price`);
    assert.equal(row.name, PLAN_LABEL[row.id], `${row.id}: label`);
    assert.ok(PLAN_BLURB[row.id], `${row.id}: blurb`);
    assert.ok(PLAN_SEATS[row.id], `${row.id}: seat line`);
    assert.ok(PLAN_SIDEBAR_LABEL[row.id], `${row.id}: sidebar label`);
    assert.ok(PLAN_LIMITS[row.id], `${row.id}: limits`);
    assert.ok(row.features.length >= 5, `${row.id}: the pricing card needs its features`);
  }
  assert.equal(PLANS.filter((p) => p.popular).length, 1, 'exactly one plan is the popular one');
});

test('unknown input is normalised once, not by a ternary at every call site', () => {
  assert.equal(planId('platinum'), DEFAULT_PLAN);
  assert.equal(planId(undefined), DEFAULT_PLAN);
  assert.equal(planId('solo'), 'solo');
  assert.equal(planLabel('platinum'), 'Growth');
  assert.deepEqual(planLimits('platinum'), PLAN_LIMITS.growth);
  assert.equal(planRow('nonsense').id, DEFAULT_PLAN);
  assert.equal(planSidebarLabel('solo'), 'Solo plan');
});

test('prices: monthly, yearly at 20% off, and null for a plan that is not on sale', () => {
  assert.equal(planPrice('solo'), 99900);
  assert.equal(planPrice('growth'), 249900);
  assert.equal(planPrice('chain'), 599900);
  assert.equal(planPrice('solo', { interval: 'yearly' }), Math.round(99900 * 12 * 0.8));
  assert.equal(planPrice('platinum'), null, 'the pricing screen says "ask us" rather than quoting a number');
  assert.equal(planPrice('platinum', { interval: 'yearly' }), null);
});

test('the sales-led plan is named, not compared to a literal', () => {
  assert.equal(planNeedsSales('chain'), true);
  assert.equal(planNeedsSales('growth'), false);
  assert.equal(planNeedsSales('solo'), false);
  assert.equal(planNeedsSales(undefined), false);
});

test('Central tier names translate in one place, unknown tiers fall back small', () => {
  assert.equal(planForTier('solo'), 'solo');
  assert.equal(planForTier('Standard'), 'growth', 'Central may send any casing');
  assert.equal(planForTier('enterprise'), 'chain');
  assert.equal(planForTier('platinum'), FALLBACK_PLAN);
  assert.equal(planForTier(null), FALLBACK_PLAN);
  assert.deepEqual(Object.keys(CENTRAL_TIER_TO_PLAN).sort(), ['chain', 'enterprise', 'growth', 'solo', 'standard']);
});

test('CENTRAL_TIER_TO_PLAN and the displayed plan caps are the shipped contract view', () => {
  assert.ok(Object.isFrozen(CENTRAL_TIER_TO_PLAN));
  assert.deepEqual({ ...CENTRAL_TIER_TO_PLAN }, {
    solo: 'solo',
    standard: 'growth',
    growth: 'growth',
    chain: 'chain',
    enterprise: 'chain',
  });
  assert.deepEqual({ ...TIER_SEAT_LIMITS.solo }, { doctors: 1, frontdesk: 1, branches: 1 });
  assert.deepEqual({ ...TIER_SEAT_LIMITS.growth }, { doctors: 5, frontdesk: 3, branches: 1 });
  assert.deepEqual({ ...TIER_SEAT_LIMITS.chain }, { doctors: null, frontdesk: null, branches: null });
  assert.equal(PLAN_LIMITS.solo, TIER_SEAT_LIMITS.solo);
  assert.equal(PLAN_LIMITS.growth, TIER_SEAT_LIMITS.growth);
  assert.equal(PLAN_LIMITS.chain, TIER_SEAT_LIMITS.chain);
});

test('the old import paths still resolve to the same objects', () => {
  assert.equal(REEXPORTED_LIMITS, PLAN_LIMITS, 'license.mjs re-exports the one object');
  assert.deepEqual([...PLAN_ORDER], [...PLAN_IDS]);
  assert.equal(reexportedPrice, planPrice);
  assert.equal(LOGIC_PLANS, PLANS, 'logic.mjs re-exports the catalogue');
  assert.equal(SYNC_TIERS, CENTRAL_TIER_TO_PLAN, 'central-sync re-exports the tier map');
});

test('the licence rules behave exactly as before the move', () => {
  // An unknown plan lands on Growth's caps, as it always did.
  const rows = seatUsage({ plan: 'platinum' }, { doctors: 2, frontdesk: 1, branches: 1 });
  assert.equal(rows.find((r) => r.id === 'doctors').limit, PLAN_LIMITS.growth.doctors);
  assert.equal(rows.find((r) => r.id === 'doctors').left, PLAN_LIMITS.growth.doctors - 2);

  // Chain is unlimited, and the message uses the plan's own name.
  const chain = seatUsage({ plan: 'chain' }, { doctors: 40 });
  assert.equal(chain.find((r) => r.id === 'doctors').limit, null);
  assert.equal(chain.find((r) => r.id === 'doctors').unlimited, true);

  const full = canAddSeat({ plan: 'solo', status: 'active', endsAt: null, daysLeft: 5 }, { doctors: 1 });
  assert.equal(full.allowed, false);
  assert.match(full.message, /^Solo includes 1 doctor seat and they are all in use/,
    'the count agrees with the noun — 1 doctor seat, 5 doctor seats');
  assert.match(canAddSeat({ plan: 'chain', status: 'active' }, { doctors: 40 }).message, /^$/);
});
