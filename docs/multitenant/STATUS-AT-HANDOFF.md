# v2 plan review and current status

**Reviewed: 2 November 2026.** This is a current-status overlay on R4, the decision register, P0 readiness record and next-build-sheet §11–§36. Historical milestone descriptions remain historical. No implementation changes were made in this review.

## Executive verdict

**Substantial local implementation; NOT deployment-ready or approved for real clinical cutover.** The legacy v1.43.0/schema21 application is still the active code path. The v2 pieces are staged and uncommitted, not a completed integrated product. Test growth measures coverage of those pieces, not percentage completion of the release.

No change to Q1–Q5 or F1–F3 is proposed: Central invite/login, short-lived RS256 broker tokens, shared clinical database with tenant RLS, v2 migration and one-RPC booking fold remain the target. Manual SQL, deferred TPA, post-deployment custom domain and daily changed-row object backups remain the owner's execution choices. Later explicit requests authorized local increments; they did not authorize deployment/activation/commits or replace the production gates.

## Verified now vs historical evidence

### Freshly checked in this review

- Clinic HEAD remains `b1e174ee00abc6b533e364fa578b5b017802c2d2`, package1.43.0; v2 changes remain uncommitted.
- Node22.22.0 full clinic **1057/1057 PASS**; contributing **28/28**, no warnings; security/build/Pages exit0. Logs: `/home/user/workspace-status-review-node22-*.log`.
- No tracked diff in live App/main/store/Auth/Supabase/Setup/public-booking entrypoints checked. Staged store/review-panel modules are not imported by the live entrypoints.
- Tier-contract SHA256 remains `36c6af2bfe0ba7b82d9f9d240ef3aff1330539e82b1538169a0b66d1b2a96ea1`.
- Both repositories contain uncommitted preparation. Clinic status has60 entries, including two recurring mode-only audit-script hydration artifacts; that is not60 functional changes. No cleanup/commit performed here.

### Latest retained evidence, not rerun in this review

- Chromium145.0.7632.6 / Playwright1.58.2: **43/43 PASS**, zero non-harness requests. Synthetic Auth/clinical responses; native IndexedDB/Web Locks. `workspace-browser-preparation/replay-barrier-browser-results.json`. Synthetic server stopped after that run.
- Master local SQL upgrade/reapplication, legacy preservation, boot membership isolation and mutation checks PASS. Last recorded Master app139/139 and contributing26/26, plus Deno adapter checks; not rerun here.
- Clinical consolidated schema22 local install/reapply/refusal: **180 cross-tenant operation/role checks** plus supplemental and policy mutation tests PASS. Two-database membership/licence sync interleaving suite PASS. These are local SQL results, not proof of real gateway/token/RLS integration.

### Live state is not freshly verified

No account/dashboard/live database/connector query was made. Clinical schema22/accessfalse was owner-reported earlier; prepared Master mint_enabled and clinical tenant_access_enabled defaults are OFF. Their current deployed values must be verified before any enablement. Do not present source defaults or historical reports as fresh live observations.

Project mapping stays: Master `inaqzvzfongngahxptzw`; new clinical `kvxmcdezpozkvdmvmicr`; original populated schema21 `nosqdnmnztsikfygyiqa` is preserved, never reset/deleted by this plan. Actual active Free-project inventory remains unverified; these three known references must be reconciled with the two-project target without assuming all are active or deleting the original.

## R4 phase assessment

| Phase | Current status | Remaining acceptance gate |
|---|---|---|
| P0 account/trust feasibility | **Not signed off.** Local Node/toolchain issue resolved; TPA/account checks deferred. | Actual Free project inventory/limits, asymmetric-token gateway acceptance, issuer/uid enforcement, current platform/account terms and capacity/operations checks. |
| P1 Master schema5 | **Prepared and locally tested.** Additive schema, isolation, boot wrapper and legacy compatibility. | Install/review actual delivered addenda, verify deployed state and real caller access. |
| P2 broker/discovery/JWKS/mint | **Implemented locally, not production-proven.** | Real deployment/key configuration, HTTPS discovery/JWKS, minted token acceptance, rotation overlap/revocation tests. |
| P3 TPA + memberships | **Partial.** Admin-triggered sync/provisioning locally tested; TPA deferred. | Real trust integration, signup configuration, scheduled authenticated sync, retry/alerting/emergency revocation and live consistency. |
| P4 clinical schema22/RLS | **Prepared with strong local isolation tests.** Earlier install owner-reported. | Confirm exact deployed bundle/addenda and project identity; real gateway issuer/role/member denial suite before activation. |
| P5 v2 frontend | **Substantial inert foundations, incomplete integration.** | Master login/router, all clinical callsites, remaining specialized workflows, public booking fold, full UI/StrictMode/mobile/sidebar, legacy migration and reconciliation. |
| P6 Master /admin | **Not complete.** Backend scaffolding is not operator UI. | Directory/invite/role/licence/rotation/activity UI, clinic-user isolation, combined-origin/service-worker behaviour. |
| P7 delivery/operations | **Partial local checks only.** Legacy build/Pages pass; SW API exclusion prepared. | Combined / + /admin build, two-env-only release, production CSP/origin, hosted CI/clean clone, jobs/alerts and coordinated v2/schema release. Domain follows owner's post-deployment sequence. |
| P8 pilot | **Not started.** | Restore/540 drills, size/egress/RPO evidence, governance and rollback rehearsal before real PHI/pilot. |

