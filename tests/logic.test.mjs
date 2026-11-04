import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  moneyToPaise, formatMoney, paiseToInput, computeInvoice, computeLine, invoiceStatus,
  addDays, daysBetween, timeToMinutes, minutesToTime, generateSlots, slotAvailability,
  ageFromDOB, patientSearch, followUpDue, monthTotals, revenueSeries, doctorPerformance,
  validatePatient, validateAppointment, invoiceNumber, financialYear, toCSV, ordinalSuffix,
  outstandingByPatient, invoiceBalance, feeForVisit, appointmentMatchesQuery, patientVisits,
} from '../src/lib/logic.mjs';
import { configChecks, restCheck, schemaCheck, readiness } from '../src/lib/health.mjs';
import {
  GRACE_DAYS, TRIAL_DAYS, canAddSeat, canRead, canWrite, formatExpiry, licenseHeadline, licenseState,
  planPrice, seatUsage, upgradeCost,
} from '../src/lib/license.mjs';

test('money parses rupees into integer paise without float drift', () => {
  assert.equal(moneyToPaise('1234.50'), 123450);
  assert.equal(moneyToPaise('1234.5'), 123450);
  assert.equal(moneyToPaise('0.07'), 7);
  assert.equal(moneyToPaise('1,250'), 125000);
  assert.equal(moneyToPaise(''), 0);
  assert.throws(() => moneyToPaise('12.345'));
  assert.throws(() => moneyToPaise('abc'));
  assert.equal(paiseToInput(123450), '1234.50');
  assert.equal(paiseToInput(50000), '500');
});

test('formatMoney uses Indian grouping and compact suffixes', () => {
  assert.match(formatMoney(123450), /1,234\.50/);      // paise always print in pairs
  assert.equal(formatMoney(2399040), '₹23,990.40');     // a yearly plan price
  assert.equal(formatMoney(249900), '₹2,499');          // whole rupees stay whole
  assert.equal(formatMoney(10000000, { compact: true }), '₹1L');
  assert.equal(formatMoney(1000000000, { compact: true }), '₹1Cr');
  assert.equal(formatMoney(5000000, { compact: true }), '₹50k');
});

test('invoice maths reconciles and never over-pays', () => {
  const inv = computeInvoice({
    lines: [
      { name: 'Consultation', category: 'Consultation', qty: 1, rate_paise: 60000, tax_rate: 0 },
      { name: 'Dressing', category: 'Procedure', qty: 2, rate_paise: 20000, discount: 5000, tax_rate: 0 },
    ],
    discount: 10000,
    gst_enabled: false,
    paid: 0,
  });
  assert.equal(inv.subtotal, 100000);          // 600 + 400
  assert.equal(inv.lineDiscount, 5000);
  assert.equal(inv.billDiscount, 10000);
  assert.equal(inv.taxable, 85000);
  assert.equal(inv.total, 85000);
  assert.equal(inv.status, 'unpaid');

  const overpaid = computeInvoice({ lines: [{ qty: 1, rate_paise: 10000 }], paid: 999999 });
  assert.equal(overpaid.paid, 10000);
  assert.equal(overpaid.balance, 0);
  assert.equal(overpaid.status, 'paid');

  const gst = computeLine({ qty: 1, rate_paise: 100000, tax_rate: 18 });
  assert.equal(gst.taxPaise, 18000);
  assert.equal(gst.total, 118000);

  assert.equal(invoiceStatus({ total_paise: 1000, paid_paise: 400 }).id, 'partial');
  assert.equal(invoiceBalance({ total_paise: 1000, paid_paise: 400 }), 600);
});

test('dates, slots and ages behave in local time', () => {
  assert.equal(addDays('2026-03-01', 1), '2026-03-02');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(daysBetween('2026-01-01', '2026-01-31'), 30);
  assert.equal(minutesToTime(timeToMinutes('09:45')), '09:45');
  assert.equal(minutesToTime(1440), '00:00');

  const slots = generateSlots({ start: '09:00', end: '10:00', duration: 15 });
  assert.deepEqual(slots, ['09:00', '09:15', '09:30', '09:45']);

  const doctor = { id: 'd1', day_start: '09:00', day_end: '10:00' };
  const avail = slotAvailability({
    doctor, iso: '2026-01-05', duration: 15,
    appointments: [{ doctor_id: 'd1', scheduled_on: '2026-01-05', scheduled_at: '09:15', status: 'booked' }],
  });
  assert.ok(avail.taken.has('09:15'));
  assert.ok(!avail.free.includes('09:15'));

  const age = ageFromDOB('2000-06-15', '2026-06-14');
  assert.equal(age.years, 25);
  assert.equal(ageFromDOB('2026-09-01', '2026-11-02').label, '2 mo');
  assert.equal(ordinalSuffix(1), 'st');
  assert.equal(ordinalSuffix(12), 'th');
  assert.equal(financialYear('2026-04-01'), '26-27');
  assert.equal(financialYear('2026-02-01'), '25-26');
  assert.equal(invoiceNumber(7, '2026-05-01'), 'INV/26-27/0007');
});

test('patient search matches name, code, phone digits and tags', () => {
  const patients = [
    { id: '1', full_name: 'Meera Iyer', code: 'PT-00001', phone: '+91 98200 11223', tags: ['Diabetes'] },
    { id: '2', full_name: 'Rohit Patel', code: 'PT-00002', phone: '+91 99887 66554', tags: [] },
  ];
  assert.equal(patientSearch(patients, 'meera').length, 1);
  assert.equal(patientSearch(patients, 'PT-00002')[0].id, '2');
  assert.equal(patientSearch(patients, '11223')[0].id, '1');
  assert.equal(patientSearch(patients, 'diabetes')[0].id, '1');
  assert.equal(patientSearch(patients, '').length, 2);
});

test('validation catches the mistakes that break records', () => {
  assert.ok(validatePatient({ full_name: '' }).full_name);
  assert.ok(validatePatient({ full_name: 'A', phone: '123' }).phone);
  assert.ok(validatePatient({ full_name: 'A', email: 'nope' }).email);
  assert.ok(validatePatient({ full_name: 'A', dob: '2999-01-01' }).dob);
  assert.deepEqual(validatePatient({ full_name: 'A', phone: '+91 98200 11223' }), {});

  assert.ok(validateAppointment({ patient_id: '', doctor_id: 'd', scheduled_on: '2026-01-01', scheduled_at: '09:00' }).patient_id);
  assert.ok(validateAppointment({ patient_id: 'p', doctor_id: 'd', scheduled_on: 'bad', scheduled_at: '09:00' }).scheduled_on);
});

