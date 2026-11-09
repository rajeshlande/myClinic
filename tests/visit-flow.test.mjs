import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VISIT_STEPS, followUpDateFor, hasPrescription, invoiceForVisit, visitFlowState, visitNextActions,
} from '../src/lib/visit-flow.mjs';

/*
 * The complaint behind this file: the same visit ended three different ways
 * depending on which screen saved the note. From the dashboard, "Chart updated.
 * Billing is one tap away" appeared while the invoice that save had just raised
 * was behind two menus; from the queue and the appointments board, nothing
 * appeared at all; from the consultation list the app jumped straight to the
 * invoice and skipped the prescription slip the patient was waiting for.
 *
 * So the *ending* is now data, not five copies of an onSaved callback. These
 * tests pin the order of the five steps, which step is next, and what the sheet
 * may offer — including the rule that a bill already raised is never raised twice.
 */

const visit = (over = {}) => ({
  id: 'c1', patient_id: 'p1', doctor_id: 'd1', visited_on: '2026-11-09',
  complaint: 'Fever', prescription: [{ drug: 'Paracetamol 500', pattern: '1-0-1' }],
  follow_up_on: '2026-11-19', ...over,
});

test('the five steps are in the order the patient walks them', () => {
  assert.deepEqual(VISIT_STEPS.map((s) => s.id), ['token', 'consult', 'rx', 'invoice', 'followup']);
  assert.deepEqual(VISIT_STEPS.map((s) => s.label), ['Token', 'Consultation', 'Prescription', 'Invoice', 'Follow-up']);
});

test('an empty visit points at the token, not at the note', () => {
  const state = visitFlowState({});
  assert.equal(state.next.id, 'token');
  assert.equal(state.complete, false);
  assert.equal(state.steps.filter((s) => s.done).length, 0);
  assert.equal(state.steps.filter((s) => s.current).length, 1, 'exactly one step is current');
});

test('a finished visit is complete and offers nothing further', () => {
  const state = visitFlowState({
    appointment: { token_no: 12 },
    consultation: visit(),
    invoice: { id: 'i1', total_paise: 50000, paid_paise: 50000 },
  });
  assert.equal(state.complete, true);
  assert.equal(state.next, null);
  assert.equal(state.steps.every((s) => s.done), true);
});

test('a prescription counts only when it names a drug', () => {
  assert.equal(hasPrescription(visit()), true);
  assert.equal(hasPrescription(visit({ prescription: [{ drug: '   ' }] })), false);
  assert.equal(hasPrescription(visit({ prescription: [] })), false);
  assert.equal(hasPrescription(null), false);

  const state = visitFlowState({ appointment: { token_no: 3 }, consultation: visit({ prescription: [{ drug: '' }] }) });
  assert.equal(state.next.id, 'rx', 'an empty drug row is not a prescription');
});

test('the bill is matched on the appointment first, and voids never match', () => {
  const invoices = [
    { id: 'old', appointment_id: 'a1', patient_id: 'p1', issued_on: '2026-11-09', status: 'void' },
    { id: 'hit', appointment_id: 'a1', patient_id: 'p1', issued_on: '2026-11-09', status: 'unpaid', created_at: '2026-11-09T10:00:00Z' },
    { id: 'newer', appointment_id: 'a2', patient_id: 'p1', issued_on: '2026-11-09', status: 'unpaid', created_at: '2026-11-09T11:00:00Z' },
  ];
  assert.equal(invoiceForVisit(invoices, { appointmentId: 'a1' }).id, 'hit');
  assert.equal(invoiceForVisit(invoices, { appointmentId: 'missing' }), null, 'no appointment match and no patient+day given');
});

test('without an appointment it falls back to this patient, that day', () => {
  const invoices = [
    { id: 'today', patient_id: 'p1', issued_on: '2026-11-09', status: 'unpaid', created_at: '2026-11-09T09:00:00Z' },
    { id: 'older', patient_id: 'p1', issued_on: '2026-11-01', status: 'unpaid', created_at: '2026-11-01T09:00:00Z' },
    { id: 'other-patient', patient_id: 'p2', issued_on: '2026-11-09', status: 'unpaid' },
  ];
  assert.equal(invoiceForVisit(invoices, { patientId: 'p1', on: '2026-11-09' }).id, 'today');
  assert.equal(invoiceForVisit(invoices, { patientId: 'p1', on: '2026-10-31' }), null);
});

test('the newest match wins, because that is the bill on the counter', () => {
  const invoices = [
    { id: 'a', patient_id: 'p1', issued_on: '2026-11-09', status: 'unpaid', created_at: '2026-11-09T09:00:00Z' },
    { id: 'b', patient_id: 'p1', issued_on: '2026-11-09', status: 'unpaid', created_at: '2026-11-09T12:00:00Z' },
  ];
  assert.equal(invoiceForVisit(invoices, { patientId: 'p1', on: '2026-11-09' }).id, 'b');
});

test('money comes first, then the slip, then the return date', () => {
  const actions = visitNextActions({
    consultation: visit(),
    invoice: { id: 'i1' },
    canBill: true,
    balancePaise: 50000,
  });
  assert.deepEqual(actions.map((a) => a.id), ['collect', 'print-rx', 'book-followup']);
  assert.equal(actions[0].amountPaise, 50000);
  assert.equal(actions[2].on, '2026-11-19', 'the date the doctor wrote down');
});

test('a bill that is already paid is opened, not collected again', () => {
  const actions = visitNextActions({ consultation: visit(), invoice: { id: 'i1' }, canBill: true, balancePaise: 0 });
  assert.deepEqual(actions.map((a) => a.id), ['open-invoice', 'print-rx', 'book-followup']);
});

test('nothing raised and no right to bill: the front desk is named, not a dead button', () => {
  const doctor = visitNextActions({ consultation: visit(), invoice: null, canBill: false, balancePaise: 0 });
  assert.equal(doctor.some((a) => a.id === 'invoice'), false);
  assert.deepEqual(doctor.map((a) => a.id), ['print-rx', 'book-followup']);

  const desk = visitNextActions({ consultation: visit(), invoice: null, canBill: true, balancePaise: 0 });
  assert.deepEqual(desk.map((a) => a.id), ['invoice', 'print-rx', 'book-followup']);
});

test('no visit means no actions at all', () => {
  assert.deepEqual(visitNextActions({}), []);
});

test('the follow-up date prefers the doctor, then the clinic default', () => {
  assert.equal(followUpDateFor(visit(), { days: 15, today: '2026-11-09' }), '2026-11-19');
  assert.equal(followUpDateFor(visit({ follow_up_on: '' }), { days: 15, today: '2026-11-09' }), '2026-11-24');
  assert.equal(followUpDateFor(visit({ follow_up_on: null }), { days: 30, today: '2026-12-01' }), '2026-12-31');
  assert.equal(followUpDateFor(visit({ follow_up_on: 'not a date' }), { days: 7, today: '2026-11-09' }), '2026-11-16');
  assert.equal(followUpDateFor(null, { days: 0, today: '2026-11-09' }), '2026-11-24', 'a nonsense default falls back to 15 days');
});
