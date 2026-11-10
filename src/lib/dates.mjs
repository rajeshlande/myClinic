/**
 * Dates, times and ages — the clinic's local day, never UTC.
 *
 * Split out of `logic.mjs` in v1.29.0. Every function takes an ISO date string and
 * returns one, so the calendar on screen and the row in Postgres agree.
 */

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
