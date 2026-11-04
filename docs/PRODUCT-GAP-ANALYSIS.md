# myClinic — Solo & Small-Clinic product gap analysis

**Audited build:** v1.11.10 · schema 10 · 287 passing tests · re-audited 2026-11-04
**First written:** v1.11.0 · schema 8 · 179 tests
**Method:** every status below is checked against the actual code, not the marketing copy —
routes in `src/App.jsx`, tables in `supabase/schema.sql`, and the screen that implements it.
Section 9 records what has closed since the first pass; sections 10–12 are the audit of the
build itself (defects, compliance, ops, test coverage), which the first pass did not cover.

Legend: **✅ built** · **◐ partial** (works, but not what the brief promises) · **✗ missing**

---

## 1. Verdict in one line each

| Segment | Fit today | What actually blocks the sale |
|---|---|---|
| **Single-doctor (Starter)** | Strong core, ~60% of the "administrative work per patient" promise is already real — **medicine master + prescription safety shipped in 1.8.0** | No outbound channel (reminders / booking link), no day-close, no compliance evidence pack |
| **Small clinic (Clinic)** | The *operational record* is genuinely unified (queue → consult → bill → report) | Lab/pharmacy absent, only 3 roles of the 8 needed, no audit trail, no room/branch entity, no patient-facing surface |

The brief's own sequencing is right: **Solo first**. Nine of its twelve challenges are
in-product work; the Clinic segment needs whole modules (lab, pharmacy, branches) that
should not be started while the solo product still has holes.

---

## 2. Solo / independent doctor — challenge by challenge

| # | Challenge (brief) | Status | What exists in this codebase | The real gap |
|---|---|---|---|---|
| 1 | Missed calls & after-hours enquiries | ◐ | Public booking page at `/#/book/:slug` (1.11.0): real slots from the same engine, patient captured by name and phone, a reference the patient can cancel with, and `source='online'` on the appointment | No WhatsApp intake, no shared inbox, no AI front desk. A call that is not answered still leaves no trace — the link only helps the patient who finds it |
| 2 | Diary chaos / double booking | ✅ | One `appointments` table drives Day/Week/List, conflict-aware slot generation (`schedule.mjs`), reschedule/cancel/no-show/undo, follow-up vs new fee (`feeForVisit`, per-doctor `follow_up_fee_paise`) | Waitlist, room/department field, external calendar sync |
| 3 | Time lost typing notes | ◐ | Structured consult (`ConsultationForm`): complaint, exam, diagnoses, advice, vitals with reference ranges, follow-up, resume-in-progress, history panel | No voice scribe, no OCR of paper/lab reports, no ICD-10 templates — the drug field is now a medicine-master typeahead with safety checks (1.8.0) |
| 4 | Scattered patient history | ✅ | `PatientDetail` 360: clinical timeline, visits, prescriptions, billing, appointments, vitals grid, dues, unbilled-visit detection, history preview inside the consult | Clinical attachments (no `files` table), lab-marker trends, patient-facing download |
| 5 | Manual billing / GST confusion | ✅ | Per-line `tax_rate`, discounts, part payments, `CollectPayment`, UPI QR with VPA (schema 5), compliant print with amount in words, **day close with per-method totals, cash variance and a frozen snapshot** (`day_closes`, 1.10.0), **missed-charge detection** (seen-not-billed / open bill / dues older than a week) | No advance or package payments, no refunds, no GST-return or e-invoice (IRN) export — the CSV is an invoice register, not a filing |
| 6 | Compliance anxiety | ✗ | Role matrix mirrored in RLS, offline outbox, versioned migrations, printable numbered invoices | **No consent log, no audit trail, no retention/erasure, no ABHA fields, prescriptions have no document number or version** |
| 7 | No-shows, weak recall | ◐ | `FollowUps.jsx` recall list **plus** the reminder queue (`reminders`, 1.10.0): one privacy-safe draft per patient, copy/WhatsApp actions, quiet hours, and a send log so nobody is chased twice | **Drafts, never automatic.** There is no BSP/SMS channel, no opt-out registry, no no-show recovery, no dose tracker, no review nudge |
| 8 | Medicine lookup & safety | ✅ | `MedicinePicker` + `medicines.mjs` (1.8.0): ~50-brand offline formulary, molecule/class duplicate detection, curated interactions, allergy check, H1 register notice, high-severity acknowledgement stored in `consultations.rx_safety` | Formulary is curated by hand and small; no external drug database, no paediatric weight-based dosing helper |
| 9 | Language gap | ✅ | `rx-language.js`: 10 Indian languages, **deterministic** dose→instruction mapping (not LLM free text), bilingual layout, WhatsApp-ready text | Delivery via WhatsApp/email HTML is still manual copy-paste |
| 10 | No IT staff / lock-in | ◐ | Managed hosting, flat tiers, offline-first with outbox + conflict merge, CSV export, single-file idempotent migrations | No guided importer (patients/balances), no backup/DR evidence, no onboarding wizard beyond `Onboarding.jsx` |
| 11 | Weak online presence | ✗ | — | No clinic microsite, no booking CTA, no review flow, no lead capture |
| 12 | After-hours questions | ✗ | — | No concierge / after-visit summary surface |

