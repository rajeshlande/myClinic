/**
 * Appointment scheduling engine (pure — no React, no network).
 *
 * The old screen booked everything as fixed 15-minute grid cells, which broke the
 * moment a visit ran 30 minutes: the board showed two free slots where one booking
 * actually occupied both. Everything here works on *intervals* instead:
 *
 *   an appointment occupies [start, start + duration)
 *   a candidate slot is free only when its interval does not intersect any booking
 *
 * Status vocabulary is shared with the rest of the app:
 *   booked · checked-in · in-consult · completed · cancelled · no-show
 */

import { minutesToTime, timeToMinutes, today } from './logic.mjs';
import { clinicClosed, doctorClosed, doctorSessions, normaliseSessions, prettyTime } from './hours.mjs';

export const LIVE_STATUSES = ['checked-in', 'in-consult'];
export const DEAD_STATUSES = ['cancelled', 'no-show'];

/** Minutes since midnight for a time string, tolerant of 'HH:MM:SS'. */
export const mins = (hhmm) => timeToMinutes(String(hhmm || '00:00').slice(0, 5));
/** 'HH:MM' from minutes since midnight. */
export const time = (m) => minutesToTime(m);

/** The interval one appointment occupies. */
export function intervalOf(appointment, fallbackDuration = 15) {
  const start = mins(appointment?.scheduled_at);
  const duration = Math.max(5, Number(appointment?.duration_minutes ?? fallbackDuration) || fallbackDuration);
  return { start, end: start + duration, duration };
}

/** True when two appointments are on the same date and their intervals intersect. */
export function overlaps(a, b, fallback = 15) {
  if (!a || !b || a.scheduled_on !== b.scheduled_on) return false;
  const x = intervalOf(a, fallback);
  const y = intervalOf(b, fallback);
  return x.start < y.end && y.start < x.end;
}

/** Every appointment that clashes with a candidate draft (same doctor, real overlap). */
export function detectClashes(appointments, draft, fallback = 15) {
  return (appointments || []).filter((a) =>
    a.id !== draft.id &&
    a.doctor_id === draft.doctor_id &&
    a.scheduled_on === draft.scheduled_on &&
    !DEAD_STATUSES.includes(a.status) &&
    overlaps(a, draft, fallback),
  );
}

/**
 * All slot start times for a doctor on a date, given a candidate duration.
 * A slot is offered only when the whole [start, start+duration) interval fits
 * inside *one* of the doctor's sessions AND touches no existing booking.
 *
 * `sessions` is the list from hours.mjs (at most two). When it is absent the
 * legacy single `day_start`–`day_end` pair is used, so a database that has not
 * been migrated to schema 12 behaves exactly as before.
 *
 * `closed` (or the closure arguments) is a day off: the day yields no slots at
 * all, and `reason` says why — the desk needs "Closed on Sundays", not an empty
 * column that looks like a bug.
 */
export function availableSlots({
  appointments = [], doctor, iso, duration = 15, step = null,
  sessions = null, closed = false, closedReason = '', clinic = null,
}) {
  const stride = Math.max(5, Number(step) || Number(doctor?.slot_minutes) || duration || 15);
  const hours = sessions?.length
    ? normaliseSessions(sessions)
    : doctorSessions(doctor, clinic);

  // A day off closes the diary for everyone: the clinic's closures apply to every
  // doctor, and a doctor's own leave closes only their column.
  const dayOff = doctor ? doctorClosed(iso, doctor, clinic) : clinicClosed(iso, clinic);
  const shut = closed || dayOff.closed;
  const reason = closedReason || dayOff.reason;
  if (shut || !hours.length) {
    return Object.assign([], { closed: Boolean(shut), reason: shut ? reason : '', sessions: hours });
  }

  const booked = appointments
    .filter((a) => a.doctor_id === doctor?.id && a.scheduled_on === iso && !DEAD_STATUSES.includes(a.status))
    .map((a) => intervalOf(a));

  const all = [];
  for (const session of hours) {
    const open = mins(session.start);
    const close = mins(session.end);
    for (let t = open; t + duration <= close; t += stride) all.push(t);
  }
  all.sort((a, b) => a - b);

  const slots = all.map((start) => {
    const end = start + duration;
    const blocking = booked.find((b) => start < b.end && b.start < end);
    return { time: time(start), start, end, free: !blocking, blockedBy: blocking ?? null };
  });
  return Object.assign(slots, { closed: false, reason: '', sessions: hours });
}

