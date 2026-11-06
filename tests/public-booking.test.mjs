import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOOKING_ERRORS, BOOKING_HORIZON_DAYS, availabilityByDay, bookingApi, bookingDays, bookingErrorMessage, bookingUrl,
  cleanRef, dayLabel, firstOpenDay, groupedSlots, isBookingRef, leadSourceMix, makeBookingRef,
  manageUrl, normalizePhone, slotLabel, slotsForDay, validateBooking,
} from '../src/lib/public-booking.mjs';

/**
 * The public booking page is the only surface a stranger touches, so these tests
 * pin the three things a bug there would cost a clinic: which minutes are offered,
 * what a booking accepts, and who is allowed to see a booking back.
 */

const ISO = '2026-11-04';
/** 10:00 on the pinned day, so "is this slot in the past" is deterministic. */
const NOW = new Date(`${ISO}T10:00:00`);

const DOCTOR = {
  id: 'doc-a', full_name: 'Dr. Anita Rao', specialty: 'General Medicine',
  day_start: '09:00', day_end: '12:00', slot_minutes: 30,
  fee_paise: 60000, color: '#0f766e',
};

/* ------------------------------------------------------------------- days */

test('bookingDays opens exactly the clinic horizon, starting today', () => {
  const days = bookingDays({ from: ISO, count: 14 });
  assert.equal(days.length, 14);
  assert.equal(days[0].iso, '2026-11-04');
  assert.equal(days[0].isToday, true);
  assert.equal(days[1].isTomorrow, true);
  assert.equal(days[13].iso, '2026-11-17');
  assert.equal(days[0].weekday, 'Wed');
});

test('bookingDays cannot be talked into opening a year of the diary', () => {
  assert.equal(bookingDays({ from: ISO, count: 999 }).length, 60);
  assert.equal(bookingDays({ from: ISO, count: 0 }).length, BOOKING_HORIZON_DAYS);
  assert.equal(bookingDays({ from: ISO, count: 'nonsense' }).length, BOOKING_HORIZON_DAYS);
});

test('bookingDays crosses a month without losing a day', () => {
  const days = bookingDays({ from: '2026-11-28', count: 5 });
  assert.deepEqual(days.map((d) => d.iso), [
    '2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02',
  ]);
});

/* ------------------------------------------------------------------ slots */

test('slotsForDay offers the doctor’s grid and marks what is already booked', () => {
  const busy = [{ iso: ISO, at: '11:00', minutes: 30 }];
  const slots = slotsForDay({ doctor: DOCTOR, iso: ISO, busy, now: NOW });
  assert.deepEqual(slots.map((s) => s.time), ['10:30', '11:00', '11:30']);
  assert.deepEqual(slots.filter((s) => s.free).map((s) => s.time), ['10:30', '11:30']);
  assert.equal(slots.find((s) => s.time === '11:00').free, false);
});

test('slotsForDay never offers a slot that starts in the next half hour', () => {
  // 10:00 now -> 09:00, 09:30 and 10:00 are gone; 10:30 is the first bookable one.
  const slots = slotsForDay({ doctor: DOCTOR, iso: ISO, now: NOW });
  assert.deepEqual(slots.map((s) => s.time), ['10:30', '11:00', '11:30']);
});

test('slotsForDay leaves a future day alone', () => {
  const slots = slotsForDay({ doctor: DOCTOR, iso: '2026-11-05', now: NOW });
  assert.equal(slots.length, 6);
  assert.ok(slots.every((s) => s.free));
});

test('a booking made earlier today still blocks its own slot', () => {
  const busy = [{ iso: ISO, at: '09:30', minutes: 30 }];
  const slots = slotsForDay({ doctor: DOCTOR, iso: ISO, busy, now: NOW });
  // 09:30 is outside the lead window, so it is not offered at all — either way the
  // patient cannot book it.
  assert.equal(slots.some((s) => s.time === '09:30' && s.free), false);
});

test('slotsForDay understands both the database shape and a raw appointment', () => {
  const fromDb = slotsForDay({ doctor: DOCTOR, iso: ISO, busy: [{ iso: ISO, at: '11:00', minutes: 30 }], now: NOW });
  const fromAppt = slotsForDay({
    doctor: DOCTOR, iso: ISO, now: NOW,
    busy: [{ scheduled_on: ISO, scheduled_at: '11:00:00', duration_minutes: 30 }],
  });
  assert.deepEqual(fromDb.map((s) => s.time), fromAppt.map((s) => s.time));
  assert.deepEqual(fromDb.filter((s) => s.free).map((s) => s.time), ['10:30', '11:30']);
});

