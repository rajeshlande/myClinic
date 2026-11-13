import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWorkspaceController, workspaceChoices } from '../src/lib/workspace-controller.mjs';
import { createTenantSession, TenantAuthUnavailableError, WORKSPACE_POINTER_KEY } from '../src/lib/tenant-client.mjs';
const USER = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
const A = '20000000-0000-4000-8000-000000000001';
const B = '20000000-0000-4000-8000-000000000002';
const CA = '30000000-0000-4000-8000-000000000001';
const CB = '30000000-0000-4000-8000-000000000002';
const MASTER = 'https://master.example.supabase.co';
const tick = () => new Promise((r) => setImmediate(r));
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
function store() {
  const map = new Map();
  return { get length() { return map.size; }, key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k), map };
}
function fixture(options = {}) {
  let time = 1800000000000; let authEvent;
  const calls = []; const clients = [];
  const sessionStore = options.sessionStore ?? store(); const storage = store();
  const rows = [
    { workspace_id: A, clinic_id: CA, tenant_slug: 'clinic-a', name: 'Clinic A', member_role: 'owner', ready: true, licence: { status: 'active', can_write: true } },
    { workspace_id: B, clinic_id: CB, tenant_slug: 'clinic-b', name: 'Clinic B', member_role: 'doctor', ready: true, licence: { status: 'active', can_write: true } },
  ];
  const payload = { workspaces: rows, selected_workspace_id: A, licence: rows[0].licence,
    clinical: { clinical_url: 'https://clinical.example.supabase.co', clinical_publishable_key: 'public-test-key' }, booking: 'booking:clinic-a' };
  function minted(workspace, overrides = {}) {
    const row = rows.find((w) => w.workspace_id === workspace);
    return { data: { token: `test-tenant-token-${workspace}`, claims: { sub: USER, workspace_id: workspace, clinic_id: row.clinic_id,
      tenant_slug: row.tenant_slug, member_role: row.member_role, iss: `${MASTER}/functions/v1/oidc`, aud: 'authenticated', role: 'authenticated',
      kid: 'tenant-test', alg: 'RS256', iat: Math.floor(time / 1000), exp: Math.floor(time / 1000) + 900, ...overrides } }, error: null };
  }
  const master = {
    auth: {
      async getUser() { calls.push('auth'); return options.getUser ? options.getUser() : { data: { user: { id: USER } }, error: null }; },
      onAuthStateChange(fn) { authEvent = fn; return { data: { subscription: { unsubscribe() { calls.push('unsubscribe'); } } } }; },
      async signOut() { calls.push('signout'); if (options.signOut) return options.signOut(); authEvent('SIGNED_OUT', null); return { error: null }; },
    },
    async rpc(name, args) { calls.push(['boot', name, args]); return options.rpc ? options.rpc(name, args) : { data: payload }; },
    functions: { async invoke(name, args) { calls.push(['mint', name, args]); return options.mint ? options.mint(args.body.workspace_id, minted) : minted(args.body.workspace_id); } },
  };
  const ctl = createWorkspaceController({ masterClient: master, masterUrl: options.masterUrl ?? MASTER,
    sessionStore, storage, now: () => time, clearLegacyCache: options.clearLegacyCache,
    mountClinicalClient(descriptor, provider) {
      calls.push('mount');
      return createTenantSession({ descriptor, tokenProvider: provider, createClientImpl(url, key, config) {
        const client = { url, key, config, async removeAllChannels() { calls.push('channels'); return options.channels ?? ['ok']; },
          dispose() { calls.push('dispose'); } };
        clients.push(client); return client;
      } });
    },
  });
  return { ctl, calls, clients, rows, payload, minted, sessionStore, storage,
    advance(ms) { time += ms; }, event(name, session) { authEvent(name, session); } };
}

test('construction is inert and no clinical fallback is accessible', () => {
  const f = fixture(); assert.equal(f.ctl.getSnapshot().state, 'SIGNED_OUT');
  assert.equal(f.calls.length, 0);
  assert.throws(() => f.ctl.getClinicalClient(), TenantAuthUnavailableError);
});

