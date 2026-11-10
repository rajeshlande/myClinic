/**
 * Reporting: month totals, series and the performance tables.
 *
 * Split out of `logic.mjs` in v1.29.0. Reads rows, returns numbers; no formatting
 * beyond what a chart needs, so the screens and the exports cannot disagree.
 */

import { sumBy } from './money.mjs';
import { monthLabel, recentMonths, timeToMinutes } from './dates.mjs';
import { appointmentsForDate } from './appointments.mjs';

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
