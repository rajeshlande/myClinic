/**
 * Token issuing policy and attendance — one token per patient per day, and the
 * three states a desk actually has to deal with: not arrived, no show, and the
 * patient who arrives later.
 *
 * Until v1.35.4 `TokenForm.issue()` inserted an appointment with a token number
 * unconditionally, and `queueBoard()` dropped `no-show` tokens from the visible
 * queue. So a patient who was marked "No show" vanished, and when they turned up
 * again the only way to serve them was to issue a *second* token. One rule here
 * closes both halves of that loop: refuse a second number, and offer the existing
 * one back.
 *
 * Nothing here touches the DOM, the network, the clock or React. `now` and the
 * formatted time are always passed in, so a test can pin 14:35 exactly.
 */

import { tokenLabel } from './queue.mjs';
import { timeToMinutes } from './dates.mjs';

/** "Arrived late" is a note marker, not a new status: the schema's six-value
 *  `appointments_status_check` stays exactly as it is. */
export const LATE_MARK = 'Arrived late';
const LATE_RE = /\[Arrived late(?: (\d{2}:\d{2}))?\]/;
const NOTES_LIMIT = 1000; // keep in step with appointments.notes in schema.sql

/** The six things a token can be, in the desk's own words. */
export const ATTENDANCE = Object.freeze([
  { id: 'not-arrived', label: 'Not arrived', tone: 'info' },
  { id: 'waiting', label: 'Waiting', tone: 'warn' },
  { id: 'arrived-late', label: 'Arrived late', tone: 'warn' },
  { id: 'no-show', label: 'No show', tone: 'danger' },
  { id: 'in-room', label: 'In the room', tone: 'accent' },
  { id: 'done', label: 'Done', tone: 'success' },
]);

export function isArrivedLate(appt) {
  return LATE_RE.test(String(appt?.notes ?? ''));
}

/** The time in an existing late marker, or ''. */
export function lateStamp(appt) {
  return LATE_RE.exec(String(appt?.notes ?? ''))?.[1] ?? '';
}

/** Append (or replace) the marker without losing the desk's own notes. */
export function withLateNote(notes = '', at = '') {
  const clean = String(notes ?? '').replace(LATE_RE, '').replace(/\s{2,}/g, ' ').trim();
  const mark = `[${LATE_MARK}${/^\d{2}:\d{2}$/.test(String(at)) ? ` ${at}` : ''}]`;
  return `${clean ? `${clean} ` : ''}${mark}`.slice(0, NOTES_LIMIT);
}

/** A plain-language badge for one token row. */
export function attendanceOf(appt) {
  const find = (id) => ATTENDANCE.find((a) => a.id === id) ?? ATTENDANCE[0];
  if (!appt) return { id: 'none', label: 'No token', tone: 'neutral' };
  if (appt.status === 'cancelled') return { id: 'cancelled', label: 'Cancelled', tone: 'danger' };
  if (appt.status === 'no-show') return find('no-show');
  if (appt.status === 'completed') return find('done');
  if (appt.status === 'in-consult') return find('in-room');
  if (appt.status === 'checked-in') return find(isArrivedLate(appt) ? 'arrived-late' : 'waiting');
  return find('not-arrived'); // 'booked' — has a number, has not checked in
}

/** Every live token a patient holds on one day, lowest number first.
 *  Cancelled tokens do not count: cancelling a mistake must not burn the day. */
export function tokensForPatientOnDay(appointments = [], patientId = '', iso = '') {
  if (!patientId || !iso || !Array.isArray(appointments)) return [];
  return appointments
    .filter((a) => a && a.patient_id === patientId && a.scheduled_on === iso
      && a.token_no && a.status !== 'cancelled')
    .sort((a, b) => Number(a.token_no) - Number(b.token_no));
}

/** The sentence the desk reads instead of a disabled button with no explanation. */
export function duplicateTokenReason(existing, { patientName = 'This patient', doctorName = '' } = {}) {
  if (!existing) return '';
  const list = (existing.all ?? [existing]).map((a) => tokenLabel(a.token_no));
  const numbers = list.join(', ');
  const state = attendanceOf(existing).label.toLowerCase();
  if (list.length > 1) {
    return `${patientName} already has ${list.length} tokens today (${numbers} · the first is ${state}). `
      + `Re-use ${list[0]} — mark them arrived or arrived late instead of issuing another.`;
  }
  const withDoctor = doctorName ? ` with ${doctorName}` : '';
  return `${patientName} already has ${numbers} today${withDoctor} (${state}). `
    + `Re-use that number — mark them arrived or arrived late instead of issuing another.`;
}

/** One call for the whole issuing decision. Returns the refusal, never throws. */
export function tokenIssueCheck({ appointments = [], patientId = '', iso = '', patientName = '', doctorName = '' } = {}) {
  if (!patientId) return { ok: false, code: 'no-patient', existing: null, all: [], count: 0, reason: 'Choose or register a patient first.' };
  if (!iso) return { ok: false, code: 'no-day', existing: null, all: [], count: 0, reason: 'No clinic day selected.' };
  const all = tokensForPatientOnDay(appointments, patientId, iso);
  if (!all.length) return { ok: true, code: 'ok', existing: null, all: [], count: 0, reason: '' };
  const existing = { ...all[0], all };
  return {
    ok: false, code: 'duplicate', existing, all, count: all.length,
    reason: duplicateTokenReason(existing, { patientName: patientName || 'This patient', doctorName }),
  };
}

/** How late is late? A slot has fully elapsed plus a grace period. */
export function isPastSlot(appt, nowMinutes = null, graceMinutes = 15) {
  if (typeof nowMinutes !== 'number' || !Number.isFinite(nowMinutes)) return false;
  const slot = timeToMinutes(appt?.scheduled_at);
  const duration = Number(appt?.duration_minutes ?? 15);
  return nowMinutes > slot + duration + graceMinutes;
}

/**
 * The patch that puts an existing token back in the queue. A no-show is always
 * late (they are coming back after being marked absent); a booked token past its
 * slot is late automatically; the desk can also force it with `forceLate`.
 */
export function arrivalPatch(appt, { at = '', nowMinutes = null, graceMinutes = 15, forceLate = false } = {}) {
  const late = forceLate || appt?.status === 'no-show' || isArrivedLate(appt)
    || isPastSlot(appt, nowMinutes, graceMinutes);
  return {
    status: 'checked-in',
    notes: late ? withLateNote(appt?.notes, at) : String(appt?.notes ?? ''),
  };
}

export function noShowPatch() {
  return { status: 'no-show' };
}

/** Counts for the queue header — still no DOM, still no clock. */
export function attendanceCounts(appointments = [], iso = '') {
  const counts = { 'not-arrived': 0, waiting: 0, 'arrived-late': 0, 'no-show': 0, 'in-room': 0, done: 0 };
  if (!Array.isArray(appointments)) return counts;
  for (const appt of appointments) {
    if (!appt || appt.scheduled_on !== iso || !appt.token_no || appt.status === 'cancelled') continue;
    const id = attendanceOf(appt).id;
    if (id in counts) counts[id] += 1;
  }
  return counts;
}
