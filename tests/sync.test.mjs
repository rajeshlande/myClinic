import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLIENT_STAMPED, MAX_SYNC_ATTEMPTS, OFFLINE_COLUMNS, classifySyncError, replayOutbox,
  stampUpdate, supportsColumn, unknownColumn,
} from '../src/lib/offline.js';

/**
 * A fake PostgREST over one table. `columns` is the server's idea of the row —
 * sending a key that is not in it throws exactly what PostgREST throws
 * (400 + PGRST204), because that is the bug this file exists for.
 */
function fakeDb(seed = [], { columns = null, failNext = null } = {}) {
  const rows = new Map(seed.map((r) => [r.id, { ...r }]));
  const calls = [];
  let fail = failNext;

  const check = (payload) => {
    if (!columns) return;
    for (const key of Object.keys(payload)) {
      if (!columns.includes(key)) {
        const e = new Error(`Could not find the '${key}' column of 'staff' in the schema cache`);
        e.code = 'PGRST204';
        e.status = 400;
        throw e;
      }
    }
  };

  return {
    rows, calls,
    async selectOne(table, filter) {
      calls.push(['selectOne', table, filter]);
      for (const r of rows.values()) {
        if (filter.id && r.id === filter.id) return { ...r };
        if (filter.client_id && r.client_id === filter.client_id) return { ...r };
      }
      return null;
    },
    async insert(table, row) {
      calls.push(['insert', table, row]);
      if (fail) { const e = fail; fail = null; throw e; }
      check(row);
      rows.set(row.id, { ...row });
      return { ...row };
    },
    async update(table, id, patch) {
      calls.push(['update', table, id, patch]);
      if (fail) { const e = fail; fail = null; throw e; }
      check(patch);
      const cur = rows.get(id);
      if (!cur) { const e = new Error('row not found'); e.code = 'PGRST116'; e.status = 404; throw e; }
      const next = { ...cur, ...patch };
      rows.set(id, next);
      return { ...next };
    },
    async remove(table, id) { calls.push(['remove', table, id]); rows.delete(id); },
  };
}

const staffRow = { id: 's1', clinic_id: 'c1', full_name: 'Dr. Asha Rao', phone: '9000000001', role: 'doctor' };
const opStaffEdit = (patch, extra = {}) => ({ op_id: 'op-s1', type: 'update', table: 'staff', id: 's1', patch, base: { phone: '9000000001' }, attempts: 0, ...extra });

test('a staff edit is never stamped with client_updated_at', () => {
  // staff has no such column; the stamp used to be added to every table
  assert.deepEqual(stampUpdate('staff', { phone: '1' }, 'now'), { phone: '1' });
  assert.deepEqual(stampUpdate('invoices', { note: 'x' }, 'now'), { note: 'x' });
  for (const table of CLIENT_STAMPED) {
    assert.deepEqual(stampUpdate(table, { a: 1 }, 'T'), { a: 1, client_updated_at: 'T' });
  }
});

test('an invoice or staff update replays without a stamp', async () => {
  const db = fakeDb([staffRow], { columns: ['id', 'clinic_id', 'full_name', 'phone', 'role', 'updated_at'] });
  const { remaining, repaired, stopped } = await replayOutbox({ ops: [opStaffEdit({ phone: '9000000009' })], db });
  assert.equal(remaining.length, 0, 'queue drained on the first attempt');
  assert.equal(repaired.length, 0, 'no repair was needed');
  assert.equal(stopped, null);
  assert.equal(db.rows.get('s1').phone, '9000000009');
  const patchSent = db.calls.find((c) => c[0] === 'update')[3];
  assert.equal('client_updated_at' in patchSent, false);
});