test('verified Master boot uses only one workspace RPC and does not mount clinical client', async () => {
  const f = fixture(); await f.ctl.boot();
  assert.equal(f.ctl.getSnapshot().state, 'CHOOSE_WORKSPACE');
  assert.equal(f.calls.filter((x) => Array.isArray(x) && x[0] === 'boot').length, 1);
  assert.equal(f.clients.length, 0);
});

test('minted claims validated before client is exposed; view/storage carry no token', async () => {
  const f = fixture(); await f.ctl.boot(); await f.ctl.select(A);
  assert.equal(f.ctl.getSnapshot().state, 'READY');
  assert.equal(f.ctl.getClinicalClient(), f.clients[0]);
  assert.equal(await f.clients[0].config.accessToken(), `test-tenant-token-${A}`);
  assert.ok(!JSON.stringify(f.ctl.getSnapshot()).includes('test-tenant-token'));
  assert.ok(!JSON.stringify([...f.sessionStore.map]).includes('test-tenant-token'));
  assert.equal(JSON.parse(f.sessionStore.getItem(WORKSPACE_POINTER_KEY)).workspace_id, A);
});

for (const [label, overrides] of Object.entries({
  subject: { sub: OTHER }, workspace: { workspace_id: B }, clinic: { clinic_id: CB }, issuer: { iss: 'https://wrong.invalid' },
  slug: { tenant_slug: 'clinic-b' }, member: { member_role: 'doctor' }, expiry: { exp: 1 }, role: { role: 'anon' },
})) test(`refuses mismatched minted ${label}`, async () => {
  const f = fixture({ mint: (ws, make) => make(ws, overrides) });
  await f.ctl.boot(); await f.ctl.select(A);
  assert.equal(f.ctl.getSnapshot().state, 'ERROR'); assert.equal(f.clients.length, 0);
  assert.throws(() => f.ctl.getClinicalClient(), TenantAuthUnavailableError);
});

test('unknown/unready/negative-verdict workspace cannot reach mint', async () => {
  for (const mode of ['unknown', 'unready', 'denied']) {
    const f = fixture();
    if (mode === 'unready') f.rows[0].ready = false;
    if (mode === 'denied') f.rows[0].licence.can_write = false;
    await f.ctl.boot(); await f.ctl.select(mode === 'unknown' ? OTHER : A);
    assert.equal(f.clients.length, 0);
    assert.equal(f.calls.filter((x) => Array.isArray(x) && x[0] === 'mint').length, 0);
  }
});

test('saved pointer is only restored when both IDs belong to current directory', async () => {
  const f = fixture(); f.sessionStore.setItem(WORKSPACE_POINTER_KEY, JSON.stringify({ workspace_id: B, clinic_id: CB, expiresAt: 1800000300000 }));
  await f.ctl.boot(); assert.equal(f.ctl.getSnapshot().selectedWorkspaceId, B);
  const g = fixture(); g.sessionStore.setItem(WORKSPACE_POINTER_KEY, JSON.stringify({ workspace_id: B, clinic_id: CA, expiresAt: 1800000300000 }));
  await g.ctl.boot(); assert.equal(g.ctl.getSnapshot().selectedWorkspaceId, A);
});

test('slow older boot cannot replace a newer directory', async () => {
  const pending = deferred(); let n = 0; let f;
  f = fixture({ rpc: () => ++n === 1 ? pending.promise : { data: { ...f.payload, workspaces: [{ ...f.rows[1], name: 'New directory' }] } } });
  const old = f.ctl.boot(); await tick(); await f.ctl.boot();
  pending.resolve({ data: f.payload }); await old;
  assert.equal(f.ctl.getSnapshot().workspaces[0].name, 'New directory');
});

test('older workspace mint cannot mount after a newer choice', async () => {
  const pending = deferred(); let f;
  f = fixture({ mint: (ws, make) => ws === A ? pending.promise : make(ws) });
  await f.ctl.boot(); const old = f.ctl.select(A); await tick(); await f.ctl.select(B);
  pending.resolve(f.minted(A)); await old;
  assert.equal(f.ctl.getSnapshot().selectedWorkspaceId, B); assert.equal(f.clients.length, 1);
  assert.equal(await f.ctl.getClinicalClient().config.accessToken(), `test-tenant-token-${B}`);
});

