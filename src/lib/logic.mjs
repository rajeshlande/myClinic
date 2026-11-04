// ---------------------------------------------------------------------------
// myClinic domain logic — pure, dependency-free functions (safe to unit test).
// Money is always an integer number of paise (₹1,250.50 === 125050).
// ---------------------------------------------------------------------------

export const CLINIC_TYPES = ['General Practice', 'Dental', 'Dermatology', 'Paediatrics', 'Physiotherapy', 'Orthopaedics', 'Gynaecology', 'ENT', 'Ophthalmology', 'Ayurveda / Homeopathy'];

export const ROLES = [
  { id: 'owner', label: 'Clinic owner', hint: 'Billing, plans, staff and every clinical record.' },
  { id: 'doctor', label: 'Doctor', hint: 'Own appointments, consultations and prescriptions.' },
  { id: 'frontdesk', label: 'Front desk', hint: 'Appointments, patient registration, payments.' },
];

export const APPOINTMENT_STATUS = [
  { id: 'booked', label: 'Booked', tone: 'neutral' },
  { id: 'checked-in', label: 'Checked in', tone: 'info' },
  { id: 'in-consult', label: 'In consult', tone: 'accent' },
  { id: 'completed', label: 'Completed', tone: 'success' },
  { id: 'cancelled', label: 'Cancelled', tone: 'danger' },
  { id: 'no-show', label: 'No show', tone: 'warn' },
];

export const APPOINTMENT_TYPES = ['New consultation', 'Follow-up', 'Procedure', 'Teleconsultation', 'Report review'];

export const PAYMENT_METHODS = [
  { id: 'cash', label: 'Cash' },
  { id: 'upi', label: 'UPI' },
  { id: 'card', label: 'Card' },
  { id: 'insurance', label: 'Insurance / TPA' },
  { id: 'credit', label: 'Clinic credit' },
];

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
export const GENDERS = ['Female', 'Male', 'Other'];
export const CHRONIC_TAGS = ['Diabetes', 'Hypertension', 'Asthma', 'Thyroid', 'Cardiac', 'Pregnancy', 'Allergy', 'Post-surgery'];

