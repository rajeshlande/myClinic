# P7 local release/operations preparation

## Scope / current status

Local-only preparation on `v2/account-trust-validation` (P7 commit fast-forwarded here; temporary P7 branch removed). No live calls, SQL, secret configuration, pushes, deployment, schedule activation or flag changes. Existing ci.yml/pages.yml and live app connection remain unchanged. This is not a completed P7 release or an activated v2 application.

### Delivered locally

- `.github/workflows/v2-validation.yml`: secretless Ubuntu/Windows Node22.22.0 tests/contributing/security/build/Pages matrix, plus native synthetic Chromium job and7-day synthetic-result artifact. Triggers only validation; no deployment permissions or scheduled live jobs. Existing CI remains independent. Hosted execution unrun until explicitly pushed/enabled.
- `tools/workspace-browser/run.mjs`: one-shot portable runner starts the allowlisted synthetic server, waits for readiness, invokes existing browser tests and stops its server. Port4174 must be free. No account credentials or real clinic requests.
- `scripts/v2-ops-probe.mjs`: read-only server/operator metadata probe, dry-run by default. Live mode requires both --live and OPS_ALLOW_LIVE_READS=yes, plus both server credentials. Pins Master/new clinical URLs, GETs only app_meta schema_version limit1, rejects redirects, uses10s timeout and emits sanitized status/version results. No arbitrary URL override, token mint or capacity/patient reads. Master4 deliberately reports schema mismatch, not ready.
- Backup/restore core: `scripts/lib/v2-backup-core.mjs` and synthetic-only `scripts/v2-backup-drill.mjs`; see `P7-BACKUP-CORE.md` for APIs, resource limits and source/inventory trust assumptions. Implements compressed AES-GCM batches, validated ordered replay with tombstones and dependency-aware retention planning. Not a database exporter or hosted restore drill.
- Storage commit protocol: `scripts/lib/v2-backup-commit.mjs`; immutable upload/readback, conditional committed cursor, safe conflict/retry handling and bounded chain loading. Tested with memory/fault adapters and the Linux local-disk adapter; see `P7-BACKUP-COMMIT-PROTOCOL.md`. No external/cloud provider adapter exists yet.
- Local-disk adapter: `scripts/lib/v2-backup-local-store.mjs` and synthetic `scripts/v2-backup-disk-drill.mjs`. Implements private immutable files, fsync/rename checkpoint updates and fail-closed lock handling. See `P7-LOCAL-DISK-STORE.md`; Linux only, not offsite or power-loss proof.
- Operations status policy: `scripts/lib/v2-ops-status.mjs` and synthetic `scripts/v2-ops-drill.mjs`; freshness/failure/unknown handling and planned capacity warning. See `P7-OPERATIONS-POLICY.md`. No live collector, scheduler or notifications are configured.
- Backup/restore requirements and runbooks: `P7-BACKUP-RESTORE-CONTRACT.md` and `P7-RELEASE-CHECKLIST.md`. Production exporter, external storage, scheduling and live restore remain blocked.

## Local validation

From repository root with declared Node/npm versions:

```sh
npm ci
npm test
npm run check:contributing
npm run test:security
npm run build
npm run check:pages
node scripts/v2-ops-probe.mjs --dry-run
```

Browser tests after installing the separate harness dependencies and Chromium prerequisites:

```sh
cd tools/workspace-browser
npm ci
npx playwright install --with-deps chromium
node run.mjs
```

The runner uses no app .env.local credentials; synthetic clients are injected. The normal app dev server still uses its legacy environment. Do not change clinical endpoints as a shortcut to trust setup.

## Future operator-only live probe (not executed/authorised here)

Provide MASTER_OPS_KEY and CLINICAL_OPS_KEY only via a trusted operator process/secret store. Never use VITE variables, commit a secret file or print environment values. The current app_meta grants generally require server authority; service credentials are powerful, so prefer a separately reviewed minimal read-only operations endpoint/role before scheduling. This tool does not create least-privilege database access.

After separate approval, set OPS_ALLOW_LIVE_READS=yes and run with --live from a trusted machine. Modern sb_secret keys are apikey-only; legacy service-role JWTs also carry the bearer header. Local shape recognition is not signature verification; the actual server authenticates the key. Never run this server-key probe in the browser. Do not upload requests/headers/secret dumps as artifacts.

It makes actual DB metadata reads, unlike an HTTP landing-page ping. A200 with wrong schema, malformed/empty data, refused read, timeout or540 is not a readiness pass. It cannot unpause a project, prove tenant isolation, inspect all addenda, enforce size limits, make backups or guarantee Free-tier availability. The real keep-alive schedule/alerts are intentionally absent until operator authority/configuration and dependencies are ready.

## Remaining P7 blockers

- Combined / + /admin assembly depends on unfinished P5/P6 and a reviewed Master repository version. Do not copy a legacy admin build and call it v2 complete.
- Two-Central-env-only release, production-origin CSP, one SW and dynamic clinical descriptor acceptance are not yet integrated. Existing legacy workflow/env remains preserved.
- Hosted workflow pass, actual scheduling/alert delivery, least-privilege service auth, encrypted external export and restore, capacity/egress monitoring, release version/schema coordination, rollback/PHI governance remain pending.
- No install/schema reset, real-PHI migration or activation is part of this preparation. Preserve original populated clinical21.

See the phase tracker outside the repo for broader P0–P8 status; the above standalone files are included here for portable handoff.
