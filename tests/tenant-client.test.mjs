import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TENANT_STATES,
  TENANT_AUTH_UNAVAILABLE,
  TenantAuthUnavailableError,
  TenantTokenError,
  WORKSPACE_POINTER_KEY,
  validateClinicalDescriptor,
  assertTenantClaims,
  createTokenGate,
  createTenantSession,
  disposeTenantSession,
  selectWorkspace,
  tenantCacheKeys,
  clearTenantState,
} from '../src/lib/tenant-client.mjs';

const NOW = 1800000000000;
const NOW_S = NOW / 1000;
const URL_OK = 'https://clinical.example.supabase.co';
const KEY_OK = 'publishable-anon-key';
const VALID = { url: URL_OK, publishableKey: KEY_OK };
const clock = () => NOW;

function claims(overrides = {}) {
  return {
    alg: 'RS256',
    kid: 'tenant-2026-11-a',
    iss: 'https://central.example.supabase.co/functions/v1/oidc',
    aud: 'authenticated',
    sub: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    role: 'authenticated',
    clinic_id: 'clinic-a',
    tenant_slug: 'clinic-a',
    workspace_id: 'ws-1',
    iat: NOW_S - 1,
    exp: NOW_S + 800,
    jti: 'jti-1',
    ...overrides,
  };
}

function mintOnce(token = 'tenant-token', overrideClaims = null) {
  const calls = { count: 0 };
  const gate = createTokenGate({
    mint: async () => {
      calls.count += 1;
      await Promise.resolve();
      return { token, claims: overrideClaims ?? claims() };
    },
    now: clock,
  });
  return { gate, calls };
}

function fakeClientFactory() {
  const calls = [];
  const disposeCalls = [];
  const impl = (url, key, options) => {
    calls.push({ url, key, options });
    return { dispose: () => disposeCalls.push(1) };
  };
  return { impl, calls, disposeCalls };
}

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  const setCalls = [];
  return {
    get length() { return map.size; },
    key(i) { return Array.from(map.keys())[i] ?? null; },
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { setCalls.push([k, v]); map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
    keys() { return Array.from(map.keys()); },
    setCalls,
  };
}

test('descriptor rejects privileged keys', () => {
  for (const key of ['sb_secret_x', 'service_role_x', 'sbp_x']) {
    const result = validateClinicalDescriptor({ url: URL_OK, publishableKey: key });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'PRIVILEGED_KEY');
  }
});

test('descriptor rejects a bad URL or a missing key', () => {
  assert.equal(validateClinicalDescriptor({ url: 'http://clinical.example.supabase.co', publishableKey: KEY_OK }).ok, false);
  assert.equal(validateClinicalDescriptor({ url: 'not a url', publishableKey: KEY_OK }).reason, 'BAD_URL');
  assert.equal(validateClinicalDescriptor({ url: URL_OK }).reason, 'MISSING_KEY');
  assert.equal(validateClinicalDescriptor({}).reason, 'NO_WORKSPACE');
});

test('descriptor accepts an https URL and a publishable key', () => {
  const result = validateClinicalDescriptor(VALID);
  assert.equal(result.ok, true);
  assert.equal(result.url, URL_OK);
  assert.equal(result.publishableKey, KEY_OK);
  assert.equal(result.reason, '');
});

test('fail-closed: no token provider never creates a client', () => {
  const f = fakeClientFactory();
  const session = createTenantSession({
    createClientImpl: f.impl,
    descriptor: VALID,
    tokenProvider: null,
  });
  assert.equal(f.calls.length, 0);
  assert.equal(session.state, TENANT_STATES.TPA_REQUIRED);
  assert.equal(session.reason, TENANT_AUTH_UNAVAILABLE);
  assert.equal(session.client, null);
});

test('fail-closed: getToken throws instead of returning null', async () => {
  const f = fakeClientFactory();
  const session = createTenantSession({
    createClientImpl: f.impl,
    descriptor: VALID,
    tokenProvider: null,
  });
  await assert.rejects(
    () => session.getToken(),
    (error) => error instanceof TenantAuthUnavailableError
      && error.code === TENANT_AUTH_UNAVAILABLE,
  );
});

test('token gate mints exactly once for concurrent callers', async () => {
  const { gate, calls } = mintOnce();
  const results = await Promise.all(Array.from({ length: 20 }, () => gate.getToken()));
  assert.equal(calls.count, 1);
  assert.equal(results.length, 20);
  assert.ok(results.every((t) => t === 'tenant-token'));
});

test('token gate refreshes a token inside the refresh margin', async () => {
  let n = 0;
  const gate = createTokenGate({
    mint: async () => {
      n += 1;
      return n === 1
        ? { token: 'tok-near', claims: claims({ exp: NOW_S + 90 }) }
        : { token: 'tok-fresh', claims: claims() };
    },
    now: clock,
    refreshMarginMs: 120000,
  });
  assert.equal(await gate.getToken(), 'tok-near');
  assert.equal(await gate.getToken(), 'tok-fresh');
  assert.equal(n, 2);
});

