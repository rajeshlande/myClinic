/**
 * One plan, one answer.
 *
 * `clinics.plan` is a legacy column. The database reads
 * `clinic_subscriptions.plan` for seat caps and prices (`license_state()`), and
 * Central Auto-Sync can override that with a tier from the central project.
 * Screens used to pick their own source: Team and Plan & data read
 * `store.clinic.plan`, the sidebar read `store.license.plan`, and Subscription
 * read the Central verdict. A clinic with a Central `chain` tier and a stale
 * `growth` clinic row therefore said "Growth plan / Main branch" on one screen
 * and "Multi-clinic" on another.
 *
 * Rules for this file:
 *   - no plan id is written down here; `plans.mjs` owns the vocabulary;
 *   - precedence matches what Subscription already showed: Central verdict →
 *     licence → legacy clinic row → the safe default;
 *   - an unrecognised value is normalised by `planId()`, never by a ternary at a
 *     call site;
 *   - a Central tier is translated by `planForTier()`, never printed as a raw
 *     tier id. The verdict normally carries the already-translated `plan`; the
 *     tier is a fallback for a verdict that only has the tier.
 */

import {
  DEFAULT_PLAN, isPlanId, planForTier, planId, planLabel,
} from './plans.mjs';

/** The ordered sources, newest authority first. */
export const PLAN_SOURCES = Object.freeze(['central', 'license', 'clinic', 'default']);

/** True when Central Auto-Sync owns the plan and a local switch would be a lie. */
export function isCentralManaged(store) {
  return Boolean(store?.centralSync?.enabled);
}

/** The billing interval the licence actually carries, defaulting to monthly. */
export function currentInterval(store) {
  return store?.license?.interval === 'yearly' ? 'yearly' : 'monthly';
}

/**
 * The plan a Central verdict stands for. `plan` is normally already the output
 * of `planForTier(tier)`; prefer it, but still understand a tier-only verdict.
 * Returns `null` when Central has not answered with either fact.
 */
function centralVerdictPlan(verdict) {
  if (!verdict) return null;
  if (isPlanId(verdict.plan)) return verdict.plan;
  if (verdict.tier) return planForTier(verdict.tier);
  return verdict.plan ? planId(verdict.plan) : null;
}

/** Which source won — useful in diagnostics and tests, never a second rule. */
export function planSource(store) {
  if (isCentralManaged(store) && centralVerdictPlan(store?.centralSync?.verdict)) return 'central';
  if (store?.license?.plan) return 'license';
  if (store?.clinic?.plan) return 'clinic';
  return 'default';
}

/** The normalised plan id every plan-bearing screen must display. */
export function currentPlan(store) {
  const source = planSource(store);
  if (source === 'central') return centralVerdictPlan(store.centralSync.verdict);
  if (source === 'license') return planId(store.license.plan);
  if (source === 'clinic') return planId(store.clinic.plan);
  return planId(DEFAULT_PLAN);
}

/** The effective plan as a human name, including the Central tier translation. */
export function centralPlanLabel(store) {
  return planLabel(currentPlan(store));
}
