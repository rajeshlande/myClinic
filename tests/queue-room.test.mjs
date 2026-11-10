import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ROOM_LIMIT, canCallNext, roomFullMessage, roomSeats, queueBoard, queueState, tokenLabel,
} from '../src/lib/queue.mjs';
import * as barrel from '../src/lib/logic.mjs';

/*
 * v1.35.0 — two seats in the consulting room.
 *
 * The board used to return one `serving` per doctor while "Call next" flipped a
 * second token to `in-consult` unconditionally. The data could therefore hold two
 * people in the room and every screen showed only one. These tests hold the two
 * seats, the limit that refuses a third, and the three screens that must agree.
 */

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFileSync(join(root, p), 'utf8');
/** Comments may name a forbidden pattern without containing it. */
const code = (p) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const ISO = '2026-11-10';
const doctors = [
  { id: 'd1', full_name: 'Dr One', role: 'doctor', specialty: 'General Physician' },
  { id: 'd2', full_name: 'Dr Two', role: 'doctor', specialty: 'Pediatrics' },
  { id: 'fd', full_name: 'Front Desk', role: 'frontdesk' },
];
const patients = [
  { id: 'p9', full_name: 'Patient Nine' },
  { id: 'p10', full_name: 'Patient Ten' },
  { id: 'p11', full_name: 'Patient Eleven' },
  { id: 'p12', full_name: 'Patient Twelve' },
];
const appt = (id, patient_id, token_no, status, doctor_id = 'd1', at = '09:00') => ({
  id, patient_id, doctor_id, token_no, status, scheduled_on: ISO, scheduled_at: at,
});

/** T-09 talking, T-10 waiting inside the room, T-11 still at the desk. */
const twoInRoom = [
  appt('a9', 'p9', 9, 'in-consult', 'd1', '09:00'),
  appt('a10', 'p10', 10, 'in-consult', 'd1', '09:10'),
  appt('a11', 'p11', 11, 'checked-in', 'd1', '09:20'),
  appt('a12', 'p12', 12, 'booked', 'd1', '09:30'),
];
const boardOf = (appointments) => queueBoard({ appointments, patients, doctors, iso: ISO, doctorId: 'd1' });

test('the room has exactly two seats and the gate matches', () => {
  assert.equal(ROOM_LIMIT, 2);
  assert.equal(canCallNext([]), true);
  assert.equal(canCallNext([{}, {}]), false);
  assert.equal(canCallNext([{}, {}, {}]), false);
  assert.equal(canCallNext(), true, 'a missing list must not be read as a full room');
  assert.equal(canCallNext('nonsense'), true, 'a bad argument must not be read as a full room');
});

test('the refusal names the people already in the room', () => {
  assert.equal(roomFullMessage([]), '');
  assert.equal(roomFullMessage([{ token_no: 4 }]), '', 'one seat taken is not full');
  const two = roomFullMessage([{ token_no: 4 }, { token_no: 5 }]);
  assert.match(two, /Room is full — T-04 and T-05 are already in the room\./);
  assert.match(two, /Mark one as seen before calling another\./);
  // Legacy data can hold three. The message still lists every token, not just two.
  const three = roomFullMessage([{ token_no: 4 }, { token_no: 5 }, { token_no: 6 }]);
  assert.match(three, /T-04, T-05 and T-06 are already in the room/);
  assert.equal(roomFullMessage(), '');
});

test('roomSeats labels the first as Talking and the rest as Waiting in room', () => {
  assert.deepEqual(roomSeats([]), []);
  const seats = roomSeats([{ token_no: 9 }, { token_no: 10 }, { token_no: 11 }]);
  assert.equal(seats.length, 3);
  assert.deepEqual(seats.map((s) => s.label), ['Talking', 'Waiting in room', 'Waiting in room']);
  assert.deepEqual(seats.map((s) => s.primary), [true, false, false]);
  assert.deepEqual(seats.map((s) => s.tone), ['accent', 'warn', 'warn']);
  assert.equal(seats[0].appt.token_no, 9, 'the seats keep token order, not array-of-labels order');
  assert.equal(roomSeats('nonsense').length, 0);
});