---

## 3. Small clinic — what the brief asks for vs what runs

| Capability | Status | Evidence / gap |
|---|---|---|
| Queue with tokens | ✅ | `Queue.jsx`: per-doctor daily token sequence, issue token, call/serve/skip/requeue, next-token preview. **No room, no priority lane, no TV board, no SMS token alert** |
| Omnichannel intake | ✗ | One table (good), but every write comes from the app — no website/WhatsApp/kiosk/POS channel |
| Multi-doctor scheduling | ◐ | Rosters (`day_start/day_end/slot_minutes`), per-doctor day board, conflict prevention. **No rooms**, no cross-doctor waitlist |
| Duplicate records | ◐ | Search by name/phone/ID/code, unique patient `code`, quick register. **No ABHA/mobile-first dedupe check** |
| Billing handoff | ✅ | Token → consult → invoice → collect → **day close** is continuous. Split/advance payments and refunds still missing |
| Roles & permissions | ◐ | Three seats (`owner / doctor / frontdesk`), now **enforced in RLS since schema 10 and mirrored in the UI** — a doctor cannot raise or settle a bill, the desk cannot open a note. Still missing: nurse, lab, pharmacist, auditor; **no audit log**, no print/download logging |
| Lab & pharmacy | ✗ | No test catalogue, samples, results, batches, expiry, Schedule H/H1/X registers, dispensing |
| Owner visibility | ✅ | `Reports.jsx`: revenue trend, payer mix, revenue by category, footfall, doctor performance, top diagnoses, appointment outcome, today's utilisation |
| Multi-branch | ✗ | `branches` exists only as a **seat limit** (`PLAN_LIMITS`); there is no branch entity, no per-branch pricelist/token series |
| Patient experience | ✗ | No portal, no live token status, no Rx/report download, no feedback loop |
| Compliance at scale | ✗ | Same gaps as solo, multiplied |
| Onboarding / migration | ◐ | CSV export everywhere; import, staging and role-based training don't exist |

---

## 4. The five things actually blocking a Starter sale (ranked)

Ranked by *administrative minutes removed per patient*, not by feature glamour.

| Rank | Build | Why it wins | Rough size |
|---|---|---|---|
| 1 | **Reminder + recall delivery** ✅ *queue shipped 1.10.0, delivery still manual* — draft T-24h/T-2h messages, preview, one-tap send, log what was sent | The recall engine already computes exactly who is due; today the list just sits there. Turns a dead screen into recovered revenue | S |
| 2 | **Day-close / cashier session** ✅ *shipped 1.10.0* — per-day collection by method, UPI/cash split, uncollected list, printable close | Directly answers "manual billing and reconciliation" (challenge 5). Finance-grade, no integrations | S |
| 3 | **Public booking link (`/#/book/:slug`)** ✅ *shipped 1.11.0* — real slots from the same engine, patient identity capture, cancel link | Answers challenges 1 and 11 together, and fills the appointment engine from outside the app for the first time | M |
| 4 | **Medicine master + autocomplete + safety** ✅ *shipped 1.8.0* — brand/generic/salt, dose defaults, offline formulary, interaction warning with logged override | Kills the biggest per-consult typing cost and the ch-8 safety risk | M |
| 5 | **Compliance pack** ✗ *still open — see §10* — audit trail, versioned consent, prescription numbering, retention settings, ABHA identity fields | The one thing a solo doctor cannot assemble alone, and the easiest to demonstrate in a sales call | M |

