# Plan — queue, billing, patients and branches

Nine requests came in together. This is the plan they become: one release per item,
ordered lowest risk first, each ending with `npm test` + `npm run build` +
`check:pages` + `check:contributing` + `test:security` before it is reported, committed
or tagged — the same discipline as `docs/ARCHITECTURE.md` §3.

Written before any code changed, from the code as it stands at **v1.32.0**.

**Status.** Items 1 and 2 shipped in **v1.33.0**; item 10 (onboarding) shipped in
**v1.34.0** (schema 19), ahead of the rest because it was asked for last — see §10
for the plan and the deviation that discovery forced. Item 5 (the token queue)
shipped in **v1.35.0**, ahead of the rest because it was asked for next — see §5, and
refined in **v1.35.1** so each seat has its own Consult / Done. A later, unrelated
request — a date filter on the Patient records list — is item 11 and shipped as
**v1.35.2** (§11). A second later request — WhatsApp at token issue, a redesigned
token slip, and the slip sent as an image with the message — is item 12 and ships as
**v1.35.3** (§12). Items 3 and 4 move to v1.36.0 and v1.37.0; items 6–8 keep their
slots; item 9 waits on the three decisions at the end of this document.

---

## What was asked, and what it costs

| # | Release | Request | Risk | Schema | Size |
| --- | --- | --- | --- | --- | --- |
| 1 | v1.33.0 | Sidebar must scroll on short desktop screens | low | — | CSS + layout |
| 2 | v1.33.0 | A sign-out / logout button | low | — | layout + auth call |
| 3 | v1.36.0 | Follow-ups: the recall list is wrong — find it and fix it | medium | — | one lib rule + screen |
| 4 | v1.37.0 | Consultation notes: a drug line may not be empty | low | — | one validator |
| 5 | **v1.35.0** | Token queue: at most 2 patients in the room, both shown | medium | — | `queue.mjs` + 3 screens |
| 6 | v1.38.0 | "Visit saved" → Collect payment: recorded once, never twice | medium | — | flow state + screen |
| 7 | v1.39.0 | Only the owner can cancel an invoice | low | — (already enforced) | UI + guard test |
| 8 | v1.40.0 | Register a patient: first + last name, phone/email checks, no duplicates | medium | — (compose `full_name`) | form + validators |
| 9 | v1.41.0+ | Multi-clinic: create and manage branches, each with its own front desk | **high** | **yes** | schema + RPC + screens |
| 10 | **v1.34.0** | Onboarding / "Set up your clinic": clinic details, lead doctor, hours & fees | medium | **yes** (schema 19) | page + pure module + `create_clinic()` |
| 11 | **v1.35.2** | Patient records: add a date filter to the All list | low | — | one pure module + `Patients.jsx` |
| 12 | **v1.35.3** | Token issued: WhatsApp send, redesign the print slip, send the slip image with the message | medium | — | one pure module + slip component + composer |

Items 1 and 2 are the same release because both are the sidebar and nothing else.
Everything else stays one item per release.

---

## 1 + 2 · v1.33.0 — the sidebar scrolls, and it has a way out

**Today.** `.sidebar` is `height: 100dvh`, `display: flex; flex-direction: column`
with **no `overflow-y`** (`src/styles.css:123`). Its children are the brand, every nav
group, then `.sidebar-foot` with `margin-top: auto` (plan card, user chip). On a
1280×720 laptop the nav plus the plan card is taller than the viewport, so the last
items and the user chip fall off the bottom edge and **cannot be reached** — there is
no scroll container anywhere in the column. The mobile drawer is fine (it sets
`overflowY: 'auto'` inline, `AppLayout.jsx:216`).

Signing out exists only in **Settings → My account** (`AccountTab.jsx`, "Sign out").
A front-desk machine shared by three people has no way out of the app from where they
work.