test('analytics aggregate a month correctly', () => {
  const invoices = [
    { id: 'i1', issued_on: '2026-11-02', total_paise: 100000, paid_paise: 100000, status: 'paid', doctor_id: 'd1', method: 'upi', patient_id: 'p1', lines: [{ category: 'Consultation', total: 100000 }] },
    { id: 'i2', issued_on: '2026-11-03', total_paise: 50000, paid_paise: 20000, status: 'partial', doctor_id: 'd1', method: 'cash', patient_id: 'p2', lines: [{ category: 'Procedure', total: 50000 }] },
    { id: 'i3', issued_on: '2026-10-30', total_paise: 80000, paid_paise: 80000, status: 'paid', doctor_id: 'd1', method: 'card', patient_id: 'p1', lines: [{ category: 'Consultation', total: 80000 }] },
  ];
  const consultations = [
    { id: 'c1', visited_on: '2026-11-02', doctor_id: 'd1', patient_id: 'p1', follow_up_on: '2026-11-20', follow_up_done: false },
    { id: 'c2', visited_on: '2026-10-02', doctor_id: 'd1', patient_id: 'p2' },
  ];
  const patients = [{ id: 'p1', created_at: '2026-11-01T00:00:00Z' }, { id: 'p2', created_at: '2026-05-01T00:00:00Z' }];

  const totals = monthTotals({ invoices, consultations, patients, month: '2026-11' });
  assert.equal(totals.billed, 150000);
  assert.equal(totals.collected, 120000);
  assert.equal(totals.outstanding, 30000);
  assert.equal(totals.visits, 1);
  assert.equal(totals.newPatients, 1);

  const series = revenueSeries({ invoices, month: '2026-11', count: 3 });
  assert.equal(series.length, 3);
  assert.equal(series.at(-1).collected, 120000);

  const perf = doctorPerformance({
    appointments: [{ scheduled_on: '2026-11-02', doctor_id: 'd1', status: 'completed' }],
    consultations, invoices, doctors: [{ id: 'd1', full_name: 'Dr. A' }], month: '2026-11',
  });
  assert.equal(perf[0].collected, 120000);
  assert.equal(perf[0].visits, 1);

  const dues = outstandingByPatient(invoices);
  assert.equal(dues.get('p2'), 30000);
  assert.equal(dues.get('p1'), undefined);
});

test('follow-ups surface only open recalls inside the window', () => {
  const today = '2026-11-02';
  const list = [
    { id: 'a', follow_up_on: '2026-10-20', follow_up_done: false },
    { id: 'b', follow_up_on: '2026-11-05', follow_up_done: false },
    { id: 'c', follow_up_on: '2026-11-04', follow_up_done: true },
    { id: 'd', follow_up_on: '2027-01-01', follow_up_done: false },
    { id: 'e', follow_up_on: null, follow_up_done: false },
  ];
  const due = followUpDue(list, { withinDays: 7, on: today });
  assert.deepEqual(due.map((c) => c.id), ['a', 'b']);
});

test('visits sort newest first and fees follow visit type', () => {
  const visits = patientVisits([
    { id: '1', patient_id: 'p', visited_on: '2026-01-01' },
    { id: '2', patient_id: 'p', visited_on: '2026-05-01' },
    { id: '3', patient_id: 'q', visited_on: '2026-06-01' },
  ], 'p');
  assert.deepEqual(visits.map((v) => v.id), ['2', '1']);

  const doctor = { fee_paise: 70000, follow_up_fee_paise: 30000 };
  assert.equal(feeForVisit({ doctor, kind: 'Follow-up' }), 30000);
  assert.equal(feeForVisit({ doctor, kind: 'New consultation' }), 70000);
  assert.equal(feeForVisit({ doctor, clinic: { consultation_fee_paise: 50000 }, kind: 'Teleconsultation' }), 70000);
});

test('CSV export quotes commas and newlines safely', () => {
  const csv = toCSV(
    [{ name: 'Iyer, Meera', note: 'line1\nline2', amount: 100 }],
    [{ label: 'Name', key: 'name' }, { label: 'Note', key: 'note' }, { label: 'Amount', key: 'amount' }],
  );
  const lines = csv.split('\n');
  assert.equal(lines[0], 'Name,Note,Amount');
  assert.ok(csv.includes('"Iyer, Meera"'));
  assert.ok(csv.includes('"line1\nline2"'));
});

test('appointment search matches the patient behind the record', () => {
  const patients = [{ id: 'p1', full_name: 'Farah Verma', phone: '+91 98450 33112', code: 'PT-00009' }];
  const appt = { patient_id: 'p1', reason: 'Cough', scheduled_on: '2026-11-02', kind: 'Follow-up' };
  assert.ok(appointmentMatchesQuery(appt, patients, 'farah'));
  assert.ok(appointmentMatchesQuery(appt, patients, '33112'));
  assert.ok(appointmentMatchesQuery(appt, patients, 'PT-00009'));
  assert.ok(!appointmentMatchesQuery(appt, patients, 'zzz'));
});

// ---------------------------------------------------------------------------
// Token queue
// ---------------------------------------------------------------------------
import {
  nextTokenNo, tokenLabel, humanWait, waitedMinutes, queueBoard, queueState, averageWait,
} from '../src/lib/logic.mjs';

const TODAY = '2026-11-02';
const tokenAppointments = [
  { id: 'a1', patient_id: 'p1', doctor_id: 'd1', scheduled_on: TODAY, scheduled_at: '09:00', status: 'completed', token_no: 1 },
  { id: 'a2', patient_id: 'p2', doctor_id: 'd1', scheduled_on: TODAY, scheduled_at: '09:10', status: 'in-consult', token_no: 2 },
  { id: 'a3', patient_id: 'p3', doctor_id: 'd1', scheduled_on: TODAY, scheduled_at: '09:20', status: 'checked-in', token_no: 3 },
  { id: 'a4', patient_id: 'p4', doctor_id: 'd1', scheduled_on: TODAY, scheduled_at: '09:30', status: 'booked', token_no: 4 },
  { id: 'a5', patient_id: 'p5', doctor_id: 'd2', scheduled_on: TODAY, scheduled_at: '16:00', status: 'checked-in', token_no: 1 },
  { id: 'a6', patient_id: 'p6', doctor_id: 'd1', scheduled_on: '2026-11-03', scheduled_at: '09:00', status: 'booked', token_no: 1 },
  { id: 'a7', patient_id: 'p7', doctor_id: 'd1', scheduled_on: TODAY, scheduled_at: '11:00', status: 'cancelled', token_no: 9 },
  { id: 'a8', patient_id: 'p8', doctor_id: 'd1', scheduled_on: TODAY, scheduled_at: '10:00', status: 'booked' },
];
const tokenPatients = Array.from({ length: 9 }, (_, i) => ({ id: `p${i + 1}`, full_name: `Patient ${i + 1}` }));
const tokenDoctors = [
  { id: 'd1', full_name: 'Dr. One', role: 'doctor', day_start: '09:00', day_end: '13:00' },
  { id: 'd2', full_name: 'Dr. Two', role: 'doctor', day_start: '16:00', day_end: '20:00' },
  { id: 'fd', full_name: 'Front Desk', role: 'frontdesk' },
];