test('logout invalidates an outstanding mint before any clinical mount', async () => {
  const pending = deferred(); const f = fixture({ mint: () => pending.promise });
  await f.ctl.boot(); const old = f.ctl.select(A); await tick(); await f.ctl.logout();
  pending.resolve(f.minted(A)); await old;
  assert.equal(f.ctl.getSnapshot().state, 'SIGNED_OUT'); assert.equal(f.clients.length, 0);
  assert.equal(f.sessionStore.getItem(WORKSPACE_POINTER_KEY), null);
});

test('expired refresh from old workspace cannot affect the new client', async () => {
  const pending = deferred(); let count = 0; let f;
  f = fixture({ mint: (ws, make) => {
    if (ws === A && ++count === 1) return make(ws, { iat: 1799999230, exp: 1800000130 });
    if (ws === A) return pending.promise;
    return make(ws);
  } });
  await f.ctl.boot(); await f.ctl.select(A); const oldClient = f.clients[0];
  f.advance(11000); const refreshing = oldClient.config.accessToken();
  const rejected = assert.rejects(refreshing, TenantAuthUnavailableError);
  await tick(); await f.ctl.select(B); pending.resolve(f.minted(A)); await rejected;
  assert.equal(f.ctl.getSnapshot().state, 'READY'); assert.equal(f.ctl.getSnapshot().selectedWorkspaceId, B);
});

test('refresh denial removes reachable clinical client and redacts server errors', async () => {
  let n = 0;
  const f = fixture({ mint: (ws, make) => ++n === 1 ? make(ws, { iat: 1799999230, exp: 1800000130 }) : { error: { message: 'sensitive backend detail' } } });
  await f.ctl.boot(); await f.ctl.select(A); const client = f.ctl.getClinicalClient();
  f.advance(11000); await assert.rejects(client.config.accessToken(), TenantAuthUnavailableError);
  assert.equal(f.ctl.getSnapshot().state, 'ERROR'); assert.throws(() => f.ctl.getClinicalClient());
  assert.ok(!JSON.stringify(f.ctl.getSnapshot()).includes('sensitive'));
});

test('identity event invalidates session synchronously without Auth calls in callback', async () => {
  const f = fixture(); await f.ctl.boot(); await f.ctl.select(A);
  const count = f.calls.filter((x) => x === 'auth').length;
  f.event('SIGNED_IN', { user: { id: OTHER } });
  assert.throws(() => f.ctl.getClinicalClient()); assert.equal(f.ctl.getSnapshot().state, 'SIGNED_OUT');
  assert.equal(f.calls.filter((x) => x === 'auth').length, count);
});

test('cleanup failures block the next client, but do not prevent Master signout', async () => {
  const f = fixture({ channels: ['timed out'] }); await f.ctl.boot(); await f.ctl.select(A); await f.ctl.select(B);
  assert.equal(f.ctl.getSnapshot().errorCode, 'CLEANUP_FAILED'); assert.equal(f.clients.length, 1);
  await f.ctl.logout(); assert.ok(f.calls.includes('signout')); assert.throws(() => f.ctl.getClinicalClient());
});

test('logout clears tenant metadata/legacy cache and always calls Master Auth', async () => {
  let legacy = 0;
  const f = fixture({ clearLegacyCache: () => { legacy += 1; } });
  await f.ctl.boot(); await f.ctl.select(A);
  f.storage.setItem('myclinic.cache.v2.example.patients', 'fixture'); f.storage.setItem('theme', 'dark');
  await f.ctl.logout(); assert.equal(f.ctl.getSnapshot().state, 'SIGNED_OUT');
  assert.equal(legacy, 1); assert.equal(f.storage.getItem('myclinic.cache.v2.example.patients'), null);
  assert.equal(f.storage.getItem('theme'), 'dark'); assert.ok(f.calls.includes('channels')); assert.ok(f.calls.includes('dispose'));
});