**Change.**
- `.sidebar`: `min-height: 0`, and the nav region becomes the scroller —
  `.sidebar-nav { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }`
  with the brand and `.sidebar-foot` outside it, so the plan card and the account
  row stay pinned and the *links* scroll. A thin scrollbar that only shows on hover,
  and `scrollbar-gutter: stable` so the labels do not shift when it appears.
- The same region on the mobile drawer, so both paths behave identically.
- `.sidebar-foot` gets a **Sign out** row: the existing `user-chip` keeps opening
  Settings, and a new 28 px icon button beside it calls `signOut()` from
  `useAuth()` and `navigate('/')` — the same call `AccountTab` makes, so there is one
  way to sign out, not two implementations. Hidden when `configured` is false (a demo
  workspace has no session to end) and disabled while signing out.
- Keyboard and screen-reader: the sign-out control is a real `<button>` with
  `aria-label="Sign out"` and a `title`, reachable by tab from the user chip.

**Acceptance.** At 720 px and 600 px viewport height every nav item and the account
row are reachable by scroll; the plan card and account row never scroll away; no
horizontal scrollbar appears; `Sign out` appears for a live session and not in demo
mode; sign-out lands on `/`.

**Tests.** `tests/sidebar-layout.test.mjs`: the sidebar declares a scroll container
with `min-height: 0`; the foot is outside it; the sign-out control is a button wired
to `signOut`, gated on `configured`, and calls `navigate('/')`; the matrix still says
a front-desk seat may sign out (no capability gate on it).

---

## 3 · v1.36.0 — the follow-ups recall list

**Today.** `FollowUps.jsx:30` builds the list with
`followUpDue(store.consultations, { withinDays })` (`src/lib/patients.mjs:53`), which
keeps rows where `follow_up_on && follow_up_on <= horizon && !follow_up_done`, and the
screen then splits them into overdue / today / upcoming at `:31–33`.

**This one is a diagnosis before it is a fix.** The named suspects, to be checked in
order against real data — each is a different bug with a different repair:

1. **Duplicate rows for one person.** A patient seen four times in the window has four
   consultations, so the recall list shows them four times. The recall is about the
   *patient*, not the visit.
2. **Closed recalls coming back.** `follow_up_done` is truthy-only in the filter; a row
   saved as `follow_up_done: null` (or `0`) is treated as open. Check the shape the
   column actually arrives in.
3. **The count and the list disagree.** The header's `queue.counts['follow-up']`
   (`:216`) comes from the reminders queue, not from `followUpDue`, so the badge can
   say 3 above a list of 0.
4. **A consultation whose patient was deleted** rendering as "Patient" with no chart
   to open (`nameOf` falls back to the literal `'Patient'`).
5. **The window control** (`window_`) changing the KPIs but not the sections.

The release fixes whichever of these the investigation proves, and adds a regression
test per proven cause. If it turns out to be (1), the fix is a `recallList()` in
`patients.mjs` that groups by `patient_id` (latest open follow-up wins, earliest date
shown) — a pure function, tested directly.

**Acceptance.** One row per patient; no closed or cancelled recall ever listed; the
badge equals the number of rows below it; opening a row lands on that patient's chart.

---

## 4 · v1.37.0 — a drug line cannot be empty

**Today.** `ConsultationForm.jsx:143` validates the *pattern* of a drug that has a name
(`rx.drug.trim() && …`), and `:171` filters named drugs before the safety check.
Nothing requires the prescription to contain one: a note can be saved with an empty
drug row, or with no drugs at all, and the slip then prints "Rx (0)".

**Change.** `validateConsultation` gains the rule — at least one drug line with a
name — and the form stops treating a blank row as a row: a row with no name and no
pattern is ignored on save rather than saved empty; a row with a pattern but no name is
refused with "Drug 2: pick the medicine or remove the row."

**Acceptance.** Saving with no drug shows a field error and does not create the
consultation; a half-filled row is refused with the row number; the safety check still
runs only on named drugs; existing consultations render unchanged.

