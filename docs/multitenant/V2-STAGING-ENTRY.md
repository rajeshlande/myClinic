# Guarded v2 staging entry — trust boundary only

## Scope

Separate Vite entry `v2-staging.html` builds alongside the default legacy `index.html`. UPDATED: with explicit VITE_APP_TARGET=v2-staging the root also builds the staging entry, with no legacy app imports. Pages selects this target for v2/account-trust-validation only. Default local/legacy builds retain the original root. See V2-CROSS-REPO-GAP-REVIEW.md for the cross-repo contract mismatch and root correction. No legacy login/store/client imports in staging composition. Existing Central Management UI being live/configurable is not evidence that its deployed boot/mint contracts or gateway trust match this client.

After an explicitly approved bundle transfer/push/build/deploy, open:

`https://rajeshlande.github.io/myClinic/v2-staging.html`

This change is LOCAL ONLY until separately delivered/pushed/deployed. It does not alter the live site by itself. No main merge, SQL, Master change or flag activation required/authorised by this increment.

## Behaviour and configuration

- Uses only reviewed `VITE_CENTRAL_SUPABASE_URL` and `VITE_CENTRAL_SUPABASE_ANON_KEY` public inputs. Current Pages workflow already passes these from Actions variables. Never put privileged keys into frontend configuration. UPDATED owner project mapping: URL must match NEW Master yzgwrnqlugyrzqymzmps exactly (supersedes previous inaqzvzfongngahxptzw staging pin). New clinical remains kvxmcdezpozkvdmvmicr. Both Central Actions variables must be updated together and rebuilt; changing variables does not modify already-deployed JS. Broker issuer/JWKS and clinical trust/provisioning must also match the new Master under separate reviewed configuration; existing historical tests/docs for the old Master are not new-project acceptance. Public-key shape checking is not signature validation.
- Missing/invalid config renders a blocked screen without constructing a client. No fallback to VITE_SUPABASE_* or original clinical project.
- Master client uses in-memory auth: persistSession=false, autoRefreshToken=false, detectSessionInUrl=false; no browser storage injected. Existing Central/clinic sessions are not adopted. No auth/RPC until an explicit action. Session expiry requires sign-in/reload; background refresh intentionally disabled.
- Enter synthetic test-user credentials ONLY into the local deployed form, never chat/Git. Password field cleared immediately on submission; provider errors are not printed. No signup, password reset, OAuth redirect or admin credential editor in this slice.
- Explicit login calls Master password auth, then existing controller getUser + extended sync_clinic_subscription boot. This RPC is NOT read-only: existing Central sync/provisioning can have effects. Use approved synthetic memberships only. Reload workspaces repeats boot, not an inert health check.
- Picker uses existing WorkspaceGate/controller. Choosing an available workspace invokes mint-tenant-token; expected issuer/subject/workspace/clinic/role bindings and expiry are checked by the existing token gate before mount.
- Boot descriptor and mount are pinned to NEW clinical kvxmcdezpozkvdmvmicr; original clinical nosqdnmnztsikfygyiqa is refused before token mint when present in boot. Descriptor still comes from authorised Central response, not browser input/static legacy config. Do not edit Central descriptors blindly to bypass refusal.
- READY means client/token boundary locally ready, NOT gateway JWT/RLS proof. This page sends NO clinical query/write and exposes no raw token/client/key UI. No patients, dashboard, prescriptions, billing, Drive card or legacy store mounted.
- Sign-out uses scope:local on this independent in-memory client. No shared local/session storage cleanup, migration, SW registration or unrelated session revocation. Dispose hook exists for composition tests; no StrictMode effect creates/disposes runtime.
- No storage pointer persistence. Reload returns to sign-in. Controller handles identity change/stale response fencing. Concurrent sign-ins refused. UI operations use existing controller epochs.

## Testing checklist

Use private/incognito window, synthetic identities and approved existing synthetic memberships only. Same Pages origin is NOT backend isolation and a path is NOT separate storage origin. No new SW is registered here; an existing SW may still intercept same-origin navigation. Dedicated staging origin remains recommended. Never clear clinical browser data to fix a stale page.

1. Confirm URL ends `/v2-staging.html`, not root `/#/app/dashboard`.
2. Missing config -> visible blocked message, no auth/clinical request. Missing backend contract -> NOT_READY/ERROR; do not bypass by enabling flags.
3. Synthetic Central sign-in -> loading -> controlled workspace picker if reviewed boot response available. Invalid login -> sanitized refusal.
4. Disabled workspace -> unselectable. Wrong clinical descriptor -> BOOT_FAILED, no clinical request.
5. Available workspace -> mint attempt -> READY only with valid token; otherwise blocked. No clinical requests/PHI should appear.
6. Sign out -> SIGNED_OUT; reload -> no saved staging session. Reopen root separately only if intentionally testing legacy.
7. Do not interpret local READY as real gateway, RLS, signup restriction, membership revocation/rotation or migrated workflow acceptance.

## Remaining work

Synthetic interactive browser/StrictMode/identity-transition evidence for this new composition, exact hosted Central contract/trust verification, staged read-only clinical probe after separate authority, reconciliation/migration/workflow integration, real scoped storage/loader/store, /admin and Drive integration, isolated origin and operational acceptance. Existing browser harness is a separate component proof, not this new page's hosted acceptance.
