import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CENTRAL_CACHE_PREFIX, CENTRAL_CODES, CENTRAL_DEVICE_KEY, CENTRAL_ENV_KEY, CENTRAL_ENV_URL,
  CENTRAL_GRACE_NOTE, CENTRAL_MANAGED_MESSAGE, CENTRAL_PROBE_BODY, CENTRAL_RPC, CENTRAL_SEAL_FIELDS,
  CENTRAL_UNSEALED_FIELDS, centralHostLabel, centralMatchLabel, centralStateFromResult, CENTRAL_TIER_TO_PLAN,
  blockedCentralKey, centralCacheKey, maskEmail, probeCentralReadiness, readCentralDeviceId,
  resolveCentralIdentity,
  centralHeaders, centralStatusLabel, centralSubscriptionRow, centralSyncConfig, clearCachedCentralSubscription,
  computeCentralSeal, getOrCreateCentralDeviceId, leaseWindow, normalizeEmail, normalizeOrigin,
  readCachedCentralSubscription, syncCentralSubscription,
} from '../src/lib/central-sync.mjs';
import { canRead, canWrite, licenseState } from '../src/lib/license.mjs';

/*
 * Keyless Central Auto-Sync.
 *
 * Two things are being defended here, and only one of them is the network code.
 * The other is a promise: a clinic that Central has paused must stop writing in
 * the same breath, and a clinic whose laptop lost its connection must not be
 * punished for it. Both are tested with an injected clock, an injected fetch and
 * a fake localStorage, so they hold without a browser or a central project.
 *
 * Credential-shaped fixtures are assembled from fragments at runtime on purpose.
 * A published repository gets scanned by GitHub's secret scanning, which cannot
 * tell a fixture from a leak — so literals that look like keys must not exist in
 * this file at all (scripts/check-contributing.mjs enforces the same rule).
 */

const origin = 'https://Clinic.Example.github.io/';
const email = 'Owner@Clinic.Example ';

const fakeStorage = () => {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
};

/** A key that decodes to `role: "service_role"` without ever spelling a JWT. */
function serviceRoleKey() {
  const payload = { iss: 'supabase', role: 'service_role', exp: 4102444800 };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return ['header', encoded, 'signature'].join('.');
}

/** `sb_secret_…`, without a secret-shaped literal in the file. */
const secretKey = () => ['sb', 'secret', 'fixture0000000000000000'].join('_');

const config = (overrides = {}) => ({
  enabled: true,
  url: 'https://central.example.supabase.co',
  anonKey: 'publishable-fixture-key',
  error: '',
  ...overrides,
});

const reply = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const activeAnswer = (overrides = {}) => ({
  allowed: true,
  status: 'active',
  code: 'ACTIVE',
  tier: 'growth',
  plan: 'growth',
  doctors: 5,
  frontdesk: 3,
  branches: 1,
  max_machines: 2,
  expires_at: '2027-11-02T00:00:00.000Z',
  grace_until: '2027-11-09T00:00:00.000Z',
  match_mode: 'email+url',
  server_time: '2026-11-02T00:00:00.000Z',
  ...overrides,
});

/** One successful sync, so later tests start from a sealed cache. */
async function primeCache({ storage = fakeStorage(), now = new Date('2026-11-02T09:00:00.000Z'), answer = activeAnswer() } = {}) {
  const result = await syncCentralSubscription({
    config: config(),
    clinicId: 'clinic-1',
    email,
    origin,
    storage,
    now,
    fetchImpl: async () => reply(answer),
  });
  return { storage, now, result };
}

/* ------------------------------------------------------------------ the settings */

test('an origin is compared the way Central compares it', () => {
  assert.equal(normalizeOrigin('HTTPS://Clinic.Example.github.io/'), 'https://clinic.example.github.io');
  assert.equal(normalizeOrigin('https://clinic.example.github.io/app/#/x'), 'https://clinic.example.github.io');
  assert.equal(normalizeOrigin(''), '');
});

test('an email is trimmed and lowercased', () => {
  assert.equal(normalizeEmail(email), 'owner@clinic.example');
  assert.equal(normalizeEmail(undefined), '');
});

test('an unconfigured build is simply not enabled — no error to show', () => {
  const cfg = centralSyncConfig({});
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.error, '');
});

