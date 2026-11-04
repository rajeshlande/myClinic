import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FOLLOW_UP_MAX_DAYS, FOLLOW_UP_MIN_DAYS, MAX_SESSIONS, WEEKDAYS,
  clampFollowUpDays, clockOf, clinicClosed, clinicSessions, closure, doctorClosed, doctorSessions,
  followUpStillValid, minutesOf, normaliseSessions, normaliseWeekdays, prettyTime,
  sessionsSummary, totalOpenMinutes, validateDoctorSessions, validateFollowUpDays,
  validateSessions, weekdayIndex, withinClinicSessions,
} from '../src/lib/hours.mjs';
import { availableSlots, groupSlots, suggestNext } from '../src/lib/schedule.mjs';

/**
 * A clinic day is two sessions, not one window, and a doctor sits inside one of
 * them. These tests hold the rules the Settings screen, the appointment sheet,
 * the public booking page and Postgres schema 12 all share.
 */

const twoSessions = [{ start: '09:00', end: '13:00' }, { start: '18:00', end: '22:00' }];

test('a time string is read and printed without a timezone in the way', () => {
  assert.equal(minutesOf('09:30'), 570);
  assert.equal(minutesOf('09:30:00'), 570);
  assert.equal(minutesOf('24:00'), null);
  assert.equal(minutesOf('9'), null);
  assert.equal(clockOf(570), '09:30');
  assert.equal(prettyTime('09:00'), '9:00 AM');
  assert.equal(prettyTime('13:00'), '1:00 PM');
  assert.equal(prettyTime('00:15'), '12:15 AM');
  assert.equal(prettyTime(''), '');
});

test('sessions are normalised, ordered, capped at two and never invented', () => {
  assert.deepEqual(normaliseSessions(twoSessions), twoSessions);
  // Out of order input still reads as a day.
  assert.deepEqual(normaliseSessions([twoSessions[1], twoSessions[0]]), twoSessions);
  // A third session is dropped rather than saved: two is the product's limit.
  assert.equal(normaliseSessions([...twoSessions, { start: '23:00', end: '23:45' }]).length, MAX_SESSIONS);
  // Unreadable values are dropped, not guessed at.
  assert.deepEqual(normaliseSessions([{ start: '18:00', end: '09:00' }]), []);
  assert.deepEqual(normaliseSessions('nonsense'), []);
  // Postgres hands back HH:MM:SS; the app speaks HH:MM everywhere else.
  assert.deepEqual(normaliseSessions([{ start: '09:00:00', end: '13:00:00' }]), [{ start: '09:00', end: '13:00' }]);
});

test('a clinic with no sessions answers its legacy open/close pair', () => {
  assert.deepEqual(clinicSessions({ open_time: '10:30', close_time: '14:30' }), [{ start: '10:30', end: '14:30' }]);
  assert.deepEqual(clinicSessions({ sessions: twoSessions, open_time: '09:00', close_time: '22:00' }), twoSessions);
  assert.deepEqual(clinicSessions({ open_time: '18:00', close_time: '09:00' }), []);
  assert.deepEqual(clinicSessions(null), []);
});

test('a doctor inherits the clinic until they have their own hours', () => {
  const clinic = { sessions: twoSessions };
  // Their own list wins.
  assert.deepEqual(doctorSessions({ sessions: [{ start: '18:00', end: '21:00' }] }, clinic), [{ start: '18:00', end: '21:00' }]);
  // A pre-schema-12 doctor keeps their single pair.
  assert.deepEqual(doctorSessions({ day_start: '10:00', day_end: '12:00' }, clinic), [{ start: '10:00', end: '12:00' }]);
  // Nothing of their own: the clinic's day.
  assert.deepEqual(doctorSessions({}, clinic), twoSessions);
});

test('sessions are validated with a sentence a person can act on', () => {
  assert.equal(validateSessions(twoSessions).ok, true);
  assert.match(validateSessions([]).error, /at least one session/);
  assert.match(validateSessions([{ start: '09:00', end: '09:10' }]).error, /at least 15 minutes/);
  assert.match(validateSessions([{ start: '13:00', end: '09:00' }]).error, /ends before it starts/);
  assert.match(validateSessions([...twoSessions, { start: '23:00', end: '23:45' }]).error, /at most 2 sessions/);
  assert.match(validateSessions([{ start: '09:00', end: '14:00' }, { start: '13:00', end: '18:00' }]).error, /overlaps/);
});

