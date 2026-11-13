import { createClient } from '@supabase/supabase-js';
import { createTenantSession } from './tenant-client.mjs';

/**
 * Slice 1 — INERT adapter.
 *
 * Nothing in `src/` imports this module yet. Custom OIDC / third-party Auth is
 * deferred (decision D2), so a session created here rests at `tpa-required`:
 * `createTenantSession` fails closed and never calls `createClient`.
 *
 * Slice 2 wires this after TPA and the section 22 RLS exist. Central-client
 * configuration is deliberately not read here — App 2 keeps exactly two
 * `VITE_CENTRAL_*` build-time values and receives the clinical API descriptor
 * from the one-RPC boot instead.
 */
export function mountClinicalClient(descriptor = null, tokenProvider = null) {
  return createTenantSession({
    createClientImpl: createClient,
    descriptor,
    tokenProvider,
  });
}
