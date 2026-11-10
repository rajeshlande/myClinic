/**
 * Human-facing identifiers: patient codes, invoice numbers, prescription
 * numbers and the local id generator.
 *
 * Split out of `logic.mjs` in v1.29.0. These are the strings a clinic reads out
 * loud, so the series live together.
 */

import { financialYear, today } from './dates.mjs';

export function patientCode(seq, prefix = 'PT') {
  return `${prefix}-${String(seq).padStart(5, '0')}`;
}

export function invoiceNumber(seq, date = today()) {
  const fy = financialYear(date);
  return `INV/${fy}/${String(seq).padStart(4, '0')}`;
}
/** RX/26-27/0007 — the prescription's own number, independent of the invoice. */

export function nextRxNumber(consultations = [], date = today()) {
  const prefix = `RX/${financialYear(date)}/`;
  let max = 0;
  for (const visit of consultations) {
    const value = String(visit?.rx_number ?? '');
    if (!value.startsWith(prefix)) continue;
    const seq = Number(value.slice(prefix.length));
    if (Number.isFinite(seq) && seq > max) max = seq;
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

export function nextId(prefix = 'id') {
  const rand = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}-${rand}`;
}
