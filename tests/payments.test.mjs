import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amountInWords, applyPayment, invoiceBalance } from '../src/lib/logic.mjs';
import {
  buildUpiUri, invoiceUpiLink, isValidUpiId, normaliseVpa, upiPayeeName,
} from '../src/lib/upi.mjs';

// --------------------------------------------------------------------------- UPI

test('a UPI ID is trimmed and lower-cased before it is used', () => {
  assert.equal(normaliseVpa('  Sunrise.OPD@OKICICI '), 'sunrise.opd@okicici');
});

test('UPI IDs are checked for the shape that breaks real apps', () => {
  assert.equal(isValidUpiId('sunrise.opd@okicici'), true);
  assert.equal(isValidUpiId('clinic@ybl'), true);
  assert.equal(isValidUpiId('a@b1'), true);             // short but well-formed
  assert.equal(isValidUpiId('clinic@1bank'), false);    // PSP must start with a letter
  assert.equal(isValidUpiId('sunrise.opd'), false);     // no PSP
  assert.equal(isValidUpiId('@okicici'), false);        // no handle
  assert.equal(isValidUpiId('sun rise@okicici'), false); // space
  assert.equal(isValidUpiId(''), false);
});

test('the payee name falls back to the clinic name', () => {
  assert.equal(upiPayeeName({ upi_payee_name: 'Sunrise OPD', name: 'Ignored' }), 'Sunrise OPD');
  assert.equal(upiPayeeName({ upi_payee_name: '', name: 'Sunrise Multispecialty OPD' }), 'Sunrise Multispecialty OPD');
  assert.equal(upiPayeeName({}), 'Clinic');
});

test('the UPI link carries the exact amount in rupees to two decimals', () => {
  const uri = buildUpiUri({ vpa: 'sunrise.opd@okicici', name: 'Sunrise OPD', amountPaise: 60000 });
  assert.ok(uri.startsWith('upi://pay?'));
  assert.match(uri, /pa=sunrise\.opd%40okicici/);
  assert.match(uri, /am=600\.00/);
  assert.match(uri, /cu=INR/);
});

test('a UPI link never encodes spaces as "+" (apps show them literally)', () => {
  const uri = buildUpiUri({ vpa: 'c@ybl', name: 'Sunrise OPD', amountPaise: 100, note: 'Invoice INV/1' });
  assert.ok(uri.includes('Invoice%20INV%2F1'));
  assert.ok(!uri.includes('+'));
});

test('no usable VPA means no link, so the UI can render nothing', () => {
  assert.equal(buildUpiUri({ vpa: '', name: 'Clinic', amountPaise: 500 }), null);
  assert.equal(buildUpiUri({ vpa: 'not-a-vpa', name: 'Clinic', amountPaise: 500 }), null);
});

test('a zero or negative amount is left out of the link', () => {
  const uri = buildUpiUri({ vpa: 'c@ybl', name: 'Clinic', amountPaise: 0 });
  assert.ok(uri && !uri.includes('am='));
  const negative = buildUpiUri({ vpa: 'c@ybl', name: 'Clinic', amountPaise: -500 });
  assert.ok(negative && !negative.includes('am='));
});

test('the invoice link pays the open balance and names the invoice', () => {
  const invoice = { number: 'INV/2526/0007', total_paise: 60000, paid_paise: 25000 };
  const uri = invoiceUpiLink(invoice, { upi_id: 'sunrise.opd@okicici', name: 'Sunrise OPD' });
  assert.match(uri, /am=350\.00/);
  assert.match(uri, /INV%2F2526%2F0007/);
});

// ------------------------------------------------------------------- payments

test('a full payment settles the invoice', () => {
  const result = applyPayment({ total_paise: 60000, paid_paise: 0 }, 60000);
  assert.deepEqual(
    { applied: result.applied, paid: result.paid, status: result.status, balance: result.balance },
    { applied: 60000, paid: 60000, status: 'paid', balance: 0 },
  );
});

test('a part payment leaves the balance open and reports the overshoot', () => {
  const result = applyPayment({ total_paise: 60000, paid_paise: 0 }, 25000);
  assert.equal(result.status, 'partial');
  assert.equal(result.balance, 35000);

  const over = applyPayment({ total_paise: 60000, paid_paise: 50000 }, 25000);
  assert.equal(over.applied, 10000);   // capped at what is actually owed
  assert.equal(over.overshoot, 15000); // and the rest is reported, never stored
  assert.equal(over.paid, 60000);
  assert.equal(over.status, 'paid');
});

test('an over-tendered invoice can never store more than its total', () => {
  const invoice = { total_paise: 60000, paid_paise: 0 };
  const result = applyPayment(invoice, 999999);
  const updated = { ...invoice, paid_paise: result.paid };
  assert.equal(invoiceBalance(updated), 0);
  assert.ok(result.paid <= invoice.total_paise);
});

test('paying a settled invoice applies nothing', () => {
  const result = applyPayment({ total_paise: 60000, paid_paise: 60000 }, 5000);
  assert.equal(result.applied, 0);
  assert.equal(result.status, 'paid');
});

// ------------------------------------------------------------------- words

test('invoice totals read correctly in words, Indian grouping', () => {
  assert.equal(amountInWords(60000), 'Rupees Six Hundred Only');
  assert.equal(amountInWords(0), 'Rupees Zero Only');
  assert.equal(amountInWords(143756), 'Rupees One Thousand Four Hundred Thirty Seven and Fifty Six Paise Only');
  assert.equal(amountInWords(12500000), 'Rupees One Lakh Twenty Five Thousand Only');
  // 10^12 paise = 1,000 crore rupees
  assert.equal(amountInWords(1000000000000), 'Rupees One Thousand Crore Only');
});
