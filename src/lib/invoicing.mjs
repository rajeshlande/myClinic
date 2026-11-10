/**
 * Invoice arithmetic: lines, totals, status, balance.
 *
 * Split out of `logic.mjs` in v1.29.0. Money is integer paise; tax is applied per
 * line, and `computeInvoice` is the only place a total is assembled.
 */

export const DEFAULT_SERVICES = [
  { id: 'svc-consult', name: 'Consultation', category: 'Consultation', price_paise: 50000, hsn: '999312' },
  { id: 'svc-followup', name: 'Follow-up visit', category: 'Consultation', price_paise: 25000, hsn: '999312' },
  { id: 'svc-procedure', name: 'Minor procedure', category: 'Procedure', price_paise: 150000, hsn: '999312' },
  { id: 'svc-dressing', name: 'Wound dressing', category: 'Procedure', price_paise: 40000, hsn: '999312' },
  { id: 'svc-vitals', name: 'Vitals & screening', category: 'Diagnostics', price_paise: 20000, hsn: '999312' },
  { id: 'svc-ecg', name: 'ECG', category: 'Diagnostics', price_paise: 45000, hsn: '999312' },
  { id: 'svc-vaccine', name: 'Vaccination (admin)', category: 'Procedure', price_paise: 30000, hsn: '999312' },
  { id: 'svc-cert', name: 'Medical certificate', category: 'Document', price_paise: 20000, hsn: '999312' },
];

/** Computes a line item's taxable value, tax and total. */

export function computeLine({ qty = 1, rate_paise = 0, discount = 0, tax_rate = 0 }) {
  const grossPaise = Math.round(Number(qty) * Number(rate_paise));
  const discountPaise = Math.min(grossPaise, Math.round(Number(discount) || 0));
  const taxable = grossPaise - discountPaise;
  const taxPaise = Math.round((taxable * Number(tax_rate)) / 100);
  return { grossPaise, discountPaise, taxable, taxPaise, total: taxable + taxPaise };
}

/** Full invoice maths. `lines` are raw draft lines; returns rounded totals. */

export function computeInvoice({ lines = [], discount = 0, gst_enabled = true, paid = 0 } = {}) {
  const rows = lines.map((line) => {
    const computed = computeLine({ ...line, tax_rate: gst_enabled ? line.tax_rate ?? 0 : 0 });
    return { ...line, ...computed };
  });
  const subtotal = rows.reduce((t, r) => t + r.grossPaise, 0);
  const lineDiscount = rows.reduce((t, r) => t + r.discountPaise, 0);
  const billDiscount = Math.min(subtotal - lineDiscount, Math.round(Number(discount) || 0));
  const taxable = rows.reduce((t, r) => t + r.taxable, 0) - billDiscount;
  const tax = rows.reduce((t, r) => t + r.taxPaise, 0);
  const total = taxable + tax;
  const paidPaise = Math.min(Math.max(0, Math.round(Number(paid) || 0)), total);
  return {
    rows: rows.map((r) => ({ ...r, total: r.taxable + r.taxPaise })),
    subtotal, lineDiscount, billDiscount, taxable, tax, total,
    paid: paidPaise, balance: total - paidPaise,
    status: total === 0 ? 'draft' : paidPaise >= total ? 'paid' : paidPaise > 0 ? 'partial' : 'unpaid',
  };
}

export function invoiceStatus(invoice) {
  const paid = Number(invoice.paid_paise || 0);
  const total = Number(invoice.total_paise || 0);
  if (invoice.status === 'void') return { id: 'void', label: 'Void', tone: 'neutral' };
  if (paid <= 0) return { id: 'unpaid', label: 'Unpaid', tone: 'danger' };
  if (paid < total) return { id: 'partial', label: 'Part paid', tone: 'warn' };
  return { id: 'paid', label: 'Paid', tone: 'success' };
}

export function invoiceBalance(invoice) {
  return Math.max(0, Number(invoice.total_paise || 0) - Number(invoice.paid_paise || 0));
}

export function outstandingByPatient(invoices) {
  const map = new Map();
  for (const inv of invoices) {
    if (inv.status === 'void') continue;
    const balance = invoiceBalance(inv);
    if (!balance) continue;
    map.set(inv.patient_id, (map.get(inv.patient_id) ?? 0) + balance);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Token / walk-in queue
// ---------------------------------------------------------------------------
/** Next token number for a doctor on a given day (tokens restart daily). */

export function feeForVisit({ doctor, clinic, kind }) {
  if (kind === 'Follow-up') return doctor?.follow_up_fee_paise ?? clinic?.follow_up_fee_paise ?? 25000;
  if (kind === 'Teleconsultation') return doctor?.fee_paise ?? clinic?.consultation_fee_paise ?? 50000;
  return doctor?.fee_paise ?? clinic?.consultation_fee_paise ?? 50000;
}

/** Payments still owed on an invoice object. */
