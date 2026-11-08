import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  AUTHORITY_ENV_PUBLIC_KEY, AUTHORITY_PANEL_STATES, AUTHORITY_SEATS, authorityCacheKey,
  authorityConfig, authorityErrorMessage, authorityPanel, authorityView,
  buildFingerprint, clearAuthorityToken, decodeJwt, readAuthorityToken, seatsForTier, syncDue,
  tierToPlan, verifyCapabilityToken, writeAuthorityToken,
} from '../src/lib/authority.mjs';
import { cachedClinicLicense, refusalFromError, syncClinicLicense } from '../src/lib/authority-sync.mjs';

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

/* ------------------------------------------------------- what the screen offers
 * v1.20.0's screen drew the authority card only once the clinic was bound, and
 * bound it only from a silent boot sync — so a fresh install showed no card, no
 * button and no explanation. These are the four states that replace it.
 */

test('the demo workspace never shows an authority card', () => {
  const panel = authorityPanel({ mode: 'demo', configured: true, bound: true, isOwner: true });
  assert.equal(panel.visible, false);
  assert.equal(panel.state, 'demo');
  assert.equal(panel.canCheck, false);
});

test('a build without the public key says so, and names the variable', () => {
  const owner = authorityPanel({ mode: 'live', configured: false, bound: false, isOwner: true });
  assert.equal(owner.visible, true, 'the card is the only place that can explain the gap');
  assert.equal(owner.state, 'unconfigured');
  assert.equal(owner.canCheck, false, 'a button that cannot work is worse than no button');
  assert.equal(owner.badge, 'Not in this build');
  assert.match(owner.reason, new RegExp(AUTHORITY_ENV_PUBLIC_KEY));
  assert.match(owner.reason, /rebuild/i);

  const viewer = authorityPanel({ mode: 'live', configured: false, bound: false, isOwner: false });
  assert.equal(viewer.state, 'unconfigured');
  assert.match(viewer.reason, /owner/i);
  assert.doesNotMatch(viewer.reason, /\.env\.local/, 'a non-owner cannot act on a rebuild instruction');
});

test('an unbound clinic is offered the button that binds it', () => {
  const owner = authorityPanel({ mode: 'live', configured: true, bound: false, isOwner: true });
  assert.equal(owner.state, 'unbound');
  assert.equal(owner.canCheck, true);
  assert.equal(owner.buttonLabel, 'Connect to the licence authority');
  assert.equal(owner.tone, 'neutral');
  assert.match(owner.reason, /licence key/i);

  const viewer = authorityPanel({ mode: 'live', configured: true, bound: false, isOwner: false });
  assert.equal(viewer.state, 'unbound-viewer');
  assert.equal(viewer.canCheck, false);
  assert.equal(viewer.buttonLabel, '');
  assert.match(viewer.reason, /owner/i);
});

test('a bound clinic offers the check the docs describe, and only to the owner', () => {
  const owner = authorityPanel({ mode: 'live', configured: true, bound: true, isOwner: true, status: 'active' });
  assert.equal(owner.state, 'bound');
  assert.equal(owner.canCheck, true);
  assert.equal(owner.buttonLabel, 'Check the licence now', 'the label the setup guide tells people to look for');
  assert.equal(owner.badge, 'Verified');
  assert.equal(owner.tone, 'success');

  const viewer = authorityPanel({ mode: 'live', configured: true, bound: true, isOwner: false });
  assert.equal(viewer.state, 'bound-viewer');
  assert.equal(viewer.canCheck, false, 'every seat reads the database; only the owner phones home');
  assert.equal(viewer.visible, true, 'a viewer still sees the signed state they are working under');
});

test('a lapsed contract reads as ended, not as an error', () => {
  const panel = authorityPanel({ mode: 'live', configured: true, bound: true, isOwner: true, status: 'read_only' });
  assert.equal(panel.badge, 'Contract ended');
  assert.equal(panel.tone, 'warn');
  assert.equal(panel.canCheck, true, 'the owner must still be able to re-check after renewing');
});

