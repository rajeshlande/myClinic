# Staged replay conflict barrier

## Why this increment

Atomic queued edits can depend on earlier optimistic state. The legacy replay engine deliberately drains past conflicts; the staged wrapper previously inherited that behaviour. Sending later operations after a rejected predecessor could replay changes against an unresolved base. This increment changes only staged `workspace-replay.mjs`, not the live legacy engine.

## New behaviour

After obtaining the namespace replay lock and reading the guarded durable revision:

- Any pre-existing durable conflict returns BLOCKED_CONFLICTS with conflict/queue counts. No clinical request, cache invalidation or acknowledgement occurs; durable revision is unchanged. This supersedes the earlier empty-queue IDLE behaviour when conflicts exist.
- Otherwise the existing eligible FIFO batch (up to50, respecting head backoff) is passed to the legacy engine one source at a time.
- A successful source can be followed by the next source. The first source that produces a conflict stops the wrapper. Its complete source is retained in the durable conflict envelope; every unattempted queue entry remains unchanged and in order.
- Temporary retry stops at the current source with its retry metadata; later queue entries remain unchanged. The first conflict yields NEEDS_REVIEW; normal success/retry retain ACKNOWLEDGED/STOPPED. BUSY, IDLE and BACKOFF retain their no-conflict meanings.
- The successful prefix, current conflict/retry, untouched tail and cache:null are still acknowledged together under the original revision CAS. Concurrent append/edit/storage refusal or lease invalidation never licenses a blind overwrite/retry.

This is a **between-source** barrier, not a server transaction or a promise to roll back the current source. The existing merge engine can send non-conflicting fields of the current operation even if its manual fields conflict; tests explicitly preserve that behaviour and verify the later source is not attempted. Already-sent writes may survive local ACK failure/staleness. No exactly-once or distributed atomicity guarantee.

No new role/licence authority rules, SQL, schema tolerance, automatic retry, forced discard or cache overlay were added. Existing server RLS/token/adapter protections remain authoritative.

## Safe halt, not complete reconciliation

When the first conflict has an unsent queue tail, further replay is blocked and the existing local-discard inspector refuses because ordinary queued work exists. This is intentional preservation, **not a solved recovery UX**. Do not bypass the review queue blocker, strip conflicts, or automatically rebase/retry the tail to make progress. A future explicit reviewed whole-workset reconciliation flow must account for all queue/conflict dependencies, fresh remote values, PHI retention and possible partially applied server writes.

A single conflict without queued work remains eligible for the existing owner whole-batch discard review. The current review panel's no-queue, one-use, revision-CAS rules are unchanged. Loader/optimistic writes still refuse unresolved conflict state. The clinical cache may be unavailable while durable work is safely blocked; no unsafe fallback is added.

The conservative global barrier may block independent later work too. No dependency graph or safe parallel partitioning is claimed. This limitation must be resolved/reviewed before live activation.

## Verification

Node22.22.0: **6 new replay tests**, plus2 updated earlier assertions for BLOCKED_CONFLICTS semantics. Full **1057/1057 PASS**; contributing/security/build/Pages exit0.

Coverage includes rejected head/untouched tail, zero remote requests/revision change on reflush, successful prefix before first conflict, deleted-remotely source with dependent successor, retry metadata with unchanged tail, manual-field conflict/current-source partial merge with no later select. Existing50-operation limit, FIFO/backoff, auth denial, stale lease, storage/CAS refusal and full-source retention tests rerun.

Native Chromium145.0.7632.6 / Playwright1.58.2: **43/43 PASS** (previous42 rerun + native replay barrier scenario), zero non-harness requests. Native IndexedDB/Web Locks verifies exactly one rejected request, retained queue tail and conflict source, no new requests/revision movement on reflush, and REVIEW_QUEUED_WORK instead of a discard bypass. Synthetic responses only. Server stopped.

Evidence: `tests/workspace-replay.test.mjs`; `/home/user/workspace-replay-barrier-node22-{summary,tests,contributing,security,build,pages}.log`; `/home/user/workspace-replay-barrier-browser-tests.log`; `/home/user/workspace-browser-preparation/replay-barrier-browser-results.json`.

Reproduce via CHECK_LOG_PREFIX=workspace-replay-barrier-node22 with verify-node22.mjs. For Chromium start server.mjs in workspace-browser-preparation and run `RESULT_FILE=replay-barrier-browser-results.json npm exec --yes --package=node@22.22.0 -- node verify-browser.mjs`; stop server afterwards.

## Release boundary / next gate

Staged uncommitted change only. Both flags OFF; live app1.43/schema21 and App/main/store/offline/Supabase entrypoints unchanged. No real clinical operations, SQL/config/deploy/activation/commit/tag/release. No real Auth/RLS/TPA, other browser/mobile, crash/quota, hosted CI or production reconciliation claim.

Next: reviewed whole-workset reconciliation/retention design and guards for conflict+queued-tail states. Specialized workflows, framework ownership, lossless reviewed legacy migration, authorized blocked-pending recovery and live trust/deployment verification still precede any cutover.
