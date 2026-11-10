/**
 * Keyless central subscription auto-sync (pure — no React, no Supabase client).
 *
 * myClinic used to learn its plan from its own database, or — with the licence
 * authority — from an Edge Function holding a licence key and an RSA key pair.
 * Both needed a secret somewhere. This module needs none: the clinic's browser
 * posts three non-secret facts (owner email, this deployment's origin, a device
 * id) to ONE public PostgREST RPC on the central project, and the central
 * project answers with the plan, the seat caps, the expiry and — when it wants
 * the clinic to stop writing — a refusal.
 *
 *     POST ${centralUrl}/rest/v1/rpc/sync_clinic_subscription
 *     { p_email, p_origin, p_device_id }
 *
 * Three rules shape everything below.
 *
 *   1. **The central project is a different Supabase project.** It must never be
 *      called through a second `@supabase/supabase-js` client, because that
 *      client would attach *this* project's session JWT to *that* project's
 *      requests — a token leak with no upside. So: raw `fetch`, and the only
 *      Authorization header that ever appears is the central anon key itself.
 *   2. **The answer is cached, sealed, and short-lived.** A clinic on a flaky
 *      connection keeps working while the seal holds and the dates have not
 *      passed; editing the cache in DevTools breaks the seal, and the clinic
 *      degrades to read-only instead of upgrading itself.
 *   3. **A refusal is obeyed at once.** Paused, expired, unlicensed, out of
 *      seats, wrong origin — the cache is deleted and writes stop in the same
 *      tick. Reads and exports never stop: that promise predates this module
 *      and is not its to break.
 *
 * Being honest about the seal: it is tamper-*evident*, not tamper-*proof*. The
 * pepper ships in the bundle, so someone who reads the bundle can recompute a
 * seal. It stops the ordinary DevTools edit, which is what it is for — the real
 * enforcement is the database and the central project, not this file.
 */

/** Where a sealed lease lives, per clinic. */
export const CENTRAL_CACHE_PREFIX = 'myclinic.central.subscription.v2.';

/** The device id that lets Central count machines. */
export const CENTRAL_DEVICE_KEY = 'myclinic.central.device.v1';

/** Auto-sync cadence for an open tab, in milliseconds. */
export const CENTRAL_SYNC_INTERVAL_MS = 30 * 60 * 1000;

/** A slow network must not leave the screen waiting forever. */
export const CENTRAL_TIMEOUT_MS = 8000;

/** The RPC name, fixed by the central project's schema v2. */
export const CENTRAL_RPC = 'sync_clinic_subscription';

/** Said by every blocked self-service path while Central is configured. */
export const CENTRAL_MANAGED_MESSAGE = 'This clinic subscription is managed centrally.';

/** The two build variables, named once so the UI, the workflow and the docs agree. */
import { CENTRAL_TIER_TO_PLAN, FALLBACK_PLAN, planForTier } from './plans.mjs';

export const CENTRAL_ENV_URL = 'VITE_CENTRAL_SUPABASE_URL';
export const CENTRAL_ENV_KEY = 'VITE_CENTRAL_SUPABASE_ANON_KEY';

/** The pepper mixed into every seal. Public by nature; see the note above. */
const CENTRAL_SEAL_PEPPER = 'myclinic.central.lease.v2';

/** Unit separator: cannot appear in an email, an origin or a hex device id. */
const SEP = '\u241f';

/**
 * Central tier → the plan myClinic already understands.
 *
 * The map itself now lives in `plans.mjs` with every other plan mapping; it is
 * re-exported here because this module's public surface is what the app and the
 * tests import. `planForTier()` is the only place a tier becomes a plan.
 */
export { CENTRAL_TIER_TO_PLAN };

/** The fields a seal covers — the ones that decide whether a clinic may write. */
export const CENTRAL_SEAL_FIELDS = Object.freeze([
  'allowed', 'status', 'tier', 'plan', 'expires_at', 'grace_until',
]);

/**
 * Carried, shown, and deliberately NOT sealed: the day the contract started.
 *
 * A seal exists so a clinic cannot edit itself into a better licence. A start
 * date grants nothing — it is a line on a card — so sealing it would buy no
 * security and would cost every device its cached lease on upgrade, because a
 * v2 seal computed over six fields cannot verify a lease sealed over seven. The
 * dates that decide writing (`expires_at`, `grace_until`) stay inside the seal.
 */
