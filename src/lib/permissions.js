/**
 * Role matrix — the client mirror of the RLS policies in supabase/schema.sql.
 * The database is the authority; this module exists so the UI never offers an
 * action the server will reject, and so every screen agrees on the rules.
 *
 *   owner      everything, including team, plan, voids and destructive deletes
 *   doctor     clinical authoring (consultations, prescriptions, follow-ups) and
 *              the reports that read them — no billing, no clinic setup
 *   frontdesk  register, appointments, tokens, billing and payment collection, and
 *              the reports that read the money — no clinical record at all
 *
 * The two clinical/money halves do not overlap: front desk cannot open a
 * consultation, and a doctor cannot open a bill. That is the promise the Team
 * page prints (ROLE_MATRIX, below) and the pair of RLS policies schema 10 draws
 * (consultations_read, invoices_read/write/update), so the screen, the button and
 * the database all say the same thing.
 */

export const ROLES = ['owner', 'doctor', 'frontdesk'];

export const ROLE_LABEL = { owner: 'Owner', doctor: 'Doctor', frontdesk: 'Front desk' };

export const ROLE_BLURB = {
  owner: 'Full access — clinic settings, team, billing and plan. Can delete records and void invoices.',
  doctor: 'Consultations, prescriptions and follow-ups, plus the reports that read them. No billing, no clinic setup, no staff changes.',
  frontdesk: 'Patients, appointments, token queue, invoices and payments, plus the money reports. No consultation notes, no day close, no staff roster, no clinic setup.',
};

/** capability → roles allowed */
const MATRIX = {
  'patient:read': ['owner', 'doctor', 'frontdesk'],
  'patient:write': ['owner', 'doctor', 'frontdesk'],
  'patient:archive': ['owner', 'doctor'],
  'patient:delete': ['owner'],

  'appointment:read': ['owner', 'doctor', 'frontdesk'],
  'appointment:write': ['owner', 'doctor', 'frontdesk'],
  'appointment:token': ['owner', 'doctor', 'frontdesk'],
  'appointment:delete': ['owner', 'frontdesk'],

  'consultation:read': ['owner', 'doctor'],
  'consultation:write': ['owner', 'doctor'],
  'consultation:delete': ['owner'],

  'invoice:read': ['owner', 'frontdesk'],
  'invoice:create': ['owner', 'frontdesk'],
  // Taking money at the counter is the desk's job; *closing the day* — counting
  // the drawer, writing down a variance, freezing the snapshot — is the owner's.
  'invoice:collect': ['owner', 'frontdesk'],
  'day:close': ['owner'],
  'invoice:void': ['owner'],
  'invoice:delete': ['owner'],

  // The roster carries fees, hours and the invites of every seat; the front desk
  // books against doctors but does not manage them.
  'team:read': ['owner', 'doctor'],
  'team:write': ['owner'],

  'clinic:settings': ['owner'],
  'clinic:reports': ['owner', 'doctor', 'frontdesk'],
  // A doctor may read the reports that come from their own consultations; the
  // money half of them belongs to whoever runs the money.
  'clinic:reports:money': ['owner', 'frontdesk'],
  'clinic:export': ['owner'],
  'clinic:reset': ['owner'],

  'followup:write': ['owner', 'doctor'],
  'prescription:write': ['owner', 'doctor'],
};

/**
 * The role table printed in Team → Roles, as capabilities rather than as
 * hand-written ticks. It used to be a hard-coded list of booleans in Team.jsx —
 * one of them a tautology (`role.id !== 'frontdesk' || true`) — which is exactly
 * how a table can promise front-desk reports while the Reports route refuses
 * them. `tests/rbac.test.mjs` pins this to the published matrix.
 */
export const ROLE_MATRIX = [
  { label: 'Dashboard & reports', capability: 'clinic:reports' },
  { label: 'Patient charts', capability: 'patient:read' },
  { label: 'Consultations & prescriptions', capability: 'consultation:write' },
  { label: 'Billing & payments', capability: 'invoice:create' },
  { label: 'Clinic settings & plan', capability: 'clinic:settings' },
  { label: 'Invite or remove staff', capability: 'team:write' },
];

/** One role's row of that table, ready to print. */
export function roleMatrixFor(role) {
  return ROLE_MATRIX.map((row) => ({ ...row, allowed: can(role, row.capability) }));
}

export function capabilitiesFor(role) {
  const out = new Set();
  for (const [cap, roles] of Object.entries(MATRIX)) if (roles.includes(role)) out.add(cap);
  return out;
}

export function can(role, capability) {
  const roles = MATRIX[capability];
  if (!roles) return false;                 // unknown capability fails closed
  return roles.includes(role);
}

/** Convenience: describe a capability's audience for UI copy. */
/**
 * Route guards. A member without the capability is redirected to their first
 * permitted screen rather than shown an empty page.
 */
export const ROUTE_CAPABILITY = {
  '/app/consultations': 'consultation:read',
  '/app/follow-ups': 'consultation:read',
  '/app/reports': 'clinic:reports',
  '/app/billing': 'invoice:read',
  '/app/day-close': 'day:close',
  '/app/team': 'team:read',
  '/app/settings': null,                    // everyone may open; sections gate themselves
};

export function landingRouteFor(role) {
  if (role === 'frontdesk') return '/app/queue';
  if (role === 'doctor') return '/app/dashboard';
  return '/app/dashboard';
}
