# P7 private Drive folder binding verification

Branch v2/account-trust-validation; parentbaaba15. Local-only continuation, no new branch.

## Executed

- Node22.22.0/npm10.9.0, TZ=Asia/Kolkata:1290/1290 full tests pass, no failures/skips;21 new folder tests.
- Staged contributing/static security checks, production build and Pages readiness: pass.
- git diff --cached --check performed before commit.

Mocked Google transport tests: pinned reserve/create/get, private folder marker,409 metadata verification, shared/foreign-owner/trashed/not-folder/read-only/wrong-clinic/wrong-binding refusal, invalid IDs, provider errors and16KiB metadata bounds.

Real temporary local SQLite integration tests: persist ID/binding before create; interrupted creation/reopen retry reuses exact ID; every job attempt rechecks folder metadata; concurrent reservations converge; disconnect/revocation/reconnect fence activation; same-account token-rotation transaction preserves destination while advancing revision; old-revision folder verification fails and retry reuses intent; mismatched receipt cannot mark verified.

## Boundaries / not executed

No real Google token/account/folder/file/API call, PHI, network request, live SQL, project setup or deployment. Local additive drive_folders table only in fixture SQLite. Linux/Node SQLite limits and synthetic owner-authority restriction remain. Provider-returned Google account identity and actual permission metadata behavior require live synthetic acceptance before PHI. UI unchanged/unconfigured, no browser/hosted CI/Windows rerun.

No durable jobs/export ledger, source journal/exporter, scheduler/alerts, retention deletion or actual database restore. Folder verification is destination evidence, not a completed backup. Old/orphan remote folders are not deleted automatically. Next worker must recheck authority/revision and use exact verified receipt for uploads; future sharing/revocation cannot be permanently prevented by metadata check.

Main, original clinical21 and separate Master repo untouched. No push/tag/deploy/tenant activation. Existing two unstaged .claude validator mode changes left untouched. Only main and v2/account-trust-validation remain. Details: docs/multitenant/P7-DRIVE-FOLDER-BINDING.md.