test('every state the panel can return is in the published list', () => {
  const seen = new Set();
  for (const mode of ['demo', 'live']) {
    for (const configured of [true, false]) {
      for (const bound of [true, false]) {
        for (const isOwner of [true, false]) {
          seen.add(authorityPanel({ mode, configured, bound, isOwner }).state);
        }
      }
    }
  }
  for (const state of seen) assert.ok(AUTHORITY_PANEL_STATES.includes(state), `${state} must be published`);
});

test('no state both claims visibility and withholds a reason', () => {
  for (const state of AUTHORITY_PANEL_STATES) {
    if (state === 'demo') continue;
    assert.ok(state.length > 0);
  }
  // the three states that are not bound must each explain themselves
  for (const [configured, bound] of [[false, false], [true, false]]) {
    for (const isOwner of [true, false]) {
      const panel = authorityPanel({ mode: 'live', configured, bound, isOwner });
      assert.ok(panel.reason.length > 40, `${panel.state} must explain itself`);
    }
  }
});

/* ------------------------------------- what the screen says when the function says no
 * supabase-js keeps only the status: `error.message` is "Edge Function returned a
 * non-2xx status code" whatever the function wrote. Every refusal the licence
 * function makes became that one sentence on screen, which is how a stale
 * deployment (403, origin not on the list) looked identical to a wrong password.
 */

const httpError = (status, body, headers = {}) => ({
  message: 'Edge Function returned a non-2xx status code',
  context: new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  }),
});

test('a refusal body is read, not discarded', async () => {
  const refusal = await refusalFromError(httpError(403, {
    ok: false, code: 'origin-not-allowed', error: "This origin is not on the clinic's allowlist.",
  }));
  assert.equal(refusal.code, 'origin-not-allowed');
  assert.match(refusal.message, /allowlist/);
  assert.equal(refusal.status, 403);
});

test('the x-myclinic-code header survives a body that cannot be read', async () => {
  const refusal = await refusalFromError(httpError(403, undefined, { 'x-myclinic-code': 'not-owner' }));
  assert.equal(refusal.code, 'not-owner');
  assert.equal(refusal.message, '', 'no body, no message — the caller falls back');
});

test('an old deployment still gets an actionable sentence', async () => {
  // The deployment that prompted this: a function older than the app, so the
  // 403 carries no code and no message at all.
  const refusal = await refusalFromError(httpError(403, undefined));
  assert.equal(refusal.code, 'http-403');
  assert.equal(refusal.status, 403);
  assert.match(authorityErrorMessage(refusal.code), /redeploy/i);
  assert.match(authorityErrorMessage(refusal.code), /MYCLINIC_ORIGINS/);
});

test('a network failure is not dressed up as a refusal', async () => {
  assert.equal(await refusalFromError(new TypeError('Failed to fetch')), null);
  assert.equal(await refusalFromError(undefined), null);
  assert.equal(await refusalFromError({ message: 'boom' }), null, 'no context, no status, no code');
});

test('sync reports the refusal code, and keeps the cached licence', async () => {
  const storage = memoryStorage();
  // A clinic that was bound yesterday: a valid token sits in the cache.
  writeAuthorityToken('clinic-a', mintJwt(), { storage, syncedAt: NOW.toISOString() });

  const result = await syncClinicLicense({
    invoke: async () => ({ data: null, error: httpError(403, undefined) }),
    clinicId: 'clinic-a',
    publicKeyPem: PUBLIC_PEM,
    origin: ORIGIN,
    storage,
    now: NOW,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'http-403', 'the status becomes a code the app can map');
  assert.match(result.error, /HTTP 403/, 'and the message keeps the status it saw');
  assert.equal(result.fromCache, true, 'a refusal must not throw away a still-valid licence');
  assert.ok(result.view, 'the clinic keeps working on what it already has');
});
