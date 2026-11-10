import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  FLUSH_INTERVAL_MS, flushGuard, supabaseOutboxDb, syncStateAfterFlush,
} from '../src/lib/offline-queue.js';

/**
 * The outbox flush loop, out of the provider.
 *
 * `offline.js` was already pure and already tested; the untested part was the
 * Supabase adapter and the decision of whether to flush at all, because both were
 * written inline in `store.jsx` where nothing could reach them. v1.31.0 moved them
 * here, so these tests are about two promises: the adapter sends exactly the call
 * the old inline code sent (a replayed create stays idempotent), and the four
 * guards still answer what the sync pill used to be told.
 */

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

/** A fake PostgREST: records the calls it receives and answers with `result`. */
function fakeClient(result = { data: null, error: null }) {
  const calls = [];
  const query = (kind, table, payload) => {
    const q = {
      select: (...a) => { calls.push([kind, table, 'select', ...a]); return q; },
      insert: (row) => { calls.push([kind, table, 'insert', row]); return q; },
      update: (patch) => { calls.push([kind, table, 'update', patch]); return q; },
      delete: () => { calls.push([kind, table, 'delete']); return q; },
      eq: (col, value) => { calls.push([kind, table, 'eq', col, value]); return q; },
      maybeSingle: () => { calls.push([kind, table, 'maybeSingle']); return Promise.resolve(result); },
      // `delete()` is awaited directly, so the builder has to be thenable the way
      // a real PostgREST builder is
      then: (res, rej) => Promise.resolve(result).then(res, rej),
      single: () => { calls.push([kind, table, 'single']); return Promise.resolve(result); },
    };
    if (payload !== undefined) calls.push([kind, table, 'payload', payload]);
    return q;
  };
  return {
    calls,
    from(table) {
      const q = query('from', table);
      return {
        select: (...a) => q.select(...a),
        insert: (row) => q.insert(row),
        update: (patch) => q.update(patch),
        delete: () => q.delete(),
      };
    },
  };
}

/* ------------------------------------------------------------------- guards */

test('the flush is skipped for the four reasons it always was', () => {
  const live = { mode: 'live', userId: 'u1', online: true, flushing: false, queued: 1 };
  assert.deepEqual(flushGuard(live), { skip: false, reason: 'flush' });

  // a demo workspace has no outbox and must not touch the pill
  assert.deepEqual(flushGuard({ ...live, mode: 'demo' }), { skip: true, reason: 'not-live' });
  // signed out: same
  assert.deepEqual(flushGuard({ ...live, userId: null }), { skip: true, reason: 'not-live' });
  // a flush already running is not re-entered
  assert.deepEqual(flushGuard({ ...live, flushing: true }), { skip: true, reason: 'in-flight' });
  // offline is the one guard that reports itself
  assert.deepEqual(flushGuard({ ...live, online: false }), { skip: true, reason: 'offline', state: 'offline' });
  // nothing queued clears a stale pill
  assert.deepEqual(flushGuard({ ...live, queued: 0 }), { skip: true, reason: 'nothing-queued', state: 'idle' });
});

test('a skipped flush only ever sets the pill for the two reasons that mean something', () => {
  const live = { mode: 'live', userId: 'u1', online: true, flushing: false, queued: 1 };
  const states = [
    flushGuard({ ...live, mode: 'demo' }), flushGuard({ ...live, userId: null }),
    flushGuard({ ...live, flushing: true }), flushGuard({ ...live, mode: 'demo', online: false }),
  ].map((g) => g.state);
  assert.deepEqual(states, [undefined, undefined, undefined, undefined]);
});

test('the pill after a replay separates "not yet" from "refused"', () => {
  assert.equal(syncStateAfterFlush(), 'idle');
  assert.equal(syncStateAfterFlush({}), 'idle');
  assert.equal(syncStateAfterFlush({ stopped: null }), 'idle');
  // a retry verdict means the network is not there yet: that is offline, not an error
  assert.equal(syncStateAfterFlush({ stopped: { verdict: 'retry' } }), 'offline');
  // anything else — rejected, conflict, a refused write — is an error the person can act on
  assert.equal(syncStateAfterFlush({ stopped: { verdict: 'rejected' } }), 'error');
  assert.equal(syncStateAfterFlush({ stopped: { verdict: 'conflict' } }), 'error');
});

test('the retry interval is the twenty seconds the app has always used', () => {
  assert.equal(FLUSH_INTERVAL_MS, 20000);
  // and it is shorter than the cache TTL, or a queue would outlive the data it replays
  const offline = read('../src/lib/offline.js');
  assert.match(offline, /CACHE_TTL_MS = 24 \* 60 \* 60 \* 1000/);
  assert.ok(FLUSH_INTERVAL_MS < 24 * 60 * 60 * 1000);
});

/* ------------------------------------------------------------------ adapter */