test('a clinical update still carries the stamp it needs for conflict detection', async () => {
  const db = fakeDb([{ id: 'p1', clinic_id: 'c1', full_name: 'Asha', phone: '111' }]);
  await replayOutbox({
    ops: [{ op_id: 'op-p1', type: 'update', table: 'patients', id: 'p1', patch: { notes: 'offline' }, base: { phone: '111' }, attempts: 0 }],
    db,
    now: () => '2026-11-04T10:00:00.000Z',
  });
  const patchSent = db.calls.find((c) => c[0] === 'update')[3];
  assert.equal(patchSent.client_updated_at, '2026-11-04T10:00:00.000Z');
  assert.equal(db.rows.get('p1').notes, 'offline');
});

test('a column this database does not have is dropped, and the write still lands', async () => {
  // The exact production failure: a build that stamps client_updated_at against a
  // database whose staff table has no such column.
  const db = fakeDb([staffRow], { columns: ['id', 'clinic_id', 'full_name', 'phone', 'role'] });
  const op = { op_id: 'op-s2', type: 'update', table: 'staff', id: 's1', patch: { phone: '9000000009', client_updated_at: 'T' }, base: { phone: '9000000001' }, attempts: 0 };
  const { remaining, repaired, conflicts, stopped } = await replayOutbox({ ops: [op], db });
  assert.equal(stopped, null, 'the run was not halted');
  assert.equal(remaining.length, 0, 'nothing left to retry');
  assert.equal(conflicts.length, 0, 'a missing optional column is not a conflict');
  assert.deepEqual(repaired.map((r) => r.column), ['client_updated_at']);
  assert.equal(db.rows.get('s1').phone, '9000000009', 'the edit was saved');
});

test('a create carrying an unknown column also repairs itself', async () => {
  const db = fakeDb([], { columns: ['id', 'client_id', 'clinic_id', 'full_name', 'phone', 'role'] });
  const op = {
    op_id: 'op-new', type: 'create', table: 'staff', client_id: 'c9',
    row: { id: 's9', client_id: 'c9', clinic_id: 'c1', full_name: 'Desk Two', role: 'frontdesk', client_updated_at: 'T' },
    attempts: 0,
  };
  const { remaining, repaired } = await replayOutbox({ ops: [op], db });
  assert.equal(remaining.length, 0);
  assert.deepEqual(repaired.map((r) => r.column), ['client_updated_at']);
  assert.equal(db.rows.get('s9').full_name, 'Desk Two');
});

test('unknownColumn reads both error shapes', () => {
  assert.equal(
    unknownColumn({ message: "Could not find the 'client_updated_at' column of 'staff' in the schema cache" }),
    'client_updated_at',
  );
  assert.equal(unknownColumn({ message: 'column "booking_ref" of relation "appointments" does not exist' }), 'booking_ref');
  assert.equal(unknownColumn({ message: 'column "note" does not exist' }), 'note');
  assert.equal(unknownColumn({ message: 'Failed to fetch' }), null);
  assert.equal(unknownColumn({}), null);
});

test('PGRST204 is classified as a repair, not as a fatal error', () => {
  const e = { code: 'PGRST204', status: 400, message: "Could not find the 'x' column of 'staff' in the schema cache" };
  assert.equal(classifySyncError(e, 400), 'repair');
});

test('a permanently rejected change is given to a human instead of retrying forever', async () => {
  const rejected = new Error('new row violates row-level security policy');
  rejected.code = '42501';
  rejected.status = 403;
  // 42501 is a conflict on the first attempt — no cap needed.
  const db = fakeDb([staffRow], { failNext: rejected });
  const { remaining, conflicts } = await replayOutbox({ ops: [opStaffEdit({ phone: '2' })], db });
  assert.equal(remaining.length, 0);
  assert.equal(conflicts.length, 1);
});

test('a fatal error retries up to the cap, then leaves the queue', async () => {
  const broken = new Error('something the server will never accept');
  broken.status = 400;   // a 4xx with no recognised code: permanent, not a network blip
  const db = fakeDb([staffRow], { failNext: broken });
  const op = opStaffEdit({ phone: '3' }, { attempts: MAX_SYNC_ATTEMPTS - 1 });
  const { remaining, conflicts, stopped } = await replayOutbox({ ops: [op], db });
  assert.equal(stopped, null, 'the run was not halted by the poison operation');
  assert.equal(remaining.length, 0, 'the operation left the queue');
  assert.equal(conflicts.length, 1, 'and is now in front of a human');
  assert.match(conflicts[0].message, /never accept/);
  assert.equal(conflicts[0].attempts, MAX_SYNC_ATTEMPTS);
});

