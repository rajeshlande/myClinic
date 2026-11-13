# Staged guarded clinical-store loading

## Status

Local v2 increment only. Added `src/lib/workspace-loader.mjs` and22 tests. Operation leases now preserve the selected workspace's memberRole. No live App/router/StoreProvider importer, existing clinical callsite conversion or legacy cache/outbox migration. Existing app1.43/schema21 connection/data remain unchanged. No SQL/config/keys/deploy/activation/commit/tag/version bump. Both activation flags remain OFF.

This is the clinical-read and cache-publication core, not a completed StoreProvider migration. Optimistic local writes/enqueue and conflict-resolution UI are still pending.

## Loader contract

`readWorkspaceClinicalSnapshot(lease)` reads one selected clinical workspace through lease.run; it does not import a static client. `createWorkspaceStoreLoader({ controller, lifecycle })` adds scoped persistence, latest-request sequencing, subscribe/getSnapshot, load and dispose.

- Requires a verified subject and memberRole from the operation lease.
- Reads the selected clinic and only the subject's own profile. A missing profile stays null: no profile upsert, invite claim, onboarding, provisioning or anonymous/legacy fallback.
- Requires exactly one active mirrored staff row for the subject, matching the boot/minted member role. No fallback to an owner, first staff member or another clinic.
- Every table with clinic_id is explicitly clinic-filtered, including schema22 staff_branches. Returned rows are validated as well; malformed cross-clinic responses refuse the whole snapshot.
- Uses existing branch helpers. Owners retain all-active-branch scope; doctors/front desk require exactly one assigned active branch and cannot restore an owner 'all' preference. Appointment/consultation/invoice/day-close queries explicitly filter non-owner branch IDs; returned branch IDs are validated. Patients remain clinic-shared. Non-owners do not query invitations.
- Unknown assignment endpoints, missing branches and missing required schema tables are refused rather than inventing an implicit Main branch or claiming an empty result. This is intentionally stricter than the legacy schema-compatibility fallback: staged v2 requires its prepared schema22 contract.
- Reads tables with stable primary-key ordering, exact counts, ranged pages (up to500 requested rows) and duplicate detection. A smaller server row cap continues from the actual number received; absent/changing counts, duplicate/missing rows or resource limits refuse publication. At most20 requests/10,000 rows per table; larger clinics need a reviewed incremental/paged-store strategy, not a silent truncated snapshot.
- Reuses the existing license_state RPC and server verdict. Errors/missing verdict leave subscription:null/subscriptionUnknown:true, never an invented write grant. Wrong-clinic verdict or stale/token denial refuses publication.

Although table access is SELECT-only, license_state is an existing server RPC that may maintain/create a subscription record when absent. This increment does not change that RPC and does not claim the overall load is guaranteed side-effect-free. Tests use injected clinical responses only; no live RPC was called. Future live wiring must account for its established server behaviour.

## Cache and UI publication boundary

`load()` starts with a new controller operation lease, opens only its lifecycle namespace and reads the revision. Existing queued writes OR unresolved durable conflicts cause LOAD_UNRESOLVED_WORK before clinical reads, preventing an incoming snapshot from erasing optimistic work.

After scoped reads, the loader writes cache under the original revision without changing queue/conflicts. Concurrent enqueue/edit/replay/TTL revision movement causes LOAD_ACK_CONFLICT. It does not retry over newer local state. Only after durable cache acknowledgement and current-lease/latest-request checks does it publish READY with deeply frozen data.

Any controller snapshot transition synchronously clears visible data and invalidates pending loads. Overlapping loads cannot publish an older result over a newer request. Disposal unsubscribes and refuses reopening. Failures publish only a generic safe error code and no partial data; raw backend messages do not enter the view snapshot. Returned old JS references cannot be erased; future UI must not retain them across workspace changes.

There is deliberately no offline/cache fallback in this increment: a snapshot loaded under an earlier role or membership is not used to bypass fresh authorization. Future offline behaviour requires its own validated role/branch/lease policy.

