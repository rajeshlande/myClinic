/** Inert IndexedDB storage. No legacy import, automatic data migration or globals
 * at module evaluation. One physical database per verified user/workspace/clinic.
 * Plaintext same-origin storage, NOT encryption or protection from XSS.
 */
import { TenantAuthUnavailableError } from './tenant-client.mjs';
import { TABLES } from './offline.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STORE = 'workspace';
const KEY = 'state';
export const WORKSPACE_CACHE_TTL_MS = 86400000;
export class WorkspaceStorageError extends Error {
  constructor(code) { super(code); this.name = 'WorkspaceStorageError'; this.code = code; }
}
export function workspaceDatabaseName({ subject, workspaceId, clinicId } = {}) {
  const ids = [subject, workspaceId, clinicId];
  if (!ids.every((id) => typeof id === 'string' && UUID.test(id))) throw new WorkspaceStorageError('INVALID_SCOPE');
  return `myclinic-v2-${ids.map((id) => id.toLowerCase()).join('-')}`;
}

export async function openWorkspacePersistence({ lease, indexedDB = globalThis.indexedDB, now = Date.now,
  openTimeoutMs = 5000 } = {}) {
  if (typeof lease?.assertCurrent !== 'function') throw new WorkspaceStorageError('LEASE_REQUIRED');
  lease.assertCurrent();
  const scope = Object.freeze({ subject: lease.subject, workspaceId: lease.workspaceId, clinicId: lease.clinicId });
  const name = workspaceDatabaseName(scope);
  if (!indexedDB?.open || !Number.isFinite(openTimeoutMs) || openTimeoutMs <= 0) throw new WorkspaceStorageError('STORAGE_UNAVAILABLE');
  const clock = () => {
    const value = Number(now());
    if (!Number.isFinite(value) || value < 0) throw new WorkspaceStorageError('INVALID_CLOCK');
    return value;
  };
  const db = await new Promise((resolve, reject) => {
    let finished = false;
    const timer = setTimeout(() => fail('OPEN_TIMEOUT'), openTimeoutMs);
    function fail(code) { if (!finished) { finished = true; clearTimeout(timer); reject(new WorkspaceStorageError(code)); } }
    let req;
    try { req = indexedDB.open(name, 1); } catch { fail('OPEN_FAILED'); return; }
    req.onblocked = () => fail('OPEN_BLOCKED');
    req.onerror = () => fail('OPEN_FAILED');
    req.onupgradeneeded = () => {
      if (finished) { req.transaction.abort(); return; }
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      if (finished) { req.result.close(); return; }
      try { lease.assertCurrent(); } catch (error) { finished = true; clearTimeout(timer); req.result.close(); reject(error); return; }
      finished = true; clearTimeout(timer); resolve(req.result);
    };
  });
  let closed = false;
  function close() { closed = true; db.close(); }
  db.onversionchange = close;
  function blank() { return { version: 1, scope, revision: 0, cache: null, outbox: [] }; }
  function validateOutbox(outbox) {
    const ids = new Set();
    if (!Array.isArray(outbox) || outbox.some((op) => {
      if (!op || op.clinic_id !== scope.clinicId || !TABLES.includes(op.table)
        || !['create', 'update', 'delete'].includes(op.type) || typeof op.op_id !== 'string' || !op.op_id || ids.has(op.op_id)) return true;
      ids.add(op.op_id);
      if (op.type === 'create' && (!op.row?.id || op.row.clinic_id !== scope.clinicId)) return true;
      if (op.type !== 'create' && !op.id) return true;
      if (op.type === 'update' && (!op.patch || typeof op.patch !== 'object' || Array.isArray(op.patch))) return true;
      return [op.row, op.patch, op.base].some((row) => row && Object.hasOwn(row, 'clinic_id') && row.clinic_id !== scope.clinicId);
    })) throw new WorkspaceStorageError('INVALID_OUTBOX');
  }
  function validateConflicts(conflicts) {
    if (conflicts === undefined) return;
    const ids = new Set();
    if (!Array.isArray(conflicts)) throw new WorkspaceStorageError('INVALID_CONFLICTS');
    for (const conflict of conflicts) {
      if (!conflict || typeof conflict.id !== 'string' || !conflict.id || ids.has(conflict.id)
        || conflict.clinic_id !== scope.clinicId || !TABLES.includes(conflict.table)
        || conflict.opId !== conflict.sourceOp?.op_id || conflict.table !== conflict.sourceOp?.table
        || (conflict.remote?.clinic_id && conflict.remote.clinic_id !== scope.clinicId)) throw new WorkspaceStorageError('INVALID_CONFLICTS');
      validateOutbox([conflict.sourceOp]); ids.add(conflict.id);
    }
  }
  function validate(record) {
    if (record === undefined) return blank();
    if (![1, 2].includes(record?.version) || (record.version === 1 && record.conflicts !== undefined)
      || (record.version === 2 && !Array.isArray(record.conflicts)) || !Number.isSafeInteger(record.revision) || record.revision < 0
      || !Array.isArray(record.outbox) || record.scope?.subject !== scope.subject
      || record.scope?.workspaceId !== scope.workspaceId || record.scope?.clinicId !== scope.clinicId) {
      throw new WorkspaceStorageError('CORRUPT_RECORD');
    }
    if (record.cache !== null && (!record.cache || !Number.isFinite(record.cache.savedAt)
      || !Number.isFinite(record.cache.expiresAt) || record.cache.expiresAt <= record.cache.savedAt
      || record.cache.state?.clinic?.id !== scope.clinicId)) throw new WorkspaceStorageError('CORRUPT_CACHE');
    validateOutbox(record.outbox);
    validateConflicts(record.conflicts);
    return record;
  }
  function transaction({ write = false, cleanup = false, transform }) {
    if (closed) return Promise.reject(new WorkspaceStorageError('STORAGE_CLOSED'));
    if (!cleanup) { try { lease.assertCurrent(); } catch (e) { return Promise.reject(e); } }
    return new Promise((resolve, reject) => {
      let tx; let failure; let result;
      try { tx = db.transaction(STORE, write ? 'readwrite' : 'readonly'); }
      catch { reject(new WorkspaceStorageError('TRANSACTION_FAILED')); return; }
      function abort(error) { failure = error; try { tx.abort(); } catch { /* already complete */ } }
      tx.onabort = () => reject(failure ?? new WorkspaceStorageError('TRANSACTION_ABORTED'));
      tx.onerror = () => { failure ??= new WorkspaceStorageError('TRANSACTION_FAILED'); };
      tx.oncomplete = () => {
        try { if (!cleanup) lease.assertCurrent(); resolve(result); } catch (e) { reject(e); }
      };
      const store = tx.objectStore(STORE);
      const request = store.get(KEY);
      request.onsuccess = () => {
        try {
          if (!cleanup) lease.assertCurrent();
          const record = validate(request.result);
          const next = transform(record);
          result = next.result;
          if (write && next.record !== undefined) {
            if (!cleanup) lease.assertCurrent();
            store.put(next.record, KEY);
          }
        } catch (e) { abort(e); }
      };
    });
  }
  return Object.freeze({
    name, close,
    /** Recovery summary only: readonly, no patient payload or TTL mutation. */
    inspectPending() {
      return transaction({ transform(record) {
        return { result: { revision: record.revision, pendingCount: record.outbox.length + (record.conflicts?.length ?? 0), hasCache: record.cache !== null } };
      } });
    },
    read() {
      return transaction({ write: true, transform(record) {
        const at = clock();
        const expired = record.cache && (record.cache.savedAt > at || record.cache.expiresAt <= at);
        if (expired && record.revision === Number.MAX_SAFE_INTEGER) throw new WorkspaceStorageError('REVISION_EXHAUSTED');
        const next = expired ? { ...record, revision: record.revision + 1, cache: null } : record;
        return { record: expired ? next : undefined, result: { revision: next.revision,
          cache: next.cache?.state ?? null, outbox: next.outbox,
          ...(next.conflicts === undefined ? {} : { conflicts: next.conflicts }) } };
      } });
    },
    /** Atomic cache+queue CAS prevents one tab/flush overwriting a newer append.
     * Callers must retain and retry from the latest revision on REVISION_CONFLICT.
     */
    commit({ expectedRevision, cache, outbox, conflicts } = {}) {
      // Capture inputs NOW, not later when a queued transaction gets its turn.
      try { ({ expectedRevision, cache, outbox, conflicts } = structuredClone({ expectedRevision, cache, outbox, conflicts })); }
      catch { return Promise.reject(new WorkspaceStorageError('UNCLONEABLE_WRITE')); }
      return transaction({ write: true, transform(record) {
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== record.revision) throw new WorkspaceStorageError('REVISION_CONFLICT');
        if (record.revision === Number.MAX_SAFE_INTEGER) throw new WorkspaceStorageError('REVISION_EXHAUSTED');
        const next = { ...record, revision: record.revision + 1 };
        if (cache !== undefined) {
          if (cache !== null && cache?.clinic?.id !== scope.clinicId) throw new TenantAuthUnavailableError('cache clinic mismatch');
          const at = clock();
          next.cache = cache === null ? null : { state: cache, savedAt: at, expiresAt: at + WORKSPACE_CACHE_TTL_MS };
        }
        if (outbox !== undefined) {
          validateOutbox(outbox);
          next.outbox = outbox;
        }
        if (conflicts !== undefined) { validateConflicts(conflicts); next.version = 2; next.conflicts = conflicts; }
        return { record: next, result: next.revision };
      } });
    },
    /** Cleanup is allowed on an expired lease, but only for THIS held namespace.
     * Pending PHI is retained and reported as failure unless explicitly discarded.
     * Caller MUST block reactivation if cleanup fails. Never silently drop work.
     */
    async cleanup({ discardPending = false } = {}) {
      try {
        const pending = await transaction({ write: true, cleanup: true, transform(record) {
          const count = record.outbox.length + (record.conflicts?.length ?? 0);
          if (record.revision === Number.MAX_SAFE_INTEGER) throw new WorkspaceStorageError('REVISION_EXHAUSTED');
          return { record: { ...record, revision: record.revision + 1, cache: null,
            outbox: discardPending === true ? [] : record.outbox,
            ...(record.conflicts === undefined ? {} : { conflicts: discardPending === true ? [] : record.conflicts }) }, result: discardPending === true ? 0 : count };
        } });
        if (pending) throw new WorkspaceStorageError('PENDING_WRITES_RETAINED');
      } finally { close(); }
    },
  });
}
