/**
 * The licence the app acts on, and the three things it lets a clinic do.
 *
 * `license.mjs` decides what a subscription *means* — `licenseState`, `canWrite`,
 * `seatUsage`, `billingPeriod`, `extendPeriod` are pure and tested. What stayed in
 * `store.jsx` was the composition around it: that Central's answer outranks the
 * clinic's own row, that a demo workspace is exempt from the "Central owns the
 * plan" rule, and the exact shape of the subscription a demo click writes. Those
 * are rules, not rendering, so they live here — injected, with the clock as an
 * argument, and no React or Supabase in sight.
 */

import { TRIAL_DAYS, billingPeriod, canWrite, extendPeriod, licenseState } from './license.mjs';
import { DEFAULT_PLAN, FALLBACK_PLAN } from './plans.mjs';
import { CENTRAL_MANAGED_MESSAGE } from './central-sync.mjs';

// The refusal every plan action uses, from the one place that words it.
export { CENTRAL_MANAGED_MESSAGE };

/** What Central's silence means: a paid plan nobody has confirmed is not a free one. */
export const CENTRAL_UNAVAILABLE_SUBSCRIPTION = Object.freeze({
  status: 'read_only', plan: FALLBACK_PLAN, interval: 'yearly',
});

/** The one sentence a blocked write shows. Kept here so both paths say the same thing. */
export const WRITE_BLOCKED_MESSAGE = 'The subscription is read-only, so this change was not saved. '
  + 'Everything stays readable and exportable — renew the plan to resume writing.';

/**
 * Which subscription the app believes.
 *
 * With Central configured the answer must come from Central: the clinic's own row
 * is writable by the clinic, so a plan read from it would be a plan the customer
 * could award themselves. Central answering nothing is read-only, not "no plan".
 */
export function resolveLicense({ subscription = null, central = { enabled: false, subscription: null } } = {}) {
  if (!central.enabled) return licenseState(subscription);
  return licenseState(central.subscription ?? { ...CENTRAL_UNAVAILABLE_SUBSCRIPTION });
}

/**
 * How many seats are in use. Before schema 20 there was one implicit branch;
 * now `branches` counts the active child rows, with that same one as the floor
 * for a cached snapshot that predates the table.
 */
export function seatUsageCounts(staff = [], branches = []) {
  const rows = staff ?? [];
  const activeBranches = (Array.isArray(branches) ? branches : [])
    .filter((b) => b?.active !== false).length;
  return {
    doctors: rows.filter((s) => s.active !== false && s.role !== 'frontdesk').length,
    frontdesk: rows.filter((s) => s.active !== false && s.role === 'frontdesk').length,
    branches: Math.max(1, activeBranches),
  };
}

/**
 * Whether the app writes, told as two facts because there have always been two.
 *
 * `writable` is what a screen shows; `readOnly` is what the write path enforces.
 * They differ in exactly one case, and it is deliberate: a **demo** workspace shows
 * itself as writable — there is no server to refuse it — while its own expired
 * sandbox trial still stops the write. Collapsing them would either grey out every
 * demo button or let a lapsed demo keep writing.
 */
export function writeGate({ mode, license }) {
  const permitted = canWrite(license);
  return { writable: mode === 'demo' ? true : permitted, readOnly: !permitted };
}

/** The write path's refusal. Throws, because a write that was not saved must not look saved. */
export function assertCanWrite({ readOnly }) {
  if (!readOnly) return;
  throw new Error(WRITE_BLOCKED_MESSAGE);
}

/** Central owns the plan while it is configured; a local click would be a lie it contradicts. */
export function assertPlanIsLocal(centralEnabled) {
  if (centralEnabled) throw new Error(CENTRAL_MANAGED_MESSAGE);
}

/**
 * The subscription a demo "switch plan" writes.
 *
 * Demo mode has no `change_plan()` RPC to call, so the same arithmetic runs in the
 * browser: the new plan, active from now, ending one billing period later.
 */
export function demoPlanChange({ current = {}, plan, interval = 'monthly', billing = {}, now = new Date() }) {
  const period = billingPeriod({ interval });
  return {
    ...current,
    plan,
    status: 'active',
    interval: period.interval,
    current_period_start: now.toISOString(),
    current_period_end: extendPeriod(now, period.months, now),
    ...billing,
  };
}

/**
 * The subscription a demo payment writes.
 *
 * A payment buys the subscription's **own** period — twelve months on a yearly plan
 * — unless the caller states a term. The demo used to hard-code 30 days, so a
 * yearly clinic renewed for a month and looked broken.
 */
export function demoRenewal({ current = {}, months = null, reference = '', now = new Date() }) {
  const wanted = Number.isFinite(Number(months)) && Number(months) > 0 ? Number(months) : billingPeriod(current).months;
  return {
    ...current,
    status: 'active',
    current_period_start: current.current_period_start ?? now.toISOString(),
    current_period_end: extendPeriod(current.current_period_end, wanted, now),
    collection_ref: reference || current.collection_ref || '',
  };
}

/** The subscription a demo "start trial" writes: the default plan, on trial, 14 days out. */
export function demoTrial({ current = {}, plan = undefined, now = new Date() }) {
  return {
    ...current,
    plan: plan ?? DEFAULT_PLAN,
    status: 'trial',
    trial_ends_at: new Date(now.getTime() + TRIAL_DAYS * 86400000).toISOString(),
  };
}
