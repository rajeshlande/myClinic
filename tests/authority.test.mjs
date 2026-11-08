import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  AUTHORITY_SEATS, authorityCacheKey, authorityConfig, authorityErrorMessage, authorityView,
  buildFingerprint, clearAuthorityToken, decodeJwt, readAuthorityToken, seatsForTier, syncDue,
  tierToPlan, verifyCapabilityToken, writeAuthorityToken,
} from '../src/lib/authority.mjs';
import { cachedClinicLicense, syncClinicLicense } from '../src/lib/authority-sync.mjs';

/* ---------------------------------------------------------------- a real signer
 * The verifier is only worth testing against real RS256 signatures, so this file
 * mints its own keypair and signs its own tokens — exactly what the authority's
 * Edge Function does with LICENSE_PRIVATE_KEY.
 */
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const ORIGIN = 'https://clinic.example.github.io';
const FINGERPRINT = 'web:https://clinic.example.github.io';
const LICENSE_KEY = '7A3F91C4082BD6E54A109F83C2D17E6B';
const NOW = new Date('2026-11-02T09:00:00.000Z');
const nowSeconds = Math.floor(NOW.getTime() / 1000);

const b64url = (value) => Buffer.from(value).toString('base64url');

function claims(overrides = {}) {
  return {
    iss: 'myclinic-license-authority',
    sub: 'sub_9f2c41',
    license_key: LICENSE_KEY,
    tier: 'standard',
    machine_fingerprint: FINGERPRINT,
    allowed_origin: ORIGIN,
    max_machines: 1,
    subscription_expires_at: '2027-02-01T00:00:00.000Z',
    iat: nowSeconds,
    exp: nowSeconds + 7 * 86_400,
    ...overrides,
  };
}

/** Header and payload are strings so a test can tamper with either. */
function mintJwt(payload = claims(), header = { alg: 'RS256', typ: 'JWT' }) {
  const head = b64url(JSON.stringify(header));
  const body = b64url(JSON.stringify(payload));
  const signature = sign('sha256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url');
  return `${head}.${body}.${signature}`;
}

const verify = (token, extra = {}) => verifyCapabilityToken(token, PUBLIC_PEM, {
  nowSeconds, expectedFingerprint: FINGERPRINT, expectedLicenseKey: LICENSE_KEY, ...extra,
});

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    get length() { return map.size; },
  };
}

/* ------------------------------------------------------------------- the token */

test('a token signed by the authority verifies, and the plan follows the tier', async () => {
  const result = await verify(mintJwt());
  assert.equal(result.valid, true, result.reason);
  assert.equal(result.claims.tier, 'standard');

  const view = authorityView({ claims: result.claims, now: NOW });
  assert.equal(view.plan, 'growth');           // standard → the app's growth plan
  assert.equal(view.status, 'active');
  assert.equal(view.subscriptionId, 'sub_9f2c41');
  assert.equal(view.origin, ORIGIN);
  assert.deepEqual(view.seats, { doctors: 5, frontdesk: 3, branches: 1 });
  assert.equal(view.daysLeft, 91);
});

test('a payload edited after signing is refused', async () => {
  const token = mintJwt();
  const [head, , signature] = token.split('.');
  const upgraded = b64url(JSON.stringify(claims({ tier: 'enterprise', max_machines: 999 })));
  const result = await verify(`${head}.${upgraded}.${signature}`);
  assert.equal(result.valid, false);
  assert.equal(result.code, 'token-signature');
});

test('alg:none and HS256 are both refused before anything is trusted', async () => {
  const none = `${b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${b64url(JSON.stringify(claims()))}.`;
  assert.equal((await verify(none)).code, 'token-alg');
  assert.equal((await verify(mintJwt(claims(), { alg: 'HS256', typ: 'JWT' }))).code, 'token-alg');
});

test('an expired token, a future-dated token and the wrong issuer are all refused', async () => {
  assert.equal((await verify(mintJwt(claims({ exp: nowSeconds - 600 })))).code, 'token-expired');
  assert.equal((await verify(mintJwt(claims({ iat: nowSeconds + 600 })))).code, 'token-future');
  assert.equal((await verify(mintJwt(claims({ iss: 'someone-else' })))).code, 'token-issuer');
});