export const CENTRAL_UNSEALED_FIELDS = Object.freeze(['started_at', 'match_mode', 'server_time']);

/** Refusal codes the central project can answer with — plus the two this build can add. */
export const CENTRAL_CODES = Object.freeze({
  ACTIVE: 'active',
  SUBSCRIPTION_PAUSED: 'paused',
  SUBSCRIPTION_EXPIRED: 'expired',
  SUBSCRIPTION_NOT_FOUND: 'unlicensed',
  SEAT_LIMIT_REACHED: 'seat_limit',
  ORIGIN_MISMATCH: 'origin_mismatch',
  RATE_LIMITED: 'rate_limited',
  INVALID_EMAIL: 'invalid_email',
  INVALID_ORIGIN: 'invalid_origin',
  MISSING_IDENTITY: 'missing_identity',
  // Never from Central: this build could not make an HTTP request at all.
  FETCH_UNAVAILABLE: 'fetch_unavailable',
});

/**
 * One sentence per refusal code, for the card.
 *
 * The code itself is always printed verbatim next to this — the sentence explains
 * it, it does not replace it, so a support call can quote either.
 */
export const CENTRAL_CODE_NOTES = Object.freeze({
  SUBSCRIPTION_NOT_FOUND: 'No row on Central carries this email **and** this origin. Pin the exact pair the card names.',
  ORIGIN_MISMATCH: 'The row exists for this email, but its pinned URL is not the origin this build sends.',
  SEAT_LIMIT_REACHED: 'Every machine the plan allows is in use; release a seat on Central.',
  SUBSCRIPTION_PAUSED: 'Central has paused this clinic. The plan resumes only when Central says so.',
  SUBSCRIPTION_EXPIRED: 'Central says the term has ended. Renew on Central.',
  RATE_LIMITED: 'Too many calls from this IP. Wait a minute; the client re-syncs every half hour on its own.',
  INVALID_EMAIL: 'Central refused the email as malformed — check the owner address it was pinned from.',
  INVALID_ORIGIN: 'Central refused the origin as malformed. Send scheme + host only, e.g. https://clinic.github.io.',
  MISSING_IDENTITY: 'Central requires an email and an origin; one of them arrived empty.',
  FETCH_UNAVAILABLE: 'This build cannot make HTTP requests at all — a fault in the build, not a network outage.',
});

/** The note for a code, or `''` when there is nothing useful to add. */
export function centralCodeNote(code) {
  return CENTRAL_CODE_NOTES[String(code ?? '').trim().toUpperCase()] ?? '';
}

/** What a missing `fetch` says. Shared so the probe and the sync cannot drift. */
export const CENTRAL_FETCH_UNAVAILABLE = 'FETCH_UNAVAILABLE';

const FETCH_UNAVAILABLE_REASON = 'This build cannot make HTTP requests: no fetch implementation is available, so Central was never contacted. That is a fault in the build, not a network outage and not a decision about this clinic.';

/**
 * Was this thrown by the network, or by us?
 *
 * `fetch` rejects with a `TypeError` when the request never completed (offline,
 * DNS, CORS), and with a DOMException named `AbortError` when our own 8 s timeout
 * fired. Everything else — including the `no fetch` error this module used to
 * throw — is a fault in the build, and must not be reported as an outage.
 */
export function isTransportFailure(error) {
  const name = String(error?.name ?? '');
  if (name === 'AbortError' || name === 'TimeoutError') return true;
  if (error instanceof TypeError) return true;
  return /network|failed to fetch|load failed|timed? ?out|offline|econn/i.test(String(error?.message ?? ''));
}

/**
 * The HTTP function to call, with the platform's `fetch` as the default.
 *
 * `fetchImpl` exists so tests can drive this decision tree with no network. The
 * first shipped version of this module *required* it, and no caller in the app
 * passed one: every production call threw `no fetch` before opening a socket, and
 * the surrounding catch relabelled that build fault as a network outage. A test
 * that always injects a fake cannot see that, which is why the regression tests
 * for this now go through `globalThis.fetch`.
 */
function resolveFetch(fetchImpl) {
  if (typeof fetchImpl === 'function') return fetchImpl;
  if (typeof globalThis.fetch === 'function') return (url, init) => globalThis.fetch(url, init);
  return null;
}

/** One sentence the card shows under the dates. */
export const CENTRAL_GRACE_NOTE = 'Without a connection, the sealed licence keeps the clinic writable until its contract and grace dates pass — never beyond them.';

