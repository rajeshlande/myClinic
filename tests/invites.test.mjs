import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INVITE_DAYS, SEAT_COLOURS, daysLeft, inviteDefaults, inviteEmailError, inviteLink,
  inviteState, inviteSummary, nameFromEmail, normalizeEmail, pendingInvites, pickSeatColour,
  readInviteToken,
} from '../src/lib/invites.mjs';

/**
 * Invitations are the one place where an owner hands out access, so the rules are
 * pinned here: who the seat is called before they tell us, what a doctor's seat
 * must inherit to be bookable, and when an offer lapses.
 */

const NOW = new Date('2026-11-04T10:00:00');
const inDays = (n) => new Date(NOW.getTime() + n * 86400000).toISOString();

const CLINIC = {
  open_time: '09:30', close_time: '19:00', slot_minutes: 20,
  consultation_fee_paise: 70000, follow_up_fee_paise: 40000,
};

/* -------------------------------------------------------------------- email */

test('an email is trimmed and lower-cased before it is stored', () => {
  assert.equal(normalizeEmail('  Priya@Clinic.IN '), 'priya@clinic.in');
});

test('the invite form refuses addresses it cannot send to', () => {
  assert.match(inviteEmailError(''), /work email/);
  assert.match(inviteEmailError('priya'), /look like an email/);
  assert.match(inviteEmailError('priya@clinic'), /look like an email/);
  assert.match(inviteEmailError('priya @clinic.in'), /look like an email/);
  assert.equal(inviteEmailError('priya@clinic.in'), '');
  assert.equal(inviteEmailError(' dr.new@clinic.co.in '), '');
  assert.match(inviteEmailError(`${'a'.repeat(118)}@x.in`), /too long/);
});

/* --------------------------------------------------------------------- name */

test('a name is derived from the email only when nobody typed one', () => {
  assert.equal(nameFromEmail('priya@clinic.in'), 'Priya');
  assert.equal(nameFromEmail('priya.kamble@clinic.in'), 'Priya Kamble');
  assert.equal(nameFromEmail('dr.new@clinic.in'), 'Dr. New');
  assert.equal(nameFromEmail('dr_priya@clinic.in'), 'Dr. Priya');
  assert.equal(nameFromEmail('frontdesk+night@clinic.in'), 'Frontdesk Night');
  assert.equal(nameFromEmail(''), 'Team member');
});

/* ----------------------------------------------------------------- defaults */

test('a front-desk seat needs nothing but a name and an address', () => {
  const seat = inviteDefaults({ role: 'frontdesk', email: 'priya@clinic.in', clinic: CLINIC });
  assert.equal(seat.full_name, 'Priya');
  assert.equal(seat.role, 'frontdesk');
  assert.equal(seat.email, 'priya@clinic.in');
  assert.equal(seat.fee_paise, 0);
  assert.equal(seat.active, true);
});

test('a doctor invited from the app is bookable the moment they appear', () => {
  const seat = inviteDefaults({ role: 'doctor', email: 'dr.new@clinic.in', clinic: CLINIC });
  assert.equal(seat.full_name, 'Dr. New');
  // hours, slot length and fees come from the clinic until the owner sets their own
  assert.equal(seat.day_start, '09:30');
  assert.equal(seat.day_end, '19:00');
  assert.equal(seat.slot_minutes, 20);
  assert.equal(seat.fee_paise, 70000);
  assert.equal(seat.follow_up_fee_paise, 40000);
  assert.ok(SEAT_COLOURS.includes(seat.color));
});

test('a typed name wins over the email', () => {
  const seat = inviteDefaults({ role: 'doctor', email: 'pk@clinic.in', name: '  Dr. Priya Kamble ', clinic: CLINIC });
  assert.equal(seat.full_name, 'Dr. Priya Kamble');
});

