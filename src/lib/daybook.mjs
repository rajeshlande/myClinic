/**
 * Day book — closing the day, and the reminders that bring patients back.
 *
 * Two jobs that a front desk does at the same moment every evening:
 *
 *   1. Count the money, compare it with the day's collections, and write down the
 *      difference. That is `dayTotals` + `closeVariance`, stored as a day close.
 *   2. Find the work that leaked: a patient seen but never billed, a bill still
 *      open, a follow-up nobody chased. That is `missedCharges` and
 *      `reminderDrafts`.
 *
 * Everything here is pure: the page supplies the clock (`now`) and the data, the
 * functions return plain objects. No wall clock is read inside a function that
 * accepts `now`, so the tests can pin a day and mean it.
 *
 * Privacy contract for every drafted message: it carries the clinic, the doctor,
 * a date, a time and (for a balance) an amount. It never carries a diagnosis, a
 * drug name or a reason for the visit.
 */
import {
  PAYMENT_METHODS, addDays, daysBetween, feeForVisit, formatDate, formatMoney,
  formatTime, invoiceBalance, localISO,
} from './logic.mjs';

/** How the desk actually recorded a reminder. Never claims delivery it cannot prove. */
export const REMINDER_STATUS = [
  { id: 'copied', label: 'Copied', tone: 'neutral' },
  { id: 'opened', label: 'Opened', tone: 'info' },
  { id: 'sent', label: 'Sent', tone: 'success' },
  { id: 'skipped', label: 'Skipped', tone: 'warn' },
];

export const REMINDER_CHANNELS = [
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'sms', label: 'SMS' },
  { id: 'call', label: 'Call' },
  { id: 'copy', label: 'Copy' },
];

export const REMINDER_KINDS = [
  { id: 'appointment', label: 'Appointment', tone: 'info', dedupeDays: 1 },
  { id: 'follow-up', label: 'Follow-up', tone: 'warn', dedupeDays: 3 },
  { id: 'balance', label: 'Balance due', tone: 'danger', dedupeDays: 7 },
];

export const reminderKind = (id) => REMINDER_KINDS.find((k) => k.id === id) ?? REMINDER_KINDS[0];
export const reminderStatus = (id) => REMINDER_STATUS.find((s) => s.id === id) ?? REMINDER_STATUS[0];
export const channelLabel = (id) => REMINDER_CHANNELS.find((c) => c.id === id)?.label ?? 'Copy';

const money = (paise) => formatMoney(paise);

/* ------------------------------------------------------------------ money */

/**
 * When the money actually arrived. A payment taken today against a bill raised
 * last week belongs to today's drawer, not to last week's.
 */
export function receivedOn(invoice) {
  return invoice?.paid_on || invoice?.issued_on || '';
}

/** Live (non-void) invoices only — a voided bill collected nothing. */
export function liveInvoices(invoices = []) {
  return invoices.filter((i) => i.status !== 'void');
}

/** What came in on one day, split by payment method. */
export function collectionsFor({ invoices = [], iso }) {
  const paid = liveInvoices(invoices).filter((i) => Number(i.paid_paise || 0) > 0 && receivedOn(i) === iso);
  const rows = PAYMENT_METHODS.map((method) => {
    const mine = paid.filter((i) => (i.method || 'cash') === method.id);
    return {
      method: method.id,
      label: method.label,
      count: mine.length,
      amount: mine.reduce((total, i) => total + Number(i.paid_paise || 0), 0),
      invoices: mine,
    };
  });
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  const cash = rows.find((r) => r.method === 'cash')?.amount ?? 0;
  return {
    iso,
    total,
    cash,
    count: paid.length,
    rows,
    used: rows.filter((r) => r.count > 0),
    average: paid.length ? Math.round(total / paid.length) : 0,
  };
}

/**
 * Everything a day close needs, in one object. The page prints it; `closeSummary`
 * stores it as the immutable snapshot on the day-close row.
 */
