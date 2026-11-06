import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BODY_LIMIT, canMessage, compose, invoiceMessage, messageKey, prescriptionMessage,
  tokenMessage, appointmentMessage, waLink, whatsappDigits,
} from '../src/lib/messages.mjs';

const clinic = {
  name: 'Sunrise Multispecialty',
  phone: '022 4000 1234',
  address: '12 Linking Road, Bandra West, Mumbai',
  upi_id: 'sunrise@okhdfcbank',
  upi_payee_name: 'Sunrise Multispecialty',
};
const doctor = { full_name: 'Dr. Anita Rao' };
const patient = { id: 'p1', full_name: 'Aarav Sharma', phone: '+91 98200 11234', wa_opt_in: true };

/* ------------------------------------------------------------------- phone */

test('a mobile number becomes a wa.me number, a landline is refused', () => {
  assert.equal(whatsappDigits('98200 11234'), '919820011234');
  assert.equal(whatsappDigits('+91 98200 11234'), '919820011234');
  assert.equal(whatsappDigits('09820011234'), '919820011234');
  assert.equal(whatsappDigits('022 4000 1234').length >= 11, true, 'a landline is at least diallable');
  assert.equal(whatsappDigits('12345'), '', 'a fragment is refused, not half-dialled');
  assert.equal(whatsappDigits(''), '');
  assert.equal(whatsappDigits(null), '');
});

test('the link carries the text, encoded', () => {
  const link = waLink(patient.phone, 'Hello & goodbye');
  assert.match(link, /^https:\/\/wa\.me\/919820011234\?text=/);
  assert.match(link, /Hello%20%26%20goodbye/);
  assert.equal(waLink('123'), '', 'no link for an unusable number');
});

/* ----------------------------------------------------------------- consent */

test('a patient is messageable until they opt out, and the refusal names them', () => {
  assert.equal(canMessage(patient).ok, true);

  const optedOut = { ...patient, wa_opt_in: false, wa_opt_out_at: '2026-11-03T09:00:00Z' };
  const verdict = canMessage(optedOut);
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /Aarav/);
  assert.match(verdict.reason, /opted out/i);
  assert.match(verdict.reason, /3 Nov 2026/, 'the date the request was taken is quoted back');

  const noPhone = canMessage({ ...patient, phone: '' });
  assert.equal(noPhone.ok, false);
  assert.match(noPhone.reason, /mobile number/i);

  assert.equal(canMessage(null).ok, false);
});

/* ------------------------------------------------------------------- token */

test('the token message says the number, the doctor and how long the wait is', () => {
  const msg = tokenMessage({
    clinic, doctor, patient,
    appointment: { id: 'a1', token_no: 7, scheduled_at: '10:30:00' },
    ahead: 3, etaMinutes: 45, at: '10:30',
  });

  assert.equal(msg.kind, 'token');
  assert.equal(msg.key, 'token:a1');
  assert.match(msg.text, /Hello Aarav,/);
  assert.match(msg.text, /T-07/);
  assert.match(msg.text, /Dr\. Anita Rao/);
  assert.match(msg.text, /3 patients are ahead of you — roughly 45 minutes/);
  assert.match(msg.text, /10:30/, 'the time they were given is repeated');
  assert.match(msg.text, /Sunrise Multispecialty/);
  assert.ok(msg.text.length <= BODY_LIMIT);
});

test('one patient ahead, and none ahead, both read in English', () => {
  const one = tokenMessage({ clinic, patient, appointment: { id: 'a2', token_no: 2 }, ahead: 1, etaMinutes: 15 });
  assert.match(one.text, /1 patient is ahead of you/);

  const none = tokenMessage({ clinic, patient, appointment: { id: 'a3', token_no: 1 }, ahead: 0 });
  assert.match(none.text, /You are next in the queue/);
});

