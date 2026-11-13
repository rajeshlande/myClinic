/**
 * Tenant client policy core — v2.0.0 Slice 1.
 *
 * Pure and dependency-free: no imports, no browser globals, no network calls.
 * The adapter in `clinical-client.js` is INERT in this slice — nothing in `src/`
 * imports it yet, because Custom OIDC / third-party Auth is deferred (decision
 * D2). The normal resting state is therefore `tpa-required` and no clinical
 * client is ever created.
 *
 * The one rule that matters: an `accessToken` callback that returns null makes
 * supabase-js send anonymous requests. A missing token must THROW, never return
 * null, and no clinical client may be built without that callback.
 */

export const TENANT_STATES = Object.freeze({
  UNCONFIGURED: 'unconfigured',
  NO_WORKSPACE: 'no-workspace',
  TPA_REQUIRED: 'tpa-required',
  READY: 'ready',
  DISPOSED: 'disposed',
});

export const TENANT_AUTH_UNAVAILABLE = 'TENANT_AUTH_UNAVAILABLE';
export const TENANT_TOKEN_INVALID = 'TENANT_TOKEN_INVALID';

/** Guard words only — no credential is ever stored here. */
const PRIVILEGED_KEY = /service_role|sb_secret|sbp_/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CACHE_PREFIXES = Object.freeze([
  'myclinic.cache.v2.',
  'myclinic.outbox.v2.',
  'myclinic.tenant.',
]);
export const WORKSPACE_POINTER_KEY = 'myclinic.workspace.pointer';

const DISPOSE_HOOK = Symbol('tenant.dispose');

export class TenantAuthUnavailableError extends Error {
  constructor(reason = 'tenant authentication is unavailable') {
    super(reason);
    this.name = 'TenantAuthUnavailableError';
    this.code = TENANT_AUTH_UNAVAILABLE;
  }
}

export class TenantTokenError extends Error {
  constructor(reason = 'invalid tenant token') {
    super(reason);
    this.name = 'TenantTokenError';
    this.code = TENANT_TOKEN_INVALID;
  }
}

/** Accept an injectable clock so the gate is deterministic in tests. */
function clock(now) {
  return typeof now === 'function' ? Number(now()) : Number(now ?? Date.now());
}

/**
 * Validate the clinical API descriptor returned by the one-RPC boot.
 * Accepts both the short and the boot-response spellings. Never trusts a
 * privileged key, a non-HTTPS URL, or an empty value.
 */
export function validateClinicalDescriptor(descriptor = {}) {
  const d = descriptor ?? {};
  const rawUrl = String(d.url ?? d.clinical_url ?? '').trim();
  const key = String(
    d.publishableKey ?? d.clinical_publishable_key ?? d.anonKey ?? '',
  ).trim();

  const bad = (reason) => ({ ok: false, url: '', publishableKey: '', reason });
  if (!rawUrl) return bad('NO_WORKSPACE');
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return bad('BAD_URL');
  }
  if (parsed.protocol !== 'https:') return bad('URL_NOT_HTTPS');
  if (!key) return bad('MISSING_KEY');
  if (PRIVILEGED_KEY.test(key)) return bad('PRIVILEGED_KEY');

  const url = parsed.origin + parsed.pathname.replace(/\/$/, '');
  return { ok: true, url, publishableKey: key, reason: '' };
}

/**
 * Assert the shape of a tenant capability token before it is handed to the
 * client. Symmetric algorithms, a missing role claim, a non-UUID subject, an
 * over-long lifetime and an expired token are all hard failures.
 */
