/** Inert v2 flush. Network replay is NOT atomic with local acknowledgement.
 * A failed/stale/CAS-conflicting acknowledgement leaves the durable queue intact.
 * Already-sent server writes must be reconciled idempotently on a later attempt.
 */
import { replayOutbox } from './offline.js';
import { createWorkspaceOutboxDb } from './workspace-outbox.mjs';
import { workspaceDatabaseName, WorkspaceStorageError } from './workspace-persistence.mjs';
const fail = (code) => new WorkspaceStorageError(code);

export async function flushWorkspaceOutbox({ lease, persistence, locks, now = Date.now } = {}) {
  if (typeof lease?.assertCurrent !== 'function' || typeof lease?.run !== 'function'
    || typeof persistence?.read !== 'function' || typeof persistence?.commit !== 'function'
    || typeof locks?.request !== 'function') throw fail('REPLAY_UNAVAILABLE');
  lease.assertCurrent();
  if (persistence.name !== workspaceDatabaseName(lease)) throw fail('REPLAY_SCOPE_MISMATCH');
  return locks.request(`myclinic-v2-replay-${persistence.name}`, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
    if (!lock) return Object.freeze({ status: 'BUSY' });
    lease.assertCurrent();
    const initial = await persistence.read(); lease.assertCurrent();
    if(initial.conflicts?.length)return Object.freeze({status:'BLOCKED_CONFLICTS',conflictCount:initial.conflicts.length,remainingCount:initial.outbox.length});
    const at = Number(now());
    if (!Number.isFinite(at) || at < 0) throw fail('INVALID_CLOCK');
    // FIFO: don't skip a backed-off head and replay dependent operations later.
    const batch = [];
    for (const op of initial.outbox.slice(0, 50)) {
      if (op.next_attempt_at !== undefined && !Number.isFinite(op.next_attempt_at)) throw fail('INVALID_BACKOFF');
      if (op.next_attempt_at > at) break;
      batch.push(op);
    }
    if (!batch.length) return Object.freeze({ status: initial.outbox.length ? 'BACKOFF' : 'IDLE' });
    const db = createWorkspaceOutboxDb(lease); let aborted = null;
    const guarded = {};
    for (const method of ['selectOne', 'insert', 'update', 'remove']) {
      guarded[method] = async (...args) => {
        if (aborted) throw aborted;
        try {
          lease.assertCurrent();
          // Storage fence and revision checked before EACH remote operation.
          const current = await persistence.read(); lease.assertCurrent();
          if (current.revision !== initial.revision) throw fail('REPLAY_ACK_CONFLICT');
        } catch (error) { aborted = error; throw error; }
        try { return await db[method](...args); }
        catch (error) {
          // The legacy engine must not convert stale/auth denial into a conflict
          // and remove the queued item. Ordinary server errors retain its policy.
          if (error?.code === 'TENANT_AUTH_UNAVAILABLE' || error?.code === 'TENANT_TOKEN_INVALID') aborted = error;
          throw error;
        }
      };
    }
    // The legacy engine intentionally drains past conflicts. Staged v2 cannot:
    // later optimistic bases may depend on the rejected row/earlier local state.
    // Invoke it one source at a time, retaining the unattempted FIFO tail exactly.
    const replay={remaining:[],conflicts:[],applied:[],stopped:null};
    for(let i=0;i<batch.length;i++){
      const one=await replayOutbox({ops:[batch[i]],db:guarded,now:()=>new Date(Number(now())).toISOString()});
      if(aborted)throw aborted;
      replay.applied.push(...one.applied);replay.conflicts.push(...one.conflicts);
      if(one.stopped||one.conflicts.length||one.remaining.length){
        replay.stopped=one.stopped;
        replay.remaining=[...one.remaining,...batch.slice(i+1)];
        break;
      }
    }
    if (aborted) throw aborted;
    lease.assertCurrent();
    const source = new Map(batch.map((op) => [op.op_id, op]));
    const conflicts = new Map((initial.conflicts ?? []).map((entry) => [entry.id, entry]));
    for (const entry of replay.conflicts) {
      const sourceOp = source.get(entry.opId);
      if (!sourceOp) throw fail('REPLAY_CONFLICT_SOURCE_MISSING');
      if (conflicts.has(entry.id)) throw fail('REPLAY_CONFLICT_ID_COLLISION');
      conflicts.set(entry.id, { ...entry, clinic_id: lease.clinicId, sourceOp,
        ...(entry.message === undefined ? {} : { message: 'The queued change requires review.' }) });
    }
    // Invalidate the snapshot instead of merging potentially stale optimistic UI.
    // Queue, complete unresolved source ops and cache invalidation commit together.
    try {
      await persistence.commit({ expectedRevision: initial.revision, cache: null,
        outbox: [...replay.remaining, ...initial.outbox.slice(batch.length)], conflicts: [...conflicts.values()] });
    } catch (error) {
      if (error?.code === 'REVISION_CONFLICT') throw fail('REPLAY_ACK_CONFLICT');
      throw error;
    }
    lease.assertCurrent();
    return Object.freeze({ status: replay.conflicts.length ? 'NEEDS_REVIEW' : replay.stopped ? 'STOPPED' : 'ACKNOWLEDGED',
      appliedCount: replay.applied.length, newConflictCount: replay.conflicts.length,
      remainingCount: replay.remaining.length + initial.outbox.length - batch.length,
      conflictCount: conflicts.size });
  });
}