No full P0–P8 phase should be called production-complete solely because an inert implementation or local suite exists.

## What the staged frontend actually contains

Tenant token/client core; one-RPC boot parser; workspace controller/picker; React gate and operation bridge; current-snapshot leases; clinic-scoped outbox adapter; scoped IndexedDB revision-CAS cache/queue/conflict envelope; origin-wide lifecycle and limited explicit cleanup recovery; guarded replay; clinical snapshot loader; atomic patient/basic-booking edits; external-store command/publication facade; owner local-conflict discard review; fresh SELECT comparison and standalone DOM review panel; specialized arrive/arrive-late/no-show commands.

The live StoreProvider and legacy outbox have NOT been replaced. Token issuance, consultation/prescription/follow-up writes, billing/payments/voids/day-close and team/settings workflows are not completed by those staged commands. The standalone conflict panel is not a mounted React review route.

## Main findings / blockers

1. **Reconciliation safety now deliberately halts.** Replay stops at the first conflict and preserves the queue tail; existing conflicts block further sends. Current discard-only review refuses ordinary queued work. Thus conflict+queue is safely preserved but cannot yet be resolved through the current review flow. A whole-workset, revision-bound review with retention policy and fresh comparison is the next concrete client-engine gate. Do not bypass the blocker or retry tail operations blindly.
2. **No complete lossless legacy migration.** Existing localStorage PHI/legacy queues are untouched. v2 scoped storage does not itself migrate or remove that PHI. Migration requires inventory, mapping, verification, pending-work preservation and rollback/recovery review.
3. **Real trust remains unproven.** Local claims checks, SQL isolation and synthetic browsers do not establish actual hosted Custom OIDC/TPA, `auth.uid()`, issuer enforcement, JWKS rotation or token revocation behaviour. D2 remains a real activation blocker; no workaround login/anonymous fallback is acceptable.
4. **Frontend workflow completeness is still substantial work.** Building more safe core modules is useful, but it is not equivalent to migrating all legacy screens/callsites. Use an explicit workflow matrix before wiring so unsupported functions cannot silently fall back to v1/static clients.
5. **R4 scalability requirements are not yet met by the loader.** R4 asks for explicit columns/no full-table reads; staged loader/comparison use SELECT * and loader reads whole scoped tables with500-page requests,20-page/10k safety limits. Count validation prevents silent truncation, not excessive egress or large-clinic readiness. Need a field inventory and paged/incremental store design before scale claims. Fresh comparison is bounded to50 conflicts and is not a server transaction.
6. **Operational safety is not delivered.** Daily compressed/encrypted changed-row object exports,30-day retention/~24h RPO, executed restore drill, keep-alive DB reads, 540 alerts, size/egress monitoring, scheduled sync/revocation and rollback rehearsal remain gates. No paid backup/SLA guarantee is implied.
7. **Documentation has accumulated historical contradictions.** Early build-sheet/P0/decision passages still say marker-only/no schema work/Node unavailable or list older test counts. They are superseded by later user-authorized milestones, not current prohibitions or current readiness claims. Source defaults OFF are not live verification. This status overlay is the current index; original records remain for provenance.

## Recommended revised execution order

1. **Pause new domain expansion briefly.** Make a workflow/acceptance matrix for v2 screens and define reviewed whole-workset reconciliation and PHI retention/export before adding further generic write capability. Preserve conflict+queue work until that path is proven.
2. Implement/test bounded reconciliation under stale/CAS/cross-tab/partially-applied-server cases. No automatic discard/rebase. Retain explicit human confirmation and original source operations.
3. Complete specialized domain commands and a reviewed legacy migration strategy; pair each with invariants and UI ownership/StrictMode tests. Address loader pagination/field/egress design alongside it.
4. With explicit owner authority, resume real account/TPA/deployment prerequisites; verify exact project/bundle state, trust, signup/mirror/revocation and rotation. D2 is not silently lifted by local work.
5. Wire login/router/store/callsites and booking fold only behind verified dependencies; complete /admin and merged-origin build/security behaviour. Prove no fallback and old-workspace PHI exclusion across real UI navigation.
6. Configure/run backups/restore/keep-alive/alerts/governance and rehearse rollback. Only then authorize flags, pilot and coordinated v2/schema cutover. Domain remains after deployment per D3.

## Stop/go

**GO:** further reviewed local, inert work and tests.

**NO-GO:** live activation, broad data migration/deletion, v2 production release or real-PHI cutover. Current test evidence does not waive the gates above. No commit/tag/deploy/live DB action is authorized by this review.
