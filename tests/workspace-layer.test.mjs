import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOOKING_POINTER_PREFIX,
  parseBookingPointer,
  normaliseWorkspace,
  parseBootResponse,
  findWorkspace,
  licenceAllowsClinicalWrites,
} from '../src/lib/workspace-boot.mjs';
import {
  WORKSPACE_POINTER_TTL_MS,
  writeWorkspacePointer,
  readWorkspacePointer,
  indexedDbName,
  logoutCleanup,
} from '../src/lib/workspace-storage.mjs';
import { CLINICAL_MODES, createClinicalAccessor } from '../src/lib/clinical-accessor.mjs';
import {
  TENANT_STATES,
  TenantAuthUnavailableError,
  WORKSPACE_POINTER_KEY,
  createTenantSession,
  createTokenGate,
} from '../src/lib/tenant-client.mjs';

const NOW = 1800000000000;
const NOW_S = NOW / 1000;
const URL_OK = 'https://clinical.example.supabase.co';
const KEY_OK = 'publishable-anon-key';
const VALID_DESCRIPTOR = { clinical_url: URL_OK, clinical_publishable_key: KEY_OK };

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get length() { return map.size; },
    key(i) { return Array.from(map.keys())[i] ?? null; },
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
    keys() { return Array.from(map.keys()); },
  };
}

function fakeSession({ provider = true } = {}) {
  const disposeCalls = [];
  const impl = () => ({ dispose: () => disposeCalls.push(1) });
  const gate = createTokenGate({
    mint: async () => ({
      token: 'tenant-token',
      claims: {
        alg: 'RS256', kid: 'k1', iss: 'https://central.example.supabase.co/functions/v1/oidc',
        aud: 'authenticated', sub: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
        role: 'authenticated', clinic_id: 'clinic-a',
        iat: NOW_S - 1, exp: NOW_S + 800,
      },
    }),
    now: () => NOW,
  });
  return createTenantSession({
    createClientImpl: impl,
    descriptor: VALID_DESCRIPTOR,
    tokenProvider: provider ? gate : null,
  });
}

test('booking pointer accepts a slug and exposes the prefix', () => {
  assert.equal(BOOKING_POINTER_PREFIX, 'booking:');
  const parsed = parseBookingPointer('booking:sunrise-opd');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.slug, 'sunrise-opd');
});

test('booking pointer rejects other values, bad slugs and reserved error tokens', () => {
  assert.equal(parseBookingPointer('clinic-a').reason, 'NOT_BOOKING_POINTER');
  assert.equal(parseBookingPointer('booking:').reason, 'BAD_SLUG');
  assert.equal(parseBookingPointer('booking:already').reason, 'BAD_SLUG');
  assert.equal(parseBookingPointer('booking:slot_taken').reason, 'BAD_SLUG');
  assert.equal(parseBookingPointer('booking:a:b').reason, 'BAD_SLUG');
});

test('workspace normalisation requires ids and returns a frozen row', () => {
  assert.equal(normaliseWorkspace({ clinic_id: 'c1' }), null);
  const w = normaliseWorkspace({
    clinic_id: 'c1', workspace_id: 'w1', tenant_slug: 'alpha', role: 'doctor',
  });
  assert.equal(w.clinic_id, 'c1');
  assert.equal(w.member_role, 'doctor');
  assert.equal(w.status, 'active');
  assert.ok(Object.isFrozen(w));
});

test('boot response parses workspaces, licence, booking slug and clinical descriptor', () => {
  const boot = parseBootResponse({
    workspaces: [
      { clinic_id: 'c1', workspace_id: 'w1', tenant_slug: 'alpha' },
      { clinic_id: 'c1', workspace_id: 'w1', tenant_slug: 'alpha' },
      { clinic_id: 'c2', workspace_id: 'w2', tenant_slug: 'beta' },
    ],
    booking: 'booking:alpha-clinic',
    licence: { status: 'active' },
    clinical: VALID_DESCRIPTOR,
  });
  assert.equal(boot.ok, true);
  assert.equal(boot.workspaces.length, 2);
  assert.equal(boot.bookingSlug, 'alpha-clinic');
  assert.equal(boot.clinical.url, URL_OK);
  assert.ok(Object.isFrozen(boot));
  assert.ok(Object.isFrozen(boot.workspaces));
});