test('tokens restart daily and per doctor', () => {
  // 1–4 used, and the cancelled #9 still holds its number → next is 10.
  assert.equal(nextTokenNo(tokenAppointments, 'd1', TODAY), 10);
  assert.equal(nextTokenNo(tokenAppointments, 'd2', TODAY), 2);
  assert.equal(nextTokenNo(tokenAppointments, 'd1', '2026-11-03'), 2); // a6 already holds #1
  assert.equal(nextTokenNo([], 'd1', TODAY), 1);
  assert.equal(tokenLabel(7), 'T-07');
  assert.equal(tokenLabel(null), 'T-—');
});

test('cancelled tokens keep their number reserved (no reuse)', () => {
  // #9 was issued then cancelled — the next token must still be 10, otherwise
  // two patients could hold the same printed number in one day.
  assert.equal(nextTokenNo([{ doctor_id: 'd1', scheduled_on: TODAY, token_no: 9, status: 'cancelled' }], 'd1', TODAY), 10);
});

test('queueBoard splits serving / waiting / done per doctor', () => {
  const board = queueBoard({
    appointments: tokenAppointments, patients: tokenPatients, doctors: tokenDoctors, iso: TODAY,
  });
  assert.equal(board.rows.length, 2, 'front desk is not a queue lane');
  const one = board.rows.find((r) => r.doctor.id === 'd1');
  assert.equal(one.serving.token_no, 2);
  assert.equal(one.next.token_no, 3);
  assert.equal(one.waiting.length, 2);           // #3 checked-in + #4 booked
  assert.equal(one.completed.length, 1);
  assert.equal(one.nextToken, 10);
  assert.equal(one.issued, 4);                   // cancelled token excluded from today's count

  assert.equal(board.totals.waiting, 3);
  assert.equal(board.totals.serving, 1);   // only Dr. One has someone in the room
  assert.equal(board.totals.done, 1);
});

test('queueBoard can filter to a single doctor', () => {
  const board = queueBoard({ appointments: tokenAppointments, patients: tokenPatients, doctors: tokenDoctors, iso: TODAY, doctorId: 'd2' });
  assert.equal(board.rows.length, 1);
  assert.equal(board.rows[0].doctor.id, 'd2');
  assert.equal(board.rows[0].next.token_no, 1);
});

test('queue state labels match what the desk sees', () => {
  assert.equal(queueState({ status: 'in-consult' }).label, 'In the room');
  assert.equal(queueState({ status: 'checked-in' }).label, 'Waiting');
  assert.equal(queueState({ status: 'completed' }).label, 'Done');
  assert.equal(queueState({ status: 'booked' }).label, 'Not arrived');
  assert.equal(queueState(null).label, 'No token');
});

test('wait times are human and sane', () => {
  assert.equal(humanWait(0), 'just now');
  assert.equal(humanWait(9), '9 min');
  assert.equal(humanWait(75), '1 h 15 min');
  assert.equal(humanWait(120), '2 h');
  assert.equal(humanWait(999), '4 h +');
  const at = new Date('2026-11-02T09:30:00');
  assert.equal(waitedMinutes({ scheduled_on: TODAY, scheduled_at: '09:00' }, at), 30);
  assert.equal(waitedMinutes({ scheduled_on: TODAY, scheduled_at: '10:00' }, at), 0);
});

test('averageWait uses appointment time vs when the consult was saved', () => {
  const appts = [{ id: 'x1', token_no: 1, scheduled_at: '09:00' }];
  const cons = [{ visited_on: TODAY, appointment_id: 'x1', created_at: '2026-11-02T09:12:00' }];
  assert.equal(averageWait(cons, appts, TODAY), 12);
  assert.equal(averageWait([], appts, TODAY), null);
});

// ---------------------------------------------------------------------------
// Offline sync, conflict policy, permissions, versioning, prescription language
// ---------------------------------------------------------------------------
import {
  mergeFields, classifySyncError, backoffMs, describeOp, MANUAL_FIELDS,
} from '../src/lib/offline.js';
import { can, capabilitiesFor, landingRouteFor, ROLES } from '../src/lib/permissions.js';
import { compareVersions, schemaStatus, SCHEMA_VERSION } from '../src/lib/version.js';
import { patientInstruction, durationParts, frequencyKey, RX_LANGUAGES } from '../src/lib/rx-language.js';

test('sync: non-conflicting edits merge field by field', () => {
  const base = { notes: 'a', phone: '111', total_paise: 500 };
  const local = { notes: 'edited on tablet' };          // only notes changed locally
  const remote = { notes: 'a', phone: '222', total_paise: 500 }; // only phone changed at the desk
  const { patch, conflicts } = mergeFields({ table: 'patients', base, local, remote });
  assert.deepEqual(patch, { notes: 'edited on tablet' });
  assert.equal(conflicts.length, 0, 'no manual decision needed');
  assert.ok(!('phone' in patch), 'a field this device never touched is not written back');
  assert.ok(!Object.values(patch).includes(undefined), 'never send undefined to Postgres');
});

test('sync: money/status conflicts are never auto-resolved', () => {
  // Both sides changed the same money field → a human must choose.
  const base = { status: 'unpaid', total_paise: 500, paid_paise: 0 };
  const local = { status: 'paid', paid_paise: 500 };
  const remote = { status: 'void', total_paise: 500, paid_paise: 0 };
  const { conflicts } = mergeFields({ table: 'invoices', base, local, remote });
  assert.ok(conflicts.some((c) => c.field === 'status'), 'status change needs a human');
  assert.ok(conflicts.some((c) => c.field === 'paid_paise'), 'paid amount needs a human');
  assert.ok(MANUAL_FIELDS.invoices.includes('paid_paise'));
});

test('sync: a one-sided money edit is not a conflict', () => {
  const base = { status: 'unpaid', paid_paise: 0 };
  const local = { paid_paise: 500 };                      // only this device touched money
  const remote = { status: 'unpaid', paid_paise: 0 };
  const { patch, conflicts } = mergeFields({ table: 'invoices', base, local, remote });
  assert.deepEqual(patch, { paid_paise: 500 });
  assert.equal(conflicts.length, 0);
  // …but if the clinic voided the bill meanwhile, the server's guard refuses it.
  const voided = mergeFields({ table: 'invoices', base, local, remote: { status: 'void', paid_paise: 0 } });
  assert.deepEqual(voided.patch, { paid_paise: 500 }, 'client may try; invoice_guard() decides');
});

test('sync: money edits move as one unit when a decision is needed', () => {
  // status conflicts with the clinic, so no partial money update is sent.
  const { patch, conflicts } = mergeFields({
    table: 'invoices',
    base: { status: 'unpaid', paid_paise: 0 },
    local: { status: 'paid', paid_paise: 5000 },
    remote: { status: 'void', paid_paise: 0 },
  });
  assert.deepEqual(patch, {}, 'nothing financial is written before the human decides');
  assert.deepEqual(conflicts.map((c) => c.field).sort(), ['paid_paise', 'status']);
});