test('claims: a missing authenticated role is rejected', () => {
  assert.throws(
    () => assertTenantClaims(claims({ role: 'anon' }), clock),
    TenantTokenError,
  );
});

test('claims: HS256, a bad subject, a long lifetime and a missing kid are rejected', () => {
  for (const bad of [
    claims({ alg: 'HS256' }),
    claims({ sub: 'not-a-uuid' }),
    claims({ iat: NOW_S, exp: NOW_S + 901 }),
    claims({ kid: '' }),
    claims({ exp: NOW_S - 1 }),
  ]) {
    assert.throws(() => assertTenantClaims(bad, clock), TenantTokenError);
  }
});

test('workspace switch disposes the old client and clears the RAM token', async () => {
  const f = fakeClientFactory();
  const { gate } = mintOnce();
  const session = createTenantSession({
    createClientImpl: f.impl,
    descriptor: VALID,
    tokenProvider: gate,
  });
  await session.getToken();
  assert.equal(gate.size, 1);

  const pointer = selectWorkspace(session, {
    clinic_id: 'clinic-b',
    tenant_slug: 'b',
    workspace_id: 'ws-2',
  });
  assert.equal(session.state, TENANT_STATES.DISPOSED);
  assert.equal(session.client, null);
  assert.equal(f.disposeCalls.length, 1);
  assert.equal(gate.size, 0);
  assert.equal(pointer.clinic_id, 'clinic-b');
  assert.equal(pointer.workspace_id, 'ws-2');
});

test('logout clears only tenant-namespaced keys and the workspace pointer', () => {
  const storage = fakeStorage({
    'myclinic.cache.v2.clinic-a.patients': 'x',
    'myclinic.outbox.v2.clinic-a.queue': 'y',
    'myclinic.tenant.clinic-a.pointer': 'z',
    'unrelated.setting': 'keep',
  });
  const sessionStore = fakeStorage({
    [WORKSPACE_POINTER_KEY]: 'ws-1',
    other: 'keep',
  });
  const removed = clearTenantState({ storage, sessionStorage: sessionStore });
  assert.equal(removed, 4);
  assert.deepEqual(storage.keys(), ['unrelated.setting']);
  assert.deepEqual(sessionStore.keys(), ['other']);
});

test('nothing is persisted and no raw token appears in the session state', async () => {
  const storage = fakeStorage();
  const sessionStore = fakeStorage();
  const f = fakeClientFactory();
  const { gate } = mintOnce('raw-tenant-token');
  const session = createTenantSession({
    createClientImpl: f.impl,
    descriptor: VALID,
    tokenProvider: gate,
  });
  await session.getToken();
  assert.equal(storage.setCalls.length, 0);
  assert.equal(sessionStore.setCalls.length, 0);
  assert.ok(!JSON.stringify(session).includes('raw-tenant-token'));
  assert.equal(f.calls.length, 1);
  assert.equal(typeof f.calls[0].options.accessToken, 'function');
  await assert.doesNotReject(() => f.calls[0].options.accessToken());
});

test('state transitions run from no-workspace through disposed', () => {
  const f = fakeClientFactory();
  const seen = [];
  const onState = (next) => seen.push(next);
  const { gate } = mintOnce();

  const a = createTenantSession({ createClientImpl: f.impl, descriptor: null, tokenProvider: null, onState });
  assert.equal(a.state, TENANT_STATES.NO_WORKSPACE);
  const b = createTenantSession({ createClientImpl: f.impl, descriptor: VALID, tokenProvider: null, onState });
  assert.equal(b.state, TENANT_STATES.TPA_REQUIRED);
  const c = createTenantSession({ createClientImpl: f.impl, descriptor: VALID, tokenProvider: gate, onState });
  assert.equal(c.state, TENANT_STATES.READY);
  assert.equal(disposeTenantSession(c), true);
  assert.equal(c.state, TENANT_STATES.DISPOSED);
  assert.equal(disposeTenantSession(c), false);
  assert.deepEqual(seen, [
    TENANT_STATES.NO_WORKSPACE,
    TENANT_STATES.TPA_REQUIRED,
    TENANT_STATES.READY,
    TENANT_STATES.DISPOSED,
  ]);
});

test('tenant cache keys are namespaced by clinic id', () => {
  assert.deepEqual(tenantCacheKeys(''), []);
  const keys = tenantCacheKeys('clinic-a');
  assert.equal(keys.length, 3);
  assert.ok(keys.every((k) => k.includes('clinic-a')));
  assert.ok(Object.isFrozen(keys));
});