Everything else in the brief (AI scribe, WhatsApp AI front desk, patient app, TPA, lab,
pharmacy) is a **later add-on**, and the brief agrees ("Do not sell first").

---

## 5. Two commercial inconsistencies worth fixing before launch

1. **The price ladder does not match.** The brief plans Starter **₹2,999**, Clinic **₹6,999**,
   Clinic+ **₹12,999**. The app sells Solo **₹999**, Growth **₹2,499**, Multi-clinic **₹5,999**
   (`PLANS` in `logic.mjs`). Either the app is underpriced by ~3× or the brief is aspirational —
   pick one before the landing page and `Subscription.jsx` are shown to a customer.
2. **Tier names and seat limits disagree.** Brief: Starter / Clinic / Clinic+ with 4–10 doctors
   at Clinic. App: Solo / Growth / Multi-clinic, with Growth capped at **5 doctors + 3 front desk**
   (`PLAN_LIMITS`). A 7-doctor polyclinic falls between tiers today, and would be pushed to
   Multi-clinic — which has no multi-branch features to justify it.

Smaller mismatches: the brief treats `branches` as a real capability (Clinic+), but the schema has
no branch table; and "no per-user fee" is already true in code but never stated on the pricing page.

---

## 6. Where I'd push back on the brief

- **AI scribe before medicine master is the wrong order.** A wrong drug name costs more than a
  slow note. The medicine master is deterministic, offline-safe and cheap; the scribe needs review
  UX that doesn't exist yet.
- **"AI WhatsApp front desk" is a support business, not a feature.** It needs a BSP, DLT templates,
  opt-out handling per channel and a human-takeover inbox. Ship reminder *drafts* + click-to-send
  first; it delivers most of the value with none of the compliance surface.
- **Do not add lab/pharmacy for the Solo tier.** The brief already says this; the codebase agrees —
  adding inventory to a one-doctor clinic makes the product harder to sell, not easier.
- **Patient app is a trap at this stage.** A booking link and a printable/WhatsApp Rx cover ~80% of
  what patients actually ask for, at ~10% of the cost.

---

## 7. Proposed next three releases

| Release | Scope | Done means |
|---|---|---|
| **R1 · Collect & recall** ✅ *shipped 1.10.0* | Reminder drafts + send log · day-close session with per-method totals and uncollected list · missed-charge detector (completed visit without an invoice) | A solo doctor can close the day and chase yesterday's follow-ups without leaving the app |
| **R2 · Fill the diary from outside** ✅ *shipped 1.11.0* | Public booking page on the clinic slug · slot locking against the same engine · patient confirmation + cancel link · "booked from" source on appointments (lead-source analytics) | A patient can book at 11 pm; the doctor sees it in the morning with the source recorded |
| **R3 · Prescribe safely** ✅ *shipped 1.8.0* | Medicine master (brand/generic/salt) with offline fallback · dose defaults per form · interaction warnings with logged override · prescription numbering + immutable version | A repeat prescription is three taps and cannot silently contain a wrong salt |

Compliance pack slots in as **R4** once R1–R3 have made the daily loop sticky; it is the
easiest thing to *demonstrate*, but the hardest to sell before the product saves time.