/** How Central recognised this clinic, in words. */
export function centralMatchLabel(mode) {
  const key = String(mode ?? '').trim().toLowerCase();
  if (key === 'email+url') return 'Matched on the owner email and this address';
  if (key === 'email') return 'Matched on the owner email';
  if (key === 'url') return 'Matched on this address';
  if (!key) return '';
  return `Matched on ${key}`;
}

/** Human labels for the card. */
export const CENTRAL_STATUS_LABELS = Object.freeze({
  active: 'Active',
  paused: 'Paused',
  expired: 'Expired',
  unlicensed: 'Not licensed',
  seat_limit: 'Seat limit reached',
  origin_mismatch: 'This address is not licensed',
  offline: 'Offline grace',
});

/* ------------------------------------------------------------------ small parts */

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

function randomHex(byteLength) {
  const bytes = new Uint8Array(byteLength);
  const c = globalThis.crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexOf(buffer) {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** base64url → JSON, or null. Never throws: a malformed key is just a key. */
function decodeJwtPayload(token) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return null;
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = globalThis.atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/* ----------------------------------------------------------------- the settings */

/**
 * An origin, normalised: lowercase, no trailing slash, no path.
 *
 * The central project matches deployments by origin, so `https://Clinic.github.io/`
 * and `https://clinic.github.io` have to arrive as the same string — otherwise a
 * licence that exists looks unlicensed, which is the worst failure this feature
 * can have.
 */
export function normalizeOrigin(raw) {
  const value = String(raw ?? '').trim().toLowerCase().replace(/\/+$/, '');
  if (!value) return '';
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return value;
  }
}

/** An email, normalised: trimmed, lowercased. Matching is Central's, not ours. */
export function normalizeEmail(raw) {
  return String(raw ?? '').trim().toLowerCase();
}

/**
 * `https://…` always; `http://localhost` only for a development build.
 *
 * A plain-http central URL in a deployed bundle would send the anon key over the
 * wire in clear text — so it is refused there rather than trusted to be typed
 * carefully.
 */
function normaliseCentralUrl(raw, { dev = false } = {}) {
  const value = String(raw ?? '').trim().replace(/\/+$/, '');
  if (!value) return '';
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return url.origin;
    if (url.protocol === 'http:' && dev && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname)) return url.origin;
    return '';
  } catch {
    return '';
  }
}

/**
 * Why this key must not be used, in one sentence — or `''` when it is fine.
 *
 * A `sb_secret_…` key or a service-role JWT in a `VITE_` variable is compiled
 * into a bundle and served to every visitor of the clinic's site, where it can
 * read and write the whole central project. There is no configuration in which
 * that is acceptable, so the build refuses it at load time as well as in CI.
 */
export function blockedCentralKey(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  if (value.startsWith('sb_secret_')) {
    return `${CENTRAL_ENV_KEY} is a secret key (sb_secret_…), which must never be compiled into a browser bundle. Use the project's publishable key.`;
  }
  const payload = decodeJwtPayload(value);
  if (payload && String(payload.role ?? '') === 'service_role') {
    return `${CENTRAL_ENV_KEY} decodes to a service_role key, which must never be compiled into a browser bundle. Use the project's publishable or anon key.`;
  }
  return '';
}

/**
 * What this build knows about Central Auto-Sync.
 *
 * `enabled` is the only switch the rest of the app reads: without it, myClinic
 * licenses itself locally exactly as it did before this module existed, so an
 * unconfigured deployment loses nothing.
 *
 * @returns {{enabled: boolean, url: string, anonKey: string, error: string}}
 */
export function centralSyncConfig(env = {}) {
  const rawUrl = String(env?.[CENTRAL_ENV_URL] ?? '').trim();
  const anonKey = String(env?.[CENTRAL_ENV_KEY] ?? '').trim();
  const dev = Boolean(env?.DEV) || String(env?.MODE ?? '') === 'development';

  if (!rawUrl && !anonKey) return { enabled: false, url: '', anonKey: '', error: '' };

  const blocked = blockedCentralKey(anonKey);
  if (blocked) return { enabled: false, url: '', anonKey: '', error: blocked };

  if (!rawUrl) {
    return {
      enabled: false, url: '', anonKey: '',
      error: `${CENTRAL_ENV_KEY} is set but ${CENTRAL_ENV_URL} is not, so nothing can be called.`,
    };
  }
  const url = normaliseCentralUrl(rawUrl, { dev });
  if (!url) {
    return {
      enabled: false, url: '', anonKey: '',
      error: `${CENTRAL_ENV_URL} must be an https:// URL${dev ? ' (http://localhost is allowed in development)' : ''}.`,
    };
  }
  if (!anonKey) {
    return {
      enabled: false, url, anonKey: '',
      error: `${CENTRAL_ENV_URL} is set but ${CENTRAL_ENV_KEY} is not, so the request would be anonymous and refused.`,
    };
  }
  return { enabled: true, url, anonKey, error: '' };
}

