# Staged clinical operation leases and v2 outbox adapter

> Latest local evidence: [guarded loader verification](WORKSPACE-LOADER.md) records26/26 Chromium scenarios and943/943 clinic tests plus contributing/security/build/Pages on Node22.22.0. Earlier counts and unrun notes below describe that milestone. Hosted CI, other browsers and live trust/cutover remain unrun.

## Status

Local-only increment. App1.43/schema21 and its static client, StoreProvider, legacy offline engine and existing outbox adapter are unchanged. The new modules have no live importer. No deployment, live SQL/config/keys, activation, commit or release. Keep both activation flags OFF.

## Added

`src/lib/workspace-operations.mjs` provides `createWorkspaceOperations(controller).lease()`. A lease captures a READY snapshot, selected workspace/clinic and current client. `lease.run(client => operation)` validates before issuing work and after asynchronous completion. Snapshot identity changes invalidate it even when the same workspace reconnects. Delayed results and errors from old workspaces are rejected rather than returned. `lease.assertCurrent()` is available for the immediate state/cache commit boundary.

`src/lib/workspace-outbox.mjs` provides `createWorkspaceOutboxDb(lease)` with the existing replay adapter method shape: `selectOne`, `insert`, `update`, `remove`. One adapter belongs to ONE flush lease, not the whole app lifetime. It uses the existing offline TABLES allowlist, requires matching clinic_id on inserts, refuses changes to clinic_id and adds explicit clinic filters to lookup/update/delete. Single-row responses must match the clinic. Missing-row PGRST116 is tolerated only on lookup/delete, never as successful insert/update acknowledgement. Gateway verification and RLS remain authoritative; filters are defense in depth.

## Future integration rules

1. Acquire a lease at the start of a clinical load or outbox flush.
2. Use its client only inside `lease.run(...)`, or create its v2 outbox adapter.
3. Immediately before synchronously committing returned data or queue bookkeeping, call `lease.assertCurrent()` again. An additional await can invalidate a previously accepted result.
4. Never continue replay using a newly selected workspace's client. An expired lease must stop the flush; queue/cache must remain namespaced to its original user/clinic.
5. New workspace UI/store state must not retain references to previous data.

These files do not integrate replayOutbox or its queue acknowledgement logic. Therefore they do NOT yet prove a complete stale-safe replay loop or migrated store. They do not cancel network requests, roll back already-sent writes, delete IndexedDB/localStorage PHI or scrub retained JS references. Retry/idempotency/conflict semantics still belong to the existing replay engine and require integration tests when wired. No legacy cache or outbox is imported/copied/deleted by this increment.

## Verification

- Full clinic suite: **838/838 PASS** (16 additional tests).
- New operation/outbox tests:15; real-controller lease integration:1, verifying switch, same-workspace reconnect and logout expiry.
- Contributing28/28, zero warnings; repository security command exit0.
- Production build and Pages PASS.
- Prior workspace gate JSX/static-render verifier rerun PASS.
- npm ci restored missing workspace dependencies after the initial build reported `vite: not found`; installation audit reported0 vulnerabilities. Package/lock versions unchanged.

Logs: `/home/user/workspace-operations-{tests,contributing,security,install,build,pages,gate}.log`.
Node20.20.2 was used; required Node>=22.22 CI remains unrun. No browser E2E or fresh SQL/Central test run in this unchanged-backend increment.

## Next work

Implement the tenant/user-scoped cache/outbox persistence boundary and explicit PHI migration/cleanup policy, then migrate clinical store loads and replay commits with leases. Preserve branch/role/licence semantics. Live login/router wiring, anonymous booking fold, real TPA/JWKS/rotation verification, operational scheduling/revocation and backup/restore/cutover remain separate gates.