> **Status (1.10.0, schema 7):** R3 shipped in 1.8.0 — offline formulary of ~50 brands with dose
> defaults, duplicate-molecule/class detection, curated interactions, allergy-vs-prescription checks,
> H1 register notice, high-severity acknowledgement recorded in `consultations.rx_safety`, and
> `RX/<fy>/<seq>` prescription numbers independent of invoices. R1 shipped in 1.10.0: day close with
> per-method collections, cash reconciliation and a frozen snapshot (`day_closes`); a missed-charge
> detector (seen-not-billed, open bills today, dues older than a week); and a reminder queue with a
> send log (`reminders`) that honours quiet hours and never re-chases the same patient twice.
> **Automatic delivery is still absent by design** — the queue drafts, the desk sends on its own
> WhatsApp number, and the log records what it did.
>
> **Status (1.11.0, schema 8):** R2 shipped. `/#/book/<slug>` is a real page: it reads the clinic's
> public profile and the doctor's *busy minutes* (never a patient), computes free slots with the same
> `availableSlots` engine the desk uses, and writes through five `security definer` RPCs granted to
> `anon`. `appointments.source` now carries `'online'` from the page through to Reports → *Where the
> diary comes from*, a cancelled slot is released by a partial unique index instead of a deleted row,
> and the patient keeps `BK-XXXXXX` to look the appointment up or cancel it. What is still missing
> from the outbound story: WhatsApp/SMS intake, a shared inbox for missed calls, and a reminder that
> sends itself.

---

## 8. Open questions for you

