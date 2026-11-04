import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appointmentAt, channelLabel, closeFor, closeSnapshot, closeSummary, closeVariance,
  collectionsFor, dayTotals, inQuietHours, isClosed, liveInvoices, missedCharges,
  parseQuietHours, receivedOn, reminderDrafts, reminderKey, reminderLog, reminderStatus,
  reminderText, whatsappLink,
} from '../src/lib/daybook.mjs';

/**
 * A small, boring clinic. Pinned to 2026-11-04 so nothing here depends on the
 * day the suite happens to run.
 */
const ISO = '2026-11-04';
const YESTERDAY = '2026-11-03';
const CLINIC = { name: 'Sunrise Multispecialty OPD', phone: '+91 22 4000 1200' };
const DOCTORS = [{ id: 'doc-a', full_name: 'Dr. Anita Rao', fee_paise: 60000, follow_up_fee_paise: 30000 }];
const PATIENTS = [
  { id: 'p1', full_name: 'Meera Iyer', phone: '+91 98200 11223', created_at: `${ISO}T09:12:00.000Z` },
  { id: 'p2', full_name: 'Rohit Sharma', phone: '9820044556', created_at: '2026-09-02T09:12:00.000Z' },
  { id: 'p3', full_name: 'No Phone', phone: '', created_at: '2026-05-02T09:12:00.000Z' },
];

const at = (h, m = 0) => new Date(`${ISO}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`);

function invoice(over = {}) {
  return {
    id: 'inv-1', number: 'INV/2526/0001', patient_id: 'p1', doctor_id: 'doc-a',
    appointment_id: 'a1', issued_on: ISO, total_paise: 60000, paid_paise: 60000,
    method: 'cash', status: 'paid', lines: [], ...over,
  };
}

function day() {
  return {
    invoices: [
      invoice({ id: 'inv-1', patient_id: 'p1', appointment_id: 'a1', method: 'cash', total_paise: 60000, paid_paise: 60000 }),
      invoice({ id: 'inv-2', patient_id: 'p2', appointment_id: 'a2', method: 'upi', total_paise: 40000, paid_paise: 15000, status: 'partial' }),
      invoice({ id: 'inv-3', patient_id: 'p3', appointment_id: 'a3', method: 'cash', total_paise: 60000, paid_paise: 60000 }),
    ],
    consultations: [
      { id: 'c1', patient_id: 'p1', doctor_id: 'doc-a', visited_on: ISO, follow_up_on: '2026-11-10', follow_up_done: false, appointment_id: 'a1' },
      { id: 'c2', patient_id: 'p2', doctor_id: 'doc-a', visited_on: ISO, follow_up_on: null, follow_up_done: false, appointment_id: 'a2' },
      { id: 'c3', patient_id: 'p3', doctor_id: 'doc-a', visited_on: ISO, follow_up_on: '2026-11-08', follow_up_done: false, appointment_id: 'a3' },
    ],
    appointments: [
      { id: 'a1', patient_id: 'p1', doctor_id: 'doc-a', scheduled_on: ISO, scheduled_at: '09:30', status: 'completed', kind: 'New consultation' },
      { id: 'a2', patient_id: 'p2', doctor_id: 'doc-a', scheduled_on: ISO, scheduled_at: '10:00', status: 'completed', kind: 'Follow-up' },
      { id: 'a3', patient_id: 'p3', doctor_id: 'doc-a', scheduled_on: ISO, scheduled_at: '10:30', status: 'completed', kind: 'New consultation' },
      { id: 'a4', patient_id: 'p1', doctor_id: 'doc-a', scheduled_on: ISO, scheduled_at: '11:00', status: 'no-show', kind: 'New consultation' },
    ],
  };
}

/* ------------------------------------------------------------------ money */

test('collections split by method and count only what arrived that day', () => {
  const { invoices } = day();
  const result = collectionsFor({ invoices, iso: ISO });
  assert.equal(result.total, 135000);                    // 600 + 600 cash, 150 upi
  assert.equal(result.cash, 120000);
  assert.equal(result.count, 3);
  assert.deepEqual(result.rows.map((r) => r.method), ['cash', 'upi', 'card', 'insurance', 'credit']);
  assert.deepEqual(result.used.map((r) => r.method), ['cash', 'upi']);
  assert.equal(result.average, 45000);
});