export function dayTotals({
  invoices = [], consultations = [], patients = [], appointments = [], iso,
  canSeeConsultations = true,
}) {
  const live = liveInvoices(invoices);
  const issued = live.filter((i) => i.issued_on === iso);
  const collected = collectionsFor({ invoices, iso });
  const appts = appointments.filter((a) => a.scheduled_on === iso && a.status !== 'cancelled');

  const billed = issued.reduce((t, i) => t + Number(i.total_paise || 0), 0);
  const collectedOnIssued = issued.reduce((t, i) => t + Number(i.paid_paise || 0), 0);
  const openToday = issued.filter((i) => invoiceBalance(i) > 0);
  const duesOpen = live.filter((i) => invoiceBalance(i) > 0);

  return {
    iso,
    // money
    billed,
    collected: collected.total,
    collectedOnIssued,
    balanceToday: openToday.reduce((t, i) => t + invoiceBalance(i), 0),
    openToday: openToday.length,
    invoices: issued.length,
    cash: collected.cash,
    byMethod: collected,
    dues: duesOpen.reduce((t, i) => t + invoiceBalance(i), 0),
    duesCount: duesOpen.length,
    // people — a member who cannot read consultations counts the appointments
    // that actually happened instead of reporting a day with no patients in it
    visits: canSeeConsultations
      ? consultations.filter((c) => c.visited_on === iso).length
      : appts.filter((a) => a.status === 'completed').length,
    newPatients: patients.filter((p) => String(p.created_at || '').startsWith(iso)).length,
    appointments: appts.length,
    seen: appts.filter((a) => a.status === 'completed').length,
    noShows: appts.filter((a) => a.status === 'no-show').length,
    cancelled: appointments.filter((a) => a.scheduled_on === iso && a.status === 'cancelled').length,
  };
}

/**
 * Counted cash against expected cash.
 *   expected — what the day's cash collections say should be in the drawer
 *   counted  — what the desk actually counted (null until they enter it)
 */
export function closeVariance({ expectedPaise = 0, countedPaise = null } = {}) {
  const expected = Math.round(Number(expectedPaise) || 0);
  if (countedPaise === null || countedPaise === undefined || countedPaise === '') {
    return { expected, counted: null, variance: null, state: 'uncounted', label: 'Not counted yet' };
  }
  const counted = Math.round(Number(countedPaise) || 0);
  const variance = counted - expected;
  if (variance === 0) return { expected, counted, variance, state: 'match', label: 'Drawer matches' };
  return {
    expected,
    counted,
    variance,
    state: variance < 0 ? 'short' : 'over',
    label: variance < 0 ? `${money(Math.abs(variance))} short` : `${money(variance)} over`,
  };
}

/* --------------------------------------------------------- what leaked */

/**
 * Charges that never made it onto a bill, and bills that never got paid.
 *
 * The detector is deliberately conservative — every item is something the clinic
 * can act on today, with the patient, the amount and the invoice to open:
 *
 *   seen-not-billed  the patient was marked completed but no invoice exists
 *   visit-not-billed a consultation exists for today with no invoice at all
 *   partial          billed today, money still owed
 *   unpaid           billed today, nothing paid
 *   stale-dues       balance open for longer than `dueDays`
 */
