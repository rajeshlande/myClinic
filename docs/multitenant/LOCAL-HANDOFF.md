# Multitenant branch: local handoff

Branch: `v2/account-trust-validation`. Baseline: v1.43.0 `b1e174ee00abc6b533e364fa578b5b017802c2d2`.

## What this branch is

Staged multitenant client preparation, NOT an activated v2 application. App/main/Auth/StoreProvider/static Supabase/Setup/public booking remain on the legacy path. Running `npm run dev` does not automatically switch to Master login or test OIDC. No migration, token mint, replay or discard runs automatically. Package remains1.43.0 and released `supabase/schema.sql` remains schema21 with a planning comment. The service worker additionally excludes Edge Function API requests from its cache.

Only myclinic is included. Master schema5/Edge Functions/operator code is in a separate repository and is NOT supplied by this bundle. Real cross-project testing requires the separately reviewed Master delivery and explicit account-side setup; do not infer it is installed.

## Restore the bundle

Fresh directory:

```sh
git clone -b v2/account-trust-validation /path/to/myclinic-multitenant.bundle myclinic
cd myclinic
git status
```

Existing checkout (preserve your own changes first):

```sh
git bundle verify /path/to/myclinic-multitenant.bundle
git fetch /path/to/myclinic-multitenant.bundle refs/heads/v2/account-trust-validation:refs/heads/v2/account-trust-validation
git switch v2/account-trust-validation
```

If that local branch already exists/diverged, fetch into a different branch name and review; do not force-reset it. The bundle contains reachable history, so a fresh clone needs no prerequisite repository. No remote push/tag is performed as part of delivery.

## Local verification

Use Node >=22.22.0 and npm >=10.9.0 per package engines:

```sh
npm ci
npm test
npm run check:contributing
npm run test:security
npm run build
npm run check:pages
```

Check package.json for exact available scripts if your checkout differs. Existing `.env.example` describes the legacy app, not a completed live v2 env migration. Do not point it at an empty schema22 project and expect legacy login to become the new tenant flow.

Portable synthetic browser suite:

```sh
cd tools/workspace-browser
npm ci
npx playwright install --with-deps chromium
node server.mjs
# In another terminal, same directory:
RESULT_FILE=local-browser-results.json node verify-browser.mjs
# Windows PowerShell: $env:RESULT_FILE='local-browser-results.json'; node verify-browser.mjs
```

Stop server with Ctrl+C afterwards. Port4174 must be available. Browser suite uses local synthetic Auth/clinical fixtures and native IndexedDB/Web Locks, not your real account. Output JSON is ignored by Git; `evidence/multitenant/browser-results.json` retains the fresh portable-harness43/43 result. The server resolves this repo relative to its own file, not the original Arena workspace. Historical guides with `/home/user/...` log paths describe earlier workspace evidence, not dependencies for running the branch.

## Clinical SQL is preparation, not automatic migration

`supabase/preparation/schema22/` includes the separately prepared consolidated schema22 delivery, migration/sync addenda, tests and historical local verification summary. Nothing in npm/dev/build applies these SQL files.

- `consolidated-new-project.sql` is for the reviewed NEW/EMPTY clinical destination only; not an upgrade of the populated schema21 project.
- `migration-22.sql` / `tenant-sync-22.sql` are constituent preparation files, not instructions to blindly apply each after the consolidated file.
- Read DELIVERY-GUIDE.md and inspect installed definitions before any manual application. That guide retains historical workspace paths and project references.
- The original populated project `nosqdnmnztsikfygyiqa` must never be reset/deleted. Intended new clinical: `kvxmcdezpozkvdmvmicr`; Master: `inaqzvzfongngahxptzw`.
- Existing installed schema22 may lack later addenda. Confirm exact real project and installed state; a schema_meta version alone is not proof.
- Keep Master mint_enabled and clinical tenant_access_enabled OFF until real trust, RLS and cutover dependencies are verified. Defaults/historical reports are not a current live check.

## Real-account test safety

Keep all secrets in your own local environment/approved secret store, never in Git, bundles or chat. TPA setup, SQL, function deployment and flag changes are explicit separate operations. Test synthetic users/clinics, never production patient data. Do not deploy this branch to the working site as a shortcut.

P0 still requires real project inventory/Free limits, discovery/JWKS integration, RS256 token acceptance, auth.uid()/issuer/role isolation, disabled local-signup configuration and revocation/rotation proof. Account-side trust testing was deferred and is not automatically completed by cloning this branch.

Known blockers: conflict+queued-tail reconciliation safely halts; no lossless legacy PHI/outbox migration; remaining specialised workflows, public booking fold, live frontend wiring, /admin/combined delivery, field/pagination/egress design and backup/restore/governance gates. See STATUS-AT-HANDOFF.md and WORKSPACE-* guides. No automatic retry/discard or old-client fallback should be added to get around these blockers.

## Branch packaging verification

Before commit: staged-file-aware Node22.22.0 suite1060/1060 PASS (includes3 new handoff/panel contract checks), contributing28/28 zero warnings, security/build/Pages PASS. Portable in-repo Chromium harness43/43 PASS with zero non-harness requests. Added explicit review-panel listener teardown after staging exposed a previously unscanned cleanup failure; no ratchet was weakened. Synthetic server stopped. Backend SQL was copied unchanged from prepared delivery, not reapplied/rerun in this packaging step. Historical status snapshots remain historical; this branch commit supersedes their “uncommitted” delivery status, not their outstanding deployment/trust gates.
