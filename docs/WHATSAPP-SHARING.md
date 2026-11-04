# Sending the token, the appointment, the bill and the slip on WhatsApp

**Plan, written against v1.11.10 · schema 10 · phase A shipped in v1.12.0 · schema 11.**
Status of every claim below was checked against the code, not the marketing copy.

> **Shipped (1.12.0).** Answers taken: **A · click-to-send**, **text summary only**,
> **consent now**. `src/lib/messages.mjs` builds the token, appointment, invoice and
> prescription messages; `src/components/MessageSheet.jsx` is the one composer; schema 11
> adds `patients.wa_opt_in` / `wa_opt_out_at` and widens the log to all five kinds. Buttons
> sit on the queue rows, the day board and list, the invoice toolbar and the prescription
> toolbar. Verified: 18 unit tests in `tests/messages.test.mjs`, seven SQL suites including
> the new *WhatsApp consent and the message log*, and a browser run over all four messages
> plus an opted-out patient. Sections 4–5 below are still the open decisions for phase B.

The ask: a patient should be able to receive, on WhatsApp, their **token number**, their
**appointment details**, their **invoice**, their **prescription**, and the **reminder** the
clinic already drafts.

---

## 1. What already exists (and what does not)

| Message | Today | Where | Missing |
|---|---|---|---|
| Reminder (appointment / recall / balance) | ✅ drafts, copy, **WhatsApp**, mark sent, send log | `docs` → `daybook.mjs` `reminderDrafts()`, `FollowUps.jsx:107` `openWhatsApp`, `reminders` table | Nothing for this release |
| Booking confirmation | ✅ the patient shares it to themselves | `public-booking.mjs:529` `whatsappShare()` | The desk cannot send it *to* the patient |
| Invoice | ◐ **copy only** — “Invoice summary copied — paste it into WhatsApp” | `InvoiceView.jsx:87` | No phone, no `wa.me` link, not logged |
| Prescription | ◐ **copy only** — “Copy for WhatsApp” | `PrescriptionView.jsx:47-74` | No phone, no `wa.me` link, not logged |
| Token number | ✗ nothing at all | `Queue.jsx` issues and displays tokens | No patient-facing message anywhere |
| Appointment details (beyond a reminder) | ✗ | — | No “here are your details” message from the desk |

So three of the five asks are missing outright and two exist as copy-only dead ends. The
transport already in the app is **`wa.me` click-to-send** (`daybook.mjs:425` `whatsappLink`),
which needs no BSP, no template approval, no server, and works from the desk's own WhatsApp.

---

## 2. Two ways to do this — pick one before code is written

| | **A · Click-to-send (`wa.me`)** | **B · WhatsApp Cloud API** |
|---|---|---|
| How it works | The desk taps **Send**, WhatsApp opens with the message pre-filled from the clinic's own number, the person hits send | A Supabase Edge Function POSTs to `graph.facebook.com`, the message leaves the clinic's Business number automatically |
| Server needed | None | Yes — Edge Function + `WHATSAPP_TOKEN`, `PHONE_NUMBER_ID`, `VERIFY_TOKEN` |
| Meta setup | None | Business verification, a dedicated number, template approval per message type |
| Works before the patient is a contact | Yes (any valid number) | Yes, but **only template messages** outside a 24 h window — every message above is a template |
| Cost | ₹0 beyond the clinic's existing WhatsApp | Per-conversation Meta pricing (free tier for user-initiated service conversations, paid for templates in some markets) |
| Offline | Still works (it is a link) | No server, no send — needs a retry queue |
| Proof of delivery | None — “sent” is a person saying they sent it (this is what `reminders.status` already means) | Delivery + read receipts, real |
| Time to ship | Days | Weeks, and blocked on their Meta approval |

**Recommendation: A now, B later — behind the same message layer.** Every message is built by
a pure function returning text; the transport is one call at the end. Swapping A for B then
changes one function, not five screens, and the send log is already there to become the
delivery log.

---

## 3. Design for phase A

### 3.1 One message module

New `src/lib/messages.mjs`, pure functions, no React, no network:

```js
tokenMessage({ clinic, doctor, token, position, etaIso })     // "Your token is 14 …"
appointmentMessage({ clinic, doctor, iso, time, kind })       // "Your appointment is …"
invoiceMessage({ clinic, invoice, balancePaise, upiUri })     // number, total, balance, UPI
prescriptionMessage({ clinic, doctor, rx, language })         // drugs + directions, no diagnosis
```

