# Guarded staging composition verification

Parent28b71ef; branch v2/account-trust-validation. Scope: separate HTML composition, no main merge/live operation.

Executed on Node22.22.0/npm10.9.0:
- Full suite1362/1362 PASS, zero failures/skips;10 new staging tests.
- Contributing/security checks PASS.
- Vite multi-page production build PASS; index.html + v2-staging.html emitted, relative generated assets. Pages readiness PASS (28 built files).
- git diff --cached --check before commit.

New tests: invalid/missing config refuses before client creation; fixed Central pin/no legacy env fallback; malformed/privileged key-shape refusal; no automatic Auth/RPC on composition; explicit memory-only Auth options; local-only sign-out; login followed by existing controller boot; old boot fails NOT_READY; reviewed synthetic boot reaches picker with no clinical mount; wrong clinical descriptor refuses before mint; sanitized login failure; static separate composition excludes legacy/store/storage/SW imports and leaves legacy main unchanged.

No real account credentials, Central Management changes, hosted login, live boot/provisioning/mint, gateway request or clinical query/write used. No Master code/SQL/config/flags changed. Synthetic fixture replies injected into existing controller; not hosted trust proof. No interactive Chromium test for this new page this increment, no cross-browser/StrictMode interactive proof; prior harness evidence cannot substitute. READY intentionally not RLS acceptance. No real PHI/migration/Drive upload. No push/deploy/tag. Two existing unstaged validator mode edits untouched.

Opening the root remains legacy app. Staging path only available after separately approved transfer/deployment. Actual existing Central response may not match the reviewed extended RPC; failure stays blocked, no fallback. See docs/multitenant/V2-STAGING-ENTRY.md for behaviour, explicit test steps and remaining gates.
