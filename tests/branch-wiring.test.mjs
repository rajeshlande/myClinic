import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Static wiring ratchets for v1.41.0–v1.42.0. The pure rules are tested in
 * branch-config.test.mjs and branch-scope.test.mjs; the real policies are
 * exercised in supabase/schema-tests.sql. These checks stop the store, screens,
 * switcher and schema from drifting apart when one of them is edited.
 */
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const store = read('../src/lib/store.jsx');
const settings = read('../src/pages/Settings.jsx');
const team = read('../src/pages/Team.jsx');
const branchesTab = read('../src/components/settings/BranchesTab.jsx');
const assignmentModal = read('../src/components/BranchAssignmentModal.jsx');
const switcher = read('../src/components/BranchSwitcher.jsx');
const layout = read('../src/components/AppLayout.jsx');
const dayClose = read('../src/pages/DayClose.jsx');
const billing = read('../src/pages/Billing.jsx');
const reports = read('../src/pages/Reports.jsx');
const adapter = read('../src/lib/licensing-adapter.js');
const sqlTests = read('../supabase/schema-tests.sql');
const schema = read('../supabase/schema.sql');

test('StoreProvider owns branch state, a scoped view and one real write branch', () => {
  for (const key of ['branches', 'staffBranches', 'activeBranchId', 'branchScope']) {
    assert.match(store, new RegExp(`\\b${key}:`), `emptyState must include ${key}`);
  }
  assert.match(store, /ensureBranchState\(next, \{/, 'demo boot must normalise old cached snapshots');
  assert.match(store, /BRANCH_TABLES = new Set\(BRANCH_SCOPE_TABLES\)/,
    'visits, invoices and day closes all carry branch_id');
  assert.ok(store.includes('...(branchId ? { branch_id: branchId } : {})'),
    'new rows must be tagged with the real active branch');
  assert.match(store, /rowsForBranchScope\(state\.appointments, branchScope/);
  assert.match(store, /dayCloseData/);
  assert.match(store, /dayCloseScope = state\.activeBranchId/);
  for (const method of ['createBranch', 'assignStaffBranches', 'setActiveBranch', 'setBranchScope']) {
    assert.match(store, new RegExp(`const ${method} = useCallback`), `${method} must be a store method`);
    assert.match(store, new RegExp(`\\b${method},`), `${method} must be exposed on the context value`);
  }
  assert.match(store, /set_branch_scope', \{ p_scope: ALL_BRANCH_SCOPE \}/);
  assert.match(store, /optional\(supabase\.from\('branches'\)/);
  assert.match(store, /optional\(supabase\.from\('staff_branches'\)/);
});

test('Settings, Team and the assignment dialog read the same assignment table', () => {
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

test('an owner gets one sidebar/topbar switcher; a non-owner gets a static label', () => {
  assert.match(layout, /import BranchSwitcher from '\.\/BranchSwitcher\.jsx'/);
  assert.match(layout, /<BranchSwitcher \/>/, 'the sidebar and drawer share one switcher');
  assert.match(layout, /<BranchSwitcher compact \/>/, 'the desktop topbar carries the same control');
  assert.match(switcher, /store\.canSwitchBranches/);
  assert.match(switcher, /store\.branchOptions/);
  assert.match(switcher, /store\.setBranchScope/);
  assert.match(switcher, /aria-label="Branch view"/);
  assert.match(switcher, /<select aria-label="Branch view"/);
  assert.match(switcher, /branch-static truncate/, 'a front desk has no selector');
  assert.match(switcher, /New entries go to/);
});

test('lists, reports, day close, invitations and seat meters answer the same scope', () => {
  assert.match(dayClose, /const dayScope = store\.dayCloseData/);
  assert.match(dayClose, /dayScope\.invoices/);
  assert.match(dayClose, /store\.dayCloseBranchLabel/);
  assert.match(billing, /store\.branchScopeLabel/);
  assert.match(reports, /store\.branchScopeLabel/);
  assert.match(team, /branchId: invite\.branchId \|\| store\.activeBranchId/);
  assert.match(team, /store\.assignStaffBranches\(seatRow\.id, \[invite\.branchId\]\)/);
  assert.match(store, /branch_id: chosenBranch/);
  assert.match(store, /unknownColumn\(result\.error\) === 'branch_id'/);
  assert.match(store, /seatUsageCounts\(state\.staff, state\.branches\)/);
  assert.match(adapter, /branches: Math\.max\(1, activeBranches\)/);
});

test('schemas 20 and 21 have real Postgres suites and cannot be downgraded by a re-run', () => {
  assert.match(sqlTests, /SUITE P · BRANCH CONFIGURATION/);
  assert.match(sqlTests, /SUITE Q · BRANCH VIEWS/);
  assert.match(sqlTests, /ALL BRANCH CONFIGURATION CHECKS COMPLETED/);
  assert.match(sqlTests, /ALL BRANCH VIEWS CHECKS COMPLETED/);
  assert.match(sqlTests, /front desk reads one branch, shares patients/);
  assert.match(schema, /do \$keep_create_clinic\$[\s\S]*app_schema_version\(\) < 19/);
  assert.match(schema, /do \$keep_policies\$[\s\S]*app_schema_version\(\) < 20/);
  assert.match(schema, /create or replace function public\.next_token_no[\s\S]{0,500}not a member of this clinic/);
  assert.match(schema, /create or replace function public\.next_invoice_number[\s\S]{0,500}not a member of this clinic/);
  assert.match(schema, /do \$migration21\$[\s\S]*app_schema_version\(\) >= 21/);
  assert.match(schema, /do \$keep_accept_invite\$[\s\S]*app_schema_version\(\) >= 21/,
    'the top-level legacy accept_invite() must not overwrite schema 21 on a re-run');
  assert.match(schema, /grant execute on function public\.set_branch_scope\(text\) to authenticated/);
});

test('schema 21 is additive: branch columns, scoped day close and branch invitations', () => {
  const block = schema.slice(schema.indexOf('§21 ·'));
  for (const column of [
    'alter table public.day_closes add column if not exists branch_id',
    'alter table public.invites add column if not exists branch_id',
    'alter table public.profiles add column if not exists branch_scope',
  ]) assert.ok(block.includes(column), `${column} is missing`);
  assert.match(block, /drop constraint if exists day_closes_clinic_id_closed_on_key/);
  assert.match(block, /unique \(clinic_id, branch_id, closed_on\)/);
  assert.match(block, /create trigger day_closes_tag_branch/);
  assert.match(block, /create trigger invites_branch_guard/);
  assert.match(block, /create policy day_closes_read[\s\S]{0,240}can_access_branch/);
  assert.match(block, /invite_staff\(uuid, text, text, text, uuid\)/);
  assert.match(block, /accept_invite[\s\S]*inv\.branch_id/);
  assert.match(block, /set schema_version = 21/);
  assert.doesNotMatch(block, /delete\s+from/i);
  assert.doesNotMatch(block, /drop\s+column/i);
});