test('every seat owns its own Consult and Done, named when two are in the room', () => {
  const one = roomSeats([{ token_no: 9 }]);
  assert.equal(one[0].token, 'T-09');
  assert.equal(one[0].consultLabel, 'Consult', 'a lone seat needs no token in the label');
  assert.equal(one[0].doneLabel, 'Done');

  const two = roomSeats([{ token_no: 9 }, { token_no: 10 }]);
  assert.deepEqual(two.map((x) => x.consultLabel), ['Consult T-09', 'Consult T-10']);
  assert.deepEqual(two.map((x) => x.doneLabel), ['Done T-09', 'Done T-10']);
  assert.equal(new Set(two.map((x) => x.consultLabel)).size, 2, 'two Consult buttons must be distinguishable');

  const three = roomSeats([{ token_no: 9 }, { token_no: 10 }, { token_no: 11 }]);
  assert.deepEqual(three.map((x) => x.consultLabel), ['Consult T-09', 'Consult T-10', 'Consult T-11']);
  assert.deepEqual(three.map((x) => x.appt.token_no), [9, 10, 11], 'labels follow the appointment, not the slot');
});

test('queueBoard reports both people in the room, in token order', () => {
  const row = boardOf(twoInRoom).rows[0];
  assert.equal(row.inRoom.length, 2);
  assert.deepEqual(row.inRoom.map((a) => a.token_no), [9, 10]);
  assert.equal(row.roomCount, 2);
  assert.equal(row.roomLimit, ROOM_LIMIT);
  assert.equal(row.canCallNext, false);
  assert.match(row.roomFull, /T-09 and T-10/);
  assert.deepEqual(row.seats.map((s) => s.label), ['Talking', 'Waiting in room']);
  // `serving` is kept as the first seat so every older reader still works.
  assert.equal(row.serving.token_no, 9);
  assert.equal(row.serving, row.inRoom[0]);
  assert.equal(row.next.token_no, 11);
  assert.equal(row.waiting.length, 2, 'in-consult tokens are not also queued as waiting');
});

test('totals.serving counts people, not doctors with someone in the room', () => {
  const board = boardOf(twoInRoom);
  assert.equal(board.totals.serving, 2);
  assert.equal(board.totals.inRoom, 2);
  // Two doctors with one each is still two people — but the old implementation
  // reached that number for the wrong reason, so pin the single-doctor case too.
  const split = queueBoard({
    appointments: [
      appt('a9', 'p9', 9, 'in-consult', 'd1'),
      appt('a1', 'p10', 1, 'in-consult', 'd2'),
    ],
    patients, doctors, iso: ISO,
  });
  assert.equal(split.totals.serving, 2);
  assert.equal(split.rows[0].roomCount, 1);
  assert.equal(split.rows[1].roomCount, 1);
});

test('one seat free: a call fills it, completing one frees it again', () => {
  const one = [
    appt('a9', 'p9', 9, 'in-consult'),
    appt('a10', 'p10', 10, 'checked-in'),
    appt('a11', 'p11', 11, 'checked-in'),
  ];
  let row = boardOf(one).rows[0];
  assert.equal(row.roomCount, 1);
  assert.equal(row.canCallNext, true, 'the second seat is free');
  assert.equal(row.roomFull, '');
  assert.deepEqual(row.seats.map((s) => s.label), ['Talking']);

  // The desk calls T-10 in. Nothing in the board changes shape, only the count.
  row = boardOf(one.map((a) => a.id === 'a10' ? { ...a, status: 'in-consult' } : a)).rows[0];
  assert.equal(row.roomCount, 2);
  assert.equal(row.canCallNext, false, 'a third call must be refused');
  assert.deepEqual(row.seats.map((s) => s.label), ['Talking', 'Waiting in room']);
  assert.equal(row.next.token_no, 11, 'the third token stays at the desk');

  row = boardOf(one.map((a) => a.id === 'a9' ? { ...a, status: 'completed' } : a)).rows[0];
  assert.equal(row.roomCount, 0);
  assert.equal(row.canCallNext, true, 'completing the consultation frees a seat');
});

test('the existing one-token board is unchanged (older clients and seeds)', () => {
  const row = boardOf([
    appt('a9', 'p9', 9, 'completed'),
    appt('a10', 'p10', 10, 'in-consult'),
    appt('a11', 'p11', 11, 'checked-in'),
    appt('a12', 'p12', 12, 'booked'),
  ]).rows[0];
  assert.equal(row.serving.token_no, 10);
  assert.equal(row.inRoom.length, 1);
  assert.equal(row.seats.length, 1);
  assert.equal(row.seats[0].label, 'Talking');
  assert.equal(row.next.token_no, 11);
  assert.equal(row.waiting.length, 2);
  assert.equal(row.completed.length, 1);
  assert.equal(row.issued, 4);
  assert.equal(row.nextToken, 13);
  assert.equal(row.canCallNext, true);
  assert.equal(queueState({ status: 'in-consult' }).label, 'In the room');
  assert.equal(tokenLabel(9), 'T-09');
});

