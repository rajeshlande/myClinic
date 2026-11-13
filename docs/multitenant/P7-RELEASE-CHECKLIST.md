# P7 release checklist and operational runbook

All unchecked items block the relevant release/operational claim. This document does not authorise account changes.

## Build / hosted delivery

- [ ] P1 Master5/addenda verified; P2 broker/keys; P3 trust/mirror/scheduling; P4 allowed+denied hosted isolation. Retain exact project/ref/SQL/code versions in redacted evidence.
- [ ] P5 supported workflows/reconciliation/migration and P6 operator UI integrated; no legacy-client/anonymous fallback.
- [ ] Reviewed Master source version available; build root clinic + /admin into one immutable artifact. Check root/subpath deep links, shared assets and hash routing.
- [ ] Verify only intended Central public env inputs are used by v2; no privileged credentials in any frontend/source map/artifact. Dynamic descriptor from authorised boot, not hardcoded clinical config.
- [ ] Production CSP/connect-src/origins/HTTPS verified without test-only allowances. Exactly one clinic SW; no /admin/sw.js registration; Auth/REST/functions uncached.
- [ ] Hosted validation workflow passes on Linux/Windows and synthetic Chromium. Existing legacy build success is not combined-v2 acceptance.
- [ ] Clean clone + npm ci reproducible; exact artifact and evidence hashes recorded. No v2/schema version bump until actual reviewed cutover change.
- [ ] Explicit deployment approval. Existing pages.yml remains unchanged in this preparation.
- [ ] Domain after deployment per owner choice: DNS/CNAME/TLS and both route roots verified. No claim domain already configured.

## Keep-alive / pause response

- [ ] Select authorised least-privilege operator/service access and schedule (planned DB read every<=3 days). Validate actual project/Free terms; scheduled CI can be delayed/disabled and offers no uptime guarantee.
- [ ] Alert channel and owner tested. Future probe mode can identify540, read refusal, network failure and schema drift; it is not configured/scheduled here.
- [ ] A probe must read the DB, not just /auth or function metadata; never invoke side-effecting license_state as a healthcheck.
- [ ] On540: notify operator, identify affected project, inspect Dashboard and follow manual restore/unpause procedure. Do not reset DB, create replacement project, fall back to demo or automatically enable flags.
- [ ] On401/403: treat as credential/grant/config failure; do not broaden grants automatically. Rotate compromised credentials through an approved process, never log them.
- [ ] On unexpected schema: block readiness and inspect exact installed addenda, not blind reapply.

## Capacity / egress / operational state

- [ ] Inventory current table/index sizes and growth rates, export/query egress and pilot load. Current13 MB is only a reported point-in-time size.
- [ ] Planned400 MB alert and response threshold with actual account quota verified. Define controlled admission/write handling, not a promise the platform will enforce a particular app read-only mode.
- [ ] Egress dashboard and source pause/sync/backup lag monitored; synthetic alarm delivery/drill evidence retained.
- [ ] Authenticated membership-sync retries, stale-ACK handling, emergency revocation and token/JWKS cache windows rehearsed.
- [ ] External export/retention/encryption and isolated restore contract executed; see P7-BACKUP-RESTORE-CONTRACT.md.

## Rollback / release approval

- [ ] Record baseline code (legacy b1e174e), current prepared branch b0d90f7 lineage, reviewed schemas and external backup boundary. Baseline checkout alone is not data rollback.
- [ ] Define handling for all post-cutover writes, unsent queue/conflicts, migrated PHI and revoked memberships. Never roll back by discarding work.
- [ ] Rehearse in isolated synthetic environment with flags OFF; prove old/new client compatibility or planned maintenance boundary. Do not install legacy schema21 over clinical22.
- [ ] Owner PHI/governance/retention sign-off, known Free limitations and support ownership recorded.
- [ ] Release operator authorises exact artifact/SQL/config and pilot scope; flags changed only by approved sequence, not by build success.

## Evidence record template

```text
Check ID:
Environment/project ref:
Code/SQL/artifact hash:
Authority/action:
Time and operator:
Expected result / actual result:
Redacted evidence location:
Pass/fail and unresolved risks:
Rollback/next action:
```

Never attach bearer tokens, private keys, .env dumps or patient records to CI/public tracker evidence. The validation workflow uploads only synthetic result JSON, not production bundles/environments or PHI.