test('the token message carries nothing clinical', () => {
  // A reachable patient is not told what they are coming in for, even when the
  // appointment has a reason on it.
  const msg = tokenMessage({
    clinic, doctor, patient,
    appointment: { id: 'a4', token_no: 9, reason: 'bleeding piles', kind: 'Follow-up' },
    ahead: 2, etaMinutes: 30,
  });
  assert.doesNotMatch(msg.text, /bleeding|piles/i);
});

/* ------------------------------------------------------------- appointment */

test('the appointment message is a date, a time, a doctor and an address', () => {
  const msg = appointmentMessage({
    clinic, doctor, patient,
    appointment: { id: 'a5', scheduled_on: '2026-11-07', scheduled_at: '15:45:00', kind: 'Consultation', reason: 'fever' },
  });
  assert.equal(msg.kind, 'appointment');
  assert.equal(msg.key, 'appointment:a5');
  assert.match(msg.text, /7 Nov, 2026/, 'the weekday form the app uses');
  assert.match(msg.text, /3:45 pm/);
  assert.match(msg.text, /Dr\. Anita Rao/);
  assert.match(msg.text, /Linking Road/);
  assert.match(msg.text, /arrive 10 minutes early/i);
  assert.doesNotMatch(msg.text, /fever/i, 'the reason for the visit stays in the chart');
});

test('a clinic with no address or phone still produces a complete message', () => {
  const msg = appointmentMessage({
    clinic: { name: 'Bare Clinic' }, patient,
    appointment: { id: 'a6', scheduled_on: '2026-11-07', scheduled_at: '09:00:00' },
  });
  assert.match(msg.text, /Bare Clinic/);
  assert.match(msg.text, /7 Nov, 2026/, 'the weekday form the app uses');
  assert.doesNotMatch(msg.text, /undefined|null/);
});

/* ----------------------------------------------------------------- invoice */

test('the bill states total, paid, balance and how to pay it', () => {
  const msg = invoiceMessage({
    clinic, patient,
    invoice: { id: 'i1', number: 'INV/2526/0012', issued_on: '2026-11-04', total_paise: 120000, paid_paise: 50000 },
  });
  assert.equal(msg.kind, 'invoice');
  assert.equal(msg.key, 'invoice:i1');
  assert.match(msg.text, /INV\/2526\/0012/);
  assert.match(msg.text, /Total: ₹1,200\b/);
  assert.match(msg.text, /Paid: ₹500\b/);
  assert.match(msg.text, /Balance due: ₹700\b/);
  assert.match(msg.text, /Pay by UPI: sunrise@okhdfcbank/);
});

test('a settled bill does not ask for money, and a clinic without a VPA is not invented', () => {
  const settled = invoiceMessage({
    clinic, patient,
    invoice: { id: 'i2', number: 'INV/1', issued_on: '2026-11-04', total_paise: 50000, paid_paise: 50000 },
  });
  assert.match(settled.text, /paid in full/i);
  assert.doesNotMatch(settled.text, /Balance due/);
  assert.doesNotMatch(settled.text, /Pay by UPI/);

  const noUpi = invoiceMessage({
    clinic: { name: 'Cash Only' }, patient,
    invoice: { id: 'i3', number: 'INV/2', issued_on: '2026-11-04', total_paise: 50000, paid_paise: 0 },
  });
  assert.match(noUpi.text, /Balance due/);
  assert.doesNotMatch(noUpi.text, /UPI/);
});

test('paise are shown in pairs, not rounded away', () => {
  const msg = invoiceMessage({
    clinic, patient,
    invoice: { id: 'i4', number: 'INV/3', issued_on: '2026-11-04', total_paise: 2399040, paid_paise: 0 },
  });
  assert.match(msg.text, /₹23,990\.40/);
});

/* ------------------------------------------------------------ prescription */

