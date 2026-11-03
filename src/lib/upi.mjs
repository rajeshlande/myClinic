/**
 * UPI payment links.
 *
 * A UPI intent link is a plain URI that any Indian payment app (GPay, PhonePe,
 * Paytm, BHIM, bank apps) understands. We build it from the clinic's VPA and the
 * invoice amount so the patient scans once and the amount is already filled in —
 * no typing, no wrong-amount corrections at the counter.
 *
 * Everything here is pure and testable: no React, no store, no network.
 */

/** Trim and lower-case a VPA. UPI handles are case-insensitive. */
export function normaliseVpa(raw) {
  return String(raw ?? '').trim().toLowerCase();
}

/**
 * A pragmatic VPA check: `handle@psp`. We deliberately do not try to validate the
 * PSP list — new banks appear constantly — but we do reject spaces, missing `@`
 * and empty halves, which are the mistakes people actually make when typing one in.
 */
export function isValidUpiId(raw) {
  const vpa = normaliseVpa(raw);
  return /^[a-z0-9][a-z0-9._-]{0,63}@[a-z][a-z0-9]{1,31}$/.test(vpa);
}

/** The name the patient sees inside their UPI app. */
export function upiPayeeName(clinic) {
  const explicit = String(clinic?.upi_payee_name ?? '').trim();
  if (explicit) return explicit.slice(0, 50);
  return String(clinic?.name ?? 'Clinic').trim().slice(0, 50) || 'Clinic';
}

/**
 * Build the `upi://pay` URI for an amount.
 *
 * Returns null when the clinic has no usable VPA, so callers can simply render
 * nothing instead of a QR that leads nowhere.
 *
 * Notes on the payload:
 * - `am` is optional in the spec; when present the patient cannot edit it in most
 *   apps, which is exactly what we want for a fixed invoice balance.
 * - We hand-encode the query instead of using URLSearchParams: it writes spaces as
 *   `+`, which several UPI apps render literally in the transaction note.
 */
export function buildUpiUri({ vpa, name, amountPaise, note, ref }) {
  if (!isValidUpiId(vpa)) return null;
  const params = [
    ['pa', normaliseVpa(vpa)],
    ['pn', String(name ?? '').trim() || 'Clinic'],
  ];
  const amount = Number(amountPaise ?? 0);
  if (Number.isFinite(amount) && amount > 0) params.push(['am', (Math.round(amount) / 100).toFixed(2)]);
  params.push(['cu', 'INR']);
  const tn = [note, ref ? `Ref ${ref}` : ''].filter(Boolean).join(' ').trim().slice(0, 50);
  if (tn) params.push(['tn', tn]);

  const query = params
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  return `upi://pay?${query}`;
}

/**
 * The UPI link for one invoice, or null when the clinic has not set a VPA.
 * The transaction note carries the invoice number so the payment is easy to
 * reconcile in the clinic's bank statement.
 */
export function invoiceUpiLink(invoice, clinic, amountPaise) {
  if (!invoice) return null;
  const amount = Number(amountPaise ?? (Number(invoice.total_paise) - Number(invoice.paid_paise)));
  return buildUpiUri({
    vpa: clinic?.upi_id,
    name: upiPayeeName(clinic),
    amountPaise: amount,
    note: `Invoice ${invoice.number}`,
    ref: invoice.number,
  });
}

/** Apps worth naming under the QR — patients recognise these logos by name. */
export const UPI_APPS = ['GPay', 'PhonePe', 'Paytm', 'BHIM', 'Bank app'];
