# P7 Linux local-disk backup adapter

## Status and supported use

`scripts/lib/v2-backup-local-store.mjs` is an operator-only filesystem adapter for the existing encrypted commit protocol. Supports Linux only, with a trusted private local filesystem offering reliable fsync, atomic same-filesystem rename, hard links and atomic mkdir. Other platforms fail closed; do not assume Windows/network filesystems/FUSE/object mounts have equivalent durability. This is NOT external/offsite storage, a source exporter or a production backup deployment.

`scripts/v2-backup-disk-drill.mjs` runs fixed synthetic baseline/increment/tombstone data in a temporary private directory, reopens the adapter, loads/replays the committed chain, checks retry and deletes the temporary directory. It accepts no real input/credentials. Ephemeral encryption key stays in memory. Tests additionally open the persisted checkpoint from a fresh Node process.

## Provisioning and APIs

`await createLocalBackupStore({root})` requires an existing absolute normalized private root directory (0700, current user). Root must not be / or symlinked; ancestors must be real directories. Caller chooses/protects root; no default production path is supplied. Generated subdirectories are0700 and files0600. Uses only Node builtins. Never put backup root under the repo, shared web root or uploaded CI artifacts. No secret/key file is created.

Adapter methods match P7-BACKUP-COMMIT-PROTOCOL.md. Paths restricted to `v2/<safe-project>/schema-<positive-version>/objects/<sha256>` and corresponding scope. It validates paths, private permissions, regular file type, owner, bounded reads and O_NOFOLLOW final opens. These checks are defense in depth, not a security sandbox: a malicious privileged/same-UID process can still replace directories/race pathname operations. Use a dedicated OS account/private disk, not untrusted shared writers.

- Immutable object: snapshot caller bytes; validate SHA256/size; create unique temporary file exclusively, write and fsync, atomically hard-link into digest path without overwrite, verify existing/new bytes, fsync directory, then remove temporary link and sync directory. Existing corrupt content is never overwritten. Errors are sanitized.
- Checkpoint CAS: validate/snapshot expected/next fields and revision; acquire scope-local lock by atomic mkdir; read committed head and compare every field; require referenced ciphertext exists/hash matches; write/fsync private temp; rename to head.json and fsync parent. Release lock and fsync parent. Core protocol handles encrypted validation before CAS; direct adapter CAS is not authentication of source/batch semantics.
- Read: no dependency on listings or temp files; missing object/checkpoint is null; malformed/oversized metadata, symlinks, wrong permissions/owner fail closed. Contents are not printed.

## Concurrency / crash recovery

Lock contention raises BACKUP_LOCAL_STORE_FAILED; it does not wait, steal locks or claim an ordinary logical conflict. Retry later with the exact encrypted candidate and expected checkpoint. A stale checkpoint after lock acquisition returns false as CAS conflict. Lost ACK can mean commit succeeded: exact retry plus verified checkpoint/object resolves it.

Crash can leave .pending-* or .checkpoint-lock. Lock is deliberately never auto-expired: age/PID checks alone cannot prove a writer is dead. Existing committed data remains readable. **Recovery requires offline operator review:** stop every writer using this root, inspect filesystem health, copy/preserve encrypted root and trusted checkpoint separately, verify/decrypt/replay complete referenced chain, then remove only the confirmed stale lock under explicit maintenance authority. Never delete head/objects or advance watermark to clear an error. No automatic cleanup/recovery command is supplied. Unreferenced temporary/orphan ciphertext may be removed only after all writers are stopped and dependency/inventory review; retention deletion is not implemented.

fsync/rename protocol is implemented and functional persistence/reopen is tested, but actual power-cut/kernel/storage-device durability is NOT proved by local tests. Whole-disk loss, malicious rollback/deletion and encryption-key loss are not solved. Metadata/checkpoint isn't cryptographically signed here; trust the protected filesystem and separately retained monotonic checkpoint. Source RPO and global batch identity/commit-order guarantees remain upstream responsibilities.

## Limits and validation

Objects <=8 MiB, checkpoint <=4096 bytes, core decoded payload <=4 MiB. Downloads aren't involved. Chain loader has aggregate bounds; full restore still uses memory. No retention delete, source SQL/journal, cloud upload, scheduling, alerts, FK/tenant restore or real PHI test.

```sh
node --test tests/v2-backup-local-store.test.mjs
node scripts/v2-backup-disk-drill.mjs
```

16 Linux tests cover reopen and new-process persistence, private immutable objects, stale/concurrent CAS, leftover lock refusal, traversal/symlink guards, corrupt/oversized content and missing referenced object. Linux-specific tests explicitly skip elsewhere; non-Linux skip is not evidence of adapter support. Synthetic drill is Linux CI only. Real disk-full/power-loss and offsite recovery drills remain pending.
