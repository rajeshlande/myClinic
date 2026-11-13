import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import { createWorkspaceClientBridge } from '../lib/workspace-client-bridge.mjs';
import WorkspacePicker from './WorkspacePicker.jsx';
import { TenantAuthUnavailableError } from '../lib/tenant-client.mjs';

const WorkspaceContext = createContext(null);

/** Staged v2 boundary. Caller owns controller boot/disposal and Master login.
 * No effect creates/disposes a controller: safe for React StrictMode replay.
 * NEVER place the existing legacy StoreProvider beneath this until its client
 * and PHI-cache boundaries are migrated. Not imported by the live App/router.
 */
export default function WorkspaceGate({ controller, children }) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  if (snapshot.state !== 'READY') {
    return <WorkspacePicker snapshot={snapshot} onChoose={controller.select}
      onReload={controller.boot} onLogout={controller.logout} />;
  }
  // Changing workspace remounts descendants, preventing reuse of UI state.
  // This is not IndexedDB deletion or cancellation of already-issued requests.
  return (
    <WorkspaceContext.Provider key={snapshot.selectedWorkspaceId} value={controller}>
      {children}
    </WorkspaceContext.Provider>
  );
}

/** Returns an accessor, not a captured client. Call immediately per operation. */
export function useWorkspaceClient() {
  const controller = useContext(WorkspaceContext);
  const bridge = useMemo(() => controller ? createWorkspaceClientBridge(controller) : null, [controller]);
  if (!bridge) throw new TenantAuthUnavailableError('workspace boundary required');
  return bridge.getClient;
}