test('a doctor may sit one of the clinic sessions, never across the break', () => {
  assert.equal(withinClinicSessions([{ start: '09:00', end: '11:00' }], twoSessions), true);
  assert.equal(withinClinicSessions([{ start: '18:00', end: '22:00' }], twoSessions), true);
  // The break is 13:00–18:00.
  assert.equal(withinClinicSessions([{ start: '14:00', end: '16:00' }], twoSessions), false);
  // One window spanning both sessions is two sessions in the product's eyes.
  assert.equal(withinClinicSessions([{ start: '09:00', end: '22:00' }], twoSessions), false);

  const bad = validateDoctorSessions([{ start: '14:00', end: '16:00' }], twoSessions, { label: 'Dr Rao’s hours' });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Dr Rao’s hours/);
  assert.match(bad.error, /outside the clinic's hours/);

  assert.equal(validateDoctorSessions([{ start: '18:00', end: '21:00' }], twoSessions).ok, true);
});

test('a doctor with no clinic hours set is not blocked by a rule it cannot see', () => {
  assert.equal(validateDoctorSessions([{ start: '14:00', end: '16:00' }], []).ok, true);
});

test('the session summary is what the screen prints', () => {
  assert.equal(sessionsSummary(twoSessions), '9:00 AM – 1:00 PM · 6:00 PM – 10:00 PM');
  assert.equal(sessionsSummary([{ start: '09:00', end: '13:00' }]), '9:00 AM – 1:00 PM');
  assert.equal(sessionsSummary([]), '');
  assert.equal(totalOpenMinutes(twoSessions), 480);
});

test('weekdays are 0–6 with Sunday first, computed without a timezone shift', () => {
  assert.deepEqual(WEEKDAYS.map((d) => d.short), ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  assert.equal(weekdayIndex('2026-11-01'), 0);   // a Sunday
  assert.equal(weekdayIndex('2026-11-02'), 1);
  assert.equal(weekdayIndex('2026-11-07'), 6);
  assert.equal(weekdayIndex('nope'), null);
  // Malformed and out-of-range numbers are dropped, and duplicates collapse.
  assert.deepEqual(normaliseWeekdays([6, 1, 1, 9, -1, '2']), [1, 2, 6]);
});

test('a closed day is a weekday or a dated holiday, and says which', () => {
  const clinic = { closed_weekdays: [0], closed_dates: ['2026-11-14'] };
  assert.deepEqual(closure('2026-11-01', clinic), { closed: true, reason: 'Closed on Sundays' });
  assert.deepEqual(closure('2026-11-14', clinic), { closed: true, reason: 'Holiday' });
  assert.equal(closure('2026-11-02', clinic).closed, false);
  assert.equal(clinicClosed('2026-11-02', clinic).closed, false);
  assert.equal(clinicClosed('2026-11-01', clinic).closed, true);
});

test('a doctor\'s own leave closes only their own book', () => {
  const clinic = { closed_weekdays: [0] };
  const doctor = { full_name: 'Dr Rao', closed_weekdays: [1], closed_dates: ['2026-11-10'] };
  assert.equal(doctorClosed('2026-11-02', doctor, clinic).closed, true);
  assert.match(doctorClosed('2026-11-02', doctor, clinic).reason, /Dr Rao is off on Mondays/);
  // The clinic being shut beats the doctor's own note.
  assert.equal(doctorClosed('2026-11-01', doctor, clinic).reason, 'Closed on Sundays');
  assert.equal(doctorClosed('2026-11-10', doctor, clinic).reason, 'Dr Rao is on leave');
  assert.equal(doctorClosed('2026-11-04', doctor, clinic).closed, false);
});

test('follow-up validity is 3 to 45 days, in both directions', () => {
  assert.equal(FOLLOW_UP_MIN_DAYS, 3);
  assert.equal(FOLLOW_UP_MAX_DAYS, 45);
  assert.deepEqual(clampFollowUpDays(0), { days: 3, clamped: true });
  assert.deepEqual(clampFollowUpDays(180), { days: 45, clamped: true });
  assert.deepEqual(clampFollowUpDays(15), { days: 15, clamped: false });
  assert.deepEqual(clampFollowUpDays('abc'), { days: 15, clamped: true });

  assert.equal(validateFollowUpDays(15), '');
  assert.equal(validateFollowUpDays(3), '');
  assert.equal(validateFollowUpDays(45), '');
  assert.match(validateFollowUpDays(2), /between 3 and 45/);
  assert.match(validateFollowUpDays(46), /between 3 and 45/);
  assert.match(validateFollowUpDays(7.5), /whole number/);
  assert.match(validateFollowUpDays(''), /how many days/);
});

test('a follow-up visit is priced only inside the window', () => {
  assert.equal(followUpStillValid('2026-11-01', '2026-11-16', 15), true);
  assert.equal(followUpStillValid('2026-11-01', '2026-11-16', 14), false);
  assert.equal(followUpStillValid('2026-11-01', '2026-10-31', 15), false);
  // A clinic still on a 180-day value is clamped, not trusted.
  assert.equal(followUpStillValid('2026-11-01', '2026-12-20', 180), false);
});

/* ------------------------------------------------------------------ slots */

const doctor = { id: 'd1', full_name: 'Dr Two Sessions', slot_minutes: 30, sessions: twoSessions };
const iso = '2026-11-04';       // a Wednesday, open in these fixtures

test('slots come from both sessions and never from the break', () => {
  const slots = availableSlots({ doctor, iso });
  const times = slots.map((s) => s.time);
  assert.deepEqual(times, ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30',
    '18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00', '21:30']);
  assert.ok(!times.includes('13:00'));
  assert.ok(!times.includes('17:30'));
  assert.equal(slots.closed, false);
});

