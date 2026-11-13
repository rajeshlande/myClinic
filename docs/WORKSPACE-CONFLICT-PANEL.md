# Staged fresh conflict comparison and standalone review panel

## Status

Added `workspace-conflict-comparison.mjs` and `workspace-conflict-panel.mjs`. The latter mounts a standalone DOM panel only when explicitly called with a root, controller, lifecycle and locks. It is NOT mounted in App/router/React StoreProvider; no real clinical conflict was compared or discarded. Both activation flags remain OFF. No live SQL/config/deploy/commit/tag/release, migration or automatic resolution.

## Fresh comparison

`readWorkspaceConflictComparison({lease,conflicts,now})` requires a current owner lease and validates the entire input batch before reads. It accepts only the existing offline table allowlist and matching clinic/source/table/op identity. At most50 conflicts per comparison; larger batches refuse the panel rather than silently truncate the whole-batch loss decision.

Each SELECT explicitly filters clinic_id plus row id. Creates also query client_id when supported by that table, so a different row ID with the same dedupe key can be shown. Returned rows must match both clinic and queried identity. Errors (including PGRST116) are refused rather than converted into absence. Null means no visible row returned, NOT proof of deletion. No read fallback, mutation, schema tolerance or new permission rule.

The immutable result contains sourceOp, capturedRemote, byId, byClientId and observedAt. It is sensitive clinical data, not diagnostic metadata. Separate remote reads are NOT one transaction, and the observation timestamp is completion time, not proof of a server point-in-time snapshot. Server values may change before a person decides. This functionality does not make remote overwrite safe or authorize it.

## Standalone panel lifecycle

`mountWorkspaceConflictPanel({root,controller,lifecycle,locks})` returns a dispose handle. It uses owner operation leases and lifecycle storage; fetching is an explicit button action. It obtains the existing one-use review capability, fetches fresh comparisons and verifies that the local revision still matches before displaying them. Failures display generic text, never raw backend diagnostics.

The panel shows a plain structured JSON comparison, not a polished field-by-field merge editor. All content is inserted using textContent, not innerHTML; HTML-like clinical strings remain literal text. A labelled checkbox explicitly acknowledges losing ALL reviewed local changes. Only then is the discard button enabled. Cancel removes the displayed data and review capability without requesting resolution. No force overwrite, accept-server mutation, retry-local or automatic selection exists.

Confirmation uses the existing owner review API: short-lived one-use token, exact unchanged durable revision, no ordinary queued work, replay lock and atomic local cache/conflict invalidation. A successful local discard does NOT undo remote writes and requires guarded workspace reload. The panel does not automatically reload or publish into the store facade. Failure after a possible commit instructs renewed comparison; it does not claim rollback.

Controller transitions synchronously clear review data and capability; disposal clears the root, closes owned handles and invalidates in-flight asynchronous results. It does not dispose the caller-owned controller/lifecycle. Pending old reads may finish but must not repopulate a changed/disposed panel. No click action automatically executes on mount. Framework ownership/StrictMode and real route navigation still require separate integration review.

## Limits and human decision

This is a staged review interaction, not a complete production conflict UX or accessibility audit. It cannot prove comprehension, continuous remote freshness or eliminate same-count/inter-read races. There is no durable audit/export/archive for discarded local sources; PHI retention/loss policy must be approved before use on real work. The raw review API remains separately callable; safe human confirmation is a caller obligation, not an XSS security boundary. Direct callers of the panel should preserve owner-only routing and avoid retaining detached DOM/snapshot references.

Ordinary queued work blocks review: no unsafe dependency bypass was added. Large batches, lossless local-source repair, specialized domain writes, background reconciliation, authorization recovery and legacy data migration remain unresolved gates.

## Evidence

Node22.22.0: **13 new comparison tests, full1033/1033 PASS**. Contributing/security/build/Pages all exit0. Coverage includes exact query filters, source/response scope refusal, owner requirement, create dedupe-key comparison, immutable results, missing-row semantics, backend error refusal, batch/duplicate limits, clock and stale-result refusal.

Chromium145.0.7632.6 / Playwright1.58.2: **40/40 PASS** (previous36 rerun +4 actual panel scenarios): fresh comparison/literal-text safety/required checkbox/durable discard; cancellation retention; invalidation/disposal clearing; delayed comparison cannot repopulate disposed panel. Zero non-harness requests. Synthetic Auth/clinical fixtures only; native IndexedDB/Web Locks. Server stopped.

Dependencies were restored with npm ci in app/harness and Chromium prerequisites installed after the first runner invocation found missing Playwright. Final full runs passed. Product entrypoints/CSP/tier contract unchanged.

Evidence: `tests/workspace-conflict-comparison.test.mjs`; `/home/user/workspace-conflict-panel-node22-{summary,tests,contributing,security,build,pages}.log`; `/home/user/workspace-conflict-panel-browser-tests.log`; `/home/user/workspace-browser-preparation/conflict-panel-browser-results.json`. Harness allowlist expanded only for the two staged modules and a synthetic HTML-like comparison string.

Reproduce after installing dependencies/Chromium prerequisites: start server.mjs in workspace-browser-preparation, run `RESULT_FILE=conflict-panel-browser-results.json npm exec --yes --package=node@22.22.0 -- node verify-browser.mjs`, stop server. Full Node checks use CHECK_LOG_PREFIX=workspace-conflict-panel-node22 with verify-node22.mjs.

No real Auth/token/RLS/TPA, hosted CI, other browsers/mobile, screen reader/accessibility, actual disk-full/OS crash or backup restore verification.

## Next gates

Specialized domain commands and reconciliation/retention policy; React ownership/StrictMode and reviewed screen integration before mounting. Lossless reviewed legacy PHI/outbox migration, authorized blocked-pending recovery and real trust/deployment checks still precede live activation/cutover.

Later safety correction: [replay conflict barrier](WORKSPACE-REPLAY-BARRIER.md) stops later sends at the first conflict and blocks reflush while conflicts exist. Conflict+queued-tail recovery remains intentionally blocked pending reviewed whole-workset reconciliation. Latest1057/1057 Node tests,43/43 Chromium scenarios.
