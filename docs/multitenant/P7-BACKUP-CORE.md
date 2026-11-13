# P7 offline backup/restore core — bounded prototype

## Delivered vs pending

`scripts/lib/v2-backup-core.mjs` implements an operator-only in-memory format and replay validator. `node scripts/v2-backup-drill.mjs` executes a synthetic baseline + incremental restore and negative checks without files, real records, credentials or network. The normal npm test suite covers encryption, replay and retention faults. This is not a database exporter, durable object-store client or production-ready backup system.

All development stays on `v2/account-trust-validation`; no new branch is needed.

## API / assumptions

- `sealBatch({manifest,key,payload})` returns encrypted `object` Buffer and SHA256 `digest`. A32-byte Buffer key is required. Fresh12-byte random nonce, AES-256-GCM128-bit authentication tag, gzip-before-encryption. Manifest is public authenticated additional data: identifiers must never contain PHI. Row data is encrypted. No key is returned, printed or persisted by the core.
- `openBatch({object,digest,key})` checks bounded size/hash, strict envelope/metadata and GCM before decompressing; validates payload and returns plaintext only to the trusted caller. Errors are sanitized. Caller must avoid logging/retaining plaintext.
- `restoreChain({batches,keys,project,schema,targetDigest})` returns fully reconstructed in-memory tables only after the entire selected chain passes. Keys are a Map keyed by reviewed key ID. Key rotation supported per batch. Project/schema pins, baseline-first, predecessor digest, monotonic timestamp and batch identity, contiguous transaction sequence, known table set and row identity are checked. Upserts and tombstones applied in transaction order. Failed replay returns no partial result or external writes. Duplicate objects rejected; re-running the identical complete chain produces equivalent state.
- Baseline payload `{tables:{table:[{id:...}]}}` includes all tables (including empty ones). This prototype uses a single string `id` per row. Actual table inventory, composite keys, schemaDDL, values such as binary/large integers, row mappings and FK validation require a reviewed adapter. Do not pass raw driver values with lossy JSON coercion.
- Increment payload `{transactions:[{sequence,changes:[{op:'upsert',table,id,row}|{op:'delete',table,id}]}]}` contains full committed transactions. Each sequence must increment by exactly1 from low+1 through high. Timestamps are not change cursors. The adapter MUST supply a complete consistent baseline and durable commit-ordered journal. Merely allocating SQL sequence IDs does not guarantee commit order; rollback gaps and concurrent transactions must be handled upstream. No source adapter exists yet.
- Manifest fields: format=1, batchId, project, schema, keyId, kind, previous, low, high, createdAt. Baseline low=high at snapshot boundary, previous=null. Increment previous is predecessor object digest. JSON date is UTC; batch IDs must be unique. Changed timestamps may be identical; ordering depends on transaction sequence, not timestamps.
- `targetDigest` must come from a trusted committed inventory/checkpoint. Encryption authenticates contents but cannot alone detect omission of a latest batch, restoration to an old valid chain or loss of an entire chain. Metadata/hash checks are not a substitute for authenticated durable inventory.
- `planRetention({chains,now,days:30})` returns keep/candidate digests only. Each chain inventory includes complete dependencies and a restorePoint numeric epoch. A recent recovery point retains even an older required baseline. Empty/stale-only/future/malformed inventory fails closed. It does NOT authenticate inventory, discover missing objects or delete anything. Never use candidates automatically for deletion; validate chains/legal retention/object locks first.

## Resource/security boundaries

Per batch decoded JSON capped4 MiB, envelope capped8 MiB; decompression output is capped. This is a small-pilot prototype, not a streaming large-clinic backup path. Complete restore is in memory with no aggregate chain-size limit; trusted caller must bound chain count/total data. No arbitrary JSON or real PHI upload/CLI parser is exposed. Caller holds encryption keys and is responsible for approved storage, restricted scopes, rotation, custody/recovery, memory/disk handling and nonce/key lifetime policy. Core output reveals schema/project metadata and ciphertext size.

The separate adapter-driven `v2-backup-commit.mjs` now implements upload/readback/CAS cursor semantics and bounded chain retrieval with memory/fault tests (see P7-BACKUP-COMMIT-PROTOCOL.md). No live/durable storage adapter, SQL, HTTP, scheduler, source journal/ACK, FK verification, schema installation, credential reconciliation or alert integration is implemented. No real restore/RPO/capacity proof is claimed. AES-GCM provided by Node crypto is used rather than a custom cipher; the format/integration still needs security review before production.

## Run locally

```sh
node scripts/v2-backup-drill.mjs
node --test tests/v2-backup-core.test.mjs
```

Use declared Node22.22+ and npm10.9+. The drill generates an ephemeral random key, restores only fixture rows in memory, checks missing baseline/tail, duplicate object and corruption refusal, prints aggregate synthetic counts, and exits. It intentionally cannot accept real input/credentials or write clinical rows.

## Next acceptance gates

Follow `P7-BACKUP-RESTORE-CONTRACT.md`: consistent baseline/journal design, inventory/mappings, explicit SQL authority, encryption custody, external provider, least-privilege exporter, durable manifest/watermark protocol with crash faults, chain-safe retention, alerting and isolated restore drill. Keep tenant access OFF until all release/trust gates pass.
