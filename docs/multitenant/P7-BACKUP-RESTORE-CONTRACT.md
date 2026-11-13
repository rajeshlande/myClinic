# P7 external incremental backup and restore contract — NOT IMPLEMENTED

## Acceptance target

Daily compressed, encrypted changed-row exports to an approved external object store. Planned retention30 days, targetRPO approximately24h; no Free-tier scheduling/backup/SLA guarantee. A release requires an executed isolated restore drill and integrity/isolation evidence, not merely an uploaded file. Do not upload PHI to ordinary GitHub test artifacts or logs.

## Blocked decisions / authority

Before implementation choose object provider/bucket/region, encryption key custody and recovery, access/retention policy, credential scopes, authorised operator identity, alert channel and schema/table inventory. Obtain explicit live SQL/backend/config/job authority. Never request those credentials in chat. No bucket/credential/workflow configured in this increment.

## Export design requirements

1. Define a transactionally consistent snapshot boundary and schema/version manifest for each batch. Simple updated_at > last_run across independent HTTP pages is insufficient: concurrent updates, equal timestamps, deletes and multi-table references can lose data.
2. Establish an initial recoverable baseline, then durable changes with monotonic ordering/commit boundary and deletion tombstones. Changes-only files without a baseline cannot restore. Do not introduce daily full pg_dump as an egress-expensive shortcut.
3. Capture tables lacking reliable modification timestamps and deletes. Choose a reviewed server-side change journal/CDC/export design; migrations and privilege/audit implications require separate approval. No such journal is implemented here.
4. Stage/reconcile a batch with immutable ID, source project identity, predecessor watermark, low/high boundaries, schema revision, per-table counts, ciphertext size/hash and encryption algorithm/key identifier (never the key). Ensure deterministic retries and safe overlap/deduplication.
5. Compress then encrypt before leaving the trusted exporter. Use authenticated encryption with a vetted tool/service, correct nonce/key practices and recoverable key management. Object-store encryption alone is not evidence of exporter confidentiality.
6. Upload data, verify object integrity, then atomically acknowledge the committed manifest/watermark. Crash between any steps must neither skip changes nor misreport completion. Restrict object keys and output; never log row contents.
7. Apply30-day retention only to restore-safe chains. A retained incremental chain depending on an expired baseline is not recoverable. Define periodic approved checkpoints, independent key retention and garbage collection after chain validation.
8. Monitor scheduled vs actual completion age, object/manifest integrity, encryption/key access, lag/egress, retries and failures. A missed job must alert rather than silently leave a stale success badge. Keep recovery usable when the source Free project is paused.

## Restore drill — isolated destination only

- Verify manifest authenticity/integrity and decrypt with approved recovered key; fail closed on corruption/missing dependency/schema mismatch.
- Restore schema and baseline in safe order, replay changes/tombstones to an explicitly chosen boundary, preserve UUIDs/references and sync sequence state. Never restore over original patient data for a drill.
- Check per-table expected counts/content hashes or equivalent integrity evidence, foreign-key validity, patient/appointment/invoice relationships and authoritative audit/sync watermarks.
- Reconcile memberships/keys/licences with current authority before enabling any restored tenant. A restored historical membership must not resurrect revoked access.
- Keep flags OFF; run synthetic allow/deny tenant/role/branch checks, inspect leaked-credential exposure and validate app compatibility.
- Record start/end, chosen boundary, source failure time, achievedRPO and recovery duration. Record redacted evidence, reviewer approval, cleanup and follow-up defects.

## Required fault tests before marking backup complete

Equal timestamps; update during pagination; delete before/after boundary; multi-table commit; crash before/after upload/manifest/ACK; duplicate retry; corrupted/truncated ciphertext; missing baseline/increment/key; lost watermark; out-of-order sequence; revoked/rotated key; object-store denial; expired retention dependency; source540/network outage. Local fixture tests precede separate live isolated drills.

**Current result: design/checklist only. No exporter, schedule, uploaded backup or executed restore exists from this work.**
