# P7 consistent source-export preparation verification

Branch v2/account-trust-validation; parent8c13d12. Local-only continuation; no new branch.

## Normal gates executed

- Node22.22.0/npm10.9.0, TZ=Asia/Kolkata:1352/1352 full tests pass, zero failures/skips;22 new source contract/security tests.
- Staged contributing/static security checks, production build and Pages readiness pass.
- git diff --cached --check performed before commit.

Unit cases cover baseline ciphertext, lossless scoped key wrapper, composite PK deletion/replay, source project/clinic/schema/epoch pins, incomplete/missing/extra tables, wrong/missing tenant scope, duplicate/null keys, stable key ordering, retention/sequence gaps, no-change signal, unknown operations/tables, row/change bounds, unsafe JSON numbers, boolean keys, sanitized source failure and ambiguous/reset cursor refusal.

## Actual local PostgreSQL proof (separate from npm tests)

Installed local PostgreSQL17.12 + system Python psycopg2 as ephemeral TEST dependencies; no app dependency/lock changes. OS-created empty default cluster remained DOWN (policy prevented service start). Created fresh scratch cluster under ignored .arena/p7-source-pg, user source_fixture, private0700 Unix socket, port55437 with listen_addresses='' (NO TCP). Fixture schema p7_source_fixture only; no public/auth/live project or PHI. Started/stopped with process tools; shutdown confirmed clean. No server left running for this proof.

Python proof10/10 checks passed:
- Repeatable-read baseline head/rows unchanged while another transaction commits.
- Rolled-back transaction produces no sequence hole or exported row value.
- Concurrent writer observed blocked by first transaction; commit ordering contiguous.
- Multi-table changes grouped atomically; composite PK update emits delete+upsert.
- Per-clinic stream/window excludes other clinic sentinel, including transaction touching both clinics.
- TRUNCATE and clinic scope move refused in fixture.

Node encrypted replay over those real PostgreSQL windows passed: baseline watermark1 +5 committed transactions ->watermark6; final in-memory raw data equals PostgreSQL source exactly (patients2,appointments1,staff_branches1). Generated key ephemeral; no plaintext patient marker in encrypted envelope. This is NOT a database restore into PostgreSQL or a live clinical export.

## Explicit limits / remaining gates

Source encoder validates trusted readWindow; it cannot prove a lying/incomplete adapter. Actual clinical inventory/derived scope/PK/type/FK mapping and read-only role/transport are NOT implemented. Fixture global writer-lock journal proves ordering but serializes writes/has availability and plaintext-copy cost; NOT approved production migration. No trigger applied to clinical/Master/original21.

Source stream pin currently registry-configured, not durably authenticated in job/archive epoch metadata; epoch/reset policy remains gated. NO_CHANGES emitted without archive; durable no-change job/UI policy not yet integrated. Source pruning, real journal performance/capacity, production prepareBatch mapping, sourceRPO/restore, scheduling/retries/alerts and live Google remain pending. No hosted CI/browser/Windows proof this increment.

No live SQL/credentials/configuration, remote connection, Google upload, push/tag/deploy or tenant activation. Main, Master repo and populated original clinical21 unchanged. Two pre-existing unstaged .claude validator mode edits left untouched/uncommitted. Only main and v2/account-trust-validation retained. Reproducer/limits: docs/multitenant/P7-SOURCE-EXPORT.md.