test('a configured build is enabled, with the URL normalised', () => {
  const cfg = centralSyncConfig({
    [CENTRAL_ENV_URL]: 'https://central.example.supabase.co/',
    [CENTRAL_ENV_KEY]: 'publishable-fixture-key',
  });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.url, 'https://central.example.supabase.co');
  assert.equal(cfg.error, '');
});

test('a secret key is refused before anything is compiled with it', () => {
  const cfg = centralSyncConfig({ [CENTRAL_ENV_URL]: 'https://central.example.supabase.co', [CENTRAL_ENV_KEY]: secretKey() });
  assert.equal(cfg.enabled, false);
  assert.match(cfg.error, /secret key/);
  assert.match(cfg.error, /never be compiled into a browser bundle/);
});

test('a service_role key is refused even though it is a well-formed JWT', () => {
  assert.match(blockedCentralKey(serviceRoleKey()), /service_role/);
  const cfg = centralSyncConfig({ [CENTRAL_ENV_URL]: 'https://central.example.supabase.co', [CENTRAL_ENV_KEY]: serviceRoleKey() });
  assert.equal(cfg.enabled, false);
  assert.match(cfg.error, /service_role/);
});

test('an ordinary publishable key is not mistaken for a privileged one', () => {
  assert.equal(blockedCentralKey('publishable-fixture-key'), '');
  assert.equal(blockedCentralKey(''), '');
});