export function missedCharges({
  appointments = [], consultations = [], invoices = [], patients = [], doctors = [],
  clinic = null, iso, dueDays = 7, staleLimit = 5,
} = {}) {
  const live = liveInvoices(invoices);
  const patientOf = (id) => patients.find((p) => p.id === id) ?? null;
  const doctorOf = (id) => doctors.find((d) => d.id === id) ?? null;
  const billedFor = (appointmentId, patientId) => live.filter((i) => (
    (appointmentId && i.appointment_id === appointmentId)
    || (!appointmentId && i.patient_id === patientId && i.issued_on === iso)
  ));

  const items = [];
  const seen = new Set();

  const add = (item) => {
    if (seen.has(item.key)) return;
    seen.add(item.key);
    items.push({ ...item, patient_name: item.patient_name ?? patientOf(item.patient_id)?.full_name ?? 'Patient' });
  };

  // 1. Completed today with no bill.
  for (const appt of appointments) {
    if (appt.scheduled_on !== iso || appt.status !== 'completed') continue;
    const bills = billedFor(appt.id, appt.patient_id);
    if (bills.length) continue;
    const doctor = doctorOf(appt.doctor_id);
    add({
      key: `seen-not-billed:${appt.id}`,
      type: 'seen-not-billed',
      tone: 'danger',
      patient_id: appt.patient_id,
      appointment_id: appt.id,
      doctor_id: appt.doctor_id,
      amount: feeForVisit({ doctor, clinic, kind: appt.kind }),
      label: 'Seen, never billed',
      hint: `${appt.scheduled_at} · ${doctor?.full_name ?? 'Doctor'}`,
      action: 'bill',
    });
  }

  // 2. A consultation written today with nothing billed against it. Catches the
  //    visit whose appointment status was never moved to "completed".
  for (const visit of consultations) {
    if (visit.visited_on !== iso) continue;
    const bills = billedFor(visit.appointment_id, visit.patient_id);
    if (bills.length) continue;
    if (items.some((i) => i.patient_id === visit.patient_id)) continue;
    const doctor = doctorOf(visit.doctor_id);
    add({
      key: `visit-not-billed:${visit.id}`,
      type: 'visit-not-billed',
      tone: 'danger',
      patient_id: visit.patient_id,
      appointment_id: visit.appointment_id ?? null,
      doctor_id: visit.doctor_id,
      amount: feeForVisit({ doctor, clinic, kind: 'New consultation' }),
      label: 'Notes saved, no bill',
      hint: doctor?.full_name ?? 'Doctor',
      action: 'bill',
    });
  }

  // 3. Bills raised today that are still open.
  for (const invoice of live.filter((i) => i.issued_on === iso)) {
    const balance = invoiceBalance(invoice);
    if (!balance) continue;
    const paid = Number(invoice.paid_paise || 0);
    add({
      key: `open:${invoice.id}`,
      type: paid > 0 ? 'partial' : 'unpaid',
      tone: paid > 0 ? 'warn' : 'danger',
      patient_id: invoice.patient_id,
      invoice_id: invoice.id,
      doctor_id: invoice.doctor_id ?? null,
      amount: balance,
      label: paid > 0 ? 'Part paid today' : 'Billed, nothing paid',
      hint: `${invoice.number} · ${money(invoice.total_paise)} total`,
      action: 'collect',
    });
  }

  // 4. Money that has been owed for longer than a week.
  const stale = live
    .filter((i) => invoiceBalance(i) > 0 && i.issued_on < addDays(iso, -(dueDays - 1)))
    .sort((a, b) => a.issued_on.localeCompare(b.issued_on));
  for (const invoice of stale.slice(0, staleLimit)) {
    const ageDays = daysBetween(invoice.issued_on, iso);
    add({
      key: `stale:${invoice.id}`,
      type: 'stale-dues',
      tone: 'neutral',
      patient_id: invoice.patient_id,
      invoice_id: invoice.id,
      doctor_id: invoice.doctor_id ?? null,
      amount: invoiceBalance(invoice),
      ageDays,
      label: `${ageDays} days overdue`,
      hint: `${invoice.number} · ${formatDate(invoice.issued_on, { withYear: false })}`,
      action: 'collect',
    });
  }

  const byType = (type) => items.filter((i) => i.type === type);
  const seenNotBilled = [...byType('seen-not-billed'), ...byType('visit-not-billed')];
  const open = [...byType('partial'), ...byType('unpaid')];
  return {
    iso,
    items,
    seenNotBilled,
    openToday: open,
    staleDues: byType('stale-dues'),
    totals: {
      leaks: seenNotBilled.length,
      leakValue: seenNotBilled.reduce((t, i) => t + Number(i.amount || 0), 0),
      openCount: open.length,
      openValue: open.reduce((t, i) => t + Number(i.amount || 0), 0),
      staleCount: stale.length,
      staleValue: stale.reduce((t, i) => t + invoiceBalance(i), 0),
    },
    clean: items.length === 0,
  };
}

/* ------------------------------------------------------------------ close */

