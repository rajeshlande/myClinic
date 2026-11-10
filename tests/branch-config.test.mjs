import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MAIN_BRANCH_CODE, MAIN_BRANCH_NAME, MAX_BRANCH_CODE, MAX_BRANCH_NAME,
  ROLE_DOCTOR, ROLE_FRONTDESK, ROLE_OWNER,
  assignmentLimit, branchCode, branchesForStaff, canAssignMultipleBranches,
  defaultBranch, ensureBranchState, normaliseBranchName, staffBranchBadge, staffBranchNames,
  uniqueBranchCode, validateAssignments, visibleBranchIds,
} from '../src/lib/branch-config.mjs';
import { MAIN_BRANCH, MULTI_BRANCH_FALLBACK } from '../src/lib/staff-branch.mjs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const branches = [
  { id: 'b1', name: MAIN_BRANCH_NAME },
  { id: 'b2', name: 'Bandra West' },
  { id: 'b3', name: 'Andheri East' },
];
const valid = branches.map((b) => b.id);
const assignment = (staffId, branchId) => ({ staff_id: staffId, branch_id: branchId });

test('the four confirmed decisions have one pure home', () => {
  assert.equal(canAssignMultipleBranches(ROLE_OWNER), true);
  assert.equal(canAssignMultipleBranches(ROLE_DOCTOR), false);
  assert.equal(canAssignMultipleBranches(ROLE_FRONTDESK), false);
  assert.equal(assignmentLimit(ROLE_OWNER), null, 'null means unlimited');
  assert.equal(assignmentLimit(ROLE_DOCTOR), 1);
  assert.equal(assignmentLimit(ROLE_FRONTDESK), 1);
  assert.equal(MAIN_BRANCH_NAME, MAIN_BRANCH);
});

test('names and codes are normalised without a second vocabulary', () => {
  assert.equal(normaliseBranchName('  Bandra   West  '), 'Bandra West');
  assert.equal(normaliseBranchName('x'.repeat(200)).length, MAX_BRANCH_NAME);
  assert.equal(branchCode('Bandra West'), 'BANDRA-WEST');
  assert.equal(branchCode('  '), 'BRANCH');
  assert.equal(branchCode('Clinic # 2 / OPD'), 'CLINIC-2-OPD');
  assert.ok(branchCode('x'.repeat(200)).length <= MAX_BRANCH_CODE);
  assert.deepEqual(defaultBranch(), { name: MAIN_BRANCH_NAME, code: MAIN_BRANCH_CODE, active: true });
});

test('branch codes stay unique inside one clinic', () => {
  assert.equal(uniqueBranchCode('Bandra West', []), 'BANDRA-WEST');
  assert.equal(uniqueBranchCode('Bandra West', ['BANDRA-WEST']), 'BANDRA-WEST-2');
  assert.equal(uniqueBranchCode('Bandra West', ['BANDRA-WEST', 'BANDRA-WEST-2']), 'BANDRA-WEST-3');
  assert.equal(uniqueBranchCode('Bandra West', ['BANDRA-WEST', 'bandra-west-2']), 'BANDRA-WEST-3',
    'existing codes are compared case-insensitively');
  assert.ok(uniqueBranchCode('x'.repeat(200), ['X'.repeat(MAX_BRANCH_CODE)]).length <= MAX_BRANCH_CODE);
});

test('owners accept several branches, doctors and front desk do not', () => {
  assert.deepEqual(validateAssignments({ role: ROLE_OWNER, branchIds: valid, validBranchIds: valid }),
    { ok: true, ids: valid, message: '' });
  assert.deepEqual(validateAssignments({ role: ROLE_DOCTOR, branchIds: ['b2'], validBranchIds: valid }),
    { ok: true, ids: ['b2'], message: '' });
  const refused = validateAssignments({ role: ROLE_FRONTDESK, branchIds: ['b2', 'b3'], validBranchIds: valid });
  assert.equal(refused.ok, false);
  assert.deepEqual(refused.ids, ['b2']);
  assert.match(refused.message, /owner/i);
});

test('missing, duplicate and unknown ids cannot become an assignment', () => {
  assert.equal(validateAssignments({ role: ROLE_DOCTOR, branchIds: [], validBranchIds: valid }).ok, false);
  assert.match(validateAssignments({ role: ROLE_OWNER, branchIds: [], validBranchIds: valid }).message, /at least one/i);
  assert.deepEqual(
    validateAssignments({ role: ROLE_OWNER, branchIds: ['b2', 'b2', 'nope'], validBranchIds: valid }).ids,
    ['b2'],
  );
  assert.deepEqual(validateAssignments({ role: ROLE_OWNER, branchIds: ['nope'], validBranchIds: valid }).ids, []);
});