export const PLANS = [
  {
    id: 'solo',
    name: 'Solo',
    price_paise: 99900,
    tagline: 'One doctor, one chair, zero paperwork.',
    limits: '1 doctor · 300 patients',
    features: ['1 doctor + 1 front desk seat', 'Up to 300 active patients / month', 'Appointments & digital prescriptions', 'GST-ready invoices', 'Daily collection report'],
  },
  {
    id: 'growth',
    name: 'Growth',
    price_paise: 249900,
    tagline: 'The usual pick for a busy multi-doctor OPD.',
    limits: '5 doctors · unlimited patients',
    popular: true,
    features: ['Up to 5 doctors + 3 front desk seats', 'Unlimited patients and visits', 'Follow-up engine & recall reminders', 'Revenue, footfall and payer analytics', 'WhatsApp / SMS reminder templates', 'CSV + spreadsheet export'],
  },
  {
    id: 'chain',
    name: 'Multi-clinic',
    price_paise: 599900,
    tagline: 'For clinic groups and polyclinics.',
    limits: 'Unlimited doctors · multi-branch',
    features: ['Unlimited seats and branches', 'Branch-level P&L and doctor payouts', 'Role-based access + audit trail', 'Priority support and onboarding', 'Data residency options'],
  },
];

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------
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
export function localISO(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function validISO(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00`);
  return !Number.isNaN(d.getTime()) && localISO(d) === value;
}
export function today() { return localISO(); }
export function currentMonth() { return localISO().slice(0, 7); }
export function addDays(iso, days) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return localISO(d);
}
export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
export function monthLabel(month, short = false) {
  return new Date(`${month}-01T12:00:00`).toLocaleDateString('en-IN', { month: short ? 'short' : 'long', year: 'numeric' });
}
export function recentMonths(month, count = 6) {
  return Array.from({ length: count }, (_, i) => shiftMonth(month, i - count + 1));
}
export function formatDate(value, { withYear = true, weekday = false } = {}) {
  if (!validISO(value)) return '—';
  return new Date(`${value}T12:00:00`).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), ...(weekday ? { weekday: 'short' } : {}),
  });
}
export function relativeDay(value) {
  const t = today();
  if (value === t) return 'Today';
  if (value === addDays(t, 1)) return 'Tomorrow';
  if (value === addDays(t, -1)) return 'Yesterday';
  return formatDate(value, { withYear: false, weekday: true });
}
export function daysBetween(a, b) {
  return Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);
}
/** "09:30" -> 570 */
export function timeToMinutes(hhmm) {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
export function minutesToTime(mins) {
  const m = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
export function formatTime(hhmm, { ampm = true } = {}) {
  if (!hhmm) return '—';
  const d = new Date(`2000-01-01T${hhmm}`);
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: ampm });
}
export function formatSlotRange(start, duration = 15) {
  return `${formatTime(start)} – ${formatTime(minutesToTime(timeToMinutes(start) + duration))}`;
}
export function ageFromDOB(dob, on = today()) {
  if (!validISO(dob)) return null;
  const b = new Date(`${dob}T12:00:00`), n = new Date(`${on}T12:00:00`);
  let years = n.getFullYear() - b.getFullYear();
  const beforeBirthday = n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate());
  if (beforeBirthday) years -= 1;
  if (years < 0 || years > 130) return null;
  if (years === 0) {
    const months = Math.max(0, Math.round(daysBetween(dob, on) / 30.44));
    return { years: 0, label: `${months} mo`, months };
  }
  return { years, label: `${years} yr`, months: years * 12 };
}
export function ageLabel(patient) {
  if (!patient) return '—';
  const gender = patient.gender ? ` · ${patient.gender[0]}` : '';
  if (patient.dob) {
    const age = ageFromDOB(patient.dob);
    if (age) return `${age.label}${gender}`;
  }
  if (patient.age_years) return `${patient.age_years} yr${gender}`;
  return patient.gender || '—';
}
export function ordinalSuffix(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------
export function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}
export function titleCase(value = '') {
  return value.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}
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

export function financialYear(value = today()) {
  // Callers pass either a yyyy-mm-dd string or a Date; both must give the same
  // financial year in local time (a Date near midnight must not shift a month).
  const iso = value instanceof Date
    ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
    : String(value ?? today());
  const [y, m] = iso.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}
export function slugify(value = '') {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// ---------------------------------------------------------------------------
// Appointments
// ---------------------------------------------------------------------------
export const statusMeta = (id) => APPOINTMENT_STATUS.find((s) => s.id === id) ?? APPOINTMENT_STATUS[0];
export const isOpenStatus = (id) => ['booked', 'checked-in', 'in-consult'].includes(id);

/** Generates bookable slots for a doctor's working day, skipping taken slots. */
export function generateSlots({ start = '09:00', end = '13:00', duration = 15, gap = 0 } = {}) {
  const slots = [];
  const step = Math.max(5, duration + gap);
  for (let t = timeToMinutes(start); t + duration <= timeToMinutes(end); t += step) {
    slots.push(minutesToTime(t));
  }
  return slots;
}

export function appointmentDateTime(appt) {
  return new Date(`${appt.scheduled_on}T${appt.scheduled_at || '00:00'}`);
}

export function sortAppointments(list, dir = 'asc') {
  return [...list].sort((a, b) => {
    const cmp = `${a.scheduled_on}${a.scheduled_at}`.localeCompare(`${b.scheduled_on}${b.scheduled_at}`);
    return dir === 'asc' ? cmp : -cmp;
  });
}

export function appointmentsForDate(appointments, iso, doctorId = 'all') {
  return sortAppointments(appointments.filter((a) => a.scheduled_on === iso && (doctorId === 'all' || a.doctor_id === doctorId)));
}

export function queueForDate(appointments, iso, doctorId = 'all') {
  const live = ['checked-in', 'in-consult'];
  const booked = appointmentsForDate(appointments, iso, doctorId).filter((a) => isOpenStatus(a.status));
  return {
    inClinic: live.flatMap((s) => booked.filter((a) => a.status === s)),
    upcoming: booked.filter((a) => a.status === 'booked'),
    done: appointmentsForDate(appointments, iso, doctorId).filter((a) => a.status === 'completed'),
  };
}

/** Slot availability for a date: taken slots plus suggested next free slot. */
export function slotAvailability({ appointments, doctor, iso, duration = 15 }) {
  const taken = new Set(appointments.filter((a) => a.doctor_id === doctor.id && a.scheduled_on === iso && a.status !== 'cancelled').map((a) => a.scheduled_at));
  const all = generateSlots({ start: doctor.day_start || '09:00', end: doctor.day_end || '13:00', duration });
  const free = all.filter((s) => !taken.has(s));
  return { all, taken, free, next: free.find((s) => iso > today() || timeToMinutes(s) >= timeToMinutes(localISO() === iso ? new Date().toTimeString().slice(0, 5) : '00:00')) ?? null };
}

export function detectConflicts(appointments, draft) {
  return appointments.filter((a) =>
    a.id !== draft.id && a.doctor_id === draft.doctor_id && a.scheduled_on === draft.scheduled_on &&
    a.scheduled_at === draft.scheduled_at && a.status !== 'cancelled');
}

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------
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

export function sumBy(list, pick) { return list.reduce((t, item) => t + Number(pick(item) || 0), 0); }

// ---------------------------------------------------------------------------
// Patients
// ---------------------------------------------------------------------------
export function patientSearch(patients, query = '') {
  const q = query.trim().toLowerCase();
  if (!q) return patients;
  const digits = q.replace(/\D/g, '');
  return patients.filter((p) =>
    [p.full_name, p.code, p.phone, p.email, p.city, ...(p.tags || [])].join(' ').toLowerCase().includes(q) ||
    (digits.length >= 4 && String(p.phone || '').replace(/\D/g, '').includes(digits)));
}

export function patientVisits(consultations, patientId) {
  return consultations.filter((c) => c.patient_id === patientId)
    .sort((a, b) => `${b.visited_on}${b.created_at ?? ''}`.localeCompare(`${a.visited_on}${a.created_at ?? ''}`));
}

/** Visits in the trailing `months` window, used for chronic / returning detection. */
export function visitFrequency(consultations, patientId, months = 12) {
  const from = addDays(today(), -Math.round(months * 30.44));
  return consultations.filter((c) => c.patient_id === patientId && c.visited_on >= from).length;
}

/**
 * The same two answers as lastVisit/visitFrequency, read from appointments — for a
 * member who may not read consultation rows. A completed appointment is a visit.
 */
export function lastAppointmentVisit(appointments = [], patientId) {
  const done = appointments
    .filter((a) => a.patient_id === patientId && a.status === 'completed')
    .sort((a, b) => String(b.scheduled_on).localeCompare(String(a.scheduled_on)));
  return done[0] ?? null;
}

export function appointmentVisitsSince(appointments = [], patientId, months = 12) {
  const from = addDays(today(), -Math.round(months * 30.44));
  return appointments.filter((a) => a.patient_id === patientId && a.status === 'completed' && a.scheduled_on >= from).length;
}

export function lastVisit(consultations, patientId) {
  return patientVisits(consultations, patientId)[0] ?? null;
}

/** Patients who have not returned within `days` of a completed visit. */
export function followUpDue(consultations, { withinDays = 7, on = today() } = {}) {
  const horizon = addDays(on, withinDays);
  return consultations
    .filter((c) => c.follow_up_on && c.follow_up_on <= horizon && !c.follow_up_done)
    .sort((a, b) => a.follow_up_on.localeCompare(b.follow_up_on));
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------
export function inMonth(list, month, field = 'visited_on') {
  return list.filter((item) => String(item[field] || '').startsWith(month));
}

/**
 * Month totals.
 *
 * `visits` normally counts consultations. A member who may not read consultations
 * (the front desk — schema 10 denies the table) still runs a clinic, so the count
 * falls back to appointments that actually happened. Pass `canSeeConsultations:
 * false` rather than letting an empty array read as "nobody came in".
 */
export function monthTotals({
  invoices = [], consultations = [], patients = [], appointments = [], month,
  canSeeConsultations = true,
}) {
  const inv = inMonth(invoices.filter((i) => i.status !== 'void'), month, 'issued_on');
  const collected = inv.reduce((t, i) => t + Number(i.paid_paise || 0), 0);
  const billed = inv.reduce((t, i) => t + Number(i.total_paise || 0), 0);
  const consults = inMonth(consultations, month);
  const seen = inMonth(appointments.filter((a) => a.status === 'completed'), month, 'scheduled_on');
  const newPatients = patients.filter((p) => String(p.created_at || '').startsWith(month));
  return {
    billed, collected, outstanding: billed - collected,
    visits: canSeeConsultations ? consults.length : seen.length,
    newPatients: newPatients.length, invoices: inv.length,
  };
}

export function revenueSeries({ invoices = [], month, count = 6 }) {
  return recentMonths(month, count).map((m) => {
    const inv = inMonth(invoices.filter((i) => i.status !== 'void'), m, 'issued_on');
    return {
      month: m,
      label: monthLabel(m, true).split(' ')[0],
      billed: sumBy(inv, (i) => i.total_paise),
      collected: sumBy(inv, (i) => i.paid_paise),
    };
  });
}

export function footfallSeries({
  consultations = [], appointments = [], month, count = 6, canSeeConsultations = true,
}) {
  const completed = appointments.filter((a) => a.status === 'completed');
  return recentMonths(month, count).map((m) => ({
    month: m,
    label: monthLabel(m, true).split(' ')[0],
    visits: inMonth(canSeeConsultations ? consultations : completed, m,
      canSeeConsultations ? 'visited_on' : 'scheduled_on').length,
  }));
}

export function categoryRevenue({ invoices = [], month }) {
  const inv = inMonth(invoices.filter((i) => i.status !== 'void'), month, 'issued_on');
  const buckets = new Map();
  for (const invoice of inv) {
    const items = Array.isArray(invoice.lines) && invoice.lines.length
      ? invoice.lines
      : [{ category: 'Consultation', total: Number(invoice.total_paise || 0) }];
    for (const item of items) {
      const key = item.category || 'Consultation';
      buckets.set(key, (buckets.get(key) ?? 0) + Number(item.total ?? item.total_paise ?? 0));
    }
  }
  const total = [...buckets.values()].reduce((t, v) => t + v, 0) || 1;
  return [...buckets.entries()]
    .map(([category, amount]) => ({ category, amount, share: amount / total }))
    .sort((a, b) => b.amount - a.amount);
}

export function payerMix({ invoices = [], month }) {
  const inv = inMonth(invoices.filter((i) => i.status !== 'void'), month, 'issued_on');
  const buckets = new Map();
  for (const invoice of inv) buckets.set(invoice.method || 'cash', (buckets.get(invoice.method || 'cash') ?? 0) + Number(invoice.paid_paise || 0));
  const total = [...buckets.values()].reduce((t, v) => t + v, 0) || 1;
  return [...buckets.entries()].map(([method, amount]) => ({ method, amount, share: amount / total })).sort((a, b) => b.amount - a.amount);
}

export function doctorPerformance({ appointments = [], consultations = [], invoices = [], doctors = [], month }) {
  return doctors.map((doctor) => {
    const appts = inMonth(appointments, month, 'scheduled_on').filter((a) => a.doctor_id === doctor.id);
    const cons = inMonth(consultations, month).filter((c) => c.doctor_id === doctor.id);
    const inv = inMonth(invoices.filter((i) => i.status !== 'void'), month, 'issued_on').filter((i) => i.doctor_id === doctor.id);
    const billed = sumBy(inv, (i) => i.total_paise);
    return {
      ...doctor,
      appointments: appts.length,
      visits: cons.length,
      noShows: appts.filter((a) => a.status === 'no-show').length,
      billed,
      collected: sumBy(inv, (i) => i.paid_paise),
      avgTicket: cons.length ? Math.round(billed / cons.length) : 0,
    };
  }).sort((a, b) => b.billed - a.billed);
}

export function occupancy({ appointments = [], date, doctors = [], slotMinutes = 15 }) {
  const rooms = doctors.reduce((t, d) => t + Math.max(1, Math.round((timeToMinutes(d.day_end || '13:00') - timeToMinutes(d.day_start || '09:00')) / slotMinutes)), 0) || 1;
  const booked = appointmentsForDate(appointments, date).filter((a) => a.status !== 'cancelled').length;
  return { booked, capacity: rooms, ratio: Math.min(1, booked / rooms) };
}

export function topDiagnoses({ consultations = [], month, count = 5 }) {
  const buckets = new Map();
  for (const c of inMonth(consultations, month)) {
    for (const dx of c.diagnoses ?? []) buckets.set(dx, (buckets.get(dx) ?? 0) + 1);
  }
  return [...buckets.entries()].map(([diagnosis, visits]) => ({ diagnosis, visits })).sort((a, b) => b.visits - a.visits).slice(0, count);
}

// ---------------------------------------------------------------------------
// Export helpers
// ---------------------------------------------------------------------------
export function toCSV(rows, columns) {
  const escape = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => escape(c.label)).join(',');
  const body = rows.map((row) => columns.map((c) => escape(typeof c.value === 'function' ? c.value(row) : row[c.key])).join(',')).join('\n');
  return `${head}\n${body}`;
}

export function downloadFile(filename, content, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
export const PHONE_RE = /^[+]?[\d\s-]{10,16}$/;

export function validatePatient(draft) {
  const errors = {};
  if (!draft.full_name?.trim()) errors.full_name = 'Patient name is required.';
  if (draft.phone && !PHONE_RE.test(draft.phone.trim())) errors.phone = 'Enter a 10-digit mobile number.';
  if (draft.dob && !validISO(draft.dob)) errors.dob = 'Date of birth must be a valid date.';
  if (draft.dob && draft.dob > today()) errors.dob = 'Date of birth cannot be in the future.';
  if (draft.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(draft.email.trim())) errors.email = 'Enter a valid email address.';
  return errors;
}

export function validateAppointment(draft) {
  const errors = {};
  if (!draft.patient_id) errors.patient_id = 'Choose a patient.';
  if (!draft.doctor_id) errors.doctor_id = 'Choose a doctor.';
  if (!validISO(draft.scheduled_on)) errors.scheduled_on = 'Choose a valid date.';
  if (!/^\d{2}:\d{2}$/.test(draft.scheduled_at || '')) errors.scheduled_at = 'Choose a start time.';
  return errors;
}

export function validateConsultation(draft) {
  const errors = {};
  if (!draft.complaint?.trim()) errors.complaint = 'Record the presenting complaint.';
  if (draft.temperature_c != null && draft.temperature_c !== '' && (Number(draft.temperature_c) < 90 || Number(draft.temperature_c) > 110)) errors.temperature_c = 'Temperature looks out of range.';
  if (draft.pulse_bpm && (Number(draft.pulse_bpm) < 30 || Number(draft.pulse_bpm) > 220)) errors.pulse_bpm = 'Pulse must be between 30 and 220 bpm.';
  if (draft.spo2 && (Number(draft.spo2) < 50 || Number(draft.spo2) > 100)) errors.spo2 = 'SpO₂ must be 50–100%.';
  return errors;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------
export const DEFAULT_CLINIC = {
  name: 'Sunrise Multispecialty OPD',
  slug: 'sunrise-opd',
  clinic_type: 'General Practice',
  phone: '+91 22 4000 1200',
  email: 'front.desk@sunriseclinic.in',
  address: '2nd floor, Lotus Court, Linking Road, Bandra West, Mumbai 400050',
  gstin: '27ABCDE1234F1Z5',
  consultation_fee_paise: 50000,
  follow_up_fee_paise: 25000,
  follow_up_days: 15,
  slot_minutes: 15,
  open_time: '09:00',
  close_time: '20:00',
  gst_enabled: true,
  gst_rate: 0,
  invoice_prefix: 'INV',
  brand_color: '#0f766e',
  // Branding: uploaded in Settings → Logos & branding. Stored as data URLs on the
  // clinic row so documents render offline and the logo travels with the clinic.
  logo_square_url: null,
  logo_wide_url: null,
  logo_on_documents: true,
  // UPI collection: the VPA printed as a QR on unpaid invoices. Empty means the
  // clinic has not set one up yet and documents render without a QR block.
  upi_id: 'sunrise.opd@okicici',
  upi_payee_name: 'Sunrise Multispecialty OPD',
  upi_qr_on_invoices: true,
  // Public booking (v1.11.0): the slug is the public address, and the horizon is
  // how far ahead the diary may be opened to strangers.
  booking_enabled: true,
  booking_horizon_days: 14,
  booking_note: 'Reach 15 minutes before your slot at the front desk.',
};

export const DEFAULT_PREFERENCES = {
  theme: 'system',
  density: 'comfortable',
  reminders_enabled: true,
  reminder_lead_hours: 24,
  send_review_request: true,
  quiet_hours: '21:00-08:00',
};

export const DEFAULT_DOCTOR = {
  full_name: '', specialty: 'General Physician', qualification: 'MBBS', registration_no: '',
  phone: '', email: '', color: '#0f766e', day_start: '09:00', day_end: '13:00',
  slot_minutes: 15, fee_paise: 50000, follow_up_fee_paise: 25000, active: true, role: 'doctor',
};

// ---------------------------------------------------------------------------
// IDs
// ---------------------------------------------------------------------------
export function nextId(prefix = 'id') {
  const rand = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}-${rand}`;
}

export function appointmentMatchesQuery(appointment, patients = [], query = '') {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const patient = patients.find((p) => p.id === appointment.patient_id);
  return [patient?.full_name, patient?.phone, patient?.code, appointment.reason, appointment.scheduled_on, appointment.kind]
    .filter(Boolean).join(' ').toLowerCase().includes(q);
}

/** Effective fee for an appointment kind, honouring follow-up pricing. */
export function feeForVisit({ doctor, clinic, kind }) {
  if (kind === 'Follow-up') return doctor?.follow_up_fee_paise ?? clinic?.follow_up_fee_paise ?? 25000;
  if (kind === 'Teleconsultation') return doctor?.fee_paise ?? clinic?.consultation_fee_paise ?? 50000;
  return doctor?.fee_paise ?? clinic?.consultation_fee_paise ?? 50000;
}

/** Payments still owed on an invoice object. */
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
export function nextTokenNo(appointments, doctorId, iso = today()) {
  const used = appointments
    .filter((a) => a.doctor_id === doctorId && a.scheduled_on === iso && a.token_no)
    .map((a) => Number(a.token_no));
  return (used.length ? Math.max(...used) : 0) + 1;
}

export function tokenLabel(n) {
  return n ? `T-${String(n).padStart(2, '0')}` : 'T-—';
}

/** Minutes a patient has been waiting, from their issue/check-in time. */
export function waitedMinutes(appointment, now = new Date()) {
  if (!appointment?.scheduled_on) return 0;
  const [h, m] = String(appointment.scheduled_at || '00:00').split(':').map(Number);
  const at = new Date(`${appointment.scheduled_on}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`);
  return Math.max(0, Math.round((now - at) / 60000));
}

export function humanWait(mins) {
  if (!Number.isFinite(mins) || mins < 0) return '—';
  if (mins < 1) return 'just now';
  if (mins > 240) return '4 h +';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/**
 * Front-desk board: for every doctor, who is in the room, who is next and who
 * is still waiting. Only records carrying a token are part of the queue.
 */
export function queueBoard({ appointments = [], patients = [], doctors = [], iso = today(), doctorId = 'all', now = new Date() }) {
  const nameOf = (id) => patients.find((p) => p.id === id)?.full_name ?? 'Patient';
  const day = appointments.filter((a) => a.scheduled_on === iso && a.status !== 'cancelled');
  const list = doctors
    .filter((d) => d.role !== 'frontdesk')
    .filter((d) => doctorId === 'all' || d.id === doctorId)
    .map((doctor) => {
      const mine = day.filter((a) => a.doctor_id === doctor.id);
      const byToken = (a, b) => (Number(a.token_no) || 999) - (Number(b.token_no) || 999) || String(a.scheduled_at).localeCompare(String(b.scheduled_at));
      const serving = mine.filter((a) => a.status === 'in-consult' && a.token_no).sort(byToken)[0] ?? null;
      const called = mine.filter((a) => a.status === 'checked-in' && a.token_no).sort(byToken);
      const booked = mine.filter((a) => a.status === 'booked' && a.token_no).sort(byToken);
      const done = mine.filter((a) => a.status === 'completed' && a.token_no);
      return {
        doctor,
        serving,
        next: called[0] ?? null,
        waiting: [...called, ...booked],
        done: done.length,
        completed: done.sort(byToken),
        issued: mine.filter((a) => a.token_no).length,
        nextToken: nextTokenNo(appointments, doctor.id, iso),
        label: (a) => nameOf(a?.patient_id),
      };
    });
  const waiting = list.reduce((t, d) => t + d.waiting.length, 0);
  const withToken = day.filter((a) => a.token_no);
  const servingNow = list.filter((d) => d.serving).length;
  return {
    rows: list,
    totals: {
      issued: withToken.length,
      waiting,
      serving: servingNow,
      done: withToken.filter((a) => a.status === 'completed').length,
      tokensLeft: withToken.filter((a) => ['booked', 'checked-in'].includes(a.status)).length,
    },
  };
}

/** Plain-language status for a token row. */
export function queueState(appointment, doctor) {
  if (!appointment) return { id: 'none', label: 'No token', tone: 'neutral' };
  if (appointment.status === 'in-consult') return { id: 'serving', label: 'In the room', tone: 'accent' };
  if (appointment.status === 'checked-in') return { id: 'called', label: 'Waiting', tone: 'warn' };
  if (appointment.status === 'completed') return { id: 'done', label: 'Done', tone: 'success' };
  if (appointment.status === 'no-show') return { id: 'missed', label: 'No show', tone: 'danger' };
  return { id: 'booked', label: 'Not arrived', tone: 'info' };
}

/** Average wait across tokens that were actually served today. */
export function averageWait(consultations = [], appointments = [], iso = today()) {
  const waits = consultations
    .filter((c) => c.visited_on === iso)
    .map((c) => {
      const appt = appointments.find((a) => a.id === c.appointment_id);
      if (!appt?.token_no || !appt.scheduled_at) return null;
      const [h, m] = String(appt.scheduled_at).split(':').map(Number);
      const arrived = new Date(`${iso}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).getTime();
      const seen = new Date(c.created_at ?? `${iso}T${appt.scheduled_at}:00`).getTime();
      const mins = Math.round((seen - arrived) / 60000);
      return mins >= 0 && mins < 300 ? mins : null;
    })
    .filter((v) => v != null);
  if (!waits.length) return null;
  return Math.round(waits.reduce((t, v) => t + v, 0) / waits.length);
}
