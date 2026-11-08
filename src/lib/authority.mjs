/**
 * The licence authority (myClinicLicenseAuthority) — verification, not trust.
 *
 * A clinic's subscription can be owned by an authority that signs a short-lived
 * RS256 capability token (7 days) from its own Supabase Edge Function. Three
 * separate things check that token, and this module is the third:
 *
 *   1. the authority signs it with a private key that never leaves its Edge
 *      Function;
 *   2. the clinic's own `sync-clinic-license` Edge Function verifies it with the
 *      public key and records the verdict in `clinic_subscriptions` — that is
 *      what the RLS policies and the write guards act on, so it is the layer
 *      that actually enforces anything;
 *   3. this module verifies the same token again, in the browser, so the screen
 *      shows a signed fact rather than a status string the page made up.
 *
 * Nothing here decides whether a clinic may write. If the browser is lied to,
 * or edited in DevTools, the database still refuses the write.
 *
 * Pure: no React, no network, no imports. `crypto.subtle` is the one platform
 * dependency (browser and Node ≥ 19 both have it).
 */

/** The `iss` claim the authority signs. Anything else is refused. */
export const AUTHORITY_ISSUER = 'myclinic-license-authority';

/** The Edge Function deployed in the *clinic's* project. */
export const AUTHORITY_FUNCTION = 'sync-clinic-license';

/** Phone home every six hours; the token itself lives seven days. */
export const AUTHORITY_SYNC_HOURS = 6;

/** Clock tolerance when reading `iat`/`exp` — reception clocks drift. */
export const AUTHORITY_DRIFT_SECONDS = 120;

/**
 * What each authority tier buys, in myClinic's vocabulary. `null` is unlimited.
 * Kept in step with the authority's `MYCLINIC_TIER_ENTITLEMENTS`.
 */
export const AUTHORITY_SEATS = Object.freeze({
  solo: { doctors: 1, frontdesk: 1, branches: 1 },
  standard: { doctors: 5, frontdesk: 3, branches: 1 },
  growth: { doctors: 5, frontdesk: 3, branches: 1 },
  chain: { doctors: null, frontdesk: null, branches: null },
  enterprise: { doctors: null, frontdesk: null, branches: null },
});

/** Authority tier → the plan the app already understands. */
export const TIER_TO_PLAN = Object.freeze({
  solo: 'solo',
  standard: 'growth',
  growth: 'growth',
  chain: 'chain',
  enterprise: 'chain',
});

/** Stable codes the UI maps to sentences. */
export const AUTHORITY_ERRORS = Object.freeze({
  'not-configured': 'This clinic is not connected to a licence authority yet.',
  'not-signed-in': 'Sign in again to reach the licence authority.',
  'not-member': 'This account is not a member of this clinic.',
  'not-owner': 'Only the clinic owner can sync the licence.',
  'origin-not-allowed': 'This address is not allowed to check the licence for this clinic.',
  'authority-unreachable': 'The licence authority could not be reached. The clinic keeps working on its last known licence.',
  'authority-refused': 'The licence authority refused this clinic.',
  'authority-token': 'The licence authority did not return a licence token.',
  'token-malformed': 'The licence token is unreadable.',
  'token-alg': 'The licence token was signed with an unexpected algorithm.',
  'token-signature': 'The licence token signature does not match the authority public key.',
  'token-issuer': 'The licence token was not issued by the authority.',
  'token-expired': 'The licence token has expired.',
  'token-future': 'The licence token is dated in the future — check this machine’s clock.',
  'token-fingerprint': 'The licence token was issued for a different deployment address.',
  'token-key-mismatch': 'The licence token belongs to a different licence key.',
  'token-expiry-missing': 'The licence token carries no subscription expiry.',
  'bad-json': 'The licence authority request was malformed.',
  'bad-clinic': 'The clinic id was not recognised.',
  'bad-origin': 'The deployment address was not recognised.',
  // A refusal whose body we could not read — a function deployed before it
  // explained itself, or a gateway page instead of our JSON.
  'http-401': 'The licence function did not accept this session. Sign in again, then retry.',
  'http-403': 'The licence function refused the request (HTTP 403) without saying why, which means it is an older deployment than this build — redeploy it. If it still refuses, this deployment origin is not on MYCLINIC_ORIGINS.',
  'http-404': 'The licence function is not deployed in this project. Deploy sync-clinic-license.',
  'http-500': 'The licence function failed on the server; its log has the reason.',
  refused: 'The licence function refused the request.',
  network: 'The licence could not be synced just now.',
});

