# Owner Drive durable local repository — preparation only

## Delivered

`scripts/lib/v2-drive-local-repository.mjs` implements Linux local SQLite persistence for OAuth state and encrypted Drive connection grants. Integrates with existing OAuth coordinator, token bridge and Request/Response handler through their adapter APIs. It is NOT a Supabase migration, production authority mirror, deployed service or external backup destination.

Uses Node's builtin node:sqlite (experimental on declared Node22.22; version/platform qualification required). No dependency added. Linux tests explicitly skip on other platforms; no Windows support claim. Work remains on v2/account-trust-validation.

## Trust and provisioning

Provide an existing normalized absolute private0700 root owned by process UID, independent backend vault key map, active key ID and trusted clock. Root must be dedicated and not under repository/web/public/uploaded CI directories. Files are local drive-connections.sqlite plus SQLite WAL/SHM sidecars. Private0600 DB is created/checked; root/ancestors/sidecars must not be symlinks or accessible by other users. Checks are defense in depth, not a sandbox against privileged/same-UID pathname races. Use a dedicated account and reliable local filesystem; no network mounts/object storage/fuse assumptions.

SQLite WAL + synchronous=FULL + BEGIN IMMEDIATE provides transaction/lock handling. No lock stealing or custom pseudo-CAS. Busy database fails with sanitized error, not silent acceptance; caller can retry exact operation according to OAuth single-use semantics. SQLite owns its journal recovery. Tests cover actual persistence/reopen and simulated lock contention; real disk-full/power-loss durability has not been drilled. Database/root corruption or unavailable key fails closed. Deploying this on an ephemeral server/Edge Function would NOT provide durability; don't use it there.

### Critical local-fixture authority limitation

The local_owner_fixture table and setFixtureOwnerAccess method exist solely to exercise gates locally. They are not an authenticated/replicated Master membership system. No owners are seeded automatically. resolveOwner reads only explicitly provisioned synthetic fixture authority and expects an already authenticated backend session. **Never expose setFixtureOwnerAccess through an HTTP route/browser, or enable real PHI/Google connections using this table as production authority.** Production must replace it with reviewed authoritative membership and transactional fencing suitable for actual Master/clinical topology. This module does not modify either live project's schema/version/access flags.

## APIs

- stateStore.create(hash,record): checks fixture owner,43-character hashed-state key/verifier, future expiry <=10min against trusted clock; no overwrite. PKCE verifier encrypted using vault key with purpose/hash/owner/clinic/expiry authenticated data. Database stores hashed state and ciphertext, not raw verifier or raw state.
- stateStore.claim(hash,{userId,clinicId,now}): BEGIN IMMEDIATE, validates clock freshness, current owner, exact binding and authoritative expiry; authenticated decryption then single DELETE/commit. Wrong owner/clinic cannot consume another state. Replays return null. Lock/error rolls back. Clock argument is not authority; repo clock determines expiry.
- lookupCallbackClinic(hash,userId): read-only valid binding lookup, verifies current fixture owner/expiry; does not consume state. HTTP adapter hashes callback state first. purgeExpiredStates removes expired state only; no backup retention operation.
- vault.saveEncrypted: transactionally checks current fixture ownership; encrypts refresh token with independent codec, user/clinic binding and next connection revision; stores ciphertext only. No plaintext token/PKCE verifier bound into SQL storage. Connection state persists across reopen.
- vault.disconnect: checks owner; transactionally increments revision, disables and NULLs grant envelope, and invalidates clinic pending OAuth states. Existing Drive files are untouched. This does not securely erase historical ciphertext from SQLite WAL/pages, revoke Google grants, cancel in-flight Google calls, or clean backups. No jobs table is implemented, so there is no job admission to disable here; future worker must consult enabled/revision before work.
- repository.readAuthorizedConnection: encrypted connection record only while enabled and bound owner currently active. Token bridge independently authenticates/decrypts grant. replaceGrantIfCurrent checks owner+enabled+exact revision and validates new encrypted envelope before replacing+bumping revision in one transaction. Stale refresh cannot revive a disconnected connection.
- readOwnerStatus: owner-only connected summary, no token; verifies connected ciphertext is decryptable before healthy connection status. lastBackupAt is always null because no exporter/job evidence exists. A connection is never advertised as a completed backup.
- close: closes DB; operations after close fail. Keys are never persisted. Operator must independently back up/recover keys; copying SQLite without a consistent backup procedure is not a vault backup strategy.

Connection reconnect uses a monotonically increasing revision. Current coordinator/repo does not fence multiple pending consent attempts by newest intent: whichever valid callback completes last can replace the clinic connection. Before production add reviewed connection-intent fencing/account confirmation, shared-grant cleanup, OAuth session nonce binding and durable rotation failure recovery. Google grant revocation on disconnect remains separate and must account for sharing between clinics. Encryption key removal is not a substitute for correctly tracking/revoking provider access.

## Verification

21 Linux tests cover reopen, single consumption, expired/wrong-bound/replayed state, duplicate insert refusal, encrypted SQLite file contents, current membership checks, disconnect/reconnect fencing, two-handle claim and rotation CAS, permission/symlink guards, clock bounds, contention rollback, authenticated state tampering and lost-key status refusal. A local HTTP->real OAuth coordinator->SQLite encrypted-vault integration uses fake Google token exchange; callback303, replay refusal and reopened connected status are tested. No real Google account/token/request/PHI.

Run with supported Node:

```sh
node --test tests/v2-drive-local-repository.test.mjs
```

## Still pending

Production database/repository target and manually reviewed schema/privileges, authoritative membership/session/CSRF/rate-limit adapters, connection intent/account/folder binding, durable job/export ledger, source-consistent journal/exporter, scheduler/alerts, mounted v2 owner Settings, actual Google/hosted/isolation/restore acceptance. No live configuration, SQL or activation is performed by this preparation.