test('failed signout locks subsequent boot until signout succeeds', async () => {
  let fail = true;
  const f = fixture({ signOut: () => ({ error: fail ? { message: 'not exposed' } : null }) });
  await f.ctl.boot(); await f.ctl.logout(); assert.equal(f.ctl.getSnapshot().errorCode, 'LOGOUT_INCOMPLETE');
  const count = f.calls.length; await f.ctl.boot(); assert.equal(f.calls.length, count);
  fail = false; await f.ctl.logout(); assert.equal(f.ctl.getSnapshot().state, 'SIGNED_OUT');
});

test('dispose unsubscribes and cannot be reopened', async () => {
  const f = fixture(); await f.ctl.boot(); await f.ctl.select(A); await f.ctl.dispose();
  assert.equal(f.ctl.getSnapshot().state, 'DISPOSED'); assert.ok(f.calls.includes('unsubscribe'));
  await f.ctl.boot(); assert.equal(f.ctl.getSnapshot().state, 'DISPOSED');
});

test('picker choices are explicit ready verdicts; JSX is controlled and not live-routed', () => {
  const f = fixture(); const rows = workspaceChoices({ workspaces: f.rows, selectedWorkspaceId: B });
  assert.equal(rows[1].role, 'Doctor'); assert.equal(rows[1].selected, true);
  const source = readFileSync(new URL('../src/components/WorkspacePicker.jsx', import.meta.url), 'utf8');
  assert.ok(source.includes('aria-pressed={row.selected}')); assert.ok(source.includes('disabled={busy || !row.ready'));
  assert.ok(!source.includes('dangerouslySetInnerHTML')); assert.ok(!source.includes('JSON.stringify'));
  assert.ok(!readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8').includes('WorkspacePicker'));
});

test('logout awaits asynchronous cache cleanup and serializes concurrent logout', async () => {
  const pending = deferred(); let clears = 0;
  const f = fixture({ clearLegacyCache: () => { clears += 1; return pending.promise; } });
  await f.ctl.boot(); await f.ctl.select(A);
  const leaving = f.ctl.logout(); await tick();
  assert.equal(f.ctl.getSnapshot().state, 'SIGNING_OUT');
  await f.ctl.logout(); await f.ctl.boot();
  assert.equal(clears, 1); assert.ok(!f.calls.includes('signout'));
  pending.resolve(); await leaving;
  assert.equal(f.ctl.getSnapshot().state, 'SIGNED_OUT');
  assert.equal(f.calls.filter((x) => x === 'signout').length, 1);
});

test('asynchronous PHI cleanup failure still signs out and permanently blocks remount', async () => {
  const f = fixture({ clearLegacyCache: async () => { throw new Error('private cache detail'); } });
  await f.ctl.boot(); await f.ctl.select(A); await f.ctl.logout();
  assert.ok(f.calls.includes('signout')); assert.equal(f.ctl.getSnapshot().state, 'ERROR');
  await f.ctl.logout(); await f.ctl.boot(); await f.ctl.select(B);
  assert.equal(f.clients.length, 1); assert.throws(() => f.ctl.getClinicalClient());
  assert.ok(!JSON.stringify(f.ctl.getSnapshot()).includes('private cache detail'));
});

test('real controller operation lease expires across workspace switch and same-workspace reconnect', async () => {
  const { createWorkspaceOperations } = await import('../src/lib/workspace-operations.mjs');
  const f = fixture(); await f.ctl.boot(); await f.ctl.select(A);
  const operations = createWorkspaceOperations(f.ctl);
  const pending = deferred(); const lease = operations.lease();
  const result = lease.run(() => pending.promise);
  await f.ctl.select(B); pending.resolve({ patient: 'old-workspace-fixture' });
  await assert.rejects(result, TenantAuthUnavailableError);
  const sameWorkspace = operations.lease(); await f.ctl.select(B);
  assert.throws(sameWorkspace.assertCurrent, TenantAuthUnavailableError);
  const active = operations.lease(); await f.ctl.logout();
  assert.throws(active.assertCurrent, TenantAuthUnavailableError);
});

test('verified controller scope drives physical persistence and pending cleanup blocks reactivation', async () => {
  const { IDBFactory } = await import('fake-indexeddb');
  const { createWorkspaceOperations } = await import('../src/lib/workspace-operations.mjs');
  const { openWorkspacePersistence } = await import('../src/lib/workspace-persistence.mjs');
  let persistence;
  const f = fixture({ clearLegacyCache: async () => { if (persistence) await persistence.cleanup(); } });
  assert.throws(() => f.ctl.getPersistenceScope(), TenantAuthUnavailableError);
  await f.ctl.boot(); await f.ctl.select(A);
  const scope = f.ctl.getPersistenceScope();
  assert.deepEqual(scope, { subject: USER, workspaceId: A, clinicId: CA });
  assert.ok(Object.isFrozen(scope));
  const lease = createWorkspaceOperations(f.ctl).lease(); assert.equal(lease.subject, USER);
  persistence = await openWorkspacePersistence({ indexedDB: new IDBFactory(), lease });
  await persistence.commit({ expectedRevision: 0, cache: { clinic: { id: CA } }, outbox: [
    { op_id: 'pending-fixture', type: 'delete', table: 'patients', clinic_id: CA, id: 'row-fixture' },
  ] });
  await f.ctl.logout();
  assert.equal(f.ctl.getSnapshot().errorCode, 'LOGOUT_INCOMPLETE');
  assert.ok(f.calls.includes('signout')); assert.throws(() => f.ctl.getPersistenceScope());
  await f.ctl.boot(); assert.throws(() => f.ctl.getClinicalClient()); assert.equal(f.clients.length, 1);
});

test('coordinated logout fences a second controller tab and invalidates its old token provider', async () => {
  const { IDBFactory } = await import('fake-indexeddb');
  const { createWorkspaceOperations } = await import('../src/lib/workspace-operations.mjs');
  const { createWorkspaceLifecycle } = await import('../src/lib/workspace-lifecycle.mjs');
  let queue = Promise.resolve(); const values = new Map(); const listeners = new Set(); let epoch = 0;
  const options = {
    indexedDB: new IDBFactory(), randomId: () => `controller-fence-${++epoch}`,
    locks: { request(name, config, callback) { const result = queue.then(callback); queue = result.catch(() => {}); return result; } },
    eventTarget: { addEventListener(type, listener) { listeners.add(listener); }, removeEventListener(type, listener) { listeners.delete(listener); } },
    metadataStorage: { getItem: (key) => values.get(key) ?? null,
      setItem(key, value) { values.set(key, value); for (const listener of listeners) listener({ key }); } },
  };
  let ownerRuntime;
  const owner = fixture({ clearLegacyCache: () => ownerRuntime.cleanup() });
  const remote = fixture();
  ownerRuntime = createWorkspaceLifecycle(options);
  const remoteRuntime = createWorkspaceLifecycle({ ...options, onInvalidate: () => remote.ctl.dispose() });
  await owner.ctl.boot(); await owner.ctl.select(A); await remote.ctl.boot(); await remote.ctl.select(A);
  const oldRemoteClient = remote.ctl.getClinicalClient();
  const localStore = await ownerRuntime.open(createWorkspaceOperations(owner.ctl).lease());
  const remoteStore = await remoteRuntime.open(createWorkspaceOperations(remote.ctl).lease());
  await localStore.commit({ expectedRevision: 0, cache: { clinic: { id: CA } } });
  await owner.ctl.logout();
  assert.equal(owner.ctl.getSnapshot().state, 'SIGNED_OUT'); assert.ok(owner.calls.includes('signout'));
  assert.equal(remote.ctl.getSnapshot().state, 'DISPOSED');
  await assert.rejects(oldRemoteClient.config.accessToken(), TenantAuthUnavailableError);
  await assert.rejects(remoteStore.read()); ownerRuntime.dispose(); remoteRuntime.dispose();
});
