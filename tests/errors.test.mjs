import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearRecentErrors, diagnosticsText, errorLine, explainError, missingColumn, recentErrors, rememberError,
} from '../src/lib/errors.mjs';
import { PROFILE_COLUMNS, pickColumns, profilePatch } from '../src/lib/logic.mjs';
import { SCHEMA_VERSION } from '../src/lib/version.js';
import { readFileSync } from 'node:fs';

/**
 * "My account will not save" was a bare toast over a PostgREST refusal. These
 * tests pin both halves of the fix: the payload the screen sends, and the
 * sentence a person reads when something is refused anyway.
 */

const schemaSql = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');

/* ------------------------------------------------------- the account save */

test('the account screen sends only the columns profiles has', () => {
  // The exact shape Settings holds: three editable fields plus every preference
  // the Appearance tab renders, plus state the database has no column for.
  const profile = { full_name: ' Dr Rao ', phone: '9820000000', designation: 'MBBS, MD' };
  const prefs = {
    theme: 'dark', density: 'compact', reminders_enabled: true, reminder_lead_hours: 24,
    send_review_request: true, quiet_hours: '21:00-08:00',
    accent: 'teal',          // localStorage only
    slotPreview: '30',       // a screen-only field
  };
  const patch = profilePatch(profile, prefs, 'system');

  for (const key of Object.keys(patch)) {
    assert.ok(PROFILE_COLUMNS.includes(key), `${key} is not a profiles column`);
  }
  assert.equal(patch.accent, undefined);
  assert.equal(patch.slotPreview, undefined);
  assert.equal(patch.full_name, 'Dr Rao');
  assert.equal(patch.theme, 'system');       // the chosen theme wins over the stale pref
  assert.equal(patch.reminders_enabled, true);
});

test('a preference the database does not have cannot break the save', () => {
  // This is the bug: `send_review_request` reached PostgREST before schema 12 had
  // a column for it, and the whole update was refused — so changing your name
  // failed because of a notification toggle.
  const patch = profilePatch({ full_name: 'New Name' }, { send_review_request: true, future_thing: 'x' }, null);
  assert.equal(patch.future_thing, undefined);
  assert.equal(patch.full_name, 'New Name');
  assert.ok(Object.keys(patch).length <= PROFILE_COLUMNS.length);
});

test('empty fields are not sent, so a blank is never silently written', () => {
  const patch = profilePatch({ full_name: 'Dr Rao', phone: '', designation: null }, {}, null);
  assert.equal(patch.full_name, 'Dr Rao');
  assert.equal('designation' in patch, false);
  assert.equal(patch.phone, '');              // a blanked phone *is* a value
  assert.deepEqual(pickColumns({ a: undefined, b: null, c: 0 }, ['a', 'b', 'c']), { c: 0 });
});

test('every column the account screen sends exists in schema 12', () => {
  // The cheap guard: the whitelist and the SQL cannot drift apart again.
  for (const column of PROFILE_COLUMNS) {
    assert.match(schemaSql, new RegExp(`\\b${column}\\b`), `schema.sql has no ${column}`);
  }
  assert.match(schemaSql, /alter table public\.profiles\s+add column if not exists send_review_request boolean not null default true/);
});

/* ---------------------------------------------------------- the refusals */

test('a missing column says which column, and what to do about it', () => {
  const postgrest = {
    code: 'PGRST204', status: 400,
    message: "Could not find the 'send_review_request' column of 'profiles' in the schema cache",
  };
  const explained = explainError(postgrest, { context: 'Your account did not save' });
  assert.equal(explained.fix, 'schema');
  assert.match(explained.message, /send_review_request/);
  assert.match(explained.hint, /supabase\/schema\.sql/);
  assert.match(explained.hint, new RegExp(`schema ${SCHEMA_VERSION}`));
  assert.equal(explained.detail, postgrest.message);

  assert.deepEqual(missingColumn(postgrest.message), { column: 'send_review_request', table: 'profiles' });
  assert.equal(missingColumn('no such column here'), null);
});

test('the Postgres spelling of the same failure is understood too', () => {
  const pg = { code: '42703', message: 'column "sessions" of relation "clinics" does not exist' };
  const explained = explainError(pg, { context: 'The clinic profile did not save' });
  assert.equal(explained.fix, 'schema');
  assert.match(explained.message, /sessions/);
});

test('a refusal is not a bug report: each bucket has its own sentence', () => {
  const role = explainError({ code: '42501', message: 'only a clinic owner can change a role' }, { context: 'Did not save' });
  assert.equal(role.fix, 'role');
  assert.match(role.message, /not allowed/);
  assert.doesNotMatch(role.message, /owner can change a role/);

  const expired = explainError({ status: 401, message: 'JWT expired' }, { context: 'Did not save' });
  assert.equal(expired.fix, 'signin');

  const offline = explainError({ message: 'TypeError: Failed to fetch' }, { context: 'Did not save' });
  assert.equal(offline.fix, 'network');

  const dup = explainError({ code: '23505', message: 'duplicate key value violates unique constraint' }, { context: 'Did not save' });
  assert.equal(dup.fix, 'input');

  const range = explainError({ code: '23514', message: 'new row violates check constraint "clinics_follow_up_days_check"' }, { context: 'Did not save' });
  assert.equal(range.fix, 'input');
  assert.match(range.message, /follow up days/);

  const busy = explainError({ status: 429, message: 'rate limit exceeded' }, { context: 'Did not save' });
  assert.equal(busy.fix, 'retry');

  const unknown = explainError(new Error('boom'), { context: 'Did not save' });
  assert.equal(unknown.fix, 'retry');
  assert.match(unknown.message, /boom/);
});

test('a doctor-hours refusal is answered in words the owner can act on', () => {
  const explained = explainError({ code: 'P0001', message: 'staff:hours' }, { context: 'Dr Rao did not save' });
  assert.equal(explained.fix, 'input');
  assert.match(explained.message, /outside the clinic's sessions/);
  assert.match(explained.hint, /inside one of the clinic.s sessions/);
});

test('nothing is swallowed: the raw text is always kept', () => {
  const raw = 'some unexpected postgres complaint';
  assert.equal(explainError({ message: raw }).detail, raw);
  assert.ok(errorLine({ message: raw }).includes(raw));
});

test('the last few failures are remembered for the diagnostics panel', () => {
  clearRecentErrors();
  rememberError({ code: 'PGRST204', message: "Could not find the 'x' column of 'profiles' in the schema cache" }, 'Save my account');
  rememberError({ message: 'Failed to fetch' }, 'Load the diary');
  const list = recentErrors();
  assert.equal(list.length, 2);
  assert.equal(list[0].context, 'Load the diary');       // newest first
  assert.equal(list[0].fix, 'network');
  assert.equal(list[1].fix, 'schema');

  const text = diagnosticsText({ app: '1.13.0', schema: 12, build: 'abc123' });
  assert.match(text, /myClinic 1\.13\.0 · schema 12 · abc123/);
  assert.match(text, /Load the diary/);
  assert.doesNotMatch(text, /password|token|jwt/i);
  clearRecentErrors();
  assert.equal(recentErrors().length, 0);
});
