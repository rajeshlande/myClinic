# Staged guarded outbox replay and durable acknowledgements

> Later increment: [guarded clinical loading](WORKSPACE-LOADER.md) records943/943 Node22 tests and26/26 Chromium scenarios. The921/921 and23/23 figures below describe the replay milestone.

## Status

Local v2 preparation only. Added `src/lib/workspace-replay.mjs`; no live App/router/store/offline-engine importer. Existing app1.43/schema21, legacy outbox/data and connection remain unchanged. No SQL/config/key/deploy/activation/commit/tag/app-version change. Both activation flags remain OFF.

This implements the guarded flush core, NOT the full clinical store or pending-work recovery transport. In particular, a blocked lifecycle fence still cannot be bypassed to replay work.

## Flush contract

`flushWorkspaceOutbox({ lease, persistence, locks, now? })` requires a current operation lease and its matching lifecycle persistence facade. Scope/database-name mismatch or missing Web Locks fails closed. Callers must not substitute a raw handle or static legacy client.

- A separate per-namespace exclusive Web Lock with ifAvailable prevents concurrent participating flushes; another active flush returns BUSY.
- The origin-wide lifecycle lock is NOT held across network work. Facade access still uses it, allowing logout/cleanup to fence storage while a network request is pending.
- Reads at most50 queued operations in FIFO order. A backed-off head stops the batch rather than skipping dependencies; invalid backoff values refuse replay.
- Uses the existing replayOutbox merge, duplicate, conflict, repair and retry policies through the clinic-bound v2 adapter. The released legacy engine itself was not changed.
- Checks the lease, storage fence and original revision before every remote adapter operation. Stale/Auth-token failures are intercepted so the legacy engine cannot turn them into a dropped queue item/conflict acknowledgement.
- After replay, commits remaining queue, durable conflict records and cache:null in ONE IndexedDB CAS transaction. Snapshot invalidation is deliberate: this increment does not merge returned rows into the live UI/store.
- A concurrent append/edit/TTL revision change causes REPLAY_ACK_CONFLICT. No automatic acknowledgement merge or retry overwrites the changed queue. Original/new work remains for a later explicit read/reconciliation.
- Returns only status/counts, not patient rows, source operations, token/client or raw backend errors.

Statuses: BUSY, IDLE, BACKOFF, STOPPED, ACKNOWLEDGED. ACKNOWLEDGED means local flush bookkeeping committed, not distributed atomicity or resolution of every conflict. Inspect conflictCount and remainingCount.

## Durable conflict retention

Conflicts retain the complete original scoped sourceOp, including create data, not just an error/row ID. They also preserve the existing engine's local/remote conflict information inside the same plaintext namespace. Generic rejection text replaces backend-message details in the conflict message. Retry bookkeeping otherwise preserves the legacy engine's policy; no raw error is returned from the flush summary.

Conflict IDs cannot overwrite an already retained conflict: ID collision aborts acknowledgement and keeps the queue. Conflicts must have matching clinic/table/op identity and valid source-op scope; malformed/conflicting writes abort the entire local transaction.

`inspectPending().pendingCount` now counts BOTH queued operations and unresolved conflicts. Cleanup retains both and reports failure. Recovery therefore cannot unblock a workspace merely because its network queue became empty. There is no conflict-resolution/discard UI or API added here.

The v2 adapter also refuses a successful-looking insert/update that returns no row, rather than acknowledging a write without evidence. Lookup/delete missing-row semantics remain unchanged.

## Local storage format compatibility

Existing version1 envelopes remain readable. A conflict-aware commit writes envelope version2 with an explicit conflicts array; ordinary reads may omit conflicts for old version1 records, so callers use `conflicts ?? []`. IndexedDB database schema/version stays1; this is an envelope-format change, not a Central/clinical SQL or app release bump.

Old version1-only readers refuse version2, making downgrade/mixed-code cleanup fail closed instead of overlooking conflict-only work. Version1 records carrying an unexpected conflicts field and version2 records missing their array are refused. No automatic downgrade, legacy-localStorage import, migration or deletion is performed.

## Failure boundaries

Network writes and local acknowledgement are NOT one distributed transaction. A write can reach the server before logout, a browser close, quota failure or CAS conflict prevents local acknowledgement. The durable queue is then retained; future reconciliation relies on existing idempotency/merge logic and authoritative RLS. This does not promise exactly-once writes, undo a sent request or make all old operation types intrinsically idempotent.

If a lease expires just after a local acknowledgement commits, the caller can receive refusal even though its original namespace changed. Cleanup must reconcile that state; do not infer rollback from an exception. Raw/uncooperative handles and legacy tabs do not share these fences/locks. A complete store still needs synchronous lease checks before UI commits, namespace-aware loading and writer lifecycle coordination.

## Verification

**Node22.22.0:** **921/921 tests PASS** (previous900 +20 replay/persistence tests +1 adapter missing-row test). Contributing28/28, zero warnings; repository security command exit0; production build + Pages PASS.

Tests cover atomic queue/cache acknowledgement, create dedupe, full conflict-source retention, conflict-only cleanup blocking, retry/backoff, duplicate-flush locking, stale leases, concurrent append/edit, failed acknowledgement, batch tail preservation, Auth denial, storage-fence refusal, scope mismatch, invalid conflict transaction rollback, ID collision, empty-queue conflict retention and version2 envelope writing.

**Native Chromium145.0.7632.6:** **23/23 scenarios PASS** (previous19 rerun +4 replay scenarios), with native Web Locks/IndexedDB/storage events. New checks cover persisted atomic acknowledgement, conflict-only cleanup/recovery blocking, concurrent append during replay and a second tab returning BUSY without issuing a remote fixture call. Non-harness requests:0. Browser fixtures simulate remote clinical responses; no live Auth/mint/gateway/database traffic or PHI.

Evidence: `tests/workspace-replay.test.mjs`, added adapter test in `tests/workspace-operations.test.mjs`; `/home/user/workspace-replay-{install,unit,node22-summary,node22-tests,node22-contributing,node22-security,node22-build,node22-pages,browser-tests}.log`; `workspace-browser-preparation/replay-browser-results.json`.

Reproduce with the allowlisted synthetic server and existing harness dependencies/prerequisites:

```sh
RESULT_FILE=replay-browser-results.json npm exec --yes --package=node@22.22.0 -- node verify-browser.mjs
CHECK_LOG_PREFIX=workspace-replay-node22 npm exec --yes --package=node@22.22.0 -- node verify-node22.mjs
```

The synthetic server is stopped after verification. No new dependency versions were added. Hosted CI, other browser engines/mobile, genuine quota exhaustion, machine crash, production-origin/CSP and actual gateway trust remain unverified. Backend/SQL unchanged and not rerun here.

## Next gates

Guarded clinical-store loading, tenant-scoped optimistic writes/enqueue, durable human conflict resolution and UI commit boundaries; then reviewed lossless legacy cache/outbox migration and authorized recovery replay for blocked pending work. Live Master login/router/dynamic callsites, public booking fold, actual TPA/JWKS/rotation, scheduled sync/revocation, external backup/restore and coordinated cutover remain separate gates. Do not enable access or repoint the app based on this staged flush core.

Later safety correction: [replay conflict barrier](WORKSPACE-REPLAY-BARRIER.md) stops later sends at the first conflict and blocks reflush while conflicts exist. Conflict+queued-tail recovery remains intentionally blocked pending reviewed whole-workset reconciliation. Latest1057/1057 Node tests,43/43 Chromium scenarios.
