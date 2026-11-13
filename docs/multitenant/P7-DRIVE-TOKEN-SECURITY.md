# Owner Drive connection — server token security

Local-only implementation on v2/account-trust-validation. No credentials, real OAuth request, live repository or activation. Owner card remains staged/unconfigured. These modules must never be imported into browser source.

## Grant encryption codec

`scripts/lib/v2-drive-token-vault.mjs` exports sealDriveGrant/openDriveGrant. AES-256-GCM with fresh96-bit nonce,128-bit tag, bounded encrypted JSON. Authenticated data includes purpose string (separate from backup format), vault key ID, user ID, clinic ID and connection revision. Caller must supply exact authoritative expected owner/clinic/revision when opening, not trust those values from the envelope itself. Cross-clinic/user/revision edits fail authentication or pin checks. Retained key map supports reviewed key rotation. Removed keys cannot decrypt old grants.

Use a separate backend vault key from backup data keys, OAuth client secret, app frontend/public keys and Drive files. No key generation/persistence/distribution is configured by this codec; server operator must provision recoverable secret custody separately. Envelope metadata is visible operational context, not PHI. Refresh token only exists as plaintext in trusted backend memory; codec does not promise secure erase. Never send openDriveGrant output through owner API, logs, localStorage or a service worker.

The codec is NOT a durable vault repository: saveEncrypted in OAuth coordinator still needs a transactionally authorised repository implementation, schema, restricted service identity, audit and secret-store key retrieval. A valid old envelope can be replayed if the trusted connection revision is rolled back; retain authoritative monotonic connection state separately.

## Google token HTTP transport

`scripts/lib/v2-drive-google-tokens.mjs` exports createGoogleDriveTokenTransport. Credentials obtained at call time from mandatory backend callback; never bundled/committed. Exchange posts code+PKCE+fixed HTTPS redirect and client credentials to pinned oauth2.googleapis.com/token. Refresh posts stored refresh token to same endpoint. No URL credentials, redirect following, browser persistence or raw error bodies.10-second request timeout and16 KiB bounded streamed response. Strict Bearer access token, lifetime, scope and optional refresh-rotation validation; code exchange requires refresh token and explicit drive.file scope. Omitted scope on refresh inherits only the already-verified drive.file grant from the caller's stored connection. Broad/additional scopes are refused.

Returns tokens ONLY to trusted backend coordinator/worker. This is not an HTTP route and does not set cookies or authorise an owner. It must be composed with authoritative owner/session/CSRF checks and exact Google-client redirect registration. Provider errors are sanitized as GOOGLE_DRIVE_TOKEN_FAILED. No retry loop: authorization codes are single-use; ambiguous code-exchange failures require reviewed recovery/reconnect rather than blindly replaying.

## Backend access-token bridge

`scripts/lib/v2-drive-access-token.mjs` exports createDriveAccessTokenProvider, usable as encrypted archive adapter's getAccessToken. Requires an authorised connection repository, key map and refresh transport. Reads current enabled, owner-bound connection, decrypts grant, refreshes token, then rechecks connection revision and enabled/ownership authority after network. Disconnect/reconnect/revocation during refresh prevents release of the token. Returned short-lived token is not cached/persisted by this module.

Rotated refresh token is encrypted with active vault key, owner/clinic binding and next revision; repository replaceGrantIfCurrent must atomically compare authority+enabled+revision and replace ciphertext+bump revision before token release. Conflict fails closed. The eventual repository must prevent mutations without revision changes, make disabled connections invisible and resolve fresh active ownership (not stale client claims). Key map must be immutable during calls.

Provider rotation can invalidate the old refresh token before local persistence. This implementation detects conflict but does not provide a durable pending-rotation recovery journal. A crash/conflict in that window may require owner reconnection; a real job service needs tested durable recovery/quarantine before claiming unattended reliability. Multiple concurrent refresh jobs must be serialised/fenced by the authoritative repository/worker. Disconnect can race AFTER token release; archive/export job must also enforce connection revision before admission and subsequent stages. Access tokens already issued by Google cannot be made never-issued by local disconnect.

## Local tests

29 tests in v2-drive-token-security.test.mjs cover bound encryption/tamper/key rotation, token HTTP body/pins/PKCE, refresh omitted-scope and rotation responses, malformed/broad token payloads, provider errors/body limits, and backend bridge disconnect/rotation CAS fencing. All use generated synthetic keys and fake HTTP/repositories. No real Google test or client configuration.

## Remaining activation gates

Google OAuth client/consent/callback settings; backend secure session/CSRF/owner middleware; production atomic state store; encrypted vault+connection schema and authorisation; account identity/folder mapping; shared-grant cleanup; durable export/rotation ledger and source journal; daily scheduler/alerts; isolated real restore; explicit live configuration/deploy approval. None follows automatically from a green test/build.
