/** Inert v2-only dynamic accessor. No stored client and NO legacy fallback.
 * Resolve immediately before every clinical operation, not at module load.
 * Previously returned clients/queries cannot be recalled; their token providers
 * must still enforce the controller epoch. Do not retain across workspaces.
 */
import { TenantAuthUnavailableError } from './tenant-client.mjs';

export function createWorkspaceClientBridge(controller) {
  if (typeof controller?.getSnapshot !== 'function' || typeof controller?.getClinicalClient !== 'function') {
    throw new TypeError('workspace controller required');
  }
  function getClient() {
    if (controller.getSnapshot()?.state !== 'READY') {
      throw new TenantAuthUnavailableError('workspace not ready');
    }
    const client = controller.getClinicalClient();
    if (!client) throw new TenantAuthUnavailableError('workspace client unavailable');
    return client;
  }
  return Object.freeze({ getClient });
}
