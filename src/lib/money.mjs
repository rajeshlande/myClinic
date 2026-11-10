/**
 * Money — integer paise in, integer paise out.
 *
 * Split out of `logic.mjs` in v1.29.0 (docs/ARCHITECTURE.md §3 step 3). Nothing here
 * knows about dates, invoices or React: it rounds, formats and adds.
 */

export function moneyToPaise(value) {
  const text = String(value ?? '').trim().replace(/,/g, '');
  if (text === '') return 0;
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(text)) throw new Error('Enter a valid amount with up to two decimals (max ₹99,99,999.99).');
  const [whole, fraction = ''] = text.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

export function paiseToInput(paise) {
  if (paise === null || paise === undefined || paise === '') return '';
  return (Number(paise) / 100).toFixed(Number(paise) % 100 === 0 ? 0 : 2);
}

export function formatMoney(paise = 0, { compact = false, currency = 'INR' } = {}) {
  const amount = Number(paise || 0) / 100;
  if (compact) {
    if (Math.abs(amount) >= 10000000) return `₹${trim(amount / 10000000)}Cr`;
    if (Math.abs(amount) >= 100000) return `₹${trim(amount / 100000)}L`;
    if (Math.abs(amount) >= 1000) return `₹${trim(amount / 1000)}k`;
  }
  // A rupee amount is either whole or carries both paise digits: "₹23,990.40",
  // never "₹23,990.4" — the second one reads like a typo on a bill.
  const whole = Number.isInteger(amount);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(amount);
}

const trim = (n) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(n);

// ---------------------------------------------------------------------------
// Money in words — printed on invoices, because a paper bill has to be readable
// when the figure is disputed. Indian grouping: crore, lakh, thousand.
// ---------------------------------------------------------------------------

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];

const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigitWords(n) {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return `${TENS[t]}${o ? ` ${ONES[o]}` : ''}`;
}

function threeDigitWords(n) {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]} Hundred` : '', rest ? twoDigitWords(rest) : ''].filter(Boolean).join(' ');
}

/**
 * Indian grouping, recursively: thousand, lakh, crore. The crore group can
 * itself exceed 999 (1000 crore), so it is not forced through threeDigitWords —
 * that produced "Ten Hundred Crore".
 */

function rupeeGroups(n) {
  if (n <= 0) return [];
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  return [
    ...(crore ? [...rupeeGroups(crore).slice(0, -1), `${rupeeGroups(crore).slice(-1)[0]} Crore`] : []),
    lakh ? `${threeDigitWords(lakh)} Lakh` : '',
    thousand ? `${threeDigitWords(thousand)} Thousand` : '',
    rest ? threeDigitWords(rest) : '',
  ].filter(Boolean);
}

/** 65000 paise → "Rupees Six Hundred Fifty Only". */

export function amountInWords(paise = 0, { currency = 'Rupees', subunit = 'Paise' } = {}) {
  const total = Math.max(0, Math.round(Number(paise) || 0));
  const rupees = Math.floor(total / 100);
  const sub = total % 100;
  if (!rupees && !sub) return `${currency} Zero Only`;

  const parts = rupeeGroups(rupees);

  const head = parts.length ? `${currency} ${parts.join(' ')}` : '';
  const tail = sub ? `${head ? 'and ' : `${currency} `}${twoDigitWords(sub)} ${subunit}` : '';
  return `${[head, tail].filter(Boolean).join(' ')} Only`.replace(/\s+/g, ' ').trim();
}

/**
 * What a payment of `amountPaise` does to an invoice: the new paid figure, the
 * status it lands in, and the balance that stays open. Kept here (not in a
 * component) so the offline store and the UI can never disagree about it.
 */

export function applyPayment(invoice, amountPaise) {
  const total = Math.max(0, Number(invoice?.total_paise) || 0);
  const alreadyPaid = Math.max(0, Number(invoice?.paid_paise) || 0);
  const requested = Math.max(0, Math.round(Number(amountPaise) || 0));
  const balance = Math.max(0, total - alreadyPaid);
  const applied = Math.min(requested, balance);
  const paid = alreadyPaid + applied;
  const status = paid >= total ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
  return { applied, paid, status, balance: total - paid, overshoot: requested - applied };
}

// ---------------------------------------------------------------------------
// Dates & time
// ---------------------------------------------------------------------------

export function sumBy(list, pick) { return list.reduce((t, item) => t + Number(pick(item) || 0), 0); }

// ---------------------------------------------------------------------------
// Patients
// ---------------------------------------------------------------------------
