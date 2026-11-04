/**
 * myClinic offline-first sync engine.
 *
 * Design contract
 * ---------------
 * 1. Every write goes to the local cache first (optimistic) and is appended to a
 *    durable outbox. The UI never waits for the network.
 * 2. The outbox is replayed in order when connectivity returns. Each mutation
 *    carries a client-generated id, so replay is idempotent: a retry after a
 *    timeout cannot create a duplicate row.
 * 3. Conflicts are resolved per field with a documented policy, never silently:
 *
 *      policy              when it applies                     winner
 *      ---------------------------------------------------------------------
 *      server-wins         money & audit fields                server
 *      client-wins         the row was created locally and     client
 *                          has never been on the server
 *      merge-by-field      ordinary edits                      newest
 *                          (last-writer-wins on the fields     change per
 *                           that actually changed)             field
 *      manual              status / paid_paise / total_paise    neither
 *                          changed on both sides since the      (surfaced
 *                          local base version                  to the user)
 *
 * 4. Nothing is ever dropped silently: a conflict that needs a human is queued in
 *    `conflicts` and surfaced in the UI with both versions.
 */

export const TABLES = ['staff', 'patients', 'appointments', 'consultations', 'invoices', 'day_closes', 'reminders'];

/**
 * Which offline bookkeeping columns each table actually has, mirroring §1 of
 * supabase/schema.sql.
 *
 * Assuming they were everywhere was a real outage. `staff` and `invoices` have no
 * `client_updated_at`, so every queued staff edit — and every queued invoice
 * create, which sent `client_id` — came back 400 / PGRST204 ("Could not find the
 * 'client_updated_at' column of 'staff'"). That error is neither a conflict nor a
 * network failure, so the operation was retried forever *and* held up every write
 * queued behind it.
 *
 * Idempotent replay does not depend on `client_id`: the client generates the row's
 * primary key too, so a replayed insert hits the duplicate key and is recognised
 * as already applied. `client_id` therefore stays an optimisation, not a
 * requirement.
 */
export const OFFLINE_COLUMNS = {
  patients:      { client_id: true,  client_updated_at: true },
  appointments:  { client_id: true,  client_updated_at: true },
  consultations: { client_id: true,  client_updated_at: true },
  day_closes:    { client_id: true,  client_updated_at: false },
  reminders:     { client_id: true,  client_updated_at: false },
  invoices:      { client_id: false, client_updated_at: false },
  staff:         { client_id: false, client_updated_at: false },
};

/** True when `table` declares `column` — the client must not send it otherwise. */
export function supportsColumn(table, column) {
  return Boolean(OFFLINE_COLUMNS[table]?.[column]);
}

/** The tables that carry a last-local-edit stamp. */
export const CLIENT_STAMPED = Object.keys(OFFLINE_COLUMNS).filter((t) => OFFLINE_COLUMNS[t].client_updated_at);

/** Add `client_updated_at` only where the database has a column to put it in. */
export function stampUpdate(table, patch, at) {
  return supportsColumn(table, 'client_updated_at') ? { ...patch, client_updated_at: at } : patch;
}

/**
 * The column PostgREST or Postgres named as missing, or null.
 *
 *   {"code":"PGRST204","message":"Could not find the 'client_updated_at' column of 'staff' in the schema cache"}
 *   column "client_updated_at" of relation "staff" does not exist
 */
