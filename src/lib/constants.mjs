/**
 * The clinic's own vocabulary: what a clinic is, who works in it, how it is
 * paid, and the defaults a new workspace starts from.
 *
 * Split out of `logic.mjs` in v1.29.0. The plan vocabulary itself lives in
 * `plans.mjs`; `PLANS` here is that same object, re-exported so call sites and
 * tests that import it from `logic.mjs` keep working.
 */

import { PLANS as PLAN_CATALOGUE } from './plans.mjs';

// ---------------------------------------------------------------------------
// myClinic domain logic — pure, dependency-free functions (safe to unit test).
// Money is always an integer number of paise (₹1,250.50 === 125050).
// ---------------------------------------------------------------------------

export const CLINIC_TYPES = ['General Practice', 'Dental', 'Dermatology', 'Paediatrics', 'Physiotherapy', 'Orthopaedics', 'Gynaecology', 'ENT', 'Ophthalmology', 'Ayurveda / Homeopathy'];

export const ROLES = [
  { id: 'owner', label: 'Clinic owner', hint: 'Billing, plans, staff and every clinical record.' },
  { id: 'doctor', label: 'Doctor', hint: 'Own appointments, consultations and prescriptions.' },
  { id: 'frontdesk', label: 'Front desk', hint: 'Appointments, patient registration, payments.' },
];

export const PAYMENT_METHODS = [
  { id: 'cash', label: 'Cash' },
  { id: 'upi', label: 'UPI' },
  { id: 'card', label: 'Card' },
  { id: 'insurance', label: 'Insurance / TPA' },
  { id: 'credit', label: 'Clinic credit' },
];

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

export const GENDERS = ['Female', 'Male', 'Other'];

export const CHRONIC_TAGS = ['Diabetes', 'Hypertension', 'Asthma', 'Thyroid', 'Cardiac', 'Pregnancy', 'Allergy', 'Post-surgery'];

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/** The catalogue is plan vocabulary, so it is defined once, in plans.mjs. */
export const PLANS = PLAN_CATALOGUE;

export const DEFAULT_CLINIC = {
  name: 'Sunrise Multispecialty OPD',
  slug: 'sunrise-opd',
  clinic_type: 'General Practice',
  phone: '+91 22 4000 1200',
  email: 'front.desk@sunriseclinic.in',
  address: '2nd floor, Lotus Court, Linking Road, Bandra West, Mumbai 400050',
  gstin: '27ABCDE1234F1Z5',
  consultation_fee_paise: 50000,
  follow_up_fee_paise: 25000,
  follow_up_days: 15,
  slot_minutes: 15,
  open_time: '09:00',
  close_time: '20:00',
  gst_enabled: true,
  gst_rate: 0,
  invoice_prefix: 'INV',
  brand_color: '#0f766e',
  // Branding: uploaded in Settings → Logos & branding. Stored as data URLs on the
  // clinic row so documents render offline and the logo travels with the clinic.
  logo_square_url: null,
  logo_wide_url: null,
  logo_on_documents: true,
  // UPI collection: the VPA printed as a QR on unpaid invoices. Empty means the
  // clinic has not set one up yet and documents render without a QR block.
  upi_id: 'sunrise.opd@okicici',
  upi_payee_name: 'Sunrise Multispecialty OPD',
  upi_qr_on_invoices: true,
  // Public booking (v1.11.0): the slug is the public address, and the horizon is
  // how far ahead the diary may be opened to strangers.
  booking_enabled: true,
  booking_horizon_days: 14,
  booking_note: 'Reach 15 minutes before your slot at the front desk.',
};

export const DEFAULT_PREFERENCES = {
  theme: 'system',
  density: 'comfortable',
  reminders_enabled: true,
  reminder_lead_hours: 24,
  send_review_request: true,
  quiet_hours: '21:00-08:00',
};

/**
 * The columns `public.profiles` actually has (schema.sql).
 *
 * A form holds more state than a table has columns — this screen keeps the
 * chosen accent in localStorage, and carries preferences that a later schema
 * may or may not have added. Sending the whole object to PostgREST makes one
 * unknown key fail the entire update (PGRST204), which is how a notification
 * preference once stopped a doctor from saving their own name. So the patch is
 * built from this list, never from a spread.
 */

export const PROFILE_COLUMNS = [
  'full_name', 'phone', 'designation', 'theme', 'density', 'reminders_enabled',
  'reminder_lead_hours', 'send_review_request', 'quiet_hours', 'default_clinic_id',
];

/** Keep only the keys a table has; drops undefined so a field is never blanked by accident. */

export function pickColumns(row = {}, columns = PROFILE_COLUMNS) {
  const out = {};
  for (const key of columns) {
    if (row[key] !== undefined && row[key] !== null) out[key] = row[key];
  }
  return out;
}

/**
 * The update `profiles` should receive from the account screen.
 * @param {{full_name?:string, phone?:string, designation?:string}} profile
 * @param {object} prefs  theme, density, reminders*, quiet_hours, send_review_request
 * @param {string} theme  the theme chosen on the Appearance tab
 */

export function profilePatch(profile = {}, prefs = {}, theme = null) {
  const merged = {
    ...pickColumns(profile, ['full_name', 'phone', 'designation']),
    ...pickColumns(prefs, PROFILE_COLUMNS),
    ...(theme ? { theme } : {}),
  };
  if (typeof merged.full_name === 'string') merged.full_name = merged.full_name.trim();
  if (typeof merged.phone === 'string') merged.phone = merged.phone.trim();
  if (typeof merged.designation === 'string') merged.designation = merged.designation.trim();
  if (merged.reminder_lead_hours !== undefined) merged.reminder_lead_hours = Number(merged.reminder_lead_hours);
  if (merged.reminders_enabled !== undefined) merged.reminders_enabled = Boolean(merged.reminders_enabled);
  if (merged.send_review_request !== undefined) merged.send_review_request = Boolean(merged.send_review_request);
  return pickColumns(merged);
}

// ---------------------------------------------------------------------------
// IDs
// ---------------------------------------------------------------------------
