# Staged origin-wide workspace storage lifecycle

> Latest local evidence: [guarded loader verification](WORKSPACE-LOADER.md) records26/26 Chromium scenarios and943/943 clinic tests plus contributing/security/build/Pages on Node22.22.0. Earlier counts and unrun notes below describe that milestone. Hosted CI, other browsers and live trust/cutover remain unrun.

## Status

Local v2 increment only. `src/lib/workspace-lifecycle.mjs` has no live App/router/store importer. Existing app1.43/schema21, static client, legacy cache/outbox and user data remain unchanged. No live database/config/keys/deploy/activation/commit/version change. Both activation flags remain OFF.

## What the coordinator adds

- One origin-wide Web Lock serializes all participating storage operations and cleanup. No lockless fallback when Web Locks or durable metadata are unavailable.
- A durable localStorage metadata record (`myclinic.v2.lifecycle.v1`) holds only a generation fence, blocked flag and registered subject/workspace/clinic UUIDs. No patient payload, queued row, token or key is written there.
- Register a namespace BEFORE opening its IndexedDB database, so a normal crash between registration and first PHI write does not orphan that database from the registry.
- Facade reads/commits validate the same generation under the lock before/after storage access. Commits clone inputs before waiting for the lock. CAS revisions remain enforced by the underlying persistence layer.
- Storage events notify an injected invalidation callback; the durable check rejects old sessions on their next facade access even if that notification never arrives.
- Cleanup changes generation and persists blocked:true before touching registered namespaces. It clears every registered cache using private cleanup-only handles, including namespaces opened by another participating tab. It NEVER passes discardPending.
- Any retained pending write or cleanup failure leaves the durable fence blocked, preserving the registry for recovery. A new coordinator cannot silently bypass that state.
- Only complete cleanup clears the registry and unblocks creation of a newly authenticated session. Old coordinator generations stay invalid. A stale coordinator cannot clean a newer generation's login.

## Staged API

Construct with injected `locks` (future navigator.locks), `metadataStorage` (future localStorage), `indexedDB`, optional `eventTarget` (future window), `onInvalidate`, randomId and clock. Construction only installs the optional listener. It does not create a clinical client, read storage, open IndexedDB or perform Auth/network work.

`open(verifiedOperationLease)` returns a facade with `name`, `read`, `commit` and `close`. All participating v2 code must use that facade; never expose or retain raw persistence handles. Call `close` when releasing a handle, but registry entries remain for later cleanup. Holders need not keep databases open for cleanup to find them.

`cleanup()` immediately invalidates local handles, then performs the origin-wide fenced cleanup. Concurrent calls share the same promise, including a failed result. There is no automatic retry/unblock/discard API. A failed cleanup requires an explicit recovery workflow, still pending.

`dispose()` closes local handles and removes the event listener. It does NOT purge data, sign out Auth or revoke other tabs. It also calls the local invalidation callback once. The owner still must call Master sign-out and await cleanup using the controller lifecycle.

The future composition root must wire `onInvalidate` to synchronously invalidate/dispose its controller and unmount PHI UI. A persistence fence alone does not revoke clinical network tokens. The two-controller integration test demonstrates this callback wiring without activating the live app. Default callback is inert; it is not a production-ready Auth composition.

## Scope and important limits

This is cooperative same-origin browser coordination, not an access-control boundary against XSS or arbitrary JavaScript. Web Locks/localStorage do not coordinate different origins, devices or deployed versions that ignore the facade. Legacy tabs, raw persistence callers and in-flight server mutations do not participate. JWT expiry/revocation and RLS remain server concerns.

All facade storage work is serialized, not held across arbitrary network requests. This increment does not integrate clinical store loads, replay, queue acknowledgements or UI state commits. Lease checks remain necessary there.

Cleanup reaches registered NEW v2 namespaces only. It never enumerates/deletes old app1.43 data or imports its outbox. Unopened legacy data and manually orphaned databases require the separate reviewed migration/recovery plan. Selective deletion/corruption of lifecycle metadata can lose registry knowledge; existing coordinators fail closed, but a brand-new coordinator cannot reconstruct absent historical metadata. Production recovery must reconcile registry and database inventory before activation. A metadata write failure prevents claiming cleanup success and may prevent revoking other participating tabs: do not treat it as completed logout.

Pending-write retention deliberately prevents a clean activation until recovered. No pending data is discarded automatically. A blocked fence left by a crash is not automatically repaired by reload. Corrupt data remains refused; there is no silent repair/reset.

This does not prove device-wide/forensic PHI erasure, removal of JS references, browser-engine disk sanitization or a lossless legacy migration. It is a staged interlock; do not repoint the app based on it.

## Verification

- Full clinic suite: **880/880 PASS** (previous860 +19 lifecycle tests +1 actual-controller integration).
- Contributing **28/28**, zero warnings; repository security command exit0.
- Production build + Pages PASS; workspace gate Vite compile/React SSR rerun PASS.
- No new dependency this increment; prior pinned fake-indexeddb dev dependency is reused.

Tests cover shared lock serialization/CAS, pre-open registration, tracked namespaces after handle close, cross-coordinator cleanup, dropped storage-event fencing, callback invalidation, pending retention and durable block, stale cleanup/new-login protection, concurrent cleanup, metadata failures/corruption, captured commits, expired leases, disposal and queued-after-logout writes. Actual-controller test confirms remote token-provider rejection with callback wiring.

Tests use an in-memory IndexedDB implementation, shared simulated lock queue and synthetic storage events. They are NOT real-browser Web Locks/IndexedDB/multiple tabs, browser crash/quota/private-mode verification or production network Auth proof. Local Node20.20.2; required Node>=22.22 CI remains unrun. Unchanged backend/SQL tests were not rerun here.

Evidence: `/home/user/workspace-lifecycle-{unit,tests,contributing,security,build,pages,gate}.log`; source `tests/workspace-lifecycle.test.mjs`, integration in `tests/workspace-controller.test.mjs`.

## Next gates

Real-browser lifecycle/lock/storage-event/crash/quota checks and explicit blocked-fence recovery; leased store loading/replay with atomic cache+queue+conflict acknowledgements; reviewed legacy cache/outbox migration and all-tab writer exclusion; then live Master login/router/client callsite wiring. Public-booking fold, actual TPA/JWKS/rotation deployment, scheduled sync/revocation, external backup/restore and coordinated cutover remain separate work.