test('a 15-minute booking blocks only its own quarter hour', () => {
  const slots = slotsForDay({
    doctor: { ...DOCTOR, slot_minutes: 15 },
    iso: '2026-11-05',
    busy: [{ iso: '2026-11-05', at: '09:00', minutes: 15 }],
    now: NOW,
  });
  const free = slots.filter((s) => s.free).map((s) => s.time);
  assert.equal(free.includes('09:00'), false);
  assert.equal(free.includes('09:15'), true);
});

test('groupedSlots keeps only free slots, split into the day parts that exist', () => {
  const slots = slotsForDay({
    doctor: { ...DOCTOR, day_start: '09:00', day_end: '19:00', slot_minutes: 60 },
    iso: '2026-11-05',
    busy: [],
    now: NOW,
  });
  const groups = groupedSlots(slots);
  assert.deepEqual(groups.map((g) => g.id), ['morning', 'afternoon', 'evening']);
  assert.ok(groups.every((g) => g.slots.length > 0 && g.slots.every((s) => s.free)));
});

test('groupedSlots returns an empty list when nothing is free', () => {
  const slots = slotsForDay({
    doctor: { ...DOCTOR, day_start: '09:00', day_end: '10:00', slot_minutes: 15 },
    iso: '2026-11-05',
    busy: [{ iso: '2026-11-05', at: '09:00', minutes: 60 }],
    now: NOW,
  });
  assert.deepEqual(groupedSlots(slots), []);
});

test('availabilityByDay counts free slots per date', () => {
  const days = bookingDays({ from: ISO, count: 3 });
  const map = availabilityByDay({ doctor: DOCTOR, days, busy: [{ iso: '2026-11-05', at: '09:00', minutes: 30 }], now: NOW });
  assert.equal(map.get('2026-11-04'), 3);
  assert.equal(map.get('2026-11-05'), 5);
  assert.equal(map.get('2026-11-06'), 6);
});

test('firstOpenDay skips a fully booked day', () => {
  const days = bookingDays({ from: ISO, count: 3 });
  const busy = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30']
    .map((at) => ({ iso: '2026-11-05', at, minutes: 30 }));
  assert.equal(firstOpenDay({ doctor: DOCTOR, days, busy, now: NOW }), '2026-11-04');
});

test('firstOpenDay returns null when the horizon is full', () => {
  const days = bookingDays({ from: '2026-11-05', count: 1 });
  const busy = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30']
    .map((at) => ({ iso: '2026-11-05', at, minutes: 30 }));
  assert.equal(firstOpenDay({ doctor: DOCTOR, days, busy, now: NOW }), null);
});

/* ------------------------------------------------------------- validation */

test('a complete booking validates', () => {
  assert.deepEqual(validateBooking({ name: 'Meera Iyer', phone: '98200 11223', reason: 'Fever' }), {});
});

test('the patient form accepts the three ways Indians write a mobile number', () => {
  for (const phone of ['9820011223', '+91 98200 11223', '098200 11223']) {
    assert.deepEqual(validateBooking({ name: 'Meera Iyer', phone }), {}, phone);
  }
});

test('the patient form rejects what a desk cannot call back', () => {
  assert.ok(validateBooking({ name: 'M', phone: '9820011223' }).name);
  assert.ok(validateBooking({ name: 'Meera', phone: '' }).phone);
  assert.ok(validateBooking({ name: 'Meera', phone: '12345' }).phone);
  assert.ok(validateBooking({ name: 'Meera', phone: '9820011223999' }).phone);
  assert.ok(validateBooking({ name: 'Meera', phone: '9820011223', reason: 'x'.repeat(121) }).reason);
});

test('a name is tidied but never invented', () => {
  assert.deepEqual(validateBooking({ name: '  Meera   Iyer  ', phone: '9820011223' }), {});
});

test('normalizePhone compares digits, so the same patient matches itself', () => {
  assert.equal(normalizePhone('+91 98200 11223'), '919820011223');
  assert.equal(normalizePhone('98200-11223'), '9820011223');
  assert.equal(normalizePhone(''), '');
});

/* ------------------------------------------------------------ references */

test('a booking reference is readable out loud and unambiguous', () => {
  const ref = makeBookingRef();
  assert.match(ref, /^BK-[ACDEFGHJKLMNPQRTUVWXY2346789]{6}$/);
  // no 0/O/1/I/B/S/5: the characters people mis-hear on a phone call
  assert.equal(/[01OIB S5]/.test(ref.slice(3)), false);
});

test('references never collide across a thousand draws', () => {
  const seen = new Set();
  for (let i = 0; i < 1000; i += 1) seen.add(makeBookingRef());
  assert.ok(seen.size > 995, `expected near-unique refs, got ${seen.size}`);
});

