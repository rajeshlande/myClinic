import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Static wiring ratchets for v1.41.0. The pure rules are tested in
 * branch-config.test.mjs and the real policies in supabase/schema-tests.sql;
 * these checks stop the store, the two screens and the schema from drifting
 * apart the next time someone edits one of them.
 */
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const store = read('../src/lib/store.jsx');
const settings = read('../src/pages/Settings.jsx');
const team = read('../src/pages/Team.jsx');
const branchesTab = read('../src/components/settings/BranchesTab.jsx');
const assignmentModal = read('../src/components/BranchAssignmentModal.jsx');
const sqlTests = read('../supabase/schema-tests.sql');
const schema = read('../supabase/schema.sql');

test('StoreProvider owns the schema-20 state and heals cached demo snapshots', () => {
  for (const key of ['branches', 'staffBranches', 'activeBranchId']) {
    assert.match(store, new RegExp(`\\b${key}:`), `emptyState must include ${key}`);
  }
  assert.match(store, /ensureBranchState\(next, \{/, 'demo boot must normalise old cached snapshots');
  assert.match(store, /BRANCH_TABLES = new Set\(\['appointments', 'consultations', 'invoices'\]\)/);
  assert.match(store, /\.\.\.\(branchId \? \{ branch_id: branchId \} : \{\}\)/,
    'new visits/invoices must be tagged with the active branch');
  for (const method of ['createBranch', 'assignStaffBranches', 'setActiveBranch']) {
    assert.match(store, new RegExp(`const ${method} = useCallback`), `${method} must be a store method`);
    assert.match(store, new RegExp(`\\b${method},`), `${method} must be exposed on the context value`);
  }
  assert.match(store, /optional\(supabase\.from\('branches'\)/);
  assert.match(store, /optional\(supabase\.from\('staff_branches'\)/);
});

test('Settings has one owner-only Branches tab and Team opens the same dialog', () => {
  assert.match(settings, /import BranchesTab from '\.\.\/components\/settings\/BranchesTab\.jsx'/);
  assert.match(settings, /value: 'branches', label: 'Branches'/);
  assert.match(settings, /branches: <BranchesTab \/>/);

  assert.match(team, /import BranchAssignmentModal from '\.\.\/components\/BranchAssignmentModal\.jsx'/);
  assert.match(team, /<BranchAssignmentModal/);
  assert.match(team, /onSave=\{store\.assignStaffBranches\}/);
  assert.match(team, /setBranchMember\(member\)/);
  assert.match(team, /branchesForStaff\(member\.id, assignments, branchRows\)/);
  assert.match(team, /staffBranchBadge\(member\.id, assignments, branchRows\)/);
  assert.match(team, /staffBranchLabel\(plan, member\)/, 'the pre-migration display label remains a fallback');
});

test('Branches and the assignment modal use the pure rules, not inline policies', () => {
  for (const file of [branchesTab, assignmentModal]) {
    assert.doesNotMatch(file, /['"](solo|growth|chain)['"]/, 'plan ids live only in plans.mjs');
    assert.doesNotMatch(file, /\b(select|insert|update|delete)\s+from\b/i, 'no SQL in a React screen');
  }
  assert.match(branchesTab, /from '\.\.\/\.\.\/lib\/branch-config\.mjs'/);
  assert.match(branchesTab, /visibleBranchIds\(/);
  assert.match(branchesTab, /staffBranchBadge\(/);
  assert.match(branchesTab, /assignmentLimit\(/);
  assert.match(branchesTab, /disabled=\{!owner \|\| visible\.length === 0\}/,
    'front desk gets no branch switcher');
  assert.match(assignmentModal, /validateAssignments\(/);
  assert.match(assignmentModal, /canAssignMultipleBranches\(/);
  assert.match(assignmentModal, /branchesForStaff\(/);
  assert.match(assignmentModal, /type="checkbox"/, 'owners get multi-select');
  assert.match(assignmentModal, /<Select[\s\S]*id="branch-assignment-select"/, 'doctors/front desk get one select');
});

test('schema 20 has a real Postgres suite and cannot be downgraded by a re-run', () => {
  assert.match(sqlTests, /SUITE M · BRANCH CONFIGURATION/);
  assert.match(sqlTests, /ALL BRANCH CONFIGURATION CHECKS COMPLETED/);
  assert.match(sqlTests, /front desk reads one branch, shares patients/);
  assert.match(schema, /do \$keep_create_clinic\$[\s\S]*app_schema_version\(\) < 19/);
  assert.match(schema, /do \$keep_policies\$[\s\S]*app_schema_version\(\) < 20/);
  assert.match(schema, /create or replace function public\.next_token_no[\s\S]{0,500}not a member of this clinic/);
  assert.match(schema, /create or replace function public\.next_invoice_number[\s\S]{0,500}not a member of this clinic/);
});
