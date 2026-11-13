# Staged token attendance commands

## Status and command shape

Extended `commitWorkspaceCommand` with a narrow specialized command:

```js
{ type: 'attendance', table: 'appointments', id: appointmentId,
  values: { action: 'arrive' /* or 'arrive-late' or 'no-show' */ } }
```

The existing staged store facade can pass this intent through its same guarded command method; no live screen/store/router/provider was changed. No token is issued, renumbered or recreated. Generic appointment status/token patches remain refused. No billing, consultation, cancellation/completion/in-room transition, team/settings or plan writes were enabled. Both flags remain OFF. No deployment/SQL/config/commit/tag/release or live clinical operation.

## Authorization and transition rules

Attendance retains namespace, current lease, exact active mirrored subject/role, Master expiry, known positive clinical licence, branch and patient/doctor reference validation from the atomic writer. It uses existing appointment:token capability. Owners/front desk may mark permitted doctors; doctors only their own tokens. Records must have an integer token1–999, an allowed explicit active branch, and be scheduled for the device-local current day. This follows the legacy local-day clock; clinic-specific timezone configuration and server-clock enforcement are NOT added or proven. Device clock is not server authorization.

Allowed states: booked, checked-in, no-show. Other states refuse. Repeating an unchanged arrive on checked-in, or no-show on no-show, refuses. arrive-late can explicitly mark a currently checked-in token late. Other-day attendance refuses rather than modifying historical/future queues. These conservative staged restrictions must be reviewed with future screen integration.

Patch generation reuses arrivalPatch/noShowPatch. Arrive restores a no-show using its existing token, with the helper's late note; ordinary arrivals after elapsed slot plus existing grace also get the marker. Explicit arrive-late uses the helper's forceLate option. No arbitrary caller patch/time/grace/branch/token/status fields are accepted.

An initial test showed the legacy helper can truncate a late marker when notes are already full. The staged writer now refuses WRITE_ATTENDANCE_NOTES_FULL if a required marker does not survive, rather than silently accepting lost late status. Legacy helper and live behaviour remain unchanged. Owner must review notes separately; the writer does not trim clinical notes automatically. Existing Postgres-style HH:mm:ss appointment values are accepted for attendance validation without changing the stored time. Basic booking's existing validation is otherwise unchanged.

## Durable semantics

The specialized intent becomes a normal scoped update operation with original base and generated patch, preserving FIFO replay compatibility. Atomic optimistic cache+outbox CAS, _offline stripping from source bases, stale-result checks, no blind retries and QUEUED-not-server-saved receipt are unchanged. No auto-flush, cache overwrite, token uniqueness guarantee or distributed atomicity claim. The staged facade remains responsible for post-ACK publication; existing replay/RLS are still authoritative remotely.

## Verification

Node22.22.0: **18 new attendance tests; full1051/1051 PASS**. Contributing/security/build/Pages exit0. Coverage: all3 roles, late/no-show restoration on same token, original FIFO bases, full-note refusal, terminal/current-state refusal, non-token/other-day/foreign-doctor refusal, forged fields/unknown action, licence and storage refusal, and continued generic status-patch denial.

Native Chromium145.0.7632.6 / Playwright1.58.2: **42/42 PASS**, zero non-harness requests (previous40 rerun +2 attendance scenarios). Native IndexedDB reload verifies no-show/late restoration retains token7, complete update bases and scoped queued source. Other-day and full-note refusal leave durable revision/cache/queue intact. Existing token is synthetically seeded, not issued by a new booking/token workflow. Auth/clinical responses remain synthetic. Server stopped.

Evidence: `tests/workspace-attendance.test.mjs`; `/home/user/workspace-attendance-unit.log`; `/home/user/workspace-attendance-node22-{summary,tests,contributing,security,build,pages}.log`; `/home/user/workspace-attendance-browser-tests.log`; `/home/user/workspace-browser-preparation/attendance-browser-results.json`.

Reproduce full Node checks via CHECK_LOG_PREFIX=workspace-attendance-node22 with verify-node22.mjs. With harness dependencies/Chromium installed, start server.mjs, run `RESULT_FILE=attendance-browser-results.json npm exec --yes --package=node@22.22.0 -- node verify-browser.mjs`, stop server afterwards. Harness allowlist adds token-policy and queue dependencies only; production CSP/contract/live entrypoints unchanged.

No actual real-clock/clinic-timezone, multi-device token flow, production RLS/Auth, React StrictMode/screens, other browser/mobile, actual quota/crash or hosted CI verification.

## Next gates

Specialized clinical/billing workflows and token issuance need their own reviewed invariants; no generic escape hatch. Reconciliation/PHI-retention policy, React ownership and lossless reviewed legacy migration/recovery remain necessary, followed by real trust/deployment validation before coordinated live cutover.
