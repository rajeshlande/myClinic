# Segment fit: what holds, and what is missing

**Audited build:** v1.12.0 · schema 11 · 305 tests · 4 Nov 2026
**Input:** the two segment briefs — *Single-Doctor Clinics* (12 challenges) and *Small Clinics*
(12 challenges), with their "SaaS solutions we can solve" lists.
**Method:** every row was checked against the code — a screen in `src/pages`, a policy in
`supabase/schema.sql`, a function in `src/lib` — not against the marketing copy. Where a
capability exists but is not what the brief promises, it is marked ◐ and the gap is named.

Legend: **✅ built** · **◐ partial** · **✗ missing**. Severity: **S1** blocks the sale ·
**S2** loses a deal on a comparison sheet · **S3** polish.

The capability IDs in your list (`POR-02`, `APP-16`, `AI-01`, `DGEN-16` …) come from a
catalogue I cannot see, so each is matched **by name**, not by ID. If an ID means something
narrower than the words beside it, the row below may be too generous — send the catalogue and
I will re-cut the mapping.

---

## 1. Verdict

| Segment | Fit today | What actually blocks it |
|---|---|---|
| **Solo / independent doctor** | **Strong on the daily loop, thin on evidence.** The appointment → token → consult → bill → day-close chain is real and offline-safe, and the patient can now be messaged on WhatsApp from the clinic's own number. | Compliance evidence (audit trail, consent beyond WhatsApp, retention/erasure, ABHA), an importer for the patients already on paper, and no AI layer at all. |
| **Small clinic** | **Fits a 2–3 seat clinic; breaks at the front desk.** Multi-doctor scheduling, billing handoff, role split and owner reporting are genuinely there. | Queue/priority lanes, roles beyond three, lab and pharmacy (absent entirely), branches, patient-facing status, and any audit trail. |

Scored against the two briefs as written: **3 of 24 challenges fully ✅, 13 partial ◐,
8 missing ✗** — Solo 3 ✅ / 7 ◐ / 2 ✗, Small clinic 0 ✅ / 6 ◐ / 6 ✗.

The 13 partials are the interesting number. Most are not "half a feature" — they are a real
feature with one named hole: billing without a price catalogue, history without attachments,
queue without a priority lane, roles without the other five. The gap table in §5 is written
so each hole can be closed on its own.

Compared with the v1.11.0 audit, the partials moved *up*, not across: day close, the booking
link, the medicine master, the front-desk trim and WhatsApp sending all landed in between.

---

## 2. Single-doctor clinics — challenge by challenge

| # | Challenge | Now | What exists | What is missing | Sev |
|---|---|---|---|---|---|
| 1 | Missed calls, after-hours enquiries | ◐ | Public booking page `/#/book/<slug>` with real slots and a cancel reference; the desk can send bookings, tokens and bills on WhatsApp (`messages.mjs`, 1.12.0) | No shared inbox, no missed-call capture, no AI front desk. A call that is not answered still leaves **no trace** | S2 |
| 2 | Diary drift, double booking, drifting follow-up fees | ✅ | One appointment engine (`schedule.mjs`), interval-accurate clashes, per-doctor `follow_up_fee_paise`, reschedule/cancel/no-show/undo, week load | External calendar sync; waitlist | S3 |
| 3 | Time lost typing notes and repeat prescriptions | ◐ | Structured consult, vitals with ranges, resume-in-progress, medicine master typeahead that fills dose/frequency/duration | **No "repeat last prescription"**, no AI scribe, no OCR, no ICD-10 templates, no favourite-phrases | S1 |
| 4 | History scattered across paper, photos, WhatsApp | ◐ | Patient 360: timeline, visits, prescriptions, billing, appointments, vitals grid, dues, unbilled-visit detection | **No attachments table** — a lab photo or a scan has nowhere to live; no lab-marker trends; no patient download beyond print/WhatsApp text | S1 |
| 5 | Manual billing, UPI screenshots, GST-exempt consult vs taxable medicine | ◐ | Per-line `tax_rate`, ₹0 consult + taxed medicines on one invoice, UPI QR with VPA, part payments, day close with variance and snapshot, missed-charge detector | **No service catalogue** (invoice lines are free text; `serviceCatalogue` exists only in the demo state), no split/advance/package, no refunds, no GST-return or e-invoice (IRN) export | S1 |
| 6 | NMC e-Rx, DPDP consent, ABHA, retention, audit, residency | ✗ | WhatsApp consent + opt-out (schema 11); numbered prescriptions `RX/26-27/0001`; versioned idempotent migrations | **No audit trail** (no actor column anywhere), no retention/erasure, no ABHA/ABDM fields, no residency or encryption evidence pack, no statutory registers beyond the H1 notice | **S1** |
| 7 | No-shows, weak recall, adherence | ◐ | Recall list, reminder queue with quiet hours, send log, and since 1.12.0 the message actually reaches WhatsApp | Drafts are not automatic; no dose tracker, no no-show recovery, no review nudge | S2 |
| 8 | Brand/generic/salt confusion, dose risk | ✅ | Offline formulary, duplicate-molecule/class detection, curated interactions, allergy check, H1 notice, acknowledged high-severity findings stored on the consultation | The formulary is hand-curated and small (~50 brands); no verified Indian drug database, no weight-based paediatric dosing | S2 |
| 9 | English instructions patients do not understand | ✅ | `rx-language.js`: 10 Indian languages, deterministic dose→instruction mapping, bilingual print, and now the same text on WhatsApp | No audio/voice instructions; documents other than the Rx are English | S3 |
| 10 | No IT staff, budget, lock-in fear | ◐ | Managed hosting, flat price, offline-first with outbox and conflict merge, single-file idempotent migrations, CSV export everywhere, static build (no server to maintain) | **No importer** (export only), no backup/DR evidence, no staging database, no written onboarding runbook | S1 |
| 11 | No website, booking, reviews, leads | ◐ | Public booking page on the clinic slug with an on/off switch, lead-source reporting ("Where the diary comes from") | No microsite or custom domain, no review nudge, no lead CRM or chatbot | S2 |
| 12 | After-hours non-clinical WhatsApp interrupting consults | ✗ | — | Nothing: no answering surface, no FAQ, no callback queue, no "we'll call you at 9" flow | S2 |