test('sync: a changed paid amount is a manual field, notes still merge', () => {
  const base = { paid_paise: 100, notes: 'x' };
  const local = { paid_paise: 200, notes: 'from tablet' };
  const remote = { paid_paise: 150, notes: 'x' };
  const { patch, conflicts } = mergeFields({ table: 'invoices', base, local, remote });
  assert.deepEqual(patch, { notes: 'from tablet' });
  assert.deepEqual(conflicts.map((c) => c.field), ['paid_paise']);
});

test('sync: identical changes on both sides converge silently', () => {
  const base = { notes: 'a' };
  const local = { notes: 'same' };
  const remote = { notes: 'same' };
  const { patch, conflicts } = mergeFields({ table: 'patients', base, local, remote });
  assert.deepEqual(patch, {});
  assert.equal(conflicts.length, 0);
});

test('sync: server-owned fields are never written back by the client', () => {
  const base = { id: 'x', created_at: 't1', clinic_id: 'c1', notes: 'a' };
  const local = { id: 'hacked', created_at: 't2', clinic_id: 'other', notes: 'b' };
  const { patch } = mergeFields({ table: 'patients', base, local, remote: base });
  assert.deepEqual(patch, { notes: 'b' });
});

test('sync: error classification drives retry vs decision', () => {
  assert.equal(classifySyncError({ message: 'Failed to fetch' }, 0), 'retry');
  assert.equal(classifySyncError({}, 503), 'retry');
  assert.equal(classifySyncError({}, 429), 'retry');
  assert.equal(classifySyncError({ code: '23505', message: 'duplicate key' }, 409), 'drop');
  assert.equal(classifySyncError({ code: '42501', message: 'row-level security' }, 403), 'conflict');
  assert.equal(classifySyncError({ code: 'PGRST116' }, 404), 'conflict');
});

test('sync: backoff grows and stays capped', () => {
  const a = backoffMs(1, 0.5);        // deterministic jitter for the assertion
  const b = backoffMs(4, 0.5);
  const c = backoffMs(20, 1);         // worst-case jitter
  assert.equal(a, 1000);
  assert.equal(b, 8000);
  assert.ok(c <= 30000, `capped at 30s, got ${c}`);
  assert.ok(backoffMs(1, 0) >= 750, 'jitter never goes below 75% of the base');
});

test('sync: queued work is described in plain language', () => {
  const op = { table: 'invoices', type: 'update', patch: { patient_id: 'p1' } };
  assert.equal(describeOp(op, [{ id: 'p1', full_name: 'Asha Rao' }]), 'Edited invoice · Asha Rao');
});

test('permissions: the role matrix matches the RLS policy', () => {
  assert.ok(can('owner', 'team:write'));
  assert.ok(!can('doctor', 'team:write'));
  assert.ok(!can('frontdesk', 'consultation:write'), 'front desk cannot author clinical notes');
  assert.ok(can('frontdesk', 'invoice:collect'));
  assert.ok(!can('frontdesk', 'invoice:void'), 'front desk cannot void a paid invoice');
  assert.ok(can('doctor', 'consultation:write'));
  assert.ok(!can('doctor', 'clinic:settings'));
  assert.equal(can('owner', 'does:not:exist'), false, 'unknown capabilities fail closed');
  for (const role of ROLES) assert.ok(capabilitiesFor(role).size > 0);
  assert.equal(landingRouteFor('frontdesk'), '/app/queue', 'front desk lands on the queue');
});

test('versioning: comparison and schema drift detection', () => {
  assert.equal(compareVersions('1.2.0', '1.2.0'), 0);
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
  assert.equal(compareVersions('1.1.0', '1.2.0'), -1);
  assert.equal(schemaStatus(SCHEMA_VERSION).state, 'match');
  assert.equal(schemaStatus(SCHEMA_VERSION - 1).state, 'server-behind');
  assert.equal(schemaStatus(SCHEMA_VERSION + 1).state, 'client-behind');
  assert.equal(schemaStatus(null).state, 'unknown');
});

test('prescription: directions render in Indian languages', () => {
  const rx = { drug: 'Paracetamol 650mg', dose: '1 tablet', frequency: 'Twice a day', duration: '5 days', instructions: 'After food' };
  assert.equal(patientInstruction(rx, 'en'), 'after food · twice a day · for 5 days');
  assert.match(patientInstruction(rx, 'hi'), /दिन में दो बार/);
  assert.match(patientInstruction(rx, 'mr'), /दिवसातून दोन वेळा/);
  assert.match(patientInstruction(rx, 'ta'), /நாளுக்கு இரு முறை/);
  assert.match(patientInstruction(rx, 'bn'), /দিনে দুবার/);
  assert.match(patientInstruction(rx, 'te'), /రోజుకు రెండుసార్లు/);
  // the drug name is never translated
  assert.ok(!patientInstruction(rx, 'hi').includes('Paracetamol'));
  assert.equal(RX_LANGUAGES.length, 10);
});

test('prescription: unknown free-text durations are preserved, not dropped', () => {
  assert.deepEqual(durationParts('5 days'), { amount: 5, unit: 'days', raw: '5 days' });
  assert.equal(durationParts('2 weeks').unit, 'weeks');
  assert.equal(durationParts('till review').amount, null);
  assert.equal(frequencyKey('Twice a day'), 'bd');
  assert.equal(frequencyKey('SOS'), 'sos');
  assert.equal(frequencyKey('as the doctor said'), null);
  const out = patientInstruction({ drug: 'X', frequency: 'As directed', duration: 'till review' }, 'hi');
  assert.ok(out.includes('As directed') && out.includes('till review'));
});

// ---------------------------------------------------------------------------
// Offline replay against a fake database
// ---------------------------------------------------------------------------
import { replayOutbox } from '../src/lib/offline.js';

/** Minimal in-memory stand-in for PostgREST over one table. */
function fakeDb(seed = [], { failNext = null } = {}) {
  const rows = new Map(seed.map((r) => [r.id, { ...r }]));
  const calls = [];
  let fail = failNext;
  const maybeFail = () => {
    if (fail) { const e = fail; fail = null; throw e; }
  };
  return {
    rows, calls,
    async selectOne(table, filter) {
      calls.push(['selectOne', table, filter]);
      for (const r of rows.values()) {
        if (filter.id && r.id === filter.id) return { ...r };
        if (filter.client_id && r.client_id === filter.client_id) return { ...r };
      }
      return null;
    },
    async insert(table, row) {
      calls.push(['insert', table, row]);
      maybeFail();
      if ([...rows.values()].some((r) => r.client_id && r.client_id === row.client_id)) {
        const e = new Error('duplicate key value violates unique constraint');
        e.code = '23505'; e.status = 409; throw e;
      }
      rows.set(row.id, { ...row });
      return { ...row };
    },
    async update(table, id, patch) {
      calls.push(['update', table, id, patch]);
      maybeFail();
      const cur = rows.get(id);
      if (!cur) { const e = new Error('row not found'); e.code = 'PGRST116'; e.status = 404; throw e; }
      const next = { ...cur, ...patch };
      rows.set(id, next);
      return { ...next };
    },
    async remove(table, id) { calls.push(['remove', table, id]); rows.delete(id); },
  };
}