test('plain http is allowed for localhost in development only', () => {
  const local = { [CENTRAL_ENV_URL]: 'http://localhost:54321', [CENTRAL_ENV_KEY]: 'publishable-fixture-key' };
  assert.equal(centralSyncConfig({ ...local, DEV: true }).enabled, true);
  assert.equal(centralSyncConfig(local).enabled, false);
  assert.match(centralSyncConfig(local).error, /https:\/\//);
});

test('half a configuration says which half is missing', () => {
  assert.match(centralSyncConfig({ [CENTRAL_ENV_URL]: 'https://central.example.supabase.co' }).error, /ANON_KEY/);
  assert.match(centralSyncConfig({ [CENTRAL_ENV_KEY]: 'publishable-fixture-key' }).error, /SUPABASE_URL/);
});

/* ----------------------------------------------------------------- the device id */

test('the device id is created once and then reused', () => {
  const storage = fakeStorage();
  const first = getOrCreateCentralDeviceId(storage);
  assert.match(first, /^[a-f0-9]{32}$/);
  assert.equal(getOrCreateCentralDeviceId(storage), first, 'a second boot is the same machine');
  assert.equal(storage.getItem(CENTRAL_DEVICE_KEY), first);
  assert.notEqual(getOrCreateCentralDeviceId(fakeStorage()), first, 'another profile is another machine');
});

/* --------------------------------------------------------------- the happy paths */

test('an active licence maps the tier onto the plan the app already knows', async () => {
  const tiers = {
    solo: 'solo', standard: 'growth', growth: 'growth', chain: 'chain', enterprise: 'chain',
  };
  for (const [tier, plan] of Object.entries(tiers)) {
    const result = await syncCentralSubscription({
      config: config(), clinicId: 'clinic-1', email, origin, storage: fakeStorage(),
      fetchImpl: async () => reply(activeAnswer({ tier })),
    });
    assert.equal(result.allowed, true, tier);
    assert.equal(result.plan, plan, tier);
    assert.equal(result.subscriptionRow.plan, plan, tier);
  }
});

test('an active licence unlocks writing, and a lapsed one only stops writing', async () => {
  const live = await primeCache();
  const license = licenseState(live.result.subscriptionRow, new Date('2026-11-02T09:00:00.000Z'));
  assert.equal(license.status, 'active');
  assert.equal(canWrite(license), true);
  assert.equal(canRead(license), true);

  const paused = await syncCentralSubscription({
    config: config(), clinicId: 'clinic-1', email, origin, storage: fakeStorage(),
    fetchImpl: async () => reply({ allowed: false, status: 'paused', code: 'SUBSCRIPTION_PAUSED', reason: 'Not paid.' }),
  });
  const locked = licenseState(paused.subscriptionRow, new Date('2026-11-02T09:00:00.000Z'));
  assert.equal(canWrite(locked), false);
  assert.equal(canRead(locked), true, 'charts stay readable — that promise is not Central’s to break');
});

test('the card can say how this clinic was matched', () => {
  assert.match(centralMatchLabel('email+url'), /owner email and this address/);
  assert.match(centralMatchLabel('email'), /owner email/);
  assert.match(centralMatchLabel('url'), /this address/);
  assert.equal(centralMatchLabel(''), '');
  assert.match(CENTRAL_GRACE_NOTE, /never beyond them/);
});

test('every refusal code the central project can send stops writes', async () => {
  const cases = [
    ['SUBSCRIPTION_PAUSED', 'paused'],
    ['SUBSCRIPTION_EXPIRED', 'expired'],
    ['SUBSCRIPTION_NOT_FOUND', 'unlicensed'],
    ['SEAT_LIMIT_REACHED', 'seat_limit'],
    ['ORIGIN_MISMATCH', 'origin_mismatch'],
  ];
  for (const [code, status] of cases) {
    const result = await syncCentralSubscription({
      config: config(), clinicId: 'clinic-1', email, origin, storage: fakeStorage(),
      fetchImpl: async () => reply({ allowed: false, status, code, reason: 'because' }),
    });
    assert.equal(result.allowed, false, code);
    assert.equal(result.code, code, code);
    assert.equal(centralStatusLabel(result.status), centralStatusLabel(status), code);
    const license = licenseState(result.subscriptionRow, new Date('2026-11-02T09:00:00.000Z'));
    assert.equal(canWrite(license), false, code);
    assert.equal(result.subscriptionRow.collection_ref, code, 'the code is recorded, not invented');
    assert.equal(result.subscriptionRow.plan, 'solo', 'a refused clinic is not left on a paid plan');
  }
  assert.equal(CENTRAL_CODES.SUBSCRIPTION_PAUSED, 'paused');
});

test('dual (email+url), email-only and url-only all verify', async () => {
  const modes = [
    { match_mode: 'email+url', email, origin },
    { match_mode: 'email', email, origin: '' },
    { match_mode: 'url', email: '', origin },
  ];
  for (const mode of modes) {
    const seen = [];
    const result = await syncCentralSubscription({
      config: config(), clinicId: 'clinic-1', email: mode.email, origin: mode.origin, storage: fakeStorage(),
      fetchImpl: async (url, init) => {
        seen.push([url, init]);
        return reply(activeAnswer({ match_mode: mode.match_mode }));
      },
    });
    assert.equal(result.allowed, true, mode.match_mode);
    assert.equal(result.matchMode, mode.match_mode);
    const body = JSON.parse(seen[0][1].body);
    assert.equal(body.p_email, normalizeEmail(mode.email), `${mode.match_mode}: email is normalised`);
    assert.equal(body.p_origin, normalizeOrigin(mode.origin), `${mode.match_mode}: origin is normalised`);
    assert.equal(seen[0][0], `https://central.example.supabase.co/rest/v1/rpc/${CENTRAL_RPC}`);
  }
});

/* ------------------------------------------------- cross-project header isolation */

test('the central project is called with an apikey and nothing of ours', async () => {
  let seen = null;
  await syncCentralSubscription({
    config: config({ anonKey: 'sb_publishable_fixture-key' }),
    clinicId: 'clinic-1', email, origin, storage: fakeStorage(),
    fetchImpl: async (url, init) => { seen = init; return reply(activeAnswer()); },
  });

  assert.equal(seen.method, 'POST');
  assert.equal(seen.headers.apikey, 'sb_publishable_fixture-key');
  assert.equal(seen.headers.authorization, undefined, 'an sb_publishable_ key needs no bearer');
  assert.equal(seen.credentials, 'omit', 'no cookies travel to another project');
  assert.deepEqual(
    Object.keys(seen.headers).sort(),
    ['accept', 'apikey', 'content-type'],
    'exactly one credential header, and it is the central anon key',
  );
  const body = JSON.parse(seen.body);
  assert.deepEqual(Object.keys(body).sort(), ['p_device_id', 'p_email', 'p_origin'], 'no session, no clinic id, no token');
});

test('a legacy anon key is repeated as the bearer, and a session token never is', async () => {
  const headers = centralHeaders(config({ anonKey: 'legacy-anon-fixture-key' }));
  assert.equal(headers.authorization, `Bearer legacy-anon-fixture-key`);
  assert.equal(
    Object.values(headers).some((v) => /access_token|refresh_token|token_type/.test(String(v))),
    false,
    'no session JWT is ever attached',
  );
  assert.equal(centralHeaders(config({ anonKey: 'sb_publishable_xyz' })).authorization, undefined);
});

test('the request never carries a clinic id or a licence key', async () => {
  let body = null;
  await syncCentralSubscription({
    config: config(), clinicId: 'clinic-1', email, origin, storage: fakeStorage(),
    fetchImpl: async (url, init) => { body = JSON.parse(init.body); return reply(activeAnswer()); },
  });
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'p_clinic'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'p_license_key'), false);
});