/**
 * Group slots into the sessions a front desk actually talks about. When the
 * clinic's real sessions are known they name the groups ("9 AM – 1 PM"); the
 * morning/afternoon/evening split stays as the fallback.
 */
export function groupSlots(slots, { afternoonFrom = '12:00', eveningFrom = '17:00', sessions = null } = {}) {
  const hours = normaliseSessions(sessions);
  if (hours.length) {
    return hours.map((session) => ({
      id: `session-${session.start}-${session.end}`,
      label: `${prettyTime(session.start)} – ${prettyTime(session.end)}`,
      session,
      slots: slots.filter((s) => s.start >= mins(session.start) && s.end <= mins(session.end)),
    })).filter((g) => g.slots.length);
  }
  const a = mins(afternoonFrom);
  const e = mins(eveningFrom);
  const groups = [
    { id: 'morning', label: 'Morning', slots: [] },
    { id: 'afternoon', label: 'Afternoon', slots: [] },
    { id: 'evening', label: 'Evening', slots: [] },
  ];
  for (const slot of slots) {
    const g = slot.start < a ? groups[0] : slot.start < e ? groups[1] : groups[2];
    g.slots.push(slot);
  }
  return groups.filter((g) => g.slots.length);
}

/** First free slot at or after `from` (minutes), for the "next free" shortcut. */
export function nextFreeSlot({ appointments = [], doctor, iso, duration = 15, from = 0, sessions = null, clinic = null }) {
  const list = availableSlots({ appointments, doctor, iso, duration, sessions, clinic });
  return list.find((s) => s.free && s.start >= from) ?? null;
}

/**
 * Suggest the earliest bookable slot across doctors.
 * Used by the "Next free" button and by the new-appointment form's default time.
 */
export function suggestNext({ doctors = [], appointments = [], iso = today(), duration = 15, doctorId = null, from = 0, clinic = null }) {
  const pool = doctorId && doctorId !== 'all' ? doctors.filter((d) => d.id === doctorId) : doctors;
  let best = null;
  for (const doctor of pool) {
    const slot = nextFreeSlot({ appointments, doctor, iso, duration, from, clinic });
    if (slot && (!best || slot.start < best.start)) best = { ...slot, doctor_id: doctor.id };
  }
  return best;
}