test('a 30-minute visit that straddles the break is not offered', () => {
  // 12:45 + 30 would end at 13:15; only whole sessions may be used.
  const slots = availableSlots({ doctor, iso, duration: 45 });
  assert.ok(slots.every((s) => s.end <= 13 * 60 || s.start >= 18 * 60));
});

test('a closed day yields no slots and says why', () => {
  const clinic = { sessions: twoSessions, closed_weekdays: [3] };   // Wednesday
  const closed = availableSlots({ doctor, iso, clinic });
  assert.equal(closed.length, 0);
  assert.equal(closed.closed, true);
  assert.match(closed.reason, /Wednesdays/);

  const open = availableSlots({ doctor, iso: '2026-11-05', clinic });
  assert.equal(open.closed, false);
  assert.ok(open.length > 0);
});

test('a doctor\'s own day off closes their column only', () => {
  const onLeave = { ...doctor, closed_weekdays: [3] };
  const own = availableSlots({ doctor: onLeave, iso, clinic: { sessions: twoSessions } });
  assert.equal(own.length, 0);
  assert.match(own.reason, /Dr Two Sessions is off on Wednesdays/);

  const colleague = { ...doctor, id: 'd2', full_name: 'Dr Available' };
  const theirs = availableSlots({ doctor: colleague, iso, clinic: { sessions: twoSessions } });
  assert.ok(theirs.length > 0);
});

test('a booked slot is blocked inside its own session', () => {
  const appointments = [{ id: 'a1', doctor_id: 'd1', scheduled_on: iso, scheduled_at: '09:30', duration_minutes: 30, status: 'booked' }];
  const slots = availableSlots({ doctor, iso, appointments });
  const nine30 = slots.find((s) => s.time === '09:30');
  assert.equal(nine30.free, false);
  assert.ok(nine30.blockedBy);
  // The same clock time in the evening is untouched.
  assert.equal(slots.find((s) => s.time === '19:30').free, true);
});

test('slot groups are named by the sessions, not a fixed three-part day', () => {
  const slots = availableSlots({ doctor, iso });
  const groups = groupSlots(slots, { sessions: twoSessions });
  assert.deepEqual(groups.map((g) => g.label), ['9:00 AM – 1:00 PM', '6:00 PM – 10:00 PM']);
  assert.deepEqual(groups.map((g) => g.slots.length), [8, 8]);
  // Without sessions the old morning/afternoon/evening split still works.
  assert.deepEqual(groupSlots(slots).map((g) => g.id), ['morning', 'afternoon', 'evening']);
});

test('a legacy doctor still books on the single pair', () => {
  const legacy = { id: 'd2', day_start: '09:00', day_end: '13:00', slot_minutes: 15 };
  const slots = availableSlots({ doctor: legacy, iso });
  assert.equal(slots.length, 16);
  assert.equal(slots[0].time, '09:00');
  assert.equal(slots.at(-1).time, '12:45');
});

test('"next free" skips a doctor who is off that day', () => {
  const off = { ...doctor, closed_weekdays: [3] };
  const on = { ...doctor, id: 'd9', full_name: 'Dr On', closed_weekdays: [0] };
  const next = suggestNext({ doctors: [off, on], iso, clinic: { sessions: twoSessions } });
  assert.equal(next?.doctor_id, 'd9');
  assert.equal(suggestNext({ doctors: [off], iso, clinic: { sessions: twoSessions } }), null);
});