test('a payment taken today against an old bill belongs to today', () => {
  const invoiceOld = invoice({
    id: 'inv-old', issued_on: '2026-10-20', paid_paise: 50000, paid_on: ISO, method: 'card', status: 'paid',
  });
  assert.equal(receivedOn(invoiceOld), ISO);
  const today = collectionsFor({ invoices: [invoiceOld], iso: ISO });
  assert.equal(today.total, 50000);
  assert.equal(today.rows.find((r) => r.method === 'card').amount, 50000);
  // …and not to the day it was billed.
  const billedDay = collectionsFor({ invoices: [invoiceOld], iso: '2026-10-20' });
  assert.equal(billedDay.total, 0);
});

test('voided invoices never count as money', () => {
  const voided = invoice({ id: 'inv-v', paid_paise: 60000, status: 'void' });
  assert.equal(liveInvoices([voided]).length, 0);
  assert.equal(collectionsFor({ invoices: [voided], iso: ISO }).total, 0);
});

test('day totals reconcile the sheet a receptionist reads out loud', () => {
  const { invoices, consultations, appointments } = day();
  const t = dayTotals({ invoices, consultations, patients: PATIENTS, appointments, iso: ISO });
  assert.equal(t.collected, 135000);
  assert.equal(t.billed, 160000);
  assert.equal(t.collectedOnIssued, 135000);
  assert.equal(t.openToday, 1);
  assert.equal(t.balanceToday, 25000);
  assert.equal(t.invoices, 3);
  assert.equal(t.visits, 3);
  assert.equal(t.newPatients, 1);
  assert.equal(t.seen, 3);
  assert.equal(t.noShows, 1);
  assert.equal(t.cash, 120000);
});

/* ------------------------------------------------------------- variance */

test('cash counted against cash expected reports short, over and exact', () => {
  assert.equal(closeVariance({ expectedPaise: 60000, countedPaise: 60000 }).state, 'match');
  const short = closeVariance({ expectedPaise: 60000, countedPaise: 58000 });
  assert.equal(short.state, 'short');
  assert.equal(short.variance, -2000);
  assert.match(short.label, /₹20 short/);
  const over = closeVariance({ expectedPaise: 60000, countedPaise: 60500 });
  assert.equal(over.state, 'over');
  assert.match(over.label, /₹5 over/);
  const uncounted = closeVariance({ expectedPaise: 60000, countedPaise: null });
  assert.equal(uncounted.state, 'uncounted');
  assert.equal(uncounted.variance, null);
  assert.equal(closeVariance({ expectedPaise: 60000, countedPaise: '' }).state, 'uncounted');
});

/* ---------------------------------------------------------- what leaked */

test('the detector finds a visit that was seen and never billed', () => {
  const { invoices, consultations, appointments } = day();
  const withoutOne = invoices.filter((i) => i.id !== 'inv-2');   // p2's bill never raised
  const found = missedCharges({
    appointments, consultations, invoices: withoutOne, patients: PATIENTS,
    doctors: DOCTORS, clinic: CLINIC, iso: ISO,
  });
  const items = found.items.filter((i) => i.patient_id === 'p2');
  assert.equal(items.length, 1);                                    // never listed twice
  assert.equal(items[0].type, 'seen-not-billed');
  assert.equal(items[0].amount, 30000);                             // follow-up fee, not the new-visit fee
  assert.equal(items[0].patient_name, 'Rohit Sharma');
  assert.equal(found.totals.leaks, 1);
  assert.equal(found.totals.leakValue, 30000);
});

test('notes saved without a bill are caught even if the appointment status never moved', () => {
  const found = missedCharges({
    appointments: [{ id: 'a9', patient_id: 'p2', doctor_id: 'doc-a', scheduled_on: ISO, scheduled_at: '12:00', status: 'in-consult' }],
    consultations: [{ id: 'c9', patient_id: 'p2', doctor_id: 'doc-a', visited_on: ISO, appointment_id: 'a9' }],
    invoices: [], patients: PATIENTS, doctors: DOCTORS, clinic: CLINIC, iso: ISO,
  });
  assert.equal(found.items.length, 1);
  assert.equal(found.items[0].type, 'visit-not-billed');
  assert.equal(found.items[0].amount, 60000);
});

