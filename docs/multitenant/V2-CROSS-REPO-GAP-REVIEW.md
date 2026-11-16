# Cross-repository architecture review and root-entry correction

## Exact source reviewed

- Clinic remote v2/account-trust-validation:bec78e2db7e513f4e6c8fc2a3cc8c5e972886cbd.
- Central remote central_tenent_mangement:9380edfe5143fe77b310970c088d49597a578e40. Read-only GitHub archive inspection in ignored scratch; separate working Master repository left untouched. Branch spelling retained as supplied.
- User-supplied clinical logs/metadata: profiles.id -> central_identities.user_sub FK, enabled on_auth_user_created/handle_new_user local Auth trigger, repeated23503; separate42501 for patients/app_schema_version. Not a fresh privileged hosted DB inspection.

## Root cause of observed routing

Legacy src/main.jsx -> AuthProvider -> App/StoreProvider -> static VITE_SUPABASE_* client still served at root after bec78e2. Creating an additional HTML entry did not change index. Therefore ordinary signup/login/accept_invite ran against original project nosqdnmnztsikfygyiqa. This is a deployment composition failure, not evidence that the new clinical DB password or grants need changing. A400 response requires redacted response code to diagnose separately;403 must not be solved with broad grants.

## Correction in this increment

Explicit VITE_APP_TARGET=v2-staging selects an early Vite HTML transform so ROOT index builds from v2-staging.html before module discovery. Default/local legacy build remains unchanged. Unknown target fails closed. Existing Pages workflow selects v2-staging for the exact v2/account-trust-validation ref and omits legacy clinical secrets for that build. No runtime query/URL parameter toggles legacy mode. Manual local build: VITE_APP_TARGET=v2-staging npm run build (PowerShell: $env:VITE_APP_TARGET='v2-staging'; npm run build).

Both root and explicit staging HTML mount guarded Central/workspace trust harness. Legacy pages/PHI cache, signup/invite RPC and store not emitted in staging JS. Build verifier checks HTML/asset presence and rejects original-project hostname and legacy accept_invite/license_state RPC strings. CI Pages invokes it for this branch before upload. No main merge or workflow auto-deployment trigger broadened; existing manual deployment still required. Production root must not be assumed preserved on the same Pages URL: one site/artifact, dedicated staging origin recommended. Existing SW/cache can still display stale shell offline; use private fresh context, no site-data clearing.

## Central branch: directory is not broker identity integration

Remote schema.sql includes workspaces with supabase_url/supabase_anon_key/is_active and workspace_members(user_id,role), linking subscriptions. Existing sync_clinic_subscription response returns subscription fields plus one `workspace` containing slug,supabase_url,supabase_anon_key,tenant_schema_version. Its existing anonymous subscription routing is not an authenticated tenant boot authority.

The clinic controller expects authenticated getUser then an extended boot with `workspaces[]` including workspace_id,clinic_id,tenant_slug,member_role,ready,licence and a validated clinical descriptor. It then invokes mint-tenant-token and validates scoped RS256 claim metadata/expiry. Central remote function directory contains verify-license only; no mint-tenant-token, oidc or sync-clinic-memberships functions in that inspected archive. Additional out-of-repo deployed code cannot be excluded; hosted deployment unknown, do not infer absence from source alone.

Central directory roles admin/doctor/staff do not equal clinic owner/doctor/frontdesk. No automatic admin->owner or staff->frontdesk mapping authorised here. Directory workspace ID, clinical clinic ID, membership authority/revision and licence policy must be explicitly mapped. A clinic URL/public key and active subscription do not establish who may access PHI. Never feed an anonymous workspace pointer straight to a clinical client or create matching users independently in clinical Auth.

Separate local Master workspace contains UNCOMMITTED schema5/boot/OIDC/mint/sync preparation that is NOT in inspected Central remote branch. Those files predate this review and are not safely interchangeable patches: reconcile additive schema5 preparation with the newer remote directory schema and role definitions in a reviewed local copy. Standing constraint: no commit/deploy in separate Master repo without explicit authority. Do not blindly paste stale consolidated Master SQL over the live management app.

## Missing gates in dependency order

1. Cross-repo accepted schema/API/role/workspace-clinic identity matrix; preserve existing Central subscriptions/directory. Decide whether shared-clinical project registry is global or per-workspace; chosen F1 remains shared clinical RLS, not independent password login to arbitrary projects.
2. Additive Central user invitation/membership authority and reviewed authenticated boot contract; signup policy. Boot uses caller identity, never browser email/URL as membership authority.
3. Trusted idempotent identity/membership/licence provisioning with revisions, revocations, retries and authenticated endpoint; inserts same Central UUID in clinical registry. Clinical local Auth trigger/signup policy needs explicit reviewed refusal rather than current FK error. Preserve FK; no random identity inserts.
4. RS256 broker, HTTPS discovery/JWKS, key custody/rotation, gateway trust, exact issuer/sub/role validation, allowed+denied RLS checks and OFF flags until authority. Local token metadata checks not cryptographic gateway proof.
5. Guarded Central login is now a deployable boundary harness, not complete P5. No new signup/invitation UI, clinical query or PHI workflow. Complete reconciliation+queue handling, lossless legacy migration, bounded field/paged loader and all specialised commands before migrating screens/store. Never put legacy store inside WorkspaceGate.
6. P6 /admin combined delivery remains incomplete. Existing separate Central management UI is not combined-origin clinic/admin acceptance.
7. P7 source/Google production integration, scheduling/retention/alerts, actual isolated DB restore and RPO remain pending despite local prototypes. P8 pilot/rollback/governance pending.
8. Synthetic interactive/hosted browser checks incl StrictMode/login/identity transitions, separate origin, authenticated gateway denial/rotation evidence. Earlier Chromium-install failure and synthetic43-case historical harness do not prove new entry works hosted.

## Safe staged acceptance after delivery

1. Deploy exact new clinic commit from v2 only through existing Pages workflow (not branch-root source publishing).
2. Fresh/private browser root shows `v2 staging — trust boundary test`, never legacy signup/dashboard. Missing Central config blocks before client construction.
3. Network: no nosqdnmnztsikfygyiqa, no clinical local signup, accept_invite or license_state.
4. Explicit synthetic Central login only. Existing unchanged Central boot should block NOT_READY rather than silently use old workspace pointer. This is expected until reviewed backend contract is delivered; do not change grants or enable flags to bypass it.
5. After separately reviewed Central reconciliation/deployment, test controlled picker/mint with exact new clinical descriptor. READY only local boundary; real RLS/gateway acceptance separate.

No live SQL, account changes, privileged keys, push/deploy or tenant activation in this local increment. Original clinical schema21 remains protected. No blanket claim of completed v2 clinic creation/login.
