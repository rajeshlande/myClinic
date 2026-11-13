# P7 storage protocol local verification

Branch v2/account-trust-validation; parent a14560f. Local-only scope, no new branch.

## Executed

- Node22.22.0 / TZ=Asia/Kolkata:1132/1132 tests pass, no failures/skips (20 new protocol fault tests).
- Staged contributing/static security checks, build and Pages readiness: pass.
- Existing synthetic encrypted baseline/increment replay drill: pass, four negative checks, zero requests.
- git diff --cached --check run before commit.

New tests cover immutable upload/readback-before-CAS ordering; repeat verification; upload/readback failure; crash after upload/before checkpoint CAS; lost CAS acknowledgement with exact retry; competing baseline and increment writers; identical retry convergence; stale checkpoint conflict without upload; pinned project/schema/key; malformed checkpoint/provider contract; loading and restoring a linked encrypted chain; missing object/key, resource and checkpoint identity checks.

## Limits / not executed

Adapter in tests is memory-only and not durable. Actual object-provider CAS/durability, trusted anti-rollback checkpoint, stable staged-candidate recovery, DB journal/mappings, source ACK, schedule, retention deletion, production restore and monitoring remain pending. API contracts/preconditions and recovery handling are documented in P7-BACKUP-COMMIT-PROTOCOL.md. Source adapter must guarantee globally unique batch IDs and complete commit order; commit protocol is not full-chain validation. Retrieval must be followed by restoreChain.

No hosted CI/native Windows/browser rerun this increment. Client code unchanged; prior synthetic browser43/43 remains historical. No network/account credentials, live SQL, PHI, push/tag/deploy, access activation, main changes or separate Master changes. Only main and v2/account-trust-validation retained.