Each returns `{ kind, draftKey, text, subject }`. `reminderText()` in `daybook.mjs` stays the
fifth builder and keeps its current signature, so `FollowUps.jsx` is untouched.

Rules the builders enforce, following what the product already promises:

- **No clinical content in a reminder, a token or a balance message.** Appointment messages
  carry time and doctor only; the invoice carries money only; the prescription carries the
  medicine and the directions — which the patient needs — and never the diagnosis.
- **Everything leaves from the clinic**, signed with the clinic name and phone.
- **A single phone normaliser** — reuse `whatsappLink()`’s rules (10 digits → `91`, leading
  `0` dropped, refuse under 11 digits) so a landline is refused instead of half-dialled.
- **One message per thing per day.** `draftKey` is stable (`token:<appt>`, `invoice:<id>`,
  `rx:<consultation>`, `appointment:<id>`), so the queue can tell “already sent today” and
  the desk cannot spam a patient.

### 3.2 One send action

New `src/components/MessageSheet.jsx`: preview the exact text, phone with a warning when it is
unusable, **Send on WhatsApp** (opens `wa.me`), **Copy**, and **Mark sent**. It logs to the
existing `reminders` table (channel `whatsapp`, status `opened` → `sent`), so the send log,
the “never chased twice” rule and the day-close audit stay in one place.

### 3.3 Where the buttons go

| Screen | Button | Message |
|---|---|---|
| `Queue.jsx` — token row | **Send token** | token number, doctor, how many ahead, clinic phone |
| `Appointments.jsx` — row + day board | **Send details** | date, time, doctor, clinic address |
| `InvoiceView.jsx` — replaces the copy-only summary | **WhatsApp** | invoice number, total, balance, UPI link when the clinic has a VPA |
| `PrescriptionView.jsx` — replaces copy-only | **WhatsApp** | medicines + directions in the patient's chosen language |
| `FollowUps.jsx` | already there | unchanged |
| `PatientDetail.jsx` | **Message** menu | any of the above for that patient's latest visit |

### 3.4 Schema 11 (additive, no data dropped)

```sql
-- one row per thing the desk sent, reusing the send log
alter table public.reminders drop constraint if exists reminders_kind_check;
alter table public.reminders add constraint reminders_kind_check
  check (kind in ('appointment','follow-up','balance','token','invoice','prescription'));

-- consent, so an opt-out is a fact and not a note in the paper file
alter table public.patients add column if not exists wa_opt_in boolean not null default true;
alter table public.patients add column if not exists wa_opt_out_at timestamptz;
```

An opt-out is a column, not a memory: the composer disables itself and says why. This is also
gap **G4** from `docs/PRODUCT-GAP-ANALYSIS.md` — the first slice of it, and the cheapest.

### 3.5 Tests

- Every builder: correct text, no clinical words, phone normalisation, unusable phone refused,
  a `draftKey` that is stable per thing and distinct per kind.
- The send log: a second send of the same thing the same day is flagged as already sent.
- Opt-out: the composer refuses and the refusal names the patient.
- Prescription text for one Indian language besides English.

---

## 4. Phase B sketch (only if you want automated sending)

An Edge Function `whatsapp-send` that (1) takes a `reminder` row id, (2) loads the template
name for its kind, (3) POSTs to the Graph API with the clinic's `PHONE_NUMBER_ID`, (4) writes
`status='sent'` plus `wa_message_id` and later the delivery receipt. The queue already exists
(`reminders` + `draft_key` + `status`), so B is a worker plus six approved templates, not a new
subsystem. It needs: Meta Business verification, a number the clinic will dedicate, template
approval, and the ₹/conversation budget the clinic accepts.

Blocked on your answer to Q1 below; nothing in this plan assumes it.

---

## 5. Decisions I need before writing code

1. **Transport** — A (click-to-send, ship in days) or B (Cloud API, needs Meta approval).
2. **Documents** — text summary only (default here), or also a **link to a tokenised public
   page** so the patient can open the bill or the slip? A link means a new public route, a
   signed token, and a real privacy decision (anyone holding the link sees the document).
3. **Consent** — ship the opt-out column and the refusal now (recommended), or keep consent
   out of scope for this release.

Everything else — the builders, the composer, the send log, the five buttons, the schema 11
block, the tests — is specified above and can be built as one release.
