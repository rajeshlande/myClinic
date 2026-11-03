# myClinic — Solo & Small-Clinic product gap analysis

**Audited build:** v1.7.0 · schema 5 · 88 passing tests
**Method:** every status below is checked against the actual code, not the marketing copy —
routes in `src/App.jsx`, tables in `supabase/schema.sql`, and the screen that implements it.

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
| 1 | Missed calls & after-hours enquiries | ✗ | `Landing.jsx` is a marketing page; no public booking route | No booking link, no WhatsApp intake, no shared inbox, no AI front desk. **Zero outbound surface.** |
| 2 | Diary chaos / double booking | ✅ | One `appointments` table drives Day/Week/List, conflict-aware slot generation (`schedule.mjs`), reschedule/cancel/no-show/undo, follow-up vs new fee (`feeForVisit`, per-doctor `follow_up_fee_paise`) | Waitlist, room/department field, external calendar sync |
| 3 | Time lost typing notes | ◐ | Structured consult (`ConsultationForm`): complaint, exam, diagnoses, advice, vitals with reference ranges, follow-up, resume-in-progress, history panel | No voice scribe, no OCR of paper/lab reports, no ICD-10 templates — the drug field is now a medicine-master typeahead with safety checks (1.8.0) |
| 4 | Scattered patient history | ✅ | `PatientDetail` 360: clinical timeline, visits, prescriptions, billing, appointments, vitals grid, dues, unbilled-visit detection, history preview inside the consult | Clinical attachments (no `files` table), lab-marker trends, patient-facing download |
| 5 | Manual billing / GST confusion | ◐ | Per-line `tax_rate` (consultation ₹0 + medicines taxed on the same invoice), discounts, part payments, `CollectPayment`, UPI QR with VPA (schema 5), compliant print with amount in words | **No day-close / cashier session**, no advance or package payments, no refunds, no GST-return/e-invoice export, no missed-charge detection |
| 6 | Compliance anxiety | ✗ | Role matrix mirrored in RLS, offline outbox, versioned migrations, printable numbered invoices | **No consent log, no audit trail, no retention/erasure, no ABHA fields, prescriptions have no document number or version** |
| 7 | No-shows, weak recall | ◐ | `FollowUps.jsx` — overdue/due/next-7-days recall list, mark-done, dashboard surfacing | **Nothing is ever sent.** Reminder settings exist but there is no delivery channel. No no-show recovery, no dose tracker, no review nudge |
| 8 | Medicine lookup & safety | ✗ | Free-text drug name + 5 templates | No brand/generic/salt typeahead, no dose defaults, no interaction alerts, no offline formulary |
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
| Billing handoff | ✅ | Token → consult → invoice → collect is now continuous (save & bill opens the invoice). Day-close and split/advance payments still missing |
| Roles & permissions | ◐ | `owner / doctor / frontdesk` only — the brief needs reception, doctor, nurse, lab, pharmacist, billing, manager, auditor. **No audit log, no print/download logging** |
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
| 1 | **Reminder + recall delivery** — draft T-24h/T-2h messages, preview, one-tap send, log what was sent | The recall engine already computes exactly who is due; today the list just sits there. Turns a dead screen into recovered revenue | S |
| 2 | **Day-close / cashier session** — per-day collection by method, UPI/cash split, uncollected list, printable close | Directly answers "manual billing and reconciliation" (challenge 5). Finance-grade, no integrations | S |
| 3 | **Public booking link (`/#/book/:slug`)** — real slots from the same engine, patient identity capture, cancel link | Answers challenges 1 and 11 together, and fills the appointment engine from outside the app for the first time | M |
| 4 | **Medicine master + autocomplete + safety** — brand/generic/salt, dose defaults, offline formulary, interaction warning with logged override | Kills the biggest per-consult typing cost and the ch-8 safety risk | M |
| 5 | **Compliance pack** — audit trail, versioned consent, prescription numbering, retention settings, ABHA identity fields | The one thing a solo doctor cannot assemble alone, and the easiest to demonstrate in a sales call | M |

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
| **R1 · Collect & recall** | Reminder drafts + send log · day-close session with per-method totals and uncollected list · missed-charge detector (completed visit without an invoice) | A solo doctor can close the day and chase yesterday's follow-ups without leaving the app |
| **R2 · Fill the diary from outside** | Public booking page on the clinic slug · slot locking against the same engine · patient confirmation + cancel link · "booked from" source on appointments (lead-source analytics) | A patient can book at 11 pm; the doctor sees it in the morning with the source recorded |
| **R3 · Prescribe safely** ✅ *shipped 1.8.0* | Medicine master (brand/generic/salt) with offline fallback · dose defaults per form · interaction warnings with logged override · prescription numbering + immutable version | A repeat prescription is three taps and cannot silently contain a wrong salt |

Compliance pack slots in as **R4** once R1–R3 have made the daily loop sticky; it is the
easiest thing to *demonstrate*, but the hardest to sell before the product saves time.

> **Status (1.8.0, schema 6):** R3 is built and verified — offline formulary of ~50 brands with
> dose defaults, duplicate-molecule/class detection, curated interactions, allergy-vs-prescription
> checks, H1 register notice, high-severity acknowledgement recorded in `consultations.rx_safety`,
> and `RX/<fy>/<seq>` prescription numbers independent of invoices. R1 and R2 are still open; the
> reminder card in Settings still has no delivery channel, which remains the single largest gap
> for the *Starter* promise.

---

## 8. Open questions for you

1. Is the ₹2,999 Starter price the target (which means the app's Solo tier is mispriced), or is
   ₹999 the real market entry and the brief is aspirational?
2. For reminders: SMS/DLT-compliance route, or WhatsApp click-to-send with the doctor's own number
   (no BSP, no template approval) to start?
3. Should the public booking page be on the clinic's own domain/subdomain, or a `myclinic.in/<slug>`
   link that we host?
