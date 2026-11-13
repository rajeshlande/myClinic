# Staged UI command/snapshot facade

`createWorkspaceStore({controller,lifecycle})` in `src/lib/workspace-store.mjs` composes the guarded loader and atomic optimistic writer. It is an inert external-store API, not a mounted React provider or completed screen migration. No static Supabase/legacy store import, automatic load, flush, cache fallback or migration. Both activation flags remain OFF; app1.43/schema21 remains unchanged. No live Auth, SQL/config/deploy/commit/tag/release action.

## API

- `getSnapshot()` returns a stable, deeply frozen `{state,data,errorCode,pendingCount}` observation until publication.
- `subscribe(listener)` returns an unsubscribe function. Observer exceptions do not abort operations.
- `load()` explicitly fetches through the loader; pending queue/conflicts still block remote replacement. LOADING clears visible data; READY follows scoped durable cache ACK.
- `command(intent)` accepts only the writer's patient/basic-booking command surface, and only after a READY view. Intent is cloned before opening storage. WRITING clears visible data; READY follows atomic cache/outbox commit AND durable readback. The return value is a QUEUED receipt, not server-saved status.
- `dispose()` synchronously clears visible data, unsubscribes, invalidates in-flight work and permanently refuses future actions. Idempotent; the owning controller/lifecycle are not disposed by this facade.

Only one action per facade may run at a time (STORE_BUSY). There is no deferred command queue or automatic retry. A controller snapshot transition synchronously increments generation, clears data and returns IDLE; delayed results and errors cannot overwrite a newer generation. The facade clears busy on transition so a newly authorized workspace can load without waiting for an obsolete operation. Reentrant observer invalidation at READY also prevents returning stale success.

Command publication checks current generation and operation lease after open, commit and readback. If a competing replay removes the operation or invalidates cache, the facade refuses success with STORE_RECONCILIATION_REQUIRED. It does not reconstruct the removed optimistic state. If a durable command commits just before invalidation/readback failure, its queue entry may remain even though the caller receives an error. Never blindly repeat such a command; reviewed reconciliation is necessary.

ERROR views contain no clinical payload or raw backend text. A short allowlist exposes pending/CAS/licence errors; others display STORE_ACTION_FAILED. Promise rejections retain original errors for the caller, which must not blindly render/log raw backend diagnostics. Current implementation clears visible data on a command failure rather than retaining a potentially stale clinical view. Subsequent guarded loading may be blocked by durable pending work; no unsafe force-reload/discard option was added.

## Observation, not a global transaction

READY is an acknowledged observation. Other tabs/replay can change durable state after readback; this facade has no cross-tab clinical cache broadcast or automatic reconciliation. It must not be treated as continuously fresh authorization or permission to overwrite durable revisions. Each command revalidates its lease, licence, membership, references and current durable cache, then uses CAS. pendingCount reflects the observed outbox only (commands refuse any durable conflicts), not a live synchronization badge.

The underlying loader still performs multiple non-transactional HTTP reads. Existing license_state RPC may maintain server subscription state. Returned JS references cannot be erased when a workspace changes; future React consumers must not retain old snapshots. Same-origin storage is not encryption/XSS protection. Framework integration, StrictMode mount/unmount ownership and subscription/readback reconciliation remain unimplemented.

## Verification

Node22.22.0: **18 new facade tests; full1000/1000 PASS**. Contributing/security/build/Pages exit0. Includes stable/deeply frozen snapshots, durable publication, pending refusal, single-flight boundaries, synchronous invalidation, superseded loads/commands, disposal, observer errors/reentrancy, intent cloning, raw-error sanitization, quota refusal and replay between ACK/readback. Tests use actual persistence/lifecycle with fake-indexeddb and synthetic clinical/Auth fixtures.

Native Chromium145.0.7632.6 / Playwright1.58.2: **34/34 PASS**, zero non-harness requests. Previous31 scenarios rerun plus facade load/queued immutable publication, delayed load + logout/busy refusal, and disposal/refusal. Native IndexedDB/Web Locks; synthetic Auth/clinical responses only. Harness allowlist expanded for the new module; product CSP unchanged. Synthetic server stopped after verification.

Evidence: `tests/workspace-store.test.mjs`; `/home/user/workspace-store-node22-{summary,tests,contributing,security,build,pages}.log`; `/home/user/workspace-store-browser-tests.log`; `/home/user/workspace-browser-preparation/store-browser-results.json`.

Reproduce full checks with `CHECK_LOG_PREFIX=workspace-store-node22 npm exec --yes --package=node@22.22.0 -- node /home/user/workspace-browser-preparation/verify-node22.mjs`. For native tests, install harness dependencies/Chromium prerequisites, start server.mjs in workspace-browser-preparation, run `RESULT_FILE=store-browser-results.json npm exec --yes --package=node@22.22.0 -- node verify-browser.mjs`, and stop server.

No live React route/provider or existing callsite imports this facade. No actual disk-full/OS-crash, other browser/mobile, real token/RLS/TPA deployment, hosted CI or backup restore claim.

## Next gates

Reviewed human conflict-resolution commands and UI, specialized domain workflows, explicit reconciliation/subscription design and framework ownership tests. Lossless reviewed legacy PHI/outbox migration, authorized blocked-pending recovery and real trust/deployment verification precede any live login/router/store wiring and coordinated cutover. No activation is implied by this staged facade.

Later separate capability: [explicit local-conflict review](WORKSPACE-CONFLICTS.md),1020/1020 Node tests and36/36 native Chromium scenarios. Not mounted in this facade or a human UI.
