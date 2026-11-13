# P7 local operations status policy

## Delivered

`scripts/lib/v2-ops-status.mjs` provides a deterministic operator-only evaluator; `scripts/v2-ops-drill.mjs` runs five fixed synthetic scenarios. No network, scheduling, alert delivery, account configuration or flag changes. This work remains on v2/account-trust-validation.

The validation-only workflow now invokes the synthetic drill. Hosted CI execution is still unrun. The normal npm suite tests thresholds, stale/missing evidence, failed attempts, malformed timestamps, invalid measurements and policy overrides.

## API and default policy

`evaluateOperations({now,project,backup,probe,sync,restore,capacity,policy})` accepts project='master' or 'clinical', integer UTC epoch milliseconds, strict summary records and optional reviewed positive integer threshold overrides. It returns per-check status plus overall ALERT > UNKNOWN > OK. No token/error/record fields are accepted in summary observations. Error is always OPS_STATUS_INVALID_INPUT, without raw input.

Each backup/probe/sync/restore observation is null (unknown) or exactly `{lastSuccessAt,lastAttemptAt,lastAttemptOk}`. Last success may be null only when no success exists; a successful latest attempt must have lastSuccessAt equal to lastAttemptAt. A failed latest attempt ALWAYS alerts even if a previous success is recent. Future/inconsistent timestamps are rejected. Absence of evidence is never green. Failed first attempt is an alert, not a harmless unknown.

| Check | Default | Meaning / limitations |
|---|---|---|
| Backup freshness |24 hours |Age of verified committed backup completion. Does NOT measure age of restored source boundary/RPO or verify contents.|
| Database read probe |72 hours |Age of successful reviewed DB read. Free scheduling/availability not guaranteed.|
| Membership sync |1 hour |Provisional local alert target, NOT an accepted revocation SLA. Hosted token/cache/revocation design remains required.|
| Restore drill |30 days |Provisional re-test target. Only record success after real isolated restore/integrity/isolation acceptance, never after a synthetic test.|
| Capacity |400,000,000 bytes |Planned decimal400 MB warning. NOT verified account quota or automatic write-block threshold.|

Freshness checks alert when age > maximum; exactly at target is still within target. Capacity alerts when bytes >= warning threshold; measurements older than24h alert even when below threshold. Capacity freshness currently follows backupMaxAgeMs; this coupling is explicit and can be separated later if operational requirements differ. Missing capacity is UNKNOWN. A stale sample near/over threshold still alerts with MEASUREMENT_OVERDUE; raw byte value remains in output for operator context.

## Future trusted collection adapter (not implemented)

- Source summaries must come from authenticated monotonic operational records. This evaluator cannot validate provenance, signature, clock correctness or prevent a stale/forged success record.
- Backup success comes from verified committed checkpoint AND reviewed source-boundary integrity. Upload initiation/response is not completion. Monitor achievedRPO separately using the exported source boundary; last successful job time alone is insufficient.
- Probe success requires actual pinned project DB read and expected schema; HTTP landing pages, timeout/refusal/540 or schema drift are failures. Existing probe has sanitized codes; recording/mapping is not wired here.
- Sync success requires authoritative apply+ACK protocol, not browser cache or job enqueue. Emergency revocation and latest failure need separate event tracking.
- Restore success requires isolated database schema/rows/FKs/tenant checks with reviewed evidence; neither a valid encrypted object nor the local in-memory drill proves this.
- Capacity source must include an approved database/index size scope and account quota verification. No size SQL is executed/prepared by this increment.
- Use trusted UTC and detect source clock drift. Run scheduler more often than alert targets; missed collector execution must itself yield overdue/unknown, not reuse an evergreen green result.
- Alert dispatcher must be external to browser, have owner/channel acknowledgement, retry/dedup/recovery notification semantics and an alert-delivery drill. None is configured. Never print credentials or PHI. Do not auto-enable access, broaden grants, reset databases or purge queued work in response to an alert.

## Run

```sh
node scripts/v2-ops-drill.mjs
node --test tests/v2-ops-status.test.mjs
```

Runner accepts no real input/credentials, emits synthetic scenario statuses only and sends zero notifications. It intentionally exits successfully when expected ALERT/UNKNOWN scenarios are correctly detected; this is a test pass, not a live healthy report. A future live collector/CLI must fail appropriately on ALERT/UNKNOWN and use reviewed notification routing.

## Still pending

Live collectors, durable observations, scheduling, notification integration and delivery proof, backup/export source/provider, actual restore, accurateRPO/egress monitoring, combined hosting and all earlier trust/release gates. No operational SLA or complete P7 claim.
