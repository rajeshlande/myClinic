import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PLAN_SOURCES, centralPlanLabel, currentInterval, currentPlan, isCentralManaged, planSource,
} from '../src/lib/current-plan.mjs';
import {
  DEFAULT_PLAN, FALLBACK_PLAN, PLAN_IDS, PLAN_SEATS, SALES_PLAN,
  planForTier, planLabel, planLimits,
} from '../src/lib/plans.mjs';
import {
  BRANCHES_ENABLED, MAIN_BRANCH, MULTI_BRANCH_FALLBACK,
  branchForPlan, staffBranchLabel,
} from '../src/lib/staff-branch.mjs';

/**
 * Item 15 of docs/PLAN-v1.33.md. One clinic once read "Growth / Main branch" on
 * Doctors & staff and "Multi-clinic / Central tier: chain" on Subscription. These
 * tests pin the precedence and the four screens that must use it.
 */

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const staleClinic = { plan: DEFAULT_PLAN };
const staleLicense = { plan: DEFAULT_PLAN };
const centralVerdict = { plan: SALES_PLAN, tier: 'chain', allowed: true, status: 'active' };

test('the source order is Central → licence → clinic → default', () => {
  assert.deepEqual([...PLAN_SOURCES], ['central', 'license', 'clinic', 'default']);
});

test('Central is only authoritative when it is enabled', () => {
  assert.equal(isCentralManaged({ centralSync: { enabled: true } }), true);
  assert.equal(isCentralManaged({ centralSync: { enabled: false } }), false);
  assert.equal(isCentralManaged({}), false);
  assert.equal(isCentralManaged(null), false);
});

test('planSource names the winning source, never a second rule', () => {
  assert.equal(planSource({
    clinic: staleClinic, license: staleLicense,
    centralSync: { enabled: true, verdict: centralVerdict },
  }), 'central');
  assert.equal(planSource({
    clinic: staleClinic, license: staleLicense,
    centralSync: { enabled: true, verdict: null },
  }), 'license');
  assert.equal(planSource({
    clinic: staleClinic, license: staleLicense,
    centralSync: { enabled: false, verdict: centralVerdict },
  }), 'license', 'a stale verdict must not outlive Central being switched off');
  assert.equal(planSource({ clinic: staleClinic }), 'clinic');
  assert.equal(planSource({}), 'default');
});

test('a stale Growth clinic row cannot override a Central chain verdict', () => {
  const store = {
    clinic: staleClinic,
    license: staleLicense,
    centralSync: { enabled: true, verdict: centralVerdict },
  };
  assert.equal(planSource(store), 'central');
  assert.equal(currentPlan(store), SALES_PLAN);
});

test('the licence beats the legacy clinic row when Central has not answered', () => {
  const store = {
    clinic: staleClinic,
    license: { plan: SALES_PLAN },
    centralSync: { enabled: true, verdict: null },
  };
  assert.equal(planSource(store), 'license');
  assert.equal(currentPlan(store), SALES_PLAN);
});

test('a disabled Central ignores even a stored verdict', () => {
  const store = {
    clinic: staleClinic,
    license: { plan: SALES_PLAN },
    centralSync: { enabled: false, verdict: centralVerdict },
  };
  assert.equal(currentPlan(store), SALES_PLAN);
});

test('the legacy clinic row is only a last-resort display fallback', () => {
  assert.equal(currentPlan({ clinic: { plan: SALES_PLAN } }), SALES_PLAN);
  assert.equal(planSource({ clinic: { plan: SALES_PLAN } }), 'clinic');
});

test('missing or unknown values land on the safe default', () => {
  assert.equal(currentPlan({}), DEFAULT_PLAN);
  assert.equal(currentPlan(null), DEFAULT_PLAN);
  assert.equal(currentPlan({ license: { plan: 'platinum' } }), DEFAULT_PLAN);
  assert.equal(currentPlan({ clinic: { plan: 'platinum' } }), DEFAULT_PLAN);
  assert.equal(currentPlan({ centralSync: { enabled: true, verdict: { plan: 'platinum' } } }), DEFAULT_PLAN);
  assert.equal(FALLBACK_PLAN, PLAN_IDS[0], 'the fallback really is the smallest plan');
});

