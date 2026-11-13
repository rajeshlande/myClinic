/** Staged v2 operation leases. Never imports a static client or persists PHI.
 * A rejected stale result does NOT roll back a server mutation already sent.
 */
import { TenantAuthUnavailableError } from './tenant-client.mjs';

export function createWorkspaceOperations(controller) {
  if (typeof controller?.getSnapshot !== 'function' || typeof controller?.getClinicalClient !== 'function') {
    throw new TypeError('workspace controller required');
  }
  function lease() {
    const snapshot = controller.getSnapshot();
    const row = snapshot?.workspaces?.find((w) => w.workspace_id === snapshot.selectedWorkspaceId);
    if (snapshot?.state !== 'READY' || !row?.clinic_id) throw new TenantAuthUnavailableError('workspace not ready');
    const client = controller.getClinicalClient();
    const scope = controller.getPersistenceScope?.();
    if (scope && (scope.clinicId !== row.clinic_id || scope.workspaceId !== row.workspace_id)) {
      throw new TenantAuthUnavailableError('workspace scope mismatch');
    }
    function assertCurrent() {
      if (controller.getSnapshot() !== snapshot || controller.getClinicalClient() !== client) {
        throw new TenantAuthUnavailableError('workspace operation expired');
      }
    }
    assertCurrent();
    return Object.freeze({
      subject: scope?.subject ?? null,
      memberRole: row.member_role ?? null,
      licence: row.licence ?? null,
      clinicId: row.clinic_id,
      workspaceId: row.workspace_id,
      assertCurrent,
      async run(operation) {
        assertCurrent();
        try {
          const result = await operation(client);
          assertCurrent();
          return result;
        } catch (error) {
          // Never hand an old workspace's error/result to a new workspace.
          assertCurrent();
          throw error;
        }
      },
    });
  }
  return Object.freeze({ lease });
}