test('the new seat avoids a calendar colour the team already uses', () => {
  assert.equal(pickSeatColour([]), SEAT_COLOURS[0]);
  assert.equal(pickSeatColour([{ color: SEAT_COLOURS[0] }]), SEAT_COLOURS[1]);
  const all = SEAT_COLOURS.map((color) => ({ color }));
  assert.equal(pickSeatColour(all), SEAT_COLOURS[0]);   // palette exhausted, start over
  assert.equal(pickSeatColour([{ color: SEAT_COLOURS[0].toUpperCase() }]), SEAT_COLOURS[1]);
});

test('a clinic with no hours still yields a usable doctor', () => {
  const seat = inviteDefaults({ role: 'doctor', email: 'x@y.in' });
  assert.equal(seat.day_start, '09:00');
  assert.equal(seat.day_end, '20:00');
  assert.equal(seat.slot_minutes, 15);
  assert.equal(seat.fee_paise, 50000);
});

/* ------------------------------------------------------------------- state */

test('an invitation is pending until it is claimed or runs out', () => {
  assert.equal(inviteState({ expires_at: inDays(5) }, NOW), 'pending');
  assert.equal(inviteState({ expires_at: inDays(5), accepted_at: inDays(1) }, NOW), 'accepted');
  assert.equal(inviteState({ expires_at: inDays(-1) }, NOW), 'expired');
  assert.equal(inviteState({ expires_at: inDays(0) }, NOW), 'expired');   // expires exactly now
  assert.equal(inviteState(null, NOW), 'missing');
});

test('daysLeft counts whole days and never goes negative', () => {
  assert.equal(daysLeft({ expires_at: inDays(14) }, NOW), 14);
  assert.equal(daysLeft({ expires_at: inDays(1) }, NOW), 1);
  assert.equal(daysLeft({ expires_at: inDays(-3) }, NOW), 0);
  assert.equal(daysLeft({}, NOW), INVITE_DAYS);
});

test('the pending list drops claimed and lapsed offers, newest first', () => {
  const list = [
    { id: 'a', email: 'old@clinic.in', created_at: inDays(-3), expires_at: inDays(5) },
    { id: 'b', email: 'new@clinic.in', created_at: inDays(-1), expires_at: inDays(9) },
    { id: 'c', email: 'gone@clinic.in', created_at: inDays(-2), expires_at: inDays(-1) },
    { id: 'd', email: 'taken@clinic.in', created_at: inDays(-2), expires_at: inDays(4), accepted_at: inDays(-1) },
  ];
  assert.deepEqual(pendingInvites(list, NOW).map((i) => i.id), ['b', 'a']);
  assert.deepEqual(pendingInvites([], NOW), []);
});

/* -------------------------------------------------------------------- link */

test('the invitation link carries its token and nothing else', () => {
  const link = inviteLink('6f0d3a1e-1111-2222-3333-444455556666', { origin: 'https://clinic.example', pathname: '/' });
  assert.equal(link, 'https://clinic.example/#/signup?invite=6f0d3a1e-1111-2222-3333-444455556666');
  // a link without a token still works as a plain signup page
  assert.equal(inviteLink('', { origin: 'https://clinic.example', pathname: '/app/' }), 'https://clinic.example/app/#/signup');
});

test('the token is read back out of whatever the router left in the URL', () => {
  const token = '6f0d3a1e-1111-2222-3333-444455556666';
  assert.equal(readInviteToken(`#/signup?invite=${token}`), token);
  assert.equal(readInviteToken(`#/signup?token=${token}`), token);
  assert.equal(readInviteToken(`?invite=${token}`), token);
  assert.equal(readInviteToken(`#/signup?clinic=sunrise&invite=${token}&role=doctor`), token);
  assert.equal(readInviteToken('#/signup'), '');
  assert.equal(readInviteToken(''), '');
  assert.equal(readInviteToken(undefined), '');
});

test('inviteSummary reads as a line in a list', () => {
  assert.equal(inviteSummary({ role: 'doctor', full_name: 'Dr. Priya Kamble' }), 'Doctor · Dr. Priya Kamble');
  assert.equal(inviteSummary({ role: 'frontdesk', email: 'priya@clinic.in' }), 'Front desk · priya@clinic.in');
  assert.equal(inviteSummary({}), 'Front desk · someone');
});