---

## 3. Small clinics — challenge by challenge

| # | Challenge | Now | What exists | What is missing | Sev |
|---|---|---|---|---|---|
| 1 | Queue chaos, no "when is my turn", unlogged overrides | ◐ | Per-doctor daily token sequence, call/serve/skip/requeue, waiting-room **display modal** (`Queue.jsx`), waited minutes, average wait on the dashboard | **No priority lane** — "Urgent / senior citizen" only writes a text note and the token keeps its number; no patient-facing live status; no wait analytics; no SMS/auto token alert (WhatsApp is manual) | **S1** |
| 2 | Front desk overloaded across phone, WhatsApp, web, walk-in, POS | ✗ | Web booking and manual WhatsApp sending | No shared inbox, no channel unification, no staff takeover, no POS | S1 |
| 3 | Multi-doctor / room scheduling, rosters, waitlists | ◐ | Per-doctor day board and week grid, rosters (`day_start`/`day_end`/`slot_minutes`), conflict prevention, undo | **No rooms**, no waitlist, no follow-up-window automation | S2 |
| 4 | Duplicate records; ABHA, consent, language captured inconsistently | ✗ | Unique patient `code`, search by name/phone/code, **WhatsApp consent + opt-out** (schema 11) | **No phone-number duplicate warning at registration**, no ABHA, no preferred-language field on the patient (the Rx language is chosen per consultation and forgotten) | S1 |
| 5 | Encounter → invoice → UPI/cash/split → receipt → day close leakage | ◐ | Encounter-to-invoice, exempt/taxable mapping, part payments, payment reference, UPI QR, day close with variance and a frozen snapshot, missed-charge detection | No insurance/TPA claims or pre-auth (insurance is only a payment method label), no packages or advances, no receipt numbering series of its own | S1 |
| 6 | Rights for 8 staff kinds, amendments, print/download audit | ◐ | Three seats enforced in RLS **and** the UI (schema 10/11), owner-only voids, `staff_guard()` | **5 of the 8 roles have no equivalent** (nurse, lab, pharmacist, billing-only, auditor/manager); no audit trail; no print/download logging; **no 2FA** | **S1** |
| 7 | Lab and pharmacy coordination | ✗ | Nothing. `medicine` is a prescription string; there is no inventory, no batch, no expiry, no FEFO, no lab request or result | The whole back office: lab catalogue, samples, results, report OCR; stock, batches, expiry, Schedule H/H1/X registers, dispensing | S1 for a clinic that owns a pharmacy — better to **skip** than half-build |
| 8 | Owner lacks live collection, doctor-wise revenue, wait time, peak hour, pending lab, branch comparison | ◐ | Revenue trend, payer mix, revenue by category, footfall, doctor performance, top diagnoses, appointment outcome, source, utilisation, daily collection — all with CSV export | No live (today, counter-wise) collection view, **no wait-time or peak-hour report**, no branch comparison, no custom report builder, no XLSX | S2 |
| 9 | Multi-branch inconsistency | ✗ | "branches" exists only as a seat limit (`PLAN_LIMITS`); every clinic is one branch | No branch entity: no per-branch pricelist, token series, taxes, languages | S2 |
| 10 | Opaque waits, no digital Rx download, no after-visit summary, no feedback | ✗ | Printable Rx/invoice, WhatsApp text of the slip, waiting-room display | No patient portal or app, **no public token-status page**, no after-visit summary, no feedback/NPS | S2 |
| 11 | Consent, DLT/WhatsApp, DPDP, ABDM, registers, audit at volume | ✗ | WhatsApp consent + send log | Everything else in Solo #6, plus **no DLT/SMS provider, no template registry, no ABDM** | **S1** |
| 12 | Migration, training, downtime, predictable cost | ◐ | Flat per-clinic price, offline-first, static hosting, one-file migrations, demo workspace for training | No importer, no staging database, no training material, no backup/restore drill | S1 |

