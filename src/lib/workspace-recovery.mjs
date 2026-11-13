/** Inert, explicit cleanup recovery. Not a replay/export/discard interface.
 * Auth verifies own subject; only own registered namespaces are inspected/cleaned.
 * All participants must use the same Web Lock and durable lifecycle fence.
 */
import { openWorkspacePersistence, WorkspaceStorageError } from './workspace-persistence.mjs';
import { WORKSPACE_LIFECYCLE_LOCK, readWorkspaceLifecycleMetadata, writeWorkspaceLifecycleMetadata } from './workspace-lifecycle.mjs';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (code) => new WorkspaceStorageError(code);

export function createWorkspaceRecovery({ masterClient, locks, metadataStorage, indexedDB,
  randomId = () => globalThis.crypto.randomUUID(), now = Date.now } = {}) {
  if (typeof masterClient?.auth?.getUser !== 'function' || typeof masterClient?.auth?.onAuthStateChange !== 'function') throw fail('RECOVERY_AUTH_REQUIRED');
  if (typeof locks?.request !== 'function' || typeof metadataStorage?.getItem !== 'function'
    || typeof metadataStorage?.setItem !== 'function') throw fail('LIFECYCLE_UNAVAILABLE');
  let generation = 0; let disposed = false; let review = null;
  const authListener = masterClient.auth.onAuthStateChange(() => { generation += 1; review = null; });
  async function authenticated() {
    const before = generation;
    if (disposed) throw fail('RECOVERY_CLOSED');
    let response;
    try { response = await masterClient.auth.getUser(); } catch { throw fail('RECOVERY_AUTH_REQUIRED'); }
    if (disposed || generation !== before || response?.error || !UUID.test(response?.data?.user?.id ?? '')) throw fail('RECOVERY_AUTH_REQUIRED');
    return { subject: response.data.user.id, generation };
  }
  function assertIdentity(identity) {
    if (disposed || generation !== identity.generation) throw fail('RECOVERY_IDENTITY_CHANGED');
  }
  async function verifyIdentity(identity) {
    assertIdentity(identity);
    const current = await authenticated();
    if (current.subject !== identity.subject || current.generation !== identity.generation) throw fail('RECOVERY_IDENTITY_CHANGED');
  }
  function blockedMeta() {
    const meta = readWorkspaceLifecycleMetadata(metadataStorage);
    if (!meta || !meta.blocked) throw fail('RECOVERY_NOT_BLOCKED');
    return meta;
  }
  function unchanged(meta) {
    if (JSON.stringify(blockedMeta()) !== JSON.stringify(meta)) throw fail('RECOVERY_STALE');
  }
  function openScope(scope, identity) {
    return openWorkspacePersistence({ lease: { ...scope, assertCurrent() { assertIdentity(identity); } }, indexedDB, now });
  }
  const locked = (fn) => locks.request(WORKSPACE_LIFECYCLE_LOCK, { mode: 'exclusive' }, fn);
  return Object.freeze({
    inspect() {
      return locked(async () => {
        review = null;
        const identity = await authenticated();
        const meta = blockedMeta();
        const own = meta.scopes.filter((scope) => scope.subject === identity.subject);
        const summaries = [];
        for (const scope of own) {
          await verifyIdentity(identity);
          let handle;
          let summary;
          try {
            handle = await openScope(scope, identity);
            const counts = await handle.inspectPending();
            summary = { workspaceId: scope.workspaceId, clinicId: scope.clinicId,
              pendingCount: counts.pendingCount, hasCache: counts.hasCache, status: 'INSPECTED' };
          } catch {
            summary = { workspaceId: scope.workspaceId, clinicId: scope.clinicId,
              pendingCount: null, hasCache: null, status: 'UNAVAILABLE' };
          } finally { handle?.close(); }
          await verifyIdentity(identity);
          summaries.push(Object.freeze(summary));
        }
        await verifyIdentity(identity); unchanged(meta);
        review = { ...identity, fingerprint: JSON.stringify(meta) };
        return Object.freeze({ expectedEpoch: meta.epoch, blocked: true,
          workspaces: Object.freeze(summaries), otherWorkspaceCount: meta.scopes.length - own.length });
      });
    },
    /** Caller must first show inspect() and explicitly confirm this same fence.
     * No override/discard/export option exists. Pending work remains blocked.
     */
    retryCleanup({ expectedEpoch, confirmRetry = false } = {}) {
      if (confirmRetry !== true || typeof expectedEpoch !== 'string' || !expectedEpoch) return Promise.reject(fail('RECOVERY_CONFIRMATION_REQUIRED'));
      return locked(async () => {
        const identity = await authenticated();
        const meta = blockedMeta();
        if (meta.epoch !== expectedEpoch) throw fail('RECOVERY_STALE');
        if (!review || review.subject !== identity.subject || review.generation !== identity.generation
          || review.fingerprint !== JSON.stringify(meta)) throw fail('RECOVERY_REVIEW_REQUIRED');
        review = null; // One explicit review authorizes one attempt only.
        const own = meta.scopes.filter((scope) => scope.subject === identity.subject);
        if (!own.length && meta.scopes.length) throw fail('RECOVERY_NO_OWN_SCOPES');
        const nextEpoch = randomId();
        if (typeof nextEpoch !== 'string' || !nextEpoch || nextEpoch === meta.epoch) throw fail('INVALID_FENCE_EPOCH');
        const fence = { ...meta, epoch: nextEpoch, blocked: true };
        await verifyIdentity(identity); unchanged(meta);
        writeWorkspaceLifecycleMetadata(metadataStorage, fence);
        const remaining = meta.scopes.filter((scope) => scope.subject !== identity.subject);
        let cleanedCount = 0; let pendingWorkspaceCount = 0; let failedWorkspaceCount = 0;
        for (const scope of own) {
          await verifyIdentity(identity);
          let handle;
          try {
            handle = await openScope(scope, identity);
            await handle.cleanup(); // Never passes discardPending.
            cleanedCount += 1;
          } catch (error) {
            remaining.push(scope);
            if (error?.code === 'PENDING_WRITES_RETAINED') pendingWorkspaceCount += 1;
            else failedWorkspaceCount += 1;
          } finally { handle?.close(); }
          await verifyIdentity(identity);
        }
        await verifyIdentity(identity); unchanged(fence);
        const blocked = remaining.length !== 0;
        writeWorkspaceLifecycleMetadata(metadataStorage, { ...fence, blocked, scopes: remaining });
        return Object.freeze({ status: blocked ? 'BLOCKED' : 'CLEARED', blocked, cleanedCount,
          remainingCount: remaining.length, pendingWorkspaceCount, failedWorkspaceCount,
          otherWorkspaceCount: meta.scopes.length - own.length });
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true; generation += 1;
      authListener?.data?.subscription?.unsubscribe?.();
    },
  });
}