---

## 5 · v1.35.0 — two in the room, per doctor

**Today.** `queueBoard()` (`src/lib/queue.mjs:37`) returns exactly one `serving` per
doctor (`status === 'in-consult'`, first by token) plus a `next` (`checked-in`, first by
token). "Call next" (`Queue.jsx:62`) flips `row.next` to `in-consult` unconditionally —
so a second call silently makes a **second** patient `in-consult` while the board still
shows only the first. The board's "Now in the room" card, the waiting-room display
(`:345–365`) and the Dashboard's "in the room" count all read that single value.

**Change.**
- `queueBoard` returns `inRoom` (array, in token order), `roomCount`, and
  `roomLimit` (2, one constant `ROOM_LIMIT`), keeping `serving` as `inRoom[0]` so
  nothing that reads it breaks.
- `canCallNext = inRoom.length < ROOM_LIMIT`.
- Queue: the room card lists **everyone in the room** — the first (T-09) large with a
  **Talking** badge, the second (T-10) in a **small font** with a **Waiting in room**
  badge — and a `N / 2` badge in the header. Asked for explicitly: *"Now in the room
  should show whos in room the limit is 2 all 2 should able to see in room … if T-09 is
  Talking then next T-10 is wating in room should visibel in small font"*. The two seats
  come from `roomSeats(inRoom)` in `queue.mjs`, not from an inline JSX conditional.
- "Call next" is disabled with an inline reason when the room is full; pressing it
  anyway (the row buttons, or a stale tab) shows a toast — *"Room is full — T-04 and
  T-05 are already in the room. Mark one as seen before calling another."* — and does
  not change any row.
- `callIn()` re-checks the limit against fresh state, so two receptionists clicking at
  once cannot make three.
- Display screen: the "In the room" block lists both tokens.
- Dashboard: "N in the room" counts them all.
- **v1.35.1 follow-up, asked for after v1.35.0 shipped:** *"Now in the room need
  saparate info like Consult/Done for each token in room talking and Waiting in
  room"*. v1.35.0 put one shared **Consult** (for the first seat only) and a row of
  **Done** buttons at the bottom of the card. Each seat now carries **its own info
  and its own two actions**: the Talking token and the Waiting in room token each
  render their token, name, wait/status badge, **Consult** and **Done**, and every
  button acts on that seat's appointment only. `roomSeats()` supplies the per-seat
  action labels (naming the token when two people are in the room), so two identical
  "Consult" buttons cannot be confused; no display rule is written inline in JSX.

**Acceptance.** Never more than two `in-consult` per doctor per day; the third attempt
shows the message and writes nothing; completing one frees a slot; with two in the room
the card shows **both** tokens — the first large as Talking, the second in small type as
Waiting in room — and the `2 / 2` badge; **each seat has its own Consult and Done that
act on that token only**; the display and the dashboard show the same two people the
board does; seeds and existing data unaffected.

---

## 6 · v1.38.0 — a payment is recorded once

**Today.** `VisitNextSteps` opens `CollectPayment` and, on success, only closes the
sheet (`onDone={() => setPayFor(null)}`-style) — the `invoice` prop it was given is
**the pre-payment object**, so the "Collect ₹X" button and the "…due" line stay on
screen after the money is in. Pressing it again opens the collector on a settled
invoice, where the amount due still reads as the old balance. `CollectPayment.submit`
has `saving` and disables the button, but two fast clicks across the close/animate
window can still enqueue a second write, and nothing in the write path refuses a
payment on an already-settled invoice.

**Change.** One rule, three places:
- `CollectPayment` refuses to submit when the invoice is settled **or already paid in
  full** (`invoiceBalance(invoice) <= 0`), not only when a local `settled` flag says
  so, and keeps the in-flight guard.
- `VisitNextSteps` holds the invoice in state and replaces it with the `onDone`
  payload, so the sheet switches to "Payment recorded ✓" with no Collect button.