test('a poison operation no longer blocks the writes behind it', async () => {
  const db = fakeDb([
    staffRow,
    { id: 'p1', clinic_id: 'c1', full_name: 'Asha', phone: '111' },
  ]);
  let first = true;
  const original = db.update.bind(db);
  db.update = async (table, id, patch) => {
    if (first && table === 'staff') {
      first = false;
      const e = new Error('the server will never accept this');
      e.status = 400;
      throw e;
    }
    return original(table, id, patch);
  };

  const ops = [
    opStaffEdit({ phone: '4' }, { attempts: MAX_SYNC_ATTEMPTS - 1 }),   // poison, at the cap
    { op_id: 'op-p2', type: 'update', table: 'patients', id: 'p1', patch: { notes: 'saved after it' }, base: { phone: '111' }, attempts: 0 },
  ];
  const { remaining, applied, conflicts } = await replayOutbox({ ops, db });
  assert.equal(remaining.length, 0, 'queue empty');
  assert.equal(conflicts.length, 1, 'the poison operation is a conflict');
  assert.equal(applied.length, 1, 'the patient edit went through');
  assert.equal(db.rows.get('p1').notes, 'saved after it');
});

test('a network failure still just backs off — it is not given up on', async () => {
  const offline = new Error('Failed to fetch');
  const db = fakeDb([staffRow], { failNext: offline });
  const op = opStaffEdit({ phone: '5' }, { attempts: MAX_SYNC_ATTEMPTS + 3 });
  const { remaining, stopped, conflicts } = await replayOutbox({ ops: [op], db });
  assert.equal(remaining.length, 1, 'still queued');
  assert.equal(conflicts.length, 0, 'not a conflict');
  assert.equal(stopped.verdict, 'retry');
  assert.ok(remaining[0].next_attempt_at > Date.now());
});


/* ------------------------------------------------------------------ invoices
 * `invoices` has no client_id and no client_updated_at. Creating one used to send
 * both, so "Save & bill" in a live clinic was rejected by PostgREST — the same
 * failure as the staff edit, one table over.
 */
const invoiceColumns = ['id', 'clinic_id', 'number', 'patient_id', 'doctor_id', 'issued_on', 'lines',
  'subtotal_paise', 'discount_paise', 'tax_paise', 'total_paise', 'paid_paise', 'method', 'status',
  'notes', 'created_at', 'updated_at'];
const invoiceRow = {
  id: 'inv-1', client_id: 'c-inv-1', clinic_id: 'c1', number: 'INV/2526/0007', patient_id: 'p1',
  lines: [], subtotal_paise: 50000, total_paise: 50000, paid_paise: 0, method: 'cash', status: 'unpaid',
};
const opInvoiceCreate = (row = invoiceRow) => ({ op_id: 'op-inv-1', type: 'create', table: 'invoices', client_id: row.client_id, row, attempts: 0 });

test('the capability table matches the schema', () => {
  assert.equal(supportsColumn('invoices', 'client_id'), false);
  assert.equal(supportsColumn('staff', 'client_updated_at'), false);
  assert.equal(supportsColumn('day_closes', 'client_id'), true);
  assert.equal(supportsColumn('day_closes', 'client_updated_at'), false);
  assert.equal(supportsColumn('patients', 'client_updated_at'), true);
  assert.deepEqual(CLIENT_STAMPED.sort(), ['appointments', 'consultations', 'patients']);
  assert.deepEqual(Object.keys(OFFLINE_COLUMNS).sort(), ['appointments', 'consultations', 'day_closes', 'invoices', 'patients', 'reminders', 'staff']);
});

