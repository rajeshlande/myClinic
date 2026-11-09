/**
 * The path a patient actually walks, in one place.
 *
 *   token → consultation → prescription → invoice → follow-up
 *
 * Five steps, five different screens, and until now five different endings: saving
 * a consultation from the dashboard dropped the doctor back on the homescreen with
 * "billing is one tap away" while the invoice it had just raised was invisible; the
 * same save from the queue ended with no message at all; from Consultations it
 * jumped straight to the invoice, skipping the slip the patient was waiting for.
 *
 * A visit is not finished when the note is saved. This module answers the two
 * questions every one of those screens needs to ask: **where is this visit now**
 * and **what is the next step**. Kept pure so the answers can be asserted without
 * a browser.
 */

/** The five steps, in the order a patient meets them. */
export const VISIT_STEPS = Object.freeze([
  { id: 'token', label: 'Token', hint: 'Checked in and given a token' },
  { id: 'consult', label: 'Consultation', hint: 'Vitals, complaint, diagnosis' },
  { id: 'rx', label: 'Prescription', hint: 'The slip the patient carries out' },
  { id: 'invoice', label: 'Invoice', hint: 'The fee, raised and collected' },
  { id: 'followup', label: 'Follow-up', hint: 'The date they come back' },
]);

/** Anything worth printing: at least one drug with a name. */
export function hasPrescription(visit) {
  return (visit?.prescription ?? []).some((rx) => String(rx?.drug ?? '').trim());
}

/**
 * The invoice that belongs to this visit, if one was already raised.
 *
 * Matched on `appointment_id` first, because that is exact: one appointment, one
 * bill. When there is no appointment (a walk-in written up from the patient chart)
 * it falls back to "this patient, that day" — which is what the front desk means
 * when it asks whether the token has been billed yet. Voided invoices never match;
 * nor do invoices for another day.
 *
 * @param {Array} invoices
 * @param {{appointmentId?: string|null, patientId?: string|null, on?: string|null}} visit
 * @returns {object|null} the newest match
 */
export function invoiceForVisit(invoices = [], { appointmentId = null, patientId = null, on = null } = {}) {
  const live = (invoices ?? []).filter((i) => i && i.status !== 'void');
  const exact = appointmentId ? live.filter((i) => i.appointment_id === appointmentId) : [];
  const pool = exact.length
    ? exact
    : (patientId && on ? live.filter((i) => i.patient_id === patientId && i.issued_on === on) : []);
  if (!pool.length) return null;
  return pool.slice().sort((a, b) => String(b.created_at ?? b.issued_on ?? '').localeCompare(String(a.created_at ?? a.issued_on ?? '')))[0];
}

/**
 * Where this visit stands, step by step.
 *
 * `done` is deliberately generous for the last two steps — an invoice that was
 * raised (even unpaid) is done as a *step*, and a follow-up date that was written
 * down is done as a *step*. Whether money is still owed is a separate question,
 * answered by `visitNextActions`.
 *
 * @returns {{steps: Array<{id:string,label:string,hint:string,done:boolean,current:boolean}>,
 *            next: object|null, complete: boolean}}
 */
export function visitFlowState({ appointment = null, consultation = null, invoice = null } = {}) {
  const done = {
    token: Boolean(appointment?.token_no),
    consult: Boolean(consultation?.id ?? consultation?.visited_on),
    rx: hasPrescription(consultation),
    invoice: Boolean(invoice),
    followup: Boolean(consultation?.follow_up_on),
  };
  const steps = VISIT_STEPS.map((step) => ({ ...step, done: done[step.id] }));
  const next = steps.find((step) => !step.done) ?? null;
  return {
    steps: steps.map((step) => ({ ...step, current: next ? step.id === next.id : false })),
    next,
    complete: !next,
  };
}

/**
 * What to offer after the note is saved, in the order the counter works.
 *
 * Money first when something is owed, then the slip, then the return date. The
 * caller renders the first entry as the primary button.
 *
 * @param {{consultation?: object|null, invoice?: object|null, canBill?: boolean, balancePaise?: number}} input
 * @returns {Array<{id: 'collect'|'invoice'|'print-rx'|'book-followup'|'open-invoice', amountPaise?: number, on?: string}>}
 */
export function visitNextActions({ consultation = null, invoice = null, canBill = false, balancePaise = 0 } = {}) {
  const actions = [];
  if (invoice && balancePaise > 0 && canBill) actions.push({ id: 'collect', amountPaise: balancePaise });
  else if (invoice) actions.push({ id: 'open-invoice' });
  if (!invoice && canBill) actions.push({ id: 'invoice' });
  if (hasPrescription(consultation)) actions.push({ id: 'print-rx' });
  if (consultation) actions.push({ id: 'book-followup', on: consultation.follow_up_on ?? null });
  return actions;
}

/**
 * The date to prefill when the follow-up is booked from this visit.
 *
 * The doctor's own act-date wins; otherwise the clinic's `follow_up_days`
 * default, counted from today. Never a blank field — the whole point is that
 * booking the return visit takes one tap, not a date picker.
 */
export function followUpDateFor(consultation, { days = 15, today: todayIso } = {}) {
  const planned = String(consultation?.follow_up_on ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(planned)) return planned;
  const base = new Date(`${todayIso ?? new Date().toISOString().slice(0, 10)}T00:00:00`);
  const span = Number.isFinite(days) && days > 0 ? days : 15;
  base.setDate(base.getDate() + span);
  return base.toISOString().slice(0, 10);
}