- `visitNextActions()` (`visit-flow.mjs`) drops `collect` when the balance is zero —
  the pure function already receives `balancePaise`, so this is a one-line rule plus a
  test.

**Acceptance.** After recording, the sheet and the invoice screen show settled with no
Collect control; a second submit does nothing and says so; part payments still work and
still leave the button, for the remaining balance.

---

## 7 · v1.39.0 — only the owner can cancel an invoice

**Today.** `MATRIX['invoice:void'] = ['owner']` (`permissions.js:51`) and the security
suite proves the database refuses a non-owner void — but **no screen offers the
action at all**, so an invoice raised with the wrong patient cannot be cancelled from
the app.

**Change.** A "Cancel invoice" action on `InvoiceView` and in the Billing row menu,
rendered only for `can(role, 'invoice:void')`, behind a confirmation that names the
invoice, the amount and the patient, asks for a short reason, and writes
`status: 'void'` with `void_reason`. A front-desk seat never sees it (not disabled —
absent), and the void path re-checks the capability before writing, so a stale render
cannot perform it.

**Acceptance.** Owner sees the action on an unvoided invoice and a voided invoice shows
"Void" with its reason; a front-desk session has no control and a forged call is
refused by the capability check *and* by Postgres; voided invoices stay out of
outstanding and revenue totals (already true) and keep their number (already true).

---

## 8 · v1.40.0 — registering a patient

**Today.** One `Full name *` field (`PatientForm.jsx:86`), phone and email validated by
`validatePatient` (format only), and **no duplicate check at all** — the same person
registered twice gets two codes, two histories and two sets of recalls.

**Change.**
- **Two fields.** `First name *` and `Last name` — the database keeps `full_name`
  (composed `first + ' ' + last`), so no migration and no schema release; printouts,
  slips and search keep working from one column.
- **Phone and email validated as typed.** Indian mobile in any of the shapes the desk
  actually sees (`98200 00000`, `+91 98200 00000`, `098200 00000`) normalised to ten
  digits; email lower-cased and format-checked; both validated on blur and on submit,
  with the error under the field. A phone is optional but, when given, must be valid.
