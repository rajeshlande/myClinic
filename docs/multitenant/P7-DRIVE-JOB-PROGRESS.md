# Owner backup job progress — local API/UI integration

## Delivered

Staged owner Drive card/controller now displays QUEUED, RUNNING, STAGED, COMPLETED and CANCELLED from the durable local ledger. Manual Refresh recovers latest job after controller/page recreation; active job disables duplicate local requests, terminal state clears pending request and permits a new admission. No automatic polling, timer, worker scheduling, live owner feature activation or Google call.

Work remains on v2/account-trust-validation. Existing app/router still does not mount the staged v2 owner card. Backend dependencies are still local/synthetic, not a production session/authority system.

## API additions (not deployed)

All new routes use existing session, fresh active owner, rate-admission, exact HTTPS host and no-store projection gates. GET only, no arbitrary query/identity overrides or CORS grants:

- GET /v2/clinics/:id/drive-backup/overview: atomic `{connected,lastBackupAt,job}`.
- GET .../jobs/latest: `{job:null}` or latest current destination's safe job summary.
- GET .../jobs/:jobId: `{job:{jobId,status,createdAt,finishedAt}}`; current clinic owner may inspect known historical clinic job, never another clinic's job.
- POST .../backup now accepts actual durable active state in202: QUEUED/RUNNING/STAGED. Repeated admission returns same job with truthful current state, not a queued relabel or another export. No claim that202 is completed.

Handler readOverview/readLatestJob/readJobStatus are explicit injected backend adapters. Missing adapter fails503, not fake empty/healthy response. Invalid/unknown statuses, bad IDs/timestamps or COMPLETED without finishedAt fail closed. Completion time cannot predate creation. Raw lease token/candidate/provider/token fields projected away. No download or job-completion/worker API exposed.

## Atomic overview and repository

Local repository readOwnerOverview runs owner connection/decryptability, current destination's committed backup time and latest job projection inside one SQLite transaction. This avoids combining a prior Google account's backup timestamp with a new account's job across separate requests. Browser service uses this endpoint preferentially. Production repository must implement equivalent authoritative atomic snapshot, not combine independent stale caches.

Latest filters to enabled authorised connection/current folder binding and orders by createdAt then SQLite rowid for ties. No destination mapping -> latest null, not previous owner's/account's job. Known historical job endpoint remains clinic-owner-scoped for recovery. Context changes/logout/revocation are checked server-side and browser controller rejects late responses before state/navigation; the optional sequential compatibility path stops before a second request when scope changed.

## UI semantics

- Queued: waiting for worker; no new completed backup.
- Running: worker preparation in progress; no new completed backup.
- Staged: encrypted candidate saved; upload verification/ledger completion pending (not a progress percentage).
- Completed: server committed a verified upload receipt; NOT a database restore drill or sourceRPO proof.
- Cancelled: request did not commit a new backup; existing/orphan Drive files are not deleted by status display.

Last verified backup time always comes from atomic server summary, never inferred from enqueue, finishedAt or Google connection. A new job may be pending while an older verified backup time is shown. Manual refresh is explicit; no background polling/auto retries. No job/cookie/token state persisted in localStorage/offline queue. Recreating controller starts empty until owner refreshes; a real host can invoke refresh at reviewed mount lifecycle, but this preview doesn't auto-connect/authenticate.

Duplicate suppression is UX only; backend unique active-job constraint/admission remains authority. Cancelled/completed permits new request. Disconnect immediately clears local pending display only after backend success; actual job fencing remains repository responsibility. Timer-based progress/percentage estimates are not shown. Unknown/error response does not fabricate terminal success or erase existing evidence.

## Verification

18 new tests cover job/overview projections, missing adapters, method/host/query/session/owner gates, truthful202 running/staged admission, invalid completion payload refusal, same-origin GET client, late context and sequential-fallback fencing. Real local SQLite -> Request handler -> service -> controller integration follows queued/running/staged/completed state, controller recreation recovery, cancelled state, new admission, cross-clinic/revoked access, new-account destination reset and same-timestamp latest ordering. No real Google or HTTP socket/browser interaction; owner React card is separately compiled.

## Remaining

Production session/CSRF/rate-limit/authority and repository adapters; mounted live v2 Settings; consistent source DB exporter/journal and registry; reviewed scheduler/worker admission/leases; actual Google identity/folder/upload acceptance; real isolated restore/RPO/retention/alerts; hosted browser allow/deny tests. These changes provide local progress integration, not a running backup service.