const CACHE_PREFIX = 'myclinic.authority.v1.';

/**
 * Read the deployment's authority settings.
 *
 * Only the **public** key reaches the browser bundle. The licence key stays in
 * the clinic's Edge Function secrets, which is why the browser asks that
 * function rather than the authority directly: a key published in a static
 * bundle is a key anyone can read.
 */
/**
 * Which envelope a public key is in.
 *
 * RS256 keys travel in two shapes and both are legitimate:
 *
 *   -----BEGIN PUBLIC KEY-----      SPKI  — WebCrypto's `spki`
 *   -----BEGIN RSA PUBLIC KEY-----  PKCS#1 — WebCrypto's `pkcs1`
 *
 * WebCrypto needs the format named, and the wrong name produces an ASN.1 error
 * about DER tags rather than anything a person can act on: a PKCS#1 key read as
 * SPKI starts `SEQUENCE { INTEGER … }`, so the parser asks for a SEQUENCE and finds
 * the modulus. Accept both, and say which one arrived.
 */
export function publicKeyFormat(pem) {
  const text = String(pem ?? '');
  if (/PRIVATE KEY/.test(text)) return '';
  if (/BEGIN RSA PUBLIC KEY/.test(text)) return 'pkcs1';
  if (/BEGIN PUBLIC KEY/.test(text)) return 'spki';
  return '';
}

export function authorityConfig(env = {}) {
  const publicKeyPem = String(env.VITE_LICENSE_PUBLIC_KEY ?? '').trim();
  const issuer = String(env.VITE_LICENSE_ISSUER ?? '').trim() || AUTHORITY_ISSUER;
  const format = publicKeyFormat(publicKeyPem);
  return {
    enabled: Boolean(format),
    format,
    publicKeyPem,
    issuer,
    functionName: AUTHORITY_FUNCTION,
  };
}

/** `https://Clinic.GitHub.io/` → `web:https://clinic.github.io` */
export function buildFingerprint(origin) {
  const clean = String(origin ?? '')
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s]+$/.test(clean)) {
    throw new Error('A deployment origin (https://…) is required to check the licence.');
  }
  return `web:${clean}`;
}

function base64UrlToBytes(input) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** DER length prefix: short form under 0x80, else 0x80|nbytes followed by the bytes. */
function derLength(length) {
  if (length < 0x80) return [length];
  const bytes = [];
  let value = length;
  while (value > 0) {
    bytes.unshift(value & 0xff);
    value >>= 8;
  }
  return [0x80 | bytes.length, ...bytes];
}

