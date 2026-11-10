/**
 * The patient's history — visits, frequency, recalls.
 *
 * Split out of `logic.mjs` in v1.29.0.
 */

import { addDays, today } from './dates.mjs';

export function patientSearch(patients, query = '') {
  const q = query.trim().toLowerCase();
  if (!q) return patients;
  const digits = q.replace(/\D/g, '');
  return patients.filter((p) =>
    [p.full_name, p.code, p.phone, p.email, p.city, ...(p.tags || [])].join(' ').toLowerCase().includes(q) ||
    (digits.length >= 4 && String(p.phone || '').replace(/\D/g, '').includes(digits)));
}

export function patientVisits(consultations, patientId) {
  return consultations.filter((c) => c.patient_id === patientId)
    .sort((a, b) => `${b.visited_on}${b.created_at ?? ''}`.localeCompare(`${a.visited_on}${a.created_at ?? ''}`));
}

/** Visits in the trailing `months` window, used for chronic / returning detection. */

export function visitFrequency(consultations, patientId, months = 12) {
  const from = addDays(today(), -Math.round(months * 30.44));
  return consultations.filter((c) => c.patient_id === patientId && c.visited_on >= from).length;
}

/**
 * The same two answers as lastVisit/visitFrequency, read from appointments — for a
 * member who may not read consultation rows. A completed appointment is a visit.
 */

export function lastAppointmentVisit(appointments = [], patientId) {
  const done = appointments
    .filter((a) => a.patient_id === patientId && a.status === 'completed')
    .sort((a, b) => String(b.scheduled_on).localeCompare(String(a.scheduled_on)));
  return done[0] ?? null;
}

export function appointmentVisitsSince(appointments = [], patientId, months = 12) {
  const from = addDays(today(), -Math.round(months * 30.44));
  return appointments.filter((a) => a.patient_id === patientId && a.status === 'completed' && a.scheduled_on >= from).length;
}

export function lastVisit(consultations, patientId) {
  return patientVisits(consultations, patientId)[0] ?? null;
}

/** Patients who have not returned within `days` of a completed visit. */

export function followUpDue(consultations, { withinDays = 7, on = today() } = {}) {
  const horizon = addDays(on, withinDays);
  return consultations
    .filter((c) => c.follow_up_on && c.follow_up_on <= horizon && !c.follow_up_done)
    .sort((a, b) => a.follow_up_on.localeCompare(b.follow_up_on));
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------
