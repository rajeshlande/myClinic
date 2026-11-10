/**
 * Branch configuration rules — item 9 / v1.41.0.
 *
 * Decisions confirmed on 2026-11-10 and recorded in docs/PLAN-v1.33.md §9:
 *   - a branch is a child row of one clinic, never a second `clinics` row;
 *   - patients are shared, visits / consultations / invoices are tagged by branch;
 *   - only owners may hold several branches, doctors and front desk hold one;
 *   - an owner sees all branches of the clinic, a front-desk seat only its own.
 *
 * This module is the pure half: no plan id is written down here (plans.mjs owns
 * that vocabulary), no SQL, no React, no store. Screens and the outbox use these
 * rules instead of re-deriving them inline.
 */

import { MAIN_BRANCH, MULTI_BRANCH_FALLBACK } from './staff-branch.mjs';

export const ROLE_OWNER = 'owner';
export const ROLE_DOCTOR = 'doctor';
export const ROLE_FRONTDESK = 'frontdesk';

export const MAIN_BRANCH_NAME = MAIN_BRANCH;
export const MAIN_BRANCH_CODE = 'MAIN';
export const MAX_BRANCH_NAME = 80;
export const MAX_BRANCH_CODE = 16;

/** Owners may hold several branches; everyone else holds exactly one. */
export function canAssignMultipleBranches(role) {
  return role === ROLE_OWNER;
}

/** `null` means unlimited; a number caps the assignments. */
export function assignmentLimit(role) {
  return canAssignMultipleBranches(role) ? null : 1;
}

/** Trim, collapse internal whitespace and clamp to the column's length. */
export function normaliseBranchName(name) {
  return String(name ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_BRANCH_NAME);
}

/** An upper-case, URL-safe code derived from the branch name. */
export function branchCode(name) {
  const base = normaliseBranchName(name)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (base || 'BRANCH').slice(0, MAX_BRANCH_CODE).replace(/-+$/g, '') || 'BRANCH';
}

/** Keep codes unique inside one clinic without ever exceeding the column. */
export function uniqueBranchCode(name, existingCodes = []) {
  const taken = new Set(existingCodes.map((c) => String(c ?? '').toUpperCase()));
  const base = branchCode(name);
  if (!taken.has(base)) return base;
  let n = 2;
  while (n < 1000) {
    const suffix = `-${n}`;
    const code = `${base.slice(0, MAX_BRANCH_CODE - suffix.length).replace(/-+$/g, '')}${suffix}`;
    if (!taken.has(code)) return code;
    n += 1;
  }
  return base;
}

/** The one branch every existing single-branch clinic is migrated onto. */
export function defaultBranch(extra = {}) {
  return {
    name: MAIN_BRANCH_NAME,
    code: MAIN_BRANCH_CODE,
    active: true,
    ...extra,
  };
}

/**
 * Normalise and check an assignment edit before it reaches the RPC.
 * Unknown / duplicate / empty ids are removed; a non-owner cannot exceed one;
 * nobody may end up with zero branches.
 */
export function validateAssignments({ role, branchIds = [], validBranchIds = [] } = {}) {
  const valid = new Set(validBranchIds.filter(Boolean));
  const ids = [...new Set((branchIds ?? []).filter((id) => valid.has(id)))];
  const limit = assignmentLimit(role);
  if (ids.length === 0) {
    return { ok: false, ids: [], message: 'Choose at least one branch.' };
  }
  if (limit !== null && ids.length > limit) {
    return {
      ok: false,
      ids: ids.slice(0, limit),
      message: canAssignMultipleBranches(role)
        ? 'Too many branches.'
        : 'Only an owner can be assigned more than one branch.',
    };
  }
  return { ok: true, ids, message: '' };
}

/** Branch rows assigned to one staff member, in the order branches arrive. */
export function branchesForStaff(staffId, assignments = [], branches = []) {
  const ids = new Set(
    (assignments ?? [])
      // Retired rows stay in the table for audit; only active ones assign a seat.
      .filter((a) => a?.staff_id === staffId && a?.active !== false)
      .map((a) => a.branch_id)
      .filter(Boolean),
  );
  return (branches ?? []).filter((b) => b?.active !== false && ids.has(b.id));
}

/** Human names for one staff row, longest name clipped for a badge. */
export function staffBranchNames(staffId, assignments = [], branches = []) {
  return branchesForStaff(staffId, assignments, branches)
    .map((b) => String(b.name ?? '').trim())
    .filter(Boolean)
    .map((n) => (n.length > 40 ? `${n.slice(0, 39)}…` : n));
}

/** One readable badge for a staff card, including multi-branch owners. */
export function staffBranchBadge(staffId, assignments = [], branches = []) {
  const names = staffBranchNames(staffId, assignments, branches);
  if (!names.length) return MULTI_BRANCH_FALLBACK;
  if (names.length === 1) return names[0];
  return `${names[0]} +${names.length - 1}`;
}

/** Branch ids a role may read. Owners see every active branch of the clinic. */
export function visibleBranchIds(role, staffId, assignments = [], branches = []) {
  if (canAssignMultipleBranches(role)) {
    return (branches ?? []).filter((b) => b?.active !== false).map((b) => b.id);
  }
  return branchesForStaff(staffId, assignments, branches).map((b) => b.id);
}

/**
 * Give a cached workspace one implicit Main branch when it predates schema 20.
 * Server-side backfill is authoritative; this keeps an offline/demo snapshot
 * from showing a seat with no branch at all while the migration is applied.
 * Pure so the upgrade rule is testable without React or localStorage.
 */
export function ensureBranchState(state = {}, { makeId = () => 'branch', now = () => new Date().toISOString() } = {}) {
  const stamp = now();
  const clinicId = state.clinic?.id ?? null;
  const branchRows = (Array.isArray(state.branches) ? state.branches : [])
    .filter((b) => b?.id)
    .map((b) => ({ ...b, clinic_id: b.clinic_id ?? clinicId }));
  const branches = branchRows.length ? branchRows : [{
    ...defaultBranch(),
    id: makeId(), clinic_id: clinicId, created_at: stamp, updated_at: stamp,
  }];
  const first = branches.find((b) => b.active !== false) ?? branches[0];
  const rows = Array.isArray(state.staffBranches) ? state.staffBranches.map((a) => ({ ...a })) : [];
  const assigned = new Set(rows.filter((a) => a.active !== false).map((a) => a.staff_id));
  for (const member of (state.staff ?? [])) {
    if (!member?.id || member.active === false || assigned.has(member.id)) continue;
    rows.push({
      staff_id: member.id, branch_id: first.id, active: true,
      created_at: stamp, updated_at: stamp,
    });
    assigned.add(member.id);
  }
  const requested = state.activeBranchId ?? state.profile?.active_branch_id;
  const activeBranchId = requested && branches.some((b) => b.id === requested && b.active !== false)
    ? requested : first.id;
  return {
    ...state,
    branches,
    staffBranches: rows,
    activeBranchId,
    profile: state.profile ? { ...state.profile, active_branch_id: activeBranchId } : state.profile,
  };
}