/** Minutes of the day for "now", or 0 when the date is not today. */
/** The local calendar date of a Date, as yyyy-mm-dd (no UTC drift). */
export function isoDate(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Minutes into `iso` at `now`, or 0 when `iso` is not `now`'s day.
 *
 * The clock is always the one passed in: a board built for a given `now` must not
 * consult the wall clock, or the same input produces different output tomorrow
 * (and a test pinned to a date silently flips when that date arrives).
 */
export function nowMinutes(iso, now = new Date()) {
  if (iso !== isoDate(now)) return 0;
  const d = now instanceof Date ? now : new Date(now);
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * The day board: one column per doctor with interval-accurate blocks.
 * Returns { columns, summary } where every slot carries its own state so the
 * component only has to render.
 */
export function buildDayBoard({ doctors = [], appointments = [], iso, now = new Date(), duration = 15 }) {
  const nowM = nowMinutes(iso, now);
  const columns = doctors.map((doctor) => {
    const dayAppts = appointments
      .filter((a) => a.doctor_id === doctor.id && a.scheduled_on === iso && !DEAD_STATUSES.includes(a.status))
      .sort((a, b) => mins(a.scheduled_at) - mins(b.scheduled_at));

    const open = mins(doctor.day_start || '09:00');
    const close = mins(doctor.day_end || '13:00');
    const slots = availableSlots({ appointments, doctor, iso, duration }).map((slot) => {
      const booked = dayAppts.find((a) => intervalOf(a).start === slot.start);
      const nowIso = isoDate(now);
      const passed = iso < nowIso || (iso === nowIso && slot.end <= nowM);
      const state = booked
        ? LIVE_STATUSES.includes(booked.status) ? 'live' : booked.status === 'completed' ? 'done' : 'booked'
        : passed ? 'past' : 'free';
      return { ...slot, state, appointment: booked ?? null };
    });

    // Appointments that do not start on a grid step still need a block.
    const offGrid = dayAppts.filter((a) => !slots.some((s) => s.appointment?.id === a.id));

    const bookedMinutes = dayAppts.reduce((n, a) => n + intervalOf(a).duration, 0);
    const capacity = Math.max(duration, close - open);
    return {
      doctor,
      open,
      close,
      slots,
      offGrid,
      appointments: dayAppts,
      stats: {
        total: dayAppts.length,
        live: dayAppts.filter((a) => LIVE_STATUSES.includes(a.status)).length,
        done: dayAppts.filter((a) => a.status === 'completed').length,
        // free = still bookable today (not past); open = no appointment at all,
        // which is what the week grid reports for any date.
        free: slots.filter((s) => s.state === 'free').length,
        open: slots.filter((s) => !s.appointment).length,
        utilisation: capacity ? Math.min(100, Math.round((bookedMinutes / capacity) * 100)) : 0,
      },
    };
  });

  const all = columns.flatMap((c) => c.appointments);
  const summary = {
    total: all.length,
    booked: all.filter((a) => a.status === 'booked').length,
    live: all.filter((a) => LIVE_STATUSES.includes(a.status)).length,
    done: all.filter((a) => a.status === 'completed').length,
    missed: all.filter((a) => DEAD_STATUSES.includes(a.status)).length,
    utilization: columns.length ? Math.round(columns.reduce((n, c) => n + c.stats.utilisation, 0) / columns.length) : 0,
    nextFree: suggestNext({ doctors, appointments, iso, duration }),
  };
  return { columns, summary, nowMinutes: nowM };
}

/**
 * A compact seven-day load table for the week view.
 * `capacity` is doctor-hours expressed in slots, so a full column reads as 100%.
 */
export function weekLoad({ doctors = [], appointments = [], startIso, days = 7, now = new Date() }) {
  const base = new Date(`${startIso}T12:00:00`);
  // "today" must follow the injected clock, otherwise a caller passing `now`
  // (tests, or a tablet that woke up past midnight) gets the wrong highlight.
  const todayIso = isoDate(now);
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const board = buildDayBoard({ doctors, appointments, iso, now });
    return {
      iso,
      weekday: d.toLocaleDateString('en-IN', { weekday: 'short' }),
      day: d.getDate(),
      isToday: iso === todayIso,
      ...board.summary,
      columns: board.columns,
    };
  });
}

/** Per-doctor load for one week, used in the week grid. */
export function weekByDoctor({ doctors = [], appointments = [], startIso, now = new Date() }) {
  const days = weekLoad({ doctors: [], appointments: [], startIso, days: 7, now }).map((d) => d.iso);
  return doctors.map((doctor) => ({
    doctor,
    cells: days.map((iso) => {
      const board = buildDayBoard({ doctors: [doctor], appointments, iso, now });
      return { iso, ...board.summary, free: board.columns[0]?.stats.open ?? 0 };
    }),
  }));
}

/**
 * Plain-language reason a slot cannot be booked, for inline errors.
 */
export function explainConflict(clash, patientName = 'this patient') {
  if (!clash) return '';
  const { start, end } = intervalOf(clash);
  return `${patientName} already has ${time(start)}–${time(end)} booked with this doctor. Pick another time or a different doctor.`;
}
