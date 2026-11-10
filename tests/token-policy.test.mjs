import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LATE_MARK, ATTENDANCE, tokensForPatientOnDay, tokenIssueCheck, duplicateTokenReason,
  attendanceOf, attendanceCounts, isArrivedLate, lateStamp, withLateNote,
  isPastSlot, arrivalPatch, noShowPatch,
} from '../src/lib/token-policy.mjs';
import { queueBoard } from '../src/lib/queue.mjs';

/*
 * v1.35.4 — one token per patient per day, and attendance that can be recovered.
 *
 * TokenForm used to insert a token unconditionally, and queueBoard dropped
 * no-show tokens, so the only way to serve a patient who turned up late was a
 * *second* number. These tests hold the refusal, the note-marker "arrived late"
 * state (no schema change), and the wiring that re-uses the existing appointment.
 */

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const code = (p) => readFileSync(join(root, p), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const ISO = '2026-11-02';
const appt = (o = {}) => ({
  id: `a-${Math.random()}`, patient_id: 'p1', doctor_id: 'd1', scheduled_on: ISO,
  scheduled_at: '09:15', duration_minutes: 15, token_no: 1, status: 'checked-in', notes: '', ...o,
});
const DUPES = [
  appt({ id: 'a1', token_no: 3, status: 'no-show', scheduled_at: '09:15' }),
  appt({ id: 'a2', token_no: 8, status: 'completed', scheduled_at: '11:40' }),
];

test('a token is one live, numbered row for that patient on that day', () => {
  const rows = [
    ...DUPES,
    appt({ id: 'a3', patient_id: 'p2', token_no: 4 }),
    appt({ id: 'a4', scheduled_on: '2026-11-01', token_no: 5 }),
    appt({ id: 'a5', token_no: null }),                       // a booking, not a token
    appt({ id: 'a6', token_no: 6, status: 'cancelled' }),     // a cancelled mistake
  ];
  assert.deepEqual(tokensForPatientOnDay(rows, 'p1', ISO).map((a) => a.token_no), [3, 8]);
  assert.deepEqual(tokensForPatientOnDay(rows, 'p2', ISO).map((a) => a.token_no), [4]);
  assert.deepEqual(tokensForPatientOnDay(rows, 'p1', '2026-11-01').map((a) => a.token_no), [5]);
  assert.deepEqual(tokensForPatientOnDay(rows, '', ISO), []);
  assert.deepEqual(tokensForPatientOnDay('nonsense', 'p1', ISO), []);
});

test('issuing is refused with the existing number, and a cancelled token does not burn the day', () => {
  const base = { patientName: 'Aarav Sharma', doctorName: 'Dr. Anita Rao' };
  const refused = tokenIssueCheck({ appointments: DUPES, patientId: 'p1', iso: ISO, ...base });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'duplicate');
  assert.equal(refused.count, 2);
  assert.equal(refused.existing.token_no, 3);
  assert.match(refused.reason, /already has 2 tokens today \(T-03, T-08/);
  assert.match(refused.reason, /Re-use T-03/);
  assert.match(refused.reason, /arrived late/);

  assert.equal(tokenIssueCheck({ appointments: [], patientId: 'p1', iso: ISO }).ok, true);
  assert.equal(tokenIssueCheck({ appointments: [appt({ status: 'cancelled' })], patientId: 'p1', iso: ISO }).ok, true,
    'cancelling a mistake must not block the rest of the day');
  assert.equal(tokenIssueCheck({ appointments: [appt({ token_no: null })], patientId: 'p1', iso: ISO }).ok, true,
    'a booked appointment without a number is not a token');
  assert.equal(tokenIssueCheck({ appointments: DUPES, patientId: '', iso: ISO }).code, 'no-patient');
  assert.equal(tokenIssueCheck({ appointments: DUPES, patientId: 'p1', iso: '' }).code, 'no-day');
  assert.equal(tokenIssueCheck({ appointments: DUPES, patientId: 'p2', iso: ISO }).ok, true);
});

test('one existing token reads as a sentence the desk can act on', () => {
  const single = appt({ token_no: 3, status: 'no-show' });
  assert.equal(
    duplicateTokenReason(single, { patientName: 'Aarav Sharma', doctorName: 'Dr. Anita Rao' }),
    'Aarav Sharma already has T-03 today with Dr. Anita Rao (no show). '
      + 'Re-use that number — mark them arrived or arrived late instead of issuing another.',
  );
  assert.equal(duplicateTokenReason(null), '');
});

test('attendance names all six states, including arrived late', () => {
  const label = (o) => attendanceOf(o).label;
  assert.equal(label(null), 'No token');
  assert.equal(label(appt({ status: 'booked' })), 'Not arrived');
  assert.equal(label(appt({ status: 'checked-in' })), 'Waiting');
  assert.equal(label(appt({ status: 'checked-in', notes: '[Arrived late 14:35]' })), 'Arrived late');
  assert.equal(label(appt({ status: 'no-show' })), 'No show');
  assert.equal(label(appt({ status: 'in-consult' })), 'In the room');
  assert.equal(label(appt({ status: 'completed' })), 'Done');
  assert.equal(label(appt({ status: 'cancelled' })), 'Cancelled');
  assert.deepEqual(ATTENDANCE.map((a) => a.id),
    ['not-arrived', 'waiting', 'arrived-late', 'no-show', 'in-room', 'done']);
});

test('the late marker keeps the desk notes, replaces itself and cannot overflow', () => {
  assert.equal(withLateNote('', '14:35'), '[Arrived late 14:35]');
  assert.equal(withLateNote('Priority token', '14:35'), 'Priority token [Arrived late 14:35]');
  assert.equal(withLateNote('Priority token [Arrived late 09:00]', '14:35'), 'Priority token [Arrived late 14:35]');
  assert.equal(withLateNote('Priority token', 'junk'), `Priority token [${LATE_MARK}]`);
  assert.equal(withLateNote('x'.repeat(1200), '14:35').length, 1000);
  assert.equal(isArrivedLate({ notes: withLateNote('', '') }), true);
  assert.equal(isArrivedLate({ notes: 'Priority token' }), false);
  assert.equal(lateStamp({ notes: withLateNote('', '14:35') }), '14:35');
  assert.equal(lateStamp({ notes: '' }), '');
});

test('lateness is a real rule, not a guess, and every patch restores the same token', () => {
  assert.equal(isPastSlot(appt({ scheduled_at: '09:00' }), 9 * 60 + 20, 15), false, 'within the slot + grace');
  assert.equal(isPastSlot(appt({ scheduled_at: '09:00' }), 10 * 60 + 30, 15), true);
  assert.equal(isPastSlot(appt({}), null), false, 'no clock, no assumption');

  const onTime = arrivalPatch(appt({ status: 'booked', scheduled_at: '14:30', notes: '' }), { at: '14:35', nowMinutes: 14 * 60 + 35 });
  assert.deepEqual(onTime, { status: 'checked-in', notes: '' });
  const late = arrivalPatch(appt({ status: 'booked', scheduled_at: '09:00', notes: 'Priority token' }), { at: '10:30', nowMinutes: 630 });
  assert.equal(late.status, 'checked-in');
  assert.match(late.notes, /Priority token \[Arrived late 10:30\]/);
  const back = arrivalPatch(appt({ status: 'no-show', notes: '' }), { at: '14:35' });
  assert.match(back.notes, /\[Arrived late 14:35\]/, 'a no-show returning is always late');
  assert.match(arrivalPatch(appt({ status: 'booked' }), { at: '14:35', forceLate: true }).notes, /Arrived late/);
  assert.deepEqual(noShowPatch(), { status: 'no-show' });
});

test('attendance counts ignore cancelled rows and other days', () => {
  const rows = [
    appt({ id: 'b1', status: 'booked' }),
    appt({ id: 'b2', status: 'checked-in' }),
    appt({ id: 'b3', status: 'checked-in', notes: '[Arrived late 14:35]' }),
    appt({ id: 'b4', status: 'no-show' }),
    appt({ id: 'b5', status: 'in-consult' }),
    appt({ id: 'b6', status: 'completed' }),
    appt({ id: 'b7', status: 'cancelled' }),
    appt({ id: 'b8', scheduled_on: '2026-11-01', status: 'booked' }),
  ];
  assert.deepEqual(attendanceCounts(rows, ISO), {
    'not-arrived': 1, waiting: 1, 'arrived-late': 1, 'no-show': 1, 'in-room': 1, done: 1,
  });
  assert.deepEqual(attendanceCounts('nonsense', ISO), {
    'not-arrived': 0, waiting: 0, 'arrived-late': 0, 'no-show': 0, 'in-room': 0, done: 0,
  });
});

test('queueBoard keeps no-show tokens visible but out of the waiting list', () => {
  const rows = [
    appt({ id: 'q1', token_no: 3, status: 'no-show' }),
    appt({ id: 'q2', patient_id: 'p2', token_no: 4, status: 'booked' }),
    appt({ id: 'q3', patient_id: 'p3', token_no: 5, status: 'checked-in', notes: '[Arrived late 13:05]' }),
  ];
  const board = queueBoard({ appointments: rows, patients: [], doctors: [{ id: 'd1', full_name: 'Dr One' }], iso: ISO, doctorId: 'd1' });
  const row = board.rows[0];
  assert.deepEqual(row.missed.map((a) => a.token_no), [3]);
  assert.deepEqual(row.waiting.map((a) => a.token_no), [5, 4], 'the late arrival leads the queue');
  assert.equal(row.notArrived, 1);
  assert.equal(row.next.token_no, 5);
  assert.equal(board.totals.noShow, 1);
  assert.equal(board.totals.notArrived, 1);
  assert.equal(board.totals.waiting, 2, 'a no-show is not in the queue');
});

/* -------------------------------------------------------------- wiring ratchets */
test('TokenForm refuses a duplicate before AND at click time, and re-uses the row', () => {
  const q = code('src/components/TokenForm.jsx');
  assert.match(q, /from '\.\.\/lib\/token-policy\.mjs'/, 'the rule is a pure module, not inline JSX');
  assert.match(q, /const check = makeCheck\(store\)/, 'the refusal is visible before clicking');
  assert.match(q, /const freshCheck = makeCheck\(storeRef\.current\)/, 're-checked from the freshest store on click');
  assert.match(q, /if \(!freshCheck\.ok\) \{ toast\.error\(freshCheck\.reason/, 'a race cannot write a second token');
  assert.match(q, /<ExistingTokenPanel/, 'the desk is told which number to re-use');
  assert.match(q, /disabled=\{!patientId \|\| check\.code === 'duplicate'\}/, 'the Issue button is disabled');
  assert.match(q, /store\.update\('appointments', appt\.id, patch\)/, 'attendance updates the existing row');
  assert.doesNotMatch(q, /store\.create\('appointments'[\s\S]{0,400}applyAttendance/, 'no second insert on the re-use path');
});

test('the queue shows attendance and restores no-shows with the same number', () => {
  const q = code('src/pages/Queue.jsx');
  assert.match(q, /<MissedTokens tokens=\{row\.missed\}/, 'no-show tokens are listed, not dropped');
  assert.match(q, /\.\.\.row\.missed\]\.map/, 'they appear in the token table');
  assert.match(q, /row\.missed\.length \?/, 'empty-state logic accounts for them');
  assert.match(q, /<AttendanceActions appt=\{appt\}/);
  assert.match(q, /<AttendanceBadge appt=\{appt\}/);
  assert.match(q, /<AttendanceSummary counts=\{counts\}/);
  assert.match(q, /attendanceCounts\(store\.appointments, date\)/);
  assert.match(q, /arrivalPatch\(appt, \{ at: hhmm\(now\), nowMinutes/);
  assert.match(q, /forceLate: true/, 'an explicit arrived-late action');
  assert.match(q, /noShowPatch\(\)/);
  assert.doesNotMatch(q, /queueState\(/, 'one attendance vocabulary, not two');
});

test('the attendance components are presentational and server-renderable', () => {
  const q = code('src/components/TokenAttendance.jsx');
  assert.match(q, /from '\.\.\/lib\/token-policy\.mjs'/);
  assert.match(q, /attendanceOf\(appt\)/);
  assert.match(q, /role="alert"/, 'the duplicate refusal is announced');
  assert.match(q, /Arrived late/);
  assert.match(q, /No show \/ arrived later/);
  assert.match(q, /Use \{tokenLabel\(existing\.token_no\)\}/);
  assert.doesNotMatch(q, /useStore|new Date\(|navigator/, 'no data or clock of its own');
});

test('queueBoard gained the missed rows without a schema change', () => {
  const q = code('src/lib/queue.mjs');
  assert.match(q, /const missed = mine\.filter\(\(a\) => a\.status === 'no-show'/);
  assert.match(q, /missed,\n        notArrived: booked\.length,/);
  assert.match(q, /noShow: withToken\.filter/);
  const schema = readFileSync(join(root, 'supabase/schema.sql'), 'utf8');
  assert.match(schema, /status in \('booked','checked-in','in-consult','completed','cancelled','no-show'\)/,
    'the six-value status check is untouched — arrived late is a note, not a status');
});
