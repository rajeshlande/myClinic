/** Inert origin-wide lifecycle fence. Every v2 storage operation MUST use this
 * facade; direct persistence handles/legacy tabs do not participate.
 * Web Locks serialize operations and cleanup; localStorage stores IDs/fence only.
 * No PHI, tokens, network activity, migration or global access at module import.
 */
import { openWorkspacePersistence, workspaceDatabaseName, WorkspaceStorageError } from './workspace-persistence.mjs';

export const WORKSPACE_LIFECYCLE_KEY = 'myclinic.v2.lifecycle.v1';
export const WORKSPACE_LIFECYCLE_LOCK = 'myclinic-v2-storage-lifecycle';
const MAX_SCOPES = 100;
const fail = (code) => new WorkspaceStorageError(code);

export function readWorkspaceLifecycleMetadata(metadataStorage) {
  let raw;
  try { raw = metadataStorage.getItem(WORKSPACE_LIFECYCLE_KEY); } catch { throw fail('FENCE_READ_FAILED'); }
  if (raw === null) return null;
  let value;
  try { value = JSON.parse(raw); } catch { throw fail('CORRUPT_FENCE'); }
  if (value?.version !== 1 || typeof value.epoch !== 'string' || !value.epoch || typeof value.blocked !== 'boolean'
    || !Array.isArray(value.scopes) || value.scopes.length > MAX_SCOPES) throw fail('CORRUPT_FENCE');
  try {
    const names = value.scopes.map(workspaceDatabaseName);
    if (new Set(names).size !== names.length) throw new Error('duplicates');
  } catch { throw fail('CORRUPT_FENCE'); }
  return value;
}
export function writeWorkspaceLifecycleMetadata(metadataStorage, value) {
  try { metadataStorage.setItem(WORKSPACE_LIFECYCLE_KEY, JSON.stringify(value)); } catch { throw fail('FENCE_WRITE_FAILED'); }
}

export function createWorkspaceLifecycle({ locks, metadataStorage, indexedDB, eventTarget = null,
  onInvalidate = () => {}, randomId = () => globalThis.crypto.randomUUID(), now = Date.now } = {}) {
  if (typeof locks?.request !== 'function' || typeof metadataStorage?.getItem !== 'function'
    || typeof metadataStorage?.setItem !== 'function') throw fail('LIFECYCLE_UNAVAILABLE');
  let epoch = null; let invalidated = false; let notified = false; let leaving = null;
  const handles = new Set();
  function invalidate() {
    invalidated = true;
    for (const handle of handles) handle.close();
    handles.clear();
    if (!notified) {
      notified = true;
      try { Promise.resolve(onInvalidate()).catch(() => {}); } catch { /* storage fence remains authoritative */ }
    }
  }
  const readMeta = () => readWorkspaceLifecycleMetadata(metadataStorage);
  const writeMeta = (value) => writeWorkspaceLifecycleMetadata(metadataStorage, value);
  function freshEpoch(previous = null) {
    const next = randomId();
    if (typeof next !== 'string' || !next || next === previous) throw fail('INVALID_FENCE_EPOCH');
    return next;
  }
  async function locked(fn) {
    return locks.request(WORKSPACE_LIFECYCLE_LOCK, { mode: 'exclusive' }, fn);
  }
  function check(meta) {
    if (invalidated || !meta || meta.blocked || (epoch !== null && meta.epoch !== epoch)) {
      invalidate(); throw fail('LIFECYCLE_BLOCKED');
    }
  }
  function storageEvent(event) {
    if (event.key !== WORKSPACE_LIFECYCLE_KEY && event.key !== null) return;
    if (epoch === null || invalidated) return;
    try { check(readMeta()); } catch { invalidate(); }
  }
  eventTarget?.addEventListener?.('storage', storageEvent);

  return Object.freeze({
    async open(lease) {
      if (invalidated) throw fail('LIFECYCLE_BLOCKED');
      lease?.assertCurrent?.();
      if (typeof lease?.assertCurrent !== 'function') throw fail('LEASE_REQUIRED');
      const scope = { subject: lease.subject, workspaceId: lease.workspaceId, clinicId: lease.clinicId };
      const name = workspaceDatabaseName(scope);
      return locked(async () => {
        lease.assertCurrent();
        let meta = readMeta();
        if (!meta && epoch === null && !invalidated) {
          meta = { version: 1, epoch: freshEpoch(), blocked: false, scopes: [] };
          writeMeta(meta);
        }
        check(meta);
        epoch ??= meta.epoch;
        if (!meta.scopes.some((s) => workspaceDatabaseName(s) === name)) {
          if (meta.scopes.length >= MAX_SCOPES) throw fail('SCOPE_REGISTRY_FULL');
          meta = { ...meta, scopes: [...meta.scopes, scope] };
          // Record BEFORE opening/writing PHI, so a crash cannot orphan a new DB.
          writeMeta(meta);
        }
        const handle = await openWorkspacePersistence({ lease, indexedDB, now });
        try { check(readMeta()); lease.assertCurrent(); } catch (error) { handle.close(); throw error; }
        handles.add(handle);
        let closed = false;
        async function access(method, value) {
          if (closed) throw fail('STORAGE_CLOSED');
          return locked(async () => {
            try {
              check(readMeta()); lease.assertCurrent();
              const result = await handle[method](value);
              check(readMeta()); lease.assertCurrent();
              return result;
            } catch (error) {
              // Fence/metadata errors block this coordinator; revision/validation
              // errors can be reconciled by the still-current workspace caller.
              if (['FENCE_READ_FAILED', 'CORRUPT_FENCE', 'LIFECYCLE_BLOCKED'].includes(error?.code)) invalidate();
              throw error;
            }
          });
        }
        return Object.freeze({ name,
          read: () => access('read'),
          commit(value) {
            // Capture before waiting for the origin-wide Web Lock.
            let copy;
            try { copy = structuredClone(value); } catch { return Promise.reject(fail('UNCLONEABLE_WRITE')); }
            return access('commit', copy);
          },
          close() { closed = true; handle.close(); handles.delete(handle); },
        });
      });
    },
    /** No discard option. Pending work is retained and the durable blocked fence
     * remains. Future recovery must be explicit, not a new coordinator instance.
     */
    cleanup() {
      if (leaving) return leaving;
      invalidate();
      leaving = locked(async () => {
        const old = readMeta();
        if (!old) {
          if (epoch !== null) throw fail('CORRUPT_FENCE');
          return;
        }
        if (epoch === null) return; // This coordinator never owned a workspace.
        if (old.epoch !== epoch) throw fail('LIFECYCLE_BLOCKED'); // Never erase a newer login.
        const fence = { ...old, epoch: freshEpoch(old.epoch), blocked: true };
        writeMeta(fence); // Must succeed BEFORE any cleanup or cross-tab success.
        const failed = [];
        for (const scope of fence.scopes) {
          try {
            // Cleanup-only scope from the registry, not an authenticated clinical
            // lease. No read/commit/network result escapes this private handle.
            const handle = await openWorkspacePersistence({ lease: { ...scope, assertCurrent() {} }, indexedDB, now });
            await handle.cleanup();
          } catch { failed.push(scope); }
        }
        if (failed.length) throw fail('LIFECYCLE_CLEANUP_INCOMPLETE');
        writeMeta({ ...fence, blocked: false, scopes: [] });
      });
      return leaving;
    },
    /** Close local handles/listener only; NOT logout, purge or cross-tab revoke. */
    dispose() {
      invalidate();
      eventTarget?.removeEventListener?.('storage', storageEvent);
    },
  });
}
