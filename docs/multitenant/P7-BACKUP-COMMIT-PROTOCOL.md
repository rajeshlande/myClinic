# P7 backup storage commit protocol — local adapter contract

## Implementation status

`scripts/lib/v2-backup-commit.mjs` implements an adapter-driven commit protocol and bounded chain retrieval. Tests use an in-memory fault-injection store and now a Linux local-filesystem adapter (`P7-LOCAL-DISK-STORE.md`) with persistence/reopen checks. No external/cloud adapter, live bucket, credential, SQL, schedule or activation is supplied. Local filesystem support is not offsite or power-loss proof. Continue only on v2/account-trust-validation.

## Storage adapter requirements (not optional)

- `putObjectIfAbsent(path, Buffer)`: durable, immutable conditional creation. Existing content must never be overwritten. Return only after provider durability boundary. Object path is project/schema-scoped SHA256 ciphertext digest.
- `getObject(path)`: authenticated, strongly consistent read returning Buffer or null; reject oversized responses while streaming in the eventual adapter. Protocol rechecks bytes/hash and never treats an upload response alone as proof.
- `readHead(scope)`: authenticated, strongly consistent committed checkpoint or null. Exact fields: project, schema, revision, digest, watermark, batchId, createdAt. Metadata contains no row data but is sensitive operational context.
- `compareAndSwapHead(scope, expected, next)`: atomic linearizable durable compare-and-swap over the ENTIRE checkpoint, returning true or false. No read-then-unconditional-write emulation. Actual cloud implementation must use generation/ETag/version conditions with equivalent semantics and an authenticated monotonic checkpoint; stale/rolled-back inventory must not silently be accepted.

A provider exposing only plain put/get is insufficient. Do not implement pseudo-CAS with object listing, an ordinary lock file, eventual list consistency or a Free job schedule. Store credentials must not be browser/VITE variables. Provider network and SDK error messages are sanitized by the protocol; eventual adapter must also prevent header/body/PHI logs.

## Commit sequence

1. Caller supplies a consistent encrypted batch, matching encryption key and previously authenticated checkpoint (null only for first baseline). Source adapter supplies globally unique batch identities, complete commit-ordered transaction windows and consistent snapshot; protocol does not manufacture those facts.
2. Verify ciphertext hash/GCM/format and project/schema. Increment must link to expected digest, start at expected watermark, advance and not regress timestamp/reuse immediate predecessor ID.
3. Read current checkpoint. If exact target checkpoint is already committed, verify its object still exists/intact and report ALREADY_COMMITTED. If checkpoint differs from expected, report CONFLICT without upload. Never overwrite another writer's checkpoint.
4. Conditionally create immutable object; read back and compare exact bytes/hash. Failure leaves checkpoint unchanged. A crash can leave an unreferenced encrypted object; no automated garbage collection is implemented.
5. CAS from expected to next revision. Re-read checkpoint. Report COMMITTED or ALREADY_COMMITTED only when exact target state is observed. A conflicting writer yields CONFLICT. An exception/ambiguous ACK is BACKUP_COMMIT_FAILED, not a success; retry exact saved ciphertext and original expected checkpoint to resolve.

The checkpoint is the sole committed backup cursor in this protocol. No independent source ACK/watermark write is performed. A future exporter must resume from this committed cursor and preserve journal history needed after crashes. If external ACK is required, its retry/outbox semantics need separate design. Do not advance journal retention because upload alone succeeded.

Never re-encrypt the same logical batch on retry: fresh nonce produces a different digest. Persist/recover the encrypted candidate via a reviewed staging design, or restart from committed checkpoint under a defined new candidate identity. The local protocol holds the candidate in caller memory only. Real crash recovery across process restart remains adapter/exporter work.

## Chain retrieval

`loadCommittedChain({store,project,schema,keys,expectedHead,maxBatches,maxBytes})` follows authenticated predecessor links from a trusted checkpoint. It does not list objects or trust latest filename. Checks key/project/schema/digest and checkpoint identity, rejects missing/corrupt objects, defaults to128 batches and32 MiB aggregate ciphertext, hard caps configured limits at10000 batches/256 MiB. Returns encrypted batches baseline-first. Then run `restoreChain` for full contiguous ordering/identity/replay validation; retrieval alone is NOT a completed restore. Limits are checked after adapter returns Buffer; provider must bound streaming downloads to prevent allocation abuse.

This supports chain retrieval while source DB is unavailable if keys and external checkpoint/store remain available. It does not prove actual offsite availability or key recovery.

## Local fault evidence

`tests/v2-backup-commit.test.mjs` exercises upload failure, corrupt readback, crash after upload/before CAS, lost ACK after CAS, duplicate retries, concurrent baselines/increments, identical-writer convergence, stale cursors, wrong project/schema/key, malformed metadata, false provider ACK, missing chain object/key and resource limits. Memory fixture is intentionally test-only and non-durable. Existing core tests cover encryption/ordered replay/tombstones/retention.

## Remaining production gates

Select provider and prove its durability/CAS semantics; trusted monotonic inventory/anti-rollback and recoverable keys; streaming limits/timeouts; durable staging; globally unique batch identities; transactionally consistent DB baseline/journal and mappings; full-chain validation/checkpoints; retention/legal hold and orphan cleanup; schedule/alerts; isolated DB/schema/FK/tenant restore drill; owner authorisation. No daily changed-row export,30-day production retention,~24h RPO or restore SLA is claimed.