test('staff badges read the assignment table, not an invented branch column', () => {
  const assignments = [assignment('s1', 'b1'), assignment('s2', 'b2'), assignment('s2', 'b3')];
  assert.deepEqual(branchesForStaff('s1', assignments, branches).map((b) => b.id), ['b1']);
  assert.deepEqual(staffBranchNames('s2', assignments, branches), ['Bandra West', 'Andheri East']);
  assert.equal(staffBranchBadge('s1', assignments, branches), MAIN_BRANCH_NAME);
  assert.equal(staffBranchBadge('s2', assignments, branches), 'Bandra West +1');
  assert.equal(staffBranchBadge('s3', assignments, branches), MULTI_BRANCH_FALLBACK);
  const long = [{ id: 'b9', name: 'x'.repeat(60) }];
  assert.equal(staffBranchBadge('s9', [assignment('s9', 'b9')], long), `${'x'.repeat(39)}…`);
});

test('an owner sees every branch; a non-owner sees only assigned ones', () => {
  const assignments = [assignment('s1', 'b2')];
  assert.deepEqual(visibleBranchIds(ROLE_OWNER, 'o1', assignments, branches), valid);
  assert.deepEqual(visibleBranchIds(ROLE_DOCTOR, 's1', assignments, branches), ['b2']);
  assert.deepEqual(visibleBranchIds(ROLE_FRONTDESK, 's2', assignments, branches), []);
});

test('retired assignments and inactive branches do not leak into a badge', () => {
  const rows = [{ ...assignment('s1', 'b2'), active: false }, assignment('s1', 'b3')];
  assert.deepEqual(branchesForStaff('s1', rows, branches).map((b) => b.id), ['b3']);
  assert.equal(staffBranchBadge('s1', rows, branches), 'Andheri East');
  const inactive = [...branches, { id: 'b4', name: 'Closed', active: false }];
  assert.deepEqual(visibleBranchIds(ROLE_OWNER, 'o1', [], inactive), valid);
});

test('a cached snapshot predating schema 20 gets one Main branch and one seat assignment', () => {
  const legacy = {
    clinic: { id: 'c1' }, profile: { id: 'u1', theme: 'system' },
    staff: [
      { id: 'o1', role: ROLE_OWNER, active: true },
      { id: 'd1', role: ROLE_DOCTOR, active: true },
      { id: 'd2', role: ROLE_DOCTOR, active: false },
    ],
    appointments: [{ id: 'a1' }],
  };
  const out = ensureBranchState(legacy, { makeId: () => 'b-main', now: () => '2026-11-10T00:00:00.000Z' });
  assert.equal(out.branches.length, 1);
  assert.equal(out.branches[0].name, MAIN_BRANCH_NAME);
  assert.equal(out.branches[0].code, MAIN_BRANCH_CODE);
  assert.equal(out.branches[0].clinic_id, 'c1');
  assert.deepEqual(out.staffBranches.map((a) => [a.staff_id, a.branch_id, a.active]), [
    ['o1', 'b-main', true], ['d1', 'b-main', true],
  ], 'inactive seats are not assigned');
  assert.equal(out.activeBranchId, 'b-main');
  assert.equal(out.profile.active_branch_id, 'b-main');
  assert.equal(out.profile.theme, 'system', 'unrelated profile fields are preserved');
  assert.deepEqual(out.appointments, legacy.appointments, 'clinical rows are not rewritten client-side');
});

test('a migrated snapshot keeps its real branches and never invents another', () => {
  const current = {
    clinic: { id: 'c1' }, profile: { id: 'u1', active_branch_id: 'b2' },
    staff: [{ id: 'o1', role: ROLE_OWNER, active: true }, { id: 'd1', role: ROLE_DOCTOR, active: true }],
    branches: [{ id: 'b1', name: MAIN_BRANCH_NAME }, { id: 'b2', name: 'Bandra West' }],
    staffBranches: [assignment('o1', 'b1'), assignment('o1', 'b2'), assignment('d1', 'b2')],
  };
  const out = ensureBranchState(current, { makeId: () => 'should-not-be-used' });
  assert.equal(out.branches.length, 2);
  assert.equal(out.staffBranches.length, 3);
  assert.equal(out.activeBranchId, 'b2', 'the profile wins over the first branch');
  assert.equal(out.profile.active_branch_id, 'b2');
});

test('the pure module owns no plan id and no SQL', () => {
  const body = read('../src/lib/branch-config.mjs');
  assert.doesNotMatch(body, /['"](solo|growth|chain)['"]/);
  assert.doesNotMatch(body, /\b(select|insert|update|delete)\s+/i);
});