/* -------------------------------------------------------------- the sealed cache */

test('a good answer is cached, sealed, and read back', async () => {
  const { storage, now, result } = await primeCache();
  assert.equal(result.fromCache, false);
  assert.equal(result.ok, true);

  const raw = JSON.parse(storage.getItem(centralCacheKey('clinic-1')));
  assert.match(raw.seal, /^[a-f0-9]{64}$/, 'a SHA-256 digest');
  assert.ok(raw.syncedAt);

  const cached = await readCachedCentralSubscription({
    clinicId: 'clinic-1', origin, email, deviceId: raw.lease && getOrCreateCentralDeviceId(storage), storage, now,
  });
  assert.ok(cached);
  assert.equal(cached.lease.tier, 'growth');
  assert.equal(cached.lease.expires_at, '2027-11-02T00:00:00.000Z');
});

test('the seal covers the fields that decide whether writing is allowed', async () => {
  const subject = { clinicId: 'clinic-1', origin, email, deviceId: 'abc123' };
  const base = { allowed: true, status: 'active', tier: 'growth', plan: 'growth', expires_at: '2027-01-01T00:00:00.000Z', grace_until: '2027-01-08T00:00:00.000Z' };
  const seal = await computeCentralSeal(base, subject);
  assert.equal(seal, await computeCentralSeal({ ...base }, subject), 'deterministic');

  for (const change of [{ plan: 'chain' }, { tier: 'chain' }, { expires_at: '2037-01-01T00:00:00.000Z' }, { grace_until: '2037-01-01T00:00:00.000Z' }, { status: 'paused' }, { allowed: false }]) {
    assert.notEqual(await computeCentralSeal({ ...base, ...change }, subject), seal, JSON.stringify(change));
  }
  assert.notEqual(await computeCentralSeal(base, { ...subject, clinicId: 'clinic-2' }), seal);
  assert.notEqual(await computeCentralSeal(base, { ...subject, origin: 'https://other.example' }), seal);
  assert.notEqual(await computeCentralSeal(base, { ...subject, deviceId: 'other' }), seal);
});

test('editing the plan in DevTools wipes the cache and locks writes', async () => {
  const { storage, now } = await primeCache();
  const key = centralCacheKey('clinic-1');
  const tampered = JSON.parse(storage.getItem(key));
  tampered.lease.plan = 'chain';
  tampered.lease.tier = 'chain';
  storage.setItem(key, JSON.stringify(tampered));

  const deviceId = getOrCreateCentralDeviceId(storage);
  const cached = await readCachedCentralSubscription({ clinicId: 'clinic-1', origin, email, deviceId, storage, now });
  assert.equal(cached, null, 'the seal no longer matches');
  assert.equal(storage.getItem(key), null, 'and the cache is gone, not merely ignored');
});

test('editing the expiry in DevTools is caught the same way', async () => {
  const { storage, now } = await primeCache();
  const key = centralCacheKey('clinic-1');
  const tampered = JSON.parse(storage.getItem(key));
  tampered.lease.expires_at = '2037-01-01T00:00:00.000Z';
  storage.setItem(key, JSON.stringify(tampered));

  const cached = await readCachedCentralSubscription({
    clinicId: 'clinic-1', origin, email, deviceId: getOrCreateCentralDeviceId(storage), storage, now,
  });
  assert.equal(cached, null);
});

test('a lease sealed for another deployment is not this clinic’s', async () => {
  const { storage, now } = await primeCache();
  const cached = await readCachedCentralSubscription({
    clinicId: 'clinic-1', origin: 'https://somebody-else.example', email,
    deviceId: getOrCreateCentralDeviceId(storage), storage, now,
  });
  assert.equal(cached, null);
});

