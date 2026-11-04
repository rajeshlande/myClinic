/**
 * Staff invitations — the parts that can be reasoned about without a database.
 *
 * Two people share this file:
 *   the owner   writes an email, a role and (optionally) a name, and gets a link
 *   the invitee opens the link, signs up, and the seat is granted by accept_invite()
 *
 * The rules here are deliberately dull: what an email looks like, what to call
 * someone before they have told us their name, which of the clinic's settings a
 * new seat should inherit, and where an invitation sits in its short life
 * (pending → accepted, or pending → expired).
 */

/** An invitation is good for a fortnight, matching `invites.expires_at`. */
export const INVITE_DAYS = 14;

/** Where the token waits while the invitee signs up / confirms their email. */
export const INVITE_TOKEN_KEY = 'myclinic.invite';

/** Where a refused claim leaves its reason, for the screen that follows. */
export const INVITE_ERROR_KEY = 'myclinic.invite.error';

/** Colours a new seat may take, so the calendar does not hand out duplicates. */
export const SEAT_COLOURS = ['#0f766e', '#3d7fb8', '#7c5cd6', '#c2872b', '#c0455a', '#5d7c5a'];

export function normalizeEmail(value = '') {
  return String(value).trim().toLowerCase();
}

/** Empty string when the address is usable — the shape `Field error` wants. */
export function inviteEmailError(email) {
  const value = normalizeEmail(email);
  if (!value) return 'Add the person’s work email.';
  if (value.length > 120) return 'That email is too long.';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(value)) return 'That does not look like an email address.';
  return '';
}

/**
 * A readable name before the person has typed one:
 *   priya@clinic.in   → Priya
 *   dr.new@clinic.in  → Dr. New
 *   frontdesk@…       → Frontdesk
 */
export function nameFromEmail(email = '') {
  const local = normalizeEmail(email).split('@')[0] ?? '';
  const parts = local.split(/[._\-+]+/).filter(Boolean)
    .map((word) => (word.length <= 3 && word === word.toUpperCase()
      ? word
      : word[0].toUpperCase() + word.slice(1)));
  if (!parts.length) return 'Team member';
  if (/^dr$/i.test(parts[0]) && parts.length > 1) {
    return `Dr. ${parts.slice(1).join(' ')}`;
  }
  return parts.join(' ');
}

/** The first colour in the palette nobody on the team is using yet. */
export function pickSeatColour(staff = []) {
  const used = new Set(staff.map((s) => String(s.color || '').toLowerCase()));
  return SEAT_COLOURS.find((c) => !used.has(c)) ?? SEAT_COLOURS[0];
}

/**
 * What a seat starts as. A doctor must be bookable the moment they appear —
 * hours and fees come from the clinic until the owner sets the person's own —
 * and a front-desk seat needs nothing but a name.
 *
 * This is the row the demo workspace writes directly; in a live clinic the same
 * fields travel on the invitation and `accept_invite()` copies them onto `staff`.
 */
export function inviteDefaults({ role = 'frontdesk', email = '', name = '', clinic = {}, staff = [] } = {}) {
  const isDoctor = role !== 'frontdesk';
  const open = String(clinic.open_time || '09:00').slice(0, 5);
  const close = String(clinic.close_time || '20:00').slice(0, 5);
  return {
    full_name: String(name || '').trim() || nameFromEmail(email),
    role,
    email: normalizeEmail(email),
    specialty: '',
    qualification: '',
    registration_no: '',
    phone: '',
    color: pickSeatColour(staff),
    day_start: isDoctor ? open : '09:00',
    day_end: isDoctor ? close : '13:00',
    slot_minutes: Number(clinic.slot_minutes) || 15,
    fee_paise: isDoctor ? Number(clinic.consultation_fee_paise ?? 50000) : 0,
    follow_up_fee_paise: isDoctor ? Number(clinic.follow_up_fee_paise ?? 25000) : 0,
    active: true,
  };
}

/** 'pending' until claimed or out of time; the two ends are kept distinct. */
export function inviteState(invite, now = new Date()) {
  if (!invite) return 'missing';
  if (invite.accepted_at) return 'accepted';
  const expires = invite.expires_at ? new Date(invite.expires_at) : null;
  if (expires && !Number.isNaN(expires.getTime()) && expires.getTime() <= now.getTime()) return 'expired';
  return 'pending';
}

/** Whole days until it lapses — 0 means today is the last day. */
export function daysLeft(invite, now = new Date()) {
  const expires = invite?.expires_at ? new Date(invite.expires_at) : null;
  if (!expires || Number.isNaN(expires.getTime())) return INVITE_DAYS;
  return Math.max(0, Math.ceil((expires.getTime() - now.getTime()) / 86400000));
}

/** Still claimable invitations, newest first. */
export function pendingInvites(list = [], now = new Date()) {
  return list
    .filter((invite) => inviteState(invite, now) === 'pending')
    .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
}

/** Where an invitation link points: the signup page, carrying its token. */
export function inviteLink(token, { origin, pathname } = {}) {
  const base = origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  const path = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
  const suffix = token ? `?invite=${encodeURIComponent(token)}` : '';
  return `${base}${path}#/signup${suffix}`;
}

/**
 * Read the token back out of a URL fragment or query string. Accepts
 * `#/signup?invite=<uuid>`, `#/signup?token=<uuid>` and a bare `?invite=…`.
 */
export function readInviteToken(value = '') {
  const text = String(value || '');
  const match = /[?&](?:invite|token)=([^&#\s]+)/i.exec(text);
  return match ? decodeURIComponent(match[1]) : '';
}

export function rememberInviteToken(token) {
  try {
    if (!token) sessionStorage.removeItem(INVITE_TOKEN_KEY);
    else sessionStorage.setItem(INVITE_TOKEN_KEY, token);
  } catch { /* private mode */ }
}

export function recallInviteToken() {
  try { return sessionStorage.getItem(INVITE_TOKEN_KEY) ?? ''; } catch { return ''; }
}

/**
 * A claim can fail for reasons the invitee has to know about — the clinic is at its
 * seat limit, the invitation was withdrawn, the address does not match. That reason
 * is carried to the next screen rather than swallowed, because the person is about
 * to be asked to create a clinic they do not want.
 */
export function rememberInviteError(message) {
  try {
    if (!message) sessionStorage.removeItem(INVITE_ERROR_KEY);
    else sessionStorage.setItem(INVITE_ERROR_KEY, String(message).slice(0, 300));
  } catch { /* private mode */ }
}

export function recallInviteError() {
  try { return sessionStorage.getItem(INVITE_ERROR_KEY) ?? ''; } catch { return ''; }
}

/** One line for the invitation list: 'Front desk · sent to priya@clinic.in'. */
export function inviteSummary(invite) {
  const role = invite?.role === 'doctor' ? 'Doctor' : 'Front desk';
  const who = invite?.full_name?.trim() || invite?.email || 'someone';
  return `${role} · ${who}`;
}
