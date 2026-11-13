# Staged authenticated workspace controller

> Latest local evidence: [guarded loader verification](WORKSPACE-LOADER.md) records26/26 Chromium scenarios and943/943 clinic tests plus contributing/security/build/Pages on Node22.22.0. Earlier counts and unrun notes below describe that milestone. Hosted CI, other browsers and live trust/cutover remain unrun.

## Status

Local preparation only. App 1.43/schema21 stays on its existing connection. Neither `workspace-controller.mjs` nor `WorkspacePicker.jsx` is imported by the live App/router. No deployment, SQL application, release bump or activation is included. Keep Master `mint_enabled` and clinical `tenant_access_enabled` OFF.

## Added

- `src/lib/workspace-controller.mjs`: injected Master Auth/client, authenticated one-RPC boot, controlled workspace selection, lazy mint and clinical mount; no anonymous or legacy clinical fallback.
- `src/components/WorkspacePicker.jsx`: controlled accessible view with workspace choices, readiness, reload and sign-out. No Auth effects, router, storage or client creation.
- `tests/workspace-controller.test.mjs`: 26 local tests, including delayed responses, identity changes, claim mismatches, refresh denial, disposal, cleanup failure and concurrent/asynchronous logout.

## Controller contract

Construct with `masterClient`, `masterUrl`, synchronous `mountClinicalClient(descriptor, provider)`, optional `sessionStore`, `storage`, `clearLegacyCache` and injectable `now`. Construction registers an Auth listener, but creates no clinical client and reads no storage. The caller owns the Master client and must dispose the controller at lifecycle teardown.

Use `subscribe`/`getSnapshot` for the controlled view, `boot()` for verified-user discovery, `select(workspaceId)` for explicit connection, `logout()` and `dispose()`. The mount adapter returns the existing tenant-session interface. Only `getClinicalClient()` in READY returns a client. Snapshots contain no token or client. These are staged interfaces, not a live login implementation.

The controller checks `auth.getUser()` before boot and each mint. Minted claims must match the verified subject, selected workspace, clinic, slug, member role and expected Master OIDC issuer. The token gate also checks required claims and maximum 900-second lifetime. This browser-side metadata validation is NOT signature verification: actual JWT verification and row authorization remain the gateway/TPA/RLS responsibility. Production trust has not been proved.

Workspace readiness uses that row's verdict, not the default top-level licence. Stored pointers are selection hints, never authorization. Restored selection still requires an explicit selection/mint; it does not silently mount a client. Epoch checks reject stale boot/mint responses and old workspace refreshes. Auth callbacks invalidate state synchronously without making Auth calls under Supabase's callback lock.

Switching invalidates token providers and waits for old channels/session cleanup before mounting another client. Any cleanup failure blocks remount for the lifetime of this controller. Requests already sent to the server are not undone. Logout removes tenant metadata, awaits an injected sync or async legacy-cache cleanup callback and attempts Master sign-out even when cleanup fails. Failed sign-out locks boot until a successful retry. Cache-cleanup failure remains fail-closed; a retry must not hide it.

## Verification

- Clinic full suite: **817/817 PASS**, including **26 controller tests**.
- Contributing checks: **28/28 PASS**, zero warnings.
- Repository security check: exit 0.
- Production build and Pages checks: PASS.
- Separate Vite JSX compilation + React static rendering: PASS for ready/disabled choices, busy/status accessibility and label escaping. Reproducer: `/home/user/workspace-controller-preparation/verify-picker-render.mjs`.

Evidence logs are `/home/user/workspace-controller-{tests,contributing,security,build,pages,picker}.log`. Runtime is Node 20.20.2; the project-required Node >=22.22 CI is still unrun. Static rendering is not browser E2E. SQL/Edge implementations did not change in this increment; their prior gate results are not a fresh run here.

## Not completed / next gates

Live Master login, router/controller integration, dynamic clinical callsites and handling already-running requests; actual per-tenant PHI IndexedDB migration/deletion and cache-boundary proof; browser E2E; anonymous booking fold; scheduler/retry/revocation operations; live deployment, key provenance/rotation, gateway TPA/JWKS verification; backup/restore and coordinated cutover remain separate work. Passing a cleanup callback in tests does not prove real PHI cleanup. Do not repoint the existing app or enable tenant access based on this increment.
