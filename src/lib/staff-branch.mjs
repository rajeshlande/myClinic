/**
 * Branch labels for the Doctors & staff screen.
 *
 * This is **presentation only**. The licence already says how many branches a
 * plan may have (`PLAN_LIMITS[plan].branches`): Solo and Growth are licensed for
 * one, Multi-clinic is unlimited. There is deliberately no branches table, no
 * `staff.branch_id` column and no branch-scoped query here — real multi-branch
 * data is item 9 of `docs/PLAN-v1.33.md` and still needs the three decisions in
 * §9 plus a schema release.
 *
 * Rules for this file:
 *   - a plan id is never written down here; `plans.mjs` owns that vocabulary;
 *   - an unknown plan falls back through `planId()` to the single-branch plan;
 *   - a staff row with no branch text still gets a readable label, never a blank
 *     badge or a made-up branch name.
 */

import { planId, planLimits } from './plans.mjs';

/** The one branch a Solo / Growth clinic has. */
export const MAIN_BRANCH = 'Main branch';

/** Shown instead of a made-up branch when Multi-clinic has no branch data yet. */
export const MULTI_BRANCH_FALLBACK = 'Multi-clinic · branch-capable';

/** The short summary used in the header and the seats card. */
export const BRANCHES_ENABLED = 'Branches enabled';

/** True when the plan's branch cap is unlimited (`null` in `PLAN_LIMITS`). */
export function isMultiBranchPlan(plan) {
  return planLimits(planId(plan)).branches === null;
}

/** One line for the plan itself: one branch, or branch support switched on. */
export function branchForPlan(plan) {
  return isMultiBranchPlan(plan) ? BRANCHES_ENABLED : MAIN_BRANCH;
}

/** Badge tone, so a single-branch plan does not read like a group plan. */
export function branchTone(plan) {
  return isMultiBranchPlan(plan) ? 'info' : 'neutral';
}

/**
 * The badge on one staff card.
 *
 * A single-branch plan always says "Main branch". A Multi-clinic plan uses an
 * optional branch name already present on the row (`branch_name`, `branch_label`
 * or `branch`, string or `{ name }`) and otherwise says it is branch-capable —
 * it does not invent "Branch 1" or pretend a branch was assigned.
 */
export function staffBranchLabel(plan, member) {
  if (!isMultiBranchPlan(plan)) return MAIN_BRANCH;
  const b = member?.branch;
  const raw = member?.branch_name
    ?? member?.branch_label
    ?? (b && typeof b === 'object' ? b.name : b);
  const name = typeof raw === 'string' ? raw.trim() : '';
  return name ? clipBranchName(name) : MULTI_BRANCH_FALLBACK;
}

/** A badge must not stretch a staff card because a branch name is long. */
function clipBranchName(name) {
  return name.length > 40 ? `${name.slice(0, 39)}…` : name;
}
