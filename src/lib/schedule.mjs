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
 * inside working hours AND touches no existing booking.
 */
export function availableSlots({ appointments = [], doctor, iso, duration = 15, step = null }) {
  const open = mins(doctor?.day_start || '09:00');
  const close = mins(doctor?.day_end || '13:00');
  const stride = Math.max(5, Number(step) || Number(doctor?.slot_minutes) || duration || 15);
  const booked = appointments
    .filter((a) => a.doctor_id === doctor?.id && a.scheduled_on === iso && !DEAD_STATUSES.includes(a.status))
    .map((a) => intervalOf(a));

  const all = [];
  for (let t = open; t + duration <= close; t += stride) all.push(t);

  return all.map((start) => {
    const end = start + duration;
    const blocking = booked.find((b) => start < b.end && b.start < end);
    return { time: time(start), start, end, free: !blocking, blockedBy: blocking ?? null };
  });
}

/** Group slots into the sessions a front desk actually talks about. */
export function groupSlots(slots, { afternoonFrom = '12:00', eveningFrom = '17:00' } = {}) {
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
export function nextFreeSlot({ appointments = [], doctor, iso, duration = 15, from = 0 }) {
  const list = availableSlots({ appointments, doctor, iso, duration });
  return list.find((s) => s.free && s.start >= from) ?? null;
}

/**
 * Suggest the earliest bookable slot across doctors.
 * Used by the "Next free" button and by the new-appointment form's default time.
 */
export function suggestNext({ doctors = [], appointments = [], iso = today(), duration = 15, doctorId = null, from = 0 }) {
  const pool = doctorId && doctorId !== 'all' ? doctors.filter((d) => d.id === doctorId) : doctors;
  let best = null;
  for (const doctor of pool) {
    const slot = nextFreeSlot({ appointments, doctor, iso, duration, from });
    if (slot && (!best || slot.start < best.start)) best = { ...slot, doctor_id: doctor.id };
  }
  return best;
}

/** Minutes of the day for "now", or 0 when the date is not today. */
export function nowMinutes(iso, now = new Date()) {
  if (iso !== today()) return 0;
  return now.getHours() * 60 + now.getMinutes();
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
      const passed = iso < today() || (iso === today() && slot.end <= nowM);
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
  const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const todayIso = isoOf(now);
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

/** Copy an appointment into a reschedule draft, keeping everything but the slot. */
export function rescheduleDraft(appointment) {
  return { ...appointment, id: appointment.id, scheduled_at: appointment.scheduled_at, rescheduled_from: appointment.scheduled_at };
}
