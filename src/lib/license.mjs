/**
 * Subscription / licence logic (pure — no React, no network).
 *
 * The database is the authority (supabase/schema.sql: clinic_subscriptions,
 * license_seats(), license_state(), start_trial(), change_plan(), set_license_status()).
 * This module mirrors those rules so the UI can show the real state, warn before a
 * limit bites, and refuse to offer an action the server would reject.
 *
 * Vocabulary
 *   trial     14 days of the Growth feature set, once per clinic
 *   active    paid and inside the current period
 *   grace     7 days past the period end — reads and writes still work, with a banner
 *   read_only after grace: the clinic can read and export, but not write
 *   expired   subscription cancelled — read-only plus an export escape hatch
 *
 * Money is integer paise everywhere, matching the rest of the app.
 */

import { PLAN_LIMITS, PLAN_ORDER, DEFAULT_PLAN, planId, planLabel as labelForPlan, planLimits, planPrice as priceForPlan } from './plans.mjs';

// Re-exported so the licence API is unchanged: the plan vocabulary itself lives in
// `plans.mjs` (one source), and every existing import of these names still works.
export { PLAN_LIMITS, PLAN_ORDER };

export const TRIAL_DAYS = 14;
export const GRACE_DAYS = 7;

/**
 * @typedef {'trial'|'active'|'grace'|'read_only'|'expired'} LicenseStatus
 * @typedef {{
 *   status: LicenseStatus, plan: string, interval: 'monthly'|'yearly',
 *   daysLeft: number|null, endsAt: string|null, collectionRef: string,
 * }} License
 */

const DAY_MS = 86_400_000;

const toDate = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Whole days from `now` until `value` (negative once past). */
export function daysUntil(value, now = new Date()) {
  const d = toDate(value);
  if (!d) return null;
  const start = new Date(now);
  return Math.ceil((d.getTime() - start.getTime()) / DAY_MS);
}

/**
 * Normalise whatever the row says into one licence view the UI can trust.
 * `status` from the database wins; a date in the past still downgrades a stale
 * 'active' row so an offline client never shows a paid plan forever.
 *
 * @param {object|string|null} sub  subscription row (or just the status string)
 * @param {Date} now
 * @returns {License}
 */
/** A trial's start date, counted back from its end. `null` for every other row. */
function trialStart(row = {}) {
  if (row.status !== 'trial' || !row.trial_ends_at) return null;
  const end = Date.parse(String(row.trial_ends_at));
  if (!Number.isFinite(end)) return null;
  return new Date(end - TRIAL_DAYS * 86400000).toISOString();
}

export function licenseState(sub, now = new Date()) {
  // `interval` and `collection_ref` travel with the licence on purpose: dropping
  // them here is what made a yearly clinic read as monthly, quote a monthly price,
  // renew for one month instead of twelve, and lose the payment reference it had
  // just recorded.
  const base = (row = {}) => ({
    plan: planId(row.plan),
    interval: row.interval === 'yearly' ? 'yearly' : 'monthly',
    collectionRef: String(row.collection_ref ?? ''),
    // When this period began. Central writes it from the contract's own start
    // date; a clinic that licenses itself writes it when it records a plan. Null
    // is shown as "—" rather than guessed at, because a wrong start date on a
    // billing card is worse than a blank one.
    //
    // The one date that is not a guess: a trial's start is exactly
    // `trial_ends_at − TRIAL_DAYS`, because that is how `start_trial()` writes
    // it. Nothing else is derived.
    startsAt: row.current_period_start ?? trialStart(row),
  });

  if (!sub) return { status: 'expired', ...base(), daysLeft: 0, endsAt: null };
  const row = typeof sub === 'string' ? { status: sub } : sub;
  const raw = String(row.status ?? 'expired');
  const plan = base(row).plan;
  const shared = base(row);
  const endsAt = row.status === 'trial' ? row.trial_ends_at : row.current_period_end;
  const daysLeft = daysUntil(endsAt, now);

  if (raw === 'active') {
    if (daysLeft !== null && daysLeft < 0) {
      const overdue = Math.abs(daysLeft);
      return { status: overdue <= GRACE_DAYS ? 'grace' : 'read_only', ...shared, plan, daysLeft, endsAt };
    }
    return { status: 'active', ...shared, plan, daysLeft, endsAt };
  }
  if (raw === 'trial') {
    if (daysLeft !== null && daysLeft < 0) return { status: 'read_only', ...shared, plan, daysLeft, endsAt };
    return { status: 'trial', ...shared, plan, daysLeft, endsAt };
  }
  if (raw === 'grace') return { status: 'grace', ...shared, plan, daysLeft, endsAt };
  if (raw === 'read_only') return { status: 'read_only', ...shared, plan, daysLeft, endsAt };
  return { status: 'expired', ...shared, plan, daysLeft: daysLeft ?? 0, endsAt };
}

/**
 * The period a payment buys: the subscription's own interval, never a toggle in
 * a dialog. A clinic that pays yearly renews for twelve months even if the owner
 * had been browsing monthly prices.
 *
 * @param {{interval?: string}|null} sub  the subscription row (or a licence view)
 */