- **A duplicate guard.** Before creating, `findPatientMatch()` compares the draft with
  every patient on the clinic: **same phone** (normalised) or **same name + same date
  of birth** (when both are known). On a match the form shows the existing patient
  (code, age, last visit) and offers *Open chart* — and "Register anyway" only after a
  reason is typed, which is recorded on the new row as `duplicate_ok_reason`. This is a
  pure function, tested against the awkward cases (same name, no DOB; siblings sharing
  a parent's phone; a blank phone).

**Acceptance.** The same phone cannot create a second patient without an explicit
override; name + DOB catches the twin case; siblings are not blocked when only the
parent's phone is shared and a DOB differs; every existing patient still opens and
prints; nothing migrates.

---

## 9 · v1.41.0+ — branches, each with its own front desk

**Today.** "Branch" exists only as a **licence seat** (`plans.mjs:52–54`,
`license.mjs:195`, `licensing-adapter.js:47` — `branches: 1`, hard-coded). There is no
`branches` table, no branch switcher, no branch-scoped data, and no way to create a
second one. A multi-clinic group on the `chain` plan cannot use the thing it is paying
for.

**This needs a schema release and, before that, three decisions from you** — they change
the data model, so I will not guess:

1. **Is a branch a second row in `clinics`, or a child of the first?** A child
   (`clinics.parent_id`, one owner, one licence, branch-scoped staff and data) is the
   smaller change and keeps one bill; a second `clinics` row is a separate licence and
   a separate set of seats. *My recommendation: `parent_id`.*
2. **What is shared and what is separate?** Patients and invoices are almost certainly
   per branch; the drug directory, the formulary and the plan are almost certainly
   shared. A patient seen at two branches is the interesting case — one record with
   visits tagged by branch, or two records?
3. **Who can see across branches?** Does the owner of two branches see a combined
   today's-collection, and does a front-desk seat of branch A see branch B at all?
   *My recommendation: owner sees both; a front-desk seat is scoped to its own branch
   and does not even see the switcher.*

**Shape of the release, once those are answered.** Schema: a `branches` table (or
`parent_id`) + `staff.branch_id` + RLS per branch + a `create_branch()` RPC that
enforces the plan's branch cap. Client: a branch switcher in the sidebar, the active
branch in the store, every list query scoped by it, "Add a branch" in Settings gated on
`planLimits(plan).branches`, seat meters reading real branches instead of `1`, and
front-desk invitations scoped to a branch. It will be at least two releases
(schema + client), and it is the only item here that touches the database.

---

## Assumptions I am building against

Say the word if any is wrong; the ones before item 9 do not depend on each other.

1. **Two in the room is per doctor**, not per clinic — the board is already per doctor.
2. **"A drug should not be empty"** means at least one named drug per consultation, and
   blank rows are ignored rather than blocking the save.
3. **The duplicate rule is phone-first**, with name + DOB as the second signal, and an
   override with a reason rather than a hard block (a parent registering two children
   on one phone number is real).
4. **"Cancel invoice"** is the existing `void` (number kept, kept out of totals), not a
   delete.
5. **Sign out** ends the session and lands on the landing page, exactly as Settings →
   My account already does.


---

## 10 · v1.34.0 — onboarding, "Set up your clinic"

**Today.** `Onboarding.jsx` is 170 lines and three steps: clinic details, lead doctor,
hours & fees. The shape is right; the details are not.

- **The two phone fields are the same field.** Step 1's "Clinic phone" and step 2's
  "Doctor's phone" both bind `form.phone` (`:31`, `:132`, `:134`), so typing the
  doctor's mobile silently rewrites the clinic's number, and the clinic row receives
  whatever was typed last.
- **Hours are collected and thrown away.** The page sends `open_time`, `close_time`
  and `follow_up_days` to `store.createClinic()`, but `create_clinic()` in
  `schema.sql` inserts only name, type, phone, email, address, the two fees and
  `slot_minutes`. A clinic set up as "10:00–19:00, follow-up 21 days" is created at
  the defaults, every time. The staff row is written the same way: `registration_no`,
  the day window and the doctor's fees are in the payload and not in the insert.
- **Nothing is validated before the last click.** Only a name and a doctor's name are
  checked, at `finish()`, which then jumps the person back to the offending step. A
  malformed phone, a bad fee or a reversed time window are accepted and either stored
  or silently replaced by a default (`moneyToPaise` is wrapped in a `try` that keeps
  500/250 — `:40`).
- **A reload loses everything**, including a half-filled address and fee.
- **The clinic's week is not offered at all**, though the app has supported closed
  weekdays and two sessions since schema 12 — the very settings a clinic sets once
  and never revisits.

**Change.**
1. **`src/lib/onboarding.mjs`** (pure, tested): `emptyForm(prefill)`, per-step
   validators (`validateClinicStep`, `validateDoctorStep`, `validateHoursStep`), the
   two payload builders (`clinicPayload`, `ownerPayload`), the draft helpers
   (save/load/clear with injected storage), and `summaryRows(form)` for the review
   step. Nothing in the page computes a payload any more.
2. **The page** keeps its three steps and gains a fourth: **Review** — what will be
   created, in one card, with an *Edit* link back to each step, then "Create clinic".
   Per-step validation with inline field errors, an `aria-live` error line, Enter to
   continue, and a draft in `localStorage` that survives a reload and is cleared on
   success.
3. **Separate phones** (`clinic_phone`, `doctor_phone`), a validated mobile and email,
   fees validated through `moneyToPaise` with the message shown instead of a silent
   default, and a time window that must end after it starts.
4. **Working days and an optional second session** in step 3, written as
   `closed_weekdays` and `sessions` — the two things the rest of the app already reads.
5. **`create_clinic()` (schema 19)** persists what the page collects: `gstin`,
   `follow_up_days`, `open_time`/`close_time`, `sessions`, `closed_weekdays`, and on
   the staff row `registration_no`, `day_start`/`day_end`, `slot_minutes` and the two
   fees. Additive only — new keys in the existing jsonb, existing rows untouched,
   defaults unchanged when a key is absent, so an older client keeps working.
6. **"You can change all of this later"** stated once, with the exact places
   (Settings → Clinic, Doctors & staff), because a first-run screen should not feel
   like a contract.

**Acceptance.** A clinic created with 10:00–19:00, Sunday closed and a 21-day
follow-up reads back with exactly those values (proved against the function body, the
way `tests/schema-parity.test.mjs` already pins the mirror to the authority); the
clinic phone and the doctor's phone are independent; a bad phone, email, fee or
reversed hours cannot advance a step; a reload resumes at the step it was left on with
the values typed; the review step names what will be created; and a payload with only
a name still creates a working clinic with every default (the old behaviour).

---

## 11 · v1.35.2 — a date filter on Patient records

**Today.** `Patients.jsx` is the register: a search box, a sort selector and five tabs
(`All`, `New this month`, `Chronic flags`, `Has dues`, `Not seen recently`). Two of
those tabs are already fixed date rules — `new` compares `created_at` with the first
of the month, `inactive` compares the last visit with it — but there is **no way to
choose a date**. A desk that wants "everyone registered in the first week of
November", or "patients we saw on a particular day", can only export all of them and
filter the CSV by hand.

**Change.** A compact date-filter bar under the tabs, part of the `All` list and
composing with every other filter:

1. **`src/lib/patient-dates.mjs`** (pure, tested): `PATIENT_DATE_FIELDS`,
   `DATE_PRESETS`, `isoDay()`, `patientDate(patient, field, lastVisit)`,
   `normaliseDateRange(from, to)`, `presetRange(value, iso)`,
   `filterPatientsByDate(patients, { field, from, to, lastVisitOf })`,
   `dateFilterActive()` and `fieldLabel()`.
2. **Two dates selectable**, because the request does not say which one:
   **Registered** (`created_at`, the default — the same date the `New this month`
   tab uses) and **Last seen** (`lastSeen(p.id).visited_on`, which already falls
   back to completed appointments when the front desk cannot read consultations).
3. **An inclusive `From` / `To` range** plus quick presets (Today, Last 7 days,
   This month, Last 30 days, Last 90 days) and a **Clear** control. A reversed
   range shows an inline error and does not filter; a half-typed bound is simply
   ignored until it is a real date.
4. The filtered set feeds `patientSearch`, the tabs' `All` count, the list, the
   "N patients" head and **Export** — so the CSV is what the desk sees, not the whole
   register. An `aria-live` line states the active field, range and match count.
   `?from=…&to=…&dateField=…` opens a pre-filtered register (sanitised through
   `isoDay`), which also makes the filtered view server-renderable in a smoke.

**Acceptance.** With no dates set the register is byte-for-byte the same list it is
today; a `From`/`To` range keeps only patients whose chosen date is inside it
(inclusive); switching the field switches the result; a preset sets both bounds;
`From > To` shows the error and keeps all rows; a patient with no date is excluded
while a filter is active; Export exports the filtered rows; and the permission-aware
`lastSeen` is the one used for "Last seen". No schema, RPC, store or seed change.

---

## 12 · v1.35.3 — token issued: WhatsApp, a redesigned slip, and the slip as an image

**Today.** `TokenForm.jsx` issues a token and then shows a "Token issued" card with
three footer actions: **Done**, **Print slip**, **Next patient**. Two problems:

1. **There is no WhatsApp send at the moment of issue.** The consent-aware
   composer (`MessageSheet.jsx`) and `tokenMessage()` already exist, but they are
   only reachable later from the Queue's "Token" button and the day board. The one
   moment the desk has the patient standing in front of it is the moment with no
   way to send the number.
2. **There is no token slip.** `Print slip` calls `window.print()`; `.slip` is a
   dead CSS rule (`styles.css:559`) that **no JSX element uses**. What prints is
   the whole app behind a modal. A dead `.slip` class is not a slip.

**The environment constrains the image.** This app has no server and no WhatsApp
Business credentials; every message today leaves through `wa.me` from the clinic's
own number, and the composer says so explicitly. A `wa.me` link can carry text but
**cannot carry an image attachment**. So the slip image is delivered through the
Web Share API (`navigator.share({ files, text })`, where the desk picks WhatsApp —
both travel together), with a **Download slip PNG** fallback on desktop browsers
that cannot share files, and the existing **Open WhatsApp** text-only link kept for
everywhere else. A Cloud API send would need credentials and a server and is out of
scope; this is recorded as a deviation in `CHANGELOG.md` / `ARCHITECTURE.md`.

**Change.**

1. **`src/lib/token-slip.mjs`** (pure, tested) — the single source of truth for
   the redesigned slip: `tokenSlipModel()` normalises clinic / doctor / patient /
   appointment / fee / queue position into plain data; `tokenSlipSvg(model)`
   returns **one self-contained SVG string** (inline fills, system fonts, XML
   escaped, no external references) used for the on-screen preview, the print
   sheet *and* the PNG. Also `safeColor()`, `clipText()`,
   `tokenSlipFilename()` and `slipCaption()`. No DOM, no `Date`, no network.
2. **`src/lib/token-slip-image.js`** (browser-only) — `slipPngFile(model)` turns
   that SVG into a `File` through a canvas; `canShareFiles()`, `downloadBlob()`
   and `printTokenSlip()` (injects a scoped 80 mm `@page`, sets
   `body[data-token-print]`, cleans up on `afterprint`). Nothing runs at import
   time, so SSR stays safe.
3. **`src/components/TokenSlip.jsx`** — `TokenSlip` renders the SVG preview,
   `TokenSlipPrintPortal` puts the same SVG outside `#root` for paper, and
   `TokenIssuedPanel` owns the issue-time actions so the whole issued state is
   server-renderable in a smoke. The SVG is rendered as a percent-encoded data-URI
   `<img>`, not injected markup — `check:contributing` allows no raw HTML opt-outs.
4. **`src/styles.css`** — print rules hide `#root` while `data-token-print` is on
   and show only the 74 mm-wide slip; screen styles for the preview.
5. **`TokenForm.jsx`** — issued state renders the redesigned slip and offers
   **Send on WhatsApp**, **Print slip**, **Download slip image**; the composer
   receives the slip model and the token message built with `withSlip: true`.
6. **`MessageSheet.jsx`** — an optional `slip` model adds a slip preview and
   **Share image + message** / **Download slip PNG** actions, still gated by
   `canMessage()` and still writing `opened` / `sent` / `copied` log entries.
   With no `slip` the composer is byte-for-byte the one the other four screens
   already use.
7. **`messages.mjs`** — `tokenMessage({ withSlip: true })` adds one line telling
   the patient the slip is attached as an image; privacy rules unchanged.

**Acceptance.** The issued state has a real, designed slip (clinic identity, huge
token, patient, doctor, visit, date/time, fee, queue position, footline) instead of
a dead CSS class; Print slip prints only that slip on an 80 mm page; Send on
WhatsApp opens the consent-aware composer with the exact text and the slip preview;
Share image + message hands a PNG and the text to the OS share sheet; Download slip
PNG works where file sharing does not; the five existing composer callers are
unchanged; opt-out / bad-number refusals still win; and the SVG is XML-escaped so
a patient name cannot inject markup. No schema, RPC, store, seed or `SCHEMA_VERSION`
change.
