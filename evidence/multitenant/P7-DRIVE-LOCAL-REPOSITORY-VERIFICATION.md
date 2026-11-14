# P7 Drive local repository verification

Branch v2/account-trust-validation; parentd5d013c. Local-only scope, no new branch.

## Executed

- Node22.22.0/npm10.9.0, TZ=Asia/Kolkata:1269/1269 full tests pass, zero failures/skips.21 new Linux SQLite tests.
- Staged contributing checks, static security checks, production build and Pages readiness pass.
- git diff --cached --check performed before commit.

Actual temporary local SQLite databases tested with WAL/synchronousFULL and immediate transactions. Persistence/reopen, single-consumption state, hashed lookup, encrypted PKCE/grant bytes in DB/WAL, wrong-owner/clinic/expiry/clock refusal, duplicate insert, revoked authority, disconnect/reconnect revisions, two-handle claim/rotation CAS, lost vault key and state tamper refusal all checked. SQLite lock contention caused sanitized failure without consuming state; retry after rollback succeeded.

Integration test: real Request handler -> real OAuth coordinator -> real SQLite state/grant repository, fake Google exchange; callback303, replay403, close/reopen preserves encrypted connection, lastBackupAt remains null. No actual socket/Google request/account/token or patient data.

## Boundaries

Node22 builtin SQLite emits experimental warning; Linux-only support qualified here. Other OS tests explicitly skip; not Windows evidence. SQL executed ONLY against generated temporary local fixture databases and cleaned afterward. No Supabase/Master/clinical SQL or schema version change.

Fixture owner table/admin seed method are NOT production authority and must never be exposed over HTTP. Actual session verification, production authorised state/vault/job repository, latest-consent-intent fencing, folder/account binding, grant cleanup, exporter/ledger/scheduler/alerts and isolated real restore remain pending. No secure erase or power-loss/disk-full proof, backend deployment, credentials, push/tag/deploy or activation. Browser/hosted CI not rerun.

Two pre-existing unstaged .claude validator mode changes left untouched/uncommitted. Main, Master repo and original clinical21 unchanged. Only main and v2/account-trust-validation retained. Details: docs/multitenant/P7-DRIVE-LOCAL-REPOSITORY.md.