test('a token minted for another origin or another licence key does not count here', async () => {
  const otherOrigin = await verify(mintJwt(claims({ machine_fingerprint: 'web:https://attacker.example' })));
  assert.equal(otherOrigin.code, 'token-fingerprint');

  const otherKey = await verify(mintJwt(claims({ license_key: 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF' })));
  assert.equal(otherKey.code, 'token-key-mismatch');
});

test('a contract that has run out reads as read-only, not as active', async () => {
  const result = await verify(mintJwt(claims({ subscription_expires_at: '2026-10-01T00:00:00.000Z' })));
  assert.equal(result.valid, true, 'the token itself is still genuine');
  const view = authorityView({ claims: result.claims, now: NOW });
  assert.equal(view.status, 'read_only');
  assert.ok(view.daysLeft < 0);
});

test('a token with no subscription expiry is refused rather than assumed infinite', async () => {
  const result = await verify(mintJwt(claims({ subscription_expires_at: undefined })));
  assert.equal(result.code, 'token-expiry-missing');
});

test('garbage never throws, it comes back as a refusal code', async () => {
  for (const bad of ['', 'not-a-jwt', 'a.b.c', 'eyJhbGciOiJSUzI1NiJ9.eyJ9.x']) {
    const result = await verify(bad);
    assert.equal(result.valid, false);
    assert.ok(result.code.startsWith('token-'));
  }
});

/* ------------------------------------------------------- tiers, seats, helpers */

test('every authority tier maps onto a plan the app already understands', () => {
  assert.equal(tierToPlan('solo'), 'solo');
  assert.equal(tierToPlan('standard'), 'growth');
  assert.equal(tierToPlan('growth'), 'growth');
  assert.equal(tierToPlan('chain'), 'chain');
  assert.equal(tierToPlan('enterprise'), 'chain');
  assert.equal(tierToPlan('platinum'), 'solo', 'unknown tiers fall to the smallest plan, never the largest');
  assert.equal(tierToPlan(undefined), 'solo');
  assert.equal(seatsForTier('chain').doctors, null, 'chain is unlimited');
  assert.deepEqual(seatsForTier('unknown'), AUTHORITY_SEATS.solo);
});

test('the deployment fingerprint is the origin, normalised', () => {
  assert.equal(buildFingerprint('https://Clinic.Example.GitHub.io/'), FINGERPRINT);
  assert.equal(buildFingerprint('http://localhost:4173'), 'web:http://localhost:4173');
  assert.throws(() => buildFingerprint('clinic.github.io'));
  assert.throws(() => buildFingerprint(''));
});

test('the authority is only "configured" when a public key is present', () => {
  assert.equal(authorityConfig({}).enabled, false);
  assert.equal(authorityConfig({ VITE_LICENSE_PUBLIC_KEY: 'scratch' }).enabled, false);
  const configured = authorityConfig({ VITE_LICENSE_PUBLIC_KEY: PUBLIC_PEM });
  assert.equal(configured.enabled, true);
  assert.equal(configured.functionName, 'sync-clinic-license');
  // the private half of the pair must never be read from the bundle
  assert.equal('VITE_LICENSE_KEY' in configured, false);
});

test('a phone-home is due every six hours, not on every render', () => {
  assert.equal(syncDue({ lastSyncedAt: null, now: NOW }), true);
  assert.equal(syncDue({ lastSyncedAt: 'nonsense', now: NOW }), true);
  assert.equal(syncDue({ lastSyncedAt: new Date(NOW.getTime() - 3_600_000).toISOString(), now: NOW }), false);
  assert.equal(syncDue({ lastSyncedAt: new Date(NOW.getTime() - 7 * 3_600_000).toISOString(), now: NOW }), true);
});

test('the cached token is per clinic and can be cleared', () => {
  const storage = memoryStorage();
  writeAuthorityToken('clinic-a', mintJwt(), { storage, syncedAt: NOW.toISOString() });
  assert.equal(authorityCacheKey('clinic-a'), 'myclinic.authority.v1.clinic-a');
  assert.equal(readAuthorityToken('clinic-a', { storage }).syncedAt, NOW.toISOString());
  assert.equal(readAuthorityToken('clinic-b', { storage }), null, 'one clinic cannot read another’s token');
  clearAuthorityToken('clinic-a', { storage });
  assert.equal(readAuthorityToken('clinic-a', { storage }), null);
});

test('decodeJwt splits a token without trusting it', () => {
  const { header, claims: payload } = decodeJwt(mintJwt());
  assert.equal(header.alg, 'RS256');
  assert.equal(payload.sub, 'sub_9f2c41');
  assert.equal(decodeJwt('rubbish').claims, null);
});

test('refusal codes become sentences a clinic owner can act on', () => {
  assert.match(authorityErrorMessage('not-owner'), /owner/i);
  assert.match(authorityErrorMessage('authority-refused'), /refused/i);
  assert.equal(authorityErrorMessage('nonsense', 'fallback sentence'), 'fallback sentence');
});

/* ------------------------------------------------------- the sync orchestration */

function invokeReturning(payload) {
  return async () => ({ data: payload, error: null });
}

test('a successful sync caches the token and returns a verified view', async () => {
  const storage = memoryStorage();
  const token = mintJwt();
  const result = await syncClinicLicense({
    invoke: invokeReturning({ ok: true, token, synced_at: NOW.toISOString(), plan: 'growth' }),
    clinicId: 'clinic-a', publicKeyPem: PUBLIC_PEM, origin: ORIGIN, storage, now: NOW,
  });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.fromCache, false);
  assert.equal(result.view.plan, 'growth');
  assert.equal(result.view.tier, 'standard');
  assert.equal(readAuthorityToken('clinic-a', { storage }).token, token);
});

test('a failed sync falls back to the cached token, and says so', async () => {
  const storage = memoryStorage();
  writeAuthorityToken('clinic-a', mintJwt(), { storage, syncedAt: NOW.toISOString() });

  const offline = await syncClinicLicense({
    invoke: async () => { throw new Error('Failed to send a request to the Edge Function'); },
    clinicId: 'clinic-a', publicKeyPem: PUBLIC_PEM, origin: ORIGIN, storage, now: NOW,
  });
  assert.equal(offline.ok, false);
  assert.equal(offline.code, 'network');
  assert.equal(offline.fromCache, true, 'still licensed for the life of the cached token');
  assert.equal(offline.view.plan, 'growth');
  assert.equal(offline.syncedAt, NOW.toISOString());
});

test('a failed sync with no usable cache leaves the clinic with no authority view', async () => {
  const storage = memoryStorage();
  // well past the two-minute clock tolerance, not merely a minute
  writeAuthorityToken('clinic-a', mintJwt(claims({ exp: nowSeconds - 600 })), { storage, syncedAt: NOW.toISOString() });
  const expired = await syncClinicLicense({
    invoke: async () => { throw new Error('offline'); },
    clinicId: 'clinic-a', publicKeyPem: PUBLIC_PEM, origin: ORIGIN, storage, now: NOW,
  });
  assert.equal(expired.view, null, 'an expired cached token must not keep the clinic open');

  const never = await syncClinicLicense({
    invoke: async () => { throw new Error('offline'); },
    clinicId: 'clinic-b', publicKeyPem: PUBLIC_PEM, origin: ORIGIN, storage, now: NOW,
  });
  assert.equal(never.view, null);
  assert.equal(never.fromCache, false);
});

test('the Edge Function’s own refusal is passed through, not swallowed', async () => {
  const storage = memoryStorage();
  const result = await syncClinicLicense({
    invoke: async () => ({ data: { ok: false, code: 'not-owner', error: 'Only the clinic owner can sync the licence.' }, error: null }),
    clinicId: 'clinic-a', publicKeyPem: PUBLIC_PEM, origin: ORIGIN, storage, now: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'not-owner');
  assert.match(result.error, /owner/i);
});

test('a token that does not verify is never cached', async () => {
  const storage = memoryStorage();
  const forged = (() => {
    const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const body = b64url(JSON.stringify(claims({ tier: 'enterprise' })));
    return `${head}.${body}.deadbeef`;
  })();
  const result = await syncClinicLicense({
    invoke: invokeReturning({ ok: true, token: forged }),
    clinicId: 'clinic-a', publicKeyPem: PUBLIC_PEM, origin: ORIGIN, storage, now: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'token-signature');
  assert.equal(readAuthorityToken('clinic-a', { storage }), null);
});

test('the cached licence is readable without the network', async () => {
  const storage = memoryStorage();
  writeAuthorityToken('clinic-a', mintJwt(), { storage, syncedAt: NOW.toISOString() });
  const cached = await cachedClinicLicense({
    clinicId: 'clinic-a', publicKeyPem: PUBLIC_PEM, origin: ORIGIN, storage, now: NOW,
  });
  assert.equal(cached.ok, true);
  assert.equal(cached.view.plan, 'growth');
  assert.equal(cached.syncedAt, NOW.toISOString());
});
