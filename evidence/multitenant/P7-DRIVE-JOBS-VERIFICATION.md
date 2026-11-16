# P7 durable local jobs/export ledger verification

Branch v2/account-trust-validation; parentacefa75. Local-only continuation; no new branch.

## Executed

- Node22.22.0/npm10.9.0, TZ=Asia/Kolkata:1312/1312 full tests pass, no failures/skips;22 new Linux local-job/worker tests.
- Staged contributing/static security checks, production build and Pages readiness: pass.
- git diff --cached --check performed before commit.

Actual temporary SQLite tests: persistent dedup/admission, exclusive lease and two-handle competition, staged ciphertext/pre-reserved file ID close/reopen/reclaim, expired-token fencing, exact-candidate/id retry, verified receipt mismatch refusal/no premature backup time, committed status recovery, baseline/increment ledger boundaries, pinned project/schema, owner/disconnect/reconnect cancellation, token refresh revision propagation, duplicate batch identity, encrypted bytes/no plaintext fixture patient marker and sanitized owner status.

Worker integration uses real SQLite ledger and synthetic encrypted backups with fake folder/source/archive adapters. Verifies stage-before-upload, commit-after-receipt, lost-upload-ACK restart using same saved candidate/file ID without reprepare/re-reserve, mismatched destination refusal before source preparation and disconnect-during-upload refusal to advance head.

## Not claimed

No actual Google API/upload/account, source-database snapshot/journal/export, PHI, scheduler, notification, retention deletion or real restore. Additive SQL executes only against temporary local fixture SQLite. Node builtin SQLite Linux/experimental limits remain. Fixture owner authority must not authorise production.

No production job/status route wiring: existing HTTP queue contract needs explicit integration for already RUNNING/STAGED jobs and persistent owner job-progress/completion UI. Current staged UI cannot automatically clear a pending request from job completion. Source registry and consistent export windows remain trusted adapter requirements, not implemented here. No lease heartbeat, aggregate quota, expired candidate retention or source ACK/pruning. Completed/cancelled encrypted candidates retained for reviewed recovery.

No browser/hosted CI/Windows rerun this increment. Main, separate Master and populated original clinical21 unchanged. No live SQL/credentials/configuration, push/tag/deploy or access activation. Two existing .claude validator mode edits left untouched/uncommitted. Only main and v2/account-trust-validation retained.
