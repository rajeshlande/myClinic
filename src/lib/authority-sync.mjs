/**
 * Syncing the clinic's licence with the authority, and living without it.
 *
 * The shape of this file is the offline promise: a clinic that has a valid
 * token keeps working when the authority cannot be reached, and one whose token
 * has expired stops writing until it can be renewed. Neither outcome is a
 * crash, and neither depends on the browser being trusted — the clinic's
 * database was already given the verdict by its own Edge Function.
 *
 * Everything network-shaped is injected (`invoke`, `now`, `storage`), so the
 * tests drive the whole thing without a server.
 */

import {
  AUTHORITY_FUNCTION,
  authorityView,
  buildFingerprint,
  readAuthorityToken,
  verifyCapabilityToken,
  writeAuthorityToken,
} from './authority.mjs';

/**
 * Ask the clinic's Edge Function to phone the authority, then verify what comes
 * back with our own eyes before caching it.
 *
 * @param {object} options
 * @param {(payload: object) => Promise<{data?: object, error?: unknown}>} options.invoke
 *   `supabase.functions.invoke(AUTHORITY_FUNCTION, { body })`, already bound.
 * @returns {Promise<{ok: boolean, code: string, view: object|null, claims: object|null,
 *   error: string, syncedAt: string|null, fromCache: boolean}>}
 */
export async function syncClinicLicense({
  invoke,
  clinicId,
  publicKeyPem,
  origin = globalThis.location?.origin,
  storage,
  now = new Date(),
  expectedIssuer,
} = {}) {
  const fingerprint = buildFingerprint(origin);
  const nowSeconds = Math.floor(now.getTime() / 1000);

  const cached = readAuthorityToken(clinicId, { storage });
  const cachedView = async (extra = {}) => {
    if (!cached) return null;
    const verified = await verifyCapabilityToken(cached.token, publicKeyPem, {
      nowSeconds, expectedFingerprint: fingerprint, expectedIssuer,
    });
    return verified.valid
      ? { view: authorityView({ claims: verified.claims, now }), claims: verified.claims }
      : { view: null, claims: null };
  };

  if (typeof invoke !== 'function') {
    const fallback = await cachedView();
    return {
      ok: false, code: 'network', error: 'The licence authority is not reachable from this build.',
      view: fallback?.view ?? null, claims: fallback?.claims ?? null,
      syncedAt: cached?.syncedAt ?? null, fromCache: Boolean(fallback?.view),
    };
  }

  let response;
  try {
    response = await invoke({ clinic_id: clinicId, origin });
  } catch (error) {
    response = { error: error instanceof Error ? error : new Error('invoke failed') };
  }

  const failure = response?.error ?? (response?.data?.ok === false ? response.data : null);
  if (response?.error || !response?.data?.ok) {
    // Network, 402 from the authority, "not the owner" — all of them fall back to
    // the cached token. A cached token that is still valid keeps the clinic open
    // for its remaining life; an expired one shows read-only.
    const fallback = await cachedView();
    const contextual = response?.error?.context?.code;
    const code = response?.data?.code
      || (typeof contextual === 'string' && contextual ? contextual : '')
      || 'network';
    return {
      ok: false,
      code,
      error: response?.data?.error ?? failure?.message ?? 'The licence could not be synced.',
      view: fallback?.view ?? null,
      claims: fallback?.claims ?? null,
      syncedAt: cached?.syncedAt ?? null,
      fromCache: Boolean(fallback?.view),
    };
  }

  const data = response.data;
  const token = typeof data.token === 'string' ? data.token.trim() : '';
  if (!token) {
    return {
      ok: false, code: 'authority-token', error: 'The authority returned no licence token.',
      view: null, claims: null, syncedAt: null, fromCache: false,
    };
  }

  // The Edge Function verified this already; verifying it here as well is what
  // lets the screen say "signed by the authority" rather than "the server said".
  const verified = await verifyCapabilityToken(token, publicKeyPem, {
    nowSeconds, expectedFingerprint: fingerprint, expectedIssuer,
  });
  if (!verified.valid) {
    return {
      ok: false, code: verified.code, error: verified.reason,
      view: null, claims: null, syncedAt: null, fromCache: false,
    };
  }

  const syncedAt = data.synced_at ?? now.toISOString();
  writeAuthorityToken(clinicId, token, { storage, syncedAt });

  return {
    ok: true,
    code: 'ok',
    error: '',
    view: authorityView({ claims: verified.claims, now }),
    claims: verified.claims,
    syncedAt,
    fromCache: false,
  };
}

/**
 * The last known licence, without touching the network. Used on boot so the
 * Subscription screen can render a real tier before the first phone-home
 * answers, and when the device is offline.
 */
export async function cachedClinicLicense({
  clinicId, publicKeyPem, origin = globalThis.location?.origin, storage, now = new Date(), expectedIssuer,
} = {}) {
  const cached = readAuthorityToken(clinicId, { storage });
  if (!cached) return { ok: false, code: 'no-cache', view: null, claims: null, syncedAt: null };
  const verified = await verifyCapabilityToken(cached.token, publicKeyPem, {
    nowSeconds: Math.floor(now.getTime() / 1000),
    expectedFingerprint: buildFingerprint(origin),
    expectedIssuer,
  });
  if (!verified.valid) {
    return { ok: false, code: verified.code, view: null, claims: null, syncedAt: cached.syncedAt };
  }
  return {
    ok: true,
    code: 'ok',
    view: authorityView({ claims: verified.claims, now }),
    claims: verified.claims,
    syncedAt: cached.syncedAt,
  };
}

export { AUTHORITY_FUNCTION };