test('the helper owns no plan id of its own', () => {
  assert.doesNotMatch(read('../src/lib/current-plan.mjs'), /['"](solo|growth|chain)['"]/,
    'plan ids belong to plans.mjs only');
});

test('every plan-bearing screen uses the same helper', () => {
  const files = {
    Team: read('../src/pages/Team.jsx'),
    PlanDataTab: read('../src/components/settings/PlanDataTab.jsx'),
    Subscription: read('../src/pages/Subscription.jsx'),
    AppLayout: read('../src/components/AppLayout.jsx'),
  };
  for (const [name, body] of Object.entries(files)) {
    assert.match(body, /currentPlan\(store\)/, `${name} still picks its own plan source`);
    assert.doesNotMatch(body, /store\.clinic\?\.plan/, `${name} still reads the legacy clinic row`);
  }
  // Subscription no longer re-derives the plan with its own ternary.
  assert.doesNotMatch(files.Subscription, /centralVerdict\?\.plan \?\?/);
  // The sidebar used to read license.plan directly.
  assert.doesNotMatch(files.AppLayout, /planSidebarLabel\(store\.license\?\.plan\)/);
});

test('Plan & data switches the real subscription, not the legacy clinic column', () => {
  const plan = read('../src/components/settings/PlanDataTab.jsx');
  assert.match(plan, /store\.changePlan\(/, 'the modal must call the subscription RPC');
  assert.doesNotMatch(plan, /store\.update\('clinic'/, 'clinics.plan must not be patched directly');
  assert.match(plan, /isCentralManaged\(store\)/, 'Central-owned plans are read-only here');
  assert.match(plan, /Plan is managed by Central Auto-Sync\./);
});

test('a tier-only Central verdict is translated by the plan vocabulary', () => {
  const tier = 'enterprise';
  const store = {
    clinic: staleClinic,
    license: staleLicense,
    centralSync: { enabled: true, verdict: { tier } },
  };
  assert.equal(planSource(store), 'central');
  assert.equal(currentPlan(store), planForTier(tier));
  assert.equal(currentPlan(store), SALES_PLAN);
});

test('the human label never prints a raw Central tier', () => {
  const store = {
    clinic: staleClinic,
    license: staleLicense,
    centralSync: { enabled: true, verdict: centralVerdict },
  };
  assert.equal(centralPlanLabel(store), planLabel(SALES_PLAN));
  assert.notEqual(centralPlanLabel(store), centralVerdict.tier);
  assert.equal(centralPlanLabel({ clinic: staleClinic }), planLabel(DEFAULT_PLAN));
});

test('Subscription shows one human plan and no raw tier id', () => {
  const sub = read('../src/pages/Subscription.jsx');
  assert.match(sub, /centralPlanLabel\(store\)/);
  assert.match(sub, /Central plan: /);
  assert.doesNotMatch(sub, /Central tier:/);
  assert.doesNotMatch(sub, /centralVerdict\?\.tier/, 'a raw tier is not a plan');
  assert.doesNotMatch(sub, /`Central · \$\{plan\}`/, 'the export must not print a raw plan id');
});

test('the billing interval comes from the licence, not a hard-coded switch', () => {
  assert.equal(currentInterval({}), 'monthly');
  assert.equal(currentInterval({ license: { interval: 'monthly' } }), 'monthly');
  assert.equal(currentInterval({ license: { interval: 'yearly' } }), 'yearly');
  assert.equal(currentInterval({ license: { interval: 'weekly' } }), 'monthly');
  const sub = read('../src/pages/Subscription.jsx');
  const plan = read('../src/components/settings/PlanDataTab.jsx');
  assert.doesNotMatch(sub, /license\?\.interval === 'yearly'/);
  assert.match(plan, /interval: currentInterval\(store\)/);
});

test('Team branch entitlement and seats follow the effective plan', () => {
  const centralStore = {
    clinic: staleClinic,
    license: staleLicense,
    centralSync: { enabled: true, verdict: centralVerdict },
  };
  const effective = currentPlan(centralStore);
  assert.equal(planLabel(effective), planLabel(SALES_PLAN));
  assert.equal(centralPlanLabel(centralStore), planLabel(effective));
  assert.equal(branchForPlan(effective), BRANCHES_ENABLED);
  assert.equal(staffBranchLabel(effective, {}), MULTI_BRANCH_FALLBACK);
  assert.equal(PLAN_SEATS[effective], PLAN_SEATS[SALES_PLAN]);
  assert.equal(planLimits(effective).doctors, null);
  assert.equal(planLimits(effective).frontdesk, null);
  // A local clinic with no Central answer still gets the single-branch badge.
  const local = { clinic: staleClinic, license: staleLicense, centralSync: { enabled: false } };
  assert.equal(branchForPlan(currentPlan(local)), MAIN_BRANCH);
});

test('Plan & data hides the local price and switch when Central owns the plan', () => {
  const plan = read('../src/components/settings/PlanDataTab.jsx');
  assert.match(plan, /canChangePlan = !centralManaged/);
  assert.match(plan, /open=\{planOpen && canChangePlan\}/);
  assert.match(plan, /Issued by Central/);
  assert.match(plan, /Plan is managed by Central Auto-Sync\./);
});
