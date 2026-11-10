import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  DRAFT_KEY, FOLLOW_UP_CHOICES, SLOT_CHOICES, WEEKDAYS, clearDraft, clinicPayload, daySpan, emptyForm,
  isValidContact, isValidEmail, isValidPhone, loadDraft, ownerPayload, phoneDigits, resumeStep, saveDraft,
  sessionsFor, summaryRows, validateClinicStep, validateDoctorStep, validateHoursStep,
} from '../src/lib/onboarding.mjs';
import { CLINIC_TYPES } from '../src/lib/logic.mjs';
import { FOLLOW_UP_MAX_DAYS, FOLLOW_UP_MIN_DAYS, MAX_SESSIONS, MIN_SESSION_MINUTES } from '../src/lib/hours.mjs';

/**
 * "Set up your clinic" is the one screen every clinic sees exactly once, so every
 * thing it can get wrong is a clinic that starts life with the wrong number on its
 * invoices. Three bugs lived here: the clinic's phone and the doctor's phone were
 * one field, the hours were collected and dropped, and an unreadable fee silently
 * became ₹500. These tests are the contract that replaces them.
 */

const schema = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'schema.sql'), 'utf8');
const page = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'pages', 'Onboarding.jsx'), 'utf8');
/** The page as code: comments describe the old behaviour and must not be matched. */
const pageCode = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const memoryStorage = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
};

const goodForm = (over = {}) => ({
  ...emptyForm(),
  name: 'Sunrise Multispecialty',
  clinic_phone: '02240001200',
  email: 'front.desk@sunrise.in',
  owner_name: 'Dr. Anita Rao',
  doctor_phone: '9820000000',
  ...over,
});

/* -------------------------------------------------------------- the blanks */

test('a blank form starts at the app’s own defaults, not a second set', () => {
  const form = emptyForm({ email: 'me@clinic.in', ownerName: 'Dr. Me' });
  assert.equal(form.name, '');
  assert.equal(form.email, 'me@clinic.in');
  assert.equal(form.owner_name, 'Dr. Me');
  assert.equal(form.open_time, '09:00');
  assert.equal(form.close_time, '20:00');
  assert.equal(form.slot_minutes, 15);
  assert.equal(form.follow_up_days, 15);
  assert.equal(form.fee, '500');
  assert.equal(form.follow_up_fee, '250');
  // The clinic is created with the same defaults the database used before there
  // was a form at all.
  const payload = clinicPayload(emptyForm());
  assert.equal(payload.consultation_fee_paise, 50000);
  assert.equal(payload.follow_up_fee_paise, 25000);
  assert.equal(payload.slot_minutes, 15);
  assert.equal(payload.follow_up_days, 15);
  // Every choice the form offers is one the database accepts.
  assert.ok(CLINIC_TYPES.includes(emptyForm().clinic_type));
  for (const m of SLOT_CHOICES) assert.ok([5, 10, 15, 20, 30, 45, 60].includes(m), `${m} is not a slot the column allows`);
  for (const d of FOLLOW_UP_CHOICES) {
    assert.ok(d >= FOLLOW_UP_MIN_DAYS && d <= FOLLOW_UP_MAX_DAYS, `${d} days is outside the column's ${FOLLOW_UP_MIN_DAYS}–${FOLLOW_UP_MAX_DAYS}`);
  }
});

