/**
 * Role matrix — the client mirror of the RLS policies in supabase/schema.sql.
 * The database is the authority; this module exists so the UI never offers an
 * action the server will reject, and so every screen agrees on the rules.
 *
 *   owner      everything, including team, plan, voids and destructive deletes
 *   doctor     clinical authoring (consultations, prescriptions, follow-ups)
 *   frontdesk  register, appointments, tokens, invoice creation and payment collection
 */

export const ROLES = ['owner', 'doctor', 'frontdesk'];

export const ROLE_LABEL = { owner: 'Owner', doctor: 'Doctor', frontdesk: 'Front desk' };

export const ROLE_BLURB = {
  owner: 'Full access — clinic settings, team, billing and plan. Can delete records and void invoices.',
  doctor: 'Consultations, prescriptions and follow-ups for their clinic. Can read billing and register patients.',
  frontdesk: 'Patients, appointments, token queue, invoices and payments. Cannot edit clinical notes or void invoices.',
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

  'consultation:read': ['owner', 'doctor', 'frontdesk'],
  'consultation:write': ['owner', 'doctor'],
  'consultation:delete': ['owner'],

  'invoice:read': ['owner', 'doctor', 'frontdesk'],
  'invoice:create': ['owner', 'doctor', 'frontdesk'],
  'invoice:collect': ['owner', 'frontdesk'],
  'invoice:void': ['owner'],
  'invoice:delete': ['owner'],

  'team:read': ['owner', 'doctor', 'frontdesk'],
  'team:write': ['owner'],

  'clinic:settings': ['owner'],
  'clinic:reports': ['owner', 'doctor'],
  'clinic:reports:money': ['owner'],
  'clinic:export': ['owner'],
  'clinic:reset': ['owner'],

  'followup:write': ['owner', 'doctor'],
  'prescription:write': ['owner', 'doctor'],
};

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
export function whoCan(capability) {
  const roles = MATRIX[capability] ?? [];
  return roles.map((r) => ROLE_LABEL[r]).join(', ');
}

/**
 * Route guards. A member without the capability is redirected to their first
 * permitted screen rather than shown an empty page.
 */
export const ROUTE_CAPABILITY = {
  '/app/consultations': 'consultation:read',
  '/app/follow-ups': 'consultation:read',
  '/app/reports': 'clinic:reports',
  '/app/team': 'team:read',
  '/app/settings': null,                    // everyone may open; sections gate themselves
};

export function landingRouteFor(role) {
  if (role === 'frontdesk') return '/app/queue';
  if (role === 'doctor') return '/app/dashboard';
  return '/app/dashboard';
}
