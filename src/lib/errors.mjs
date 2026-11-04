/**
 * Turning a failure into something a clinic can act on.
 *
 * The front desk does not read stack traces and should never see
 * "Could not save." — that sentence tells nobody what to do next. Everything a
 * save can fail with falls into six buckets, and each one has a fix:
 *
 *   schema   the database is older than the build → run `supabase/schema.sql`
 *   role     this seat is not allowed to do it   → ask the owner
 *   signin   the session expired                → sign in again
 *   network  the server is unreachable          → it is queued, retry
 *   input    one value is out of range          → which field, and why
 *   retry    anything else                      → try again, then report
 *
 * The raw message is always kept on `detail` so the diagnostics panel and the
 * browser console still have the truth; it is never shown as the whole story.
 *
 * Pure and dependency-free so it can be unit-tested and reused by the store, the
 * save handlers and the error boundary.
 */

import { SCHEMA_VERSION } from './version.js';

const FIX = {
  schema: {
    label: 'Update the database',
    hint: (col, table) => `The database is behind this build${col ? ` — it has no “${col}” column on ${table}` : ''}. Paste supabase/schema.sql into the Supabase SQL editor again; it is additive and lands the project at schema ${SCHEMA_VERSION}.`,
  },
  role: {
    label: 'Ask the clinic owner',
    hint: () => 'This seat cannot make that change. The owner can, or can move you to the seat that owns the job.',
  },
  signin: {
    label: 'Sign in again',
    hint: () => 'Your session expired. Sign in again — nothing you typed is lost.',
  },
  network: {
    label: 'Check the connection',
    hint: () => 'The server could not be reached. On an offline device the change is queued and syncs when the connection returns.',
  },
  input: {
    label: 'Fix the value',
    hint: () => 'One of the values was refused. Check the field the message names and save again.',
  },
  retry: {
    label: 'Try again',
    hint: () => 'If it keeps failing, open Settings → About & version and copy the diagnostics.',
  },
};

function finish({ code = '', title, fix = 'retry', col = '', table = '', raw = '', hint = '' }) {
  const bucket = FIX[fix] ?? FIX.retry;
  return {
    code,
    title,
    message: title,
    hint: hint || bucket.hint(col, table),
    fix,
    fixLabel: bucket.label,
    detail: raw,
  };
}

/** The column PostgREST says it cannot find, if that is what failed. */
export function missingColumn(message = '') {
  const m = String(message).match(/could not find the '([^']+)' column of '([^']+)'/i)
    ?? String(message).match(/column "([^"]+)" of relation "([^"]+)" does not exist/i);
  return m ? { column: m[1], table: m[2] } : null;
}

/**
 * @param {unknown} error  anything thrown — a PostgrestError, an Error, a string
 * @param {{ context?: string }} options  what the person was doing, for the title
 */
export function explainError(error, { context = 'That did not save' } = {}) {
  const raw = String(error?.message ?? error ?? '').trim();
  const code = String(error?.code ?? '');
  const status = Number(error?.status ?? 0);
  const missing = missingColumn(raw);

  if (missing || code === 'PGRST204' || /schema cache/i.test(raw)) {
    return finish({
      code: code || 'PGRST204',
      title: missing
        ? `${context}: the database has no “${missing.column}” column yet.`
        : `${context}: the database is older than this build.`,
      fix: 'schema',
      col: missing?.column ?? '',
      table: missing?.table ?? '',
      raw,
    });
  }

  // The two rules of schema 12 that a person can fix themselves.
  if (/staff:hours/i.test(raw)) {
    return finish({
      code: 'staff:hours',
      title: `${context}: those hours are outside the clinic's sessions.`,
      fix: 'input',
      raw: 'staff:hours',
      hint: 'A doctor sits inside one of the clinic’s sessions, never across the break between them. Widen the clinic hours in Settings, or move this doctor into the session they actually work.',
    });
  }

  if (code === '42501' || /row-level security|permission denied|insufficient privilege/i.test(raw)) {
    return finish({ code: code || '42501', title: `${context}: this seat is not allowed to change that.`, fix: 'role', raw });
  }

  if (code === '23505' || /duplicate key|already exists/i.test(raw)) {
    return finish({ code, title: `${context}: that record already exists.`, fix: 'input', raw });
  }

  if (code === '23503' || /foreign key/i.test(raw)) {
    return finish({ code, title: `${context}: something it points at was deleted.`, fix: 'input', raw });
  }

  if (code === '23514' || /violates check constraint/i.test(raw)) {
    const field = String(raw).match(/constraint "([^"]+)"/i)?.[1] ?? '';
    return finish({
      code,
      title: `${context}: a value is outside what the database accepts${field ? ` (${field.replace(/_/g, ' ')})` : ''}.`,
      fix: 'input',
      raw,
    });
  }

  if (code === '22P02' || /invalid input syntax/i.test(raw)) {
    return finish({ code, title: `${context}: a value has the wrong format.`, fix: 'input', raw });
  }

  if (/JWT expired|invalid JWT|not authenticated|session.*expired/i.test(raw) || status === 401) {
    return finish({ code: code || '401', title: `${context}: you are signed out.`, fix: 'signin', raw });
  }

  if (status === 429 || /rate limit|too many requests/i.test(raw)) {
    return finish({ code: code || '429', title: `${context}: too many attempts just now.`, fix: 'retry', raw });
  }

  if (/failed to fetch|networkerror|load failed|offline|ERR_NETWORK/i.test(raw)) {
    return finish({ code: code || 'network', title: `${context}: the server could not be reached.`, fix: 'network', raw });
  }

  return finish({ code, title: `${context}${raw ? ` — ${raw}` : '.'}`, fix: 'retry', raw });
}

/** One line for a toast: the title, then the fix when the title is not enough. */
export function errorLine(error, options) {
  const e = explainError(error, options);
  return e.fix === 'retry' && !e.detail ? e.message : `${e.message} ${e.hint}`;
}

const LAST_ERRORS = [];
const MAX_KEPT = 5;

/** Keep the last few failures so the diagnostics panel can show them. */
export function rememberError(error, context = '') {
  const explained = typeof error === 'object' && error?.fix ? error : explainError(error, { context });
  LAST_ERRORS.unshift({ ...explained, at: new Date().toISOString(), context });
  if (LAST_ERRORS.length > MAX_KEPT) LAST_ERRORS.length = MAX_KEPT;
  return explained;
}

export function recentErrors() {
  return [...LAST_ERRORS];
}

export function clearRecentErrors() {
  LAST_ERRORS.length = 0;
}

/** The block a person can copy into a message — no tokens, no patient data. */
export function diagnosticsText({ app = '', schema = SCHEMA_VERSION, build = '' } = {}) {
  const rows = recentErrors().map((e) => `- ${e.at} · ${e.context || 'app'} · ${e.code || 'no code'} · ${e.detail || e.message}`);
  return [
    `myClinic ${app || 'unknown build'} · schema ${schema} · ${build || 'no build id'}`,
    `browser ${typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'}`,
    rows.length ? rows.join('\n') : '- no recent errors',
  ].join('\n');
}
