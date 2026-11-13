# Staged v2 workspace boundary and dynamic client bridge

> Latest local evidence: [guarded loader verification](WORKSPACE-LOADER.md) records26/26 Chromium scenarios and943/943 clinic tests plus contributing/security/build/Pages on Node22.22.0. Earlier counts and unrun notes below describe that milestone. Hosted CI, other browsers and live trust/cutover remain unrun.

## Scope

Local-only next increment after the authenticated controller. No live entry point imports these files, no current clinical callsite was converted, and no SQL/config/keys/deployment/activation/release changed. Existing app1.43/schema21 behaviour remains intact. Both activation flags stay OFF.

## Files

- `src/lib/workspace-client-bridge.mjs`: immutable v2-only accessor with no client cache or legacy fallback. It checks READY and resolves the controller's current clinical client on **each call**. Missing clients and controller denials fail closed.
- `src/components/WorkspaceGate.jsx`: subscribes using React `useSyncExternalStore`; displays the controlled picker in all non-READY states. READY children receive controller context, keyed by workspace ID so workspace changes request a descendant remount. `useWorkspaceClient()` returns a client-accessor function, not a captured client. Outside the boundary it throws.
- `tests/workspace-client-bridge.test.mjs`: five tests for configuration, non-ready states, workspace changes, denial/no fallback and absence of live imports.

The gate does not create, boot or dispose the controller. The future composition root owns those operations and Master sign-in. This avoids controller creation/disposal inside effects that React StrictMode replays. Explicitly boot before presenting workspace selection; signed-out login remains a separate future UI.

## Intended future use (not wired)

A migrated clinical component may call `const getClient = useWorkspaceClient()` during render, then resolve `getClient()` immediately before each operation. Do not capture the resulting client at module scope, save it in a store or retain queries across workspace changes. The existing legacy StoreProvider MUST NOT be placed inside this boundary until its client and cache paths are migrated.

This bridge intentionally does not extend the legacy accessor's `reset()` behaviour: v2 logout must not fall back to the old database. A dynamic accessor is an API seam, not a data-isolation proof. The controller's token-provider epoch checks remain necessary for clients already returned.

## Local verification

- Full clinic test suite: **822/822 PASS** (previous817 +5 bridge tests).
- Contributing: **28/28 PASS**, zero warnings.
- Repository security command: exit0.
- Production build + Pages: PASS.
- Separate Vite JSX compilation/React static rendering: non-ready states never render clinical child; READY context resolves expected client; hook outside gate refuses. PASS.

Reproducer: `/home/user/workspace-controller-preparation/verify-gate-render.mjs`.
Evidence: `/home/user/workspace-gate-{tests,contributing,security,build,pages,render}.log`.

Static rendering does not test interactive subscriptions, workspace remounts or lifecycle transitions in a browser. Node20.20.2 was used; required Node>=22.22 CI remains unrun. Central/SQL were unchanged, so previous results were not rerun here.

## Remaining gates

Real authenticated login/composition/router integration; actual dynamic callsite conversion; per-tenant IndexedDB migration and mandatory cleanup/error handling; cancellation or rejection of stale responses in clinical stores; real browser transition/StrictMode tests; public booking fold; scheduled provisioning/revocation operations; actual adapter deployment, TPA/JWKS/rotation; backup/restore and coordinated cutover.

A React key is not PHI deletion. A blocked accessor cannot undo a request already sent or erase old in-memory references. Do not enable tenant access or repoint the current app until those boundaries and real trust are verified.