/* ------------------------------------------------------------------ diagnostics */

/**
 * The body of the zero-side-effect readiness probe.
 *
 * Empty email and origin, and a device id Central recognises as a health check:
 * the RPC answers `sync_ready` and the schema version without looking anything
 * up, so a probe cannot create a machine row, move a heartbeat or spend a seat.
 */
export const CENTRAL_PROBE_BODY = Object.freeze({ p_email: '', p_origin: '', p_device_id: 'healthcheck' });

/** `o•••@clinic.com` — enough to compare domains, not enough to leak an address. */
export function maskEmail(value) {
  const email = normalizeEmail(value);
  if (!email) return '';
  const at = email.indexOf('@');
  if (at <= 0) return `${email.slice(0, 1)}•••`;
  const local = email.slice(0, at);
  const domain = email.slice(at);
  return `${local.slice(0, 1)}•••${domain}`;
}

/** Hostname only, for a card that must never print a key or a path. */
export function centralHostLabel(url) {
  const raw = String(url ?? '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).host;
  } catch {
    return '';
  }
}

/**
 * Which address this build will send to Central — and where it came from.
 *
 * Central's row is dual-pinned (email AND origin), so a receptionist's address
 * is not the one the licence was sold against. The order is deliberate: the
 * owner's staff row, then the clinic's own address, then the billing address,
 * then whoever is signed in. `source` is what the diagnostic card prints, so an
 * operator can pin *that* address on Central instead of guessing which one the
 * app chose.
 *
 * @returns {{email: string, source: 'owner'|'clinic'|'billing'|'session'|'none'}}
 */
export function resolveCentralIdentity({ staff = [], clinic = null, subscription = null, sessionEmail = '' } = {}) {
  const owner = (staff ?? []).find((row) => row?.role === 'owner' && row?.email) ?? null;
  const candidates = [
    ['owner', owner?.email],
    ['clinic', clinic?.email],
    ['billing', subscription?.billing_email],
    ['session', sessionEmail],
  ];
  for (const [source, value] of candidates) {
    const email = normalizeEmail(value);
    if (email) return { email, source };
  }
  return { email: '', source: 'none' };
}

/**
 * The store's `centralState`, derived from one answer.
 *
 * Kept here rather than in the component so a refusal's code and reason can be
 * asserted in a test: "the client called and Central said no" has to be
 * distinguishable from "the client never called", which is the whole reason this
 * diagnostic exists.
 *
 * @returns {{state: 'ok'|'offline'|'error', verdict: object|null, syncedAt: string|null, error: string}}
 */
export function centralStateFromResult(result, now = new Date()) {
  if (!result) {
    return { state: 'error', verdict: null, syncedAt: now.toISOString(), error: 'Central Auto-Sync returned nothing.' };
  }
  return {
    state: result.offline ? 'offline' : result.ok ? 'ok' : 'error',
    verdict: result,
    syncedAt: result.syncedAt ?? now.toISOString(),
    error: result.allowed ? '' : String(result.reason ?? '') || 'Central Auto-Sync refused this clinic.',
  };
}

/**
 * Is the central project there, and does the RPC exist?
 *
 * Deliberately separate from a subscription verdict: this proves reachability
 * and the schema version, never that *this* clinic is licensed. It cannot change
 * anything on Central — see `CENTRAL_PROBE_BODY`.
 *
 * @returns {Promise<{ok: boolean, syncReady: boolean, schemaVersion: number|null, httpStatus: number|null, error: string}>}
 */
