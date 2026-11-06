/**
 * The messages a patient receives on WhatsApp.
 *
 * Five things leave a clinic, and each one is built here as plain text so the
 * same string can go to WhatsApp today, to an SMS gateway or the Cloud API
 * tomorrow, and into the send log unchanged. Nothing in this module touches the
 * DOM, the network or React — every function is pure and therefore testable.
 *
 * The privacy rule the product already prints on the marketing page holds here:
 * a reminder, a token or a balance message carries the clinic, the doctor, a
 * date, a time and an amount — never a diagnosis. The prescription is the one
 * exception, because the patient has to read their own medicines; even there the
 * diagnosis field is not included.
 *
 * Limits: `reminders.body` refuses more than 1200 characters, and WhatsApp shows
 * roughly 1000 before "Read more", so every builder trims to BODY_LIMIT and the
 * composer still shows the exact text before it sends.
 */

import { formatDate, formatTime, formatMoney, tokenLabel } from './logic.mjs';
import { normaliseVpa, upiPayeeName } from './upi.mjs';
import { quantityToDispense } from './rx-language.js';

/** Keep in step with `reminders.body` in supabase/schema.sql. */
export const BODY_LIMIT = 1200;

export const MESSAGE_KINDS = ['token', 'appointment', 'invoice', 'prescription', 'reminder'];

/** The kinds that this module builds. Reminders come from `reminderText()`. */
export const BUILT_KINDS = ['token', 'appointment', 'invoice', 'prescription'];

function firstName(fullName) {
  return String(fullName ?? '').trim().split(/\s+/)[0] || 'there';
}

/**
 * Consent. A patient who has opted out is not messaged, and the reason is a
 * sentence the desk can act on rather than a greyed-out button.
 *
 * `wa_opt_in` is additive (schema 11) and defaults to true: every number a clinic
 * typed in before this existed was already being messaged by hand.
 */
export function canMessage(patient) {
  if (!patient) return { ok: false, reason: 'No patient on this visit.' };
  if (patient.wa_opt_in === false) {
    const when = patient.wa_opt_out_at ? ` on ${formatDate(String(patient.wa_opt_out_at).slice(0, 10))}` : '';
    return { ok: false, reason: `${firstName(patient.full_name)} opted out of WhatsApp${when}. Call instead.` };
  }
  const digits = whatsappDigits(patient.phone);
  if (!digits) return { ok: false, reason: 'No usable mobile number on this patient. Add one on the patient card.' };
  return { ok: true, reason: '' };
}

/** Digits for wa.me: 10-digit Indian mobile → 91-prefixed; anything unusable → ''. */
export function whatsappDigits(phone) {
  let digits = String(phone ?? '').replace(/[^\d]/g, '');
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  return digits.length < 11 ? '' : digits;
}

