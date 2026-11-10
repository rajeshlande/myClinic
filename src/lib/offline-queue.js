/**
 * The outbox flush loop's moving parts, out of the provider.
 *
 * `offline.js` already owns the queue itself — the keys, the TTL, `enqueue`,
 * `backoffMs`, `classifySyncError` and the pure `replayOutbox`. What stayed inside
 * `store.jsx` was the part that touches React and Supabase: the concrete database
 * adapter, the clock, and the three-way decision of whether this tick should flush
 * at all. This module is that piece, and it takes the client as an argument rather
 * than importing it, so the whole loop can be exercised with a fake database.
 *
 * Nothing here holds state. `store.jsx` still owns `flushing`, `pending` and
 * `syncState`; it asks these functions what to do next.
 */

/** How often a live workspace retries the outbox while it is online. */
export const FLUSH_INTERVAL_MS = 20000;

/**
 * Should this tick flush?
 *
 * Four conditions used to be four early returns inline, two of which also set the
 * sync pill. Returned as a decision instead, so the reason is nameable and the
 * pill's value is part of the answer rather than a side effect of a guard.
 *
 * `state` is what the pill should say, or `undefined` when it should not change:
 * a demo workspace and a flush already in flight have nothing to report.
 */
export function flushGuard({ mode, userId, online, flushing, queued }) {
  if (mode !== 'live' || !userId) return { skip: true, reason: 'not-live' };
  if (flushing) return { skip: true, reason: 'in-flight' };
  if (!online) return { skip: true, reason: 'offline', state: 'offline' };
  if (!queued) return { skip: true, reason: 'nothing-queued', state: 'idle' };
  return { skip: false, reason: 'flush' };
}

/**
 * What the sync pill says after a replay.
 *
 * `replayOutbox` stops for two different reasons and they read differently to a
 * person: `retry` means "the network is not there yet", anything else means "this
 * write was refused". Anything that did not stop completed, so the pill goes idle.
 */
export function syncStateAfterFlush({ stopped = null } = {}) {
  if (!stopped) return 'idle';
  return stopped.verdict === 'retry' ? 'offline' : 'error';
}

/**
 * The database adapter `replayOutbox` needs, built around a Supabase client.
 *
 * Moved verbatim out of the provider. `selectOne` is used for the duplicate check
 * that makes a replayed create idempotent: the row may already be there by `id`
 * (a server round trip that lost its answer) or by `client_id` (written from
 * another device), so it looks up whichever the op carries — and `PGRST116`
 * ("no rows") is the answer "not there yet", not an error.
 */
export function supabaseOutboxDb(client) {
  if (!client?.from) throw new Error('supabaseOutboxDb needs a Supabase client');
  return {
    async selectOne(table, filter) {
      let q = client.from(table).select('*');
      q = filter.id ? q.eq('id', filter.id) : q.eq('client_id', filter.client_id);
      const { data, error } = await q.maybeSingle();
      if (error && error.code !== 'PGRST116') throw error;
      return data ?? null;
    },
    async insert(table, row) {
      const { data, error } = await client.from(table).insert(row).select().single();
      if (error) throw error;
      return data;
    },
    async update(table, id, patch) {
      const { data, error } = await client.from(table).update(patch).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    async remove(table, id) {
      const { error } = await client.from(table).delete().eq('id', id);
      if (error && error.code !== 'PGRST116') throw error;
    },
  };
}