test('nothing billed today is invisible to the detector', () => {
  const { invoices, consultations, appointments } = day();
  const found = missedCharges({
    appointments, consultations, invoices, patients: PATIENTS, doctors: DOCTORS, clinic: CLINIC, iso: ISO,
  });
  assert.equal(found.totals.leaks, 0);
  // inv-2 is part paid, so it is an open bill rather than a leak
  assert.equal(found.openToday.length, 1);
  assert.equal(found.openToday[0].type, 'partial');
  assert.equal(found.totals.openValue, 25000);
});

test('a bill nothing was paid on is called out differently from a part payment', () => {
  const unpaid = invoice({ id: 'inv-u', patient_id: 'p2', total_paise: 40000, paid_paise: 0, status: 'unpaid' });
  const found = missedCharges({
    appointments: [], consultations: [], invoices: [unpaid], patients: PATIENTS,
    doctors: DOCTORS, clinic: CLINIC, iso: ISO,
  });
  assert.equal(found.openToday.length, 1);
  assert.equal(found.openToday[0].type, 'unpaid');
  assert.equal(found.openToday[0].label, 'Billed, nothing paid');
  assert.equal(found.openToday[0].tone, 'danger');
});

test('old dues are aged in days and capped so the list stays readable', () => {
  const old = Array.from({ length: 8 }, (_, i) => invoice({
    id: `inv-old-${i}`, number: `INV/2526/01${i}`, patient_id: 'p2',
    issued_on: '2026-10-01', total_paise: 30000, paid_paise: 0, status: 'unpaid',
  }));
  const found = missedCharges({
    appointments: [], consultations: [], invoices: old, patients: PATIENTS,
    doctors: DOCTORS, clinic: CLINIC, iso: ISO, dueDays: 7, staleLimit: 5,
  });
  assert.equal(found.staleDues.length, 5);
  assert.equal(found.totals.staleCount, 8);
  assert.equal(found.totals.staleValue, 240000);
  assert.equal(found.staleDues[0].ageDays, 34);
  assert.match(found.staleDues[0].label, /34 days overdue/);
});

test('a clean day is reported as clean', () => {
  const found = missedCharges({
    appointments: [], consultations: [], invoices: [], patients: [], doctors: [], iso: ISO,
  });
  assert.equal(found.clean, true);
  assert.equal(found.items.length, 0);
});

/* ---------------------------------------------------------------- close */

test('the close snapshot is the day, frozen — totals, cash and note', () => {
  const { invoices, consultations, appointments } = day();
  const totals = dayTotals({ invoices, consultations, patients: PATIENTS, appointments, iso: ISO });
  const variance = closeVariance({ expectedPaise: totals.cash, countedPaise: totals.cash - 500 });
  const snapshot = closeSnapshot({ totals, variance, note: '  UPI settlement pending  ', closedBy: 'staff-1' });
  assert.equal(snapshot.totals.iso, ISO);
  assert.equal(snapshot.totals.collected, 135000);
  assert.equal(snapshot.expected_cash_paise, 120000);
  assert.equal(snapshot.counted_cash_paise, 119500);
  assert.equal(snapshot.variance_paise, -500);
  assert.equal(snapshot.note, 'UPI settlement pending');
  assert.equal(snapshot.closed_by, 'staff-1');
  assert.deepEqual(snapshot.totals.byMethod, [
    { method: 'cash', label: 'Cash', count: 2, amount: 120000 },
    { method: 'upi', label: 'UPI', count: 1, amount: 15000 },
  ]);
});

test('the note is clipped to the column the database allows', () => {
  const { invoices, consultations, appointments } = day();
  const totals = dayTotals({ invoices, consultations, patients: PATIENTS, appointments, iso: ISO });
  const snapshot = closeSnapshot({ totals, variance: closeVariance({ expectedPaise: 0 }), note: 'x'.repeat(900) });
  assert.equal(snapshot.note.length, 500);
});

test('the shared summary says what the drawer says and nothing clinical', () => {
  const { invoices, consultations, appointments } = day();
  const totals = dayTotals({ invoices, consultations, patients: PATIENTS, appointments, iso: ISO });
  const text = closeSummary({
    clinic: CLINIC, totals,
    variance: closeVariance({ expectedPaise: totals.cash, countedPaise: totals.cash - 10000 }),
    note: 'Card machine settled late',
  });
  assert.match(text, /Sunrise Multispecialty OPD/);
  assert.match(text, /Collected ₹1,350/);
  assert.match(text, /Cash ₹1,200 · UPI ₹150/);
  assert.match(text, /Visits 3/);
  assert.match(text, /₹100 short/);
  assert.match(text, /Note: Card machine settled late/);
  assert.doesNotMatch(text, /diagnos|fever|cough|Paracetamol/i);
});