test('creating an invoice never sends client_id', async () => {
  const db = fakeDb([], { columns: invoiceColumns });
  const { remaining, repaired, stopped } = await replayOutbox({ ops: [opInvoiceCreate()], db });
  assert.equal(stopped, null);
  assert.equal(remaining.length, 0);
  assert.equal(repaired.length, 0, 'nothing had to be repaired — the client left it out');
  const sent = db.calls.find((c) => c[0] === 'insert')[2];
  assert.equal('client_id' in sent, false);
  assert.equal(db.rows.get('inv-1').number, 'INV/2526/0007');
});

test('a replayed invoice create lands once, deduped by its own id', async () => {
  const db = fakeDb([], { columns: invoiceColumns });
  await replayOutbox({ ops: [opInvoiceCreate()], db });
  const second = await replayOutbox({ ops: [opInvoiceCreate()], db });
  assert.equal(second.remaining.length, 0);
  assert.equal(db.rows.size, 1, 'one invoice, not two');
  assert.ok(second.applied[0].deduped, 'the replay was recognised as already applied');
});

test('a patient create still carries client_id for cross-device dedupe', async () => {
  const db = fakeDb([], { columns: ['id', 'client_id', 'client_updated_at', 'clinic_id', 'code', 'full_name', 'phone'] });
  const row = { id: 'p9', client_id: 'c-p9', clinic_id: 'c1', code: 'PT-00009', full_name: 'Asha', phone: '9000000001' };
  await replayOutbox({ ops: [{ op_id: 'op-p9', type: 'create', table: 'patients', client_id: 'c-p9', row, attempts: 0 }], db });
  const sent = db.calls.find((c) => c[0] === 'insert')[2];
  assert.equal(sent.client_id, 'c-p9');
  assert.equal(db.rows.get('p9').full_name, 'Asha');
});

/* ------------------------------------------------- the account's own profile */

test('a profile edit with no row in the database creates the row instead of a conflict', async () => {
  // The live bug: an account created before the sign-up trigger had no row in
  // `profiles`, so its own save came back as "this record was deleted at the
  // clinic" — a deletion that never happened, on a row that is only ever its own.
  const db = fakeDb([]);                      // the profile row is missing
  const op = {
    op_id: 'op-prof', type: 'update', table: 'profiles', id: 'user-1',
    patch: { full_name: 'Dr. Rajesh Lande', theme: 'system' }, base: null, attempts: 0,
  };
  const { remaining, conflicts, applied } = await replayOutbox({ ops: [op], db });

  assert.equal(conflicts.length, 0, 'a missing profile row is not a conflict');
  assert.equal(remaining.length, 0, 'the queue is drained');
  assert.equal(applied.length, 1);
  assert.equal(applied[0].created, true, 'it was written as a new row');
  assert.equal(db.rows.get('user-1').full_name, 'Dr. Rajesh Lande');
  assert.equal(db.rows.get('user-1').theme, 'system');
});

test('the recreated profile row keeps the id the account is keyed by', async () => {
  const db = fakeDb([]);
  await replayOutbox({
    ops: [{
      op_id: 'op-prof2', type: 'update', table: 'profiles', id: 'user-42',
      patch: { full_name: 'Dr Rao', phone: '' }, base: null, attempts: 0,
    }],
    db,
  });
  assert.deepEqual([...db.rows.keys()], ['user-42']);
});

test('a missing row in any other table is still a deletion that needs a human', async () => {
  // The generous rule is for the account's own row only: a patient who was deleted
  // at the clinic must not be quietly resurrected by an offline edit.
  const db = fakeDb([]);
  const { conflicts, applied } = await replayOutbox({
    ops: [{ op_id: 'op-pat', type: 'update', table: 'patients', id: 'p-gone', patch: { notes: 'x' }, base: null, attempts: 0 }],
    db,
  });
  assert.equal(applied.length, 0);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].kind, 'deleted-remotely');
  assert.equal(conflicts[0].recordId, 'p-gone', 'the screen needs the id to offer "Recreate"');
  assert.equal(db.rows.size, 0, 'nothing was invented');
});
