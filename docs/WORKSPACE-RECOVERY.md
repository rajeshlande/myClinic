# Staged explicit recovery for blocked cleanup

> Later guarded-replay increment: [WORKSPACE-REPLAY.md](WORKSPACE-REPLAY.md) records921/921 tests and23/23 Chromium scenarios. pendingCount now includes unresolved durable conflicts as well as queued writes; both remain cleanup/recovery blockers. The900/900 and19/19 figures below describe the original recovery milestone.

## Status

Local v2 increment only. No live App/router/store integration or recovery screen. Existing app1.43/schema21, legacy data/outbox and database connection are unchanged. No live SQL/config/key/deployment/activation/commit/tag/version change. Both activation flags remain OFF.

Added `src/lib/workspace-recovery.mjs`. Shared lifecycle metadata parsing/writing was extracted from the existing coordinator without changing its contract. Persistence gained `inspectPending()`: a readonly transaction returning revision, pending count and cache presence, not clinical records; it does not perform TTL deletion.

## Recovery rules

1. Inject the trusted Master client and the same Web Locks, metadataStorage and IndexedDB used by the lifecycle coordinator. Construction installs a synchronous Auth-generation observer but makes no Auth request, database open or metadata write.
2. `inspect()` calls native Master `auth.getUser()` and rechecks identity around asynchronous work. It returns own workspace/clinic IDs, pending counts, cache-presence/status, expected fence epoch and only a NUMBER of other-account namespaces. It returns no patient rows, queued payload, token, other subject IDs or backend error text.
3. The fence must already be valid and blocked. Missing, corrupt or unblocked metadata is refused, never silently reset or reconstructed.
4. A successful inspection records a same-instance review bound to the verified subject, Auth generation and full metadata fingerprint. `retryCleanup({ expectedEpoch, confirmRetry: true })` requires that review and the current fence. No generic force/unblock/discard/export argument exists. Confirmation is a staged caller contract, not a completed human-facing UI.
5. Retry rotates the blocked fence before cleanup, rechecks verified Auth identity and operates only on that subject's registered scopes. It never passes discardPending. Other accounts' scopes are neither opened nor cleaned. Every operation uses the origin-wide Web Lock.
6. Empty successfully cleaned own scopes are removed from the registry. Pending writes, corrupt/unavailable stores and foreign-account scopes remain, keeping blocked:true. Accounts can sequentially clean their own already-empty scopes; one account cannot clear another account's blocker.
7. Only a completely empty remaining registry clears the block. A new verified lifecycle/controller session is required afterward; old generations do not regain authority. An empty but valid crashed registry can be explicitly recovered after verified review.
8. Each review authorizes one attempt. Auth events, changed identity/fence, disposal or a failed/repeated review require a fresh inspection. No automatic retry on reload.

## API/result contract

`createWorkspaceRecovery({ masterClient, locks, metadataStorage, indexedDB, randomId?, now? })` returns `inspect`, `retryCleanup` and `dispose`.

Inspection returns `{ expectedEpoch, blocked:true, workspaces, otherWorkspaceCount }`. Own workspace entries expose `workspaceId`, `clinicId`, `pendingCount`, `hasCache`, and `status: INSPECTED | UNAVAILABLE`. An unavailable store uses null counts instead of guessing zero. The summary transaction is readonly; opening a registered-but-missing database can still create an empty IndexedDB schema. No legacy database is opened.

A confirmed retry returns `{ status: CLEARED | BLOCKED, blocked, cleanedCount, remainingCount, pendingWorkspaceCount, failedWorkspaceCount, otherWorkspaceCount }`. Storage/metadata/Auth failures throw typed generic errors; a failure is NOT successful recovery. Unblock is written only after final identity/fence validation. If identity changes after a cache was cleaned, the blocked registry is retained; pending writes are still preserved.

`dispose()` invalidates the review and unsubscribes Auth observation. Auth callbacks never call Auth APIs under the Supabase callback lock.

## What pending work still needs

This is cleanup retry, not queued-clinical-change recovery. A namespace with pending writes remains blocked. There is deliberately no delete/export/replay/restore/unblock shortcut in this API. The next work must integrate authorized replay and durable conflict/acknowledgement handling before that pending work can be resolved. A failed legacy migration or ambiguous per-user queue cannot be 'fixed' by clearing this fence.

Cleanup does clear cached snapshots after explicit confirmation, but does not silently discard unsynced operations. All executed tests use synthetic records; no real clinic data was read, erased or migrated.

## Verification

**Node22.22.0:** full suite **900/900 PASS** (previous880 +20 recovery tests), contributing28/28 with zero warnings, repository security command exit0, production build and Pages PASS.

**Chromium145.0.7632.6:** **19/19 browser scenarios PASS** (previous14 lifecycle scenarios rerun +5 recovery scenarios), using native IndexedDB, Web Locks and storage events. New scenarios cover:

- Explicit recovery after page closure during interrupted cleanup with an empty queue.
- Pending work retained and fence remaining blocked.
- Foreign-account namespace isolation in inspection/retry.
- Account change invalidating the review before mutation.
- Two reviewed tabs unable to override each other with a stale fence.

Browser runner used Node22.22.0 and made0 non-harness requests. Master Auth responses are fixtures, not live sign-ins. Native browser storage is real; quota/open failures elsewhere in the suite are injected and interrupted-cleanup checks close a page, not an OS crash. Other browsers, real quota exhaustion, React recovery UI and hosted CI remain unverified. Backend/SQL unchanged and not rerun.

Tests: `tests/workspace-recovery.test.mjs`. Logs: `/home/user/workspace-recovery-unit.log`, `workspace-recovery-node22-{summary,tests,contributing,security,build,pages}.log`, `workspace-recovery-browser-tests.log`. Native results: `workspace-browser-preparation/recovery-browser-results.json`.

Reproduce after installing app/harness dependencies and Chromium prerequisites as described in WORKSPACE-BROWSER-VERIFICATION.md. Start the allowlisted harness server, then from workspace-browser-preparation run:

```sh
RESULT_FILE=recovery-browser-results.json npm exec --yes --package=node@22.22.0 -- node verify-browser.mjs
CHECK_LOG_PREFIX=workspace-recovery-node22 npm exec --yes --package=node@22.22.0 -- node verify-node22.mjs
```

The synthetic server is stopped after verification. Restored workspace dependencies were initially absent; npm ci restored the pinned app/harness dependencies and Chromium/system prerequisites before successful runs. No new dependency was introduced by recovery.

## Boundaries / next step

This remains cooperative same-origin browser code. localStorage/XSS tampering, lost metadata inventory, uncooperative raw handles/legacy tabs, network mutations already sent and server-token revocation are not solved here. Verification relies on a correctly configured injected Master client; real gateway Auth/TPA/JWKS trust is still unproved. Readonly summaries are not an encryption boundary against same-origin code.

Next: leased store/replay integration with atomic cache/queue/conflict acknowledgement, preserving new writes on revision conflicts. Then reviewed legacy PHI/outbox migration and a controlled recovery UI. Live Master login/router wiring, anonymous booking fold, operational scheduling/revocation, actual deployment/TPA/rotation, external backup/restore and coordinated cutover remain separate gates. Do not enable access based on local recovery tests.