test('isBookingRef accepts what a patient pastes and refuses the rest', () => {
  assert.equal(isBookingRef('BK-4K7P2Q'), true);
  assert.equal(isBookingRef(' bk-4k7p2q '), true);
  assert.equal(isBookingRef('BK-4K7P2'), false);
  assert.equal(isBookingRef('BK-4K7P2QQ'), false);
  assert.equal(isBookingRef('4K7P2Q'), false);
  assert.equal(isBookingRef(''), false);
});

test('cleanRef upper-cases and strips spaces from a pasted reference', () => {
  assert.equal(cleanRef(' bk-4k7p 2q '), 'BK-4K7P2Q');
});

/* ----------------------------------------------------------- lead sources */

test('leadSourceMix counts the month and falls back to walk-in', () => {
  const mix = leadSourceMix({
    month: '2026-11',
    appointments: [
      { scheduled_on: '2026-11-04', source: 'online' },
      { scheduled_on: '2026-11-04', source: 'online' },
      { scheduled_on: '2026-11-05', source: 'phone' },
      { scheduled_on: '2026-11-06' },
      { scheduled_on: '2026-11-07', source: 'walk-in' },
      { scheduled_on: '2026-12-01', source: 'online' },
    ],
  });
  const byId = Object.fromEntries(mix.map((m) => [m.id, m.count]));
  assert.equal(byId.online, 2);
  assert.equal(byId.phone, 1);
  assert.equal(byId['walk-in'], 2);
  assert.equal(mix.reduce((n, m) => n + m.count, 0), 5);
  const online = mix.find((m) => m.id === 'online');
  assert.equal(Math.round(online.share * 100), 40);
  // busiest first, and the December booking is not in November's mix
  assert.ok(mix[0].count >= mix[1].count);
  assert.equal(mix.at(-1).id, 'referral');
  assert.equal(mix.find((m) => m.id === 'online').label, 'Booked online');
});

test('leadSourceMix survives a month with nothing in it', () => {
  const mix = leadSourceMix({ month: '2026-11', appointments: [] });
  assert.equal(mix.length, 4);
  assert.ok(mix.every((m) => m.count === 0 && m.share === 0));
});

/* ------------------------------------------------------------- formatting */

test('slotLabel reads a 12-hour clock without a leading zero', () => {
  assert.equal(slotLabel('09:00'), '9:00 am');
  assert.equal(slotLabel('12:00'), '12:00 pm');
  assert.equal(slotLabel('13:30'), '1:30 pm');
  assert.equal(slotLabel('00:15'), '12:15 am');
});

test('dayLabel is the long form a patient expects', () => {
  assert.equal(dayLabel('2026-11-04'), 'Wednesday, 4 November');
  assert.equal(dayLabel(''), '—');
  assert.equal(dayLabel(null), '—');
});

/* ------------------------------------------------------------------- urls */

test('the public links point at the hash router, not the app shell', () => {
  assert.match(bookingUrl('sunrise-opd'), /#\/book\/sunrise-opd$/);
  assert.match(manageUrl('BK-4K7P2Q'), /#\/booking\/BK-4K7P2Q$/);
});

/* ------------------------------------------------------------------ errors */

test('the database’s refusal tokens become sentences a patient can act on', () => {
  assert.equal(bookingErrorMessage('booking:slot_taken'), 'That slot was taken a moment ago.');
  // Schema 17 answers `booking:already` with no time. An older database still
  // sends `booking:already:16:30`, and that time is somebody else's appointment —
  // so the sentence is the same either way and the detail is dropped.
  assert.equal(bookingErrorMessage('booking:already'), BOOKING_ERRORS.already);
  assert.equal(bookingErrorMessage('booking:already:16:30'), BOOKING_ERRORS.already);
  assert.doesNotMatch(bookingErrorMessage('booking:already:16:30'), /16:30/);
  assert.match(bookingErrorMessage('booking:toomany'), /Three online bookings/);
  assert.match(bookingErrorMessage('booking:phone'), /10-digit/);
  // schema 12 emits these two when the clinic or the doctor is closed that day;
  // before this they fell through to "Could not book that slot."
  assert.match(bookingErrorMessage('booking:dayoff'), /clinic is closed that day/);
  assert.match(bookingErrorMessage('booking:leave'), /doctor is away that day/);
  // anything unrecognised is passed through rather than swallowed
  assert.equal(bookingErrorMessage('network down'), 'network down');
  assert.equal(bookingErrorMessage(undefined), 'Could not book that slot.');
});

/* ----------------------------------------------------------------- demo flow */

/**
 * The demo workspace is the path a reviewer actually walks: no backend, one
 * clinic, a booking appended to localStorage. These tests give the module a
 * localStorage of its own so the same code that runs in the browser runs here.
 */
function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => map.clear(),
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
  };
}

