/**
 * Clinical client accessor — the seam that lets Slice 2b migrate the 34
 * `supabase.from` / `supabase.rpc` call sites without changing behaviour.
 *
 * Pure and inert: the legacy client is injected, nothing in `src/` imports this
 * module yet, and no browser globals are touched here.
 *
 * IMPORTANT: the default mode is LEGACY (the existing static v1.43.0 client).
 * `enable()` refuses anything other than a READY tenant session, so the app can
 * never silently switch to an unauthenticated clinical client while Custom OIDC
 * is deferred (decision D2).
 */
import { TENANT_STATES, TenantAuthUnavailableError } from './tenant-client.mjs';

export const CLINICAL_MODES = Object.freeze({
  LEGACY: 'legacy',
  V2: 'v2',
});

export function createClinicalAccessor({ legacyClient = null } = {}) {
  let client = legacyClient;
  let mode = CLINICAL_MODES.LEGACY;

  return {
    get mode() { return mode; },
    getClient() { return client; },

    /** Only a fully authenticated tenant session may replace the legacy client. */
    enable(session) {
      if (!session || session.state !== TENANT_STATES.READY || !session.client) {
        throw new TenantAuthUnavailableError(
          'a READY tenant session is required before switching clients',
        );
      }
      client = session.client;
      mode = CLINICAL_MODES.V2;
      return client;
    },

    /** Logout / rollback to v1.43.0 behaviour. */
    reset() {
      client = legacyClient;
      mode = CLINICAL_MODES.LEGACY;
      return client;
    },
  };
}