/** The snapshot written onto a `day_closes` row. */
export function closeSnapshot({ totals, variance, note = '', closedBy = null }) {
  return {
    totals: {
      iso: totals.iso,
      billed: totals.billed,
      collected: totals.collected,
      collectedOnIssued: totals.collectedOnIssued,
      balanceToday: totals.balanceToday,
      openToday: totals.openToday,
      invoices: totals.invoices,
      cash: totals.cash,
      byMethod: (totals.byMethod?.rows ?? []).filter((r) => r.count > 0).map((r) => ({ method: r.method, label: r.label, count: r.count, amount: r.amount })),
      dues: totals.dues,
      duesCount: totals.duesCount,
      visits: totals.visits,
      newPatients: totals.newPatients,
      appointments: totals.appointments,
      seen: totals.seen,
      noShows: totals.noShows,
    },
    expected_cash_paise: variance.expected,
    counted_cash_paise: variance.counted,
    variance_paise: variance.variance,
    note: String(note || '').trim().slice(0, 500),
    closed_by: closedBy,
  };
}

/** The day's sheet as text a receptionist can paste into the clinic group. */
export function closeSummary({ clinic, totals, variance, note = '', closedAt = null }) {
  const lines = [];
  lines.push(`${clinic?.name ?? 'Clinic'} — day close, ${formatDate(totals.iso, { weekday: true })}`);
  lines.push('');
  lines.push(`Collected ${money(totals.collected)} · ${totals.byMethod?.count ?? 0} payments`);
  const parts = (totals.byMethod?.rows ?? []).filter((r) => r.count > 0).map((r) => `${r.label} ${money(r.amount)}`);
  if (parts.length) lines.push(parts.join(' · '));
  lines.push(`Billed ${money(totals.billed)} · ${totals.invoices} invoices`);
  lines.push(`Visits ${totals.visits} · new patients ${totals.newPatients} · no shows ${totals.noShows}`);
  if (totals.openToday) lines.push(`Open on today's bills: ${totals.openToday} (${money(totals.balanceToday)})`);
  if (totals.duesCount) lines.push(`Dues across all bills: ${money(totals.dues)}`);
  if (variance?.state !== 'uncounted') {
    lines.push(`Cash counted ${money(variance.counted)} vs ${money(variance.expected)} expected — ${variance.label}`);
  } else {
    lines.push(`Cash collected ${money(totals.cash)} (not counted yet)`);
  }
  if (closedAt) lines.push(`Closed at ${new Date(closedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`);
  if (String(note).trim()) lines.push('', `Note: ${String(note).trim()}`);
  return lines.join('\n');
}

/** A close row for the day, if the clinic already closed it. */
export function closeFor(dayCloses = [], iso) {
  return dayCloses.find((row) => row.closed_on === iso) ?? null;
}

/** 'closed' only while the row has not been reopened. */
export function isClosed(dayClose) {
  return Boolean(dayClose) && (dayClose.status ?? 'closed') === 'closed';
}

/* -------------------------------------------------------------- reminders */

/** "21:00-08:00" → { start: 1260, end: 480 } in minutes past midnight. */
export function parseQuietHours(text = '21:00-08:00') {
  const match = String(text || '').match(/^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/);
  if (!match) return { start: 21 * 60, end: 8 * 60 };
  const [, h1, m1, h2, m2] = match.map(Number);
  return { start: (h1 * 60) + m1, end: (h2 * 60) + m2 };
}

/** Quiet windows wrap past midnight, so a window never has start < end. */
export function inQuietHours(text, minutes) {
  const { start, end } = parseQuietHours(text);
  if (start === end) return false;
  const now = ((Number(minutes) || 0) % 1440 + 1440) % 1440;
  return start < end ? now >= start && now < end : now >= start || now < end;
}

export function reminderKey(kind, refId) {
  return `${kind}:${refId}`;
}

/** Local Date for an appointment's date + time, or null when it has neither. */
export function appointmentAt(appointment) {
  if (!appointment?.scheduled_on || !appointment?.scheduled_at) return null;
  const at = new Date(`${appointment.scheduled_on}T${String(appointment.scheduled_at).slice(0, 5)}:00`);
  return Number.isNaN(at.getTime()) ? null : at;
}

