/** Staged v2 loader. No legacy client, cache fallback, signup/invite/provisioning,
 * profile upsert, implicit Main branch or owner/staff fallback.
 */
import { createWorkspaceOperations } from './workspace-operations.mjs';
import { workspaceDatabaseName, WorkspaceStorageError } from './workspace-persistence.mjs';
import { visibleBranchIds } from './branch-config.mjs';
import { resolveBranchScope } from './branch-scope.mjs';
const fail = (code) => new WorkspaceStorageError(code);
const BRANCH_TABLES = new Set(['appointments', 'consultations', 'invoices', 'day_closes']);
const PAGE_SIZE = 500;
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}

export async function readWorkspaceClinicalSnapshot(lease) {
  if (!lease?.subject || !['owner', 'doctor', 'frontdesk'].includes(lease.memberRole)) throw fail('LOAD_IDENTITY_REQUIRED');
  const clinicId = lease.clinicId;
  const request = (fn, withMeta = false) => lease.run(async (client) => {
    const response = await fn(client);
    if (response?.error) throw fail('CLINICAL_READ_FAILED');
    if (!response || !Object.hasOwn(response, 'data')) throw fail('CLINICAL_RESPONSE_INVALID');
    return withMeta ? response : response.data;
  });
  async function rows(table, allowedBranches = null) {
    const collected = []; const seen = new Set(); let total = null;
    for (let page = 0; page < 20; page += 1) {
      const response = await request((client) => {
        let query = client.from(table).select('*', { count: 'exact' }).eq('clinic_id', clinicId);
        if (table === 'staff_branches') query = query.eq('active', true).order('staff_id').order('branch_id');
        else query = query.order('id');
        if (allowedBranches) query = query.in('branch_id', allowedBranches);
        return query.range(collected.length, collected.length + PAGE_SIZE - 1);
      }, true);
      const { data, count } = response;
      if (!Number.isSafeInteger(count) || count < 0) throw fail('CLINICAL_COUNT_REQUIRED');
      if (total !== null && total !== count) throw fail('CLINICAL_DIRECTORY_CHANGED');
      total = count;
      if (total > 10000) throw fail('CLINICAL_PAGE_LIMIT');
      if (!Array.isArray(data) || data.some((row) => row?.clinic_id !== clinicId
        || (allowedBranches && !allowedBranches.includes(row.branch_id)))) throw fail('CLINICAL_ROW_SCOPE_MISMATCH');
      for (const row of data) {
        const key = table === 'staff_branches' ? `${row.staff_id}:${row.branch_id}` : row.id;
        if (!key || seen.has(key)) throw fail('CLINICAL_DUPLICATE_ROW');
        seen.add(key);
      }
      collected.push(...data);
      if (collected.length > total || (!data.length && collected.length < total)) throw fail('CLINICAL_PAGE_INCOMPLETE');
      if (collected.length === total) return collected;
    }
    throw fail('CLINICAL_PAGE_LIMIT'); // Never publish a silently truncated table.
  }
  const clinic = await request((client) => client.from('clinics').select('*').eq('id', clinicId).single());
  if (clinic?.id !== clinicId) throw fail('CLINICAL_ROW_SCOPE_MISMATCH');
  const profile = await request((client) => client.from('profiles').select('*').eq('id', lease.subject).maybeSingle());
  if (profile && profile.id !== lease.subject) throw fail('CLINICAL_PROFILE_MISMATCH');
  const staff = await rows('staff');
  const own = staff.filter((row) => row.user_id === lease.subject && row.active === true);
  if (own.length !== 1 || own[0].role !== lease.memberRole) throw fail('CLINICAL_MEMBERSHIP_MISMATCH');
  const currentStaff = own[0];
  const branches = await rows('branches');
  const staffBranches = await rows('staff_branches');
  if (staffBranches.some((row) => row.active !== true || !staff.some((s) => s.id === row.staff_id)
    || !branches.some((b) => b.id === row.branch_id))) throw fail('CLINICAL_ASSIGNMENT_MISMATCH');
  const allowedBranchIds = visibleBranchIds(currentStaff.role, currentStaff.id, staffBranches, branches);
  if (!allowedBranchIds.length || (currentStaff.role !== 'owner' && allowedBranchIds.length !== 1)) throw fail('CLINICAL_BRANCH_UNAVAILABLE');
  const activeBranchId = allowedBranchIds.includes(profile?.active_branch_id) ? profile.active_branch_id : allowedBranchIds[0];
  const branchScope = resolveBranchScope({ role: currentStaff.role, activeBranchId, allowedBranchIds,
    scope: profile?.branch_scope === 'branch' ? activeBranchId : profile?.branch_scope === 'all' ? 'all' : null });
  const data = {};
  for (const table of ['patients', 'appointments', 'consultations', 'invoices', 'day_closes', 'reminders']) {
    data[table] = await rows(table, currentStaff.role !== 'owner' && BRANCH_TABLES.has(table) ? allowedBranchIds : null);
  }
  data.invites = currentStaff.role === 'owner' ? await rows('invites') : [];
  // Preserve server licence verdict rather than inventing a new local plan rule.
  // license_state is an existing server RPC and may maintain server subscription
  // state; unlike the table queries it is not guaranteed to be side-effect free.
  let subscription = null;
  try {
    const response = await lease.run((client) => client.rpc('license_state', { p_clinic: clinicId }));
    if (!response?.error && response?.data) {
      if (response.data.clinic_id !== clinicId) throw fail('CLINICAL_LICENCE_SCOPE_MISMATCH');
      subscription = response.data;
    }
  } catch (error) {
    lease.assertCurrent();
    if (['CLINICAL_LICENCE_SCOPE_MISMATCH', 'TENANT_AUTH_UNAVAILABLE', 'TENANT_TOKEN_INVALID'].includes(error?.code)) throw error;
    // Missing verdict stays unknown; never infer write authority from cache.
  }
  lease.assertCurrent();
  return freeze({ clinic, profile: profile ?? null, staff, currentStaff, branches, staffBranches,
    allowedBranchIds, activeBranchId, branchScope, ...data, subscription, subscriptionUnknown: subscription === null, schemaReady: true });
}