export async function probeCentralReadiness(config, { fetchImpl, timeoutMs = CENTRAL_TIMEOUT_MS } = {}) {
  const cfg = config ?? {};
  const empty = { ok: false, syncReady: false, schemaVersion: null, httpStatus: null, code: '', error: '' };
  if (!cfg.enabled || !cfg.url || !cfg.anonKey) {
    return { ...empty, code: 'NOT_CONFIGURED', error: cfg.error || 'Central Auto-Sync is not configured in this build, so there is nothing to test.' };
  }

  const doFetch = resolveFetch(fetchImpl);
  if (!doFetch) {
    return { ...empty, code: CENTRAL_FETCH_UNAVAILABLE, error: FETCH_UNAVAILABLE_REASON };
  }

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  let response = null;
  let transportError = null;
  try {
    response = await doFetch(`${cfg.url}/rest/v1/rpc/${CENTRAL_RPC}`, {
      method: 'POST',
      headers: centralHeaders(cfg),
      body: JSON.stringify(CENTRAL_PROBE_BODY),
      signal: controller?.signal,
      mode: 'cors',
      credentials: 'omit',
    });
  } catch (error) {
    transportError = error;
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (!response) {
    if (!isTransportFailure(transportError)) {
      return {
        ...empty,
        code: 'CLIENT_ERROR',
        error: `The request failed before it was sent (${transportError?.message ?? 'unknown error'}). That is a fault in this build, not a network outage.`,
      };
    }
    return { ...empty, code: 'UNREACHABLE', error: `Could not reach the central project (${transportError?.message ?? 'network error'}).` };
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const httpStatus = response.status ?? null;

  if (response.ok === false) {
    const said = body?.message ?? body?.error ?? '';
    return { ...empty, httpStatus, code: `HTTP_${httpStatus}`, error: `The central project answered ${httpStatus}${said ? `: ${said}` : '.'}` };
  }

  const syncReady = body?.sync_ready === true || body?.ok === true;
  return {
    ok: syncReady,
    syncReady,
    schemaVersion: typeof body?.schema_version === 'number' ? body.schema_version : null,
    httpStatus,
    error: syncReady ? '' : 'The RPC answered, but not with a readiness body — check which function is deployed.',
  };
}

/* -------------------------------------------------------------- the device id */

/**
 * A stable, anonymous id for this browser profile.
 *
 * Central counts machines per licence; the id is what it counts. It says nothing
 * about the person or the device beyond "this storage has been here before", and
 * it is cleared with the rest of the site data.
 */
/** The device id already on this profile, or `''` — never creates one. */
export function readCentralDeviceId(storage) {
  const store = storageOf(storage);
  try {
    const existing = store.getItem(CENTRAL_DEVICE_KEY);
    return existing && /^[a-f0-9]{16,64}$/i.test(existing) ? existing.toLowerCase() : '';
  } catch {
    return '';
  }
}

export function getOrCreateCentralDeviceId(storage) {
  const store = storageOf(storage);
  const existing = readCentralDeviceId(store);
  if (existing) return existing;

  const id = randomHex(16);
  try {
    store.setItem(CENTRAL_DEVICE_KEY, id);
  } catch {
    /* private mode, quota — the id just will not persist */
  }
  return id;
}

/* ------------------------------------------------------------- the sealed lease */

/** `myclinic.central.subscription.v2.<clinicId>` */
export function centralCacheKey(clinicId) {
  return `${CENTRAL_CACHE_PREFIX}${String(clinicId ?? 'unknown')}`;
}

/**
 * The exact string a seal covers. Kept separate from the digest so a test can
 * prove that every decisive field is inside it.
 */
export function centralSealMaterial(lease, { clinicId, origin, email, deviceId } = {}) {
  const fields = CENTRAL_SEAL_FIELDS.map((key) => {
    if (key === 'allowed') return lease?.allowed ? 'allowed' : 'denied';
    return String(lease?.[key] ?? '');
  });
  return [
    CENTRAL_SEAL_PEPPER,
    String(clinicId ?? ''),
    normalizeOrigin(origin),
    normalizeEmail(email),
    String(deviceId ?? ''),
    fields.join('|'),
  ].join(SEP);
}

/**
 * SHA-256 over the pepper, this clinic, this deployment, this owner and this
 * device, plus every field that decides whether writing is allowed.
 *
 * @returns {Promise<string>} lowercase hex
 */
export async function computeCentralSeal(lease, subject = {}) {
  const material = centralSealMaterial(lease, subject);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return hexOf(digest);
}

/**
 * How long a cached lease may still be believed.
 *
 * Both dates must be in the future when Central gave them: `expires_at` is the
 * contract, `grace_until` is the extra window Central allows for a device that
 * has not phoned home. A lease whose `expires_at` cannot be read is not a lease —
 * an unreadable date must never mean "no expiry".
 */
export function leaseWindow(lease, now = new Date()) {
  const at = now instanceof Date ? now.getTime() : Date.parse(now);
  const expires = Date.parse(String(lease?.expires_at ?? ''));
  const grace = Date.parse(String(lease?.grace_until ?? ''));
  const withinExpiry = Number.isFinite(expires) ? at < expires : false;
  const withinGrace = Number.isFinite(grace) ? at < grace : true;
  return {
    withinExpiry,
    withinGrace,
    usable: Boolean(at && withinExpiry && withinGrace),
    expiresAt: Number.isFinite(expires) ? new Date(expires).toISOString() : null,
    graceUntil: Number.isFinite(grace) ? new Date(grace).toISOString() : null,
  };
}

/** Forget this clinic's lease (refusal, sign-out, tamper). */
export function clearCachedCentralSubscription({ clinicId, storage } = {}) {
  try {
    storageOf(storage).removeItem(centralCacheKey(clinicId));
  } catch {
    /* nothing to do: the next read finds nothing and degrades */
  }
}

/**
 * The cached lease, if it is this clinic's, this deployment's, untampered and
 * still inside its dates. Anything else returns `null` and is deleted — a cache
 * that cannot be trusted is worse than no cache, because it would keep a paused
 * clinic writing.
 *
 * @returns {Promise<{lease: object, syncedAt: string|null}|null>}
 */
export async function readCachedCentralSubscription({
  clinicId, origin, email, deviceId, storage, now = new Date(),
} = {}) {
  const store = storageOf(storage);
  const key = centralCacheKey(clinicId);
  let raw = null;
  try {
    raw = store.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.lease || typeof parsed.seal !== 'string') {
    clearCachedCentralSubscription({ clinicId, storage: store });
    return null;
  }

  const expected = await computeCentralSeal(parsed.lease, { clinicId, origin, email, deviceId });
  if (expected !== parsed.seal) {
    // Someone edited the plan or the expiry in DevTools. Nothing here is worth
    // believing, and pretending otherwise is how a paused clinic keeps writing.
    clearCachedCentralSubscription({ clinicId, storage: store });
    return null;
  }

  const window = leaseWindow(parsed.lease, now);
  if (!window.usable) {
    clearCachedCentralSubscription({ clinicId, storage: store });
    return null;
  }

  return { lease: parsed.lease, syncedAt: parsed.syncedAt ?? null };
}

/* ------------------------------------------------------------------ the request */

/**
 * Headers for the central RPC — and deliberately nothing else.
 *
 * `apikey` identifies the *central* project's publishable key. `Authorization`
 * repeats that same publishable key, because PostgREST expects a bearer token on
 * anon-key projects that predate publishable keys; with a modern
 * `sb_publishable_…` key it is omitted, which is what Supabase's own docs
 * recommend. What never appears here is a session JWT: sending this clinic's
 * user token to a different project would hand that project a credential it has
 * no business holding.
 */
export function centralHeaders(config, { email = '' } = {}) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json',
    apikey: String(config?.anonKey ?? ''),
  };
  if (config?.anonKey && !String(config.anonKey).startsWith('sb_publishable_')) {
    headers.authorization = `Bearer ${config.anonKey}`;
  }
  // Kept out of the headers on purpose, recorded here so the next reader does not
  // "helpfully" add it back: `authorization: Bearer ${email}` or a session token.
  void email;
  return headers;
}