---

## 4. The "solutions we can solve" lists, capability by capability

Matched by name. **Bold** rows are the ones a buyer will ask about first.

| Capability (from your briefs) | Status | The honest gap |
|---|---|---|
| Public booking / click-to-WhatsApp CTA | ✅ | Booking page exists; there is no click-to-chat widget on it — the CTA is the phone number |
| **Shared inbox, AI front desk, staff takeover** | ✗ | Nothing. This is a whole product, not a screen |
| **AI scribe, OCR, summarise** | ✗ | **No AI anywhere in the app** — no model call, no key, no prompt. Everything is deterministic today |
| Medicine autocomplete + stored Rx snapshots | ✅ | Formulary small; `rx_safety` snapshot is stored |
| 1-click ICD-10 templates | ✗ | Diagnoses are free text (`consultations.diagnosis`) |
| Patient 360, structured SOAP, lab trends, attachments | ◐ | 360 and SOAP yes; lab trends and attachments no |
| Service catalogue, exempt/taxable, UPI/cash/card, receipt, day close, missed charges | ◐ | Everything except the **catalogue** and a refunds path |
| Split / advance / package payments | ✗ | Part payments only |
| **Consent / opt-out, audit trail, retention / erasure, residency, encryption, registers, e-Rx, archive** | ✗ | Only WhatsApp opt-out exists. This is the single largest block of missing work |
| Reminders, recall, no-show recovery, dose tracker, review nudge, patient app | ◐ | Reminders and recall are real and now send; the other four do not exist |
| Managed hosting, flat price, CSV migration, onboarding, upgrades, backups/DR, export | ◐ | Hosting, price, upgrades and export are real; **import, backup evidence and a written onboarding are not** |
| Deterministic multilingual instructions | ✅ | 10 languages, deterministic mapping |
| Branded website, review nudge, lead CRM | ✗ | None |
| Token queue, priority lanes, TV board, call/serve/skip, wait analytics, SMS/WhatsApp token alerts | ◐ | Queue and the display modal are real; the priority **lane**, wait analytics and automatic alerts are not |
| Staff governance: RBAC, own-branch rules, immutable records, audit, 2FA, consent log | ◐ | RBAC yes (three roles); immutable/audit/2FA/branch rules no |
| Lab requests/results, batches, expiry, FEFO, drug registers, POS, referral, report OCR | ✗ | All of it |
| Ops dashboard, doctor-wise revenue, queue analytics, report builder, XLSX | ◐ | Dashboard and doctor-wise revenue yes; queue analytics, builder and XLSX no |
| Multi-branch config, template versioning, translations, live token status, portal, NPS | ✗ | All of it |
| Insurance / claims / pre-auth | ✗ | `insurance` is a payment-method string |
| Staging DB, role training, offline formulary | ◐ | Offline formulary yes; staging and training no |

---

## 5. What is missing, ranked by what it unlocks

### A · Absent modules — decide build or skip, do not leave undefined

| Module | Verdict |
|---|---|
| **Audit trail + retention/erasure + ABHA identity** | **Build.** It is the top of both briefs' compliance list and the only item that blocks a clinic with any legal help. Also the cheapest of the absent modules. |
| **Attachments** (lab photos, old Rx, scans) | **Build.** Challenge 4 is unwinnable without it, and "one patient record" is the product's whole claim. |
| Service catalogue | **Build.** Small: a table, a picker in the invoice form, and Day Close/reports read it. |
| Importer (patients, balances, catalogue CSV) | **Build.** Onboarding is "24–48 h" without it only if you do the typing. |
| Shared inbox / AI front desk | **Skip for now** — a channel product with its own compliance surface. The booking link plus WhatsApp sending covers the patient who finds you. |
| AI scribe / OCR / summarise / ICD templates | **Defer.** All four are review-and-apply UI work before they are model work, and the model is the easy half. |
| Lab / pharmacy / inventory | **Skip for Solo, and say so.** The brief agrees. |
| Insurance / TPA / claims / pre-auth | **Skip.** |
| Branches | **Skip** until a real customer needs it; Multi-clinic tier currently sells a promise the schema cannot keep. |
| Patient portal / app / live token status | **Build the token status page only** (one public route, one query). The app is a trap at this stage. |
| Feedback / NPS / review nudge | **Build the nudge**, skip the NPS dashboard. |