/** The DER bytes inside a PEM, whatever the label says. */
function pemBodyToBytes(pem) {
  const body = String(pem)
    .replace(/\\n/g, '\n')
    .replace(/-----(?:BEGIN|END) [A-Z0-9 ]+-----/g, '')
    .replace(/\s+/g, '');
  if (!body) throw new Error('The authority public key is empty or malformed.');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * PKCS#1 `RSAPublicKey` → SPKI.
 *
 * `-----BEGIN RSA PUBLIC KEY-----` is a bare `SEQUENCE { modulus, exponent }`; SPKI
 * wraps the same bytes with the `rsaEncryption` algorithm identifier. WebCrypto has
 * no `pkcs1` import format — not in the spec, and Deno's runtime rejects it outright
 * (`'pkcs1' is not a valid enum value of type KeyFormat`), so handing a PKCS#1 key to
 * `importKey` produces an ASN.1 error about DER tags and nothing else.
 *
 *   SPKI = SEQUENCE {
 *            SEQUENCE { OID 1.2.840.113549.1.1.1, NULL },
 *            BIT STRING { 0x00 unused-bits, <the PKCS#1 bytes> }
 *          }
 */
export function pkcs1ToSpki(pkcs1) {
  const der = pkcs1 instanceof Uint8Array ? pkcs1 : new Uint8Array(pkcs1);
  const algorithm = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const bitString = [0x03, ...derLength(der.length + 1), 0x00, ...der];
  const content = [...algorithm, ...bitString];
  return new Uint8Array([0x30, ...derLength(content.length), ...content]);
}

function pemToArrayBuffer(pem, format = 'spki') {
  const bytes = pemBodyToBytes(pem);
  return format === 'pkcs1' ? pkcs1ToSpki(bytes).buffer : bytes.buffer;
}

/** Split a JWT without trusting it. Returns nulls rather than throwing. */
export function decodeJwt(token) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return { header: null, claims: null, signature: '' };
  try {
    const text = new TextDecoder();
    return {
      header: JSON.parse(text.decode(base64UrlToBytes(parts[0]))),
      claims: JSON.parse(text.decode(base64UrlToBytes(parts[1]))),
      signature: parts[2],
    };
  } catch {
    return { header: null, claims: null, signature: '' };
  }
}

/**
 * Verify an RS256 capability token: signature first, then every claim this
 * deployment depends on. Resolves `{ valid, code, reason, claims }` — it never
 * throws, because "could not verify" and "verified as invalid" must both end in
 * a read-only clinic rather than a crash.
 */
export async function verifyCapabilityToken(
  token,
  publicKeyPem,
  {
    nowSeconds = Math.floor(Date.now() / 1000),
    expectedFingerprint = '',
    expectedLicenseKey = '',
    expectedIssuer = AUTHORITY_ISSUER,
    subtle = globalThis.crypto?.subtle,
  } = {},
) {
  const { header, claims } = decodeJwt(token);
  if (!header || !claims) {
    return { valid: false, code: 'token-malformed', reason: AUTHORITY_ERRORS['token-malformed'], claims: null };
  }
  if (header.alg !== 'RS256') {
    // `alg: none` and HS256-with-the-public-key are the two classic downgrades.
    return { valid: false, code: 'token-alg', reason: AUTHORITY_ERRORS['token-alg'], claims: null };
  }
  if (!subtle) {
    return { valid: false, code: 'token-signature', reason: 'This browser cannot verify signatures.', claims: null };
  }

  let verified = false;
  try {
    const keyFormat = publicKeyFormat(publicKeyPem) || 'spki';
    const key = await subtle.importKey(
      'spki',
      pemToArrayBuffer(publicKeyPem, keyFormat),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const [head, payload, signature] = String(token).split('.');
    verified = await subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      base64UrlToBytes(signature),
      new TextEncoder().encode(`${head}.${payload}`),
    );
  } catch {
    verified = false;
  }
  if (!verified) {
    return { valid: false, code: 'token-signature', reason: AUTHORITY_ERRORS['token-signature'], claims: null };
  }

  if (claims.iss !== expectedIssuer) {
    return { valid: false, code: 'token-issuer', reason: AUTHORITY_ERRORS['token-issuer'], claims };
  }
  if (typeof claims.exp !== 'number' || claims.exp + AUTHORITY_DRIFT_SECONDS < nowSeconds) {
    return { valid: false, code: 'token-expired', reason: AUTHORITY_ERRORS['token-expired'], claims };
  }
  if (typeof claims.iat === 'number' && claims.iat - AUTHORITY_DRIFT_SECONDS > nowSeconds) {
    return { valid: false, code: 'token-future', reason: AUTHORITY_ERRORS['token-future'], claims };
  }
  if (expectedFingerprint && claims.machine_fingerprint !== expectedFingerprint) {
    return { valid: false, code: 'token-fingerprint', reason: AUTHORITY_ERRORS['token-fingerprint'], claims };
  }
  if (expectedLicenseKey && claims.license_key && claims.license_key !== expectedLicenseKey) {
    return { valid: false, code: 'token-key-mismatch', reason: AUTHORITY_ERRORS['token-key-mismatch'], claims };
  }
  const ends = claims.subscription_expires_at ? new Date(claims.subscription_expires_at) : null;
  if (!ends || Number.isNaN(ends.getTime())) {
    return { valid: false, code: 'token-expiry-missing', reason: AUTHORITY_ERRORS['token-expiry-missing'], claims };
  }

  return { valid: true, code: 'ok', reason: '', claims };
}

/** Authority tier → plan id, defaulting to the conservative `solo`. */
export function tierToPlan(tier) {
  return TIER_TO_PLAN[String(tier ?? '').toLowerCase()] ?? 'solo';
}

/** Seat caps for a tier. `doctors: null` means unlimited. */
export function seatsForTier(tier) {
  return AUTHORITY_SEATS[String(tier ?? '').toLowerCase()] ?? AUTHORITY_SEATS.solo;
}

/**
 * The screen's view of a verified token. `status` follows the same vocabulary
 * as a locally licensed clinic, so every existing banner and guard still works.
 */
export function authorityView({ claims, now = new Date() } = {}) {
  if (!claims) return null;
  const endsAt = claims.subscription_expires_at ? new Date(claims.subscription_expires_at) : null;
  const tokenExp = typeof claims.exp === 'number' ? new Date(claims.exp * 1000) : null;
  const daysLeft = endsAt ? Math.ceil((endsAt.getTime() - now.getTime()) / 86_400_000) : null;
  return {
    managed: true,
    tier: String(claims.tier ?? ''),
    plan: tierToPlan(claims.tier),
    subscriptionId: String(claims.sub ?? ''),
    fingerprint: String(claims.machine_fingerprint ?? ''),
    origin: claims.allowed_origin ? String(claims.allowed_origin) : '',
    seats: seatsForTier(claims.tier),
    maxMachines: Number.isFinite(Number(claims.max_machines)) ? Number(claims.max_machines) : null,
    endsAt: endsAt ? endsAt.toISOString() : null,
    tokenExp: tokenExp ? tokenExp.toISOString() : null,
    daysLeft,
    status: daysLeft !== null && daysLeft <= 0 ? 'read_only' : 'active',
  };
}

/** Is a phone-home due? True when we have never synced, or the window passed. */
export function syncDue({ lastSyncedAt, now = new Date(), hours = AUTHORITY_SYNC_HOURS } = {}) {
  if (!lastSyncedAt) return true;
  const last = new Date(lastSyncedAt);
  if (Number.isNaN(last.getTime())) return true;
  return now.getTime() - last.getTime() >= hours * 3_600_000;
}

/** The build-time value this screen cannot work without. Public, so it may ship. */
export const AUTHORITY_ENV_PUBLIC_KEY = 'VITE_LICENSE_PUBLIC_KEY';

/**
 * What the Subscription screen should say about the authority — one pure function,
 * because the screen got this wrong in a way only a real deployment shows.
 *
 * v1.20.0 drew the card only when the clinic was *already bound*, and bound the
 * clinic only from a silent boot sync. So a clinic that had never bound saw no
 * card and no button, and a boot sync that failed said nothing at all: the option
 * the docs told people to click did not exist on a fresh install. The four states
 * below are now explicit, and each names what to do next.
 *
 *   demo          the local demo workspace — no authority, no card
 *   unconfigured  this bundle was compiled without VITE_LICENSE_PUBLIC_KEY, so
 *                 nothing here can reach an authority whatever the clinic's
 *                 database says; only a rebuild helps
 *   unbound       the build can reach one and the clinic is not bound yet — the
 *                 button does the binding
 *   bound         the subscription is signed by the authority; the button refreshes
 */
export function authorityPanel({ mode = 'demo', configured = false, bound = false, isOwner = false, status = '' } = {}) {
  if (mode !== 'live') {
    return { visible: false, state: 'demo', canCheck: false, buttonLabel: '', badge: '', tone: 'neutral', reason: '' };
  }

  if (!configured) {
    return {
      visible: true,
      state: 'unconfigured',
      canCheck: false,
      buttonLabel: '',
      badge: 'Not in this build',
      tone: 'warn',
      reason: isOwner
        ? `This build was compiled without ${AUTHORITY_ENV_PUBLIC_KEY}, so nothing on this screen can reach a licence authority — whatever the clinic’s database holds. Set it in .env.local, or as a repository variable of the same name for a Pages deploy, then rebuild. Only the public key belongs here; the licence key stays in the Edge Function secrets.`
        : `This build was compiled without ${AUTHORITY_ENV_PUBLIC_KEY}, so it cannot check a licence. Ask the clinic owner to rebuild with it set.`,
    };
  }

  if (!bound) {
    return {
      visible: true,
      state: isOwner ? 'unbound' : 'unbound-viewer',
      canCheck: isOwner,
      buttonLabel: isOwner ? 'Connect to the licence authority' : '',
      badge: 'Not connected',
      tone: 'neutral',
      reason: isOwner
        ? 'This build can reach a licence authority and the clinic is not bound to one yet. The licence key, the authority address and the signing key live in this clinic’s Edge Function secrets; the button asks that function for a signed licence and shows what came back — or the exact reason it was refused.'
        : 'This clinic is not bound to a licence authority yet. Only the clinic owner can connect it.',
    };
  }

  const readOnly = status === 'read_only';
  return {
    visible: true,
    state: isOwner ? 'bound' : 'bound-viewer',
    canCheck: isOwner,
    buttonLabel: isOwner ? 'Check the licence now' : '',
    badge: readOnly ? 'Contract ended' : 'Verified',
    tone: readOnly ? 'warn' : 'success',
    reason: '',
  };
}

/** Every state in which the clinic is not bound still needs an explanation. */
export const AUTHORITY_PANEL_STATES = Object.freeze([
  'demo', 'unconfigured', 'unbound', 'unbound-viewer', 'bound', 'bound-viewer',
]);

function storageOf(storage) {
  if (storage) return storage;
  try {
    if (globalThis.localStorage) return globalThis.localStorage;
  } catch {
    /* strict iframe */
  }
  const memory = new Map();
  return {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => memory.set(k, String(v)),
    removeItem: (k) => memory.delete(k),
  };
}

export function authorityCacheKey(clinicId) {
  return `${CACHE_PREFIX}${String(clinicId ?? 'unknown')}`;
}

/** Cache the token per clinic — a token is bound to one clinic's origin + key. */
export function writeAuthorityToken(clinicId, token, { storage, syncedAt = new Date().toISOString() } = {}) {
  const store = storageOf(storage);
  try {
    store.setItem(authorityCacheKey(clinicId), JSON.stringify({ token: String(token), syncedAt }));
    return true;
  } catch {
    return false;
  }
}

export function readAuthorityToken(clinicId, { storage } = {}) {
  const store = storageOf(storage);
  try {
    const raw = store.getItem(authorityCacheKey(clinicId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.token) return null;
    return { token: String(parsed.token), syncedAt: parsed.syncedAt ?? null };
  } catch {
    return null;
  }
}

export function clearAuthorityToken(clinicId, { storage } = {}) {
  const store = storageOf(storage);
  try {
    store.removeItem(authorityCacheKey(clinicId));
    return true;
  } catch {
    return false;
  }
}

/** A sentence for a refusal code, never a stack trace. */
export function authorityErrorMessage(code, fallback = '') {
  return AUTHORITY_ERRORS[code] ?? fallback ?? AUTHORITY_ERRORS.network;
}