const firstName = (name = '') => String(name).trim().split(/\s+/)[0] || 'there';

/**
 * The message itself. Same contract as the rest of the product: the clinic, the
 * doctor, the date, the time, an amount where one is owed — and nothing clinical.
 */
export function reminderText({ kind = 'follow-up', patient, clinic, doctor, when, amount, reference } = {}) {
  const clinicName = clinic?.name ?? 'the clinic';
  const phone = clinic?.phone ? ` or call ${clinic.phone}` : '';
  const hello = `Hello ${firstName(patient?.full_name)},`;
  const sign = `\n\nThank you,\n${clinicName}`;

  if (kind === 'appointment') {
    return `${hello}

This is ${clinicName}. Your appointment${doctor ? ` with ${doctor.full_name}` : ''} is on ${when ?? 'the booked date'}. Please arrive 10 minutes early.

Reply to this message${phone} if you need to change the time.${sign}`;
  }

  if (kind === 'balance') {
    return `${hello}

This is ${clinicName}. ${money(amount ?? 0)} is pending on ${reference ? `bill ${reference}` : 'your bill'}.

You can settle it at the front desk on your next visit, or ask us for the UPI QR to pay by phone.${sign}`;
  }

  return `${hello}

This is ${clinicName}. A follow-up visit was advised for ${when ?? 'around now'}.${doctor ? ` ${doctor.full_name} will be available in the same session.` : ''}

Reply to this message${phone} and we will book a convenient time.${sign}`;
}

