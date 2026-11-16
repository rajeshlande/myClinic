# Clinic-specific private Drive folder binding

## Delivered locally

`scripts/lib/v2-drive-folder.mjs` adds a server-only Google folder transport and repository-backed coordinator. Local Linux SQLite repository now persists folder intent/verification and fences it to enabled owner connection revision. All Google calls in tests are mocked. No real folder/account/credentials, HTTP route activation or export job.

Work on v2/account-trust-validation only. Existing owner UI stays staged/unconfigured and live legacy app unchanged.

## Destination policy

Create an app-owned private My Drive folder named `Clinic encrypted backups`, with opaque clinic ID and random per-connection binding in appProperties. Name contains no clinic/patient names. The owner chooses the Google account during OAuth; this implementation does not expose arbitrary folder input or request broad Drive permission. Google identity/account subject display is still pending; owner choice is not yet independently displayed/verified in UI.

Folder metadata must match reserved ID, expected name, folder MIME, not-trashed, ownedByMe=true, shared=false, canAddChildren=true and exact purpose/clinic/binding markers. Shared, read-only, trashed or foreign/mismatched folders fail closed. These checks do not prevent the owner later sharing/deleting the folder or a privileged actor modifying it. Actual Google metadata/permissions behavior still needs live synthetic acceptance before use with PHI.

## Retry-safe sequence

1. Read freshly authorised enabled connection and snapshot owner+clinic+revision.
2. Read existing folder intent for exact revision. If absent, reserve Google file ID, then transactionally persist ID + random binding BEFORE attempting remote folder creation.
3. Concurrent reservations converge on first saved ID/binding; unused generated IDs have no created folder. Failure after remote create reuses same saved ID next time, including after local database reopen. Never discover destination by filename alone.
4. Create folder with that ID.409 is not success by itself. Read metadata and verify every policy/binding field. Always reverify even if local binding was previously verified.
5. Atomically mark verified only while current owner, enabled connection, revision and exact reserved ID/binding still match. Disconnect/reconnect/revocation/rotation races cannot return a stale verified receipt. Failed attempt may leave encrypted-app metadata/empty folder in owner's Drive; never automatically delete it to hide failure.
6. Return receipt containing folder ID/clinic/owner/revision/binding. It is a destination receipt, NOT an uploaded backup or restore proof. Future worker must use exact receipt and recheck fencing before export and subsequent upload stages.

Transport uses fixed Google HTTPS endpoints, bearer from mandatory backend token provider, redirect:error, no-store,10-second requests,16 KiB streamed metadata limits and sanitized errors. It is not reachable from browser directly and never returns tokens. No folder sharing/delete operation exists here.

## Local repository behavior

Additive `drive_folders` table is created only in local fixture SQLite root, NOT Supabase. Methods exposed under folders:

- readBindingIfCurrent checks active fixture-owner and exact enabled revision.
- reserveIfCurrent persists pending ID/binding under BEGIN IMMEDIATE; returns existing candidate on retry, null on stale authority/revision.
- verifyIfCurrent checks exact candidate and current authority, then stores backend verification time transactionally. Local timestamp is historical evidence, not everlasting permission certification.

Reconnect consent/disconnect drops local mapping. Remote folder/files are preserved, not deleted. Refresh-token rotation changes connection revision but keeps same Google grant/account: folder mapping revision is advanced atomically in the same encrypted-token CAS transaction. In-flight old-revision coordinator fails, then retries same candidate under new revision without duplicate folder. New consent always clears mapping even for same owner; it must not silently reuse prior account's folder.

There is no job repository, shared-grant cleanup, remote orphan cleanup or production membership mirror. Fixture owner table remains forbidden as production authority. Key/identity/connection corruption and revoked memberships must block future jobs rather than guessing another Drive account.

## Verification

21 new tests: reserve/creation pins, duplicate409 readback, shared/foreign/trashed/read-only/wrong-binding rejection, malformed/oversized metadata, persisted candidate across interruption+reopen, repeated verification, competing reservations, disconnect/revocation/reconnect fencing, rotation preserve/retry and receipt mismatch refusal. Existing21 repository tests rerun as focused regression. All use synthetic keys/fixture memberships/fake Google transport; no real upload/Google login or browser interaction.

## Remaining activation gates

Production authoritative connection/state/job ledger; actual Google identity/folder acceptance; export source/journal, persisted encrypted candidate/file IDs and verified upload watermark protocol; scheduler/retries/retention/alerts; session/CSRF/rate-limit wiring and mounted v2 owner Settings; actual offsite isolated DB restore. Full P7 and owner Google connection are still not activated by this increment.