export function createWorkspaceStoreLoader({ controller, lifecycle } = {}) {
  if (typeof controller?.subscribe !== 'function' || typeof lifecycle?.open !== 'function') throw fail('LOAD_UNAVAILABLE');
  const operations = createWorkspaceOperations(controller);
  let sequence = 0; let disposed = false;
  const listeners = new Set();
  let view = freeze({ state: 'IDLE', data: null, errorCode: '' });
  function publish(state, data = null, errorCode = '') {
    view = freeze({ state, data, errorCode });
    for (const listener of listeners) { try { listener(); } catch { /* observer only */ } }
  }
  const unsubscribe = controller.subscribe(() => { sequence += 1; publish('IDLE'); });
  return Object.freeze({
    getSnapshot: () => view,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async load() {
      if (disposed) throw fail('LOAD_CLOSED');
      const op = ++sequence;
      let store;
      publish('LOADING');
      const current = () => { if (disposed || op !== sequence) throw fail('LOAD_SUPERSEDED'); };
      try {
        const lease = operations.lease();
        current(); store = await lifecycle.open(lease); current(); lease.assertCurrent();
        if (store.name !== workspaceDatabaseName(lease)) throw fail('LOAD_SCOPE_MISMATCH');
        const initial = await store.read(); current(); lease.assertCurrent();
        if (initial.outbox.length || initial.conflicts?.length) throw fail('LOAD_UNRESOLVED_WORK');
        const data = await readWorkspaceClinicalSnapshot(lease); current(); lease.assertCurrent();
        try { await store.commit({ expectedRevision: initial.revision, cache: data }); }
        catch (error) { if (error?.code === 'REVISION_CONFLICT') throw fail('LOAD_ACK_CONFLICT'); throw error; }
        current(); lease.assertCurrent();
        publish('READY', data);
        return view;
      } catch (error) {
        if (!disposed && op === sequence) publish('ERROR', null, ['LOAD_UNRESOLVED_WORK', 'LOAD_ACK_CONFLICT'].includes(error?.code) ? error.code : 'LOAD_FAILED');
        throw error;
      } finally { store?.close(); }
    },
    dispose() {
      if (disposed) return;
      disposed = true; sequence += 1; unsubscribe(); publish('DISPOSED'); listeners.clear();
    },
  });
}