/* ------------------------------------------------------------- the offline grace */

test('a network failure keeps a cached clinic working inside the grace', async () => {
  const { storage } = await primeCache();
  const deviceId = getOrCreateCentralDeviceId(storage);

  const result = await syncCentralSubscription({
    config: config(), clinicId: 'clinic-1', email, origin, storage, deviceId,
    now: new Date('2026-11-04T09:00:00.000Z'),               // two days later, still licensed
    fetchImpl: async () => { throw new Error('offline'); },
  });

  assert.equal(result.allowed, true);
  assert.equal(result.fromCache, true);
  assert.equal(result.offline, true);
  assert.equal(result.code, 'OFFLINE_GRACE');
  assert.equal(result.plan, 'growth');
  assert.equal(canWrite(licenseState(result.subscriptionRow, new Date('2026-11-04T09:00:00.000Z'))), true);
});

test('an offline device with no cache is read-only, not silently licensed', async () => {
  const result = await syncCentralSubscription({
    config: config(), clinicId: 'clinic-1', email, origin, storage: fakeStorage(),
    fetchImpl: async () => { throw new Error('offline'); },
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, 'offline');
  assert.equal(canWrite(licenseState(result.subscriptionRow)), false);
});

test('the grace ends when the contract or the grace date passes', async () => {
  assert.equal(leaseWindow({ expires_at: '2027-01-01T00:00:00.000Z' }, new Date('2026-06-01T00:00:00.000Z')).usable, true);
  assert.equal(leaseWindow({ expires_at: '2027-01-01T00:00:00.000Z' }, new Date('2027-01-02T00:00:00.000Z')).usable, false);
  assert.equal(
    leaseWindow({ expires_at: '2027-01-01T00:00:00.000Z', grace_until: '2026-12-31T00:00:00.000Z' }, new Date('2026-12-31T12:00:00.000Z')).usable,
    false,
    'the earlier of the two dates wins',
  );
  assert.equal(leaseWindow({ expires_at: 'soon' }, new Date('2026-06-01T00:00:00.000Z')).usable, false, 'an unreadable date is not an eternal licence');
  assert.equal(leaseWindow({}, new Date()).usable, false);

  const { storage } = await primeCache();
  const [expired] = [await syncCentralSubscription({
    config: config(), clinicId: 'clinic-1', email, origin, storage,
    now: new Date('2027-12-01T00:00:00.000Z'),               // well past expires_at and grace_until
    fetchImpl: async () => { throw new Error('offline'); },
  })];
  assert.equal(expired.allowed, false);
  assert.equal(canWrite(licenseState(expired.subscriptionRow)), false);
});

test('a paused clinic loses its cache in the same call that learns about it', async () => {
  const { storage } = await primeCache();
  const key = centralCacheKey('clinic-1');
  assert.ok(storage.getItem(key), 'a lease exists to be revoked');

  const result = await syncCentralSubscription({
    config: config(), clinicId: 'clinic-1', email, origin, storage,
    now: new Date('2026-11-15T09:00:00.000Z'),
    fetchImpl: async () => reply({ allowed: false, status: 'paused', code: 'SUBSCRIPTION_PAUSED', reason: 'Payment overdue.' }),
  });

  assert.equal(storage.getItem(key), null, 'deleted immediately');
  assert.equal(result.allowed, false);
  assert.match(result.reason, /Payment overdue/);
  const license = licenseState(result.subscriptionRow, new Date('2026-11-15T09:00:00.000Z'));
  assert.equal(license.status, 'expired');
  assert.equal(canWrite(license), false);
  assert.equal(canRead(license), true);

  // And a later sync that fails to reach Central cannot resurrect it.
  const offline = await syncCentralSubscription({
    config: config(), clinicId: 'clinic-1', email, origin, storage,
    now: new Date('2026-11-15T10:00:00.000Z'),
    fetchImpl: async () => { throw new Error('offline'); },
  });
  assert.equal(offline.allowed, false);
});

test('a server error is not a verdict, so the cached lease survives it', async () => {
  const { storage } = await primeCache();
  const result = await syncCentralSubscription({
    config: config(), clinicId: 'clinic-1', email, origin, storage,
    now: new Date('2026-11-03T09:00:00.000Z'),
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => { throw new Error('gateway page'); } }),
  });
  assert.equal(result.allowed, true);
  assert.equal(result.fromCache, true);
  assert.ok(storage.getItem(centralCacheKey('clinic-1')), 'the lease was not revoked by an outage');
});