test('the four new names are in the barrel, by identity', () => {
  assert.equal(barrel.ROOM_LIMIT, ROOM_LIMIT);
  assert.equal(barrel.canCallNext, canCallNext);
  assert.equal(barrel.roomFullMessage, roomFullMessage);
  assert.equal(barrel.roomSeats, roomSeats);
});

/* -------------------------------------------------------------- page ratchets --
 * A rule that lives only in a test is a rule that will drift. These hold the
 * three screens to the board: the card must render the seats (not a single
 * `serving`), every call-in path must go through the guarded function, and the
 * display and dashboard must read the whole room.
 */
test('the queue card renders the seats, not one hard-coded serving row', () => {
  const q = code('src/pages/Queue.jsx');
  assert.match(q, /row\.seats\.map\(/, 'the room card must iterate the seats');
  assert.match(q, /seat\.label/, 'the Talking / Waiting in room labels come from the lib');
  assert.match(q, /row\.roomCount \/ row\.roomLimit|roomCount.*roomLimit/, 'the N / 2 badge');
  assert.match(q, /row\.roomFull/, 'the inline reason when the room is full');
  assert.match(q, /seat\.primary \?/, 'the first seat is the large one');
  assert.doesNotMatch(q, /row\.serving \?/, 'no single-serving room card is left');
});

test('each seat renders its own Consult and Done on its own appointment', () => {
  const q = code('src/pages/Queue.jsx');
  assert.match(q, /seat\.consultLabel/, 'Consult labels come from roomSeats()');
  assert.match(q, /seat\.doneLabel/, 'Done labels come from roomSeats()');
  assert.match(q, /setConsultFor\(seat\.appt\)/, 'Consult opens this seat, not seats[0]');
  assert.match(q, /markDone\(seat\.appt\)/, 'Done completes this seat, not seats[0]');
  assert.doesNotMatch(q, /setConsultFor\(row\.seats\[0\]\)/, 'no shared Consult for the first seat only');
  assert.doesNotMatch(q, /row\.seats\.length > 1 \? `Done/, 'no token-naming rule left inline in JSX');
  // Both buttons live inside the seat map, not in a row beneath it.
  const mapAt = q.indexOf('row.seats.map((seat) => (');
  const callAt = q.indexOf('onClick={() => callIn(row)}');
  assert.ok(mapAt > -1 && callAt > mapAt, 'the seats map comes before the shared call-in button');
  assert.ok(q.indexOf('setConsultFor(seat.appt)') > mapAt && q.indexOf('setConsultFor(seat.appt)') < callAt,
    'the per-seat Consult is inside the seats block');
});

test('every control that calls a patient in goes through the guarded callIn', () => {
  const q = code('src/pages/Queue.jsx');
  const calls = [...q.matchAll(/onClick=\{\(\) => callIn\(/g)].length;
  assert.equal(calls, 3, 'the room card, Up next and the token table all use callIn');
  assert.match(q, /canCallNext\(live\.inRoom\)/, 'the limit is re-read from fresh state');
  assert.match(q, /callingRef\.current/, 'a double click cannot write twice');
  assert.doesNotMatch(q, /setStatus\(appt, 'in-consult', 'Called in\.'\)/, 'no unguarded write left');
  assert.match(q, /disabled=\{!row\.canCallNext\}/, 'Call next is disabled when full');
});

test('the display and the dashboard read the whole room', () => {
  const q = code('src/pages/Queue.jsx');
  assert.match(q, /board\.rows\.filter\(\(r\) => r\.seats\.length \|\| r\.next\)/, 'the display keeps both seats');
  assert.match(q, /seat\.appt\.token_no/, 'the display prints every token in the room');
  assert.match(q, /row\.canCallNext \? 'Please proceed' : 'Please wait'/, 'a full room does not tell patients to proceed');
  const d = code('src/pages/Dashboard.jsx');
  assert.match(d, /board\.totals\.serving/, 'the "N in the room" count reads the total');
  assert.match(d, /r\.inRoom\.length \? r\.inRoom\.map/, 'the strip lists both tokens');
});

test('the limit is one constant, not a number repeated in the screens', () => {
  const q = code('src/pages/Queue.jsx');
  assert.doesNotMatch(q, /roomLimit:\s*2|< 2\b/, 'the screen must not invent its own limit');
  assert.equal((read('src/lib/queue.mjs').match(/export const ROOM_LIMIT = 2;/g) ?? []).length, 1);
});
