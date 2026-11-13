# Staged explicit local-conflict review

## Scope and status

`createWorkspaceConflictReview({lease,persistence,locks,now,randomId})` adds an inert owner-only review capability. This is NOT a mounted human-review screen or complete conflict resolver. It has one explicit resolution: discard all reviewed local conflict sources, invalidate cache and require a fresh guarded load. It never writes to the clinical server, requeues local data, merges fields, force-overwrites a remote row or claims a previously captured remote row is current server truth.

No live imports/activation, migration, SQL/config/deploy/commit/tag/release. Both flags OFF; app1.43/schema21 unchanged. Tests discard synthetic local conflict records only, never real patient data.

## Review protocol

Caller owns a lifecycle-opened persistence handle and current owner operation lease. Exact physical subject/workspace/clinic namespace and role are checked before inspection/confirmation. No fallback owner, separate local Auth claim or cleanup bypass. Role authorization derives from the current controller lease, not a cached staff row (replay already invalidates cache). Expired/read-only subscriptions do not themselves prevent an authenticated owner reviewing/discarding local work: this operation neither grants clinical write authority nor writes remotely.

1. `inspect()` reads the complete durable conflict batch and returns deeply frozen source operations, captured remote values (where present), expectedRevision, reviewId, five-minute expiresAt and a loss warning. No clinical payload is written to metadata or logs by this API. Render these fields only in a properly scoped future review UI; they can contain PHI.
2. Any ordinary outbox work refuses inspection. The API cannot safely resolve dependencies while later queued edits remain. It does not automatically flush/discard that work. All conflicts must be reviewed as a batch; no per-row selective dismissal that might orphan another conflict.
3. A human-facing caller must explain loss and collect an explicit decision before invoking `discardLocal({reviewId,expectedRevision,confirmDiscardLocal:true})`. The API cannot prove the person read/comprehended the data, and the token is not an XSS/security boundary. Do not automate confirmation.
4. Confirmation is one-use per review instance, including invalid/failed attempts after authorization. Another inspection supersedes previous tokens. Tokens are memory-only, time-limited and refuse clock rollback. Dispose or lease invalidation prevents use.
5. Confirmation obtains the same exclusive namespace Web Lock as replay, without waiting if busy. It rereads storage, verifies unchanged revision and no queue, then atomically commits conflicts:[], outbox:[], cache:null under CAS. It never blindly retries. A lock/CAS/revision/expiry/refusal requires renewed inspection and human confirmation.
6. Success returns LOCAL_CONFLICTS_DISCARDED with count and reloadRequired:true. This does NOT undo any already-sent server mutation or mean a remote record has been accepted/verified. Fresh scoped loading is required. No view publication is performed here.

A durable discard can complete just before invalidation/return failure; reread under renewed authorization rather than assuming failure rolled it back. The API does not close its externally owned persistence handle. `dispose()` invalidates the in-memory review only. The facade must be explicitly reset/reloaded after a reviewed resolution; it is not automatically connected.

## Deliberate limits

Local discard permanently removes the durable conflict source operations (no local archive/audit log added). Future UI must offer an appropriately scoped reviewed export/retention policy before such loss if needed. Building/testing this capability does not authorize use against real clinical work. No lossless repair, local-source retry, server-side resolution RPC, refreshed remote comparison, per-conflict merge, human UI or blocked-pending recovery was implemented. Normal queued work intentionally remains a blocker. Same-origin storage/locks do not protect against malicious code, other devices or unregistered raw handles.

## Evidence

Node22.22.0: **20 new tests; full1020/1020 PASS**. Contributing/security/build/Pages exit0. Covers full frozen review, explicit durable discard, token misuse/one-use, owner role, expiry/rollback, stale revision/lease, queued dependencies, replay lock, CAS refusal, cross-instance/superseding reviews, disposal and namespace refusal. IndexedDB tests use fake-indexeddb.

Native Chromium145.0.7632.6 / Playwright1.58.2: **36/36 PASS** (previous34 rerun + native reviewed discard/reload and two-tab stale-confirmation refusal). Zero non-harness requests; synthetic clinical/Auth fixtures, native IndexedDB/Web Locks. Server stopped. No production CSP changes. Real token/RLS, other browser/mobile, real disk-full/OS crash, hosted CI and human review UI remain unverified.

Evidence: `tests/workspace-conflicts.test.mjs`; `/home/user/workspace-conflicts-node22-{summary,tests,contributing,security,build,pages}.log`; `/home/user/workspace-conflicts-browser-tests.log`; `/home/user/workspace-browser-preparation/conflict-browser-results.json`.

Reproduce Node checks using CHECK_LOG_PREFIX=workspace-conflicts-node22 with verify-node22.mjs. Start the synthetic harness server and run `RESULT_FILE=conflict-browser-results.json npm exec --yes --package=node@22.22.0 -- node verify-browser.mjs` from workspace-browser-preparation; stop server afterwards.

## Next gates

Scoped review UI and fresh server comparison/reconciliation policy before broader resolution options. Specialized domain commands, framework ownership/StrictMode and PHI-retention review; lossless reviewed legacy migration, authorized blocked-pending recovery and live trust/deployment validation still precede any coordinated cutover.

Later staged interaction: [fresh comparison and standalone panel](WORKSPACE-CONFLICT-PANEL.md),1033/1033 Node tests and40/40 Chromium scenarios. Still not mounted in live React routes.

Later safety correction: [replay conflict barrier](WORKSPACE-REPLAY-BARRIER.md) stops later sends at the first conflict and blocks reflush while conflicts exist. Conflict+queued-tail recovery remains intentionally blocked pending reviewed whole-workset reconciliation. Latest1057/1057 Node tests,43/43 Chromium scenarios.