export function billingPeriod(sub) {
  const interval = sub?.interval === 'yearly' ? 'yearly' : 'monthly';
  return {
    interval,
    months: interval === 'yearly' ? 12 : 1,
    days: interval === 'yearly' ? 365 : 30,
    label: interval === 'yearly' ? '12 months' : '1 month',
    short: interval === 'yearly' ? 'yr' : 'mo',
  };
}

/**
 * Extend a period end by whole months, never moving backwards. Calendar months,
 * matching `make_interval(months => n)` in `renew_subscription()`.
 *
 * @param {string|Date|null} currentEnd
 * @param {number} months
 * @param {Date} now
 */
export function extendPeriod(currentEnd, months, now = new Date()) {
  const from = currentEnd ? new Date(currentEnd) : null;
  const base = from && !Number.isNaN(from.getTime()) ? Math.max(from.getTime(), now.getTime()) : now.getTime();
  const end = new Date(base);
  end.setMonth(end.getMonth() + Math.max(1, Math.round(Number(months) || 1)));
  return end.toISOString();
}

/** Can the clinic change clinical or financial records? */
export function canWrite(license) {
  return Boolean(license) && ['trial', 'active', 'grace'].includes(license.status);
}

/** Can the clinic still read and export its data? */
export function canRead() {
  return true; // deliberately always true — patient records are never held hostage
}

/** One-line status for a badge. */
export function licenseHeadline(license) {
  if (!license) return 'No subscription';
  const d = license.daysLeft;
  switch (license.status) {
    case 'trial':
      return d === null ? 'Trial' : d <= 0 ? 'Trial ends today' : `Trial · ${d} day${d === 1 ? '' : 's'} left`;
    case 'active':
      return d === null ? 'Active' : `Active · renews in ${d} day${d === 1 ? '' : 's'}`;
    case 'grace':
      return `Payment overdue · ${d === null ? '' : `${Math.abs(d)} day${Math.abs(d) === 1 ? '' : 's'} grace left`}`.trim();
    case 'read_only':
      return 'Read-only · renew to keep writing';
    case 'expired':
    default:
      return 'Expired · read-only';
  }
}

/** Badge tone used across the app. */
export function licenseTone(license) {
  if (!license) return 'danger';
  if (license.status === 'active') return 'success';
  if (license.status === 'trial') return (license.daysLeft ?? 99) <= 3 ? 'warn' : 'brand';
  if (license.status === 'grace') return 'warn';
  return 'danger';
}

/**
 * Seat usage against the plan. Owners are doctors, so they count in `doctors`.
 * @param {{plan?: string}} license
 * @param {{doctors?: number, frontdesk?: number, branches?: number}} usage
 */
export function seatUsage(license, usage = {}) {
  const limits = planLimits(license?.plan ?? DEFAULT_PLAN);
  const rows = [
    { id: 'doctors', label: 'Doctors', used: Number(usage.doctors ?? 0), limit: limits.doctors },
    { id: 'frontdesk', label: 'Front desk', used: Number(usage.frontdesk ?? 0), limit: limits.frontdesk },
    { id: 'branches', label: 'Branches', used: Number(usage.branches ?? 1), limit: limits.branches },
  ];
  return rows.map((r) => ({
    ...r,
    unlimited: r.limit === null,
    left: r.limit === null ? Infinity : Math.max(0, r.limit - r.used),
    full: r.limit !== null && r.used >= r.limit,
    over: r.limit !== null && r.used > r.limit,
    percent: r.limit === null ? 0 : Math.min(100, Math.round((r.used / Math.max(1, r.limit)) * 100)),
  }));
}

/**
 * Would adding one more seat of `kind` break the plan?
 * @returns {{allowed: boolean, message: string}}
 */
export function canAddSeat(license, usage, kind = 'doctors') {
  if (!canWrite(license)) {
    return { allowed: false, message: 'The subscription is read-only. Renew to add staff.' };
  }
  const row = seatUsage(license, usage).find((r) => r.id === kind);
  if (!row) return { allowed: true, message: '' };
  if (row.unlimited) return { allowed: true, message: '' };
  if (row.full) {
    const planName = labelForPlan(license?.plan);
    return {
      allowed: false,
      // "1 doctors seat" was the old reading: the count agrees with the noun now.
      message: `${planName} includes ${row.limit} ${row.id === 'frontdesk' ? 'front-desk' : row.id.replace(/s$/, '')} seat${row.limit === 1 ? '' : 's'} and they are all in use. Upgrade the plan to add another.`,
    };
  }
  return { allowed: true, message: '' };
}

/** Monthly (or yearly) price in paise — the price table lives in `plans.mjs`. */
export const planPrice = priceForPlan;

/** What the clinic would pay to switch from one plan to another. No proration games. */
export function upgradeCost(fromPlan, toPlan, { interval = 'monthly' } = {}) {
  const from = planPrice(fromPlan, { interval });
  const to = planPrice(toPlan, { interval });
  if (to === null) return null;
  const delta = to - (from ?? 0);
  return { from, to, delta, direction: delta > 0 ? 'upgrade' : delta < 0 ? 'downgrade' : 'same' };
}

/**
 * Human-readable expiry line, used in Settings and the invoice-style card.
 * @param {string|Date|null} value
 */
export function formatExpiry(value) {
  const d = toDate(value);
  if (!d) return '—';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
