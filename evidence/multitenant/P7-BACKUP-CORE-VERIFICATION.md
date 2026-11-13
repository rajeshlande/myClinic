# P7 offline backup core verification

Branch: v2/account-trust-validation. Parent31d25fa. Local-only continuation approved by user; keep only main and this branch.

## Executed

- Node22.22.0 / TZ=Asia/Kolkata: npm test1112/1112 pass, no failures/skips. Adds30 backup-core tests to prior1082.
- Staged-file contributing checks, static security checks, build and Pages readiness: pass.
- `node scripts/v2-backup-drill.mjs`: SYNTHETIC_IN_MEMORY_ONLY, ok=true, watermark1, restored counts patients1/appointments1, four negative checks passed, two dependency objects retained, zero requests.
- Core tests cover randomized encryption, GCM tamper/wrong-key/manifest refusal, hash/truncation validation, bounded decompression, rotated keys, project/schema pins, missing baseline/tail and duplicate/order rejection, contiguous transaction journal, upsert/delete/row identity, known-table validation, timestamp regression, safe retention dependencies, stale/future/malformed inventory refusal and lossy/cyclic JSON rejection.
- Entire chain is replayed into private local memory before result return; invalid late transaction exposes no partial result. No DB writes exist in core.
- Existing validation-only CI now runs the synthetic drill on both matrix OSes when hosted workflow eventually runs. Hosted/Windows execution of this change NOT yet performed.

## Not proved / intentionally absent

No real DB reads, SQL, source snapshot/commit journal, object uploads, durable checkpoint/ACK/retry/lock protocol, scheduled export, least-privilege credentials, account configuration, egress/capacity metrics, live alerts, production FK checks, actual database restore/RPO or combined /admin deployment. No production-readiness claim. Native synthetic browser suite was not rerun in this increment (prior43/43 remains historical); client code is unchanged.

Core is bounded per batch, in memory and single-string-row-ID only; aggregate chain resources and mappings require a trusted adapter. Full limits/risks are documented in docs/multitenant/P7-BACKUP-CORE.md. Manifest and inventory trust/key custody remain operator responsibilities.

No branch created, main changed, remote push/tag/deploy, secrets requested/configured or tenant activation performed. Original schema21 and separate Master repo untouched.
