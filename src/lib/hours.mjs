/**
 * Clinic and doctor working hours.
 *
 * A clinic day is not one long window. A doctor who sits 9 AM–1 PM and again
 * 6 PM–10 PM has two sessions with a closed shutter in between, and an app that
 * models the day as `open_time`–`close_time` will happily book 2 PM in an empty
 * clinic. So hours are a list: **at most two sessions**, each a start and an end.
 *
 * A doctor may sit only one of their clinic's sessions — the morning doctor is
 * not available in the evening, and the evening doctor is not available in the
 * morning. Their sessions must sit *inside* the clinic's, which is what
 * `validateDoctorSessions` enforces before the save reaches Postgres.
 *
 * Days off are per clinic and per doctor, as weekday numbers (0 = Sunday) plus
 * one-off dates (a holiday, a conference, a family function).
 *
 * Pure functions only: no React, no Supabase, so the slot engine, the public
 * booking page, the settings screen and the tests all read the same rules.
 */

export const MAX_SESSIONS = 2;
export const MIN_SESSION_MINUTES = 15;

/** Where schema 12 and every form agree a follow-up stays valid. */
export const FOLLOW_UP_MIN_DAYS = 3;
export const FOLLOW_UP_MAX_DAYS = 45;
export const FOLLOW_UP_DEFAULT_DAYS = 15;

/** 0 is Sunday, to match JavaScript's getUTCDay() and the database's smallint[]. */
export const WEEKDAYS = [
  { id: 0, short: 'Sun', label: 'Sunday' },
  { id: 1, short: 'Mon', label: 'Monday' },
  { id: 2, short: 'Tue', label: 'Tuesday' },
  { id: 3, short: 'Wed', label: 'Wednesday' },
  { id: 4, short: 'Thu', label: 'Thursday' },
  { id: 5, short: 'Fri', label: 'Friday' },
  { id: 6, short: 'Sat', label: 'Saturday' },
];

export const weekdayLabel = (id) => WEEKDAYS.find((d) => d.id === Number(id))?.label ?? '';