export function unknownColumn(error) {
  const msg = String(error?.message ?? error ?? '');
  const m = msg.match(/Could not find the '([A-Za-z0-9_]+)' column/i)
    || msg.match(/column ["']?([A-Za-z0-9_]+)["']? of relation/i)
    || msg.match(/column ["']?([A-Za-z0-9_]+)["']? does not exist/i);
  return m ? m[1] : null;
}

/** Fields where an automatic merge is never acceptable. */
export const MANUAL_FIELDS = {
  invoices: ['total_paise', 'paid_paise', 'status', 'lines', 'method'],
  appointments: ['status', 'token_no'],
  consultations: ['diagnoses', 'prescription'],
  patients: ['code'],
  staff: ['role', 'clinic_id', 'user_id'],
  // A day is closed once: the snapshot and the count must not be merged by halves.
  day_closes: ['totals', 'closed_on', 'counted_cash_paise', 'variance_paise'],
  // The send log is evidence, so it is appended, never merged.
  reminders: ['draft_key', 'status', 'channel', 'body'],
};

/** Fields the server always owns once a row exists. */
const SERVER_OWNED = ['id', 'created_at', 'updated_at', 'clinic_id'];

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;   // cached clinical data expires daily

export function cacheKey(userId, clinicId) {
  return `myclinic.cache.v2.${userId ?? 'anon'}.${clinicId ?? 'none'}`;
}
const OUTBOX_KEY = (userId) => `myclinic.outbox.v2.${userId ?? 'anon'}`;
const META_KEY = 'myclinic.sync.meta';

/* ------------------------------------------------------------------ storage */

function safeParse(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function readCache(userId, clinicId, now = Date.now()) {
  const entry = safeParse(localStorage.getItem(cacheKey(userId, clinicId)));
  if (!entry || !entry.savedAt) return null;
  if (now - entry.savedAt > CACHE_TTL_MS) return null;   // expired, never reused
  return entry;
}

export function writeCache(userId, clinicId, state, now = Date.now()) {
  try {
    localStorage.setItem(cacheKey(userId, clinicId), JSON.stringify({ savedAt: now, state }));
  } catch { /* quota or private mode — the app still works online */ }
}

/** Wipe every cached workspace on this device (sign-out, role change). */
export function clearAllCache() {
  const doomed = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i);
    if (k && (k.startsWith('myclinic.cache.') || k.startsWith('myclinic.outbox.'))) doomed.push(k);
  }
  doomed.forEach((k) => localStorage.removeItem(k));
  return doomed.length;
}

/* -------------------------------------------------------------------- outbox */

export function readOutbox(userId) {
  return safeParse(localStorage.getItem(OUTBOX_KEY(userId))) ?? [];
}
export function writeOutbox(userId, ops) {
  try { localStorage.setItem(OUTBOX_KEY(userId), JSON.stringify(ops)); } catch { /* ignore */ }
}
/**
 * Append an operation to the outbox.
 * `op.op_id` identifies the queued operation; `op.id` is the id of the row it
 * targets. They are deliberately different keys — conflating them was a real bug.
 */
export function enqueue(userId, op) {
  const ops = readOutbox(userId);
  const record = { ...op, op_id: op.op_id ?? newClientId(), attempts: op.attempts ?? 0 };

  // Coalesce rapid edits of the same row into one pending operation.
  if (record.type === 'update') {
    const prior = ops.find((o) => o.type === 'update' && o.table === record.table && o.id === record.id);
    if (prior) {
      prior.patch = { ...prior.patch, ...record.patch };
      prior.attempts = 0;
      prior.queued_at = record.queued_at;
      writeOutbox(userId, ops);
      return prior;
    }
  }
  ops.push(record);
  writeOutbox(userId, ops);
  return record;
}

export function dequeue(userId, opId) {
  const ops = readOutbox(userId).filter((o) => o.op_id !== opId);
  writeOutbox(userId, ops);
  return ops;
}

/** Stable id for a locally created row so replay is idempotent. */
export function newClientId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/* ---------------------------------------------------------------- conflicts */

/**
 * Three-way merge of a local patch against the server row using the base version
 * the client last saw. Returns { patch, conflicts } where `conflicts` lists fields
 * needing a human decision.
 */
export function mergeFields({ table, base, local, remote }) {
  const manual = MANUAL_FIELDS[table] ?? [];
  const patch = {};
  const conflicts = [];

  // `local` is a patch: a key that is absent was not changed on this device.
  // Iterating only its keys is what keeps `undefined` out of the outgoing UPDATE.
  const keys = Object.keys(local ?? {});
  for (const key of keys) {
    if (SERVER_OWNED.includes(key)) continue;
    const localChanged = !same(local[key], base?.[key]);
    const remoteChanged = !same(remote?.[key], base?.[key]);
    if (!localChanged && !remoteChanged) continue;
    if (localChanged && !remoteChanged) { patch[key] = local[key]; continue; }
    if (!localChanged && remoteChanged) continue;              // server already has it
    // Both sides changed the same field.
    if (same(local[key], remote[key])) continue;               // converged by luck
    if (manual.includes(key)) {
      conflicts.push({ field: key, local: local[key], remote: remote[key] });
    } else {
      patch[key] = local[key];                                 // newest local edit wins
    }
  }
  // Money and status move as one unit: if any manual field needs a decision, hold
  // back every locally-changed manual field so the human resolves a coherent
  // financial state instead of half of one.
  const manualConflicts = conflicts.filter((c) => manual.includes(c.field));
  if (manualConflicts.length) {
    for (const key of manual) {
      if (key in patch) {
        if (!conflicts.some((c) => c.field === key)) {
          conflicts.push({ field: key, local: patch[key], remote: remote?.[key] });
        }
        delete patch[key];
      }
    }
  }

  return { patch, conflicts };
}

function same(a, b) {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (typeof a === 'object' || typeof b === 'object') {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
  }
  return false;
}

/**
 * Decide what to do with a failed replay.
 * Returns 'retry' | 'drop' | 'conflict' | 'fatal'.
 */
export function classifySyncError(error, status) {
  const msg = String(error?.message ?? error ?? '').toLowerCase();
  const code = String(error?.code ?? '');
  if (/offline|failed to fetch|networkerror|load failed|timeout|timed out/.test(msg)) return 'retry';
  if (status === 0 || status === 408 || status === 429 || (status >= 500 && status < 600)) return 'retry';
  if (code === '23505' || /duplicate key/.test(msg)) return 'drop';        // already applied
  if (code === '23503' || /foreign key/.test(msg)) return 'retry';          // parent not synced yet
  if (code === '23514' || code === '42501' || /permission denied|row-level security|violates check/.test(msg)) return 'conflict';
  if (status === 404 || code === 'PGRST116') return 'conflict';             // row vanished remotely
  if (code === 'PGRST204' || /could not find the '.*' column|column .* does not exist/.test(msg)) return 'repair';
  if (status === 401 || status === 403) return 'retry';                     // session refresh pending
  return 'fatal';
}

/**
 * How many times a *permanent* failure is retried before it is put in front of a
 * human. Without a cap, one un-sendable row sits at the head of the outbox and
 * every later write waits behind it — which is what a browser full of repeating
 * 400s looks like from the outside.
 */
export const MAX_SYNC_ATTEMPTS = 5;

/** Exponential backoff with jitter, hard-capped so a device never sleeps for minutes. */
export const MAX_BACKOFF_MS = 30000;
export function backoffMs(attempts, rand = Math.random()) {
  const base = 1000 * 2 ** Math.max(0, attempts - 1);
  const jittered = base * (0.75 + rand * 0.5);
  return Math.round(Math.min(MAX_BACKOFF_MS, jittered));
}

/* --------------------------------------------------------------- watermark */

export function readSyncMeta() { return safeParse(localStorage.getItem(META_KEY)) ?? {}; }
export function writeSyncMeta(patch) {
  try { localStorage.setItem(META_KEY, JSON.stringify({ ...readSyncMeta(), ...patch })); } catch { /* ignore */ }
}

/** Human label for a queued/pending operation, used in the sync UI. */
export function describeOp(op, patients = []) {
  const who = patients.find((p) => p.id === (op.row?.patient_id ?? op.patch?.patient_id))?.full_name;
  const nouns = {
    patients: 'patient', appointments: 'appointment', consultations: 'consultation',
    invoices: 'invoice', staff: 'staff member',
  };
  const noun = nouns[op.table] ?? op.table;
  const verb = { create: 'Created', update: 'Edited', delete: 'Deleted', appointment_status: 'Updated' }[op.type] ?? 'Changed';
  return `${verb} ${noun}${who ? ` · ${who}` : ''}`;
}

/* ------------------------------------------------------------------ replay */

/**
 * Replay the outbox against a database adapter. Pure enough to unit-test: the
 * adapter is the only side effect, so a fake database exercises the whole
 * idempotency, merge and conflict machinery without a network.
 *
 * db = {
 *   selectOne(table, filter)  -> row | null      (filter: { id } | { client_id })
 *   insert(table, row)        -> row
 *   update(table, id, patch)  -> row
 *   remove(table, id)         -> void
 * }
 *
 * Returns { remaining, conflicts, errors, stopped } where `remaining` is the ops
 * still to retry, `conflicts` need a human, and `stopped` is the error that
 * halted the run (network) so the caller can back off.
 */
/**
 * Run one write, and if the server says a column does not exist, drop just that
 * column and try once more.
 *
 * A device running a newer build than the database is normal during an upgrade
 * (and permanent if someone forgets the SQL). Losing one field is recoverable;
 * losing the whole write — forever — is not.
 */
async function writeWithColumnRepair(run, payload, onRepair) {
  try {
    return await run(payload);
  } catch (e) {
    const column = unknownColumn(e);
    if (!column || !Object.prototype.hasOwnProperty.call(payload, column)) throw e;
    const stripped = { ...payload };
    delete stripped[column];
    const saved = await run(stripped);
    onRepair(column);
    return saved;
  }
}

export async function replayOutbox({ ops, db, now = () => new Date().toISOString() }) {
  const remaining = [...ops];
  const conflicts = [];
  const applied = [];
  const repaired = [];
  let stopped = null;

  const drop = (op) => {
    const i = remaining.findIndex((o) => o.op_id === op.op_id);
    if (i >= 0) remaining.splice(i, 1);
  };

  for (const op of ops) {
    if (stopped) break;
    try {
      if (op.type === 'create') {
        const row = { ...op.row, client_id: op.row.client_id ?? op.client_id };
        delete row._offline;
        if (!supportsColumn(op.table, 'client_id')) delete row.client_id;
        // Dedupe on the client id where it exists, otherwise on the primary key the
        // client generated — either way a replay of the same create lands once.
        const probe = supportsColumn(op.table, 'client_id')
          ? { client_id: op.row.client_id ?? op.client_id }
          : { id: row.id };
        if (probe.client_id || probe.id) {
          const existing = await db.selectOne(op.table, probe);
          if (existing) { drop(op); applied.push({ op, row: existing, deduped: true }); continue; }
        }
        const saved = await writeWithColumnRepair(
          (payload) => db.insert(op.table, payload),
          row,
          (column) => repaired.push({ op_id: op.op_id, table: op.table, column }),
        );
        drop(op);
        applied.push({ op, row: saved, deduped: false });
      } else if (op.type === 'update') {
        const current = await db.selectOne(op.table, { id: op.id });
        if (!current) {
          conflicts.push({
            id: op.op_id, table: op.table, kind: 'deleted-remotely',
            local: op.patch, remote: null, opId: op.op_id, at: now(),
          });
          drop(op);
          continue;
        }
        const { patch, conflicts: fieldConflicts } = mergeFields({
          table: op.table, base: op.base ?? null, local: op.patch, remote: current,
        });
        if (fieldConflicts.length) {
          conflicts.push({
            id: `${op.op_id}:${fieldConflicts.map((f) => f.field).join(',')}`,
            table: op.table, kind: 'field', fields: fieldConflicts,
            local: op.patch, remote: current, opId: op.op_id, at: now(),
          });
        }
        if (Object.keys(patch).length) {
          const saved = await writeWithColumnRepair(
            (payload) => db.update(op.table, op.id, payload),
            stampUpdate(op.table, patch, now()),
            (column) => repaired.push({ op_id: op.op_id, table: op.table, column }),
          );
          applied.push({ op, row: saved });
        }
        drop(op);
      } else if (op.type === 'delete') {
        await db.remove(op.table, op.id);
        drop(op);
        applied.push({ op, row: null });
      }
    } catch (e) {
      const verdict = classifySyncError(e, Number(e?.status ?? 0));
      if (verdict === 'drop') { drop(op); applied.push({ op, row: null, deduped: true }); continue; }
      if (verdict === 'conflict') {
        conflicts.push({
          id: op.op_id, table: op.table, kind: 'rejected',
          message: e.message ?? 'The server rejected this change.',
          local: op.patch ?? op.row, remote: null, opId: op.op_id, at: now(),
        });
        drop(op);
        continue;
      }
      // A permanent failure that has already been retried MAX_SYNC_ATTEMPTS times
      // goes to a human instead of blocking every later write. The queue keeps
      // draining; the sync screen shows what could not be saved.
      const attempts = (op.attempts ?? 0) + 1;
      if ((verdict === 'fatal' || verdict === 'repair') && attempts >= MAX_SYNC_ATTEMPTS) {
        conflicts.push({
          id: op.op_id, table: op.table, kind: 'rejected',
          message: e.message ?? 'The server refused this change.',
          local: op.patch ?? op.row, remote: null, opId: op.op_id, at: now(), attempts,
        });
        drop(op);
        continue;
      }

      // retry / fatal — keep it queued with a backoff stamp, stop the run.
      const i = remaining.findIndex((o) => o.op_id === op.op_id);
      if (i >= 0) {
        remaining[i] = {
          ...op, attempts, last_error: e.message ?? String(e),
          next_attempt_at: Date.now() + backoffMs(attempts),
        };
      }
      stopped = { op, error: e, verdict };
      break;
    }
  }

  return { remaining, conflicts, applied, repaired, stopped };
}
