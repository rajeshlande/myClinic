/**
 * Appointments: the status vocabulary, slot generation and the day's list.
 *
 * Split out of `logic.mjs` in v1.29.0.
 */

import { localISO, minutesToTime, timeToMinutes, today } from './dates.mjs';

export const APPOINTMENT_STATUS = [
  { id: 'booked', label: 'Booked', tone: 'neutral' },
  { id: 'checked-in', label: 'Checked in', tone: 'info' },
  { id: 'in-consult', label: 'In consult', tone: 'accent' },
  { id: 'completed', label: 'Completed', tone: 'success' },
  { id: 'cancelled', label: 'Cancelled', tone: 'danger' },
  { id: 'no-show', label: 'No show', tone: 'warn' },
];

export const APPOINTMENT_TYPES = ['New consultation', 'Follow-up', 'Procedure', 'Teleconsultation', 'Report review'];

export const statusMeta = (id) => APPOINTMENT_STATUS.find((s) => s.id === id) ?? APPOINTMENT_STATUS[0];

/** Generates bookable slots for a doctor's working day, skipping taken slots. */

export function generateSlots({ start = '09:00', end = '13:00', duration = 15, gap = 0 } = {}) {
  const slots = [];
  const step = Math.max(5, duration + gap);
  for (let t = timeToMinutes(start); t + duration <= timeToMinutes(end); t += step) {
    slots.push(minutesToTime(t));
  }
  return slots;
}

export function sortAppointments(list, dir = 'asc') {
  return [...list].sort((a, b) => {
    const cmp = `${a.scheduled_on}${a.scheduled_at}`.localeCompare(`${b.scheduled_on}${b.scheduled_at}`);
    return dir === 'asc' ? cmp : -cmp;
  });
}

export function appointmentsForDate(appointments, iso, doctorId = 'all') {
  return sortAppointments(appointments.filter((a) => a.scheduled_on === iso && (doctorId === 'all' || a.doctor_id === doctorId)));
}

/** Slot availability for a date: taken slots plus suggested next free slot. */

export function slotAvailability({ appointments, doctor, iso, duration = 15 }) {
  const taken = new Set(appointments.filter((a) => a.doctor_id === doctor.id && a.scheduled_on === iso && a.status !== 'cancelled').map((a) => a.scheduled_at));
  const all = generateSlots({ start: doctor.day_start || '09:00', end: doctor.day_end || '13:00', duration });
  const free = all.filter((s) => !taken.has(s));
  return { all, taken, free, next: free.find((s) => iso > today() || timeToMinutes(s) >= timeToMinutes(localISO() === iso ? new Date().toTimeString().slice(0, 5) : '00:00')) ?? null };
}

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

export function appointmentMatchesQuery(appointment, patients = [], query = '') {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const patient = patients.find((p) => p.id === appointment.patient_id);
  return [patient?.full_name, patient?.phone, patient?.code, appointment.reason, appointment.scheduled_on, appointment.kind]
    .filter(Boolean).join(' ').toLowerCase().includes(q);
}

/** Effective fee for an appointment kind, honouring follow-up pricing. */
