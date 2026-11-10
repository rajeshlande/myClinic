/**
 * Onboarding: the three questions a new clinic answers once.
 *
 * "Set up your clinic" asked for a clinic, a lead doctor and the week's hours, then
 * did three things wrong with the answers: the clinic phone and the doctor's phone
 * were the *same field*, the hours and the follow-up window were collected and never
 * written (the RPC did not insert them), and a bad fee silently became ₹500.
 *
 * This module is the part that can be checked: what a step needs, what a finished
 * form turns into, and what survives a reload. The page only draws it.
 */

import {
  FOLLOW_UP_MAX_DAYS, FOLLOW_UP_MIN_DAYS, clinicSessions, normaliseSessions, normaliseWeekdays,
  validateFollowUpDays, validateSessions,
} from './hours.mjs';
import { CLINIC_TYPES, moneyToPaise } from './logic.mjs';

/** The draft key. Versioned, like every other storage key in the app. */
export const DRAFT_KEY = 'myclinic.onboarding.v1';

/** A weekday is closed if its number is in `closed_weekdays` (0 = Sunday). */
export const WEEKDAYS = Object.freeze([
  { id: 1, label: 'Mon' }, { id: 2, label: 'Tue' }, { id: 3, label: 'Wed' },
  { id: 4, label: 'Thu' }, { id: 5, label: 'Fri' }, { id: 6, label: 'Sat' },
  { id: 0, label: 'Sun' },
]);

export const SLOT_CHOICES = Object.freeze([5, 10, 15, 20, 30, 45]);
export const FOLLOW_UP_CHOICES = Object.freeze([7, 10, 15, 21, 30, 45]);

/**
 * A blank form, optionally seeded from what we already know about the person.
 *
 * The clinic email starts from the signed-in account because that is the only email
 * we have on the first run — it is a default, not a claim about the front desk.
 */
export function emptyForm({ email = '', ownerName = '' } = {}) {
  return {
    // step 1 — the clinic
    name: '', clinic_type: CLINIC_TYPES[0], clinic_phone: '', email, address: '', gstin: '',
    // step 2 — the lead doctor (the signed-in owner)
    owner_name: ownerName, specialty: 'General Physician', qualification: 'MBBS',
    registration_no: '', doctor_phone: '',
    // step 3 — hours & fees
    open_time: '09:00', close_time: '20:00', second_open: '', second_close: '',
    closed_weekdays: [0],
    slot_minutes: 15, follow_up_days: 15, fee: '500', follow_up_fee: '250',
  };
}

/* ------------------------------------------------------------------ checks */

/** Ten digits, or nothing. Accepts the three shapes a front desk actually types. */
export function phoneDigits(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  // +91 98200 00000 · 098200 00000 · 98200 00000 all become ten digits
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

/**
 * A mobile number: the one a recall message or a WhatsApp reminder can reach.
 * Mobiles begin 6–9, which is what tells them apart from a clinic's landline.
 */
export function isValidPhone(value) {
  const d = phoneDigits(value);
  return d.length === 10 && /^[6-9]/.test(d);
}

/**
 * A number a front desk answers: a mobile, or a landline written with its STD
 * code. `022 4000 1200` is a perfectly good clinic contact and a bad place to
 * send a WhatsApp reminder, so the clinic and the doctor are judged differently.
 */
export function isValidContact(value) {
  const d = phoneDigits(value);
  return d.length === 10 && /^[2-9]/.test(d);
}

export function isValidEmail(value) {
  const v = String(value ?? '').trim();
  return v.length > 0 && v.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

const isTime = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v ?? ''));
const minutes = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };

/* -------------------------------------------------------------------- steps */

/** Step 1 — who the clinic is. Name is the only thing the database insists on. */
export function validateClinicStep(form) {
  const errors = {};
  const name = String(form.name ?? '').trim();
  if (!name) errors.name = 'Give the clinic a name — it prints on every invoice.';
  else if (name.length > 120) errors.name = 'Keep the name under 120 characters.';
  // A phone is optional, but a wrong one is worse than none: it is what a recall
  // message is sent to and what a patient rings back.
  if (form.clinic_phone && !isValidContact(form.clinic_phone)) {
    errors.clinic_phone = 'Enter a 10-digit number with its STD code, or leave it blank.';
  }
  if (form.email && !isValidEmail(form.email)) errors.email = 'That email does not look right.';
  if (String(form.address ?? '').trim().length > 400) errors.address = 'Keep the address under 400 characters.';
  return errors;
}