1. Is the ₹2,999 Starter price the target (which means the app's Solo tier is mispriced), or is
   ₹999 the real market entry and the brief is aspirational?
2. For reminders: SMS/DLT-compliance route, or WhatsApp click-to-send with the doctor's own number
   (no BSP, no template approval) to start?
3. Should the public booking page be on the clinic's own domain/subdomain, or a `myclinic.in/<slug>`
   link that we host? — *1.11.0 ships the second as `#/book/<slug>`; a custom domain is a hosting
   change, not a code change.*

---

## 9. What closed since the first pass (v1.11.0 → v1.11.10)

Checked screen by screen, not taken from the changelog.

| Item | First pass | Now | Where |
|---|---|---|---|
| Day close / cashier session | ✗ | ✅ 1.10.0 | `DayClose.jsx`, `day_closes`, owner-only since 1.11.9 (`day:close`) |
| Missed-charge detector | ✗ | ✅ 1.10.0 | `logic.mjs` (`missedCharges`), surfaced on Day close and Dashboard |
| Reminder queue + send log | ✗ | ✅ 1.10.0, delivery still manual | `reminders`, `logic.mjs` (`draftReminders`), quiet hours honoured |
| Medicine master + safety | ✗ | ✅ 1.8.0 | `medicines.mjs`, `MedicinePicker.jsx`, `consultations.rx_safety` |
| Public booking page | ✗ | ✅ 1.11.0 | `PublicBooking.jsx`, five anon RPCs, `appointments.source='online'` |
| Booking link live from clinic creation | ✗ | ✅ 1.11.5 | `create_clinic()` mints a slug, schema 9 backfills |
| Role matrix enforced in the database | ◐ | ✅ 1.11.6 (schema 10) | `consultations_read`, `invoices_*`, suite F in `schema-tests.sql` |
| Front desk loses the back office | ✗ | ✅ 1.11.9 | `permissions.js`, nav, derived Settings tabs |
| Subscription term (yearly lost) | — | ✅ 1.11.7 | `license.mjs` (`billingPeriod`, `extendPeriod`), RLS view |
| One demo door that actually opens the demo | — | ✅ 1.11.10 | `Landing.jsx` `enterDemo`, `tests/landing.test.mjs` |
| Staff invitations end to end | ◐ | ✅ 1.11.1 | `invites`, `accept_invite()` |
| Phone layout | ◐ | ✅ 1.11.2 | `responsive.mjs`, `tests/responsive.test.mjs` |
| Offline sync after a staff edit | ✗ | ✅ 1.11.4 | `offline.js` column repair |

**Still open from the first pass:** reminder *delivery*, refunds/advances/packages, GST
return and e-invoice export, audit trail, consent, retention/erasure, ABHA, lab, pharmacy,
branches, importer, patient portal, and the price-ladder question in §5.

---

## 10. Missing points in the build itself

The first pass audited the product against a brief. This section audits the *build*:
what it promises and does not do, what it does silently, and what would break in a real
clinic. Every row was checked against the current tree; the evidence column is the
grep or the file:line you can re-run.

Severity: **P0** data-loss or a false security claim · **P1** blocks a paying clinic or a
launch · **P2** degrades slowly · **P3** hygiene. Size: **S** ≤ half a day, **M** a day or
two, **L** a week or more.

### 10.1 Defects

| # | Gap | Sev | Evidence | Why it matters | Fix |
|---|---|---|---|---|---|
| G1 | **Signing out leaves patient data on the device.** `store.signOutCleanup()` is the only caller of `clearAllCache()`, and nothing in the app calls it — both sign-out buttons call `useAuth().signOut()` and stop there. | **P0** | `src/lib/store.jsx:575` (definition, never invoked outside the file) vs `src/components/AppLayout.jsx:226`, `src/pages/Settings.jsx:504`; `docs/SECURITY.md` remediation row claims *“purge on sign-out”* for finding 2 | A shared counter PC keeps up to 24 h of the whole clinic — patients, notes, bills — plus any queued writes, after the account is signed out. The 24 h TTL expires the *read*, not the *bytes* | S — call `signOutCleanup()` in both handlers (or a session-change effect in `StoreProvider`), and test that `clearAllCache()` ran |
| G2 | **The desk can still read the staff roster through the API.** `staff_read` is `is_clinic_staff(clinic_id)`, while the UI hides *Doctors & staff* from front desk since 1.11.9. | P2 | `supabase/schema.sql:500-502`; `src/lib/permissions.js` (`team:read`: owner, doctor) | Narrowed in the UI only; a front-desk token can still select the roster. Accepted at 1.11.9, still true | M — schema 11 narrows the policy; `tests/rbac.test.mjs` already fails on drift, so the SQL list must move with it |

### 10.2 Compliance (Indian OPD reality: DPDP Act 2023, clinical record keeping)

| # | Gap | Sev | Evidence | Why it matters | Fix |
|---|---|---|---|---|---|
| G3 | **No audit trail.** No `created_by`/`updated_by`/actor column exists anywhere; `audit` appears only in comments. | **P1** | `grep -n "updated_by\|created_by\|actor" supabase/schema.sql` → 0 hits; prescriptions carry a number and `rx_safety`, never a person | “Who changed this dose, and who voided this bill?” is unanswerable. Every compliance questionnaire asks it, and it is the one thing a small clinic cannot assemble alone | M — `updated_by uuid` + a `record_audit()` trigger on clinical and money tables, read surfaced per patient |
| G4 | **No consent record.** No table, no column, no screen. | **P1** | `grep -ril consent src supabase` → docs only | Public booking collects a name and phone with no notice; reminders message patients with no consent or opt-out on file | M — `consents` table (purpose, channel, granted_at, withdrawn_at) + a checkbox on booking and registration |
| G5 | **No erasure or retention path.** Patients can be archived only; `store.remove` is defined but never called from any screen. | P1 | `src/pages/PatientDetail.jsx:309` (“Archive patient”); `grep -rn "remove(" src/pages src/components` → 0 callers | A DPDP erasure request cannot be honoured, and there is no stated retention period for records that legally must be kept | M — retention setting per clinic, per-patient export, and an owner-only purge that keeps the minimum legal shell |
| G6 | **No privacy policy or terms in the product.** | **P1** | No `/privacy` or `/terms` route in `src/App.jsx`; signup and booking pages link none | Required before a public signup and before taking money; also the missing half of the DPDP notice obligation | S — two static pages, linked from the footer, booking page and signup |
| G7 | **No ABHA/ABDM, no e-invoice (IRN), no GST return export.** | P2 | `grep -ril abha src supabase` → docs only; the invoice CSV is a register, not a filing | Fine for a solo clinic today; becomes a blocker the moment a clinic wants ABDM incentives or files through software | L — separate integration, only after the core is paid for |

### 10.3 Security and abuse

| # | Gap | Sev | Evidence | Why it matters | Fix |
|---|---|---|---|---|---|
| G8 | **The five `anon` booking RPCs have no rate limit or challenge.** | **P1** | `schema.sql:2018-2022` grants execute to `anon`; `grep -i "rate.limit\|captcha" supabase/schema.sql` → none | Anyone can script `public_book` to consume a clinic's whole diary for a day, and can enumerate clinic slugs through `public_clinic_profile` | M — a per-IP + per-slug counter table inside the RPC, plus a minimum-form-time honeypot |
| G9 | **No CSP or security headers.** | P2 | `index.html` has no `http-equiv` CSP; GitHub Pages cannot set response headers | A single injected script in a build step would run with full access to the token in localStorage | S/M — a meta CSP (script-src self + Supabase origin), or move hosting behind a proxy that sets headers |
| G10 | **MFA and session lifetime are “configured outside the repo”, unvalidated.** | P2 | `docs/SECURITY.md:41` — status `needs_validation` | The owner account holds the whole clinic; nothing in the product or docs lets a clinic verify what is on | S — document the Supabase auth checklist, show MFA state on Settings → My account |
| G11 | **No dependency automation or static analysis.** | P3 | `.github/` contains only `workflows/`, `ISSUE_TEMPLATE/`, `pull_request_template.md`; no `dependabot.yml`, no CodeQL | `npm audit` runs on push, so a CVE is found after merge, not before | S — Dependabot (npm + actions) and CodeQL default setup |

### 10.4 Ops and deploy

| # | Gap | Sev | Evidence | Why it matters | Fix |
|---|---|---|---|---|---|
| G12 | **“Runs on a real Postgres” is not in CI.** `tests/schema.test.mjs` greps the SQL text; `supabase/schema-tests.sql` needs a live project or a psql harness that lives outside the repo. | **P1** | `tests/schema.test.mjs` header (“not a substitute for running the file”); `.github/workflows/ci.yml` has no service container | A schema release can be tagged with the SQL proven only on one machine — the failure mode that made 1.11.3 necessary | M — a `postgres:17` service job that applies `schema.sql` twice, then `schema-tests.sql` |
| G13 | **No end-to-end suite in the repo.** | **P1** | `tests/` is 13 `node:test` files, all pure logic or source-text regexes; `package.json` has no browser dependency | This is not theoretical: the demo-door regression reached production because its only proof was a throwaway Playwright script outside the repo | M — commit a Playwright smoke test (6 routes × 3 seats + the demo door) as `npm run test:e2e` |
| G14 | **No staging and no per-PR preview.** | P2 | `.github/workflows/pages.yml` deploys `main` only; CI runs tests, never serves the build | Every visual or routing change is first seen by real clinics | M — upload the CI artifact and preview it, or a second Pages environment on a `staging` branch |
| G15 | **No error monitoring and no error boundary.** | **P1** | `grep -rn "Sentry\|ErrorBoundary\|window.onerror\|unhandledrejection" src` → 0 hits | A white screen in a clinic is diagnosed by phone, from a user who cannot read a stack trace | S — an `ErrorBoundary` with a “copy diagnostics” block (version, schema, build id, last error) and one report endpoint |
| G16 | **No rollback runbook.** | P2 | `PUSH.md` documents the forward path only | When a deploy is bad at 9 am, the person holding the laptop needs one command, not a deduction | S — document revert-and-redeploy, and how to confirm the live bundle id |
| G17 | **Deploy-to-tag traceability is unverified.** `v1.11.7/.8/.9` never reached the remote (server error) and no run had been checked against a tag until 2026-11-04. | P2 | Remote tag list stops at `v1.11.6`; Pages run #7 published `be0711b` | “Which build is live?” must be answerable from the tag, the run and the bundle string | S — push tags `--atomic`, then compare the live `index-*.js` string to the tag |
| G18 | **No backup/restore evidence.** | P2 | No mention of Supabase backups or PITR in `docs/` | “Everything is in your Supabase project” is reassuring only if someone has restored one | S — document the tier's retention, and do one restore drill |

### 10.5 Engineering quality

| # | Gap | Sev | Evidence | Why it matters | Fix |
|---|---|---|---|---|---|
| G19 | **No linter, formatter or type checker.** | P2 | No `eslint`, `prettier`, `tsconfig`, `editorconfig`; devDependencies are `vite` and its React plugin only | Whole classes of bug — unused imports, a missing `await`, a typo'd prop — are caught by nothing before runtime | S — ESLint (react hooks rules first, which is where the real bugs are) |
| G20 | **Tests do not render components.** | P2 | 287 tests: pure functions plus source-text regexes such as `tests/rbac.test.mjs` matching JSX with `\.\.\.\(canEdit` | A regex over JSX breaks on reformat and proves nothing about behaviour; the derived Settings tabs are only asserted as text | M — `@testing-library/react` for the four screens that carry policy: Settings, Team, DayClose, Landing |
| G21 | **No bundle budget.** | P3 | `index-*.js` ≈ 493 kB, `react` ≈ 257 kB, `supabase` ≈ 214 kB, gzipped ≈ 136/81/55 kB | A clinic on 3G at 8 am feels every kilobyte, and nothing fails when it grows | S — fail CI above a threshold, or load `supabase` lazily |
| G22 | **Accessibility unaudited.** | P2 | 36 `aria-` attributes across 18 components; no focus trap or roving tabindex in `Modal`; no axe check anywhere | The desk operates this by keyboard all day; a modal that leaks focus is a real cost | M — a focus trap in `Modal`, `aria-live` on the token board, one axe run per screen |
| G23 | **Staff UI is English-only** while prescriptions cover 10 languages. | P3 | `rx-language.js` (10 languages) vs no i18n layer in `src/pages` | The doctor’s directions are multilingual; the front desk’s screens are not | M — extract strings, start with Marathi/Hindi for the desk |

---

## 11. Ranked: what to fix next

Ranked by *risk removed per day of work*, not by size.

| Rank | Gap | Why first | Size |
|---|---|---|---|
| 1 | **G1** sign-out purge | A security claim in `SECURITY.md` is currently false, and the fix is a two-line change plus a test | S |
| 2 | **G13** E2E smoke in the repo | The only defect that reached production this cycle was one no committed test could see | M |
| 3 | **G3** audit trail | The compliance pack the first pass ranked #5; it is also the thing that makes every later dispute answerable | M |
| 4 | **G12** Postgres in CI | “Runs on a real Postgres” is part of your definition of done, and right now CI does not check it | M |
| 5 | **G4 + G6** consent record and a privacy/terms page | Required before public signup and before taking money; the booking page already collects personal data | M |
| 6 | **G15** error boundary + diagnostics | Cheapest possible support tooling; turns “it stopped working” into a version, a schema and a stack | S |
| 7 | **G8** booking rate limit | The only public write surface, and it is unthrottled | M |

Cheap tail, all **S**: G9 (meta CSP), G11 (Dependabot + CodeQL), G16 (rollback note),
G17 (atomic tags), G18 (backup drill), G19 (ESLint), G21 (bundle budget).

---

## 12. Decisions still needed from you

These block work rather than describe it.

1. **Price ladder** — ₹999 / ₹2,499 / ₹5,999 in the app versus ₹2,999 / ₹6,999 / ₹12,999 in
   the brief (§5). Unchanged since the first pass; the pricing page goes live either way.
2. **Reminder channel** — WhatsApp click-to-send from the clinic’s own number (no BSP, no
   template approval, no opt-out registry) or an SMS/BSP integration with DLT templates.
   This decides G4’s consent model.
3. **G2** — accept the UI-only narrowing for the staff roster, or spend the schema 11 change
   to make the API agree with the screens.
4. **Booking host** — keep `#/book/<slug>`, or serve it from the clinic’s own domain
   (a hosting change, not a code change).

---

## 13. Verified working — do not re-open

Checked this pass because the audit is only useful if it also says what is fine.

- Offline cache is keyed per user **and** clinic, expires after 24 h at read time
  (`offline.js:115`), and the outbox is per user. **The purge exists — it is just not called
  (G1).**
- The service worker never caches `/rest/v1/` or `/auth/v1/`; only the shell and hashed
  assets (`public/sw.js`).
- Outbox replay is idempotent (client id + `client_id` uniqueness), so a retried create
  cannot duplicate a patient.
- 43 RLS policies; `staff_insert`/`staff_update` require the owner and refuse self-enrolment;
  `invoice_guard()` makes `void` terminal and reserves voids for the owner.
- The five public RPCs are `security definer` with execute revoked from `PUBLIC` and granted
  to `anon` explicitly (`schema.sql:2010-2022`).
- Waiting-room display exists (`Queue.jsx` → `WaitingDisplay`), so the “TV board” gap in §3
  is only TV-specific polish.
- CSV export exists on patients, billing, invoices, reports and day close.
- Day close stores a snapshot, so a printed sheet stays true after later invoices.