### B · Half-built — exists, but not what the brief promises

1. **Priority lane** — the urgent flag writes a note; the token still queues in number order. A lane is a second sequence per doctor-day plus a board sort.
2. **Duplicate detection** — the patient form will happily register the same phone twice. One warning at registration is enough.
3. **Preferred language** — chosen per prescription, never stored on the patient. A `patients.rx_language` column removes a question at every visit.
4. **Wait and peak analytics** — waited minutes are computed for the board and thrown away. Storing them per appointment gives the peak-hour report for free.
5. **Roles** — three of eight. Nurse (read chart, no money), billing-only (money, no chart), auditor (read everything, write nothing) are the three that pay for themselves.
6. **GST evidence** — the invoice is compliant; the *return* is not exported. IRN/e-invoice is a separate, later project.
7. **Backups/DR** — "it is in your Supabase project" is not evidence. One restore drill, written down.

### C · Cheap fixes still open from the last audit

`docs/PRODUCT-GAP-ANALYSIS.md` §11 ranks these; the first one is still unfixed and it is a
security claim in `docs/SECURITY.md`:

1. **Sign-out does not purge the local cache** (G1) — `store.signOutCleanup()` is defined and never called.
2. No E2E suite in the repo (the demo-door bug reached production because of this).
3. Postgres is not in CI, so "runs on a real Postgres" is proven on my machine, not yours.
4. No error boundary or diagnostics panel.
5. No linter; no Dependabot; no rollback runbook; tags still unverified on the remote.

---

## 6. If you build only six things next

Ordered by *deals unblocked per week of work*, not by size.

| # | Build | Why it is next | Size |
|---|---|---|---|
| 1 | **Compliance pack v1** — actor columns + `record_audit()` trigger on clinical/money tables, retention setting, per-patient export and erasure, `patients.abha_address` | Answers challenge 6 for both segments; nothing else on either list is asked for by a lawyer | M |
| 2 | **Attachments on the patient** — one table, Supabase Storage (or data URLs at first), thumbnails in Patient 360 | Makes "one patient record" true; also the substrate for lab-report OCR later | M |
| 3 | **Service catalogue + invoice picker + split payment** | Turns billing from "typed invoice" into "clinic's own price list", which is what a small clinic means by clean billing | M |
| 4 | **Registration guards** — duplicate-phone warning, preferred language, consent checkboxes beyond WhatsApp | Three small fields that fix challenge 4 and stop the duplicate-record problem at source | S |
| 5 | **Queue: real priority lane + public token-status page + wait/peak analytics** | The only queue differentiator a patient can *see*; wait analytics is one stored column plus one report | M |
| 6 | **Importer** — patients, catalogue, balances from CSV, with a dry-run preview | Removes the largest friction in onboarding, and it is the reason "24–48 h" cannot be promised today | M |

Everything else — AI scribe, lab, pharmacy, branches, insurer, portal, inbox — is a
**module decision**, not a gap to close quietly.

---

## 7. Where the product is already ahead of the brief

Worth keeping in the sales conversation, because the brief does not ask for them:

- **Offline-first with conflict merge** — a clinic on flaky wifi keeps working, money fields never merge silently, outbox replay is idempotent.
- **Public booking that locks the slot in the database**, not just the UI (partial unique index; a cancelled slot is re-sold, not deleted).
- **Day close with a frozen snapshot** — the sheet printed at 9 pm still matches tomorrow.
- **Missed-charge detection** — seen-but-not-billed, open bills, dues older than a week.
- **Prescription safety** — duplicate molecule, same class, curated interactions, allergies, H1 register notice, recorded acknowledgement.
- **Ten-language deterministic dosing** — not machine-translated at run time.
- **Role split enforced in Postgres**, not just hidden in the UI (schema 10).
- **WhatsApp that works without a BSP** — no template approval, no per-message cost, and an opt-out that is a column.
- **One idempotent SQL file** for the whole database, so a solo doctor can self-host.

---

## 8. Two commercial questions this analysis cannot answer

1. **Price.** The brief plans Starter at **₹2,999/month**; the app sells Solo at **₹999** with
   Growth ₹2,499 and Multi-clinic ₹5,999. Either the app is underpriced ~3×, or the brief is
   aspirational. Everything in §6 is sized against the app's own ladder.
2. **Sequence.** The brief sequences Solo first, and the code agrees — nine of its twelve
   challenges are in-product work, while the Small-clinic segment needs whole modules (lab,
   pharmacy, branches). If a small clinic is already paying, that changes the order; nothing
   in this document assumes one.