/** Step 2 — the doctor whose name goes on a prescription. */
export function validateDoctorStep(form) {
  const errors = {};
  const name = String(form.owner_name ?? '').trim();
  if (!name) errors.owner_name = 'Add the doctor’s name — it is signed on every prescription.';
  if (form.doctor_phone && !isValidPhone(form.doctor_phone)) {
    errors.doctor_phone = 'Enter a 10-digit mobile number, or leave it blank.';
  }
  if (String(form.qualification ?? '').trim().length > 80) errors.qualification = 'Keep the qualification under 80 characters.';
  return errors;
}

/** Step 3 — the week and the money. */
export function validateHoursStep(form) {
  const errors = {};
  const { open_time: open, close_time: close, second_open: sOpen, second_close: sClose } = form;
  if (!isTime(open) || !isTime(close)) errors.open_time = 'Set an opening and a closing time.';
  else if (minutes(close) <= minutes(open)) errors.close_time = 'Closing time has to be after opening time.';

  const wantsSecond = Boolean(sOpen || sClose);
  if (wantsSecond) {
    if (!isTime(sOpen) || !isTime(sClose)) errors.second_open = 'Give the second session both a start and an end.';
    else if (minutes(sClose) <= minutes(sOpen)) errors.second_close = 'The second session has to end after it starts.';
  }
  // Then the rule the database itself applies — same function the Settings screen
  // uses, so a day the clinic can save here is a day it can save there.
  if (!Object.keys(errors).length) {
    const check = validateSessions(sessionsFor(form), { label: 'Hours' });
    if (!check.ok) errors.sessions = check.error;
  }
  // All seven days closed is not a clinic.
  if ((form.closed_weekdays ?? []).length >= 7) errors.closed_weekdays = 'Leave at least one working day.';

  const followUp = validateFollowUpDays(form.follow_up_days);
  if (followUp) errors.follow_up_days = followUp;

  // Fees: refuse a number we cannot read instead of quietly charging the default.
  for (const [key, label] of [['fee', 'consultation'], ['follow_up_fee', 'follow-up']]) {
    const raw = String(form[key] ?? '').trim();
    if (!raw) { errors[key] = `Set the ${label} fee, or use 0 for free.`; continue; }
    try {
      const paise = moneyToPaise(raw);
      if (paise < 0) errors[key] = 'A fee cannot be negative.';
      if (paise > 99999999) errors[key] = 'That fee is too large.';
    } catch {
      errors[key] = 'Enter the fee in rupees, like 500 or 250.50.';
    }
  }
  return errors;
}

/** One call for the page: which step is blocked, and by what. */
export function validateStep(step, form) {
  if (step === 0) return validateClinicStep(form);
  if (step === 1) return validateDoctorStep(form);
  if (step === 2) return validateHoursStep(form);
  return {};
}

/* ----------------------------------------------------------------- payloads */

/**
 * The two sessions, in the shape `sessions_valid()` accepts.
 *
 * Normalised through `hours.mjs` so the page, the Settings screen and the database
 * cannot disagree about whether 10:00–9:00 is a session.
 */
export function sessionsFor(form) {
  const list = [{ start: form.open_time, end: form.close_time }];
  if (form.second_open && form.second_close) list.push({ start: form.second_open, end: form.second_close });
  return normaliseSessions(list).map((s, i) => ({ label: i ? 'Evening' : 'Morning', ...s }));
}

/** What `create_clinic()` receives as `p_clinic`. Keys it does not know are ignored. */
export function clinicPayload(form) {
  return {
    name: String(form.name ?? '').trim(),
    clinic_type: form.clinic_type,
    phone: String(form.clinic_phone ?? '').trim(),
    email: String(form.email ?? '').trim(),
    address: String(form.address ?? '').trim(),
    gstin: String(form.gstin ?? '').trim().toUpperCase(),
    consultation_fee_paise: safePaise(form.fee, 50000),
    follow_up_fee_paise: safePaise(form.follow_up_fee, 25000),
    follow_up_days: Number(form.follow_up_days) || 15,
    slot_minutes: Number(form.slot_minutes) || 15,
    // The legacy open/close pair still describes the whole day for every screen
    // written before two sessions existed, so it is the span of the sessions and
    // not just the first one.
    open_time: daySpan(form).open,
    close_time: daySpan(form).close,
    sessions: sessionsFor(form),
    closed_weekdays: normaliseWeekdays(form.closed_weekdays),
  };
}