test('an unconfigured build refuses and caches nothing', async () => {
  const storage = fakeStorage();
  const result = await syncCentralSubscription({
    config: { enabled: false, url: '', anonKey: '', error: 'not configured' },
    clinicId: 'clinic-1', email, origin, storage,
    fetchImpl: async () => { throw new Error('must not be called'); },
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, 'not-configured');
  assert.equal(storage.getItem(centralCacheKey('clinic-1')), null);
});

test('a refusal leaves the row readable and nothing else behind', () => {
  const row = centralSubscriptionRow({ allowed: false, code: 'ORIGIN_MISMATCH' }, { clinicId: 'clinic-1' });
  assert.deepEqual(row, {
    clinic_id: 'clinic-1', status: 'expired', plan: 'solo', interval: 'yearly',
    current_period_end: null, collection_ref: 'ORIGIN_MISMATCH',
  });
  assert.equal(CENTRAL_CACHE_PREFIX, 'myclinic.central.subscription.v2.');
  assert.equal(CENTRAL_MANAGED_MESSAGE, 'This clinic subscription is managed centrally.');
});

/* ----------------------------------------------------------- the contract window */

/*
 * The Subscription screen prints "plan · start · end" from these three facts, so
 * the start date has to travel the whole way: RPC answer → lease → cached lease
 * → local mirror row → `licenseState()`. A date that dies in the middle would
 * show as a blank card and look like a central-project fault.
 */

test('the contract start reaches the verdict, the mirror row and the licence view', async () => {
  const { result } = await primeCache({ answer: activeAnswer({ started_at: '2026-11-01T00:00:00.000Z' }) });
  assert.equal(result.startedAt, '2026-11-01T00:00:00.000Z');
  assert.equal(result.subscriptionRow.current_period_start, '2026-11-01T00:00:00.000Z');

  const license = licenseState(result.subscriptionRow, new Date('2026-11-02T09:00:00.000Z'));
  assert.equal(license.startsAt, '2026-11-01T00:00:00.000Z');
  assert.equal(license.endsAt, '2027-11-02T00:00:00.000Z');
});

test('current_period_start is accepted as the same fact under its table name', async () => {
  const { result } = await primeCache({ answer: activeAnswer({ current_period_start: '2026-10-15T00:00:00.000Z' }) });
  assert.equal(result.startedAt, '2026-10-15T00:00:00.000Z');
  assert.equal(result.subscriptionRow.current_period_start, '2026-10-15T00:00:00.000Z');
});

test('an answer with no start date stays blank instead of being invented', async () => {
  const { result } = await primeCache();
  assert.equal(result.startedAt, null);
  assert.equal(result.subscriptionRow.current_period_start, null);
  assert.equal(licenseState(result.subscriptionRow).startsAt, null);
});

test('the start date survives a sync that falls back to the sealed lease', async () => {
  const storage = fakeStorage();
  const now = new Date('2026-11-02T09:00:00.000Z');
  await primeCache({ storage, now, answer: activeAnswer({ started_at: '2026-11-01T00:00:00.000Z' }) });

  const offline = await syncCentralSubscription({
    config: config(), clinicId: 'clinic-1', email, origin, storage, now,
    fetchImpl: async () => { throw new Error('offline'); },
  });
  assert.equal(offline.offline, true);
  assert.equal(offline.startedAt, '2026-11-01T00:00:00.000Z');
  assert.equal(offline.subscriptionRow.current_period_start, '2026-11-01T00:00:00.000Z');
});

test('the start date is carried but deliberately outside the seal', async () => {
  assert.equal(CENTRAL_SEAL_FIELDS.includes('started_at'), false, 'a display-only date grants nothing');
  assert.equal(CENTRAL_UNSEALED_FIELDS.includes('started_at'), true);

  const { storage, now } = await primeCache({ answer: activeAnswer({ started_at: '2026-11-01T00:00:00.000Z' }) });
  const key = centralCacheKey('clinic-1');
  const edited = JSON.parse(storage.getItem(key));
  edited.lease.started_at = '2019-01-01T00:00:00.000Z';
  storage.setItem(key, JSON.stringify(edited));

  const cached = await readCachedCentralSubscription({
    clinicId: 'clinic-1', origin, email, deviceId: getOrCreateCentralDeviceId(storage), storage, now,
  });
  assert.ok(cached, 'the lease is still usable: editing a start date promotes nobody');
  assert.equal(cached.lease.expires_at, '2027-11-02T00:00:00.000Z', 'the dates that decide writing stay sealed');
});

/* ------------------------------------------------- the diagnostic surface (1.25.0) */

/*
 * Central inserts a machine row only on the allowed path, so from its dashboard
 * "never called", "called and refused" and "this build has no central project"
 * are the same picture. Everything below exists so the client can tell those
 * apart on its own screen — and so the diagnostic never becomes a second place
 * where credentials or a licence decision live.
 */

test('a cloud origin is one origin whether or not a path is written after it', () => {
  assert.equal(normalizeOrigin('https://Clinic.github.io/myClinic/'), 'https://clinic.github.io');
  assert.equal(normalizeOrigin('https://clinic.github.io'), 'https://clinic.github.io');
  assert.equal(normalizeOrigin('https://CLINIC.github.io/myClinic'), normalizeOrigin('https://clinic.github.io'));
});

test('the identity sent is resolved in one documented order, and says where it came from', () => {
  const staff = [
    { role: 'frontdesk', email: 'desk@clinic.example' },
    { role: 'owner', email: ' Owner@Clinic.Example ' },
  ];
  assert.deepEqual(
    resolveCentralIdentity({ staff, clinic: { email: 'clinic@clinic.example' }, subscription: { billing_email: 'bill@clinic.example' }, sessionEmail: 'doc@clinic.example' }),
    { email: 'owner@clinic.example', source: 'owner' },
  );
  assert.deepEqual(
    resolveCentralIdentity({ staff: [{ role: 'frontdesk', email: 'desk@clinic.example' }], clinic: { email: 'Clinic@Clinic.Example' } }),
    { email: 'clinic@clinic.example', source: 'clinic' },
  );
  assert.deepEqual(resolveCentralIdentity({ staff: [], subscription: { billing_email: 'Bill@Clinic.Example' } }), { email: 'bill@clinic.example', source: 'billing' });
  assert.deepEqual(resolveCentralIdentity({ sessionEmail: 'DOC@clinic.example' }), { email: 'doc@clinic.example', source: 'session' });
  assert.deepEqual(resolveCentralIdentity({}), { email: '', source: 'none' });
  // A receptionist's address must never be sent as the licence identity while an
  // owner row exists — that is the mismatch this whole card exists to explain.
  assert.equal(resolveCentralIdentity({ staff }).email, 'owner@clinic.example');
});

test('an email is masked for the card, and a card with nothing to show says so', () => {
  assert.equal(maskEmail('owner@clinic.example'), 'o•••@clinic.example');
  assert.equal(maskEmail(''), '');
  assert.equal(maskEmail(undefined), '');
  assert.equal(maskEmail('O@C.EXAMPLE'), 'o•••@c.example');
});

test('the central project is named by host only — never a key, never a path', () => {
  assert.equal(centralHostLabel('https://inaqzvzfongngahxptzw.supabase.co'), 'inaqzvzfongngahxptzw.supabase.co');
  assert.equal(centralHostLabel('https://central.example.supabase.co/rest/v1/rpc/x?apikey=leak'), 'central.example.supabase.co');
  assert.equal(centralHostLabel(''), '');
  assert.equal(centralHostLabel('not a url'), '');
});

test('a refusal keeps its code and its reason all the way into centralState', async () => {
  // This is the dual-pinned mismatch: the row exists, but not for this pair.
  const answer = { allowed: false, status: 'unlicensed', code: 'SUBSCRIPTION_NOT_FOUND', reason: 'No active subscription matched this clinic email / URL.' };
  const result = await syncCentralSubscription({
    config: config(), clinicId: 'clinic-1', email: 'someone@clinic.example', origin,
    storage: fakeStorage(), fetchImpl: async () => reply(answer),
  });

  const state = centralStateFromResult(result);
  assert.equal(state.state, 'error');
  assert.equal(state.verdict.code, 'SUBSCRIPTION_NOT_FOUND', 'the operator needs the code, not just "refused"');
  assert.match(state.error, /No active subscription matched this clinic email \/ URL\./);
  assert.equal(state.syncedAt, result.syncedAt, 'the attempt is timestamped even when it is refused');

  // and an allowed answer maps to a calm state with no error text
  const allowed = await syncCentralSubscription({
    config: config(), clinicId: 'clinic-1', email, origin, storage: fakeStorage(),
    fetchImpl: async () => reply(activeAnswer()),
  });
  assert.equal(centralStateFromResult(allowed).state, 'ok');
  assert.equal(centralStateFromResult(allowed).error, '');
});

/* ------------------------------------------------------------- the readiness probe */

test('the readiness probe posts the health-check body and nothing of this clinic', async () => {
  let seen = null;
  const storage = fakeStorage();
  const probe = await probeCentralReadiness(config(), {
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return reply({ ok: true, sync_ready: true, schema_version: 2, server_time: '2026-11-09T10:51:45.000Z' });
    },
  });

  assert.equal(seen.url, 'https://central.example.supabase.co/rest/v1/rpc/sync_clinic_subscription');
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.credentials, 'omit');
  assert.deepEqual(JSON.parse(seen.init.body), { p_email: '', p_origin: '', p_device_id: 'healthcheck' });
  assert.deepEqual({ ...CENTRAL_PROBE_BODY }, { p_email: '', p_origin: '', p_device_id: 'healthcheck' });
  assert.equal(seen.init.headers.apikey, 'publishable-fixture-key');
  assert.equal(
    seen.init.headers.authorization,
    'Bearer publishable-fixture-key',
    'a legacy eyJ… key predates publishable keys, so PostgREST is given it as the bearer token — that key, never a session JWT',
  );
  assert.equal(storage.map.size, 0, 'a probe writes nothing, anywhere');

  assert.deepEqual(probe, { ok: true, syncReady: true, schemaVersion: 2, httpStatus: 200, error: '' });
});