// op_id identifies the queued operation; id is the row it targets.
const opCreate = (row) => ({ op_id: 'op-create-1', type: 'create', table: 'patients', client_id: row.client_id, row, attempts: 0 });
const opUpdate = (id, patch, base, table = 'patients') => ({ op_id: 'op-update-1', type: 'update', table, id, patch, base, attempts: 0 });

test('offline replay: a queued create lands exactly once', async () => {
  const db = fakeDb();
  const row = { id: 'c1', client_id: 'c1', clinic_id: 'clinic1', full_name: 'Asha Rao', phone: '9000000001' };
  const { remaining, applied } = await replayOutbox({ ops: [opCreate(row)], db });
  assert.equal(remaining.length, 0, 'queue drained');
  assert.equal(applied.length, 1);
  assert.equal(db.rows.size, 1);
});

test('offline replay: replaying the same create twice does not duplicate', async () => {
  const db = fakeDb();
  const row = { id: 'c1', client_id: 'c1', clinic_id: 'clinic1', full_name: 'Asha Rao' };
  await replayOutbox({ ops: [opCreate(row)], db });
  // Same op replayed (app crashed before the outbox was cleared).
  const second = await replayOutbox({ ops: [opCreate(row)], db });
  assert.equal(second.remaining.length, 0);
  assert.equal(db.rows.size, 1, 'still one patient, not two');
  assert.ok(second.applied[0].deduped, 'the second run was recognised as already applied');
});

test('offline replay: non-conflicting edits merge into the server row', async () => {
  const server = { id: 'p1', clinic_id: 'c1', full_name: 'Asha', phone: '111', notes: 'old' };
  const db = fakeDb([server]);
  const op = opUpdate('p1', { notes: 'edited offline' }, { notes: 'old', phone: '111' });
  // Meanwhile reception changed the phone number.
  db.rows.set('p1', { ...server, phone: '222' });
  const { remaining, conflicts } = await replayOutbox({ ops: [op], db });
  assert.equal(conflicts.length, 0);
  assert.equal(remaining.length, 0);
  const row = db.rows.get('p1');
  assert.equal(row.notes, 'edited offline', 'offline edit kept');
  assert.equal(row.phone, '222', 'desk edit kept');
});

test('offline replay: a money conflict is surfaced, not written', async () => {
  const server = { id: 'i1', clinic_id: 'c1', status: 'unpaid', paid_paise: 0, total_paise: 500 };
  const db = fakeDb([server]);
  const op = opUpdate('i1', { status: 'paid', paid_paise: 500 }, { status: 'unpaid', paid_paise: 0 }, 'invoices');
  db.rows.set('i1', { ...server, status: 'void' });
  const { conflicts, remaining } = await replayOutbox({ ops: [op], db });
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].kind, 'field');
  assert.equal(remaining.length, 0, 'the op leaves the queue into the conflict list');
  assert.deepEqual(db.rows.get('i1'), { ...server, status: 'void' }, 'server row untouched');
});

test('offline replay: a row deleted elsewhere becomes a reviewable conflict', async () => {
  const db = fakeDb([]);
  const { conflicts, remaining } = await replayOutbox({
    ops: [opUpdate('gone', { notes: 'x' }, { notes: 'y' })], db,
  });
  assert.equal(conflicts[0].kind, 'deleted-remotely');
  assert.equal(remaining.length, 0);
});

test('offline replay: a network failure keeps the op and stops the run', async () => {
  const e = new Error('Failed to fetch'); e.status = 0;
  const db = fakeDb([], { failNext: e });
  const row = { id: 'c9', client_id: 'c9', clinic_id: 'c1', full_name: 'Nina' };
  const { remaining, stopped } = await replayOutbox({ ops: [opCreate(row)], db });
  assert.equal(remaining.length, 1, 'the change is not lost');
  assert.equal(remaining[0].attempts, 1);
  assert.ok(remaining[0].next_attempt_at > Date.now(), 'a retry time was scheduled');
  assert.equal(stopped.verdict, 'retry');
});

test('offline replay: a rejected op becomes a conflict instead of vanishing', async () => {
  const e = new Error('new row violates row-level security policy'); e.code = '42501'; e.status = 403;
  const db = fakeDb([], { failNext: e });
  const row = { id: 'c8', client_id: 'c8', clinic_id: 'c1', full_name: 'Ravi' };
  const { remaining, conflicts } = await replayOutbox({ ops: [opCreate(row)], db });
  assert.equal(remaining.length, 0);
  assert.equal(conflicts[0].kind, 'rejected');
  assert.match(conflicts[0].message, /row-level security/);
});

// ---------------------------------------------------------------- readiness
test('readiness: a fully configured project reports ready', () => {
  const checks = [
    ...configChecks({ url: 'https://abc.supabase.co', key: 'sb_publishable_abc123', base: './' }),
    restCheck({ ok: true }),
    schemaCheck(2, 2),
  ];
  const r = readiness(checks);
  assert.equal(r.state, 'pass');
  assert.equal(r.headline, 'Supabase connection ready');
  assert.equal(r.failed, 0);
});

test('readiness: a service-role key in a VITE_ variable is a hard fail', () => {
  const checks = configChecks({ url: 'https://abc.supabase.co', key: 'service_role_abc' });
  const key = checks.find((c) => c.id === 'env-key');
  assert.equal(key.state, 'fail');
  assert.match(key.detail, /service-role/);
  assert.equal(readiness(checks).state, 'fail');
});

test('readiness: a non-HTTPS project URL fails the secure-origin check', () => {
  const checks = configChecks({ url: 'http://abc.supabase.co', key: 'anon-key' });
  assert.equal(checks.find((c) => c.id === 'env-https').state, 'fail');
});

test('readiness: a rejected publishable key explains what to re-copy', () => {
  const c = restCheck({ ok: false, status: 401 });
  assert.equal(c.state, 'fail');
  assert.match(c.detail, /401|rejected|publishable/i);
  const unreachable = restCheck({ ok: false, message: 'Failed to fetch' });
  assert.match(unreachable.detail, /unreachable|paused/i);
});

test('readiness: schema drift is reported in both directions', () => {
  assert.equal(schemaCheck(null, 2).state, 'warn');
  assert.equal(schemaCheck(2, 2).state, 'pass');
  assert.match(schemaCheck(1, 2).detail, /re-run supabase\/schema\.sql/);
  assert.match(schemaCheck(3, 2).detail, /latest deployment/);
});

test('readiness: warnings alone do not claim readiness', () => {
  const r = readiness([{ id: 'a', label: 'A', state: 'pass', detail: '' }, { id: 'b', label: 'B', state: 'warn', detail: '' }]);
  assert.equal(r.state, 'warn');
  assert.match(r.headline, /1 check to confirm/);
});

// ---------------------------------------------------------------- licensing
const NOW = new Date('2026-11-03T09:00:00Z');
const day = (n) => new Date(NOW.getTime() + n * 86400000).toISOString();

