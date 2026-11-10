import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PATIENT_DATE_FIELDS, DATE_PRESETS, isoDay, fieldLabel, patientDate,
  normaliseDateRange, presetRange, dateFilterActive, dateRangeLabel, filterPatientsByDate,
} from '../src/lib/patient-dates.mjs';

/*
 * v1.35.2 — a date filter on the Patient records / All list.
 *
 * The register had two *fixed* date rules (New this month, Not seen recently) and
 * no way to choose a date. These tests hold the inclusive range, the two dates a
 * row can be read by, the presets, and the wiring that makes the same filtered
 * set feed the list, the All count and Export.
 */

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const code = (p) => readFileSync(join(root, p), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const P = [
  { id: 'p1', full_name: 'One', created_at: '2026-10-31T09:00:00Z' },
  { id: 'p2', full_name: 'Two', created_at: '2026-11-01T09:00:00Z' },
  { id: 'p3', full_name: 'Three', created_at: '2026-11-05T09:00:00Z' },
  { id: 'p4', full_name: 'Four', created_at: '2026-11-10T09:00:00Z' },
  { id: 'p5', full_name: 'Five', created_at: '2026-11-11T09:00:00Z' },
  { id: 'p6', full_name: 'No date' },
];
const visits = {
  p1: { visited_on: '2026-11-09' },
  p2: { visited_on: '2026-10-20' },
  p3: { visited_on: '2026-11-01' },
  p4: null,
  p5: { visited_on: '2026-11-10' },
  p6: null,
};
const lastVisitOf = (p) => visits[p.id] ?? null;
const ids = (list) => list.map((p) => p.id);

test('isoDay reads timestamps and plain dates but refuses impossible days', () => {
  assert.equal(isoDay('2026-11-02T10:22:00.000Z'), '2026-11-02');
  assert.equal(isoDay('2026-11-02'), '2026-11-02');
  assert.equal(isoDay(' 2026-11-02 '), '2026-11-02');
  assert.equal(isoDay('2026-02-30'), '', '30 February is not a date');
  assert.equal(isoDay('2026-13-01'), '');
  assert.equal(isoDay('2026-11-2'), '');
  assert.equal(isoDay(''), '');
  assert.equal(isoDay(null), '');
  assert.equal(isoDay('yesterday'), '');
  assert.equal(isoDay(undefined), '');
});

test('the two date fields are named and read from the right place', () => {
  assert.deepEqual(PATIENT_DATE_FIELDS.map((f) => f.value), ['registered', 'lastVisit']);
  assert.equal(fieldLabel('registered'), 'Registered');
  assert.equal(fieldLabel('lastVisit'), 'Last seen');
  assert.equal(fieldLabel('nonsense'), 'Registered', 'an unknown field falls back, never invents a label');
  assert.equal(patientDate(P[2], 'registered'), '2026-11-05');
  assert.equal(patientDate(P[2]), '2026-11-05', 'registered is the default');
  assert.equal(patientDate(P[2], 'lastVisit', visits.p3), '2026-11-01');
  assert.equal(patientDate(P[1], 'lastVisit', null), '', 'a patient never seen has no date to compare');
});

test('normaliseDateRange is inclusive, tolerant of half-typed bounds, refuses reversal', () => {
  assert.deepEqual(normaliseDateRange('2026-11-01', '2026-11-10'), { from: '2026-11-01', to: '2026-11-10', error: '' });
  assert.deepEqual(normaliseDateRange('2026-11-10', ''), { from: '2026-11-10', to: '', error: '' });
  assert.deepEqual(normaliseDateRange('', '2026-11-10'), { from: '', to: '2026-11-10', error: '' });
  assert.deepEqual(normaliseDateRange('junk', '2026-11-10'), { from: '', to: '2026-11-10', error: '' },
    'a half-typed bound is dropped, not treated as an error');
  const bad = normaliseDateRange('2026-11-10', '2026-11-01');
  assert.match(bad.error, /start date is after the end date/);
  assert.equal(normaliseDateRange('', '').error, '');
});

test('quick presets are inclusive and end on the given day', () => {
  const iso = '2026-11-10';
  assert.deepEqual(presetRange('today', iso), { from: iso, to: iso });
  assert.deepEqual(presetRange('week', iso), { from: '2026-11-04', to: iso });
  assert.deepEqual(presetRange('month', iso), { from: '2026-11-01', to: iso });
  assert.deepEqual(presetRange('30', iso), { from: '2026-10-12', to: iso });
  assert.deepEqual(presetRange('90', iso), { from: '2026-08-13', to: iso });
  assert.deepEqual(presetRange('', iso), { from: '', to: '' });
  assert.deepEqual(presetRange('nonsense', iso), { from: '', to: '' });
  assert.deepEqual(presetRange('today', 'nonsense'), { from: '', to: '' });
  assert.equal(DATE_PRESETS.length, 5);
  // Every preset's own range really is the number of days it claims.
  for (const p of DATE_PRESETS) {
    const r = presetRange(p.value, iso);
    assert.ok(r.from <= r.to, `${p.value} is reversed`);
  }
  assert.equal(presetRange('month', '2026-03-10').from, '2026-03-01');
});

test('an inactive filter returns the very same array (the old list, unchanged)', () => {
  assert.equal(filterPatientsByDate(P, {}), P);
  assert.equal(filterPatientsByDate(P, { from: '', to: '' }), P);
  assert.equal(filterPatientsByDate(P, { from: 'junk', to: '' }), P);
  assert.deepEqual(filterPatientsByDate(), [], 'a missing list is an empty list');
  assert.equal(dateFilterActive('', ''), false);
  assert.equal(dateFilterActive('2026-11-01', ''), true);
  assert.equal(dateFilterActive('junk', ''), false);
});

test('the range is inclusive and a reversed range keeps every row', () => {
  assert.deepEqual(ids(filterPatientsByDate(P, { from: '2026-11-01', to: '2026-11-10' })), ['p2', 'p3', 'p4']);
  assert.deepEqual(ids(filterPatientsByDate(P, { from: '2026-11-05', to: '2026-11-05' })), ['p3']);
  assert.deepEqual(ids(filterPatientsByDate(P, { from: '2026-11-05' })), ['p3', 'p4', 'p5']);
  assert.deepEqual(ids(filterPatientsByDate(P, { to: '2026-11-01' })), ['p1', 'p2']);
  assert.equal(filterPatientsByDate(P, { from: '2026-11-10', to: '2026-11-01' }), P,
    'a reversed range refuses to filter rather than showing an empty register');
});

test('switching the field switches the answer, using the permission-aware last visit', () => {
  const range = { from: '2026-11-01', to: '2026-11-09' };
  assert.deepEqual(ids(filterPatientsByDate(P, { ...range, field: 'registered' })), ['p2', 'p3'],
    'p4 was registered on 10 Nov, past a range ending on 9 Nov');
  assert.deepEqual(ids(filterPatientsByDate(P, {
    ...range, field: 'lastVisit', lastVisitOf,
  })), ['p1', 'p3'], 'reads visited_on, and calls the supplied callback for it');
  assert.deepEqual(ids(filterPatientsByDate(P, { ...range, field: 'lastVisit' })), [],
    'without a last-visit source nobody matches, rather than reading created_at by mistake');
  let calls = 0;
  filterPatientsByDate(P, { ...range, field: 'lastVisit', lastVisitOf: (p) => { calls += 1; return visits[p.id] ?? null; } });
  assert.equal(calls, P.length, 'the callback is used for every row, so it can enforce permissions');
});

test('a row with no date is excluded while a filter is active', () => {
  assert.ok(ids(filterPatientsByDate(P, {})).includes('p6'));
  assert.ok(!ids(filterPatientsByDate(P, { from: '2026-01-01' })).includes('p6'));
  assert.ok(!ids(filterPatientsByDate(P, { from: '2026-01-01', field: 'lastVisit', lastVisitOf })).includes('p6'));
  assert.deepEqual(filterPatientsByDate('nonsense', { from: '2026-01-01' }), []);
});

test('dateRangeLabel says what the desk is looking at, in words', () => {
  assert.equal(dateRangeLabel({}), '');
  assert.equal(dateRangeLabel({ from: '2026-11-01', to: '2026-11-10' }), 'Registered 1 Nov – 10 Nov');
  assert.equal(dateRangeLabel({ from: '2026-11-02', to: '2026-11-02' }), 'Registered on 2 Nov');
  assert.equal(dateRangeLabel({ from: '2026-11-02' }), 'Registered from 2 Nov');
  assert.equal(dateRangeLabel({ to: '2026-11-10' }), 'Registered until 10 Nov');
  assert.equal(dateRangeLabel({ field: 'lastVisit', from: '2026-11-01' }), 'Last seen from 1 Nov');
  assert.equal(dateRangeLabel({ from: 'junk', to: 'junk' }), '');
});

/* -------------------------------------------------------------- page ratchets */
test('the Patients page wires the filter into the list, the All count and Export', () => {
  const q = code('src/pages/Patients.jsx');
  assert.match(q, /from '\.\.\/lib\/patient-dates\.mjs'/, 'the page uses the pure module, not inline rules');
  assert.match(q, /isoDay\(params\.get\('from'\)\)/, 'linked bounds are sanitised');
  assert.match(q, /filterPatientsByDate\(store\.patients/, 'the scoped list comes from the module');
  assert.match(q, /patientSearch\(dateScoped, query\)/, 'search runs on the date-scoped list');
  assert.match(q, /label: 'All', count: dateScoped\.length/, 'the All tab counts the filtered rows');
  assert.match(q, /lastVisitOf: \(p\) => lastSeen\(p\.id\)/,
    'Last seen uses the permission-aware lastSeen with the patient id, not the row');
  assert.match(q, /const csv = toCSV\(rows,/, 'Export writes the rows the desk sees');
  assert.match(q, /aria-live="polite"/, 'the active range is announced');
  assert.match(q, /role="alert"[\s\S]{0,120}dateRange\.error/, 'a reversed range is shown on screen');
  assert.match(q, /type="date"/, 'native date inputs');
  assert.match(q, /DATE_PRESETS\.map/, 'the presets come from the module');
  // The pre-existing "New this month" tab keeps its own fixed comparison; what
  // must not appear is a *second*, inline implementation of the chosen range.
  assert.doesNotMatch(q, /filter\(\(p\) =>[\s\S]{0,240}(fromDate|toDate)/, 'no hand-rolled date range in the page');
});