async function demoClinic() {
  globalThis.localStorage = memoryStorage();
  globalThis.window = { dispatchEvent: () => true };
  const profile = await bookingApi.profile('sunrise-opd');
  return profile;
}

test('the demo clinic is published at its slug and nowhere else', async () => {
  const profile = await demoClinic();
  assert.equal(profile.enabled, true);
  assert.equal(profile.clinic.slug, 'sunrise-opd');
  assert.equal(profile.clinic.booking_horizon_days, 14);
  assert.ok(profile.doctors.length >= 1);
  // the front desk is not bookable, and no phone/email of patients leaks
  assert.ok(profile.doctors.every((d) => d.id && d.full_name));
  assert.equal(await bookingApi.profile('no-such-clinic'), null);
});

test('a demo booking becomes a real appointment the diary can see', async () => {
  const profile = await demoClinic();
  const doctor = profile.doctors[0];
  const busy = await bookingApi.busy(profile.clinic.slug, doctor.id);
  const days = bookingDays({ count: 3 });
  const free = days
    .flatMap((d) => slotsForDay({ doctor, iso: d.iso, busy }).map((s) => ({ iso: d.iso, ...s })))
    .find((s) => s.free);
  assert.ok(free, 'expected a free slot in the demo diary');

  const result = await bookingApi.book({
    slug: profile.clinic.slug, doctorId: doctor.id, iso: free.iso, time: free.time,
    name: 'Kavya Menon', phone: '98200 11999', reason: 'Fever',
  });
  assert.match(result.ref, /^BK-/);
  assert.equal(result.iso, free.iso);
  assert.equal(result.doctor, doctor.full_name);

  // the slot is gone from the public grid, and the reference opens the booking
  const after = await bookingApi.busy(profile.clinic.slug, doctor.id);
  const again = slotsForDay({ doctor, iso: free.iso, busy: after }).find((s) => s.time === free.time);
  assert.equal(again.free, false);

  const looked = await bookingApi.lookup(result.ref);
  assert.equal(looked.patient_first, 'Kavya');
  assert.equal(looked.status, 'booked');
  assert.equal(looked.at, free.time);
});

test('a second tap on the same slot returns the reference already issued', async () => {
  const profile = await demoClinic();
  const doctor = profile.doctors[0];
  const busy = await bookingApi.busy(profile.clinic.slug, doctor.id);
  const free = bookingDays({ count: 3 })
    .flatMap((d) => slotsForDay({ doctor, iso: d.iso, busy }).map((s) => ({ iso: d.iso, ...s })))
    .find((s) => s.free);
  const device = 'cccccccc-5555-4555-8555-000000000003';
  const payload = {
    slug: profile.clinic.slug, doctorId: doctor.id, iso: free.iso, time: free.time,
    name: 'Meera Iyer', phone: '9820011233', clientId: device,
  };
  const first = await bookingApi.book(payload);
  const second = await bookingApi.book(payload);
  assert.equal(second.ref, first.ref);
  assert.equal(second.duplicate, true);

  // A second tap from a device that is not the one that booked is refused — the
  // phone number alone no longer opens the reference (schema 17).
  await assert.rejects(
    () => bookingApi.book({ ...payload, clientId: 'dddddddd-6666-4666-8666-000000000004' }),
    /already an appointment/,
  );
});

test('the same patient cannot book two times with one doctor on one day', async () => {
  const profile = await demoClinic();
  const doctor = profile.doctors[0];
  const busy = await bookingApi.busy(profile.clinic.slug, doctor.id);
  const free = bookingDays({ count: 3 })
    .flatMap((d) => slotsForDay({ doctor, iso: d.iso, busy }).map((s) => ({ iso: d.iso, ...s })))
    .filter((s) => s.free)
    .slice(0, 2);
  assert.equal(free.length, 2, 'need two free slots to prove the rule');
  const base = { slug: profile.clinic.slug, doctorId: doctor.id, name: 'Meera Iyer', phone: '9820011233' };
  await bookingApi.book({ ...base, iso: free[0].iso, time: free[0].time });
  if (free[0].iso === free[1].iso) {
    await assert.rejects(
      () => bookingApi.book({ ...base, iso: free[1].iso, time: free[1].time }),
      /already an appointment for this number/,
    );
  }
});

