/**
 * Public booking — the one screen a patient sees without an account.
 *
 * Two data paths behind one contract:
 *
 *   demo   the sample clinic in localStorage, so the flow can be walked end to end
 *          without a backend, and the booking appears in the app immediately
 *   live   security-definer RPCs on Supabase (`public_clinic_profile`,
 *          `public_booking_busy`, `public_book`, `public_booking_lookup`,
 *          `public_cancel_booking`) granted to `anon`
 *
 * What crosses the wire from the database is deliberately small: the clinic's
 * public profile, *busy intervals* (a time and a length — never who), and the
 * booking the reference belongs to. No patient list, no names, no diagnoses.
 *
 * Slot availability is computed by the same engine the front desk uses
 * (`availableSlots` in schedule.mjs), so an online booking and a walk-in can never
 * disagree about what is free. The database enforces the same rule again with a
 * unique (doctor, date, time) constraint inside an advisory lock, so two patients
 * tapping the last slot at 11pm cannot both win.
 */
import { addDays, slugify, timeToMinutes, today } from './logic.mjs';
import { availableSlots, groupSlots, isoDate } from './schedule.mjs';
import { makeDemoWorkspace } from './demo-data.js';
import { whatsappLink } from './daybook.mjs';

export const BOOKING_HORIZON_DAYS = 14;
/** A patient cannot book a slot that starts sooner than this. */
export const BOOKING_LEAD_MINUTES = 30;
export const BOOKING_SLUG_FALLBACK = 'sunrise-opd';
/** Longest address the database will store (`clinics_slug_format`). */
export const BOOKING_SLUG_MAX = 40;
const DEMO_KEY = 'myclinic.demo.v1';

/* ------------------------------------------------------------------ helpers */

/**
 * The one rule a clinic name (or what an owner types) becomes in a URL.
 *
 * It mirrors `public.clinic_slug()` in schema.sql, and `tests/booking-link.test.mjs`
 * pins both to the same examples: a link shown in Settings has to be the link the
 * database answers on, so the two rules cannot be allowed to drift.
 *
 * Deliberately returns '' rather than a made-up slug. A clinic with no address is
 * a clinic whose link does not work yet, and pretending otherwise is how the
 * booking page came to hand out a link to the demo clinic.
 */
export function clinicSlug(value = '') {
  const raw = String(value ?? '').trim();
  const slug = slugify(raw).slice(0, BOOKING_SLUG_MAX).replace(/-+$/, '');
  // A name with no ASCII letters still gets an address, because the database mints
  // one anyway (`clinic_slug()` falls back to the literal 'clinic'). Nothing at all
  // is different: that is a clinic with no address, and saying so is the point.
  return slug || (raw ? 'clinic' : '');
}

/**
 * The address Settings should offer for a clinic: the saved slug if the database
 * has one, otherwise what the name would become — never the demo clinic's slug.
 */
export function bookingSlugFor(clinic = {}) {
  const saved = clinicSlug(clinic.slug ?? '');
  if (saved) return saved;
  return clinicSlug(clinic.name ?? '');
}

export function bookingUrl(slug) {
  const clean = String(slug || '').trim();
  if (typeof window === 'undefined') return `#/book/${clean}`;
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#/book/${clean}`;
}

export function manageUrl(ref) {
  if (typeof window === 'undefined') return `#/booking/${ref}`;
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#/booking/${ref}`;
}

/** Digits only — how a phone number is stored and compared. */
export function normalizePhone(value) {
  return String(value || '').replace(/[^\d]/g, '');
}

/**
 * The days a patient may choose from, starting today.
 * `count` is capped at the clinic's horizon so a link cannot be used to probe
 * a year of the diary.
 */
export function bookingDays({ from = today(), count = BOOKING_HORIZON_DAYS } = {}) {
  const total = Math.max(1, Math.min(Number(count) || BOOKING_HORIZON_DAYS, 60));
  return Array.from({ length: total }, (_, i) => {
    const iso = addDays(from, i);
    const date = new Date(`${iso}T12:00:00`);
    return {
      iso,
      day: date.getDate(),
      weekday: date.toLocaleDateString('en-IN', { weekday: 'short' }),
      month: date.toLocaleDateString('en-IN', { month: 'short' }),
      isToday: i === 0,
      isTomorrow: i === 1,
    };
  });
}

