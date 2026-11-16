# Consistent source export preparation and PostgreSQL proof

## Delivered locally / not a clinical exporter deployment

`scripts/lib/v2-source-export.mjs` validates an explicitly pinned tenant source window, maps single/composite/non-string source keys into lossless wrapper rows, and seals baseline or contiguous changed-transaction payloads with the existing encrypted backup core. No live DB URL, credentials, raw whole-project loader or fallback exists. `readWindow` is mandatory and must be a reviewed consistent-snapshot/journal adapter.

`tools/source-export-proof` provides a SYNTHETIC-ONLY PostgreSQL schema/concurrency runner and encrypted replay verifier. It is deliberately NOT under clinical SQL migrations and MUST NOT be pasted into clinical/Master/original21. PostgreSQL proof uses a private Unix socket in scratch .arena, isolated synthetic tables and no TCP connection. Server stopped after proof. Work stays on v2/account-trust-validation.

## Source/window contract

Configure exact source `{project,clinicId,schema,streamId}` and explicit table inventory `{name,keyColumns,scopeColumn}`. Unknown/missing tables, mismatched project/clinic/schema/stream, incomplete snapshot, wrong scope, journal gaps, unsafe JSON values and resource overrun refuse the whole export. No silent truncation/filtering or falling back to anon/legacy/full-project reads. Every baseline/upsert row and delete key must carry the expected clinic scope column. Actual clinical tables with only indirect scope need an approved adapter that resolves ownership in the SAME source snapshot; not a client-side guess.

Reader receives only pins/mode/low/limits, never encryption key. It returns exact source pins, safe snapshotId, complete=true, high, retainedFrom and either tables or transactions. Baseline high is the single snapshot's committed boundary. Increment is ordered complete source transactions from low+1 through high, including all row operations for that clinic's transaction. Reader may select a bounded prefix of complete transactions; high must be the last selected boundary, not the source's later head. Empty window may report NO_CHANGES only when the observed committed clinic head equals low. The encoder cannot prove reader provenance or detect a reader lying about completeness; trusted DB adapter is a required security/consistency boundary.

Each transaction must have at least one operation. Cursor/transaction sequence is not updated_at. Journals pruned beyond required low fail closed via retainedFrom. Stream ID is a pinned source epoch; source reset/recreation MUST change it and force reviewed new baseline/destination mapping, never silently reuse old cursors. Epoch pin currently lives in trusted source registry configuration, not encrypted manifest/job schema: durable authenticated epoch/inventory binding is a production gate before source reset handling can be called complete.

Defaults:5000 rows total baseline,1000 transactions,10000 changed operations; max configurable100000 per limit. Core4 MiB decoded batch bound still applies. Reader must limit memory/query work before returning; encoder checks after receipt are not a streaming/export quota. Oversized single transaction cannot be split arbitrarily; refuse and use a reviewed scalable format/streaming strategy. No nightly full-dump shortcut.

## Key encoding and tenant boundaries

Every backed-up row becomes `{id:<sha256>,key:<original PK fields>,data:<original JSON row>}`. Hash input includes purpose, table, clinic and sorted key-column/value pairs. Composite/boolean/numeric/string keys are represented without rewriting original data.id. Delete uses same identity from PK+clinic scope; PK changes require delete-old plus upsert-new in the same source transaction. Original values live under data for later reviewed restore mapping; this is NOT direct SQL INSERT output. Actual schema/foreign-key/type validation and restore-to-database adapter remain pending. Unsafe/unrepresentable JSON numerics are refused, not rounded. Large integers/decimals/binary need explicit reversible DB mapping before use.

Per-clinic owner export must exclude other tenants and central credentials/authority material. Never dump auth.users, signing keys, all memberships or whole clinical project to one owner's Drive. Actual clinical table inventory/derived scope/subset retention/PHI authorisation must be reviewed against current schema22/addenda. Source project/schema registry must come from trusted boot/authority, not browser-supplied body fields.