export function assertTenantClaims(claims, now, maxTtlMs = 900000) {
  const c = claims ?? {};
  const fail = (why) => { throw new TenantTokenError(why); };

  if (c.alg && String(c.alg).toUpperCase() === 'HS256') fail('HS256 is not supported');
  if (!c.kid || typeof c.kid !== 'string') fail('missing kid');
  if (!c.iss || typeof c.iss !== 'string') fail('missing iss');
  if (!c.aud) fail('missing aud');
  if (c.role !== 'authenticated') fail('role must be authenticated');
  if (!UUID.test(String(c.sub ?? ''))) fail('sub must be a UUID');
  if (!c.clinic_id) fail('missing clinic_id');

  const iat = Number(c.iat);
  const exp = Number(c.exp);
  if (!Number.isFinite(iat) || !Number.isFinite(exp)) fail('iat and exp must be numbers');
  if (exp <= iat) fail('exp must be after iat');
  if ((exp - iat) * 1000 > maxTtlMs) fail('token lifetime is too long');
  if (exp * 1000 <= clock(now)) fail('token has expired');
  return c;
}

/**
 * Single-flight, memoised token gate.
 *
 * supabase-js calls `accessToken` concurrently, on connect and on every
 * Realtime heartbeat (25 s by default), and a token that expires between calls
 * closes the channel with no automatic resubscribe. So there is exactly one
 * in-flight mint, and a cached token is refreshed well before its expiry.
 */
export function createTokenGate({
  mint,
  now,
  refreshMarginMs = 120000,
  maxTtlMs = 900000,
} = {}) {
  if (typeof mint !== 'function') throw new TypeError('createTokenGate needs mint()');
  let cached = null;
  let inFlight = null;

  function clear() {
    cached = null;
    inFlight = null;
  }

  async function refresh() {
    const minted = await mint();
    const token = typeof minted === 'string' ? minted : minted?.token;
    const claims = typeof minted === 'string' ? null : minted?.claims;
    if (!token || typeof token !== 'string') {
      throw new TenantAuthUnavailableError('token provider returned no token');
    }
    if (!claims) throw new TenantTokenError('token provider returned no claims');
    assertTenantClaims(claims, now, maxTtlMs);
    cached = { token, claims };
    return token;
  }

  async function getToken() {
    if (cached && cached.claims.exp * 1000 - clock(now) > refreshMarginMs) {
      return cached.token;
    }
    if (!inFlight) {
      inFlight = refresh().finally(() => { inFlight = null; });
    }
    return inFlight;
  }

  return {
    getToken,
    clear,
    get size() { return cached ? 1 : 0; },
  };
}

/**
 * Build a tenant session. FAILS CLOSED: without a valid descriptor and a token
 * provider, `createClientImpl` is never called and `client` stays null.
 */
export function createTenantSession({
  createClientImpl,
  descriptor = null,
  tokenProvider = null,
  onState = () => {},
} = {}) {
  const provider = typeof tokenProvider === 'function'
    ? { getToken: tokenProvider }
    : tokenProvider;
  const hasProvider = Boolean(provider && typeof provider.getToken === 'function');

  let state = TENANT_STATES.UNCONFIGURED;
  let client = null;
  let reason = '';

  const session = {
    get state() { return state; },
    get client() { return client; },
    get reason() { return reason; },
    async getToken() {
      if (!hasProvider) {
        throw new TenantAuthUnavailableError('Custom OIDC is not enabled yet');
      }
      const t = await provider.getToken();
      if (!t || typeof t !== 'string') {
        throw new TenantAuthUnavailableError('token provider returned no token');
      }
      return t;
    },
    clearToken() {
      if (provider && typeof provider.clear === 'function') provider.clear();
    },
    dispose() { return disposeTenantSession(session); },
  };
  // Symbol-keyed, so it never appears in JSON or in an exported state snapshot.
  session[DISPOSE_HOOK] = () => {
    state = TENANT_STATES.DISPOSED;
    client = null;
    onState(state);
  };

  const settle = (next, why) => {
    state = next;
    reason = why;
    onState(next);
    return session;
  };

  if (!descriptor) return settle(TENANT_STATES.NO_WORKSPACE, 'NO_WORKSPACE');

  const checked = validateClinicalDescriptor(descriptor);
  if (!checked.ok) return settle(TENANT_STATES.UNCONFIGURED, checked.reason);

  // D2: TPA deferred. This is the resting state of Slice 1.
  if (!hasProvider) {
    return settle(TENANT_STATES.TPA_REQUIRED, TENANT_AUTH_UNAVAILABLE);
  }
  if (typeof createClientImpl !== 'function') {
    return settle(TENANT_STATES.UNCONFIGURED, 'NO_CLIENT_FACTORY');
  }

  client = createClientImpl(checked.url, checked.publishableKey, {
    accessToken: async () => session.getToken(),
  });
  return settle(TENANT_STATES.READY, '');
}