test('a day is only closed while its row has not been reopened', () => {
  const closed = { closed_on: ISO, status: 'closed' };
  assert.equal(closeFor([closed], ISO), closed);
  assert.equal(closeFor([closed], YESTERDAY), null);
  assert.equal(isClosed(closed), true);
  assert.equal(isClosed({ ...closed, status: 'reopened' }), false);
  assert.equal(isClosed(null), false);
});

/* ------------------------------------------------------------ quiet hours */

test('quiet hours wrap past midnight', () => {
  assert.deepEqual(parseQuietHours('21:00-08:00'), { start: 1260, end: 480 });
  assert.deepEqual(parseQuietHours('nonsense'), { start: 1260, end: 480 });
  assert.equal(inQuietHours('21:00-08:00', 21 * 60), true);       // exactly at the start
  assert.equal(inQuietHours('21:00-08:00', 23 * 60 + 30), true);
  assert.equal(inQuietHours('21:00-08:00', 7 * 60 + 59), true);
  assert.equal(inQuietHours('21:00-08:00', 8 * 60), false);       // the end is exclusive
  assert.equal(inQuietHours('21:00-08:00', 12 * 60), false);
  assert.equal(inQuietHours('13:00-14:00', 13 * 60 + 30), true);  // a same-day window too
  assert.equal(inQuietHours('13:00-14:00', 15 * 60), false);
});

/* -------------------------------------------------------------- reminders */

function queue(over = {}) {
  const { invoices, consultations, appointments } = day();
  return reminderDrafts({
    appointments, consultations, invoices, patients: PATIENTS, doctors: DOCTORS, clinic: CLINIC,
    log: [], now: at(18, 0), leadHours: 24, windowDays: 7, balanceDays: 7,
    quiet: '21:00-08:00', ...over,
  });
}

test('only booked appointments inside the lead window are drafted', () => {
  const { consultations, invoices } = day();
  const result = reminderDrafts({
    appointments: [
      { id: 'tomorrow', patient_id: 'p1', doctor_id: 'doc-a', scheduled_on: '2026-11-05', scheduled_at: '10:30', status: 'booked' },
      { id: 'next-week', patient_id: 'p2', doctor_id: 'doc-a', scheduled_on: '2026-11-12', scheduled_at: '10:30', status: 'booked' },
      { id: 'cancelled', patient_id: 'p1', doctor_id: 'doc-a', scheduled_on: '2026-11-05', scheduled_at: '11:00', status: 'cancelled' },
      { id: 'gone-by', patient_id: 'p2', doctor_id: 'doc-a', scheduled_on: ISO, scheduled_at: '09:00', status: 'booked' },
    ],
    consultations: [], invoices: [], patients: PATIENTS, doctors: DOCTORS, clinic: CLINIC,
    now: at(18, 0), leadHours: 24,
  });
  assert.deepEqual(result.drafts.map((d) => d.key), [reminderKey('appointment', 'tomorrow')]);
  assert.match(result.drafts[0].title, /10:30/);
  assert.match(result.drafts[0].sub, /Dr\. Anita Rao/);
});

test('follow-up drafts come after appointments and read oldest first', () => {
  const result = reminderDrafts({
    appointments: [
      { id: 'tmr', patient_id: 'p2', doctor_id: 'doc-a', scheduled_on: '2026-11-05', scheduled_at: '09:15', status: 'booked' },
    ],
    invoices: [],
    consultations: [
      { id: 'c-over', patient_id: 'p1', doctor_id: 'doc-a', visited_on: '2026-10-20', follow_up_on: '2026-11-02', follow_up_done: false },
      { id: 'c-today', patient_id: 'p2', doctor_id: 'doc-a', visited_on: '2026-10-25', follow_up_on: ISO, follow_up_done: false },
    ],
    patients: PATIENTS, doctors: DOCTORS, clinic: CLINIC, now: at(8, 0), windowDays: 7, leadHours: 30,
  });
  assert.deepEqual(result.drafts.map((d) => d.kind), ['appointment', 'follow-up', 'follow-up']);
  assert.deepEqual(result.drafts.filter((d) => d.kind === 'follow-up').map((d) => d.ref_id), ['c-over', 'c-today']);
  assert.match(result.drafts[1].title, /2 days overdue/);
  assert.equal(result.drafts[2].title, 'Follow-up due today');
});