## Integration with durable worker

Preparer returns `{status:'READY',entry,watermark}` with ciphertext only, or `{status:'NO_CHANGES',watermark}` without archive. Trusted prepareBatch wrapper can feed READY.entry into the existing worker, using work.expectedDigest/expectedHigh and job source pins plus registry stream/inventory. Do not pass wrapper result itself as an encrypted entry. No production prepareBatch/readWindow adapter is configured here.

NO_CHANGES is deliberately explicit: it does not advance archive verification time or invent a new completed upload. Existing durable job schema/UI does not yet have a no-change terminal policy; job admission/worker needs reviewed handling before daily unchanged-clinic jobs can be enabled. Do not treat it as an empty increment, discard a job or falsely stamp lastBackupAt. Monitor successful source checks and sourceRPO separately.

## PostgreSQL commit-order proof

Fixture uses one private global row lock held to source COMMIT/ROLLBACK before allocating transactional per-clinic sequence/capturing row events. All tracked writes, journal events and clinic head commit atomically. Rolled-back transactions leave neither changes nor cursor holes. A concurrent second writer cannot publish a higher sequence first. PostgreSQL nextval by itself would not guarantee commit order; not used.

This global lock is intentionally a simple proof mechanism, NOT a recommended production migration: serializes writers, increases deadlock/latency risk and stores plaintext PHI copies if misused on real data. Commit-order approach, lock ordering, workload/capacity/egress, journal retention and failure isolation need review/benchmark on Free limits. Production may choose a better journal/CDC design; no trigger attached to live tables.

Fixture baseline uses one REPEATABLE READ READ ONLY session/snapshot for head and all table reads while another transaction commits. Increment reader reads journal in a matching source snapshot and filters per-clinic stream. Composite key updates emit old-key deletion and new-row upsert; multi-table changes stay in one transaction; TRUNCATE and clinic-row moves are rejected rather than silently unjournaled. DDL/drop/trigger bypass/owner/replica changes are NOT covered and must be blocked/audited in any real design.

### Executed proof

PostgreSQL17.12 local fixture:10 checks passed (snapshot during commit, rollback contiguous sequence/data absence, concurrent lock ordering, multi-table transaction, composite key tombstone, tenant filter, TRUNCATE and scope-move refusal). Node22 encrypted baseline at1 plus5 committed transactions replayed to6; restored in-memory rows match final PostgreSQL clinic source exactly:patients2,appointments1,staff_branches1. No other-clinic sentinel leaked. This is not an actual clinical export or restore into PostgreSQL.

### Reproduce (optional, synthetic only)

Requires local PostgreSQL17 binaries and Python psycopg2; these are test dependencies, NOT app runtime dependencies. Use a fresh .arena/p7-source-pg scratch cluster, user source_fixture, private0700 socket directory, port55437 and listen_addresses='' (Unix socket only). Start via controlled process tool, not pg_ctl background shell. Run:

```sh
/usr/bin/python3 tools/source-export-proof/verify-postgres.py "$PWD/.arena/p7-source-pg/socket" "$PWD/.arena/p7-source-windows.json"
node tools/source-export-proof/verify-encrypted-replay.mjs .arena/p7-source-windows.json
```

Python requires the exact private scratch socket path and fresh fixture schema; never resets/reuses clinical data. Stop scratch server afterward. Do not run SQL proof file against any hosted database. Normal npm tests require no PostgreSQL and cover22 encoder contract/security cases. Scratch data excluded from git and snapshots; only code/redacted evidence retained.

## Remaining P7/source gates

Production source read-only role and stable transaction snapshot transport; full clinical key/type/FK/derived-tenant inventory; authoritative epoch/inventory binding; approved performant journal installation under separate manual SQL authority; no-change job policy; source retention/pruning coordinated with externally verified chains; production membership/session/job storage, scheduling/retries/alerts; live Google synthetic acceptance and isolated real restore/RPO. No live account, DB SQL, keys, Google upload or flags changed.
