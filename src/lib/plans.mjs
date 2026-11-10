/**
 * The plan vocabulary — **the only place a plan id is written down.**
 *
 * Before this module the three ids lived in eight files: `license.mjs` (caps,
 * order, price, seat messages), `logic.mjs` (the marketing catalogue),
 * `central-sync.mjs` (tier → plan), `store.jsx` (two fallbacks), plus
 * `AppLayout`, `Settings`, `Subscription` and `Team`, each re-deriving labels and
 * seat caps with its own nested ternary. Adding a fourth plan was a nine-file edit
 * and a missed file showed up as a price or a cap that disagreed with the screen
 * next to it.
 *
 * The **database stays the authority** for caps and prices
 * (`supabase/schema.sql`: `license_seats()`, `plan_price()`). This module is the
 * client's mirror of that vocabulary, and `tests/schema-parity.test.mjs` holds the
 * two copies together so neither can drift silently.
 *
 * Rules for this file:
 *   - ids, caps, prices, labels and blurbs live here and nowhere else;
 *   - nothing else in `src/` may contain a quoted plan id;
 *   - unknown input is normalised by `planId()`, never by a ternary at a call site.
 */

/** The plans this build knows, in the order they are sold. */
export const PLAN_IDS = Object.freeze(['solo', 'growth', 'chain']);

/** Legacy name kept because `license.mjs` exported it and tests import it. */
export const PLAN_ORDER = PLAN_IDS;

/**
 * The plan assumed when a caller hands us something unrecognised — the middle of
 * the range, which is what the marketing pages lead with.
 */
export const DEFAULT_PLAN = 'growth';

/**
 * The plan assumed when we know nothing at all: a refusal with no plan attached, or
 * a Central answer that never arrived. Deliberately the *smallest* plan, because a
 * licence error must never read as an upgrade.
 */
export const FALLBACK_PLAN = 'solo';

/** The plan that is sold by conversation rather than by a button. */
export const SALES_PLAN = 'chain';

/** True when this plan is the one the pricing page answers with "Talk to us". */
export function planNeedsSales(plan) {
  return planId(plan) === SALES_PLAN;
}

/** Seat caps per plan. `null` means unlimited. Mirrors `license_seats()` in SQL. */
export const PLAN_LIMITS = Object.freeze({
  solo: Object.freeze({ doctors: 1, frontdesk: 1, branches: 1 }),
  growth: Object.freeze({ doctors: 5, frontdesk: 3, branches: 1 }),
  chain: Object.freeze({ doctors: null, frontdesk: null, branches: null }),
});

/** Monthly price in paise. Mirrors `plan_price()` in SQL. */
export const PLAN_PRICE_PAISE = Object.freeze({ solo: 99900, growth: 249900, chain: 599900 });

/** The name a plan goes by on a badge or a message. */
export const PLAN_LABEL = Object.freeze({ solo: 'Solo', growth: 'Growth', chain: 'Multi-clinic' });

/** The name in the sidebar's plan box, which reads as a sentence fragment. */
export const PLAN_SIDEBAR_LABEL = Object.freeze({ solo: 'Solo plan', growth: 'Growth plan', chain: 'Multi-clinic' });

/** One line of positioning, used on the subscription screen. */
export const PLAN_BLURB = Object.freeze({
  solo: 'One doctor, one front desk. The whole clinic on a single screen.',
  growth: 'The usual pick for a busy multi-doctor OPD.',
  chain: 'Clinic groups and polyclinics with billing at branch level.',
});

/** The seat line, used on the team screen. */
export const PLAN_SEATS = Object.freeze({
  solo: '1 doctor + 1 front desk',
  growth: '5 doctors + 3 front desk',
  chain: 'Unlimited seats',
});

/** The full catalogue: what the landing and pricing screens render. */
export const PLANS = Object.freeze([
  Object.freeze({
    id: 'solo',
    name: 'Solo',
    price_paise: 99900,
    tagline: 'One doctor, one chair, zero paperwork.',
    limits: '1 doctor · 300 patients',
    features: Object.freeze(['1 doctor + 1 front desk seat', 'Up to 300 active patients / month', 'Appointments & digital prescriptions', 'GST-ready invoices', 'Daily collection report']),
  }),
  Object.freeze({
    id: 'growth',
    name: 'Growth',
    price_paise: 249900,
    tagline: 'The usual pick for a busy multi-doctor OPD.',
    limits: '5 doctors · unlimited patients',
    popular: true,
    features: Object.freeze(['Up to 5 doctors + 3 front desk seats', 'Unlimited patients and visits', 'Follow-up engine & recall reminders', 'Revenue, footfall and payer analytics', 'WhatsApp / SMS reminder templates', 'CSV + spreadsheet export']),
  }),
  Object.freeze({
    id: 'chain',
    name: 'Multi-clinic',
    price_paise: 599900,
    tagline: 'For clinic groups and polyclinics.',
    limits: 'Unlimited doctors · multi-branch',
    features: Object.freeze(['Unlimited seats and branches', 'Branch-level P&L and doctor payouts', 'Role-based access + audit trail', 'Priority support and onboarding', 'Data residency options']),
  }),
]);

/**
 * Central's tier names (the central project's own vocabulary) mapped to plans.
 *
 * Says nothing about *entitlement* — Central decides who is licensed. This only
 * translates the word it sends into the word this build uses, in one place.
 */
export const CENTRAL_TIER_TO_PLAN = Object.freeze({
  solo: 'solo',
  standard: 'growth',
  growth: 'growth',
  chain: 'chain',
  enterprise: 'chain',
});

/* ------------------------------------------------------------------ lookups */

/** True when `value` is a plan id this build knows. */
export function isPlanId(value) {
  return PLAN_IDS.includes(value);
}

/** Normalise anything into a known plan id. Unknown input becomes `DEFAULT_PLAN`. */
export function planId(value) {
  return isPlanId(value) ? value : DEFAULT_PLAN;
}

/** The label for a plan id, tolerating an unknown or missing one. */
export function planLabel(plan) {
  return PLAN_LABEL[planId(plan)];
}

/** The sidebar's phrasing for a plan id. */
export function planSidebarLabel(plan) {
  return PLAN_SIDEBAR_LABEL[planId(plan)];
}

/** Seat caps for a plan id, tolerating an unknown or missing one. */
export function planLimits(plan) {
  return PLAN_LIMITS[planId(plan)];
}

/** The catalogue row for a plan id, falling back to the default plan's row. */
export function planRow(plan) {
  const id = planId(plan);
  return PLANS.find((p) => p.id === id) ?? PLANS.find((p) => p.id === DEFAULT_PLAN);
}

/**
 * Monthly (or yearly) price in paise, with the yearly discount applied.
 * `null` for an unknown plan — the pricing screens use that to say "ask us"
 * rather than to quote a number for a plan that is not on sale.
 */
export function planPrice(plan, { interval = 'monthly' } = {}) {
  const base = PLAN_PRICE_PAISE[plan];
  if (!base) return null;
  if (interval === 'yearly') return Math.round(base * 12 * 0.8); // 20% off, two months free
  return base;
}

/** Central tier → plan id, with the smallest plan when the tier is unrecognised. */
export function planForTier(tier) {
  return CENTRAL_TIER_TO_PLAN[String(tier ?? '').toLowerCase()] ?? FALLBACK_PLAN;
}
