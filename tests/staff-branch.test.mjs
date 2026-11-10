import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BRANCHES_ENABLED, MAIN_BRANCH, MULTI_BRANCH_FALLBACK,
  branchForPlan, branchTone, isMultiBranchPlan, staffBranchLabel,
} from '../src/lib/staff-branch.mjs';
import { DEFAULT_PLAN, PLAN_IDS, SALES_PLAN } from '../src/lib/plans.mjs';

/**
 * Item 14 of docs/PLAN-v1.33.md: a display-only Branch badge on Doctors & staff.
 * It must never become a second plan vocabulary or invent branch data that the
 * schema does not have — real branches are item 9 and need a schema release.
 */

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const SINGLE_BRANCH_PLANS = PLAN_IDS.filter((id) => id !== SALES_PLAN);

test('only the unlimited-branch plan is multi-branch', () => {
  for (const id of SINGLE_BRANCH_PLANS) assert.equal(isMultiBranchPlan(id), false, `${id} is single-branch`);
  assert.equal(isMultiBranchPlan(SALES_PLAN), true);
  // Unknown input falls back through planId() to the default single-branch plan.
  assert.equal(isMultiBranchPlan('platinum'), false);
  assert.equal(isMultiBranchPlan(undefined), false);
  assert.equal(isMultiBranchPlan(null), false);
});

test('the plan summary names one branch or branch support', () => {
  assert.equal(branchForPlan(DEFAULT_PLAN), MAIN_BRANCH);
  assert.equal(branchForPlan(SALES_PLAN), BRANCHES_ENABLED);
  assert.equal(branchTone(DEFAULT_PLAN), 'neutral');
  assert.equal(branchTone(SALES_PLAN), 'info');
});

test('a single-branch plan always says Main branch, even if a row has branch text', () => {
  for (const id of SINGLE_BRANCH_PLANS) {
    assert.equal(staffBranchLabel(id, { branch_name: 'Andheri' }), MAIN_BRANCH);
    assert.equal(staffBranchLabel(id, {}), MAIN_BRANCH);
  }
  assert.equal(staffBranchLabel(undefined, null), MAIN_BRANCH);
});

test('Multi-clinic uses a branch name already on the row', () => {
  assert.equal(staffBranchLabel(SALES_PLAN, { branch_name: 'Andheri West' }), 'Andheri West');
  assert.equal(staffBranchLabel(SALES_PLAN, { branch_label: '  Bandra  ' }), 'Bandra');
  assert.equal(staffBranchLabel(SALES_PLAN, { branch: 'Thane' }), 'Thane');
  assert.equal(staffBranchLabel(SALES_PLAN, { branch: { name: 'Pune' } }), 'Pune');
});

test('Multi-clinic never invents a branch when there is no branch data', () => {
  assert.equal(staffBranchLabel(SALES_PLAN, {}), MULTI_BRANCH_FALLBACK);
  assert.equal(staffBranchLabel(SALES_PLAN, null), MULTI_BRANCH_FALLBACK);
  assert.equal(staffBranchLabel(SALES_PLAN, { branch: '   ' }), MULTI_BRANCH_FALLBACK);
  assert.equal(staffBranchLabel(SALES_PLAN, { branch: 42 }), MULTI_BRANCH_FALLBACK);
  assert.equal(staffBranchLabel(SALES_PLAN, { branch: { name: 7 } }), MULTI_BRANCH_FALLBACK);
});

test('a long branch name is clipped so the badge cannot stretch a card', () => {
  const got = staffBranchLabel(SALES_PLAN, { branch_name: 'X'.repeat(60) });
  assert.ok(got.length <= 40, `${got.length} characters`);
  assert.ok(got.endsWith('…'));
});

test('the module owns no plan id of its own', () => {
  assert.doesNotMatch(read('../src/lib/staff-branch.mjs'), /['"](solo|growth|chain)['"]/,
    'plan ids belong to plans.mjs only');
});

test('Doctors & staff renders the pure rules and a human plan label', () => {
  const team = read('../src/pages/Team.jsx');
  assert.match(team, /staffBranchLabel\(/, 'each staff card needs the branch badge');
  assert.match(team, /branchForPlan\(/, 'the header / seats card needs the plan summary');
  assert.match(team, /branchTone\(/, 'the badge tone comes from the same module');
  assert.match(team, /planLabel\(/, 'the raw plan id must not be printed');
  assert.doesNotMatch(team, /planId\(store\.clinic\?\.plan\) plan/);
  assert.doesNotMatch(team, /['"](solo|growth|chain)['"]/, 'no plan id in JSX');
});