/** A `wa.me` link, or '' when the number cannot be messaged. */
export function waLink(phone, text = '') {
  const digits = whatsappDigits(phone);
  if (!digits) return '';
  const base = `https://wa.me/${digits}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

function clip(text) {
  const clean = String(text ?? '').replace(/[ \t]+\n/g, '\n').trim();
  return clean.length <= BODY_LIMIT ? clean : `${clean.slice(0, BODY_LIMIT - 1).trimEnd()}…`;
}

/** One stable key per thing being sent, so the log can refuse a second send today. */
export function messageKey(kind, refId) {
  return `${kind}:${refId ?? 'none'}`;
}

function sign(clinic) {
  return `\n\nThank you,\n${clinic?.name ?? 'the clinic'}`;
}

function callLine(clinic) {
  return clinic?.phone ? `\n\nTo change anything, call us on ${clinic.phone}.` : '';
}

/* ------------------------------------------------------------------- token */

/**
 * "Your token is T-14" — the message that stops a patient ringing the desk from
 * the car park. `ahead` and `etaMinutes` are optional: when the board knows them
 * they are worth more than any apology, and when it does not the message still
 * works without inventing a number.
 */
export function tokenMessage({ clinic, doctor, patient, appointment, ahead = null, etaMinutes = null, at = '' } = {}) {
  const token = tokenLabel(appointment?.token_no);
  const lines = [
    `Hello ${firstName(patient?.full_name)},`,
    '',
    `This is ${clinic?.name ?? 'the clinic'}. Your token today is ${token}${doctor?.full_name ? ` with ${doctor.full_name}` : ''}.`,
  ];
  if (typeof ahead === 'number' && ahead > 0) {
    lines.push(`${ahead} ${ahead === 1 ? 'patient is' : 'patients are'} ahead of you${typeof etaMinutes === 'number' && etaMinutes > 0 ? ` — roughly ${etaMinutes} minutes` : ''}.`);
  } else if (typeof ahead === 'number') {
    lines.push('You are next in the queue.');
  }
  if (at) lines.push(`Please be at the desk by ${formatTime(at)}.`);
  lines.push(callLine(clinic).trim() ? `If you cannot come, call us on ${clinic.phone}.` : 'Please show this message at the desk.');
  return {
    kind: 'token',
    key: messageKey('token', appointment?.id),
    subject: `${token} · ${patient?.full_name ?? 'patient'}`,
    text: clip(`${lines.join('\n')}${sign(clinic)}`),
  };
}

/* ------------------------------------------------------------- appointment */

/**
 * The appointment itself, separate from the reminder the queue drafts: the desk
 * sends this the moment a slot is booked or moved, which is when a patient is
 * most likely to lose the piece of paper.
 */
export function appointmentMessage({ clinic, doctor, patient, appointment, kind = '' } = {}) {
  const iso = appointment?.scheduled_on;
  const when = iso ? formatDate(iso, { weekday: true }) : 'the booked date';
  const at = appointment?.scheduled_at ? ` at ${formatTime(String(appointment.scheduled_at).slice(0, 5))}` : '';
  const what = (kind || appointment?.kind || 'Consultation').toLowerCase();
  return {
    kind: 'appointment',
    key: messageKey('appointment', appointment?.id),
    subject: `${when}${at} · ${patient?.full_name ?? 'patient'}`,
    text: clip(
      `Hello ${firstName(patient?.full_name)},\n\n`
      + `This is ${clinic?.name ?? 'the clinic'}. Your ${what}${doctor?.full_name ? ` with ${doctor.full_name}` : ''} is on ${when}${at}.\n\n`
      + 'Please arrive 10 minutes early.'
      + (clinic?.address ? `\n\n${clinic.address}` : '')
      + callLine(clinic)
      + sign(clinic),
    ),
  };
}

/* ----------------------------------------------------------------- invoice */

/**
 * The bill, in words the patient can check: what it was for is their own bill
 * (`lines` is not repeated — a WhatsApp message that lists every strip is longer
 * than the queue it came from), how much was paid, what is left, and how to pay
 * it without coming back.
 */
export function invoiceMessage({ clinic, patient, invoice, balancePaise = null } = {}) {
  const total = Number(invoice?.total_paise ?? 0);
  const paid = Number(invoice?.paid_paise ?? 0);
  const balance = balancePaise === null ? Math.max(total - paid, 0) : Number(balancePaise);
  const vpa = normaliseVpa(clinic?.upi_id);
  const lines = [
    `Hello ${firstName(patient?.full_name)},`,
    '',
    `This is ${clinic?.name ?? 'the clinic'}. Bill ${invoice?.number ?? ''} dated ${formatDate(invoice?.issued_on)}.`,
    '',
    `Total: ${formatMoney(total)}`,
    `Paid: ${formatMoney(paid)}`,
    balance > 0 ? `Balance due: ${formatMoney(balance)}` : 'Status: paid in full — thank you.',
  ];
  if (balance > 0 && vpa) {
    lines.push('', `Pay by UPI: ${vpa}${upiPayeeName(clinic) ? ` (${upiPayeeName(clinic)})` : ''}`);
  }
  if (balance > 0) lines.push('You can also settle it at the front desk on your next visit.');
  return {
    kind: 'invoice',
    key: messageKey('invoice', invoice?.id),
    subject: `${invoice?.number ?? 'Bill'} · ${formatMoney(balance > 0 ? balance : total)}`,
    text: clip(`${lines.join('\n')}${sign(clinic)}`),
  };
}

/* ------------------------------------------------------------ prescription */

/**
 * The slip, for the pharmacy. `instructionFor` is passed in — the caller already
 * owns the language choice (`patientInstruction(rx, lang)` from rx-language.js)
 * and the medicine names stay in English whatever the language is.
 */
export function prescriptionMessage({
  clinic, doctor, patient, visit, languageLabel = 'English', instructionFor = () => '', } = {}) {
  const meds = (visit?.prescription ?? []).map((rx, i) => {
    const direction = instructionFor(rx);
    // The quantity matters to the person buying it: "10 tablets" is the
    // difference between a complete course and a second trip to the chemist.
    const quantity = quantityToDispense(rx)?.label;
    return `${i + 1}. ${rx?.drug ?? 'Medicine'}${direction ? ` — ${direction}` : ''}${quantity ? ` (${quantity})` : ''}`;
  });
  const lines = [
    `Hello ${firstName(patient?.full_name)},`,
    '',
    `This is ${clinic?.name ?? 'the clinic'}. Your prescription${doctor?.full_name ? ` from ${doctor.full_name}` : ''} on ${formatDate(visit?.visited_on)}${languageLabel && languageLabel !== 'English' ? ` (${languageLabel})` : ''}.`,
    '',
    ...(meds.length ? meds : ['No medicines were prescribed.']),
  ];
  if (visit?.advice) lines.push('', `Advice: ${visit.advice}`);
  if (visit?.follow_up_on) lines.push(`Next visit: ${formatDate(visit.follow_up_on)}`);
  lines.push('', 'Please carry this message or the printed slip to the pharmacy.');
  return {
    kind: 'prescription',
    key: messageKey('prescription', visit?.id),
    subject: `${formatDate(visit?.visited_on)} · ${patient?.full_name ?? 'patient'}`,
    text: clip(`${lines.join('\n')}${sign(clinic)}`),
  };
}

/**
 * Everything the composer needs, in one call: the message, whether it may be
 * sent, and the link. Returning the refusal rather than throwing keeps the
 * screens free of try/catch around a consent rule.
 */
export function compose({ kind, ...rest }) {
  const built = {
    token: tokenMessage,
    appointment: appointmentMessage,
    invoice: invoiceMessage,
    prescription: prescriptionMessage,
  }[kind]?.(rest);

  if (!built) return { ok: false, reason: `Unknown message kind: ${kind}`, message: null, link: '' };

  const consent = canMessage(rest.patient);
  return {
    ok: consent.ok,
    reason: consent.reason,
    message: built,
    link: consent.ok ? waLink(rest.patient?.phone, built.text) : '',
  };
}