test('a recall outside the window is left alone', () => {
  const result = reminderDrafts({
    appointments: [], invoices: [], patients: PATIENTS, doctors: DOCTORS, clinic: CLINIC,
    consultations: [
      { id: 'c-soon', patient_id: 'p1', doctor_id: 'doc-a', visited_on: ISO, follow_up_on: '2026-11-06', follow_up_done: false },
      { id: 'c-later', patient_id: 'p2', doctor_id: 'doc-a', visited_on: ISO, follow_up_on: '2026-12-01', follow_up_done: false },
      { id: 'c-closed', patient_id: 'p1', doctor_id: 'doc-a', visited_on: ISO, follow_up_on: '2026-11-05', follow_up_done: true },
    ],
    now: at(18, 0), windowDays: 7,
  });
  assert.deepEqual(result.drafts.map((d) => d.ref_id), ['c-soon']);
});

test('a patient with no phone is returned, not silently dropped', () => {
  const result = queue();
  assert.ok(result.drafts.every((d) => d.phone));
  assert.equal(result.noPhone.length, 1);
  assert.equal(result.noPhone[0].patient_name, 'No Phone');
});

test('a reminder already logged is not drafted again, inside its own window', () => {
  const result = reminderDrafts({
    appointments: [],
    invoices: [],
    consultations: [
      { id: 'c-today', patient_id: 'p1', doctor_id: 'doc-a', visited_on: '2026-10-25', follow_up_on: ISO, follow_up_done: false },
      { id: 'c-week', patient_id: 'p2', doctor_id: 'doc-a', visited_on: '2026-10-25', follow_up_on: ISO, follow_up_done: false },
    ],
    patients: PATIENTS, doctors: DOCTORS, clinic: CLINIC, now: at(11, 0), windowDays: 7,
    log: [
      // logged this morning — the patient has already been messaged
      { draft_key: reminderKey('follow-up', 'c-today'), logged_on: ISO, status: 'sent', channel: 'whatsapp' },
      // logged long enough ago that the recall is worth chasing again
      { draft_key: reminderKey('follow-up', 'c-week'), logged_on: '2026-10-28', status: 'sent', channel: 'whatsapp' },
    ],
  });
  assert.deepEqual(result.drafts.map((d) => d.ref_id), ['c-week']);
});

test('an old balance becomes a reminder; a fresh one does not', () => {
  const fresh = invoice({ id: 'inv-fresh', patient_id: 'p1', issued_on: ISO, paid_paise: 0, status: 'unpaid' });
  const old = invoice({ id: 'inv-old', patient_id: 'p2', issued_on: '2026-10-01', total_paise: 30000, paid_paise: 0, status: 'unpaid' });
  const result = reminderDrafts({
    appointments: [], consultations: [], invoices: [fresh, old], patients: PATIENTS,
    doctors: DOCTORS, clinic: CLINIC, now: at(18, 0), balanceDays: 7,
  });
  assert.deepEqual(result.drafts.map((d) => d.kind), ['balance']);
  assert.deepEqual(result.drafts.map((d) => d.patient_name), ['Rohit Sharma']);
  assert.match(result.drafts[0].title, /₹300 pending/);
});

test('balances for the same patient are totalled into one message', () => {
  const a = invoice({ id: 'i-1', number: 'INV/1', patient_id: 'p2', issued_on: '2026-09-01', total_paise: 20000, paid_paise: 0, status: 'unpaid' });
  const b = invoice({ id: 'i-2', number: 'INV/2', patient_id: 'p2', issued_on: '2026-09-20', total_paise: 30000, paid_paise: 0, status: 'unpaid' });
  const result = reminderDrafts({
    appointments: [], consultations: [], invoices: [a, b], patients: PATIENTS,
    doctors: DOCTORS, clinic: CLINIC, now: at(18, 0), balanceDays: 7,
  });
  assert.equal(result.drafts.filter((d) => d.kind === 'balance').length, 1);
  assert.equal(result.drafts[0].amount, 50000);
  assert.match(result.drafts[0].sub, /INV\/1/);                 // oldest bill is the reference
});

test('quiet hours hold the drafts but never delete them', () => {
  assert.equal(queue({ now: at(18, 0) }).held, false);
  const late = queue({ now: at(22, 15) });
  assert.equal(late.held, true);
  assert.ok(late.drafts.length > 0);
  assert.ok(late.drafts.every((d) => d.hold));
});