/** The row `licenseState()` expects, from a lease the clinic is allowed to use. */
export function centralSubscriptionRow(lease, { clinicId } = {}) {
  const allowed = Boolean(lease?.allowed);
  if (!allowed) {
    return {
      clinic_id: clinicId ?? null,
      status: 'expired',
      plan: FALLBACK_PLAN,
      interval: 'yearly',
      current_period_end: lease?.expires_at ?? null,
      collection_ref: String(lease?.code ?? 'CENTRAL-PAUSED'),
    };
  }
  return {
    clinic_id: clinicId ?? null,
    status: 'active',
    plan: planForTier(lease?.tier),
    interval: 'yearly',
    // The contract's own window: `current_period_start` is what `licenseState()`
    // reads as `startsAt`, so the card can print "01 Nov 2026 → 30 Nov 2026"
    // without inventing either end of it.
    current_period_start: lease?.started_at ?? null,
    current_period_end: lease?.expires_at ?? null,
    collection_ref: String(lease?.code ?? 'CENTRAL-ACTIVE'),
  };
}

/** What the screen shows for a refusal: a label and a tone, never a raw code. */
export function centralStatusLabel(status) {
  return CENTRAL_STATUS_LABELS[String(status ?? '').toLowerCase()] ?? 'Unknown';
}

