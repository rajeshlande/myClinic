# Clinic-owner Google Drive backups — v2 local preparation

## User decision

Backup payloads must be encrypted before being stored in Google Drive. Each clinic owner connects a Google account through Google consent while signed into the clinic. This is a separate destination connection, NOT a replacement for clinic authentication. Non-owner staff must not connect, disconnect, request backups or retrieve destination details.

Work stays on v2/account-trust-validation. No Google project/client/bucket/account configured, no token requested in chat, no upload/SQL/deployment/activation authorised by local implementation. This feature is staged, not enabled in the legacy1.43 app.

## Implemented locally

- `src/components/owner/DriveBackupsTab.jsx`: staged owner-only v2 settings card with explicit consent, Connect Google Drive, connection/last-backup status, request-backup and confirmed disconnect actions. Unconfigured service disables controls with an honest explanation. It is NOT imported into legacy Settings/App/router. Host must key/remount by clinic+user, pass verified v2 access and invalidate the controller on logout/membership changes. A local role check is UX only, never server authorisation.
- `src/lib/owner-drive-backups.mjs`: injectable UI controller; no owner fallback, no secrets in storage, serialized actions, late scope/logout response rejection, sanitized failures and strict Google consent URL allowlist. Default no service means unavailable. No fake connected/scheduled success.
- `scripts/lib/v2-drive-owner-oauth.mjs`: server-only coordinator. Resolves active clinic ownership independently for every action, generates600-second state with32 random bytes, hashes state for backend lookup, PKCE-S256, offline access, Google account selector/consent and drive.file only. Callback requires same authenticated owner/clinic, atomically claimed single-use state, unexpired record and refreshed ownership check. Tokens go only to mandatory encrypted-vault adapter; failure requests safe unstored-grant cleanup. No Google secrets/token exchange HTTP implementation or production state/vault adapter exists yet.
- `scripts/lib/v2-drive-encrypted-archive.mjs`: server-only Google Drive archive uploader using injected access-token provider. Reserves Drive file IDs, accepts only authenticated encrypted backup envelopes, uploads ciphertext into a pinned folder, verifies returned file metadata and downloads/compares ciphertext before producing receipt. Exact retry uses same reserved file ID and saved ciphertext;409 requires verification, not assumed success. Fixed Google HTTPS endpoints, no redirects,30s request timeouts, bounded response reads, no raw errors/tokens returned. Unit tests use fake transport only; no real Google uploads.

## Required owner journey after activation

1. Sign into clinic normally; active owner opens Settings → Backups in migrated v2 UI.
2. Confirm authorisation for encrypted backups and separate recovery key custody.
3. Backend checks fresh session/owner membership, creates PKCE/state bound to that clinic/user and returns Google consent URL.
4. Owner chooses their Google account and consents to narrow drive.file access. Never ask owner to paste credentials/Google password into clinic or chat. New connection always uses explicit account choice/consent.
5. Callback completes through approved HTTPS app/backend path. Backend handles code exchange, verifies granted scopes, stores refresh token encrypted at rest and establishes clinic-specific destination folder/connection revision. Browser receives status only, never refresh token/client secret.
6. Server-side worker produces consistent encrypted baseline/changes and uploads to that clinic's Drive binding even when browser is closed. Scheduling is pending; UI cannot declare daily backup active merely because Google connected.
7. Show verified archive time/lag/failures. Drive upload success is not database restore or sourceRPO proof.
8. Disconnect disables new job admission and removes clinic binding, preserving existing files. In-flight workers must recheck connection revision/owner authority before export/upload. Grant cleanup must account for the same Google grant used by multiple clinic bindings; revoking a shared grant blindly can disrupt other clinics. Ownership transfer requires reviewed reconnection; never silently transfer old owner's token.

## Backend adapters / routes still required