test('the queue is capped so one card never becomes a scrollbar', () => {
  const many = Array.from({ length: 60 }, (_, i) => ({
    id: `c-${i}`, patient_id: i % 2 ? 'p1' : 'p2', doctor_id: 'doc-a',
    visited_on: ISO, follow_up_on: '2026-11-05', follow_up_done: false,
  }));
  const result = reminderDrafts({
    appointments: [], invoices: [], consultations: many, patients: PATIENTS,
    doctors: DOCTORS, clinic: CLINIC, now: at(18, 0), limit: 40,
  });
  assert.equal(result.drafts.length, 40);
  assert.equal(result.total, 60);
});

test('a drafted message carries the clinic, the time and no diagnosis', () => {
  const result = queue();
  const text = result.drafts.find((d) => d.kind === 'follow-up').text;
  assert.match(text, /Sunrise Multispecialty OPD/);
  assert.match(text, /Meera/);                                  // first name only
  assert.match(text, /\+91 22 4000 1200/);
  assert.doesNotMatch(text, /diagnos|fever|cough|Paracetamol|Acute/i);
});

test('whatsapp links normalise the numbers the desk actually types', () => {
  assert.equal(whatsappLink('9820044556'), 'https://wa.me/919820044556');
  assert.equal(whatsappLink('+91 98200 44556'), 'https://wa.me/919820044556');
  assert.equal(whatsappLink('09820044556'), 'https://wa.me/919820044556');
  assert.equal(whatsappLink(''), '');
  assert.equal(whatsappLink('12345'), '');
  assert.match(whatsappLink('9820044556', 'hello there'), /text=hello%20there/);
});

test('appointmentAt reads the local clock, not UTC', () => {
  const at930 = appointmentAt({ scheduled_on: ISO, scheduled_at: '09:30' });
  assert.equal(at930.getHours(), 9);
  assert.equal(at930.getMinutes(), 30);
  assert.equal(appointmentAt({ scheduled_on: null, scheduled_at: '09:30' }), null);
  assert.equal(appointmentAt(null), null);
});

test('the send log is newest first and speaks in labels', () => {
  const log = [
    { id: 'r1', patient_id: 'p1', kind: 'appointment', channel: 'whatsapp', status: 'sent', logged_on: ISO, created_at: `${ISO}T10:00:00.000Z` },
    { id: 'r2', patient_id: 'p2', kind: 'balance', channel: 'copy', status: 'copied', logged_on: ISO, created_at: `${ISO}T11:00:00.000Z` },
    { id: 'r3', patient_id: 'p1', kind: 'follow-up', channel: 'call', status: 'skipped', logged_on: YESTERDAY, created_at: `${YESTERDAY}T11:00:00.000Z` },
  ];
  const today = reminderLog({ log, patients: PATIENTS, iso: ISO });
  assert.deepEqual(today.map((r) => r.id), ['r2', 'r1']);
  assert.equal(today[0].channel_label, 'Copy');
  assert.equal(today[0].kind_label, 'Balance due');
  assert.equal(today[1].status_label, 'Sent');
  assert.equal(reminderLog({ log, patients: PATIENTS }).length, 3);
  assert.equal(reminderStatus('opened').tone, 'info');
  assert.equal(channelLabel('sms'), 'SMS');
  assert.equal(channelLabel('nope'), 'Copy');
});

test('the reminder text reads like a clinic, not like a template', () => {
  const patient = { full_name: 'Meera Iyer' };
  const booked = reminderText({ kind: 'appointment', patient, clinic: CLINIC, doctor: DOCTORS[0], when: 'Thu, 5 Nov 2026 at 10:30 AM' });
  assert.match(booked, /^Hello Meera,/);
  assert.match(booked, /Dr\. Anita Rao/);
  assert.match(booked, /arrive 10 minutes early/);
  const balance = reminderText({ kind: 'balance', patient, clinic: CLINIC, amount: 25000, reference: 'INV/2526/0002' });
  assert.match(balance, /₹250 is pending/);
  assert.match(balance, /INV\/2526\/0002/);
  assert.match(balance, /UPI QR/);
  const recall = reminderText({ kind: 'follow-up', patient, clinic: CLINIC, when: 'Mon, 10 Nov 2026' });
  assert.match(recall, /follow-up visit was advised/);
  assert.match(recall, /Mon, 10 Nov 2026/);
});