/** 'HH:MM' (or 'HH:MM:SS' from Postgres `time`) → minutes past midnight. */
export function minutesOf(hhmm) {
  const m = String(hhmm ?? '').slice(0, 5).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Minutes past midnight → 'HH:MM'. */
export function clockOf(minutes) {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(Number(minutes) || 0)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** 'HH:MM' → '9:00 AM'. Blank stays blank rather than printing 12:00 AM. */
export function prettyTime(hhmm) {
  const m = minutesOf(hhmm);
  if (m == null) return '';
  const h24 = Math.floor(m / 60);
  const min = m % 60;
  const suffix = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(min).padStart(2, '0')} ${suffix}`;
}

/**
 * Turn whatever the database or a form handed us into a clean, ordered list of
 * sessions. Tolerates jsonb rows, JS objects and plain strings; silently drops
 * anything unreadable so a half-typed form can never blank a clinic's hours.
 */
export function normaliseSessions(input, { openTime = null, closeTime = null } = {}) {
  const raw = Array.isArray(input) ? input : [];
  const cleaned = [];
  for (const item of raw) {
    const source = typeof item === 'string' ? { start: item } : (item ?? {});
    const start = minutesOf(source.start ?? source.from ?? source.open ?? source[0]);
    const end = minutesOf(source.end ?? source.to ?? source.close ?? source[1]);
    if (start == null || end == null || end <= start) continue;
    cleaned.push({ start: clockOf(start), end: clockOf(end) });
  }
  cleaned.sort((a, b) => minutesOf(a.start) - minutesOf(b.start));
  const trimmed = cleaned.slice(0, MAX_SESSIONS);
  if (trimmed.length) return trimmed;
  // Nothing usable: fall back to the legacy single pair, which is what every
  // clinic created before schema 12 still carries.
  const open = minutesOf(openTime);
  const close = minutesOf(closeTime);
  if (open != null && close != null && close > open) return [{ start: clockOf(open), end: clockOf(close) }];
  return [];
}

/** The clinic's sessions: its own list, else the legacy open/close pair. */
export function clinicSessions(clinic) {
  return normaliseSessions(clinic?.sessions, { openTime: clinic?.open_time, closeTime: clinic?.close_time });
}

/**
 * A doctor's sessions. Three cases, in order:
 *  1. the doctor has their own list → that is their day;
 *  2. the doctor has only the legacy `day_start`/`day_end` pair → that pair;
 *  3. neither → they inherit the clinic's sessions.
 */
export function doctorSessions(doctor, clinic) {
  const own = normaliseSessions(doctor?.sessions);
  if (own.length) return own;
  const legacy = normaliseSessions(null, { openTime: doctor?.day_start, closeTime: doctor?.day_end });
  if (legacy.length) return legacy;
  return clinicSessions(clinic);
}

/** '9:00 AM – 1:00 PM · 6:00 PM – 10:00 PM'. Empty when there are no sessions. */
export function sessionsSummary(sessions = []) {
  return normaliseSessions(sessions).map((s) => `${prettyTime(s.start)} – ${prettyTime(s.end)}`).join(' · ');
}

export function sessionMinutes(session) {
  const start = minutesOf(session?.start);
  const end = minutesOf(session?.end);
  if (start == null || end == null) return 0;
  return Math.max(0, end - start);
}

export function totalOpenMinutes(sessions = []) {
  return normaliseSessions(sessions).reduce((sum, s) => sum + sessionMinutes(s), 0);
}

/**
 * Validate a session list before it is saved.
 * @returns {{ ok: boolean, error: string, sessions: Array<{start:string,end:string}> }}
 */
export function validateSessions(input, { label = 'Working hours', max = MAX_SESSIONS } = {}) {
  const raw = Array.isArray(input) ? input : [];
  if (!raw.length) return { ok: false, error: `${label}: add at least one session, for example 9:00 AM – 1:00 PM.`, sessions: [] };
  if (raw.length > max) return { ok: false, error: `${label}: at most ${max} sessions a day.`, sessions: [] };

  const parsed = [];
  for (const item of raw) {
    const start = minutesOf(item?.start);
    const end = minutesOf(item?.end);
    if (start == null || end == null) return { ok: false, error: `${label}: every session needs a start and an end time.`, sessions: [] };
    if (end <= start) return { ok: false, error: `${label}: ${prettyTime(clockOf(start))} – ${prettyTime(clockOf(end))} ends before it starts.`, sessions: [] };
    if (end - start < MIN_SESSION_MINUTES) return { ok: false, error: `${label}: a session must be at least ${MIN_SESSION_MINUTES} minutes long.`, sessions: [] };
    parsed.push({ start: clockOf(start), end: clockOf(end) });
  }

  parsed.sort((a, b) => minutesOf(a.start) - minutesOf(b.start));
  for (let i = 1; i < parsed.length; i += 1) {
    if (minutesOf(parsed[i].start) < minutesOf(parsed[i - 1].end)) {
      return { ok: false, error: `${label}: ${prettyTime(parsed[i - 1].start)} – ${prettyTime(parsed[i - 1].end)} overlaps ${prettyTime(parsed[i].start)} – ${prettyTime(parsed[i].end)}.`, sessions: parsed };
    }
  }
  return { ok: true, error: '', sessions: parsed };
}

/** Does a doctor's window sit inside one of the clinic's sessions? */
export function withinClinicSessions(sessions, clinicHours) {
  const clinic = normaliseSessions(clinicHours);
  const mine = normaliseSessions(sessions);
  if (!clinic.length || !mine.length) return true;
  return mine.every((s) => {
    const start = minutesOf(s.start);
    const end = minutesOf(s.end);
    return clinic.some((c) => start >= minutesOf(c.start) && end <= minutesOf(c.end));
  });
}

/**
 * A doctor may sit one of the clinic's sessions, or part of one — never a window
 * that spans the closed shutter between two sessions.
 */
export function validateDoctorSessions(sessions, clinicHours, { label = 'Doctor hours' } = {}) {
  const base = validateSessions(sessions, { label });
  if (!base.ok) return base;
  if (!withinClinicSessions(base.sessions, clinicHours)) {
    const clinic = sessionsSummary(clinicHours);
    return {
      ok: false,
      error: `${label}: ${sessionsSummary(base.sessions)} is outside the clinic's hours${clinic ? ` (${clinic})` : ''}. A doctor sits inside one of the clinic's sessions, not across the break.`,
      sessions: base.sessions,
    };
  }
  return base;
}

/** 'YYYY-MM-DD' → 0..6 (Sunday = 0), computed in UTC so a timezone cannot shift the day. */
export function weekdayIndex(iso) {
  const m = String(iso ?? '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d.getUTCDay();
}

/** Weekday numbers → clean, unique, 0..6, sorted. */
export function normaliseWeekdays(input) {
  const list = Array.isArray(input) ? input : [];
  const out = [...new Set(list.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))];
  return out.sort((a, b) => a - b);
}

/** 'YYYY-MM-DD' dates → clean, unique, sorted. */
export function normaliseDates(input) {
  const list = Array.isArray(input) ? input : [];
  const out = [...new Set(list.map((d) => String(d ?? '').slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))];
  return out.sort();
}

/**
 * Is this date a day off? Weekdays repeat; holiday dates are one-offs.
 * @returns {{ closed: boolean, reason: string }}
 */
export function closure(iso, { closedWeekdays, closedDates, closed_weekdays, closed_dates } = {}) {
  // Both spellings are accepted: the database row is snake_case, the callers that
  // build their own object use camelCase, and mixing them up must not silently
  // reopen a clinic on the day it is shut.
  const days = normaliseWeekdays(closedWeekdays ?? closed_weekdays);
  const dates = normaliseDates(closedDates ?? closed_dates);
  const day = weekdayIndex(iso);
  if (day == null) return { closed: false, reason: '' };
  if (dates.includes(String(iso).slice(0, 10))) return { closed: true, reason: 'Holiday' };
  if (days.includes(day)) return { closed: true, reason: `Closed on ${weekdayLabel(day)}s` };
  return { closed: false, reason: '' };
}

/**
 * A doctor's day off: their own weekdays and dates, plus the clinic's closures —
 * the clinic being shut closes it for everyone.
 */
export function clinicClosed(iso, clinic) {
  return closure(iso, { closedWeekdays: clinic?.closed_weekdays, closedDates: clinic?.closed_dates });
}

export function doctorClosed(iso, doctor, clinic) {
  const atClinic = clinicClosed(iso, clinic);
  if (atClinic.closed) return atClinic;
  const own = closure(iso, {
    closedWeekdays: doctor?.closed_weekdays,
    closedDates: doctor?.closed_dates,
  });
  if (own.closed) return { closed: true, reason: own.reason === 'Holiday' ? `${doctor?.full_name ?? 'This doctor'} is on leave` : `${doctor?.full_name ?? 'This doctor'} is off on ${weekdayLabel(weekdayIndex(iso))}s` };
  return { closed: false, reason: '' };
}

/** Cap a typed follow-up value into 3–45 and say whether it had to move. */
export function clampFollowUpDays(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return { days: FOLLOW_UP_DEFAULT_DAYS, clamped: true };
  if (n < FOLLOW_UP_MIN_DAYS) return { days: FOLLOW_UP_MIN_DAYS, clamped: true };
  if (n > FOLLOW_UP_MAX_DAYS) return { days: FOLLOW_UP_MAX_DAYS, clamped: true };
  return { days: n, clamped: false };
}

/** @returns {string} an empty string when the value is acceptable. */
export function validateFollowUpDays(value) {
  const n = Number(value);
  if (value === '' || value == null) return 'Enter how many days a follow-up can be booked for.';
  if (!Number.isFinite(n) || !Number.isInteger(n)) return 'Follow-up validity is a whole number of days.';
  if (n < FOLLOW_UP_MIN_DAYS || n > FOLLOW_UP_MAX_DAYS) return `Follow-up validity must be between ${FOLLOW_UP_MIN_DAYS} and ${FOLLOW_UP_MAX_DAYS} days.`;
  return '';
}

/** True when a follow-up visit date still falls inside the clinic's window. */
export function followUpStillValid(visitIso, followUpIso, days = FOLLOW_UP_DEFAULT_DAYS) {
  const from = new Date(`${String(visitIso).slice(0, 10)}T00:00:00Z`).getTime();
  const to = new Date(`${String(followUpIso).slice(0, 10)}T00:00:00Z`).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return false;
  const { days: within } = clampFollowUpDays(days);
  const diff = Math.round((to - from) / 86400000);
  return diff >= 0 && diff <= within;
}
