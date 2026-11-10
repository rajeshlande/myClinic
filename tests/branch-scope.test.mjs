import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ALL_BRANCH_SCOPE, BRANCH_SCOPE_TABLES, branchScopeLabel, branchScopeOptions,
  canSwitchBranches, resolveBranchScope, rowsForBranchScope, visibleBranches, writeBranchId,
} from '../src/lib/branch-scope.mjs';
import { ROLE_DOCTOR, ROLE_FRONTDESK, ROLE_OWNER } from '../src/lib/branch-config.mjs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const branches = [
  { id: 'main', name: 'Main branch', active: true },
  { id: 'west', name: 'Bandra West', active: true },
  { id: 'closed', name: 'Closed branch', active: false },
];
const all = ['main', 'west', 'closed'];

test('the scoped tables are the four branch-tagged data lists', () => {
  assert.deepEqual(BRANCH_SCOPE_TABLES, ['appointments', 'consultations', 'invoices', 'day_closes']);
  assert.deepEqual(visibleBranches(branches, ['main', 'closed']).map((b) => b.id), ['main']);
  assert.deepEqual(branchScopeOptions({ role: ROLE_OWNER, branches, allowedBranchIds: all }), [
    { id: ALL_BRANCH_SCOPE, label: 'All branches' },
    { id: 'main', label: 'Main branch' },
    { id: 'west', label: 'Bandra West' },
  ]);
  assert.deepEqual(branchScopeOptions({ role: ROLE_FRONTDESK, branches, allowedBranchIds: ['west'] }),
    [{ id: 'west', label: 'Bandra West' }]);
});

test('an owner defaults to all branches; a doctor or front desk never does', () => {
  assert.equal(resolveBranchScope({ role: ROLE_OWNER, allowedBranchIds: all }), ALL_BRANCH_SCOPE);
  assert.equal(resolveBranchScope({ role: ROLE_DOCTOR, scope: ALL_BRANCH_SCOPE, activeBranchId: 'west', allowedBranchIds: ['west'] }), 'west');
  assert.equal(resolveBranchScope({ role: ROLE_FRONTDESK, scope: 'main', activeBranchId: 'west', allowedBranchIds: ['west'] }), 'west');
  assert.equal(resolveBranchScope({ role: ROLE_OWNER, scope: 'west', allowedBranchIds: all }), 'west');
  assert.equal(resolveBranchScope({ role: ROLE_OWNER, allowedBranchIds: [] }), null);
  assert.equal(canSwitchBranches(ROLE_OWNER, ['main']), true);
  assert.equal(canSwitchBranches(ROLE_DOCTOR, ['main', 'west']), false);
  assert.equal(canSwitchBranches(ROLE_FRONTDESK, ['main']), false);
});

test('a branch view excludes other branches and keeps legacy null rows on Main', () => {
  const rows = [
    { id: 'a', branch_id: 'main' }, { id: 'b', branch_id: 'west' },
    { id: 'c', branch_id: null }, { id: 'd' },
  ];
  assert.equal(rowsForBranchScope(rows, ALL_BRANCH_SCOPE).length, 4);
  assert.deepEqual(rowsForBranchScope(rows, 'main', { legacyBranchId: 'main' }).map((r) => r.id), ['a', 'c', 'd']);
  assert.deepEqual(rowsForBranchScope(rows, 'west', { legacyBranchId: 'main' }).map((r) => r.id), ['b']);
  assert.equal(rowsForBranchScope(rows, null).length, 4, 'an unmigrated database still shows its rows');
});

test('labels and writes stay on one real branch', () => {
  assert.equal(branchScopeLabel(branches, ALL_BRANCH_SCOPE), 'All branches');
  assert.equal(branchScopeLabel(branches, 'west'), 'Bandra West');
  assert.equal(branchScopeLabel(branches, null), 'Main branch');
  assert.equal(writeBranchId({ scope: ALL_BRANCH_SCOPE, activeBranchId: 'west', allowedBranchIds: all }), 'west');
  assert.equal(writeBranchId({ scope: 'main', activeBranchId: 'west', allowedBranchIds: all }), 'main');
  assert.equal(writeBranchId({ scope: ALL_BRANCH_SCOPE, allowedBranchIds: ['main'] }), 'main');
  assert.equal(writeBranchId({ scope: ALL_BRANCH_SCOPE, allowedBranchIds: [] }), null);
});

test('the pure view module owns no SQL, React or plan id', () => {
  const body = read('../src/lib/branch-scope.mjs');
  assert.doesNotMatch(body, /['"](solo|growth|chain)['"]/);
  assert.doesNotMatch(body, /\b(select|insert|update|delete)\s+from\b/i);
  assert.doesNotMatch(body, /\buseStore|useState|supabase\b/i);
});
