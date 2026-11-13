/** Inert v2 controller. Inject ONE Master client and the clinical mount adapter.
 * No client is created, no Auth called and no storage read until explicitly used.
 * No token/client is exposed in view snapshots. No legacy clinical fallback.
 */
import { createTokenGate, TENANT_STATES, TenantAuthUnavailableError, WORKSPACE_POINTER_KEY } from './tenant-client.mjs';
import { parseBootResponse, licenceAllowsClinicalWrites } from './workspace-boot.mjs';
import { readWorkspacePointer, writeWorkspacePointer, logoutCleanup } from './workspace-storage.mjs';

export function workspaceChoices(snapshot = {}) {
  return (snapshot.workspaces ?? []).map((w) => Object.freeze({
    id: w.workspace_id,
    label: w.name || w.tenant_slug || 'Clinic workspace',
    role: ({ owner: 'Owner', doctor: 'Doctor', frontdesk: 'Front desk' })[w.member_role] ?? 'Member',
    ready: w.ready === true && licenceAllowsClinicalWrites(w.licence),
    selected: w.workspace_id === snapshot.selectedWorkspaceId,
  }));
}

export function createWorkspaceController({ masterClient, mountClinicalClient, masterUrl,
  sessionStore = null, storage = null, clearLegacyCache = null, now = Date.now } = {}) {
  let expectedIssuer;
  try {
    const url = new URL(masterUrl);
    if (url.protocol === 'https:' && url.pathname === '/' && !url.username && !url.password && !url.search && !url.hash) {
      expectedIssuer = `${url.origin}/functions/v1/oidc`;
    }
  } catch { /* invalid config stays blocked */ }
  let epoch = 0; let disposed = false; let userId = null; let bootData = null;
  let session = null; let gate = null; let logoutPending = false; let cleanupFailed = false;
  let cleanupBarrier = Promise.resolve();
  const listeners = new Set();
  let view = Object.freeze({ state: 'SIGNED_OUT', workspaces: Object.freeze([]), selectedWorkspaceId: '', errorCode: '' });
  const current = (id) => !disposed && id === epoch;
  const publish = (state, selectedWorkspaceId = '', errorCode = '') => {
    view = Object.freeze({ state, workspaces: bootData?.workspaces ?? Object.freeze([]), selectedWorkspaceId, errorCode });
    for (const fn of listeners) { try { fn(); } catch { /* observers cannot alter security state */ } }
    return view;
  };
  function release() {
    const old = session; session = null;
    const oldGate = gate; gate = null;
    try { oldGate?.clear(); old?.clearToken?.(); } catch { cleanupFailed = true; }
    cleanupBarrier = cleanupBarrier.catch(() => {}).then(async () => {
      try {
        if (old?.client?.removeAllChannels) {
          const results = await old.client.removeAllChannels();
          if (Array.isArray(results) && results.some((r) => r !== 'ok')) throw new Error('channel cleanup incomplete');
        }
      } catch { cleanupFailed = true; }
      finally { try { await old?.dispose?.(); } catch { cleanupFailed = true; } }
    });
    return cleanupBarrier;
  }
  function clearPointer() {
    try { sessionStore?.removeItem(WORKSPACE_POINTER_KEY); } catch { /* a pointer is never authority */ }
  }
  function resetIdentity() {
    epoch += 1; userId = null; bootData = null; clearPointer();
    void release();
    publish('SIGNED_OUT');
  }
  // Synchronous callback: no Auth API call inside Supabase's Auth lock.
  const authListener = masterClient?.auth?.onAuthStateChange?.((event, next) => {
    if (event === 'SIGNED_OUT' && logoutPending) return;
    if (event === 'SIGNED_OUT' || event === 'USER_UPDATED' || event === 'PASSWORD_RECOVERY'
      || (userId && next?.user?.id !== userId)) resetIdentity();
  });

  async function boot() {
    if (disposed || logoutPending) return view;
    const op = ++epoch; userId = null; bootData = null;
    publish('LOADING');
    try {
      await release();
      if (!current(op)) return view;
      if (logoutPending || cleanupFailed || !expectedIssuer || !masterClient?.auth?.getUser) throw new Error('blocked');
      const auth = await masterClient.auth.getUser();
      if (!current(op)) return view;
      if (auth?.error || !auth?.data?.user?.id) { clearPointer(); return publish('SIGNED_OUT'); }
      userId = auth.data.user.id;
      const response = await masterClient.rpc('sync_clinic_subscription', { p_email: '', p_origin: '', p_device_id: '' });
      if (!current(op)) return view;
      if (response?.error) throw new Error('boot unavailable');
      bootData = parseBootResponse(response?.data);
      let pointer = null;
      try { pointer = readWorkspacePointer(sessionStore, { now }); } catch { clearPointer(); }
      const restored = bootData.workspaces.find((w) => w.workspace_id === pointer?.workspace_id && w.clinic_id === pointer?.clinic_id);
      const selected = restored?.workspace_id ?? bootData.selectedWorkspaceId;
      if (!bootData.ok) return publish('NOT_READY', selected, bootData.reason || 'NOT_READY');
      return publish('CHOOSE_WORKSPACE', selected);
    } catch {
      if (current(op)) { clearPointer(); publish('ERROR', '', cleanupFailed ? 'CLEANUP_FAILED' : logoutPending ? 'LOGOUT_INCOMPLETE' : 'BOOT_FAILED'); }
      return view;
    }
  }

  async function select(workspaceId) {
    if (disposed || logoutPending) return view;
    const op = ++epoch;
    const selected = bootData?.workspaces.find((w) => w.workspace_id === workspaceId);
    const identity = userId; const descriptor = bootData?.clinical;
    publish('CONNECTING', selected?.workspace_id ?? '');
    clearPointer();
    try {
      await release();
      if (!current(op)) return view;
      if (logoutPending || cleanupFailed || !identity || !descriptor?.ok || !selected
        || selected.ready !== true || !licenceAllowsClinicalWrites(selected.licence)
        || typeof mountClinicalClient !== 'function') throw new Error('not ready');
      const valid = () => current(op) && userId === identity;
      const localGate = createTokenGate({ now, mint: async () => {
        if (!valid()) throw new TenantAuthUnavailableError('stale workspace');
        const auth = await masterClient.auth.getUser();
        if (!valid() || auth?.error || auth?.data?.user?.id !== identity) throw new TenantAuthUnavailableError('identity changed');
        const minted = await masterClient.functions.invoke('mint-tenant-token', { body: { workspace_id: selected.workspace_id } });
        if (!valid() || minted?.error) throw new TenantAuthUnavailableError('mint unavailable');
        const data = minted?.data; const c = data?.claims;
        if (c?.sub !== identity || c?.workspace_id !== selected.workspace_id || c?.clinic_id !== selected.clinic_id
          || c?.tenant_slug !== selected.tenant_slug || c?.member_role !== selected.member_role || c?.iss !== expectedIssuer) {
          throw new TenantAuthUnavailableError('tenant claims mismatch');
        }
        return data;
      } });
      gate = localGate;
      const provider = {
        clear: () => localGate.clear(),
        async getToken() {
          try {
            if (!valid()) throw new TenantAuthUnavailableError('stale workspace');
            const token = await localGate.getToken();
            if (!valid()) throw new TenantAuthUnavailableError('stale workspace');
            return token;
          } catch {
            localGate.clear();
            if (valid()) {
              epoch += 1; clearPointer(); void release(); publish('ERROR', '', 'TOKEN_UNAVAILABLE');
            }
            throw new TenantAuthUnavailableError('tenant token unavailable');
          }
        },
      };
      // Validate/mint BEFORE making any clinical client reachable.
      await provider.getToken();
      if (!valid()) return view;
      const candidate = mountClinicalClient(descriptor, provider);
      session = candidate;
      if (candidate?.state !== TENANT_STATES.READY || !candidate.client) throw new Error('mount unavailable');
      try { writeWorkspacePointer(sessionStore, selected, { now }); } catch { clearPointer(); }
      return publish('READY', selected.workspace_id);
    } catch {
      if (current(op)) { await release(); publish('ERROR', '', cleanupFailed ? 'CLEANUP_FAILED' : 'WORKSPACE_UNAVAILABLE'); }
      return view;
    }
  }

  async function logout() {
    if (disposed || view.state === 'SIGNING_OUT') return view;
    epoch += 1; logoutPending = true; userId = null; bootData = null;
    publish('SIGNING_OUT');
    let failed = false;
    try { await release(); } catch { failed = true; }
    try { logoutCleanup({ sessionStore, storage }); } catch { failed = true; cleanupFailed = true; }
    try { if (typeof clearLegacyCache === 'function') await clearLegacyCache(); } catch { failed = true; cleanupFailed = true; }
    clearPointer();
    // Attempt Master sign-out even if local cleanup failed.
    try {
      const result = await masterClient.auth.signOut();
      if (result?.error) failed = true;
    } catch { failed = true; }
    if (disposed) return view;
    logoutPending = failed;
    return publish(failed || cleanupFailed ? 'ERROR' : 'SIGNED_OUT', '', failed ? 'LOGOUT_INCOMPLETE' : cleanupFailed ? 'CLEANUP_FAILED' : '');
  }

  return Object.freeze({
    getSnapshot: () => view,
    getPersistenceScope() {
      const selected = bootData?.workspaces.find((w) => w.workspace_id === view.selectedWorkspaceId);
      if (view.state !== 'READY' || !userId || !selected) throw new TenantAuthUnavailableError('workspace not ready');
      return Object.freeze({ subject: userId, workspaceId: selected.workspace_id, clinicId: selected.clinic_id });
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    boot, select, logout,
    getClinicalClient() {
      if (view.state !== 'READY' || session?.state !== TENANT_STATES.READY || !session.client) throw new TenantAuthUnavailableError('workspace not ready');
      return session.client;
    },
    async dispose() {
      if (disposed) return;
      epoch += 1; disposed = true; userId = null; bootData = null;
      authListener?.data?.subscription?.unsubscribe?.();
      await release(); clearPointer(); publish('DISPOSED'); listeners.clear();
    },
  });
}
