/**
 * Branch view rules — item 9 / v1.42.0.
 *
 * The database decides what a person may read (`can_access_branch()`), and this
 * module decides which of those rows a screen is looking at. It is pure: no SQL,
 * no React, no plan id and no knowledge of the database client.
 *
 * `activeBranchId` is always a real branch id, because it is what new rows are
 * tagged with. `branchScope` is a view: `'all'` for an owner who wants every
 * assigned branch together, otherwise one real branch id. A front desk has no
 * switcher, so its scope resolves to its only assignment.
 */

import { canAssignMultipleBranches } from './branch-config.mjs';

export const ALL_BRANCH_SCOPE = 'all';
export const BRANCH_SCOPE_TABLES = ['appointments', 'consultations', 'invoices', 'day_closes'];

/** Active branch rows the signed-in member is allowed to see, in branch order. */
export function visibleBranches(branches = [], allowedBranchIds = []) {
  const allowed = new Set((allowedBranchIds ?? []).filter(Boolean));
  return (branches ?? []).filter((b) => b?.id && b.active !== false && allowed.has(b.id));
}

/** A non-owner can never turn a stored `'all'` scope into a cross-branch view. */
export function resolveBranchScope({
  role, scope = null, activeBranchId = null, allowedBranchIds = [],
} = {}) {
  const allowed = [...new Set((allowedBranchIds ?? []).filter(Boolean))];
  if (canAssignMultipleBranches(role) && allowed.length && (!scope || scope === ALL_BRANCH_SCOPE)) {
    return ALL_BRANCH_SCOPE;
  }
  if (scope && scope !== ALL_BRANCH_SCOPE && allowed.includes(scope)) return scope;
  if (activeBranchId && allowed.includes(activeBranchId)) return activeBranchId;
  return allowed[0] ?? null;
}

/** Options for the owner's switcher. Everyone else gets no selector at all. */
export function branchScopeOptions({ role, branches = [], allowedBranchIds = [] } = {}) {
  const rows = visibleBranches(branches, allowedBranchIds);
  if (!canAssignMultipleBranches(role)) {
    return rows.map((b) => ({ id: b.id, label: String(b.name ?? '').trim() || 'Assigned branch' }));
  }
  return [
    { id: ALL_BRANCH_SCOPE, label: 'All branches' },
    ...rows.map((b) => ({ id: b.id, label: String(b.name ?? '').trim() || 'Branch' })),
  ];
}

/** Only an owner with at least one visible branch may change the view. */
export function canSwitchBranches(role, allowedBranchIds = []) {
  return canAssignMultipleBranches(role)
    && [...new Set((allowedBranchIds ?? []).filter(Boolean))].length > 0;
}

/**
 * Rows for one view. `scope === 'all'` keeps every row the database returned.
 * A row without `branch_id` is a legacy snapshot: show it on the first active
 * branch (the server's Main branch backfill), not once in every branch view.
 */
export function rowsForBranchScope(rows = [], scope = null, { legacyBranchId = null } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (!scope || scope === ALL_BRANCH_SCOPE) return list;
  return list.filter((row) => row?.branch_id === scope
    || (!row?.branch_id && legacyBranchId && scope === legacyBranchId));
}

/** `All branches`, a branch name, or a neutral label before any branch exists. */
export function branchScopeLabel(branches = [], scope = null) {
  if (scope === ALL_BRANCH_SCOPE) return 'All branches';
  const found = (branches ?? []).find((b) => b?.id === scope);
  return String(found?.name ?? '').trim() || 'Main branch';
}

/** The real branch that receives a new row while an owner views all branches. */
export function writeBranchId({ scope = null, activeBranchId = null, allowedBranchIds = [] } = {}) {
  if (scope && scope !== ALL_BRANCH_SCOPE) return scope;
  if (activeBranchId && (allowedBranchIds ?? []).includes(activeBranchId)) return activeBranchId;
  return (allowedBranchIds ?? []).find(Boolean) ?? null;
}