/**
 * Slots for one doctor on one day, with the past removed.
 *
 * `busy` is what the database hands over online: [{ iso, at: 'HH:MM', minutes }].
 * The demo passes appointments instead, and they are folded into the same shape
 * so the two paths cannot drift.
 */
export function slotsForDay({ doctor, iso, busy = [], now = new Date(), duration = null, clinic = null }) {
  const minutes = Math.max(5, Number(duration || doctor?.slot_minutes || 15));
  const appointments = busy
    .filter((b) => (b.iso ?? b.scheduled_on) === iso)
    .map((b, i) => ({
      id: `busy-${i}`,
      doctor_id: doctor?.id,
      scheduled_on: iso,
      scheduled_at: String(b.at ?? b.scheduled_at ?? '00:00').slice(0, 5),
      duration_minutes: Number(b.minutes ?? b.duration_minutes ?? minutes),
      status: b.status ?? 'booked',
    }));

  const nowIso = isoDate(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const earliest = iso === nowIso ? nowMinutes + BOOKING_LEAD_MINUTES : 0;

  // The patient sees exactly what the desk sees: both of the clinic's sessions,
  // the doctor's own window inside one of them, and no slots at all on a day the
  // clinic or that doctor is closed.
  return availableSlots({ appointments, doctor, iso, duration: minutes, clinic })
    .filter((slot) => slot.start >= earliest)
    .map((slot) => ({ time: slot.time, start: slot.start, end: slot.end, free: slot.free }));
}

/** Slots grouped into Morning / Afternoon / Evening, empty groups dropped. */
export function groupedSlots(slots) {
  return groupSlots(slots.filter((s) => s.free));
}

/** The first day in the horizon that has at least one free slot. */
export function firstOpenDay({ doctor, days, busy, now = new Date() }) {
  for (const day of days) {
    const slots = slotsForDay({ doctor, iso: day.iso, busy, now });
    if (slots.some((s) => s.free)) return day.iso;
  }
  return null;
}

/** Free-slot count per day, for the "3 slots" hint under each date chip. */
export function availabilityByDay({ doctor, days, busy, now = new Date(), clinic = null }) {
  const map = new Map();
  for (const day of days) {
    const slots = slotsForDay({ doctor, iso: day.iso, busy, now, clinic });
    map.set(day.iso, slots.filter((s) => s.free).length);
  }
  return map;
}

/* --------------------------------------------------------------- validation */

export const REF_REASON_MAX = 120;

export function validateBooking({ name = '', phone = '', reason = '' } = {}) {
  const errors = {};
  const cleanName = String(name).trim().replace(/\s+/g, ' ');
  if (cleanName.length < 2) errors.name = 'Tell us the patient’s name.';
  else if (cleanName.length > 80) errors.name = 'That name is too long.';

  const digits = normalizePhone(phone);
  if (!digits) errors.phone = 'A mobile number is needed to confirm the appointment.';
  else if (digits.length === 10) { /* Indian mobile, no country code */ }
  else if (digits.length === 12 && digits.startsWith('91')) { /* +91 … */ }
  else if (digits.length === 11 && digits.startsWith('0')) { /* 0… */ }
  else errors.phone = 'Enter a 10-digit mobile number.';

  if (String(reason).length > REF_REASON_MAX) errors.reason = `Keep it under ${REF_REASON_MAX} characters.`;

  return errors;
}

/** A reference a human can read out loud: BK-4K7P2Q. No vowel-less noise. */
export function makeBookingRef(random = Math.random) {
  const alphabet = 'ACDEFGHJKLMNPQRTUVWXY2346789';   // no 0/O/1/I/B/S/5 to avoid dictation errors
  let out = '';
  for (let i = 0; i < 6; i += 1) out += alphabet[Math.floor(random() * alphabet.length)];
  return `BK-${out}`;
}

export function isBookingRef(value) {
  return /^BK-[ACDEFGHJKLMNPQRTUVWXY2346789]{6}$/.test(String(value || '').trim().toUpperCase());
}

/** Normalise what a patient typed or pasted into a link. */
export function cleanRef(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

/* ------------------------------------------------------------ lead sources */

export const LEAD_SOURCES = [
  { id: 'walk-in', label: 'Walk-in' },
  { id: 'phone', label: 'Phone call' },
  { id: 'online', label: 'Booked online' },
  { id: 'referral', label: 'Referral' },
];

/**
 * Where the diary came from this month. Used by Reports and by the dashboard's
 * booking card; `share` is 0..1 so the bar list can render it directly.
 */
export function leadSourceMix({ appointments = [], month }) {
  const list = appointments.filter((a) => String(a.scheduled_on || '').startsWith(month));
  const buckets = new Map();
  for (const appt of list) {
    const id = LEAD_SOURCES.some((s) => s.id === appt.source) ? appt.source : 'walk-in';
    buckets.set(id, (buckets.get(id) ?? 0) + 1);
  }
  const total = list.length || 1;
  return LEAD_SOURCES
    .map((source) => ({ ...source, count: buckets.get(source.id) ?? 0, share: (buckets.get(source.id) ?? 0) / total }))
    .sort((a, b) => b.count - a.count);
}

/* ------------------------------------------------------------------- demo */

function readDemoWorkspace() {
  try {
    const raw = globalThis.localStorage?.getItem(DEMO_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed?.clinic) return parsed;
  } catch { /* private mode */ }
  const fresh = makeDemoWorkspace();
  writeDemoWorkspace(fresh);
  return fresh;
}

function writeDemoWorkspace(next) {
  try {
    globalThis.localStorage?.setItem(DEMO_KEY, JSON.stringify(next));
    // The app shell reads this same key. If a patient books in a tab the desk
    // already has open, the store listens for this and re-reads — otherwise a
    // booking would sit in localStorage until someone reloaded.
    globalThis.window?.dispatchEvent(new Event('myclinic:demowrite'));
  } catch { /* quota / private mode */ }
}

const publicDoctor = (d) => ({
  id: d.id,
  full_name: d.full_name,
  specialty: d.specialty,
  qualification: d.qualification,
  fee_paise: d.fee_paise,
  follow_up_fee_paise: d.follow_up_fee_paise,
  day_start: d.day_start,
  day_end: d.day_end,
  slot_minutes: d.slot_minutes,
  color: d.color,
});

function demoProfile(slug) {
  const ws = readDemoWorkspace();
  const clinic = ws.clinic;
  if (!clinic || clinic.slug !== slug) return null;
  if (clinic.booking_enabled === false) {
    return { enabled: false, clinic: { name: clinic.name, phone: clinic.phone, address: clinic.address }, doctors: [] };
  }
  return {
    enabled: true,
    clinic: {
      name: clinic.name,
      slug: clinic.slug,
      clinic_type: clinic.clinic_type,
      address: clinic.address,
      phone: clinic.phone,
      brand_color: clinic.brand_color,
      booking_note: clinic.booking_note ?? '',
      booking_horizon_days: clinic.booking_horizon_days ?? BOOKING_HORIZON_DAYS,
    },
    doctors: (ws.staff ?? []).filter((s) => s.role !== 'frontdesk' && s.active !== false).map(publicDoctor),
  };
}

function demoBusy(slug, doctorId) {
  const ws = readDemoWorkspace();
  const horizon = addDays(today(), (ws.clinic?.booking_horizon_days ?? BOOKING_HORIZON_DAYS) + 1);
  return (ws.appointments ?? [])
    .filter((a) => a.doctor_id === doctorId && a.scheduled_on >= today() && a.scheduled_on <= horizon
      && !['cancelled', 'no-show'].includes(a.status))
    .map((a) => ({ iso: a.scheduled_on, at: a.scheduled_at, minutes: a.duration_minutes ?? 15 }));
}

function demoBook({ slug, doctorId, iso, time, name, phone, reason, clientId }) {
  const ws = readDemoWorkspace();
  if (!ws.clinic || ws.clinic.slug !== slug) throw new Error('This clinic is not taking online bookings.');
  if (ws.clinic.booking_enabled === false) throw new Error('This clinic is not taking online bookings.');

  const doctor = (ws.staff ?? []).find((s) => s.id === doctorId && s.role !== 'frontdesk');
  if (!doctor) throw new Error('That doctor is not available.');
  if (iso < today()) throw new Error('That date has passed.');

  const minutes = Number(doctor.slot_minutes || 15);
  const digits = normalizePhone(phone);
  const patientByPhone = (ws.patients ?? []).find((p) => normalizePhone(p.phone) === digits);
  const patientName = (id) => (ws.patients ?? []).find((p) => p.id === id);

  // The order of these refusals matches the database's (see public_book in
  // supabase/schema.sql) so the two paths cannot disagree about what a patient is
  // told when they tap twice.
  //
  // 1. One live appointment per patient per doctor per day: a repeat tap on the
  //    same slot hands back the reference already issued rather than a second row.
  if (patientByPhone) {
    const sameDay = (ws.appointments ?? []).find((a) => a.doctor_id === doctor.id
      && a.scheduled_on === iso && a.status === 'booked'
      && a.patient_id === patientByPhone.id);
    if (sameDay) {
      // Only the device that made the booking may collect the reference again
      // (schema 17). Anyone else is told that a booking exists and nothing more —
      // the phone number reaches the same row, so it must not become a credential.
      const sameDevice = Boolean(clientId) && sameDay.client_id === clientId;
      if (sameDevice && String(sameDay.scheduled_at).slice(0, 5) === time && sameDay.booking_ref) {
        return {
          ref: sameDay.booking_ref, iso, at: String(sameDay.scheduled_at).slice(0, 5),
          doctor: doctor.full_name, clinic: ws.clinic.name, minutes, duplicate: true,
        };
      }
      const e = new Error(bookingErrorMessage('booking:already'));
      e.code = 'already-booked';
      throw e;
    }
  }

  // 2. The slot itself, judged by the same engine the front desk uses.
  const slot = slotsForDay({ doctor, iso, busy: demoBusy(slug, doctorId), now: new Date() })
    .find((s) => s.time === time && s.free);
  if (!slot) { const e = new Error('That slot was taken a moment ago.'); e.code = 'slot-taken'; throw e; }

  // 3. Flood guards: three online bookings a phone per day, forty a clinic an hour.
  const onlineToday = (ws.appointments ?? []).filter((a) => a.source === 'online'
    && String(a.created_at ?? '').slice(0, 10) === today());
  if (onlineToday.filter((a) => normalizePhone(patientName(a.patient_id)?.phone) === digits
    || a.patient_id === patientByPhone?.id).length >= 3) {
    const e = new Error('Three online bookings from this number today — call the clinic for more.');
    e.code = 'too-many';
    throw e;
  }
  if (onlineToday.length >= 40) {
    const e = new Error('The booking page is busy right now. Try again in a minute, or call the clinic.');
    e.code = 'busy';
    throw e;
  }

  let patient = patientByPhone;
  if (!patient) {
    const seq = (ws.patients ?? []).length + 1;
    patient = {
      id: `pat-online-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
      clinic_id: ws.clinic.id,
      code: `PT-${String(seq).padStart(5, '0')}`,
      full_name: String(name).trim().replace(/\s+/g, ' '),
      phone: String(phone).trim(),
      email: '',
      gender: 'Other',
      dob: null,
      age_years: null,
      blood_group: '',
      address: '',
      city: '',
      emergency_contact: '',
      tags: [],
      allergies: '',
      notes: 'Registered from the online booking page.',
      archived: false,
      created_at: new Date().toISOString(),
    };
    ws.patients = [patient, ...(ws.patients ?? [])];
  }

  const ref = makeBookingRef();
  const appointment = {
    id: `apt-online-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
    clinic_id: ws.clinic.id,
    patient_id: patient.id,
    doctor_id: doctor.id,
    scheduled_on: iso,
    scheduled_at: `${time}:00`.slice(0, 5),
    duration_minutes: minutes,
    kind: 'New consultation',
    status: 'booked',
    reason: String(reason || '').slice(0, REF_REASON_MAX),
    notes: '',
    source: 'online',
    booking_ref: ref,
    // Proof that this device made this booking, so a retried submit can collect
    // the reference again without the phone number becoming a credential.
    client_id: clientId ?? null,
    created_at: new Date().toISOString(),
  };
  ws.appointments = [...(ws.appointments ?? []), appointment];
  writeDemoWorkspace(ws);
  return {
    ref,
    iso,
    at: appointment.scheduled_at,
    doctor: doctor.full_name,
    clinic: ws.clinic.name,
    minutes,
  };
}

function demoLookup(ref) {
  const ws = readDemoWorkspace();
  const appointment = (ws.appointments ?? []).find((a) => a.booking_ref === cleanRef(ref));
  if (!appointment) return null;
  const doctor = (ws.staff ?? []).find((s) => s.id === appointment.doctor_id);
  const patient = (ws.patients ?? []).find((p) => p.id === appointment.patient_id);
  return {
    ref: appointment.booking_ref,
    iso: appointment.scheduled_on,
    at: String(appointment.scheduled_at).slice(0, 5),
    status: appointment.status,
    doctor: doctor?.full_name ?? 'the doctor',
    clinic: ws.clinic?.name ?? 'the clinic',
    phone: ws.clinic?.phone ?? '',
    address: ws.clinic?.address ?? '',
    patient_first: String(patient?.full_name ?? '').split(' ')[0] || 'there',
  };
}

function demoCancel(ref) {
  const ws = readDemoWorkspace();
  const index = (ws.appointments ?? []).findIndex((a) => a.booking_ref === cleanRef(ref));
  if (index < 0) return { cancelled: false, status: 'missing' };
  const appointment = ws.appointments[index];
  if (appointment.status !== 'booked') return { cancelled: false, status: appointment.status };
  if (appointment.scheduled_on < today()) return { cancelled: false, status: 'past' };
  ws.appointments = ws.appointments.map((a, i) => (i === index ? { ...a, status: 'cancelled', cancelled_at: new Date().toISOString() } : a));
  writeDemoWorkspace(ws);
  return { cancelled: true, status: 'cancelled' };
}

/* ------------------------------------------------------------------- live */

const missingSchema = (error) => error && (error.code === 'PGRST202' || error.code === '42883'
  || /could not find the function|does not exist/i.test(error.message ?? ''));

/**
 * The Supabase client is imported lazily, and only when a live call is actually
 * made.
 *
 * `src/lib/supabase.js` reads `import.meta.env`, which exists in the bundle and in
 * Vite but not in Node — a static import here would make this whole module
 * untestable, and would pull the 214 KB client into the public page's first paint.
 * No usable client simply means "use the demo workspace", which is what a demo
 * build wants anyway.
 */
let clientPromise = null;
function client() {
  if (!clientPromise) {
    clientPromise = import('./supabase.js')
      .then((m) => (m.supabaseConfigured && m.supabase ? m.supabase : null))
      .catch(() => null);
  }
  return clientPromise;
}

/* --------------------------------------------------------------------- api */

export const bookingApi = {
  /** 'live' or 'demo' — only used for the "running on the sample clinic" hint. */
  async mode() {
    return (await client()) ? 'live' : 'demo';
  },

  async profile(slug) {
    const live = await client();
    if (!live) return demoProfile(slug);
    const { data, error } = await live.rpc('public_clinic_profile', { p_slug: slug });
    if (error) {
      if (missingSchema(error)) throw new Error('Online booking needs schema 8. Run supabase/schema.sql, then try again.');
      throw error;
    }
    return data;
  },

  async busy(slug, doctorId) {
    const live = await client();
    if (!live) return demoBusy(slug, doctorId);
    const { data, error } = await live.rpc('public_booking_busy', { p_slug: slug, p_doctor: doctorId });
    if (error) throw error;
    return data?.busy ?? [];
  },

  async book(payload) {
    const live = await client();
    if (!live) return demoBook(payload);
    const { data, error } = await live.rpc('public_book', {
      p_slug: payload.slug,
      p_doctor: payload.doctorId,
      p_date: payload.iso,
      p_time: payload.time,
      p_name: payload.name,
      p_phone: payload.phone,
      p_reason: payload.reason ?? '',
      // Schema 17: the reference comes back only to the device that created the
      // booking. A phone number is not an identity, so the database will no
      // longer hand the reference (or the appointment time) to whoever names one.
      p_client: payload.clientId ?? null,
    });
    if (error) throw bookingError(error);
    return data;
  },

  async lookup(ref) {
    const live = await client();
    if (!live) return demoLookup(ref);
    const { data, error } = await live.rpc('public_booking_lookup', { p_ref: cleanRef(ref) });
    if (error) {
      if (missingSchema(error)) throw new Error('Online booking needs schema 8.');
      throw error;
    }
    return data && data.found ? data : null;
  },

  async cancel(ref) {
    const live = await client();
    if (!live) return demoCancel(ref);
    const { data, error } = await live.rpc('public_cancel_booking', { p_ref: cleanRef(ref) });
    if (error) throw error;
    return data;
  },
};

/**
 * A wa.me link the patient sends to themselves: the appointment, the reference and
 * the clinic's number. Contains nothing clinical — the reason is never included.
 */
export function whatsappShare({ phone, clinic, iso, time, doctor, ref }) {
  const text = [
    `Appointment at ${clinic?.name ?? 'the clinic'}`,
    `${dayLabel(iso)} at ${slotLabel(time)}${doctor ? ` with ${doctor}` : ''}`,
    `Reference ${ref}`,
    clinic?.address ? clinic.address : '',
    clinic?.phone ? `Clinic: ${clinic.phone}` : '',
  ].filter(Boolean).join('\n');
  return whatsappLink(phone, text) || `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/**
 * The RPCs refuse with tokens rather than prose — `booking:slot_taken`,
 * `booking:already:16:30` — because the text that ends up in front of a patient is
 * written here, next to the rest of the copy, and not in plpgsql.
 */
export const BOOKING_ERRORS = {
  closed: 'This clinic is not taking online bookings right now.',
  doctor: 'That doctor is not available — pick another.',
  name: 'Enter the patient’s name.',
  phone: 'Enter a 10-digit mobile number.',
  date: 'Pick a date within the days this clinic has opened.',
  slot: 'That time is not one of the doctor’s slots.',
  past: 'That slot has already started — pick a later one.',
  toomany: 'Three online bookings from this number today — call the clinic for more.',
  busy: 'The booking page is busy right now. Try again in a minute, or call the clinic.',
  slot_taken: 'That slot was taken a moment ago.',
  already: 'There is already an appointment for this number with that doctor that day. Call the clinic if you need its reference.',
  dayoff: 'The clinic is closed that day — pick another date.',
  leave: 'That doctor is away that day — pick another date, or another doctor.',
};

export function bookingErrorMessage(message) {
  const raw = String(message ?? '');
  const match = /booking:([a-z_]+)(?::(.+))?/.exec(raw);
  if (!match) return raw || 'Could not book that slot.';
  const [, token, detail] = match;
  // `already` arrives without a time in schema 17. An older database still sends
  // `booking:already:16:30`; the detail is dropped on the floor rather than shown,
  // because it described somebody else's appointment.
  if (token === 'already') return BOOKING_ERRORS.already;
  return BOOKING_ERRORS[token] ?? 'Could not book that slot.';
}

export function bookingError(error) {
  const message = bookingErrorMessage(error?.message);
  const e = new Error(message);
  e.code = /booking:slot_taken|duplicate|unique/i.test(`${error?.message} ${error?.code}`) ? 'slot-taken' : 'failed';
  return e;
}

/** Human description of a booking status on the public pages. */
export function publicStatus(status) {
  switch (status) {
    case 'booked': return { label: 'Confirmed', tone: 'success' };
    case 'checked-in': return { label: 'Checked in', tone: 'info' };
    case 'in-consult': return { label: 'With the doctor', tone: 'info' };
    case 'completed': return { label: 'Completed', tone: 'neutral' };
    case 'cancelled': return { label: 'Cancelled', tone: 'danger' };
    case 'no-show': return { label: 'Missed', tone: 'warn' };
    default: return { label: 'Confirmed', tone: 'neutral' };
  }
}

/** 12-hour label for a slot, e.g. '9:30 am'. */
export function slotLabel(hhmm) {
  const minutes = timeToMinutes(hhmm);
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h24 < 12 ? 'am' : 'pm'}`;
}

/** Date label used on the confirmation card. */
export function dayLabel(iso) {
  if (!iso) return '—';
  const date = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
}