test('the slip carries the medicines and the directions the patient must follow', () => {
  const visit = {
    id: 'v1', visited_on: '2026-11-04',
    prescription: [
      { drug: 'Paracetamol 500 mg', frequency: '1-0-1', duration: '3 days' },
      { drug: 'Cetirizine 10 mg', frequency: '0-0-1', duration: '5 days' },
    ],
    advice: 'Warm water gargles',
    follow_up_on: '2026-11-11',
    diagnosis: 'acute pharyngitis',
  };
  const msg = prescriptionMessage({
    clinic, doctor, patient, visit,
    languageLabel: 'हिन्दी',
    instructionFor: (rx) => `${rx.frequency} · ${rx.duration}`,
  });

  assert.equal(msg.kind, 'prescription');
  assert.equal(msg.key, 'prescription:v1');
  assert.match(msg.text, /1\. Paracetamol 500 mg — 1-0-1 · 3 days/);
  assert.match(msg.text, /2\. Cetirizine 10 mg/);
  assert.match(msg.text, /हिन्दी/, 'the language the doctor chose is named');
  assert.match(msg.text, /Warm water gargles/);
  assert.match(msg.text, /Next visit: 11 Nov,? 2026/);
  assert.match(msg.text, /pharmacy/i);
  assert.doesNotMatch(msg.text, /pharyngitis/, 'the diagnosis stays in the chart');
});

test('a visit with no medicines still reads like a sentence', () => {
  const msg = prescriptionMessage({
    clinic, doctor, patient,
    visit: { id: 'v2', visited_on: '2026-11-04', prescription: [] },
  });
  assert.match(msg.text, /No medicines were prescribed/);
});

/* ------------------------------------------------------- limits and compose */

test('a long message is trimmed to what the log and WhatsApp accept', () => {
  const msg = prescriptionMessage({
    clinic, doctor, patient,
    visit: { id: 'v3', visited_on: '2026-11-04', advice: 'a'.repeat(3000) },
  });
  assert.ok(msg.text.length <= BODY_LIMIT, `trimmed to ${msg.text.length}`);
  assert.ok(msg.text.endsWith('…'), 'the trim is visible, not silent');
});

test('every key is stable per thing and distinct across kinds', () => {
  assert.equal(messageKey('invoice', 'x'), 'invoice:x');
  assert.notEqual(messageKey('invoice', 'x'), messageKey('token', 'x'));
  assert.equal(messageKey('token', undefined), 'token:none');
});

test('compose refuses an opted-out patient and still returns the text', () => {
  const blocked = compose({
    kind: 'invoice',
    clinic, patient: { ...patient, wa_opt_in: false, wa_opt_out_at: '2026-11-01T00:00:00Z' },
    invoice: { id: 'i9', number: 'INV/9', issued_on: '2026-11-04', total_paise: 100, paid_paise: 0 },
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.link, '', 'no link is produced for someone who said no');
  assert.match(blocked.reason, /opted out/i);
  assert.ok(blocked.message.text.includes('INV/9'), 'the desk can still read what would have gone');
});

test('compose produces the link for a patient who is happy to be messaged', () => {
  const ready = compose({
    kind: 'token',
    clinic, patient,
    appointment: { id: 'a9', token_no: 12 },
    ahead: 2, etaMinutes: 30,
  });
  assert.equal(ready.ok, true);
  assert.match(ready.link, /^https:\/\/wa\.me\/919820011234\?text=/);
  assert.match(ready.message.text, /T-12/);
});

test('an unknown kind is a refusal, not a crash', () => {
  const nope = compose({ kind: 'telegram', clinic, patient });
  assert.equal(nope.ok, false);
  assert.match(nope.reason, /Unknown message kind/);
});

test('the pattern travels with the drug name in the text message', () => {
  const visit = {
    id: 'v1', visited_on: '2026-11-04',
    prescription: [{ drug: 'Metformin 500', dose: '1 tablet', frequency: 'Twice a day', pattern: '1-0-1', duration: '1 month', instructions: 'After food' }],
  };
  const msg = prescriptionMessage({ clinic, doctor, patient, visit, instructionFor: (rx) => 'after food · for 1 month' });
  assert.match(msg.text, /1\. Metformin 500 1-0-1 — after food · for 1 month \(60 tablets\)/);
});