test('licence: a fresh trial reports days left and allows writing', () => {
  const s = licenseState({ status: 'trial', plan: 'growth', trial_ends_at: day(9) }, NOW);
  assert.equal(s.status, 'trial');
  assert.equal(s.daysLeft, 9);
  assert.equal(canWrite(s), true);
  assert.match(licenseHeadline(s), /Trial · 9 days left/);
});

test('licence: an active plan renews and stays writable', () => {
  const s = licenseState({ status: 'active', plan: 'solo', current_period_end: day(30) }, NOW);
  assert.equal(s.status, 'active');
  assert.equal(canWrite(s), true);
  assert.match(licenseHeadline(s), /renews in 30 days/);
});

test('licence: 7 days of grace after the period ends, then read-only', () => {
  const grace = licenseState({ status: 'active', plan: 'growth', current_period_end: day(-3) }, NOW);
  assert.equal(grace.status, 'grace');
  assert.equal(canWrite(grace), true, 'grace still allows clinical work');
  assert.match(licenseHeadline(grace), /3 days grace left/);

  const lapsed = licenseState({ status: 'active', plan: 'growth', current_period_end: day(-30) }, NOW);
  assert.equal(lapsed.status, 'read_only');
  assert.equal(canWrite(lapsed), false, 'writes stop, reads never do');
  assert.equal(canRead(), true);
});

test('licence: an expired or missing subscription is read-only, not destructive', () => {
  for (const s of [licenseState({ status: 'expired', plan: 'growth' }, NOW), licenseState(null, NOW)]) {
    assert.equal(s.status, 'expired');
    assert.equal(canWrite(s), false);
    assert.match(licenseHeadline(s), /Expired/);
  }
});

test('licence: an overdue trial becomes read-only on the same day it ends', () => {
  assert.equal(licenseState({ status: 'trial', trial_ends_at: day(0) }, NOW).status, 'trial');
  assert.equal(licenseState({ status: 'trial', trial_ends_at: day(-1) }, NOW).status, 'read_only');
});

test('licence: seat limits match the plan and block one more seat', () => {
  const solo = seatUsage({ plan: 'solo' }, { doctors: 1, frontdesk: 1, branches: 1 });
  assert.deepEqual(solo.map((r) => r.limit), [1, 1, 1]);
  assert.ok(solo.every((r) => r.full));

  const growth = { plan: 'growth', status: 'active' };
  const usage = { doctors: 5, frontdesk: 1, branches: 1 };
  assert.equal(canAddSeat(growth, usage, 'doctors').allowed, false);
  assert.match(canAddSeat(growth, usage, 'doctors').message, /5 doctors seats/);
  assert.equal(canAddSeat(growth, usage, 'frontdesk').allowed, true);

  const chain = { plan: 'chain', status: 'active' };
  assert.equal(canAddSeat(chain, { doctors: 40 }, 'doctors').allowed, true, 'unlimited plan');
});

test('licence: read-only clinics cannot add staff even on an unlimited plan', () => {
  const v = canAddSeat({ plan: 'chain', status: 'read_only' }, { doctors: 1 }, 'doctors');
  assert.equal(v.allowed, false);
  assert.match(v.message, /renew/i);
});

test('licence: yearly pricing is 20% cheaper than twelve monthly payments', () => {
  for (const plan of ['solo', 'growth', 'chain']) {
    const m = planPrice(plan) * 12;
    const y = planPrice(plan, { interval: 'yearly' });
    assert.ok(y < m, `${plan}: yearly must beat monthly`);
    assert.equal(y, Math.round(m * 0.8));
  }
  const up = upgradeCost('solo', 'growth');
  assert.equal(up.direction, 'upgrade');
  assert.equal(up.delta, 249900 - 99900);
  assert.equal(upgradeCost('chain', 'solo').direction, 'downgrade');
  assert.equal(upgradeCost('growth', 'growth').direction, 'same');
});

test('licence: expiry formatting is stable and never shows a bad date', () => {
  assert.equal(formatExpiry(null), '—');
  assert.equal(formatExpiry('not-a-date'), '—');
  assert.match(formatExpiry('2026-12-03T00:00:00Z'), /Dec 2026/);
});

// ---------------------------------------------------------------- scheduling
import {
  availableSlots, buildDayBoard, detectClashes, explainConflict, groupSlots, intervalOf,
  overlaps, suggestNext, weekLoad,
} from '../src/lib/schedule.mjs';

const DOC = { id: 'doc-1', full_name: 'Dr Rao', day_start: '09:00', day_end: '12:00', slot_minutes: 15 };
const doc2 = { id: 'doc-2', full_name: 'Dr Sheikh', day_start: '16:00', day_end: '18:00', slot_minutes: 15 };
const on = '2026-11-04';
const appt = (id, at, duration = 15, status = 'booked', doctorId = 'doc-1') =>
  ({ id, doctor_id: doctorId, scheduled_on: on, scheduled_at: at, duration_minutes: duration, status, patient_id: `p-${id}` });

test('schedule: a 30-minute visit blocks both 15-minute rows it covers', () => {
  const list = [appt('a1', '09:00', 30)];
  const slots = availableSlots({ appointments: list, doctor: DOC, iso: on, duration: 15 });
  const byTime = Object.fromEntries(slots.map((s) => [s.time, s.free]));
  assert.equal(byTime['09:00'], false);
  assert.equal(byTime['09:15'], false, 'the second half of a 30-min booking is not free');
  assert.equal(byTime['09:30'], true);
  assert.equal(slots.length, 12, '09:00–12:00 in 15-minute steps');
});

test('schedule: a longer candidate slot needs a wider gap', () => {
  const list = [appt('a1', '09:00', 30)];
  const thirty = availableSlots({ appointments: list, doctor: DOC, iso: on, duration: 30 });
  assert.equal(thirty.find((s) => s.time === '09:15').free, false, 'no room for 30 min at 09:15');
  assert.equal(thirty.find((s) => s.time === '09:30').free, true);
});

test('schedule: cancelled and no-show appointments release their slot', () => {
  const list = [appt('a1', '09:00', 15, 'cancelled'), appt('a2', '09:15', 15, 'no-show')];
  const slots = availableSlots({ appointments: list, doctor: DOC, iso: on, duration: 15 });
  assert.equal(slots.find((s) => s.time === '09:00').free, true);
  assert.equal(slots.find((s) => s.time === '09:15').free, true);
});

test('schedule: other doctors and other days never block a slot', () => {
  const list = [
    appt('a1', '09:00', 15, 'booked', 'doc-2'),
    { ...appt('a2', '09:00'), scheduled_on: '2026-11-05' },
  ];
  const slots = availableSlots({ appointments: list, doctor: DOC, iso: on, duration: 15 });
  assert.ok(slots.every((s) => s.free));
});