test('the week offered is the week the rest of the app reads', () => {
  assert.deepEqual(WEEKDAYS.map((d) => d.id), [1, 2, 3, 4, 5, 6, 0]);
  assert.deepEqual(WEEKDAYS.map((d) => d.label), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
});

/* ------------------------------------------------------------ the two phones */

test('the clinic’s number and the doctor’s number are two fields, not one', () => {
  const form = goodForm();
  assert.notEqual(form.clinic_phone, form.doctor_phone);
  const clinic = clinicPayload(form);
  const owner = ownerPayload(form);
  assert.equal(clinic.phone, '02240001200');
  assert.equal(owner.phone, '9820000000');
  // Typing one must never move the other: the payloads are built from separate keys.
  const changed = goodForm({ doctor_phone: '9811111111' });
  assert.equal(clinicPayload(changed).phone, '02240001200');
  assert.equal(ownerPayload(changed).phone, '9811111111');
});

test('a mobile is read the way people write it, and judged on ten digits', () => {
  assert.equal(phoneDigits('+91 98200 00000'), '9820000000');
  assert.equal(phoneDigits('098200 00000'), '9820000000');
  assert.equal(phoneDigits('98200-00000'), '9820000000');
  for (const value of ['9820000000', '+91 98200 00000', '09820000000', '98111 22233']) {
    assert.ok(isValidPhone(value), `${value} should be accepted`);
  }
  for (const value of ['', '98200', '1234567890', '5820000000', 'abcdefghij']) {
    assert.equal(isValidPhone(value), false, `${value} should be refused`);
  }
  // A landline with an STD code is a real clinic number and is not a mobile, so
  // the clinic and the doctor are judged by different rules.
  assert.equal(phoneDigits('022 4000 1200'), '2240001200');
  assert.equal(isValidPhone('022 4000 1200'), false, 'a landline cannot receive a WhatsApp reminder');
  assert.equal(isValidContact('022 4000 1200'), true, 'but it is a number the front desk answers');
  assert.equal(isValidContact('9820000000'), true);
  assert.equal(isValidContact('12345'), false);
});

test('a clinic may be created without a phone, but not with a broken one', () => {
  assert.deepEqual(validateClinicStep(goodForm({ clinic_phone: '' })), {});
  assert.ok(validateClinicStep(goodForm({ clinic_phone: '12345' })).clinic_phone);
  assert.deepEqual(validateClinicStep(goodForm({ clinic_phone: '022 4000 1200' })), {}, 'a landline is a clinic contact');
  assert.ok(validateClinicStep(goodForm({ email: 'front.desk@' })).email);
  assert.deepEqual(validateClinicStep(goodForm({ email: '' })), {});
  assert.equal(isValidEmail('a@b.co'), true);
  assert.equal(isValidEmail('mrs.rao+fever@clinic.co.in'), true);
  assert.equal(isValidEmail('a@b'), false);
});

/* --------------------------------------------------------------- the checks */

test('a clinic needs a name, and the message says why', () => {
  const errors = validateClinicStep(emptyForm());
  assert.ok(errors.name);
  assert.match(errors.name, /invoice/);
  assert.deepEqual(validateClinicStep(goodForm()), {});
  assert.ok(validateClinicStep(goodForm({ name: 'x'.repeat(121) })).name);
});

test('a doctor needs a name and, if given a number, a real one', () => {
  assert.ok(validateDoctorStep(goodForm({ owner_name: '' })).owner_name);
  assert.ok(validateDoctorStep(goodForm({ doctor_phone: '999' })).doctor_phone);
  assert.deepEqual(validateDoctorStep(goodForm({ doctor_phone: '' })), {});
  // The registration number is the doctor's business, not a blocker.
  assert.deepEqual(validateDoctorStep(goodForm({ registration_no: '' })), {});
});

test('the day has to make sense before it can be saved', () => {
  assert.ok(validateHoursStep(goodForm({ open_time: '19:00', close_time: '10:00' })).close_time);
  assert.ok(validateHoursStep(goodForm({ open_time: '', close_time: '' })).open_time);
  assert.deepEqual(validateHoursStep(goodForm()), {});
  assert.deepEqual(validateHoursStep(goodForm({ open_time: '00:00', close_time: '23:59' })), {});
});

test('a second session has to be a whole session, after the first', () => {
  assert.ok(validateHoursStep(goodForm({ second_open: '16:00', second_close: '' })).second_open);
  assert.ok(validateHoursStep(goodForm({ second_open: '16:00', second_close: '15:00' })).second_close);
  // Overlaps and impossibly short sessions are caught by the rule the database
  // enforces, so a day the clinic can set here is a day it can set in Settings.
  const overlap = validateHoursStep(goodForm({ second_open: '18:00', second_close: '22:00' }));
  assert.ok(overlap.sessions, 'an overlapping session should be refused');
  assert.match(overlap.sessions, /overlaps/);
  const tooShort = validateHoursStep(goodForm({ open_time: '09:00', close_time: '09:10' }));
  assert.match(tooShort.sessions, new RegExp(`${MIN_SESSION_MINUTES} minutes`));
  // A second session that starts after the first one ends is a real day.
  assert.deepEqual(validateHoursStep(goodForm({ close_time: '14:00', second_open: '18:00', second_close: '21:00' })), {});
});

test('a clinic cannot be closed on all seven days', () => {
  const errors = validateHoursStep(goodForm({ closed_weekdays: [0, 1, 2, 3, 4, 5, 6] }));
  assert.ok(errors.closed_weekdays);
  assert.deepEqual(validateHoursStep(goodForm({ closed_weekdays: [0, 6] })), {});
});

test('the follow-up window is checked against the column, not against a guess', () => {
  assert.ok(validateHoursStep(goodForm({ follow_up_days: FOLLOW_UP_MAX_DAYS + 1 })).follow_up_days);
  assert.ok(validateHoursStep(goodForm({ follow_up_days: FOLLOW_UP_MIN_DAYS - 1 })).follow_up_days);
  assert.deepEqual(validateHoursStep(goodForm({ follow_up_days: FOLLOW_UP_MAX_DAYS })), {});
  assert.deepEqual(validateHoursStep(goodForm({ follow_up_days: FOLLOW_UP_MIN_DAYS })), {});
});

test('an unreadable fee is an error, not a silent ₹500', () => {
  for (const bad of ['abc', '-5', '₹500', '1 000', '10.999']) {
    const errors = validateHoursStep(goodForm({ fee: bad }));
    assert.ok(errors.fee, `${bad} should be refused`);
    assert.match(errors.fee, /rupees/);
  }
  // And what can be read is converted, never rounded by guesswork.
  assert.equal(clinicPayload(goodForm({ fee: '1,000' })).consultation_fee_paise, 100000);
  assert.equal(clinicPayload(goodForm({ follow_up_fee: '250.50' })).follow_up_fee_paise, 25050);
  assert.equal(clinicPayload(goodForm({ fee: '0' })).consultation_fee_paise, 0);
});

/* --------------------------------------------------------------- the payload */

test('the payload is what create_clinic() reads, key for key', () => {
  const clinic = clinicPayload(goodForm({ gstin: '27aabcu9603r1zm', address: '  2nd floor  ' }));
  assert.deepEqual(Object.keys(clinic).sort(), [
    'address', 'clinic_type', 'close_time', 'closed_weekdays', 'consultation_fee_paise', 'email',
    'follow_up_days', 'follow_up_fee_paise', 'gstin', 'name', 'open_time', 'phone', 'sessions', 'slot_minutes',
  ]);
  assert.equal(clinic.name, 'Sunrise Multispecialty');
  assert.equal(clinic.address, '2nd floor');
  assert.equal(clinic.gstin, '27AABCU9603R1ZM');
  assert.equal(clinic.consultation_fee_paise, 50000);
  assert.deepEqual(clinic.sessions, [{ label: 'Morning', start: '09:00', end: '20:00' }]);
  assert.deepEqual(clinic.closed_weekdays, [0]);

  const owner = ownerPayload(goodForm());
  assert.deepEqual(Object.keys(owner).sort(), [
    'day_end', 'day_start', 'email', 'fee_paise', 'follow_up_fee_paise', 'full_name',
    'phone', 'qualification', 'registration_no', 'slot_minutes', 'specialty',
  ]);
  assert.equal(owner.full_name, 'Dr. Anita Rao');
  assert.equal(owner.day_start, '09:00');
  assert.equal(owner.day_end, '20:00');
  assert.equal(owner.fee_paise, 50000);
});

test('the legacy open/close pair is the span of the sessions, not the first one', () => {
  const form = goodForm({ open_time: '10:00', close_time: '14:00', second_open: '16:00', second_close: '19:00' });
  assert.deepEqual(daySpan(form), { open: '10:00', close: '19:00' });
  assert.equal(clinicPayload(form).open_time, '10:00');
  assert.equal(clinicPayload(form).close_time, '19:00');
  // The owner sits the whole day, so their row says the same thing.
  assert.equal(ownerPayload(form).day_start, '10:00');
  assert.equal(ownerPayload(form).day_end, '19:00');
  // One session is just its own span.
  assert.deepEqual(daySpan(goodForm()), { open: '09:00', close: '20:00' });
});

test('two sessions reach the payload in the order the database sorts them', () => {
  const sessions = sessionsFor(goodForm({ open_time: '10:00', close_time: '14:00', second_open: '16:00', second_close: '19:00' }));
  assert.deepEqual(sessions, [
    { label: 'Morning', start: '10:00', end: '14:00' },
    { label: 'Evening', start: '16:00', end: '19:00' },
  ]);
  assert.ok(sessions.length <= MAX_SESSIONS);
  // A half-filled second session is not a session.
  assert.equal(sessionsFor(goodForm({ second_open: '16:00' })).length, 1);
});

test('weekdays travel de-duplicated and in weekday order', () => {
  assert.deepEqual(clinicPayload(goodForm({ closed_weekdays: [6, 0, 0, 2] })).closed_weekdays, [0, 2, 6]);
  assert.deepEqual(clinicPayload(goodForm({ closed_weekdays: [] })).closed_weekdays, []);
});

/* ---------------------------------------------------------------- the review */

test('the review step names exactly what is about to be created', () => {
  const rows = summaryRows(goodForm({ closed_weekdays: [0], slot_minutes: 20, follow_up_days: 21 }));
  assert.deepEqual(rows.map((r) => r.label), ['Clinic', 'Address', 'Contact', 'Lead doctor', 'Registration', 'Hours', 'Visits', 'Fees']);
  const by = Object.fromEntries(rows.map((r) => [r.label, r.value]));
  assert.match(by.Clinic, /Sunrise Multispecialty · General Practice/);
  assert.match(by['Lead doctor'], /Dr\. Anita Rao · MBBS · General Physician/);
  assert.match(by.Hours, /09:00–20:00/);
  assert.match(by.Hours, /closed Sun/);
  assert.match(by.Visits, /20-minute slots · follow-up valid 21 days/);
  assert.match(by.Fees, /₹500 consultation · ₹250 follow-up/);
  // Two sessions are both listed, because that is the week the clinic will run.
  const two = Object.fromEntries(summaryRows(goodForm({ open_time: '10:00', close_time: '14:00', second_open: '16:00', second_close: '19:00' })).map((r) => [r.label, r.value]));
  assert.match(two.Hours, /10:00–14:00 · 16:00–19:00/);
  // Nothing is invented: an empty answer reads as empty, with where to fix it.
  assert.match(summaryRows(emptyForm()).find((r) => r.label === 'Address').value, /Settings/);
  assert.equal(summaryRows(emptyForm()).find((r) => r.label === 'Registration').value, 'not set');
});

/* ----------------------------------------------------------------- the draft */

test('a half-filled form survives a reload, and only its own keys come back', () => {
  const storage = memoryStorage();
  const form = goodForm({ address: '2nd floor, Andheri West', fee: '700' });
  saveDraft(form, storage);
  assert.deepEqual(loadDraft(storage, emptyForm()), form);

  // An older build's draft cannot inject strangers into the payload…
  storage.setItem(DRAFT_KEY, JSON.stringify({ form: { ...form, plan: 'chain', evil: true } }));
  const merged = loadDraft(storage, emptyForm());
  assert.equal(merged.plan, undefined);
  assert.equal(merged.evil, undefined);
  assert.equal(merged.address, '2nd floor, Andheri West');

  // …and a corrupt one is ignored rather than thrown.
  storage.setItem(DRAFT_KEY, '{not json');
  assert.deepEqual(loadDraft(storage, emptyForm()), emptyForm());
  clearDraft(storage);
  assert.equal(storage.getItem(DRAFT_KEY), null);
});

test('private mode does not break the set-up screen', () => {
  const exploding = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  assert.doesNotThrow(() => saveDraft(goodForm(), exploding));
  assert.deepEqual(loadDraft(exploding, emptyForm()), emptyForm());
  assert.doesNotThrow(() => clearDraft(exploding));
});

test('a resumed draft opens on the step it got to', () => {
  assert.equal(resumeStep(emptyForm()), 0);
  assert.equal(resumeStep(goodForm({ owner_name: '' })), 1);
  assert.equal(resumeStep(goodForm()), 2);
});

/* --------------------------------------------------------------- the wiring */

test('the page holds no rules of its own', () => {
  // Every rule lives in onboarding.mjs, so it can be tested without a browser.
  assert.match(pageCode, /from '\.\.\/lib\/onboarding\.mjs'/);
  for (const fn of ['validateStep', 'clinicPayload', 'ownerPayload', 'summaryRows', 'saveDraft', 'loadDraft']) {
    assert.match(pageCode, new RegExp(`\\b${fn}\\b`), `${fn} should be used by the page`);
  }
  assert.doesNotMatch(pageCode, /moneyToPaise/, 'fee parsing belongs in the lib, not the page');
  assert.doesNotMatch(pageCode, /catch\s*\{\s*keep defaults/i);
  // The one-field-for-two-people bug cannot come back.
  assert.match(pageCode, /doctor_phone/);
  assert.doesNotMatch(pageCode, /value=\{form\.phone\}/);
  // Four steps now, and the last one creates nothing until it is pressed.
  for (const title of ['Clinic details', 'Lead doctor', 'Hours & fees', 'Review']) {
    assert.ok(pageCode.includes(title), `${title} step is missing`);
  }
  assert.match(pageCode, /aria-live="polite"/);
});

test('schema 19 writes every key the form sends, and clamps the window the column allows', () => {
  const start = schema.lastIndexOf('create or replace function public.create_clinic(');
  assert.ok(start > 0);
  const body = schema.slice(start, schema.indexOf('$$;', start));

  for (const key of ['consultation_fee_paise', 'follow_up_fee_paise', 'follow_up_days', 'slot_minutes',
    'open_time', 'close_time', 'sessions', 'closed_weekdays', 'gstin', 'registration_no',
    'day_start', 'day_end', 'fee_paise', 'next_clinic_slug']) {
    assert.ok(body.includes(key), `create_clinic() ignores ${key}, which the set-up screen collects`);
  }
  // The clamp is the column's range, read from the module that mirrors it.
  assert.ok(body.includes(`greatest(${FOLLOW_UP_MIN_DAYS}, least(${FOLLOW_UP_MAX_DAYS},`),
    'the follow-up clamp and FOLLOW_UP_MIN_DAYS/FOLLOW_UP_MAX_DAYS disagree');
  // An old client sends no keys at all and must still get a working clinic.
  assert.match(body, /coalesce\(p_clinic->>'phone', ''\)/);
  assert.match(body, /public\.next_clinic_slug\(clinic_name\)/);
});
