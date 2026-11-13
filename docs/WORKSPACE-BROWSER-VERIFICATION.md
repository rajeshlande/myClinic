# Workspace lifecycle: native browser verification

> Latest increment: [guarded replay](WORKSPACE-REPLAY.md) records23/23 native scenarios and921/921 Node22 tests. Earlier recovery added5 scenarios and replay added4; the14/14 and880/880 figures below are the original browser milestone.

## Outcome

**14/14 real-browser scenarios PASS** in headless Chromium **145.0.7632.6**, driven by Playwright1.58.2 on Node22.22.0. Native Web Locks, IndexedDB and storage events were used across separate pages of one isolated browser context. No fake-indexeddb or simulated Web Lock queue was used in this browser run.

**Supported Node22.22.0 checks:** clinic880/880 tests, contributing28/28 with zero warnings, repository security command exit0, production build and Pages checks PASS. This closes the prior local Node20-only evidence gap; hosted CI is still unrun. Checks invoked the scripts with Node22 directly; the workspace's global npm was not upgraded.

No product-source change or activation was required. New files are a separate allowlisted synthetic harness under `/home/user/workspace-browser-preparation/`, plus documentation/evidence updates. Playwright is pinned in that harness package, not added to app production dependencies. Harness dependency audit reported0 vulnerabilities.

## Browser scenarios

| # | Native browser check | Result |
|---|---|---|
|1|Trustworthy loopback context supports native Web Locks and IndexedDB|PASS|
|2|IndexedDB cache survives page reload; metadata contains no synthetic patient payload|PASS|
|3|Separate user, workspace and clinic namespaces remain isolated across tabs|PASS|
|4|Concurrent tab commits with the same revision: exactly one succeeds|PASS|
|5|Real storage event invalidates the other tab; cleanup clears its registered cache|PASS|
|6|Old tab without an event listener is still rejected by the durable fence|PASS|
|7|Pending outbox survives cleanup; reload stays blocked rather than discarding work|PASS|
|8|Closing a lock-owning page releases the native Web Lock to a waiting page|PASS|
|9|Closing a page after persisted blocked fence leaves the next page fail-closed|PASS|
|10|Injected metadata write refusal is not reported as successful cleanup|PASS|
|11|Injected IndexedDB-open refusal during cleanup leaves the generation blocked|PASS|
|12|Native IndexedDB versionchange closes the old connection|PASS|
|13|Real storage event + actual controller modules invalidate the remote controller/token provider|PASS|
|14|Stale coordinator cannot erase a newly reopened generation|PASS|

The final browser run made **0 non-harness requests**. Each scenario uses a fresh ephemeral browser context. Only synthetic UUIDs, fictional records, public-looking example URLs and an unsigned test token are used. Auth/mint/network responses are injected fixtures; there is no real Central or clinical connection, secret, login or patient data. Browser routing rejects any request outside the local harness origin; page CSP also forbids network connections.

## Evidence and reproduction

- `workspace-browser-preparation/server.mjs`: binds0.0.0.0:4174; serves only the harness and an explicit allowlist of staged modules, not the whole repository.
- `harness.mjs`: browser-native fixtures, using actual staged controller/lifecycle/persistence modules.
- `verify-browser.mjs`: Playwright scenarios and machine-readable results.
- `browser-results.json`: Node/browser versions,14 results, elapsed times, request count.
- `verify-node22.mjs`: tests/contributing/security/build/Pages with the executing Node runtime.
- `/home/user/workspace-browser-tests.log` and `/home/user/workspace-browser-node22-{summary,tests,contributing,security,build,pages}.log`.

To reproduce in a fresh workspace environment, install app dependencies (`npm ci` in myclinic), then `npm ci` in workspace-browser-preparation. Install Chromium and its Linux libraries with that preparation directory's `npx playwright install --with-deps chromium` (system packages may require administrator rights). Browser binaries, node_modules and OS libraries are not persisted deliverables; reinstallation may be necessary after a workspace restore.

Start `node server.mjs` from workspace-browser-preparation. In another terminal there, run:

```sh
npm exec --yes --package=node@22.22.0 -- node verify-browser.mjs
npm exec --yes --package=node@22.22.0 -- node verify-node22.mjs
```

The runner uses http://127.0.0.1:4174 from the sandbox browser, not the user's browser. Page modules use relative/same-origin URLs. The server accepts the preview host and is only a synthetic test page, not a v2 app deployment. The test server is stopped after verification.

Initial Chromium launch failed because sandbox Linux libraries were absent (`libnspr4.so`); Playwright install-deps restored the prerequisites, and subsequent browser runs passed. This was a harness environment failure, not a product test pass.

## What is NOT proved

- Firefox, WebKit/Safari, mobile browser, embedded iframe or private-mode compatibility.
- Actual power loss, full browser/OS crash, filesystem durability or disk sanitization. Scenario9 deliberately stalls the cleanup-open call then closes the page; it is a page-closure interleaving, not a machine crash.
- Genuine disk-full/browser quota exhaustion. Scenarios10/11 inject failure paths while native normal-path storage is used.
- Browser UI/React StrictMode lifecycle, legacy tabs or clinical store/replay integration.
- Hosted Pages/admin routes, production CSP/origin policy, live gateway JWT/TPA/JWKS/rotation, network revocation, PHI migration, backup/restore or deployment.
- Automatic recovery: a retained-work/crash-blocked fence intentionally stays blocked. The browser verifier observes the safe refusal; it does not unblock or discard pending work.

## Next step

Implement explicit blocked-fence recovery with durable inspection and preservation of pending writes, then guarded store/replay and conflict acknowledgements. A fresh coordinator/reload must not clear the block. Legacy per-user outbox migration remains a separate reviewed lossless process; do not copy ambiguously scoped data or delete it on successful namespace creation.

The live app1.43/schema21 and its legacy connection/data remain unchanged. No SQL, keys/config, deployment, commit/tag or version bump. Master mint_enabled and clinical tenant_access_enabled remain OFF.
