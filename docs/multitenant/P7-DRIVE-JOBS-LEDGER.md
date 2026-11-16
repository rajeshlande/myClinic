# Durable local Drive backup jobs and export ledger

## Delivered / scope

`scripts/lib/v2-drive-local-jobs.mjs` extends the existing Linux SQLite repository with durable queued jobs, exclusive expiring leases, staged encrypted candidates and per-destination committed export heads. `scripts/lib/v2-drive-job-worker.mjs` orchestrates one job using mandatory folder, source-preparation and encrypted-archive adapters. No scheduler, database exporter, production authority or real Google configuration is supplied. All work stays on v2/account-trust-validation.

Local root/Node SQLite/fixture-owner limitations from P7-DRIVE-LOCAL-REPOSITORY.md still apply. Additive local tables only; no Supabase migration or live SQL.

## Admission and state machine

QUEUED -> RUNNING -> STAGED -> COMPLETED, or active state -> CANCELLED when consent/disconnect invalidates connection. Owner revocation fences all work immediately; a later claim cancels it. Cancelled staged ciphertext is retained for reviewed recovery, never auto-uploaded or discarded. No cancellation means Google file deletion.

jobs.enqueue requires active requesting fixture-owner, enabled owner-bound connection and matching locally verified folder. Source project/schema are mandatory pins from trusted backend registry (not browser input); real registry mapping remains pending. One active job per clinic via SQLite partial unique index; repeated QUEUED request returns same job. If already RUNNING/STAGED, enqueue returns actual state, not a fake QUEUED. Local HTTP/client integration now accepts actual QUEUED/RUNNING/STAGED in202 and recovers latest/completed/cancelled jobs through owner-scoped reads and atomic overview; see P7-DRIVE-JOB-PROGRESS.md. No production API wiring/activation is made here.

Initial destination has no committed head and must stage a baseline. Further jobs pin prior digest/watermark and must stage a contiguous increment for exact source schema/project. Reconnect creates a new folder binding, so it needs its own baseline and cannot assume previous account's chain is accessible. Source schema changes are blocked instead of silently mixing incompatible exports.

## Leases and candidate persistence

jobs.claim atomically grants a random lease token to one worker, up to5min. Live lease cannot be stolen; expiry allows a new lease/recovery attempt. Old tokens cannot read/stage/complete after expiry or takeover. Internal readWork returns encrypted bytes, destination pins and lease only to trusted backend, never through owner API. It rechecks requesting owner and connected owner membership, connection revision and folder binding.

stage authenticates encrypted envelope using a supplied backend backup key (not vault key), validates pinned source/chain and stores exact ciphertext + digest + pre-reserved Drive file ID in one transaction BEFORE upload. No raw patient data or encryption key is persisted by this ledger. Retry cannot replace candidate with different nonce/re-encrypted bytes or remote file ID. Batch ID uniqueness enforced within clinic+binding. Candidate survives close/reopen; reclaimed STAGED job uses it without re-running source export or reserving another ID.

No lease-renewal heartbeat implemented; single-job worker requests5min. Slow source/network work may finish after expiry and be refused even if upload succeeded. Safe recovery uses lease reclaim + saved candidate/file ID, not forced completion. A former worker may already be in a Google request after expiry/disconnect; ledger fencing cannot recall bytes already sent. Current archive adapter verifies duplicate409 metadata/ciphertext.

## Completion and committed source boundary

complete requires current unexpired lease, active authorities, exact destination and stored STAGED candidate. Trusted encrypted archive adapter must supply matching verified=true, digest, remote file ID and ciphertext length. Browser cannot invoke completion or supply arbitrary receipts through the HTTP handler. An adapter flag alone is not independent cryptographic proof; actual uploader already downloads/hashes compared ciphertext, and live acceptance remains required.

Completion atomically CAS-checks expected head digest/high, advances per-folder source watermark/Drive ID and marks COMPLETED while clearing lease. Upload/initiation/queue cannot change last verified backup time. readOwnerStatus now reads the committed head time only for current folder binding; otherwise null. New account mapping resets visible current-destination evidence, preserving historical records locally.

If commit acknowledgement is lost, re-read trusted owner job status after reopen. COMPLETED means that fixed job's candidate was committed; replaying completion with an old lease is intentionally refused. Do not call it failed and discard files, or create a new baseline blindly. Owner status projects jobId/status/createdAt/finishedAt only, never candidate/lease/credentials. Local owner job-progress reads and atomic overview now drive explicit manual UI refresh/reload recovery (P7-DRIVE-JOB-PROGRESS.md). No polling/timers or live routes enabled; automatic refresh is intentionally absent.

## Connection changes

Disconnect/new consent transactionally cancels active jobs, clears leases and destination mapping. Same-account refresh rotation atomically advances folder AND active-job revisions with token revision; exact saved candidate remains. New consent never uses that fast path. Production must independently verify identity/connection intent before treating refresh as same account. Local fixture authority is never suitable for real job permission.

## Single-job worker

1. Claim5min lease.
2. Call ensureFolder (real deployment must use private-folder coordinator), re-read fenced work and compare full verified folder receipt.
3. If unstaged: call trusted prepareBatch, reserve remote file ID, authenticate/stage exact encrypted batch. If staged: do not prepare/reserve again.
4. Recheck lease/authority; upload staged ciphertext through pinned archive adapter.
5. Complete ledger only after verified receipt. Errors sanitized as DRIVE_JOB_WORKER_FAILED; no automatic retry/schedule/log of contents.

prepareBatch must produce a complete transactionally consistent source window; no such source adapter exists. No source ACK/journal pruning is performed. Committed ledger is intended sole backup cursor; any future source ACK needs separate crash-safe design. Failed uploads may leave remote orphan/corrupt files requiring reviewed recovery. Do not automatically delete candidate/local chain or raw queued clinical work.

## Local verification

22 new Linux tests: durable dedup/queue, owner/folder admission, two-handle leasing, exact candidate/ID reopen/reclaim, expired-worker fencing, different-candidate refusal, receipt mismatch/no timestamp advance, committed status reopen/lost ACK, baseline/increment boundary, wrong source/schema, disconnect/reconnect/revocation, refresh revision migration, no plaintext patient marker in SQLite files, batch uniqueness and sanitized owner status. Worker integration uses real SQLite jobs, synthetic encrypted batches and mocked archive/source/folder adapters; tests completion order, lost-upload-ACK recovery without reprepare/re-reserve, destination mismatch before source access and disconnect during upload.

Run `node --test tests/v2-drive-local-jobs.test.mjs` under supported Linux Node.

## Remaining production gates

Authoritative production repository/schema/session/membership; real job status/admission API and owner UI lifecycle; durable external recovery of ledger/key inventory; consistent source journal/exporter+table mappings; actual Google identity/folder/upload acceptance; scheduler/limits/retries/alerts; retention chain management; encrypted rotation recovery; isolated real DB restore/RPO. SQLite job/candidate storage has per-batch limit but no aggregate quota or retention deletion; cancelled/completed candidates accumulate until a reviewed policy exists. Not ready for real PHI or unattended Free-tier operations merely from these tests.