All clinic routes require short-lived clinic session verification AND authoritative active owner resolution (not a browser role/clinic ID, cached JWT role or service token alone). OAuth endpoints additionally require reviewed Origin/CSRF protection, exact redirect URI, safe return routing and session binding. Rate-limit connect, callbacks and manual jobs. Do not cache Auth/Drive callbacks, tokens or backup requests in service worker, offline queue or browser persistence.

Suggested contract, not deployed routes:

- GET /v2/clinics/:id/drive-backup: `{connected,lastBackupAt}` sanitized owner summary.
- POST .../connect: `{consentUrl}` only; secure state cookie/session binding as reviewed integration requires.
- OAuth callback: server exchanges code, stores encrypted binding, redirects to fixed Backups page with no token/code persisted in history/logs.
- POST .../disconnect: authoritative transactional disable/revision bump, credential cleanup job, `{connected:false,lastBackupAt:null}`.
- POST .../backup: owner-authenticated job admission; return status only after actual job evidence, or extend UI contract to show QUEUED/RUNNING explicitly. Current controller expects summary and must NOT mislabel enqueue as completion.

State store `create(hash,record)` must durably create without overwrite. `claim(hash,{userId,clinicId,now})` must atomically verify owner+clinic+expiry and consume once; wrong owner cannot consume another state. State/verifier never logged. Protect server session from OAuth login-CSRF; coordinator is not a complete HTTP security boundary.

Vault `saveEncrypted` is a required security boundary, not implemented encryption by this coordinator. It must encrypt using an independent backend key with user/clinic/version AAD and enforce fresh membership/connection fencing transactionally; never store plaintext refresh tokens. Token exchange/refresh must use reviewed Google OAuth client secret in backend secret store, validate granted scopes, refresh/revocation failures and offline-consent limitations. The google.cleanupUnstoredGrant adapter must check whether a grant is shared before any revocation and durably queue redacted follow-up on failure; the coordinator best-effort catch is not reliable cleanup by itself. Account email/subject verification and destination folder creation/binding are pending; UI intentionally shows no unverified Google identity.

## Archive/checkpoint distinction

Drive adapter is an encrypted ARCHIVE destination, not the existing four-method CAS checkpoint store. Do not wire it as `commitBackup.store` or emulate CAS via Drive filename/listing. A trusted authoritative export ledger must transactionally fence workers, persist generated file ID + exact encrypted candidate before first upload, record verified receipt, then advance committed source boundary. Crashes must resume same candidate/file ID; orphan uploads, duplicate grants, stale workers and object corruption need tested recovery. No such durable ledger, journal adapter or worker is implemented here. Google connection does not automatically enable access or exporter.

## Encryption / recovery

Existing backup core supplies gzip then AES-256-GCM with authenticated manifest; no plaintext patient upload path in archive API. Use clinic-scoped recoverable data keys, stored independently from Drive/Google refresh tokens with reviewed owner/key custody policy. Manifest/file name must not contain PHI. Owner needs a separately approved recovery procedure, not a key stored alongside the archive. Browser clinic password is not an encryption key. Actual key distribution/recovery/export and isolated DB restore remain pending.

## Activation gates

Google OAuth application/HTTPS origins/callback/consent configured; production session/CSRF/owner middleware; encrypted state/vault and connection/job schema manually reviewed; Drive folder and API transport/refresh adapters; source-consistent exporter/journal; trusted ledger; full v2 settings mount (P5/P6); disabled-until-tested schedule and alerts; real isolated restore, owner governance and explicit deployment authority. No personal-account suitability/compliance or Free availability guarantee is made. Test with synthetic records before any PHI.

## Local UI preview

`tools/drive-backups-preview` mounts the real staged card/controller with fixed synthetic access and no service. From repo root under supported Node, run:

```sh
node node_modules/vite/bin/vite.js --config tools/drive-backups-preview/vite.config.mjs --host 0.0.0.0 --port 4175
```

Owner sees the disabled connection card and setup explanation; doctor/front desk sees no backup controls. This preview does not authenticate to Google or clinic. Alternate preview build compiles the card without changing the legacy production entrypoint; output is scratch under .arena. Do not deploy this preview as the clinic app.
