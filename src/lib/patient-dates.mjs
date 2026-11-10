/**
 * Date filtering for the patient register (v1.35.2).
 *
 * Two dates are meaningful on a row: the day the patient was registered
 * (`created_at`) and the day they were last seen (a consultation, or — when the
 * front desk cannot read consultations — a completed appointment). The desk may
 * filter by either over an inclusive ISO range. Everything here is pure: the page
 * passes in `lastVisitOf` so permission rules stay in the store.
 */

import { addDays, formatDate, today, validISO } from './dates.mjs';

/** The two dates the filter can read, in the words the desk uses. */
export const PATIENT_DATE_FIELDS = [
  { value: 'registered', label: 'Registered' },
  { value: 'lastVisit', label: 'Last seen' },
];

/** Quick ranges. `value` is stable so a test can pin the arithmetic. */
export const DATE_PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'This month' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

/**
 * The first ten characters of a date-ish value, but only if they are a real
 * calendar day. `created_at` is a timestamp; `visited_on` is a plain date; a
 * half-typed `<input type="date">` is empty. All three land here.
 */
export function isoDay(value) {
  const head = String(value ?? '').trim().slice(0, 10);
  return validISO(head) ? head : '';
}

export function fieldLabel(field) {
  return PATIENT_DATE_FIELDS.find((f) => f.value === field)?.label ?? PATIENT_DATE_FIELDS[0].label;
}

/** The ISO day this filter compares for one patient, or '' when there is none. */
export function patientDate(patient, field = 'registered', lastVisit = null) {
  return field === 'lastVisit' ? isoDay(lastVisit?.visited_on) : isoDay(patient?.created_at);
}

/**
 * An inclusive range. Unreadable bounds are dropped rather than refused — a
 * half-typed date is normal while someone is picking a day. A *reversed* range is
 * a mistake the desk should be told about, so it comes back with `error`.
 */
export function normaliseDateRange(from, to) {
  const start = isoDay(from);
  const end = isoDay(to);
  if (start && end && start > end) {
    return { from: start, to: end, error: 'The start date is after the end date.' };
  }
  return { from: start, to: end, error: '' };
}

/** Both bounds for a quick preset, ending on `iso` (inclusive). */
export function presetRange(value, iso = today()) {
  const end = isoDay(iso);
  if (!end) return { from: '', to: '' };
  if (value === 'today') return { from: end, to: end };
  if (value === 'month') return { from: `${end.slice(0, 7)}-01`, to: end };
  const days = { week: 7, '30': 30, '90': 90 }[value];
  if (days) return { from: addDays(end, -(days - 1)), to: end };
  return { from: '', to: '' };
}

export function dateFilterActive(from, to) {
  return Boolean(isoDay(from) || isoDay(to));
}

/** One line telling the desk what the active filter is doing. */
export function dateRangeLabel({ field = 'registered', from = '', to = '' } = {}) {
  const start = isoDay(from);
  const end = isoDay(to);
  const short = (d) => formatDate(d, { withYear: false });
  const label = fieldLabel(field);
  if (start && end) return start === end ? `${label} on ${short(start)}` : `${label} ${short(start)} – ${short(end)}`;
  if (start) return `${label} from ${short(start)}`;
  if (end) return `${label} until ${short(end)}`;
  return '';
}

/**
 * Keep patients whose chosen day falls inside the inclusive range.
 *
 * An inactive filter returns the *same array* it was given — no copy, no
 * reordering — so an unfiltered register is exactly what it was before. A
 * reversed range is refused (all rows kept) rather than quietly showing nothing.
 * A row with no date is excluded while a filter is active: "no date" is not
 * "inside the range".
 */
export function filterPatientsByDate(patients = [], { field = 'registered', from = '', to = '', lastVisitOf = () => null } = {}) {
  const list = Array.isArray(patients) ? patients : [];
  const range = normaliseDateRange(from, to);
  if (range.error || (!range.from && !range.to)) return list;
  return list.filter((p) => {
    const day = patientDate(p, field, lastVisitOf(p));
    if (!day) return false;
    if (range.from && day < range.from) return false;
    if (range.to && day > range.to) return false;
    return true;
  });
}