/** Digits only, with the country code, for a wa.me link. Empty when unusable. */
export function whatsappLink(phone, text = '') {
  let digits = String(phone || '').replace(/[^\d]/g, '');
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  if (digits.length < 11) return '';
  const base = `https://wa.me/${digits}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

/**
 * The reminder queue for right now.
 *
 * Four sources, one message each, deduped against the send log so a patient is
 * never messaged twice for the same thing on the same day:
 *
 *   appointment  booked, inside the lead window (default 24 h from now)
 *   follow-up    recalled, due within `windowDays` (overdue included)
 *   balance      owes money on a bill older than `balanceDays`
 *
 * Patients with no phone number are returned separately rather than silently
 * dropped — the desk can still ring them from the patient chart.
 */
export function reminderDrafts({
  appointments = [], consultations = [], invoices = [], patients = [], doctors = [],
  clinic = null, log = [], now = new Date(), leadHours = 24,
  windowDays = 7, balanceDays = 7, quiet = '21:00-08:00', limit = 40,
} = {}) {
  const iso = localISO(now);
  const held = inQuietHours(quiet, now.getHours() * 60 + now.getMinutes());
  const cutoff = new Date(now.getTime() + Math.max(1, Number(leadHours) || 24) * 3600000);
  const patientOf = (id) => patients.find((p) => p.id === id) ?? null;
  const doctorOf = (id) => doctors.find((d) => d.id === id) ?? null;

  // Anything already logged inside its kind's window is done — don't re-draft it.
  const recent = (key, kind) => {
    const days = reminderKind(kind).dedupeDays;
    const floor = addDays(iso, -days);
    return log.some((entry) => entry.draft_key === key && String(entry.logged_on || '') >= floor);
  };

  const drafts = [];
  const noPhone = [];
  const push = (draft) => {
    const patient = patientOf(draft.patient_id);
    if (!patient?.phone) {
      noPhone.push({ ...draft, patient_name: patient?.full_name ?? 'Patient' });
      return;
    }
    if (recent(draft.key, draft.kind)) return;
    const doctor = draft.doctor_id ? doctorOf(draft.doctor_id) : null;
    drafts.push({
      ...draft,
      patient_name: patient.full_name,
      phone: patient.phone,
      hold: held,
      doctor_name: doctor?.full_name ?? '',
      text: reminderText({
        kind: draft.kind, patient, clinic, doctor,
        when: draft.when, amount: draft.amount, reference: draft.reference,
      }),
    });
  };

  // 1 — appointments inside the lead window
  for (const appt of appointments) {
    if (appt.status !== 'booked') continue;
    const at = appointmentAt(appt);
    if (!at || at <= now || at > cutoff) continue;
    push({
      key: reminderKey('appointment', appt.id),
      kind: 'appointment',
      patient_id: appt.patient_id,
      ref_id: appt.id,
      doctor_id: appt.doctor_id,
      due_on: appt.scheduled_on,
      at: at.toISOString(),
      when: `${formatDate(appt.scheduled_on, { weekday: true })} at ${formatTime(appt.scheduled_at)}`,
      title: `${formatDate(appt.scheduled_on, { weekday: true })} · ${formatTime(appt.scheduled_at)}`,
      sub: doctorOf(appt.doctor_id) ? `with ${doctorOf(appt.doctor_id).full_name}` : appt.kind,
    });
  }

  // 2 — recalls that are due or overdue
  const horizon = addDays(iso, windowDays);
  for (const visit of consultations) {
    if (!visit.follow_up_on || visit.follow_up_done) continue;
    if (visit.follow_up_on > horizon) continue;
    const days = daysBetween(iso, visit.follow_up_on);
    push({
      key: reminderKey('follow-up', visit.id),
      kind: 'follow-up',
      patient_id: visit.patient_id,
      ref_id: visit.id,
      doctor_id: visit.doctor_id,
      due_on: visit.follow_up_on,
      when: formatDate(visit.follow_up_on, { weekday: true }),
      title: days < 0 ? `Follow-up ${Math.abs(days)} days overdue` : days === 0 ? 'Follow-up due today' : `Follow-up in ${days} days`,
      sub: doctorOf(visit.doctor_id) ? `${doctorOf(visit.doctor_id).full_name} · advised ${formatDate(visit.visited_on, { withYear: false })}` : 'recall',
    });
  }

  // 3 — old money
  const owedByPatient = new Map();
  for (const invoice of liveInvoices(invoices)) {
    const balance = invoiceBalance(invoice);
    if (!balance) continue;
    if (invoice.issued_on > addDays(iso, -balanceDays)) continue;
    const current = owedByPatient.get(invoice.patient_id);
    if (!current) {
      owedByPatient.set(invoice.patient_id, { amount: balance, invoice });
    } else {
      current.amount += balance;
      if (invoice.issued_on < current.invoice.issued_on) current.invoice = invoice;
    }
  }
  for (const [patientId, owed] of owedByPatient) {
    push({
      key: reminderKey('balance', owed.invoice.id),
      kind: 'balance',
      patient_id: patientId,
      ref_id: owed.invoice.id,
      doctor_id: owed.invoice.doctor_id ?? null,
      due_on: owed.invoice.issued_on,
      amount: owed.amount,
      reference: owed.invoice.number,
      title: `${money(owed.amount)} pending`,
      sub: `${formatDate(owed.invoice.issued_on, { withYear: false })} · ${owed.invoice.number}`,
    });
  }

  const order = { appointment: 0, 'follow-up': 1, balance: 2 };
  drafts.sort((a, b) => (order[a.kind] - order[b.kind]) || String(a.due_on).localeCompare(String(b.due_on)));

  return {
    iso,
    held,
    quietHours: quiet,
    drafts: drafts.slice(0, limit),
    total: drafts.length,
    noPhone,
    counts: {
      appointment: drafts.filter((d) => d.kind === 'appointment').length,
      'follow-up': drafts.filter((d) => d.kind === 'follow-up').length,
      balance: drafts.filter((d) => d.kind === 'balance').length,
    },
  };
}

/** Today's send log, newest first, with the patient name resolved. */
export function reminderLog({ log = [], patients = [], iso }) {
  return log
    .filter((entry) => !iso || entry.logged_on === iso)
    .map((entry) => ({
      ...entry,
      patient_name: patients.find((p) => p.id === entry.patient_id)?.full_name ?? 'Patient',
      status_label: reminderStatus(entry.status).label,
      status_tone: reminderStatus(entry.status).tone,
      channel_label: channelLabel(entry.channel),
      kind_label: reminderKind(entry.kind).label,
    }))
    .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
}
