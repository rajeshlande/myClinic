/**
 * The token queue: numbers, waits and the per-doctor board.
 *
 * Split out of `logic.mjs` in v1.29.0.
 */

import { today } from './dates.mjs';

export function nextTokenNo(appointments, doctorId, iso = today()) {
  const used = appointments
    .filter((a) => a.doctor_id === doctorId && a.scheduled_on === iso && a.token_no)
    .map((a) => Number(a.token_no));
  return (used.length ? Math.max(...used) : 0) + 1;
}

export function tokenLabel(n) {
  return n ? `T-${String(n).padStart(2, '0')}` : 'T-—';
}

/**
 * How many patients may be in a consulting room with one doctor at once.
 *
 * The board used to return exactly one `serving` per doctor while "Call next"
 * flipped a second token to `in-consult` unconditionally — so the data could hold
 * two people in the room and every screen showed only one. One constant, one gate.
 */
export const ROOM_LIMIT = 2;

/** Is there a free seat for the next token? */
export function canCallNext(inRoom = []) {
  return (Array.isArray(inRoom) ? inRoom.length : 0) < ROOM_LIMIT;
}

/** Why a third patient cannot be called in, in the desk's own words. */
export function roomFullMessage(inRoom = []) {
  const people = (Array.isArray(inRoom) ? inRoom : []).filter(Boolean);
  if (canCallNext(people)) return '';
  const labels = people.map((a) => tokenLabel(a.token_no));
  const joined = labels.length === 2 ? `${labels[0]} and ${labels[1]}`
    : labels.length > 2 ? `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
      : labels[0] ?? '';
  return `Room is full — ${joined} ${labels.length === 1 ? 'is' : 'are'} already in the room. Mark one as seen before calling another.`;
}

/**
 * The two seats as the desk sees them: the first is talking, everyone after is
 * waiting inside the room (shown smaller). Kept pure so the labels and the
 * ordering cannot drift between the board, the display and the dashboard.
 */
export function roomSeats(inRoom = []) {
  return (Array.isArray(inRoom) ? inRoom : []).filter(Boolean).map((appt, index) => ({
    appt,
    index,
    primary: index === 0,
    label: index === 0 ? 'Talking' : 'Waiting in room',
    tone: index === 0 ? 'accent' : 'warn',
  }));
}

/** Minutes a patient has been waiting, from their issue/check-in time. */

export function waitedMinutes(appointment, now = new Date()) {
  if (!appointment?.scheduled_on) return 0;
  const [h, m] = String(appointment.scheduled_at || '00:00').split(':').map(Number);
  const at = new Date(`${appointment.scheduled_on}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`);
  return Math.max(0, Math.round((now - at) / 60000));
}

export function humanWait(mins) {
  if (!Number.isFinite(mins) || mins < 0) return '—';
  if (mins < 1) return 'just now';
  if (mins > 240) return '4 h +';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/**
 * Front-desk board: for every doctor, who is in the room, who is next and who
 * is still waiting. Only records carrying a token are part of the queue.
 */

export function queueBoard({ appointments = [], patients = [], doctors = [], iso = today(), doctorId = 'all', now = new Date() }) {
  const nameOf = (id) => patients.find((p) => p.id === id)?.full_name ?? 'Patient';
  const day = appointments.filter((a) => a.scheduled_on === iso && a.status !== 'cancelled');
  const list = doctors
    .filter((d) => d.role !== 'frontdesk')
    .filter((d) => doctorId === 'all' || d.id === doctorId)
    .map((doctor) => {
      const mine = day.filter((a) => a.doctor_id === doctor.id);
      const byToken = (a, b) => (Number(a.token_no) || 999) - (Number(b.token_no) || 999) || String(a.scheduled_at).localeCompare(String(b.scheduled_at));
      const inRoom = mine.filter((a) => a.status === 'in-consult' && a.token_no).sort(byToken);
      const serving = inRoom[0] ?? null;   // kept: every older reader uses this one
      const called = mine.filter((a) => a.status === 'checked-in' && a.token_no).sort(byToken);
      const booked = mine.filter((a) => a.status === 'booked' && a.token_no).sort(byToken);
      const done = mine.filter((a) => a.status === 'completed' && a.token_no);
      return {
        doctor,
        serving,
        inRoom,
        roomCount: inRoom.length,
        roomLimit: ROOM_LIMIT,
        canCallNext: canCallNext(inRoom),
        roomFull: roomFullMessage(inRoom),
        seats: roomSeats(inRoom),
        next: called[0] ?? null,
        waiting: [...called, ...booked],
        done: done.length,
        completed: done.sort(byToken),
        issued: mine.filter((a) => a.token_no).length,
        nextToken: nextTokenNo(appointments, doctor.id, iso),
        label: (a) => nameOf(a?.patient_id),
      };
    });
  const waiting = list.reduce((t, d) => t + d.waiting.length, 0);
  const withToken = day.filter((a) => a.token_no);
  const inRoomNow = list.reduce((t, d) => t + d.inRoom.length, 0);
  return {
    rows: list,
    totals: {
      issued: withToken.length,
      waiting,
      serving: inRoomNow,   // people in the room across every doctor, not doctors
      inRoom: inRoomNow,
      done: withToken.filter((a) => a.status === 'completed').length,
      tokensLeft: withToken.filter((a) => ['booked', 'checked-in'].includes(a.status)).length,
    },
  };
}

/** Plain-language status for a token row. */

export function queueState(appointment, doctor) {
  if (!appointment) return { id: 'none', label: 'No token', tone: 'neutral' };
  if (appointment.status === 'in-consult') return { id: 'serving', label: 'In the room', tone: 'accent' };
  if (appointment.status === 'checked-in') return { id: 'called', label: 'Waiting', tone: 'warn' };
  if (appointment.status === 'completed') return { id: 'done', label: 'Done', tone: 'success' };
  if (appointment.status === 'no-show') return { id: 'missed', label: 'No show', tone: 'danger' };
  return { id: 'booked', label: 'Not arrived', tone: 'info' };
}

/** Average wait across tokens that were actually served today. */

export function averageWait(consultations = [], appointments = [], iso = today()) {
  const waits = consultations
    .filter((c) => c.visited_on === iso)
    .map((c) => {
      const appt = appointments.find((a) => a.id === c.appointment_id);
      if (!appt?.token_no || !appt.scheduled_at) return null;
      const [h, m] = String(appt.scheduled_at).split(':').map(Number);
      const arrived = new Date(`${iso}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).getTime();
      const seen = new Date(c.created_at ?? `${iso}T${appt.scheduled_at}:00`).getTime();
      const mins = Math.round((seen - arrived) / 60000);
      return mins >= 0 && mins < 300 ? mins : null;
    })
    .filter((v) => v != null);
  if (!waits.length) return null;
  return Math.round(waits.reduce((t, v) => t + v, 0) / waits.length);
}