test('cancelling releases the slot and keeps the record', async () => {
  const profile = await demoClinic();
  const doctor = profile.doctors[0];
  const busy = await bookingApi.busy(profile.clinic.slug, doctor.id);
  const free = bookingDays({ count: 3 })
    .flatMap((d) => slotsForDay({ doctor, iso: d.iso, busy }).map((s) => ({ iso: d.iso, ...s })))
    .find((s) => s.free);
  const booked = await bookingApi.book({
    slug: profile.clinic.slug, doctorId: doctor.id, iso: free.iso, time: free.time,
    name: 'Rohit Sharma', phone: '9820044556',
  });

  const result = await bookingApi.cancel(booked.ref);
  assert.deepEqual(result, { cancelled: true, status: 'cancelled' });

  const after = await bookingApi.lookup(booked.ref);
  assert.equal(after.status, 'cancelled');
  assert.equal(typeof after.patient_first, 'string');

  // the slot is bookable again — the record stayed, the time did not
  const busyAfter = await bookingApi.busy(profile.clinic.slug, doctor.id);
  const reopened = slotsForDay({ doctor, iso: free.iso, busy: busyAfter }).find((s) => s.time === free.time);
  assert.equal(reopened.free, true);

  // cancelling twice is not an error, it just does nothing
  assert.deepEqual(await bookingApi.cancel(booked.ref), { cancelled: false, status: 'cancelled' });
});

test('an unknown reference opens nothing', async () => {
  await demoClinic();
  assert.equal(await bookingApi.lookup('BK-ZZZZZZ'), null);
  assert.deepEqual(await bookingApi.cancel('BK-ZZZZZZ'), { cancelled: false, status: 'missing' });
});

test('a clinic that has closed online booking answers with its phone number only', async () => {
  globalThis.localStorage = memoryStorage();
  globalThis.window = { dispatchEvent: () => true };
  const { makeDemoWorkspace } = await import('../src/lib/demo-data.js');
  const workspace = makeDemoWorkspace();
  workspace.clinic = { ...workspace.clinic, booking_enabled: false };
  globalThis.localStorage.setItem('myclinic.demo.v1', JSON.stringify(workspace));

  const profile = await bookingApi.profile(workspace.clinic.slug);
  assert.equal(profile.enabled, false);
  assert.deepEqual(profile.doctors, []);
  assert.ok(profile.clinic.phone);
  assert.equal(profile.clinic.booking_note, undefined);
});

/* ------------------------------------------- schema 17: the reference is not a phone */

test('a phone number is not a credential: the "already booked" refusal names no time and no reference', () => {
  // The database used to answer `booking:already:16:30` — the victim's slot — and
  // hand the booking reference to whoever supplied the phone and the time.
  const neutral = bookingErrorMessage('booking:already');
  assert.match(neutral, /already an appointment for this number/i);
  assert.doesNotMatch(neutral, /\d{1,2}:\d{2}/, 'no appointment time in the refusal');

  // An older database still sends the time. It must not reach the screen either.
  const legacy = bookingErrorMessage('booking:already:16:30');
  assert.equal(legacy, neutral);
  assert.doesNotMatch(legacy, /\d{1,2}:\d{2}/);
});

test('the device that booked can collect its reference again; another device learns nothing', async () => {
  const profile = await demoClinic();
  const doctor = profile.doctors[0];
  const busy = await bookingApi.busy(profile.clinic.slug, doctor.id);
  const free = bookingDays({ count: 3 })
    .flatMap((d) => slotsForDay({ doctor, iso: d.iso, busy }).map((s) => ({ iso: d.iso, ...s })))
    .find((s) => s.free);
  assert.ok(free, 'expected a free slot in the demo diary');

  const payload = {
    slug: profile.clinic.slug, doctorId: doctor.id, iso: free.iso, time: free.time,
    name: 'Anita Rao', phone: '98333 22110', reason: 'Cough',
  };
  const mine = 'aaaaaaaa-3333-4333-8333-000000000001';
  const first = await bookingApi.book({ ...payload, clientId: mine });
  assert.match(first.ref, /^BK-/);

  // the same device retries (a double tap, or a flaky connection) — same reference
  const retry = await bookingApi.book({ ...payload, clientId: mine });
  assert.equal(retry.ref, first.ref);
  assert.equal(retry.duplicate, true);

  // a different device with the same phone number and the same slot gets nothing
  await assert.rejects(
    () => bookingApi.book({ ...payload, clientId: 'bbbbbbbb-4444-4444-8444-000000000002' }),
    (error) => {
      assert.equal(error.code, 'already-booked');
      assert.doesNotMatch(error.message, /16:30|BK-/);
      return true;
    },
  );
});