/**
 * Ask Central what this clinic may do, then believe it — for a while, and only
 * as far as the seal and the dates allow.
 *
 * Everything that touches the outside world is injected (`fetchImpl`, `now`,
 * `storage`), so the whole decision tree runs in tests with no network and no
 * browser.
 *
 * @returns {Promise<{
 *   ok: boolean, allowed: boolean, status: string, plan: string, tier: string,
 *   expiresAt: string|null, graceUntil: string|null, startedAt: string|null,
 *   matchMode: string,
 *   reason: string, code: string, fromCache: boolean, offline: boolean,
 *   syncedAt: string|null, subscriptionRow: object,
 * }>}
 */
export async function syncCentralSubscription({
  config, clinicId, email, origin, storage, fetchImpl, now = new Date(),
} = {}) {
  const cfg = config ?? {};
  const store = storageOf(storage);
  const normalizedEmail = normalizeEmail(email);
  const normalizedOrigin = normalizeOrigin(origin);
  const deviceId = getOrCreateCentralDeviceId(store);
  const at = now instanceof Date ? now : new Date(now);
  const subject = { clinicId, origin: normalizedOrigin, email: normalizedEmail, deviceId };

  const refusal = (extra = {}) => {
    const code = String(extra.code ?? 'CENTRAL-PAUSED');
    return {
      ok: false,
      allowed: false,
      status: 'expired',
      plan: FALLBACK_PLAN,
      tier: '',
      expiresAt: null,
      graceUntil: null,
      startedAt: null,
      matchMode: '',
      reason: '',
      fromCache: false,
      offline: false,
      syncedAt: at.toISOString(),
      ...extra,
      code,
      // Built last, from the code that actually came back: the collection
      // reference is what a support call is opened with, so it must say
      // SUBSCRIPTION_PAUSED, not a placeholder invented here.
      subscriptionRow: extra.subscriptionRow ?? centralSubscriptionRow(
        { allowed: false, code, expires_at: extra.expiresAt ?? null },
        { clinicId },
      ),
    };
  };

  if (!cfg.enabled || !cfg.url || !cfg.anonKey) {
    return refusal({
      code: 'not-configured',
      status: 'unlicensed',
      reason: cfg.error || 'Central Auto-Sync is not configured in this build.',
    });
  }

  const url = `${cfg.url}/rest/v1/rpc/${CENTRAL_RPC}`;
  const body = {
    p_email: normalizedEmail,
    p_origin: normalizedOrigin,
    p_device_id: deviceId,
  };

  // Resolved before the socket, not inside the try: a build with no HTTP client
  // at all is a fault, not an outage, and must never be relabelled as one.
  const doFetch = resolveFetch(fetchImpl);
  if (!doFetch) {
    return refusal({
      code: CENTRAL_FETCH_UNAVAILABLE,
      status: 'unlicensed',
      reason: FETCH_UNAVAILABLE_REASON,
    });
  }

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), CENTRAL_TIMEOUT_MS) : null;

  let response = null;
  let transportError = null;
  try {
    response = await doFetch(url, {
      method: 'POST',
      headers: centralHeaders(cfg),
      body: JSON.stringify(body),
      signal: controller?.signal,
      mode: 'cors',
      credentials: 'omit',
    });
  } catch (error) {
    transportError = error;
  } finally {
    if (timer) clearTimeout(timer);
  }

  // Only a real rejection from the network may reach the offline branch. Anything
  // else thrown here is this build's fault, and says so with its own code.
  if (!response && transportError && !isTransportFailure(transportError)) {
    return refusal({
      code: 'CLIENT_ERROR',
      status: 'unlicensed',
      reason: `The request to Central failed before it was sent (${transportError.message ?? 'unknown error'}). That is a fault in this build, not a network outage.`,
    });
  }

  /**
   * The network did not answer, or the central project is unwell (5xx). Both are
   * availability problems, not verdicts: the sealed lease may keep the clinic
   * open for the rest of its documented life, and nothing else happens.
   */
  const offline = async (why) => {
    const cached = await readCachedCentralSubscription({
      clinicId, origin: normalizedOrigin, email: normalizedEmail, deviceId, storage: store, now: at,
    });
    if (!cached) {
      return refusal({
        ok: false,
        code: 'offline',
        status: 'offline',
        reason: 'Central Auto-Sync could not be reached and this device has no usable cached licence, so the clinic is read-only until it can check.',
        offline: true,
      });
    }
    const lease = cached.lease;
    return {
      ok: false,
      allowed: true,
      status: String(lease.status ?? 'active'),
      plan: planForTier(lease.tier),
      tier: String(lease.tier ?? ''),
      expiresAt: lease.expires_at ?? null,
      graceUntil: lease.grace_until ?? null,
      startedAt: lease.started_at ?? null,
      matchMode: String(lease.match_mode ?? ''),
      reason: why,
      code: 'OFFLINE_GRACE',
      fromCache: true,
      offline: true,
      syncedAt: cached.syncedAt ?? null,
      subscriptionRow: centralSubscriptionRow(lease, { clinicId }),
    };
  };

  if (!response) {
    return offline(`Central Auto-Sync could not be reached (${transportError?.message ?? 'network error'}); the sealed cached licence is still in force.`);
  }
  if (response.ok === false && response.status >= 500) {
    return offline(`Central Auto-Sync answered ${response.status}; the sealed cached licence is still in force.`);
  }

  let answer = null;
  try {
    answer = await response.json();
  } catch {
    answer = null;
  }

  if (!answer || typeof answer !== 'object') {
    // A 4xx from PostgREST (or a gateway page) is not a verdict on this clinic,
    // so the cache is left alone: the clinic keeps the licence it had.
    return refusal({
      code: `http-${response.status ?? 0}`,
      status: 'expired',
      reason: `Central Auto-Sync answered ${response.status ?? 'nothing'} without a subscription. This is a configuration problem on the central project, not a decision about this clinic.`,
    });
  }

  const status = String(answer.status ?? '').toLowerCase();
  const code = String(answer.code ?? '').toUpperCase();

  if (answer.allowed === true) {
    const tier = String(answer.tier ?? '').toLowerCase();
    const lease = {
      allowed: true,
      status: status || 'active',
      tier,
      plan: planForTier(tier),
      expires_at: answer.expires_at ?? null,
      grace_until: answer.grace_until ?? null,
      // `started_at` is the column this release asks the central RPC to return;
      // `current_period_start` is accepted as the same fact under its table name,
      // so the card works whichever of the two the central project exposes.
      started_at: answer.started_at ?? answer.current_period_start ?? null,
      match_mode: String(answer.match_mode ?? ''),
      code,
      server_time: answer.server_time ?? null,
      doctors: answer.doctors ?? null,
      frontdesk: answer.frontdesk ?? null,
      branches: answer.branches ?? null,
      max_machines: answer.max_machines ?? null,
    };
    const seal = await computeCentralSeal(lease, subject);
    try {
      store.setItem(centralCacheKey(clinicId), JSON.stringify({ lease, seal, syncedAt: at.toISOString() }));
    } catch {
      /* quota or private mode: the lease is still good for this session */
    }
    return {
      ok: true,
      allowed: true,
      status: lease.status,
      plan: lease.plan,
      tier,
      expiresAt: lease.expires_at,
      graceUntil: lease.grace_until,
      startedAt: lease.started_at,
      matchMode: lease.match_mode,
      reason: '',
      code: code || 'ACTIVE',
      fromCache: false,
      offline: false,
      syncedAt: at.toISOString(),
      subscriptionRow: centralSubscriptionRow(lease, { clinicId }),
    };
  }

  // A definite refusal: delete the lease first, then report it. The order matters
  // — if anything below throws, the cache is already gone and the clinic stops
  // writing rather than carrying on with a licence Central has taken away.
  clearCachedCentralSubscription({ clinicId, storage: store });
  return refusal({
    code: code || 'SUBSCRIPTION_PAUSED',
    status: status || 'expired',
    reason: String(answer.reason ?? ''),
    expiresAt: answer.expires_at ?? null,
    tier: String(answer.tier ?? FALLBACK_PLAN),
  });
}