/** What `create_clinic()` receives as `p_owner` — the signed-in doctor's row. */
export function ownerPayload(form) {
  return {
    full_name: String(form.owner_name ?? '').trim(),
    specialty: String(form.specialty ?? '').trim() || 'General Physician',
    qualification: String(form.qualification ?? '').trim() || 'MBBS',
    registration_no: String(form.registration_no ?? '').trim(),
    phone: String(form.doctor_phone ?? '').trim(),
    email: String(form.email ?? '').trim(),
    day_start: daySpan(form).open,
    day_end: daySpan(form).close,
    slot_minutes: Number(form.slot_minutes) || 15,
    fee_paise: safePaise(form.fee, 50000),
    follow_up_fee_paise: safePaise(form.follow_up_fee, 25000),
  };
}

/** The earliest start and the latest end of the day, as the sessions define it. */
export function daySpan(form) {
  const sessions = sessionsFor(form);
  if (!sessions.length) return { open: form.open_time || '09:00', close: form.close_time || '20:00' };
  return { open: sessions[0].start, close: sessions[sessions.length - 1].end };
}

function safePaise(value, fallback) {
  try { return moneyToPaise(String(value ?? '').trim() || String(fallback / 100)); } catch { return fallback; }
}

/** The review step: what is about to be created, in the order it will be read. */
export function summaryRows(form) {
  const closed = WEEKDAYS.filter((d) => (form.closed_weekdays ?? []).includes(d.id)).map((d) => d.label);
  const sessions = sessionsFor(form).map((s) => `${s.start}–${s.end}`).join(' · ');
  return [
    { label: 'Clinic', value: [form.name, form.clinic_type].filter(Boolean).join(' · ') },
    { label: 'Address', value: String(form.address ?? '').trim() || 'not set — add it in Settings' },
    { label: 'Contact', value: [form.clinic_phone, form.email].filter(Boolean).join(' · ') || 'not set' },
    { label: 'Lead doctor', value: [form.owner_name, form.qualification, form.specialty].filter(Boolean).join(' · ') },
    { label: 'Registration', value: String(form.registration_no ?? '').trim() || 'not set' },
    { label: 'Hours', value: `${sessions}${closed.length ? ` · closed ${closed.join(', ')}` : ' · open every day'}` },
    { label: 'Visits', value: `${form.slot_minutes}-minute slots · follow-up valid ${form.follow_up_days} days` },
    { label: 'Fees', value: `₹${form.fee} consultation · ₹${form.follow_up_fee} follow-up` },
  ];
}

/* -------------------------------------------------------------------- draft */

/**
 * Keep the half-filled form across a reload.
 *
 * A first-run screen is often filled in on a phone, in a queue, and interrupted;
 * losing the address and the fees because the tab reloaded is the difference between
 * a clinic that finishes and one that does not. Storage is injected so a private-mode
 * browser can be tested rather than hoped about.
 */
export function saveDraft(form, storage = globalThis.localStorage) {
  try { storage.setItem(DRAFT_KEY, JSON.stringify({ form, at: new Date().toISOString() })); } catch { /* quota / private mode */ }
  return form;
}

export function loadDraft(storage = globalThis.localStorage, blank = emptyForm()) {
  try {
    const raw = storage.getItem(DRAFT_KEY);
    if (!raw) return blank;
    const parsed = JSON.parse(raw);
    const form = parsed?.form;
    if (!form || typeof form !== 'object') return blank;
    // Only keys the current form knows: a draft from an older build cannot inject
    // strangers into the payload, and a new key keeps its default.
    const merged = { ...blank };
    for (const key of Object.keys(blank)) if (form[key] !== undefined && form[key] !== null) merged[key] = form[key];
    return merged;
  } catch { return blank; }
}

export function clearDraft(storage = globalThis.localStorage) {
  try { storage.removeItem(DRAFT_KEY); } catch { /* private mode */ }
}

/** Which step a resumed draft should open on: the first incomplete one. */
export function resumeStep(form) {
  if (Object.keys(validateClinicStep(form)).length) return 0;
  if (Object.keys(validateDoctorStep(form)).length) return 1;
  return 2;
}

/** The session list the rest of the app will read after creation (for the summary). */
export { clinicSessions, FOLLOW_UP_MAX_DAYS, FOLLOW_UP_MIN_DAYS };
