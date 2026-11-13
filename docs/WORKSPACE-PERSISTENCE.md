# Staged user/workspace/clinic IndexedDB persistence

> Latest local evidence: [guarded loader verification](WORKSPACE-LOADER.md) records26/26 Chromium scenarios and943/943 clinic tests plus contributing/security/build/Pages on Node22.22.0. Earlier counts and unrun notes below describe that milestone. Hosted CI, other browsers and live trust/cutover remain unrun.

## Status and scope

Local v2 preparation only. Live App/router, legacy StoreProvider, localStorage offline engine and existing database connection remain unchanged. No existing cache/outbox is imported, deleted or migrated. No live SQL/config/key/deployment/activation/commit/release. Keep Master mint_enabled and clinical tenant_access_enabled OFF.

Added `src/lib/workspace-persistence.mjs`, tested against IndexedDB API transactions using pinned **fake-indexeddb6.2.8**, a test-only Apache-2.0 dependency with no runtime dependencies. Package/lockfile, dependency safe-list and third-party notices explicitly record this addition. No app version bump; fake-indexeddb is not a browser fallback or imported by src/.

## Verified identity and namespace

The controller now offers `getPersistenceScope()` only while READY: verified Master subject plus selected workspace/clinic IDs. Operation leases preserve that scope. Network-only test controllers without the method may still create operation leases, but cannot open persistence without a valid subject. No tokens or clinical client enter the persisted record.

`openWorkspacePersistence({ lease, indexedDB, now, openTimeoutMs })` requires a current lease with UUID subject/workspaceId/clinicId. Database name includes all three IDs under `myclinic-v2-`; one database has one `workspace` object store and one state record. Namespaces are not a security boundary against same-origin JavaScript/XSS. Data is plaintext and IDs are not secrets. This does not implement encryption or server access control.

## API and durability

- `read()` returns `{ revision, cache, outbox }`. Cache lives at most24h. Expired/future-dated cache is removed transactionally on read, advancing revision; the pending outbox is never expired. This is access-time cleanup, NOT an automatic background sweep of unopened databases.
- `commit({ expectedRevision, cache?, outbox? })` clones inputs immediately and writes one atomic cache+queue envelope. A compare-and-set revision prevents a flush/tab from overwriting a newer append. Omitted fields remain unchanged; cache:null explicitly clears the snapshot. Conflicts require a fresh read/reconciliation, not a blind overwrite.
- Cache root clinic must match scope. Every outbox op explicitly carries top-level clinic_id, unique nonempty op_id, allowed offline table/type and valid row identity. Create rows and any supplied row/patch/base clinic IDs must match. This is a NEW staged queue envelope: legacy queued ops lack the explicit scope and are NOT automatically accepted or transformed.
- `close()` releases this connection. Version changes close it automatically; a new authorized lease/open is needed.
- Errors, clone failures, transaction aborts, invalid scope, corrupt records, blocked opens and open timeout are surfaced; no silent in-memory/legacy fallback and no claim of durable success on failure.

Corrupt envelopes are refused, not silently repaired or deleted. Root clinic validation does not replace validation of every clinical field/branch/role, gateway JWT verification or RLS. Queue contents have not yet been wired to the legacy replay engine.

## Cleanup policy

`cleanup()` may run after lease expiry so a held handle can clear its own namespace during logout. It clears cache and closes its connection. Pending writes remain durable; cleanup rejects with PENDING_WRITES_RETAINED. The integration test verifies that such a rejection through the controller's awaited cleanup callback still attempts Master sign-out and blocks reactivation.

`cleanup({ discardPending: true })` is an explicitly destructive low-level capability, tested only on synthetic fixtures. It must NEVER be passed automatically during rollout/logout/migration. A future operator/user confirmation and recovery policy must authorize any such discard. No real pending data was discarded in this increment.

Cleanup targets only this held namespace, not all historic users/clinics or legacy localStorage. It is not a complete device logout purge, forensic secure erase, all-tab write barrier or proof that retained JS references were removed. Another tab must be coordinated before wiring this into production. If a transaction finishes just before lease invalidation, a write can remain in its original namespace even when the returned result is refused; lifecycle cleanup must handle that case.

## Legacy migration decision

Do not automatically copy the old per-user outbox into a clinic namespace: it may contain unsynced work from multiple clinics or missing scope. Preserve existing live data and pending ops until a reviewed migration can classify every record, stop concurrent writers, verify durable copies and resolve ambiguity without loss. Do not clear legacy data merely because a new namespace opened successfully. This increment deliberately makes NO live migration decision on behalf of the owner.

## Local evidence

- Full suite **860/860 PASS**: previous838 +21 IndexedDB tests +1 real-controller persistence/cleanup integration test.
- Contributing **28/28**, zero warnings; repository security command exit0.
- Production build + Pages PASS; workspace gate Vite JSX/React SSR verifier rerun PASS.
- Dependency install audit:0 vulnerabilities.
- Logs `/home/user/workspace-persistence-{install,tests,contributing,security,build,pages,gate}.log`; test sources `tests/workspace-persistence.test.mjs`, `tests/workspace-controller.test.mjs`.

Checks cover namespace isolation, roundtrip/reopen, structured cloning, TTL durable purge, CAS tab races, corrupt records, payload refusal, stale leases, async transaction invalidation, cleanup retention/explicit discard, open failure/block/timeout, versionchange and real-controller subject/cleanup locking. These are synthetic tests using an in-memory IndexedDB implementation, NOT real-browser IndexedDB, real quota/storage-pressure or cross-tab lifecycle validation.

Local Node20.20.2; required Node>=22.22 CI unrun. Backend/SQL unchanged and not rerun here.

## Next gates

Coordinator for all held namespaces, all-tab barriers and lifecycle cleanup; stale-safe store loading and atomic replay/cache acknowledgements using leases/CAS; reviewed legacy PHI migration including ambiguous/pending outbox handling; real-browser IndexedDB/StrictMode/cross-tab/quota E2E; then live login/router/callsite wiring. Anonymous booking fold, actual gateway TPA/JWKS/rotation, scheduled provisioning/revocation, backup/restore and coordinated cutover remain separate gates. Do not repoint the app or enable access based on this local storage increment.