test('the probe reports an unconfigured build without calling anything', async () => {
  let called = false;
  const probe = await probeCentralReadiness(centralSyncConfig({}), { fetchImpl: async () => { called = true; } });
  assert.equal(called, false);
  assert.equal(probe.ok, false);
  assert.match(probe.error, /not configured/i);
});

test('the probe distinguishes a dead network from a missing RPC', async () => {
  const offline = await probeCentralReadiness(config(), { fetchImpl: async () => { throw new Error('network down'); } });
  assert.equal(offline.ok, false);
  assert.equal(offline.httpStatus, null);
  assert.match(offline.error, /Could not reach the central project/);

  const missing = await probeCentralReadiness(config(), {
    fetchImpl: async () => reply({ message: 'Could not find the function public.sync_clinic_subscription' }, 404),
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.httpStatus, 404);
  assert.match(missing.error, /answered 404/);
  assert.match(missing.error, /Could not find the function/);

  const wrongBody = await probeCentralReadiness(config(), { fetchImpl: async () => reply({ hello: 'world' }) });
  assert.equal(wrongBody.ok, false);
  assert.match(wrongBody.error, /not with a readiness body/);
});

test('the device id is read without ever being created by a render', () => {
  const storage = fakeStorage();
  assert.equal(readCentralDeviceId(storage), '');
  assert.equal(storage.map.size, 0, 'reading the id must not mint one');
  storage.setItem(CENTRAL_DEVICE_KEY, 'ABCDEF0123456789');
  assert.equal(readCentralDeviceId(storage), 'abcdef0123456789');
  storage.setItem(CENTRAL_DEVICE_KEY, 'not-hex');
  assert.equal(readCentralDeviceId(storage), '');
});

test('a modern publishable key travels as apikey only, and never as an identity', async () => {
  let seen = null;
  await probeCentralReadiness(
    { enabled: true, url: 'https://central.example.supabase.co', anonKey: ['sb', 'publishable', 'fixture'].join('_'), error: '' },
    { fetchImpl: async (url, init) => { seen = init; return reply({ ok: true, sync_ready: true, schema_version: 2 }); } },
  );
  assert.equal('authorization' in seen.headers, false, 'no bearer header for a publishable key');
  assert.equal(JSON.stringify(seen.headers).includes('Bearer'), false);
});