Multiple HTTP reads do NOT form one database transaction or point-in-time snapshot. Count/duplicate checks detect some pagination races, not all concurrent updates. RLS/gateway verification remains authoritative on each query. A superseded or invalidated load may have committed a cache in its original namespace before refusal, but it must not publish stale UI; lifecycle cleanup still owns cache retirement.

## API and integration limits

`load()` returns a frozen `{ state, data, errorCode }` snapshot on success; failures reject and update only the current request's view. `getSnapshot()` is stable between publications and `subscribe()` is suitable for a future external-store hook. Controller ownership/Auth login and lifecycle cleanup remain outside this loader.

Data resembles the legacy clinic snapshot and additionally includes currentStaff, allowedBranchIds and subscriptionUnknown. It is not yet mounted under existing screens. No optimistic merge/write methods, human conflict-resolution API or new server permission rule were added. Unknown licence is a display/authorization warning; future write paths must still enforce the existing licence/capability gates and RLS rather than trusting cache/READY.

## Verification

**Node22.22.0:** full clinic suite **943/943 PASS** (previous921 +22 loader tests). Contributing28/28, zero warnings; repository security command exit0; production build and Pages PASS. No new dependency versions.

Tests cover owner/doctor/front-desk branch behaviour, exact/duplicate/mismatched membership, clinic/profile/branch response checks, required tables, missing licence, pagination/server caps/count changes/duplicates/limits, pending/conflict blockers, concurrent append CAS, synchronous invalidation, delayed/overlapping loads and disposal. The live entry-point absence is asserted.

**Native Chromium145.0.7632.6:** **26/26 scenarios PASS** (previous23 rerun +3 loader scenarios). Native IndexedDB/Web Locks/storage events verify durable scoped publication, delayed load refusal after controller logout and enqueue-during-load preservation/CAS refusal. Auth/clinical responses remain synthetic; non-harness requests:0.

The first extended browser run could not initialize because JSON module fetches for the shared tier contract were blocked by the synthetic harness's connect-src:none. The harness now permits same-origin connections, explicitly serves only that public JSON contract and allowlisted modules, and the runner rejects all off-origin requests. Diagnostics now fail initialization after5s rather than waiting30s per scenario. All26 checks passed after that harness correction. Production CSP, tier contract and licence implementation were not changed. The synthetic server is stopped after verification.

Evidence: `tests/workspace-loader.test.mjs`; `/home/user/workspace-loader-{install,unit,node22-summary,node22-tests,node22-contributing,node22-security,node22-build,node22-pages,browser-tests}.log`; `workspace-browser-preparation/loader-browser-results.json`.

Reproduce after app/harness dependencies and Chromium prerequisites are installed; start the synthetic server, then run from workspace-browser-preparation:

```sh
RESULT_FILE=loader-browser-results.json npm exec --yes --package=node@22.22.0 -- node verify-browser.mjs
CHECK_LOG_PREFIX=workspace-loader-node22 npm exec --yes --package=node@22.22.0 -- node verify-node22.mjs
```

Hosted CI, other browser engines/mobile, full React StoreProvider/StrictMode UI, real PostgREST pagination/TPA/JWT/RLS integration, genuine quota/OS crash and production-origin/CSP remain unverified. Backend SQL was unchanged and not rerun here.

## Next gates

Durable tenant-scoped optimistic cache+enqueue updates, preserving existing role/branch/licence rules; human conflict-resolution UI and guarded UI commits; reviewed lossless legacy PHI/outbox migration and authorized blocked-pending recovery. Only then live Master login/router/store/dynamic clinical callsites. Anonymous booking fold, real deployment/TPA/JWKS/rotation, scheduled sync/revocation, external backup/restore and coordinated cutover remain separate gates.

Later inert increment: [atomic optimistic patient/basic-booking commands](WORKSPACE-WRITES.md),982/982 Node tests. Native browser evidence above remains specific to this loader milestone.