test('schedule: clash detection reports the appointment that actually overlaps', () => {
  const list = [appt('a1', '09:00', 30), appt('a2', '10:00', 15)];
  const clash = detectClashes(list, { doctor_id: 'doc-1', scheduled_on: on, scheduled_at: '09:15', duration_minutes: 15 });
  assert.deepEqual(clash.map((c) => c.id), ['a1']);
  assert.match(explainConflict(clash[0], 'Asha'), /Asha already has 09:00–09:30/);
  // editing an existing appointment must not clash with itself
  assert.equal(detectClashes(list, { id: 'a1', doctor_id: 'doc-1', scheduled_on: on, scheduled_at: '09:00', duration_minutes: 30 }).length, 0);
  // starting inside a running visit is a clash
  assert.equal(detectClashes(list, { doctor_id: 'doc-1', scheduled_on: on, scheduled_at: '09:20', duration_minutes: 15 }).length, 1);
  // ...but the moment that visit ends, the room is free again
  assert.equal(detectClashes(list, { doctor_id: 'doc-1', scheduled_on: on, scheduled_at: '09:30', duration_minutes: 30 }).length, 0);
  assert.equal(detectClashes(list, { doctor_id: 'doc-1', scheduled_on: on, scheduled_at: '10:15', duration_minutes: 15 }).length, 0);
});

test('schedule: intervals are half-open, so touching bookings do not overlap', () => {
  assert.equal(overlaps({ scheduled_on: on, scheduled_at: '09:00', duration_minutes: 30 }, { scheduled_on: on, scheduled_at: '09:30', duration_minutes: 30 }), false);
  assert.equal(overlaps({ scheduled_on: on, scheduled_at: '09:00', duration_minutes: 31 }, { scheduled_on: on, scheduled_at: '09:30', duration_minutes: 30 }), true);
  assert.equal(overlaps({ scheduled_on: on, scheduled_at: '09:00' }, { scheduled_on: '2026-11-05', scheduled_at: '09:00' }), false);
  assert.deepEqual(intervalOf({ scheduled_at: '09:00:00', duration_minutes: 45 }), { start: 540, end: 585, duration: 45 });
  assert.equal(intervalOf({ scheduled_at: '09:00', duration_minutes: 0 }).duration, 15, 'bad duration falls back');
});

test('schedule: the day board labels every slot and computes utilisation', () => {
  const list = [appt('a1', '09:00', 30, 'completed'), appt('a2', '10:00', 15, 'checked-in'), appt('a3', '10:30', 15, 'booked')];
  const board = buildDayBoard({ doctors: [DOC], appointments: list, iso: on, now: new Date('2026-11-04T10:10:00') });
  const col = board.columns[0];
  const state = Object.fromEntries(col.slots.map((s) => [s.time, s.state]));
  assert.equal(state['09:00'], 'done');
  // The board's clock is the one injected here (10:10), so the other half of the
  // 09:00–09:30 block has already gone by: it is history, not a bookable slot.
  assert.equal(state['09:15'], 'past', 'a slot behind the injected clock is past, never free');
  assert.equal(state['10:00'], 'live');
  assert.equal(state['10:30'], 'booked');
  assert.equal(col.stats.total, 3);
  assert.equal(col.stats.live, 1);
  assert.equal(col.stats.utilisation, Math.min(100, Math.round((60 / 180) * 100)), '60 booked minutes of a 180-minute session');
  assert.equal(board.summary.total, 3);
});


test('schedule: the board believes the injected clock, not the wall clock', () => {
  // Guards a real bug: "past" used to be decided from today(), so the same input
  // produced different boards on different days and a date-pinned test flipped
  // the moment its date arrived.
  const list = [appt('a1', '10:00', 15, 'booked')];
  const morning = buildDayBoard({ doctors: [DOC], appointments: list, iso: on, now: new Date(`${on}T08:00:00`) });
  const evening = buildDayBoard({ doctors: [DOC], appointments: list, iso: on, now: new Date(`${on}T20:00:00`) });
  const dayBefore = buildDayBoard({ doctors: [DOC], appointments: list, iso: on, now: new Date(`${on}T08:00:00`) });

  const stateOf = (board) => Object.fromEntries(board.columns[0].slots.map((s) => [s.time, s.state]));
  assert.equal(stateOf(morning)['09:15'], 'free', 'before the session starts every empty slot is bookable');
  assert.equal(stateOf(evening)['09:15'], 'past', 'after the session the same slot is history');
  assert.equal(stateOf(dayBefore)['10:00'], 'booked', 'a booking stays booked regardless of the clock');
  assert.equal(stateOf(evening)['10:00'], 'booked');
});

test('schedule: appointments off the slot grid are still surfaced', () => {
  const list = [appt('a1', '09:07', 15)];
  const board = buildDayBoard({ doctors: [DOC], appointments: list, iso: on });
  assert.equal(board.columns[0].offGrid.length, 1, 'no booking may silently disappear from the board');
  assert.equal(board.columns[0].offGrid[0].id, 'a1');
});

test('schedule: suggestNext picks the earliest free slot across doctors', () => {
  const list = [appt('a1', '09:00', 15, 'booked', 'doc-1')];
  const next = suggestNext({ doctors: [DOC, doc2], appointments: list, iso: on, duration: 15 });
  assert.equal(next.time, '09:15');
  assert.equal(next.doctor_id, 'doc-1');
  const onlyLate = suggestNext({ doctors: [doc2], appointments: [], iso: on, duration: 15 });
  assert.equal(onlyLate.time, '16:00', 'a doctor whose session starts at 16:00 is offered at 16:00');
});

test('schedule: the week view reports load per day', () => {
  const list = [appt('a1', '09:00', 15), appt('a2', '09:15', 15)];
  const week = weekLoad({ doctors: [DOC], appointments: list, startIso: on, days: 3, now: new Date('2026-11-04T08:00:00') });
  assert.equal(week.length, 3);
  assert.equal(week[0].iso, on);
  assert.equal(week[0].total, 2);
  assert.equal(week[0].isToday, true);
  assert.equal(week[1].total, 0);
});

test('schedule: slots are grouped into the sessions a front desk talks about', () => {
  const slots = availableSlots({ appointments: [], doctor: { ...DOC, day_end: '19:00' }, iso: on, duration: 15 });
  const groups = groupSlots(slots);
  assert.deepEqual(groups.map((g) => g.label), ['Morning', 'Afternoon', 'Evening']);
  assert.ok(groups.every((g) => g.slots.length > 0));
});

// ---------------------------------------------------------------- branding
import {
  LOGO_KINDS, LOGO_MAX_BYTES, acceptLogo, anyLogo, brandKit, clinicInitials, dataUrlBytes,
  fitWithin, formatBytes, isSvgSafe, logoFor, logoKind, logoOnDocuments, sniffImageMime,
  validateLogoFile,
} from '../src/lib/branding.mjs';

const PNG_1PX = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG_HEAD = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const WEBP_HEAD = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
]);
const SVG_OK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';

test('branding: image types are identified from bytes, not from the file name', () => {
  assert.equal(sniffImageMime(PNG_1PX), 'image/png');
  assert.equal(sniffImageMime(JPEG_HEAD), 'image/jpeg');
  assert.equal(sniffImageMime(WEBP_HEAD), 'image/webp');
  assert.equal(sniffImageMime(new Uint8Array([0x47, 0x49, 0x46, 0x38])), null, 'GIF is refused');
  assert.equal(sniffImageMime(new TextEncoder().encode('<svg>')), null, 'SVG is text, not a magic number');
  assert.equal(sniffImageMime(new Uint8Array(0)), null);
});

