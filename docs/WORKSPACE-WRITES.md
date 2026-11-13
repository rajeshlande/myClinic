# Staged atomic optimistic commands

## Status

`src/lib/workspace-writes.mjs` adds an inert `commitWorkspaceCommand({lease,persistence,command,now,randomId})` API. No live imports, StoreProvider wiring, network flush, migration, activation, SQL, deployment, commit or release. Both flags remain OFF; app1.43/schema21 remains the live path.

## Deliberately narrow command surface

Commands carry `{type,table,id?,values?}`. Only patients and basic booked, non-token appointments are supported. create generates row and operation UUIDs; update requires an existing scoped row; delete enforces existing role capabilities. Unsupported tables and unknown/identity/scope fields fail closed.

Patient commands reuse existing validation and role capabilities; archive/unarchive requires patient:archive. Generic patient deletion refuses cached appointment/consultation/invoice/reminder references rather than optimistically cascading clinical history. Appointment commands require an allowed explicit branch, an active scoped patient and an active assigned doctor. Doctors may book only themselves; owners/front desk can select a permitted doctor. Existing token-bearing or non-booked appointments require specialized commands. No status transitions, token issuance, billing, consultations, staff/settings/profile or plan writes. Appointment rescheduling checks known local slot collisions; the database remains authoritative for global constraints and races.

No claim is made that this implements every screen's scheduling/domain workflow or server schema validation. Missing specialised paths are refused, not silently treated as generic CRUD. Patient code generation is still the caller's responsibility; uniqueness remains server-authoritative.

## Authorization and durable boundary

The caller supplies a current operation lease and a lifecycle-opened persistence handle. The exact namespace is checked. The cached active own staff row must uniquely match subject/memberRole/currentStaff. The operation lease now exposes the selected Master licence verdict; clinical writes require its positive verdict and an explicit unexpired expires_at, plus a scoped, known, positive clinical subscription and the existing time-aware licenseState/canWrite rule. Unknown, lapsed or denied verdicts cannot grant writes. These local checks are defence in depth, not a replacement for fresh tokens, server licence checks, RLS or replay guards. Same-origin storage is neither encrypted nor an authorization boundary against hostile code.

Commands are cloned before awaiting storage. Existing conflicts block writes; an existing pending queue may be appended to. Cache edits and the complete FIFO source operation are committed together at the original revision, using persistence's single IndexedDB transaction. Original update bases are retained, with the local _offline display marker stripped. No coalescing or blind retry changes older operation bases. Existing queue/conflicts are not discarded. Revision movement returns WRITE_ACK_CONFLICT, leaving the concurrent winner intact.

No local UI state is published before durable acknowledgement. Success returns only `{status:'QUEUED',opId,rowId}`, not a remote-saved result. This API does not yet publish a React snapshot: guarded UI commits remain a separate integration gate. Lease checks before/after durable storage refuse stale caller success. A change durably committed immediately before invalidation may remain queued in the old namespace even when the caller receives a stale error; do not blindly retry as if nothing was stored. Existing lifecycle retirement and future reconciliation own that case.

The writer does not open/close handles or acquire an independent replay lock. Use a lifecycle handle; CAS prevents overwriting simultaneous replay/load/append state. It intentionally leaves cache optimistic, so the loader still refuses to replace it while queue/conflicts exist. Replay later invalidates cache; reviewed reloading/reconciliation and human conflict resolution remain necessary.

## Verification

Node22.22.0: **39/39 new writer tests**, full clinic **982/982 PASS**. Contributing, security, build and Pages checks exit0. Tests include a real persistence adapter backed by fake-indexeddb (not a native browser), durable cache/outbox pairing, FIFO/base preservation, role/branch/reference/licence refusals, forbidden command fields, collision refusal, CAS/storage failure, caller mutation and pre/post-commit invalidation.

Evidence: `tests/workspace-writes.test.mjs`; `/home/user/workspace-writes-unit.log`; `/home/user/workspace-writes-node22-{summary,tests,contributing,security,build,pages}.log`.

### Subsequent native-browser verification

Chromium145.0.7632.6 / Playwright1.58.2 / Node22.22.0: **31/31 PASS**, zero non-harness requests. The existing26 loader/replay/lifecycle/recovery checks were rerun alongside five new writer scenarios:

- Native IndexedDB cache + source operation pairing survives page reload, with QUEUED status and no replay/network write.
- Two native tabs pause after reading the same revision: exactly one optimistic command wins; the other returns WRITE_ACK_CONFLICT. An explicit second invocation with a newly reviewed command preserves the first queue entry and appends safely. This is not automatic retry.
- Controller disposal during a paused read prevents enqueue/cache mutation.
- Injected adapter commit refusal and expired Master licence preserve the previously durable revision/cache/outbox. The storage refusal is an injection, NOT a genuine disk-full/quota experiment.
- Repeated edits retain FIFO source operations and original update bases, with _offline stripped from replay bases.

Harness changes only: added allowlisted writer/validation/licence/date/permission modules, future-dated synthetic Master verdict, synthetic command seed and pause/refusal helpers. Production CSP, tier contract and live entrypoints unchanged. The synthetic server is stopped.

Evidence: `/home/user/workspace-browser-preparation/writer-browser-results.json`; `/home/user/workspace-writer-browser-tests.log`. Full Node982/982, contributing/security/build/Pages rerun passed in `/home/user/workspace-writer-browser-node22-*.log`.

Reproduce with harness dependencies and Chromium prerequisites installed: start `node server.mjs` in workspace-browser-preparation, then `RESULT_FILE=writer-browser-results.json npm exec --yes --package=node@22.22.0 -- node verify-browser.mjs`; stop the server afterwards. Tests use only synthetic fixtures, native same-origin IndexedDB/Web Locks and local modules.

Full UI/StrictMode, other browsers/mobile, native appointment workflows, actual quota/OS-crash, real clinical/Master Auth/token/RLS, hosted CI and deployment remain unverified. No real clinical/Master request or database operation was performed.

## Next increment

A reviewed UI snapshot/command facade and specialized domain commands. Native writer evidence now covers the boundary above, not a live React integration. Human conflict resolution, lossless reviewed legacy PHI/outbox migration, authorized blocked-pending recovery and real trust/deployment verification still precede live cutover.

Later staged composition: [UI command/snapshot facade](WORKSPACE-STORE.md),1000/1000 Node tests and34/34 native Chromium scenarios. No live React integration.

Later specialized extension: [guarded token attendance](WORKSPACE-ATTENDANCE.md),1051/1051 Node tests and42/42 Chromium scenarios. Generic status/token patches and token issuance remain refused.
