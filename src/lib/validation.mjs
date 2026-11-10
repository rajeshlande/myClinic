/**
 * Form validation — the guards that stop a bad row before Postgres does.
 *
 * Split out of `logic.mjs` in v1.29.0.
 */

import { today, validISO } from './dates.mjs';

export const PHONE_RE = /^[+]?[\d\s-]{10,16}$/;

export function validatePatient(draft) {
  const errors = {};
  if (!draft.full_name?.trim()) errors.full_name = 'Patient name is required.';
  if (draft.phone && !PHONE_RE.test(draft.phone.trim())) errors.phone = 'Enter a 10-digit mobile number.';
  if (draft.dob && !validISO(draft.dob)) errors.dob = 'Date of birth must be a valid date.';
  if (draft.dob && draft.dob > today()) errors.dob = 'Date of birth cannot be in the future.';
  if (draft.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(draft.email.trim())) errors.email = 'Enter a valid email address.';
  return errors;
}

export function validateAppointment(draft) {
  const errors = {};
  if (!draft.patient_id) errors.patient_id = 'Choose a patient.';
  if (!draft.doctor_id) errors.doctor_id = 'Choose a doctor.';
  if (!validISO(draft.scheduled_on)) errors.scheduled_on = 'Choose a valid date.';
  if (!/^\d{2}:\d{2}$/.test(draft.scheduled_at || '')) errors.scheduled_at = 'Choose a start time.';
  return errors;
}

export function validateConsultation(draft) {
  const errors = {};
  if (!draft.complaint?.trim()) errors.complaint = 'Record the presenting complaint.';
  if (draft.temperature_c != null && draft.temperature_c !== '' && (Number(draft.temperature_c) < 90 || Number(draft.temperature_c) > 110)) errors.temperature_c = 'Temperature looks out of range.';
  if (draft.pulse_bpm && (Number(draft.pulse_bpm) < 30 || Number(draft.pulse_bpm) > 220)) errors.pulse_bpm = 'Pulse must be between 30 and 220 bpm.';
  if (draft.spo2 && (Number(draft.spo2) < 50 || Number(draft.spo2) > 100)) errors.spo2 = 'SpO₂ must be 50–100%.';
  // Investigations are a short list, not a lab report: the database refuses more
  // than 1,000 characters, so the form says so before the save is attempted.
  if (typeof draft.investigations === 'string' && draft.investigations.trim().length > 1000) {
    errors.investigations = 'Keep the investigations to a short list (under 1,000 characters).';
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------