test('branding: a file renamed to .png is still rejected', () => {
  const verdict = acceptLogo({ mime: sniffImageMime(new TextEncoder().encode('not an image')), size: 900 });
  assert.equal(verdict.ok, false);
  assert.match(verdict.error, /PNG, JPEG, WebP or SVG/);
});

test('branding: uploads over the cap are refused with a readable message', () => {
  const big = validateLogoFile({ name: 'logo.png', type: 'image/png', size: LOGO_MAX_BYTES + 1 });
  assert.equal(big.ok, false);
  assert.match(big.error, /Keep the logo under 2\.0 MB/);
  assert.match(big.error, /That file is 2\.0 MB/, 'the message says how big the file actually is');
  assert.equal(validateLogoFile({ name: 'logo.png', type: 'image/png', size: 400_000 }).ok, true);
  assert.equal(validateLogoFile({ name: 'logo.pdf', type: 'application/pdf', size: 1000 }).ok, false);
  assert.equal(validateLogoFile({ name: 'empty.png', type: 'image/png', size: 0 }).ok, false);
});

test('branding: SVG logos are accepted only when they carry no script or remote refs', () => {
  assert.equal(isSvgSafe(SVG_OK), true);
  assert.equal(isSvgSafe('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), false);
  assert.equal(isSvgSafe('<svg onload="alert(1)"></svg>'), false);
  assert.equal(isSvgSafe('<svg><image href="https://evil.example/x.png"/></svg>'), false);
  assert.equal(isSvgSafe('<svg><use xlink:href="//evil.example/s.svg#a"/></svg>'), false);
  assert.equal(isSvgSafe('<svg><style>@import url(//evil.example)</style></svg>'), false);
  assert.equal(isSvgSafe('<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y">]><svg/>'), false);
  assert.equal(isSvgSafe('just text'), false);
  // a local fragment reference is legitimate
  assert.equal(isSvgSafe('<svg xmlns="http://www.w3.org/2000/svg"><use xlink:href="#mark"/></svg>'), true);

  assert.equal(acceptLogo({ mime: 'image/svg+xml', size: 200, svgText: SVG_OK }).ok, true);
  assert.equal(acceptLogo({ mime: 'image/svg+xml', size: 200, svgText: '<svg><script>x</script></svg>' }).ok, false);
  assert.equal(acceptLogo({ mime: 'image/svg+xml', size: 999_999, svgText: SVG_OK }).ok, false, 'vector cap is tighter');
});

test('branding: logos fit inside their box without cropping or upscaling', () => {
  assert.deepEqual(fitWithin(1024, 1024, 512), { width: 512, height: 512, scaled: true });
  assert.deepEqual(fitWithin(2000, 500, 1024), { width: 1024, height: 256, scaled: true }, 'wide keeps its aspect');
  assert.deepEqual(fitWithin(300, 120, 512), { width: 300, height: 120, scaled: false }, 'never upscales');
  assert.deepEqual(fitWithin(0, 0, 512), { width: 1, height: 1, scaled: false });
  assert.equal(logoKind('wide').maxEdge, 1024);
  assert.equal(logoKind('nonsense').id, 'square');
  assert.equal(LOGO_KINDS.length, 2);
});

test('branding: square is preferred, wide stands in, neither shows nothing', () => {
  const both = { logo_square_url: 'data:image/png;base64,AAA', logo_wide_url: 'data:image/png;base64,BBB' };
  assert.equal(logoFor(both, 'square'), 'data:image/png;base64,AAA');
  assert.equal(logoFor(both, 'wide'), 'data:image/png;base64,BBB');
  assert.equal(logoFor(both), 'data:image/png;base64,AAA', 'square is the default (avatars, favicons)');

  const wideOnly = { logo_wide_url: 'data:image/png;base64,BBB' };
  assert.equal(logoFor(wideOnly, 'square'), null);
  assert.equal(anyLogo(wideOnly), 'data:image/png;base64,BBB', 'one upload is enough to start');

  assert.equal(logoFor({}, 'square'), null);
  assert.equal(anyLogo(null), null);
  // anything that is not a data URL is ignored, so a URL cannot be injected
  assert.equal(logoFor({ logo_square_url: 'https://evil.example/x.png' }, 'square'), null);
  assert.equal(logoFor({ logo_square_url: 'javascript:alert(1)' }, 'square'), null);
});

test('branding: the print toggle defaults on and can be turned off', () => {
  assert.equal(logoOnDocuments({}), true);
  assert.equal(logoOnDocuments(null), true);
  assert.equal(logoOnDocuments({ logo_on_documents: false }), false);
  assert.equal(logoOnDocuments({ logo_on_documents: true }), true);
});

test('branding: the brand kit is the single object every channel reads', () => {
  const kit = brandKit({
    name: 'Sunrise Multispecialty OPD', brand_color: '#0f766e',
    logo_square_url: 'data:image/png;base64,AAA',
    phone: '+91 22 4000 1200', email: 'desk@sunrise.in', address: 'Bandra West, Mumbai', gstin: '27ABCDE1234F1Z5',
  });
  assert.equal(kit.name, 'Sunrise Multispecialty OPD');
  assert.equal(kit.initials, 'SO');
  assert.equal(kit.color, '#0f766e');
  assert.equal(kit.square, 'data:image/png;base64,AAA');
  assert.equal(kit.primary, 'data:image/png;base64,AAA', 'what a WhatsApp profile or email avatar would use');
  assert.equal(kit.wide, null);
  assert.equal(kit.onDocuments, true);
  assert.equal(kit.phone, '+91 22 4000 1200');
  // never throws on a half-built clinic
  const bare = brandKit({});
  assert.equal(bare.color, '#0f766e');
  assert.equal(bare.initials, 'CL', 'a nameless clinic still gets a usable lettermark');
  assert.equal(brandKit(null).name, 'Clinic');
});

test('branding: initials fall back sensibly for odd clinic names', () => {
  assert.equal(clinicInitials('Sunrise Multispecialty OPD'), 'SO');
  assert.equal(clinicInitials('Clinic'), 'CL');
  assert.equal(clinicInitials('  '), 'C');
  assert.equal(clinicInitials(undefined), 'C');
  assert.equal(clinicInitials('Dr Rao'), 'DR');
});

test('branding: stored weight is measured the way the data URL actually grows', () => {
  // 4 base64 chars carry 3 bytes
  assert.equal(dataUrlBytes('data:image/png;base64,AAAA'), 3);
  assert.equal(dataUrlBytes('data:image/png;base64,AAA='), 2);
  assert.equal(dataUrlBytes('data:image/png;base64,'), 0);
  assert.equal(dataUrlBytes(null), 0);
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(4096), '4 KB');
  assert.equal(formatBytes(2 * 1024 * 1024), '2.0 MB');
});