/** Dispose a session: drop the RAM token and the client, then mark disposed. */
export function disposeTenantSession(session) {
  if (!session || typeof session !== 'object') return false;
  if (session.state === TENANT_STATES.DISPOSED) return false;
  const c = session.client;
  // `dispose()` is optional in supabase-js v2; verify before relying on it.
  if (c && typeof c.dispose === 'function') c.dispose();
  if (typeof session.clearToken === 'function') session.clearToken();
  const hook = session[DISPOSE_HOOK];
  if (typeof hook === 'function') hook();
  return true;
}

/**
 * Switch workspace: dispose the old client, clear the RAM token, and pin the
 * new clinic id. The pointer stays in memory; Slice 2 writes it to
 * sessionStorage with a short TTL. An optional `next` builds the replacement
 * session from the same validated path.
 */
export function selectWorkspace(session, workspace, next = null) {
  const w = workspace ?? {};
  const clinicId = String(w.clinic_id ?? w.clinicId ?? '').trim();
  if (!clinicId) throw new TenantTokenError('workspace has no clinic_id');

  disposeTenantSession(session);
  const pointer = Object.freeze({
    clinic_id: clinicId,
    tenant_slug: String(w.tenant_slug ?? w.tenantSlug ?? ''),
    workspace_id: String(w.workspace_id ?? w.workspaceId ?? ''),
  });

  if (next && typeof next.createClientImpl === 'function') {
    return {
      pointer,
      session: createTenantSession({
        createClientImpl: next.createClientImpl,
        descriptor: next.descriptor,
        tokenProvider: next.tokenProvider,
        onState: next.onState,
      }),
    };
  }
  return pointer;
}

/** Namespaced cache-key prefixes for one clinic. Empty for a missing id. */
export function tenantCacheKeys(clinicId) {
  const id = String(clinicId ?? '').trim();
  if (!id) return Object.freeze([]);
  return Object.freeze(CACHE_PREFIXES.map((prefix) => `${prefix}${id}.`));
}

/**
 * Remove only tenant-namespaced entries and the workspace pointer. Unrelated
 * localStorage settings are left alone. Storage objects are injectable so this
 * stays testable without a browser.
 */
export function clearTenantState({ storage = null, sessionStorage: sessionStore = null } = {}) {
  let removed = 0;
  const doomed = (store) => {
    if (!store || typeof store.key !== 'function' || typeof store.removeItem !== 'function') return [];
    const keys = [];
    for (let i = 0; i < Number(store.length ?? 0); i += 1) {
      const k = store.key(i);
      if (!k) continue;
      if (CACHE_PREFIXES.some((prefix) => k.startsWith(prefix)) || k === WORKSPACE_POINTER_KEY) {
        keys.push(k);
      }
    }
    return keys;
  };

  doomed(storage).forEach((k) => { storage.removeItem(k); removed += 1; });
  if (sessionStore && typeof sessionStore.removeItem === 'function'
    && typeof sessionStore.getItem === 'function'
    && sessionStore.getItem(WORKSPACE_POINTER_KEY) != null) {
    sessionStore.removeItem(WORKSPACE_POINTER_KEY);
    removed += 1;
  }
  return removed;
}