test('boot response fails closed on a privileged key or no workspaces', () => {
  const bad = parseBootResponse({
    workspaces: [{ clinic_id: 'c1', workspace_id: 'w1' }],
    clinical: { clinical_url: URL_OK, clinical_publishable_key: 'service_role_x' },
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'PRIVILEGED_KEY');
  const empty = parseBootResponse({ clinical: VALID_DESCRIPTOR });
  assert.equal(empty.ok, false);
  assert.equal(empty.reason, 'NO_WORKSPACES');
});

test('licence gate fails closed unless there is an explicit positive signal', () => {
  assert.equal(licenceAllowsClinicalWrites(null), false);
  assert.equal(licenceAllowsClinicalWrites({ status: 'inactive' }), false);
  assert.equal(licenceAllowsClinicalWrites({ status: 'suspended' }), false);
  assert.equal(licenceAllowsClinicalWrites({ status: 'active' }), true);
  // Contradictory positive flags must not override an explicit denial status.
  assert.equal(licenceAllowsClinicalWrites({ status: 'inactive', can_write: true }), false);
});

test('findWorkspace resolves by workspace id or clinic id', () => {
  const boot = parseBootResponse({
    workspaces: [{ clinic_id: 'c1', workspace_id: 'w1', tenant_slug: 'alpha' }],
    clinical: VALID_DESCRIPTOR,
  });
  assert.equal(findWorkspace(boot, 'w1').tenant_slug, 'alpha');
  assert.equal(findWorkspace(boot, 'c1').workspace_id, 'w1');
  assert.equal(findWorkspace(boot, 'missing'), null);
  assert.equal(findWorkspace(boot, ''), null);
});

test('workspace pointer round-trips through sessionStorage', () => {
  const store = fakeStorage();
  const pointer = { clinic_id: 'c1', tenant_slug: 'alpha', workspace_id: 'w1' };
  assert.equal(writeWorkspacePointer(store, pointer, { now: () => NOW }), true);
  const read = readWorkspacePointer(store, { now: () => NOW + 1000 });
  assert.equal(read.clinic_id, 'c1');
  assert.equal(read.tenant_slug, 'alpha');
  assert.ok(Object.isFrozen(read));
});

test('an expired or malformed pointer is removed, not trusted', () => {
  const expired = fakeStorage();
  writeWorkspacePointer(expired, { clinic_id: 'c1' }, { now: () => NOW });
  assert.equal(readWorkspacePointer(expired, { now: () => NOW + WORKSPACE_POINTER_TTL_MS + 1 }), null);
  assert.deepEqual(expired.keys(), []);

  const broken = fakeStorage({ [WORKSPACE_POINTER_KEY]: '{not json' });
  assert.equal(readWorkspacePointer(broken, { now: () => NOW }), null);
  assert.deepEqual(broken.keys(), []);
});

test('writeWorkspacePointer refuses a missing clinic id or a missing store', () => {
  assert.equal(writeWorkspacePointer(fakeStorage(), {}, { now: () => NOW }), false);
  assert.equal(writeWorkspacePointer(null, { clinic_id: 'c1' }), false);
});

test('IndexedDB names are namespaced per clinic', () => {
  assert.equal(indexedDbName(''), null);
  assert.equal(indexedDbName('clinic-a'), 'myclinic-v2-clinic-a');
  assert.notEqual(indexedDbName('clinic-a'), indexedDbName('clinic-b'));
});

test('logout cleanup disposes the session, clears namespaced keys and calls the legacy cache', () => {
  const session = fakeSession();
  const storage = fakeStorage({
    'myclinic.cache.v2.clinic-a.patients': 'x',
    'unrelated.setting': 'keep',
  });
  const sessionStore = fakeStorage({ [WORKSPACE_POINTER_KEY]: 'stale', other: 'keep' });
  let legacy = 0;
  const result = logoutCleanup({
    storage,
    sessionStore,
    session,
    clearLegacyCache: () => { legacy += 1; },
  });
  assert.equal(result.disposed, true);
  assert.equal(result.removed, 2);
  assert.equal(legacy, 1);
  assert.equal(session.state, TENANT_STATES.DISPOSED);
  assert.equal(session.client, null);
  assert.deepEqual(storage.keys(), ['unrelated.setting']);
  assert.deepEqual(sessionStore.keys(), ['other']);
});

test('clinical accessor stays in legacy mode by default', () => {
  const legacy = { marker: 'legacy-client' };
  const accessor = createClinicalAccessor({ legacyClient: legacy });
  assert.equal(accessor.mode, CLINICAL_MODES.LEGACY);
  assert.equal(accessor.getClient(), legacy);
});

test('clinical accessor refuses a tpa-required session without switching', () => {
  const legacy = { marker: 'legacy-client' };
  const accessor = createClinicalAccessor({ legacyClient: legacy });
  const blocked = fakeSession({ provider: false });
  assert.equal(blocked.state, TENANT_STATES.TPA_REQUIRED);
  assert.throws(() => accessor.enable(blocked), TenantAuthUnavailableError);
  assert.equal(accessor.mode, CLINICAL_MODES.LEGACY);
  assert.equal(accessor.getClient(), legacy);
});

test('clinical accessor switches only on a READY session and resets on logout', () => {
  const legacy = { marker: 'legacy-client' };
  const accessor = createClinicalAccessor({ legacyClient: legacy });
  const ready = fakeSession();
  assert.equal(ready.state, TENANT_STATES.READY);
  const v2 = accessor.enable(ready);
  assert.equal(accessor.mode, CLINICAL_MODES.V2);
  assert.equal(accessor.getClient(), v2);
  assert.notEqual(accessor.getClient(), legacy);
  assert.equal(accessor.reset(), legacy);
  assert.equal(accessor.mode, CLINICAL_MODES.LEGACY);
});

test('explicit negative licence flags override active status and positive flags', () => {
  assert.equal(licenceAllowsClinicalWrites({ status: 'active', can_write: false }), false);
  assert.equal(licenceAllowsClinicalWrites({ status: 'active', allowed: false, can_write: true }), false);
  assert.equal(licenceAllowsClinicalWrites({ status: 'active', writable: false }), false);
});

test('negative licence statuses override an inconsistent positive signal', () => {
  for (const status of ['suspended', 'expired', 'read_only', 'not_ready', 'unavailable']) {
    assert.equal(licenceAllowsClinicalWrites({ status, can_write: true }), false);
  }
});

test('boot preserves per-workspace readiness/verdict without sharing mutable verdict objects', () => {
  const licence = { status: 'active', can_write: false };
  const row = normaliseWorkspace({ clinic_id: 'c1', workspace_id: 'w1', ready: false, licence });
  assert.equal(row.ready, false);
  assert.notEqual(row.licence, licence);
  assert.ok(Object.isFrozen(row.licence));
  assert.equal(licenceAllowsClinicalWrites(row.licence), false);
});

test('selected workspace must exist in the returned directory', () => {
  const workspaces = [{ clinic_id: 'c1', workspace_id: 'w1' }, { clinic_id: 'c2', workspace_id: 'w2' }];
  assert.equal(parseBootResponse({ workspaces, selected_workspace_id: 'w2' }).selectedWorkspaceId, 'w2');
  assert.equal(parseBootResponse({ workspaces, selected_workspace_id: 'foreign' }).selectedWorkspaceId, 'w1');
  assert.equal(parseBootResponse({ workspaces: [] }).selectedWorkspaceId, '');
});
