# Owner Drive HTTP boundary — local implementation

## Delivered

`scripts/lib/v2-drive-http.mjs` implements a framework-neutral Request -> Response handler; `src/lib/drive-backup-service.mjs` implements the staged same-origin browser client. These compose with the owner OAuth coordinator/UI controller. No listener, live endpoint, Google client or production session/state/repository adapter is configured. Nothing is mounted in the legacy app.

All work on v2/account-trust-validation. No live SQL/deploy/activation.

## Routes

| Route | Method | Safe response |
|---|---|---|
| /v2/clinics/:id/drive-backup | GET | connected,lastBackupAt |
| .../connect | POST | consentUrl |
| .../disconnect | POST | connected=false,lastBackupAt=null |
| .../backup | POST |202 jobId,status=QUEUED |
| /v2/drive/callback | GET |303 to fixed /#/settings?tab=backups after callback success |

The callback URL must be registered exactly with Google and configured as OAuth coordinator redirectUri. The fixed destination is the intended future v2 Settings route; that route/tab is NOT yet mounted. Handler is not ready to route production traffic merely because these tests pass.

All responses no-store/no-cache, nosniff, no-referrer and deny framing/content. No wildcard CORS. Request external origin must equal configured HTTPS publicOrigin; frameworks behind proxies must supply correctly normalised trusted URL, not trust unvalidated Forwarded/Host headers. Unsupported paths/methods return404/405. Generic503 on internal/provider errors; raw error/token/SQL bodies never echoed.

## Required backend dependencies

- verifySession(request): verify a secure backend session, return null when unauthenticated. Never trust client IDs/role headers. Client uses same-origin cookies; Google callback must recover signed-in session through secure cookie/session continuation. Cookie creation, renewal, SameSite/HttpOnly/Secure policy, login-to-backend handoff and actual signature verification are not provided here. Current legacy browser login is NOT automatically a compatible backend cookie session.
- resolveOwner(session,clinicId): independently resolve current active owner for requested clinic. Runs before clinic business action and callback completion. No default owner role.
- verifyCsrf(session,token): verify session-bound anti-CSRF token. POST additionally requires exact Origin and application/json. Token header X-Clinic-CSRF cannot substitute for backend validation. Client must obtain CSRF material from reviewed authenticated session bootstrap; no bootstrap endpoint implemented yet.
- admitRequest(session,action): mandatory real rate limiter/admission policy. False ->429. Test always-true fixture is not a production implementation.
- resolveCallbackClinic(session,state): read backend hashed-state binding only for correct authenticated session/owner and unexpired state. Do not accept clinic ID from callback query, token claims alone or browser storage. OAuth complete then atomically consumes state via its own stateStore.claim. Google denial/malformed/duplicate state never triggers completion. Complete already rechecks active owner. Expired/used-state lookup must fail; pending-state cleanup still needs durable adapter.
- readStatus: read truthful verified connection/backup evidence; handler projects summary fields, not repository tokens/envelopes.
- requestBackup: atomically check enabled connection, active owner, job limits and deduplicate/manual admission; return durable queued job ID. It must not enqueue actual work without source/exporter/ledger readiness. No worker/queue repository exists yet.

POST bodies empty or literal empty JSON object, <=1024 bytes; no body identity/role/target/token fields. Callback accepts expected Google OAuth fields only, validates code/state shape and never uses returnTo/next to choose redirect. Log middleware MUST scrub callback query/code/state and cookies; handler cannot control reverse-proxy logs. Browser callback denial currently produces sanitized JSON error (not a branded recovery screen). No query/callback gets persisted in service worker/offline storage.

## Browser service / queue honesty

Uses fixed relative /v2 endpoints, same-origin credentials, redirect:error, no-store and10s timeout. Calls getCsrfToken for POST, not localStorage. Bounded16 KiB response read; returns only explicit consent/status/queue fields, never raw backend payload/token.

Owner controller now treats accepted backup as QUEUED with pendingJobId. It does NOT change lastBackupAt or connected status to claim completion. This screen disables another backup request while a local pending job remains and explicitly says progress tracking is unavailable. Disconnect clears local pending request state; this does not prove an already-running job was cancelled or files removed. Refreshing summary cannot establish job completion; persistent job tracking/completion states and authoritative backend deduplication remain pending. Reloading UI cannot be relied on as a rate limiter.

## Verification and limits

19 new tests cover owner/session gates, cross-clinic/inactive roles, POST Origin/CSRF/content/body bounds, method/path/host rejection, rate limiting, sanitized summaries/errors, callback input and fixed redirect, browser->handler status/queue/disconnect flow and controller queue semantics. Requests/Responses are real Web API objects with fake session/repository/Google services. No socket/Google/cookie login or browser end-to-end proof.

Remaining: production session/CSRF/rate-limit adapters, durable single-use state+vault+job repositories, folder binding, source/export ledger/schedule/alerts, mounted v2 Settings, callback recovery UI and real hosted allow/deny/Google/restore acceptance. Keep live owner connection unavailable until these gates are met.