test('selectOne looks a row up by id or by client_id, and treats "no rows" as absent', async () => {
  const byId = fakeClient({ data: { id: 'r1' }, error: null });
  assert.deepEqual(await supabaseOutboxDb(byId).selectOne('patients', { id: 'r1' }), { id: 'r1' });
  assert.ok(byId.calls.some((c) => c[2] === 'eq' && c[3] === 'id' && c[4] === 'r1'));

  const byClient = fakeClient({ data: { client_id: 'c1' }, error: null });
  assert.deepEqual(await supabaseOutboxDb(byClient).selectOne('patients', { client_id: 'c1' }), { client_id: 'c1' });
  assert.ok(byClient.calls.some((c) => c[2] === 'eq' && c[3] === 'client_id' && c[4] === 'c1'));

  // PGRST116 is "no rows", which is the answer "not there yet" — not a failure
  const none = fakeClient({ data: null, error: { code: 'PGRST116', message: 'no rows' } });
  assert.equal(await supabaseOutboxDb(none).selectOne('patients', { id: 'missing' }), null);

  // any other error is a real one and must reach the caller
  const broken = fakeClient({ data: null, error: { code: '42501', message: 'permission denied' } });
  // PostgREST errors are plain objects, not Error instances — the adapter throws
  // them unchanged, so the code is what a caller can branch on
  await assert.rejects(() => supabaseOutboxDb(broken).selectOne('patients', { id: 'x' }), (e) => e.code === '42501');
});

test('insert and update hand back the row the server wrote, and throw on refusal', async () => {
  const ok = fakeClient({ data: { id: 'new' }, error: null });
  const db = supabaseOutboxDb(ok);
  assert.deepEqual(await db.insert('patients', { full_name: 'Asha' }), { id: 'new' });
  assert.deepEqual(await db.update('patients', 'new', { full_name: 'Asha R' }), { id: 'new' });
  assert.ok(ok.calls.some((c) => c[2] === 'insert' && c[3].full_name === 'Asha'));
  assert.ok(ok.calls.some((c) => c[2] === 'update' && c[3].full_name === 'Asha R'));
  assert.ok(ok.calls.some((c) => c[2] === 'eq' && c[3] === 'id' && c[4] === 'new'));

  for (const method of ['insert', 'update']) {
    const refused = fakeClient({ data: null, error: { code: '23505', message: 'duplicate key' } });
    const d = supabaseOutboxDb(refused);
    await assert.rejects(() => (method === 'insert' ? d.insert('patients', {}) : d.update('patients', 'x', {})), (e) => e.code === '23505');
  }
});

test('remove is idempotent: a row that is already gone is not an error', async () => {
  const gone = fakeClient({ error: { code: 'PGRST116', message: 'no rows' } });
  await supabaseOutboxDb(gone).remove('patients', 'r1');     // must not throw
  assert.ok(gone.calls.some((c) => c[2] === 'delete'));

  const refused = fakeClient({ error: { code: '42501', message: 'permission denied' } });
  await assert.rejects(() => supabaseOutboxDb(refused).remove('patients', 'r1'), (e) => e.code === '42501');
});

test('the adapter refuses to be built without a client instead of failing on first use', () => {
  assert.throws(() => supabaseOutboxDb(), /needs a Supabase client/);
  assert.throws(() => supabaseOutboxDb({}), /needs a Supabase client/);
});

/* ------------------------------------------------------------------ ratchet */

test('the queue no longer lives inline in the provider', () => {
  const store = read('../src/lib/store.jsx');
  const queue = read('../src/lib/offline-queue.js');
  // the adapter's shape belongs to one file now: store must not build one
  assert.doesNotMatch(store, /from\(table\)\.insert\(/, 'store.jsx still builds an insert call inline');
  // the outbox's "no rows is not an error" rule is the adapter's, not the page's
  assert.doesNotMatch(store, /PGRST116/, 'store.jsx still special-cases the outbox lookup');
  assert.match(queue, /export function supabaseOutboxDb\(client\)/);
  // dependency inversion: the module takes the client, it does not import one
  assert.doesNotMatch(queue, /import .*supabase/);
  assert.doesNotMatch(queue, /from '\.\/store\.jsx'/);
  // and the decisions are used, not merely exported
  assert.match(store, /flushGuard\(\{/);
  assert.match(store, /syncStateAfterFlush\(\{ stopped \}\)/);
  assert.match(store, /FLUSH_INTERVAL_MS/);
  // The adapter takes a client, and the demo build has none: building it eagerly
  // threw on the first render of a workspace with no Supabase project, which the
  // provider smoke in tools/store-provider-smoke reproduces and the build cannot see.
  assert.match(store, /supabase \? supabaseOutboxDb\(supabase\) : null/, 'the adapter must be built only when a client exists');
  assert.match(store, /if \(!outboxDb\) return;/, 'a flush with no adapter must return instead of throwing');
  // the provider may not grow back past where this sub-release left it
  const lines = store.replace(/\n$/, '').split('\n').length;
  assert.ok(lines < 1150, `store.jsx is ${lines} lines — the split has been undone`);
});
