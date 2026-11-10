# Changelog

All notable changes to myClinic. Versions follow semver; `schema` refers to the
Supabase migration level this release expects (`app_schema_version()`).

## [1.35.4] — 2026-11-02 · schema 19

**One token per patient per day, and attendance states that can be recovered.**
Item 13 of `docs/PLAN-v1.33.md` (§13), a patch so items 3–9 keep their planned
releases.

| Change | File | Why |
| --- | --- | --- |
| the whole rule set | `src/lib/token-policy.mjs` (new, pure) | no issuing or attendance rule belongs inline in JSX |
| no-show tokens stay on the board | `src/lib/queue.mjs` | they used to disappear, which is why the desk issued a second number |
| refusal + attendance UI | `src/components/TokenAttendance.jsx` (new) | presentational, so the real states are server-renderable in a smoke |
| **one token per patient per day** | `TokenForm.jsx` | issuing inserted a row unconditionally |
| attendance actions + tally | `Queue.jsx` | not arrived / no show / arrived late were invisible or unrecoverable |

**The two defects were one loop.** `TokenForm.issue()` created an appointment with
`token_no` without looking at the patient or the day. The database has
`unique (doctor_id, scheduled_on, token_no)` and
`unique (doctor_id, scheduled_on, scheduled_at)`, so two tokens in the same
*minute* collide — but the same patient at 09:15 and again at 11:40 got `T-03`
**and** `T-08`: two rows in the queue, two names on the display, two possible
bills. Meanwhile `queueBoard()` built `waiting` from `checked-in` + `booked` only,
so a token marked **No show** (already a valid status, already a button in the
table) vanished from the screen. When that patient turned up later there was
nothing to re-activate, and the desk's only option was to issue **another** token.
That is the commonest way a duplicate was born.

**The refusal.** `tokenIssueCheck()` returns the existing token(s), their count
and a sentence the desk can act on — *"Aarav Sharma already has 2 tokens today
(T-03, T-08 · the first is no show). Re-use T-03 — mark them arrived or arrived
late instead of issuing another."* `TokenForm` shows it in a `role="alert"` panel
before the Issue button is clicked, **disables** Issue, and re-takes the decision
from a fresh store ref at click time so a stale board or a double click cannot
write a second row. Cancelled tokens do **not** block; no-show and completed ones
do; a booked appointment without a number is not a token.

**Re-use, not a dead end.** The panel offers **Use T-xx** (which opens the
existing token's slip, print and WhatsApp actions), **Mark arrived** and
**Arrived late**. Every one of them updates the *existing* appointment — no
insert. `Use` and the attendance actions share the same captured issued state,
so the redesigned slip from v1.35.3 works unchanged.

**Three states, one vocabulary.** `attendanceOf()` names Not arrived (`booked`),
Waiting, Arrived late, No show, In the room and Done. "Arrived late" is a small
marker in the existing `notes` column (`[Arrived late 14:35]`) rather than a new
status, so the schema's six-value `appointments_status_check` is untouched and
the desk's own notes are preserved. `arrivalPatch()` marks a no-show's return as
late automatically, as well as any booked arrival past its slot plus a 15-minute
grace; `forceLate` is there for the desk's explicit **Arrived late** button.
`noShowPatch()` writes the one status. `attendanceCounts()` feeds a header tally.

`queueBoard()` now returns `missed` (no-show tokens with a number), `notArrived`,
and `totals.noShow` / `totals.notArrived`. **Every existing key keeps its
meaning**: `missed` rows are deliberately *not* in `waiting`, `next`, `seats` or
the room limit. The queue renders them in a **No show / arrived later** strip and
in the token table, each with an **Arrived late** button that puts the same
number back in the queue. `AttendanceActions` replaces the two ad-hoc buttons
with one rule-driven set, and `AttendanceBadge` replaces `queueState()` in the
queue so there is a single attendance vocabulary on screen.

**Deviation.** The one-per-day guard is a **client-side fresh-store check**, like
the room-limit guard in v1.35.0 — not a database constraint. Two receptionists
on different devices racing at the same instant could still both pass; a strict
fix needs a server-side unique index on
`(clinic_id, patient_id, scheduled_on)` for token-bearing rows, which is a
schema decision. Recorded in `docs/ARCHITECTURE.md` §4.1.

**Verified.** 12 tests in `tests/token-policy.test.mjs` pin the day rule,
cancelled/no-token rows, pre-existing duplicates, the six attendance labels, the
late marker (escaping, replacement, 1000-character limit), lateness arithmetic,
patches, counts, the queue board's `missed` list and four wiring ratchets. An SSR
smoke at `tools/token-policy-smoke/` (**37 checks**) renders the real duplicate
refusal with a disabled Issue button, a fresh patient who can still be issued,
every badge state, the no-show strip restoring T-03, and the whole Queue page
with its tally. **No change** to the schema, any RPC, the store, seeds or
`SCHEMA_VERSION`; lib census 51 modules (22 import nothing).

## [1.35.3] — 2026-11-02 · schema 19

**WhatsApp at token issue, a redesigned token slip, and that slip sent as an image
with the message.** Item 12 of `docs/PLAN-v1.33.md` (§12), a patch so items 3–9
keep their planned releases.

| Change | File | Why |
| --- | --- | --- |
| redesigned slip as data + one SVG | `src/lib/token-slip.mjs` (new, pure) | the preview, the printed sheet and the PNG must not be three layouts that drift |
| SVG → PNG, OS file sharing, 80 mm print | `src/lib/token-slip-image.js` (new, DOM boundary) | a `wa.me` link cannot carry an image; the share sheet can, and a canvas can make the file |
| slip preview, print portal, issued actions | `src/components/TokenSlip.jsx` (new) | the whole issued state becomes server-renderable in a smoke |
| **Send on WhatsApp** at issue | `TokenForm.jsx` | the desk had the patient in front of it and no way to send the number |
| slip attachment in the shared composer | `MessageSheet.jsx` | one composer, still consent-aware and still logged |
| message says the slip is attached | `messages.mjs` (`withSlip`) | the text and the image describe the same thing |
| print only the slip | `styles.css` | the dead `.slip` rule is removed, not left behind |

**Before.** `TokenForm.jsx` issued a token and showed a card with **Done**,
**Print slip** and **Next patient**. There was **no WhatsApp send at that moment**
— the composer and `tokenMessage()` existed, but only on the Queue and the day
board, i.e. later. And **Print slip** was a bare `window.print()` on the modal:
`.slip` was a CSS rule (`styles.css:559`, `position: fixed` inside `@media print`)
that **no JSX element ever used**. What reached the printer was the app behind a
dialog, not a slip.

**The redesigned slip.** A proper 80 mm counter slip: clinic initials, name,
address and phone on the brand-colour header; `YOUR NUMBER` over a 62 pt token;
date and time; a tinted queue strip (`3 patients are ahead · about 45 min` or
`You are next — please wait here`); the patient name and ID; doctor, visit and
fee; and a two-line "wait in the lounge" footline. `Print slip` now injects a
scoped `@page { size: 80mm 170mm }`, hides `#root` and prints a portal copy of
the slip outside it, then cleans up on `afterprint` so every other screen keeps
its A4 paper.

**The image with the message — and the platform limit.** This is a static app
with no server and no WhatsApp Business credentials; every message leaves through
`wa.me` from the clinic's own number. **A `wa.me` link can carry text but not an
image attachment.** Rather than pretend otherwise:

- **Share image + message** — on a device with Web Share file support, one OS
  sheet hands the slip PNG *and* the exact message text to the app the desk picks
  (WhatsApp). Both arrive together. A cancelled share is not logged as sent.
- **Download slip PNG** — on a desktop browser that cannot share files, the desk
  downloads `Token-T-14-Aarav-Sharma-2026-11-02.png` and attaches it in WhatsApp
  Web. The composer says this in plain words instead of hiding a disabled button.
- **Text only / Open WhatsApp** — the existing `wa.me` hand-off remains.
- `tokenMessage({ withSlip: true })` adds one line: *"Your token slip (T-14) is
  attached as an image — please show it at the desk."* Opt-out and unusable-number
  refusals still win, and `opened` / `sent` / `copied` are logged exactly as before.

A **WhatsApp Cloud API** send would need a server, a phone-number ID and a token;
that is a different product decision, not a missing dependency. Recorded as a
deviation in `docs/ARCHITECTURE.md` §4.1.

**One source of truth.** `tokenSlipSvg(model)` returns a standalone SVG — explicit
`xmlns`, width, height and viewBox, inline fills, a system font stack, no external
image/font/stylesheet — so it can be rendered by React as a percent-encoded data
URI, printed, drawn onto a canvas and asserted in a test. The first draft used
`dangerouslySetInnerHTML`; the clean-clone gate caught it (`check:contributing`
allows no raw HTML opt-outs, and an untracked file is invisible to that scan).
An `<img>` is both safer and just as sharp, and it is what ships. Every human-supplied value is XML-escaped and
clipped (`A & "B" <b>` cannot inject markup, a long name cannot overflow the
box), and `brand_color` is sanitised to a hex colour before it reaches an
attribute. The four existing composer callers are unchanged: `slip` is optional.

**Verified.** 14 tests in `tests/token-slip.test.mjs` (colour/escaping/clipping,
the model reading the domain helpers, SVG self-containment, the data URI and XML
injection, filename, message line and five wiring ratchets); an SSR smoke at
`tools/token-slip-smoke/` with **41 checks** renders the real issued panel, the
composer with the slip preview and exact text, the desktop fallback, the composer
without a slip, the opt-out refusal, a hostile name, the inert print portal and
the whole issue form. **No change** to the schema, any RPC, the store, seeds or
`SCHEMA_VERSION`; the lib census goes to 50 modules (22 import nothing).

## [1.35.2] — 2026-11-02 · schema 19

**A date filter on Patient records / All.**

The register had a search box, a sort selector and five tabs — two of which are
already *fixed* date rules ("New this month", "Not seen recently") — but no way to
choose a date. A desk wanting "everyone registered in the first week of November"
could only export all patients and filter the CSV by hand.

| Change | File | Why |
| --- | --- | --- |
| pure date rules | `src/lib/patient-dates.mjs` (new) | no rule belongs inline in JSX; the two dates, the inclusive range and the presets are testable on their own |
| **Date to filter**, **From**, **To**, **Quick range**, **Clear dates** bar under the tabs | `Patients.jsx` | there was no date control at all |
| both **Registered** and **Last seen** selectable | `queue`-free `patient-dates.mjs` + page | the request did not say which date; covering both avoids guessing wrong |
| the filtered set feeds search, the All count, the list and Export | `Patients.jsx` | a filter that only changes the visible rows while Export writes everything is a trap |

- **Two dates, one picker.** **Registered** reads `created_at` (the default, and the
  same date the "New this month" tab uses); **Last seen** reads the permission-aware
  `lastSeen(p.id)`, which falls back to completed appointments when the front desk
  cannot read consultation rows. The page passes `(p) => lastSeen(p.id)` into the
  pure module — the first draft passed `lastSeen` directly, whose argument is an
  **id**, not a row, and "Last seen" silently matched nobody. Caught by the SSR
  smoke, not by reading the code.
- **Inclusive range, no surprises.** `isoDay()` takes the first ten characters of a
  timestamp or a plain date and refuses impossible days (`2026-02-30`); a
  half-typed bound is dropped rather than treated as an error; a reversed range
  shows *"The start date is after the end date."* in a `role="alert"` block and
  keeps every row rather than showing an empty register. A row with no date is
  excluded while a filter is active, and an inactive filter returns the **same
  array** it was given — so with no dates set the register is exactly what it was.
- **Quick ranges.** Today, Last 7 days, This month, Last 30 days and Last 90 days,
  all ending on the clinic's local day and inclusive of both ends. Editing a bound
  by hand clears the preset so the selector never lies about what is selected.
- **One filtered set, everywhere.** `dateScoped` feeds `patientSearch`, the `All`
  tab count, the list, the "N patients" head and `exportCsv`. An `aria-live` line
  states the field, the range and the match count — *"Registered 1 Nov – 10 Nov ·
  3 of 6 patients"*. `?from=…&to=…&dateField=…` opens a pre-filtered register
  (sanitised through `isoDay`), which also makes a filtered view server-renderable.
- **Verified.** 10 tests in `tests/patient-dates.test.mjs` pin the two fields, the
  presets' arithmetic, inclusive bounds, reversal, undated rows, the permission
  callback and three page-wiring ratchets. An SSR smoke at
  `tools/patient-dates-smoke/` (28 checks) renders the real screen: the unfiltered
  register with every control and `All (6)`, a `1–10 Nov` range with only the three
  in-range names, the **Last seen** field matching visits rather than
  registrations, a reversed range showing the alert while keeping all rows, and a
  malformed link that opens plain rather than broken.
- **Plan.** This request was not in the original nine; it is item 11 of
  `docs/PLAN-v1.33.md` (§11) and ships as a patch release, v1.35.2, so items 3–9
  keep their slots. The lib census goes to 48 modules (22 import nothing) in
  `docs/ARCHITECTURE.md`. **No change** to the schema, any RPC, the store, seeds
  or any other screen.

## [1.35.1] — 2026-11-02 · schema 19

**Separate Consult / Done for each token in the room.**

Asked for after v1.35.0 shipped: *"Now in the room need saparate info like
Consult/Done for each token in room talking and Waiting in room"*. v1.35.0 showed
both people but kept a **shared** action row at the bottom of the card — one
**Consult** that only ever opened the first patient (`row.seats[0]`) and a row of
**Done** buttons detached from the person they completed. With two patients in the
room, "Consult" was ambiguous and the second patient had no consultation control
at all.

| Change | File | Why |
| --- | --- | --- |
| each seat is a self-contained block: token, name, wait, status badge, **Consult**, **Done** | `Queue.jsx` | the actions belonged to the card, not to the patient |
| `consultLabel` / `doneLabel` / `token` on every seat | `queue.mjs` (`roomSeats()`) | two identical "Consult" buttons are indistinguishable; the naming rule must not be written inline in JSX |
| `Consult` opens `seat.appt`; `Done` completes `seat.appt` | `Queue.jsx` | v1.35.0's Consult was hard-wired to `row.seats[0]` |

- **Both seats get both buttons.** The Talking token (T-09, large) and the Waiting
  in room token (T-10, small type) each render their own information and their own
  two actions. With two people in the room the labels name their token —
  **Consult T-09 / Done T-09** and **Consult T-10 / Done T-10** — with matching
  accessible names (`aria-label="Consult T-09"`, `aria-label="Mark T-09 done"`),
  so the desk can never open or finish the wrong patient by mistake. With one
  person the labels stay plain **Consult / Done**.
- **The second seat's information is richer too**: it now shows the patient's name
  in bold small type, their wait (`humanWait(waitedMinutes(appt))`) and their
  appointment time, alongside the **Waiting in room** badge — not just a token.
- **"Call … in" stays a card-level action.** It is the only button left outside a
  seat, because it acts on the *next* patient at the desk rather than on anyone in
  the room. The `2 / 2` badge, the disabled "Call next" and the on-screen refusal
  are unchanged.
- **Rules stayed pure.** `roomSeats()` now returns `token`, `consultLabel` and
  `doneLabel` computed from the number of people in the room; the page only renders
  them. `tests/queue-room.test.mjs` gains 2 tests (the labels for one, two and
  three seats, and a ratchet that both buttons are bound to `seat.appt` inside the
  seats map rather than a shared row). The SSR smoke gains 9 checks: each token's
  own Consult and Done by accessible name, exactly two of each, no unlabelled
  shared button, and a one-seat board with exactly one plain pair that still offers
  the second call.
- **No change** to the room limit, the board's shape, the schema, any RPC, the
  store, the display or the dashboard. Recorded in `docs/PLAN-v1.33.md` §5 and
  `docs/ARCHITECTURE.md` §4.1.

## [1.35.0] — 2026-11-02 · schema 19

**"Now in the room" shows everyone in the room — both of them.**

A consulting room holds two patients: one talking, one waiting inside. The board
only ever returned the first, so a second patient called in was in the data and
invisible on every screen. Asked for as: *"Now in the room should show whos in
room the limit is 2 all 2 should able to see in room … if T-09 is Talking then
next T-10 is wating in room should visibel in small font"*.

| Change | File | Why |
| --- | --- | --- |
| `inRoom` (all tokens), `roomCount`, `roomLimit`, `canCallNext`, `roomFull`, `seats` | `queue.mjs` | `queueBoard()` returned exactly one `serving` (`in-consult`, first by token), while "Call next" flipped a second token to `in-consult` unconditionally |
| the first seat **large / Talking**, the rest **small type / Waiting in room**, and a `N / 2` badge | `Queue.jsx` | the card showed one person and labelled the whole room "Talking" |
| one gate on all three call-in controls | `Queue.jsx` | "Call next", the room card and every table row each wrote `in-consult` with no limit check |
| the display lists both tokens; "Please wait" when full | `Queue.jsx` (`WaitingDisplay`) | the lounge told a third patient to "Proceed" into a full room |
| "N in the room" counts **people**, and the strip lists both tokens | `Dashboard.jsx` | the count counted doctors with someone in the room, not the people in them |

- **The bug, precisely.** `queueBoard()` built `serving` as
  `mine.filter(a => a.status === 'in-consult')[0]`. "Call next" then did
  `setStatus(row.next, 'in-consult')` with no guard, so a second call produced two
  `in-consult` rows while `serving` still named only the first. The queue card, the
  waiting-room display and the dashboard all read that single value — the second
  patient appeared nowhere. The board now returns `inRoom` in token order and keeps
  `serving` as `inRoom[0]`, so every older reader is untouched.
- **One limit, one place.** `ROOM_LIMIT = 2`, `canCallNext(inRoom)` and
  `roomFullMessage(inRoom)` are pure functions in `src/lib/queue.mjs`; the two seat
  labels come from `roomSeats(inRoom)` (first `Talking`/`accent`, the rest `Waiting
  in room`/`warn`), not from an inline JSX conditional. `logic.mjs` re-exports all
  four by identity — its surface goes from 88 to **92** names, and
  `tests/logic-modules.test.mjs` is repointed to 92, not weakened.
- **Every door uses the same gate.** `callIn(row, appt)` is the only function that
  writes `in-consult`. It recomputes `queueBoard()` from the store **at click time**
  rather than trusting the row that was rendered (a stale tab can still show one
  seat free), and holds the token id in a ref while the write is in flight so two
  fast clicks cannot use the same seat twice. "Call next" is additionally disabled
  with the reason on screen; the table-row buttons stay enabled so pressing one on
  a full room shows the toast: *"Room is full — T-09 and T-10 are already in the
  room. Mark one as seen before calling another."* Nothing is written.
- **The third screen.** The waiting-room display lists both tokens (the second in
  small type) and switches "Please proceed" to "Please wait" when both seats are
  taken. The dashboard's total now counts people, so "2 in the room" with one
  doctor is correct for the first time, and its token strip prints `T-09 · T-10`.
- **Verified by rendering, not only by reading the rules.** `tests/queue-room.test.mjs`
  (12 tests) pins the two seats, the refusal sentence, the people-vs-doctors count,
  a call filling the second seat, completing one freeing it, the unchanged
  one-token board, the barrel identities, and three page-wiring ratchets with
  comments stripped before matching. An SSR smoke at `tools/queue-room-smoke/`
  renders `<Queue />` and `<WaitingDisplay />` with T-09/T-10 in the room: both
  tokens are present, T-09 is the only 1.7rem span, T-10 sits in a `tiny` span,
  `2 / 2` and the refusal are on screen, "Call next" is disabled, T-11 stays at
  the desk, no `undefined`/`NaN`/`[object Object]` leaks, and a one-seat board
  still offers the second call.
- **Plan order.** `docs/PLAN-v1.33.md` item 5 was scheduled as v1.37.0; it ships
  now as **v1.35.0** because it was asked for next, the same reason onboarding
  shipped as v1.34.0. Items 3 and 4 move to v1.36.0 and v1.37.0; items 6–9 keep
  their slots. Recorded in the plan's status line and in `docs/ARCHITECTURE.md` §4.1.
- **No change** to the schema, to any RPC, to `store.update()`, or to seeds and
  existing data. A clinic with one person in the room sees exactly the card it saw
  yesterday, plus a `1 / 2` badge and a "Call … in" button for the free seat.

## [1.34.0] — 2026-11-02 · schema 19

**"Set up your clinic" now keeps the answers it asks for.**

The first screen every clinic sees was three steps of questions and three ways of
losing the replies: the clinic's phone and the doctor's phone were the same field,
the hours and the follow-up window were collected and dropped by the database, and a
fee that could not be read quietly became ₹500.

| Change | File | Why |
| --- | --- | --- |
| clinic phone and doctor phone are **two fields**, judged by **two rules** | `onboarding.mjs`, `Onboarding.jsx` | both steps bound `form.phone`; the last edit won and the clinic was created with the doctor's mobile as its contact number |
| hours, days off, sessions, GSTIN, follow-up window, doctor's registration are **written** | `schema.sql` (§19), `schema-tests.sql` | `create_clinic()` inserted the name, type, phone, email, address, two fees and the slot length — and nothing else; a clinic set up as 10:00–19:00, Sunday closed, was created at 09:00–20:00, open every day |
| every step validates **before** it advances | `onboarding.mjs`, `Onboarding.jsx` | only a name and a doctor's name were checked, at the last click, which then jumped the person backwards |
| a bad fee is an **error on the field**, not a silent default | `onboarding.mjs` | `try { moneyToPaise } catch { keep defaults }` meant "abc" charged ₹500 |
| a **review** step, and the draft **survives a reload** | `Onboarding.jsx`, `onboarding.mjs` | there was no summary before the button that creates a clinic, and a reload lost a half-filled address |
| "You can change all of this later", naming where | `Onboarding.jsx` | a first-run screen should not read as a contract |

- **The bug, precisely.** `form.phone` was bound in step 1 as the clinic's contact and
  in step 2 as the doctor's own number. Whichever was typed last reached
  `create_clinic()`, and the other was gone — so a clinic that typed its landline and
  then the doctor's mobile was created with the mobile as the front-desk number. The
  form now carries `clinic_phone` and `doctor_phone`, and the RPC puts each on the row
  it belongs to. They are also not the same *kind* of number: the clinic may be a
  landline (`022 4000 1200`, an STD code a patient can dial), while the doctor's must
  be a mobile (`6–9…`), because that is where a recall message goes.
- **A new schema release, and why it was not avoidable.** The set-up screen has always
  sent `open_time`, `close_time`, `follow_up_days`, `sessions`, `closed_weekdays`,
  `gstin`, `registration_no` and the doctor's day window. `create_clinic()` read none
  of them, so every clinic in the product started on the defaults regardless of what
  was typed — silently, because the created clinic looked fine. A client-side second
  write would have left a window in which the clinic exists with wrong hours, and
  would not have fixed the doctor's row at all. Schema 19 therefore replaces one
  function body: no column added, no default changed, every new key optional.
- **Backwards compatibility is the contract.** Every value is checked against the
  constraint that already governs its column — times by shape, `slot_minutes` against
  the seven allowed lengths, `follow_up_days` clamped to the column's 3–45 (it is
  *not* the 0–180 the original column carried before schema 12), fees inside
  0–99,999,999, weekdays to 0–6, sessions through `sessions_valid()` — and anything
  that does not fit falls back to the pre-v1.34.0 default. A payload with only a name
  creates exactly the clinic it created before, which is the case the older clients
  in the field will keep sending. `SUITE M` in `supabase/schema-tests.sql` pins all
  four cases: the full payload, the doctor's row, the name-only payload, and a
  deliberately unreadable one.
- **Verified against a real database.** The four `SUITE M` cases were run on
  PostgreSQL 17 with an `auth` stub (`auth.uid()`, `auth.jwt()`, `request.jwt.claims`
  as Supabase provides them): the whole schema applies cleanly, `app_schema_version()`
  reads 19, and a clinic created with 10:00–19:00, Sunday and Saturday closed, a
  21-day follow-up and a 20-minute slot reads back with every one of those values on
  the clinic row and the doctor's own phone, registration number, hours and fees on
  the staff row. §19 carries the version guard every earlier migration has, so
  re-applying the whole file on a database already at 19 skips it cleanly, and the
  file stays **one transaction** — a paste that fails half-way leaves nothing
  behind (the property `tests/schema.test.mjs` asserts).
- **The rules moved out of the page.** `src/lib/onboarding.mjs` holds the form's blank
  shape, the three validators, the two payload builders, the review rows and the draft
  (22 tests, `tests/onboarding.test.mjs`). Two of its tests are ratchets: the payload's
  key list must be a subset of what `create_clinic()` reads, and the SQL's follow-up
  clamp must equal `FOLLOW_UP_MIN_DAYS`/`FOLLOW_UP_MAX_DAYS` from `hours.mjs` — the
  same mirror-and-authority check that caught the plan prices being 10× too high in
  v1.28.0.
- **Smaller, in the same spirit.** The day's span (`open_time`/`close_time`) is derived
  from the sessions, so the legacy pair every pre-schema-12 screen still reads always
  describes the whole day; a second session is validated by `validateSessions()` — the
  function the Settings screen uses — so an overlap or a ten-minute session is caught
  here in the same words; the resume step is computed in the `useState` initialiser
  rather than an effect, so the first paint is already the right step; and the review
  body is a `ReviewStep` component so it can be rendered on its own (proved by an SSR
  smoke that renders all four steps and fails on a stray `undefined`, `NaN` or
  `[object Object]` in the text).
- **No change** to any other screen, to the RPC's signature, or to the client's
  `store.createClinic({ clinic, owner })` contract — only what travels inside the two
  jsonb payloads, which the function treats as optional.

## [1.33.0] — 2026-11-02 · schema 18

**Nine requests → one plan, and the first two shipped.**

`docs/PLAN-v1.33.md` turns the batch into eight releases, lowest risk first, each
ending with the full gate set: the follow-ups recall diagnosis, empty drug lines,
two patients in the room, a payment recorded once, owner-only invoice cancellation,
patient registration, and branches (which needs a schema release and three decisions
from the owner). This release is the plan plus its first item.

| Change | File | Why |
| --- | --- | --- |
| the **links** scroll, the rest is pinned | `styles.css`, `AppLayout.jsx` | `.sidebar` was a `100dvh` flex column with **no overflow**, so on a 1280×720 laptop the last links and the account row fell off the bottom and could not be reached |
| **Sign out** beside the account row | `AppLayout.jsx` | signing out existed only in Settings → My account and the mobile drawer; a shared front-desk machine had no way out of the sidebar |

- **The bug, precisely.** A flex child refuses to shrink below its content height
  unless it is told it may, so the column silently overflowed the viewport instead of
  scrolling. `.sidebar-scroll` wraps only the nav groups and carries
  `flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain;
  scrollbar-gutter: stable` — the gutter so the labels do not shift when the scrollbar
  appears, and `contain` so scrolling the menu never scrolls the page behind it. The
  brand stays at the top, `.sidebar-foot` (plan card, account row) is `flex: 0 0 auto`
  at the bottom, and `.sidebar` itself is `overflow: hidden` so nothing can leak past
  the edge. The mobile drawer renders the same fragment, so both paths agree.
- **One way out, two doors.** `handleSignOut()` replaces the drawer's inline lambda and
  is used by both the drawer and the new sidebar icon button: one call to `signOut()`,
  one `navigate('/')`, a `signingOut` guard so a double click cannot sign out twice,
  `aria-label`/`title` for keyboard and screen-reader users, `disabled` while it runs,
  and **absent** in a demo workspace rather than dead.
- **Six new tests** (`tests/sidebar-nav.test.mjs`): the sidebar does not scroll and the
  links do, with `min-height: 0` present; the foot is outside the scroller and cannot
  shrink; all twelve destinations are still inside the region (the wrapper dropped
  none); sign-out is one implementation used by two controls, with the guard,
  the configured gate and the accessible name; and the drawer still carries its own.
- **Proved by rendering, not only by reading.** A shell smoke (kept at
  `tools/nav-smoke/`, not shipped) server-renders `<AppLayout>` inside the real store
  and auth providers: the scroll region is in the markup, all twelve destinations
  render inside it, and the sign-out control is **absent** in the demo build and
  **present** when a session is stubbed — the two runs differ exactly as they should.
- 600 tests across 34 suites, build clean, `check:pages` ✓, `check:contributing` 28/28,
  security suite ✓.

## [1.32.0] — 2026-11-02 · schema 18

**Architecture plan, step 5 sub-release 2 of 4: the licence composition leaves the
provider.**

`license.mjs` already decided what a subscription *means* — `licenseState`,
`canWrite`, `seatUsage`, `billingPeriod`, `extendPeriod`, all pure and all tested.
What sat inside `StoreProvider` was the composition around it: whose answer wins,
which writes are refused, and the row a demo click writes.

| File | Lines | Holds |
| --- | --- | --- |
| `src/lib/licensing-adapter.js` | **new** 121 | `resolveLicense`, `seatUsageCounts`, `writeGate`, `assertCanWrite`, `assertPlanIsLocal`, `demoPlanChange`, `demoRenewal`, `demoTrial` |
| `src/lib/store.jsx` | 999 → **981** | calls those once each, and passes the clock nowhere it does not need one |

- **Three restated rules became three named functions.** Every write path funnelled
  through `assertWritable`, every plan action restated "Central owns the plan", and
  the seat counts were three inline `filter`s. Now `assertCanWrite`,
  `assertPlanIsLocal` (applied at exactly three call sites, and a test counts them)
  and `seatUsageCounts`.
- **Two facts that were one expression.** `writeGate({ mode, license })` returns
  `{ writable, readOnly }` because the app has always had both: what a screen shows
  and what a write path enforces. They differ in exactly one case — a **demo**
  workspace shows itself writable (there is no server to refuse it) while its own
  lapsed sandbox trial still blocks the write. That was two different expressions on
  adjacent lines; it is now one function and a paragraph saying why. Collapsing them
  would either grey out every demo button or let a lapsed demo keep writing.
- **Central's silence is read-only, not free.** `resolveLicense()` holds the rule that
  a configured Central outranks the clinic's own row — a plan the clinic can write is
  a plan it can award itself — and that "Central has not answered yet" reads as
  `read_only` on the fallback plan. That row is one frozen constant, and the resolver
  hands back a fresh licence each call so no caller can mutate the shared one.
- **The demo arithmetic is named.** `demoPlanChange` (a plan starts now, ends one
  billing period later), `demoRenewal` — a payment buys the subscription's own term,
  twelve months on a yearly plan, never the hard-coded 30 days that once made a yearly
  clinic look broken — and `demoTrial` (the default plan, fourteen days out, keeping
  the row it was given). All three take `now`, so all three are deterministic.
- **The refusal sentences have one home.** `WRITE_BLOCKED_MESSAGE` moved here;
  `CENTRAL_MANAGED_MESSAGE` is imported and re-exported from `central-sync.mjs`
  rather than retyped, and a test fails if the sentence is ever copied.
- **Thirteen new tests** (`tests/licensing-adapter.test.mjs`): whose answer wins with
  Central on, off and silent; the seat split, including that only `active: false`
  hides a seat; the write gate across six statuses in both modes, including the demo
  divergence; both refusals; the three demo rows, including the yearly-renewal
  arithmetic and a nonsense term falling back to the plan's period. Plus the ratchet:
  `store.jsx` under 990 lines, no `licenseState`/`canWrite`/`billingPeriod`/
  `extendPeriod` call left in it, and the adapter importing neither React, Supabase
  nor the store.
- **One test repointed, not weakened.** `tests/subscription.test.mjs` asserted the
  renewal arithmetic lived in `store.jsx`; it now asserts it in the adapter, keeps the
  hard-coded-30-days guard on **both** files, and adds that the provider delegates
  (`demoRenewal(...)`) instead of growing a second period calculation.
- **A shipped defect this release also fixes.** Bumping the version with a shell
  rewrite truncated `package-lock.json` to zero bytes, and it was committed that way:
  every gate stayed green because the suite needs no dependencies to run, but
  `npm ci` refuses to install without a lock, so a fresh clone could not build. The
  lock is restored from v1.31.0 with the version bumped as text, and two tests now
  hold the line — the lock must parse, be a real lock, agree on the version with
  `package.json` and lock every declared dependency, and `version.js` must agree too.
  Found by the clean-clone verification, which is exactly what it is for.
- **No behaviour change and no API change.** `useStore()` returns the same keys; the
  licence, its seats, `writable` and all three plan actions behave as before.
  594 tests across 33 suites, build clean, `check:pages` ✓, `check:contributing`
  28/28, security suite ✓, and the provider smoke (demo build, no Supabase project)
  still renders with `writable:true · seats:3`.

## [1.31.0] — 2026-11-02 · schema 18

**Architecture plan, step 5 sub-release 1 of 4: the outbox and the cache leave the
provider.**

`store.jsx` was 1,031 lines with thirteen imports. `offline.js` already held the
queue itself — keys, TTL, `enqueue`, `backoffMs`, `classifySyncError`, the pure
`replayOutbox` — but the three parts that touch React and Supabase were written
inline inside `StoreProvider`, and nothing could reach them: not a unit test, not a
fake database, not a private-mode browser.

| File | Lines | Holds |
| --- | --- | --- |
| `src/lib/offline-queue.js` | **new** | `FLUSH_INTERVAL_MS`, `flushGuard`, `syncStateAfterFlush`, `supabaseOutboxDb(client)` |
| `src/lib/offline-cache.js` | **new** | the demo snapshot, `mirrorState`, `mergeRemoteRow`, `clearDemoSnapshot` |
| `src/lib/store.jsx` | 1,031 → **999** | the provider, now composing those decisions |

- **The four guards became a nameable answer.** `flushGuard({ mode, userId, online,
  flushing, queued })` returns `{ skip, reason, state }` — `not-live`, `in-flight`,
  `offline`, `nothing-queued` — so the sync pill's value travels with the decision
  instead of being a side effect of an early return, and the two guards that must
  *not* touch the pill return no state at all. `syncStateAfterFlush({ stopped })`
  keeps the distinction the person reading the screen cares about: a `retry`
  verdict is *offline*, anything else is *error*.
- **The adapter is injected, not imported.** `supabaseOutboxDb(client)` is the code
  that was inline, moved verbatim, with the client as a parameter — so `selectOne`'s
  id-or-`client_id` lookup, `PGRST116` read as "not there yet", the throw-on-refusal
  of `insert`/`update` and the idempotent `remove` are all now testable with a fake
  PostgREST that records the calls it receives.
- **A regression the build cannot see, caught before release.** Building the
  adapter in a `useMemo` looked harmless; a demo workspace has **no Supabase client
  at all** (`supabase` is `null` when no keys are configured), so the first render of
  the demo build threw. The provider smoke at `tools/store-provider-smoke/` renders
  `<StoreProvider>` with no keys and fails on exactly that; the adapter is now built
  only when a client exists, and a test holds it. Proved by mutation: restoring the
  eager version crashes the smoke, restoring the guard passes it.
- **The demo key is named once.** The reset button in Settings spelled
  `'myclinic.demo.v1'` itself; it now calls `clearDemoSnapshot()`, so the key, its
  read-validate rule (*a snapshot without a clinic is no snapshot*) and its
  private-mode tolerance have one home.
- **Nineteen new tests** (`tests/offline-queue.test.mjs`, `tests/offline-cache-mirrors.test.mjs` —
  *not* `offline-cache.test.mjs`, which has held the cache-TTL suite since v1.19.1; the name
  collision was caught before commit, so no test was lost):
  the guard truth table, the pill's transitions, the adapter against a recording fake
  (by id, by client id, no rows, refusal, idempotent delete, and no client at all),
  the snapshot round-trip and its five unreadable shapes, the demo/quota failures,
  and the row merge — existing row, `client_id` match, unknown row to the front, input
  not mutated. Plus the ratchet: `store.jsx` under 1,000 lines, no insert or
  `PGRST116` handling left inline, `offline-queue.js` importing neither React nor
  Supabase nor the store.
- **No behaviour change and no API change.** `useStore()` returns the same keys; the
  flush reads the outbox once instead of twice (the guard now consumes the ops it
  checked), and the retry timer reads its interval from `FLUSH_INTERVAL_MS` instead of
  a literal `20000`. 579 tests across 32 suites, build clean, `check:pages` ✓,
  `check:contributing` 28/28, security suite ✓.

## [1.30.0] — 2026-11-02 · schema 18

**Architecture plan, step 4: `Settings.jsx` becomes eight tab components.**

969 lines, ten `{activeTab === …}` blocks interleaved with the page state, the two
save handlers and three modals. A change to the invoice footer and a change to the
sync card touched the same file, and every tab's markup sat between the clinic
form and the plan picker.

| File | Lines | Holds |
| --- | --- | --- |
| `src/pages/Settings.jsx` | **275** | tab list, shared form state, save + export actions, the eight panels |
| `settings/ClinicTab.jsx` | 198 | clinic profile, hours, days off, public booking |
| `settings/BillingTab.jsx` | 118 | GST, UPI handle and QR, receipt footer |
| `settings/PlanDataTab.jsx` | 112 | plan, seat meters, export/import, reset — with its two modals |
| `settings/AppearanceTab.jsx` | 107 | theme, accent, density |
| `settings/AboutTab.jsx` | 106 | build, schema, changelog, recent errors |
| `settings/AccountTab.jsx` | 66 | my details, password, sign out |
| `settings/BrandingTab.jsx` | 65 | the two logo uploads and the preview |
| `settings/SyncTab.jsx` | 62 | queue, conflicts, the way into sync centre |
| `settings/MiniStat.jsx` | 10 | the stat tile sync and about share |

- **Moves, not edits.** Every panel is the original block, verbatim: indentation,
  comments, copy, class names, conditionals. Verified rather than asserted — for
  all eight tabs the extracted markup is byte-for-byte the v1.29.0 block once
  whitespace is normalised, and server-rendering the whole page before and after
  produces the same 2,151 characters of text.
- **The page still owns the state.** `clinic`, `profile`, `prefs`, `saving`, the
  password fields, the theme and accent, the three modals' open flags and both save
  handlers stayed put; panels receive exactly the values they read and nothing else.
  `clinicState`, `canEdit`, `role`, the toast, the navigate hook and `useStore()` are
  resolved where they are used, so no tab is handed the whole store as a prop bag.
- **Nothing was dropped on the way out.** The split was generated from a scan of
  every page-level binding each block referenced; the two derivations a tab needs
  but cannot compute itself (`savedSlug`, `typedSlug → publicLink`, `slugPending`)
  were caught by that scan and are passed explicitly — a missing prop would have
  put the guessed booking link back.
- **Eight tabs, not ten.** The plan's step 4 said ten; `visibleTabs` has held eight
  ids since 1.26 (clinic, branding, billing, account, appearance, sync, about,
  plan), so eight components is the whole surface. The document is corrected.
- **`Settings.jsx` is 275 lines, not the planned 200.** The plan's own description
  of the finished page — "the tab list, the shared form state and the save actions"
  — is what remains, and `saveClinic` + `saveProfile` alone are 110 of those lines
  with their explanations. Reaching 200 would mean moving the save actions into a
  hook, which is a separate, reviewable change (and is noted as the next
  opportunity in `docs/ARCHITECTURE.md`).
- **Eight new tests** (`tests/settings-tabs.test.mjs`): every tab id has a panel and
  no panel exists without a tab; the tab order, the eight ids and the `'clinic'`
  default are unchanged; the four owner-only tabs are still inside `canEdit`; no
  panel imports the page back, imports from `src/pages` paths, or reads the store as
  a module singleton; `MiniStat` has one definition; no panel writes to the database
  except the plan switch it always made; and the ratchet — page under 300 lines,
  every panel under 200.
- **No behaviour change.** 560 tests pass, the build is clean, `check:pages` and
  `check:contributing` (28/28) are green, and the only test edited is
  `tests/booking-link.test.mjs`, which read the copy-booking-link markup out of
  `Settings.jsx` as text: two assertions now read `settings/ClinicTab.jsx`, and a
  third was added asserting the page passes `savedSlug` to the tab, so the property
  that test guards is stronger than before.

## [1.29.0] — 2026-11-09 · schema 18

**Architecture plan, step 3: `logic.mjs` split behind a re-export barrel.**

852 lines, 88 exports — money, dates, tokens, invoices, patients, the queue,
reporting, validation, CSV and the clinic defaults in one file, cohesive by
*language* rather than by *responsibility*. A date fix and an invoice fix sat in the
same file, and unrelated edits collided.

| Module | Lines | Holds |
| --- | --- | --- |
| `money.mjs` | 123 | paise in, paise out; formatting, words, payments, `sumBy` |
| `dates.mjs` | 116 | the clinic's local day, months, ages, slot times |
| `text.mjs` | 33 | initials, title case, ordinals, slugs |
| `ids.mjs` | 36 | patient codes, invoice and prescription numbers, `nextId` |
| `appointments.mjs` | 66 | status vocabulary, slot generation, the day's list |
| `invoicing.mjs` | 86 | lines, totals, status, balance, outstanding, visit fee |
| `patients.mjs` | 63 | history, frequency, recalls |
| `queue.mjs` | 112 | token numbers, waits, the per-doctor board |
| `reporting.mjs` | 126 | month totals, series, performance tables |
| `validation.mjs` | 47 | the guards that stop a bad row before Postgres does |
| `constants.mjs` | 141 | clinic vocabulary and new-workspace defaults |
| `csv.mjs` | 31 | CSV export and the download shim |
| **`logic.mjs`** | **26** | **re-exports all 88 names — nothing else** |

- **The move is invisible.** `logic.mjs` re-exports every name from the same module,
  so no call site changed and no existing test was edited — including the two
  screens and the store that import it by name.
- **Seven tests hold the split** (`tests/logic-modules.test.mjs`): every re-export is
  the *identical object*, not a copy (`barrel.formatMoney === money.formatMoney`);
  the public surface is still exactly 88 names; the private helpers of
  `amountInWords` (`trim`, `ONES`, `TENS`, the rupee-group walkers) stayed private;
  no part imports the barrel, so the split cannot become a cycle; the modules sit in
  one dependency direction (`money → dates → … → reporting`); no part exceeds 200
  lines and the barrel must stay under 60 — a ratchet against the file growing back.
- One test was repointed, not weakened: the RBAC suite read `logic.mjs` for
  `canSeeConsultations = true`, which now lives in `reporting.mjs`.

**552 tests / 28 suites**, 28/28 contributing checks, 0 warnings. The library is now
**43 modules, 21 of them pure leaves** (no imports at all).

## [1.28.0] — 2026-11-09 · schema 18

**Architecture plan, step 2: the client mirror is pinned to the SQL authority —
and it caught real drift on its first run.**

Every rule in this app exists twice on purpose: Postgres decides, `src/lib` mirrors
so the UI never offers what the server would refuse. Nothing tested the pair, so a
change on one side was silent on the other.

- **`tests/schema-parity.test.mjs`** reads `supabase/schema.sql` as text and compares
  it with the client vocabulary — no network, no Postgres, no new dependency:
  - `plan_seat_limit()` ↔ `PLAN_LIMITS` (caps per plan and per seat kind, including
    `null` = unlimited)
  - `plan_price_paise()` ↔ `PLAN_PRICE_PAISE` and `planPrice(plan, { interval })`
    (monthly **and** the 20 % yearly figure)
  - both `check (plan in (…))` constraints ↔ `PLAN_IDS`, and the column default ↔
    `DEFAULT_PLAN`
  - `clinic_subscriptions.status` ↔ the `LicenseStatus` typedef in `license.mjs`
  - a guard that the two functions still exist, so a rename cannot make every
    comparison pass vacuously

- **It found drift immediately.** `plan_price_paise()` quoted the yearly price at
  **ten times** the value the mirror computes:

  | Plan | Monthly | Yearly (mirror) | Yearly (SQL, before) |
  | --- | --- | --- | --- |
  | Solo | ₹999 | ₹9,590.40 | **₹95,904** |
  | Growth | ₹2,499 | ₹23,990.40 | **₹239,904** |
  | Multi-clinic | ₹5,999 | ₹57,590.40 | **₹575,904** |

  Nothing in `schema.sql` calls that function, so no invoice was ever wrong — which
  is exactly why nobody noticed, and exactly why the authority must not disagree
  with its mirror. The three constants are corrected; because the function is
  defined with `create or replace`, reapplying that block on an existing project
  replaces it in place (no data is touched, no column changes).

- **Proved to bite, not just to pass.** Mutating Growth's doctor cap from 5 to 6 in
  SQL fails the suite with *"PLAN_LIMITS in src/lib/plans.mjs has drifted from
  plan_seat_limit() in schema.sql"*. Reverted, green again.

**545 tests / 27 suites**, 28/28 contributing checks, 0 warnings.

**To pick up the SQL fix on an existing project:** re-run the licensing block of
`schema.sql` in the Supabase SQL editor (it is `create or replace`, so it is safe to
re-run); the app does not depend on it.

## [1.27.0] — 2026-11-09 · schema 18

**Architecture plan, step 1: one source for the plan vocabulary.**

Before this release the three plan ids were written down in eight files:

| File | What it kept |
| --- | --- |
| `lib/license.mjs` | caps, order, price table, seat-message names |
| `lib/logic.mjs` | the marketing catalogue (names, prices, taglines, features) |
| `lib/central-sync.mjs` | Central tier → plan |
| `lib/store.jsx` | two fallbacks (`'growth'`, `'solo'`) |
| `components/AppLayout.jsx` | the sidebar label, as a nested ternary |
| `pages/Settings.jsx` | plan name, price and both seat caps, as ternaries |
| `pages/Subscription.jsx` | its own `PLAN_BLURB` map |
| `pages/Team.jsx` | the seat line, as a ternary |
| `pages/Landing.jsx` | `plan.id === 'chain'` for the sales-led plan |

Adding a fourth plan was a nine-file edit, and a missed file showed itself as a
price on one screen disagreeing with the cap on the next.

- **`src/lib/plans.mjs`** now owns the vocabulary: `PLAN_IDS`, `PLAN_LIMITS`,
  `PLAN_PRICE_PAISE`, `PLAN_LABEL`, `PLAN_SIDEBAR_LABEL`, `PLAN_BLURB`,
  `PLAN_SEATS`, the `PLANS` catalogue and `CENTRAL_TIER_TO_PLAN`, plus the lookups
  that replace the ternaries — `planId()`, `planLabel()`, `planSidebarLabel()`,
  `planLimits()`, `planRow()`, `planPrice()`, `planForTier()`, `planNeedsSales()`.
  `DEFAULT_PLAN` is the middle plan (unknown input); `FALLBACK_PLAN` is the
  smallest (a licence failure must never read as an upgrade).
- **Public surfaces unchanged.** `license.mjs` re-exports `PLAN_LIMITS` /
  `PLAN_ORDER` / `planPrice`, `logic.mjs` re-exports `PLANS`, and
  `central-sync.mjs` re-exports `CENTRAL_TIER_TO_PLAN` — every existing import
  still resolves to the same object, so no call site and no test had to move.
- **Two intentional differences, both named.** A quoted plan id can no longer
  appear outside `plans.mjs` (enforced by a test that scans `src/`), and the seat
  message reads *"1 doctor seat … 5 doctor seats"* instead of *"1 doctors seat"*
  (the count now agrees with the noun; one existing assertion updated).
- **9 new tests** (`tests/plans.test.mjs`): order and defaults, catalogue-vs-map
  agreement, normalisation of unknown input, monthly/yearly pricing and the `null`
  for a plan not on sale, the sales-led plan, tier translation, the re-exported
  names, and the licence rules behaving exactly as before the move.

The database is still the authority for caps and prices; `plans.mjs` is its
mirror. **Step 2** (`tests/schema-parity.test.mjs`) pins the two together.

**538 tests / 26 suites**, 28/28 contributing checks, 0 warnings.

## [1.26.1] — 2026-11-09 · schema 18

**`docs/ARCHITECTURE.md`: the design, measured, with the debt written down.**

No application code changed in this release. The new document records:

- **The shape**: a functional core with an imperative shell — 30 modules under
  `src/lib`, **17 of which import nothing**; one class in the app
  (`ErrorBoundary`, because React requires it); the dependency arrow points down
  only (`grep 'import .*components/' src/lib` returns nothing); Postgres is the
  authority and the client is its mirror.
- **The SOLID scorecard**, graded in the functional translation of each letter
  because there are no interfaces or hierarchies to substitute into:

  | Principle | Grade | The measurement behind it |
  | --- | --- | --- |
  | Single Responsibility | C+ | pure leaves vs `store.jsx` 1,030 lines, `Settings.jsx` 965 / 10 tabs, `logic.mjs` 88 exports |
  | Open/Closed | B− | 2 `switch` statements in all of `src/`; a new refusal code = 2 files, a new plan = 8 files + `schema.sql` |
  | Liskov | n/a → B | no hierarchies; one silent widening (`PLAN_LIMITS[plan] ?? growth`) |
  | Interface Segregation | C | 32 files call `useStore()`, which spreads `...state` and publishes 30+ keys |
  | Dependency Inversion | A− | 3 files import the Supabase client; `central-sync.mjs` takes `fetch`/`storage`/`now` |

- **The honest failures**: the store god object; the plan vocabulary in eight
  files; every business rule duplicated between JavaScript and SQL with nothing
  testing the pair; `logic.mjs` as a "utils" gravity well.
- **The DIP lesson from 1.25.1**, stated as a rule: *injection without a default,
  and without a test through the real boundary, is an incompleteness — not a
  virtue.*
- **A five-step refactor plan ordered lowest risk first**, one release each:
  1. `src/lib/plans.mjs` — one source for the plan vocabulary (v1.27.0)
  2. `tests/schema-parity.test.mjs` — fail when the JS mirror and the SQL
     authority disagree (v1.28.0)
  3. `logic.mjs` split behind a re-export barrel, no call site touched (v1.29.0)
  4. `Settings.jsx` split into its ten tabs (v1.30.0)
  5. `store.jsx` split by capability in four sub-releases, ending with
     `DataContext` + `ActionsContext` + selector hooks (v1.31.0+)

  Each step lists its acceptance check, its blast radius and its rollback. The
  standing rules for all five: no new dependency, no public API change, no
  behaviour change, no test deleted, version bumped in lockstep.

**529 tests / 25 suites**, 28/28 contributing checks, 0 warnings.

## [1.26.0] — 2026-11-09 · schema 18

**One ending for every visit, and three things taken off the screens they were
cluttering.**

### The visit flows token → consultation → prescription → invoice → follow-up

The audit, before the change — the same save, five different endings:

| Saved from | What happened |
| --- | --- |
| Dashboard | “Chart updated. Billing is one tap away.” — while the invoice that save had just raised was hidden behind Billing → the invoice |
| Token queue | nothing at all |
| Appointments | nothing at all |
| Consultations list | jumped to the invoice, skipping the prescription slip the patient was waiting for |
| Patient chart | same jump to the invoice |

- **`src/lib/visit-flow.mjs`** (pure, 12 tests) holds the five steps and answers
  the two questions those screens were each guessing at: *where is this visit*
  (`visitFlowState`) and *what is the next step* (`visitNextActions`). A visit is
  complete when the patient has a slip, a bill and a return date — not when the
  note was saved.
- **`VisitNextSteps`** is the one ending, mounted once in all five places: a chip
  row (Token ✓ · Consultation ✓ · Prescription · Invoice · Follow-up), a summary
  of the chart, the invoice and the follow-up, and a footer that offers only what
  is missing — **Collect ₹x**, **Print slip**, **Follow-up 19 Nov**. The first
  entry is the primary button, in the order the counter works: money, then the
  slip, then the return date.
- **No duplicate bills from the queue.** “Bill” was unconditional on every
  completed token, so a second tap after “Save & bill” raised a second invoice for
  the same visit. `invoiceForVisit()` matches on `appointment_id` first, then on
  *this patient, that day*, never on a voided invoice — so the button now reads
  **Collect ₹x** and opens the payment sheet on the bill that already exists, and
  only says **Bill** when nothing has been raised.
- **The follow-up is one tap:** prefilled with the date the doctor wrote down (or
  the clinic's `follow_up_days`), the same doctor, and a reason taken from the
  diagnosis.

### Off the screens

- **Settings → Plan & data:** the link to `#/setup` is gone. The setup guide is a
  developer page; the owner-facing tab no longer advertises it. (The one remaining
  link lives in *My account* and only renders in an unconfigured build, where it
  is the only useful thing on the card.)
- **Dashboard:** the **Day close** button is gone from the header. Day close keeps
  its sidebar entry and its screen for the role that holds `day:close`; it just no
  longer competes with *Issue token* on the home screen.
- **Subscription:** the **Central Auto-Sync** diagnostics card is no longer
  mounted. The component, its probe and its tests stay in the tree — it is the
  owner's debugging surface, not something a clinic should meet on the billing
  page.

**529 tests / 25 suites**, 28/28 contributing checks, 0 warnings.

## [1.25.2] — 2026-11-09 · schema 18

**The Cloudflare deploy never started.** The build was green; the deploy command
was not.

```
19:26:09  [plugin myclinic:scoped-obfuscation] obfuscated: license.mjs, central-sync.mjs
19:26:09  Success: Build command completed
19:26:09  Executing user deploy command: npx wrangler deploy
19:26:21  ✘ [ERROR] Error parsing file: /opt/buildhome/repo/vite.config.js
19:26:21  Failed: error occurred while running deploy command
```

- **What was wrong.** Nothing in `vite.config.js` — it is valid ESM and `vite
  build` consumes it happily. With no wrangler configuration present, `wrangler
  deploy` cannot tell what it is deploying, so it falls back to *framework
  detection*: it bundles `vite.config.js` with esbuild to read it. That follows
  the config's `javascript-obfuscator` import into Vite's own rolldown graph,
  which dynamically reaches for two optional peers this project deliberately does
  not install (`esbuild`, `@vitejs/devtools/config`). The resolution failure is
  reported as **"Error parsing file"** — which reads like a syntax error in a
  file that is fine, and sends you looking in the wrong place.

  Reproduced locally with the same wrangler 4.158.0 against this repo: the same
  message, and `esbuild --bundle vite.config.js` names the two unresolved peers.

- **The fix.** `wrangler.jsonc` at the repository root declares
  `assets.directory: "./dist"` and **no `main`**, so there is no Worker script to
  detect and nothing to bundle. Verified with `wrangler deploy --dry-run`:
  `✨ Read 31 files from the assets directory /home/user/myclinic/dist`,
  `Total Upload: 0.32 KiB` — assets only. `not_found_handling` is deliberately
  `none`: hash routing means the server is only ever asked for `/` and real
  files, and an SPA fallback would answer `200` + `index.html` for a missing
  hashed chunk, turning a broken deploy into a white screen.

- **Cache policy travels with the files.** `public/_headers` ships in the build,
  so Workers, Pages and Netlify alike serve `index.html` and `sw.js` with
  `no-cache, must-revalidate` and `/assets/*` as
  `public, max-age=31536000, immutable`. A CDN-cached `sw.js` pins the whole
  clinic to an old bundle for the TTL — the deploy reports success and the app
  behaves stale, which is the worst failure shape there is.

- **Tests.** Three cases in `tests/deploy-config.test.mjs` read the deploy config
  from disk: `assets.directory` is `./dist`, no `main`, `not_found_handling` is
  `none`, and `_headers` keeps the worker and the shell uncached. Detection
  cannot come back by accident. **517 tests.**

- **Deploying elsewhere changes the origin** — and `p_origin` is part of the
  licence check. If this build is served from `https://<name>.<subdomain>.workers.dev`
  or a custom domain rather than `https://rajeshlande.github.io`, the Central
  subscription rows must carry that new origin **before** clients open it, and
  the new origin must be added to Supabase → Authentication → URL Configuration
  (Site URL + Redirect URLs), or confirmation and reset links bounce. A refusal
  deletes the sealed lease in the same call; there is no grace on a refusal.

## [1.25.1] — 2026-11-09 · schema 18

**The client never called Central. One missing dependency injection.**

- **What was wrong.** `syncCentralSubscription()` took `fetch` as an injected
  dependency so tests could run without a network — and no caller in the app ever
  passed one. `src/lib/central-sync.mjs` threw `no fetch` before opening a socket,
  the `catch` around it relabelled that build fault as "could not be reached", and
  the client fell into the offline branch. The central project has therefore
  received **zero** requests since the feature shipped: no `activated_machines`
  row, no `last_heartbeat`, nothing to show but *Awaiting Connect*. The published
  bundle, the key, the origin and CORS were all correct the whole time.

  Proof, against a scratch copy of the 1.25.0 module with `globalThis.fetch`
  stubbed: `code: offline`, `offline: true`, reason *"Central Auto-Sync could not
  be reached…"*, and **0 HTTP requests made**. Against the fixed module, the same
  call: `code: ACTIVE`, **1 request**. Both runs are in the release notes below.

- **The fix.** Both `syncCentralSubscription()` and `probeCentralReadiness()` now
  resolve their fetch as: the injected `fetchImpl` if given, else
  `globalThis.fetch`, else nothing. Every other injected dependency (`storage`,
  `now`) is untouched, as are the 8 s `AbortController` timeout, `mode:'cors'`,
  `credentials:'omit'` and `centralHeaders()` — `apikey` only, `Authorization:
  Bearer` only for a legacy `eyJ…` anon key, never a session JWT. No second
  Supabase client, no sealed-lease change: `CENTRAL_SEAL_FIELDS` and the v2 seal
  are exactly as they were.

- **A build fault can no longer masquerade as an outage.** No fetch anywhere →
  code `FETCH_UNAVAILABLE` and *"This build cannot make HTTP requests…"*, shown on
  the diagnostic card in red with its own sentence. Anything else thrown from the
  call → `CLIENT_ERROR`. The offline / `OFFLINE_GRACE` branch is now reachable
  only for a real transport failure: a `TypeError` from `fetch`, our own abort, or
  a 5xx. A build fault never reads the sealed lease and never says "could not be
  reached".

- **The card renders refusals verbatim.** Central's `code` and `reason` are
  printed as they arrive, `match_mode` when present, plus one explanatory sentence
  per code — `SUBSCRIPTION_NOT_FOUND`, `ORIGIN_MISMATCH`, `SEAT_LIMIT_REACHED`,
  `SUBSCRIPTION_PAUSED`, `SUBSCRIPTION_EXPIRED`, `RATE_LIMITED`, `INVALID_EMAIL`,
  `INVALID_ORIGIN`, `MISSING_IDENTITY`, `FETCH_UNAVAILABLE` — and the existing
  sentence about which pair (owner email + origin) Central compares against its
  pinned row.

- **Six regression tests, written the way the browser runs.** The old suite always
  injected a fake fetch, which is exactly why it could not see that the app
  injected none. The new ones go through `globalThis.fetch` and assert: one POST to
  `${url}/rest/v1/rpc/sync_clinic_subscription` with the central `apikey` and the
  `{p_email, p_origin, p_device_id}` body, a sealed cache entry and a mirror row on
  an allowed answer; the same for the probe with the health-check body and
  `schemaVersion`; `FETCH_UNAVAILABLE` (never `offline`, never `OFFLINE_GRACE`)
  when no fetch exists anywhere — including with a valid sealed lease on disk; and
  that a real `TypeError` and a real abort still reach the outage branch while a
  generic error becomes `CLIENT_ERROR`.

- 514 tests, 28/28 contribution rules, build, Pages check and `test:security`
  clean. No schema change, no new secret, no new dependency.

## [1.25.0] — 2026-11-09 · schema 18

**Central Auto-Sync is now observable from the client.** Every clinic showed
*Awaiting Connect* on the central dashboard, and nothing in myClinic said why.

- **Why Central could not say.** `public.sync_clinic_subscription()` inserts an
  `activated_machines` row only on the fully allowed path; every refusal
  (`SUBSCRIPTION_NOT_FOUND`, `ORIGIN_MISMATCH`, `RATE_LIMITED`,
  `SEAT_LIMIT_REACHED`, `SUBSCRIPTION_INACTIVE`) returns before it, and no attempt
  log exists. "The client never called", "the client called and was refused" and
  "this build has no central project" are the same picture there. The central
  project is unchanged; the client now reports itself.

- **What was ruled out, on the deployed site** (all checks re-runnable):
  `https://rajeshlande.github.io/myClinic/assets/index-*.js` contains **both**
  environment values — `VITE_CENTRAL_SUPABASE_URL = https://inaqzvzfongngahxptzw.supabase.co`
  and a central `eyJ…` anon key whose `ref` claim is the same project — so
  `centralSyncConfig()` is `enabled: true` and the Variables *did* reach the
  build. The zero-side-effect probe against that project answers
  `{"ok":true,"sync_ready":true,"schema_version":2}`, and the CORS preflight for
  `Origin: https://rajeshlande.github.io` is allowed. Reachability, key type and
  the RPC all check out, which leaves the **pair** — the owner email and the
  origin Central has pinned — and the client had no way to say so.

- **The card.** Settings → Subscription (owners only) gains **Central Auto-Sync**:
  configured yes/no with the config's own reason, the central host, live or demo
  mode, the resolved owner email **masked, with the field that produced it**
  (owner row / clinic / billing / session), the origin, the device id (first eight
  characters), and the last attempt — timestamp, allowed/refused, `status`,
  `code`, match mode and the RPC's `reason` verbatim. Offline attempts say so and
  print the sealed lease's `expires_at` / `grace_until`.

- **Two buttons, two different questions.** *Sync now* calls the existing
  `syncCentralNow({ silent: false })`, prints the outcome inline and is disabled
  while a request is in flight. *Test Central connection* calls the new
  `probeCentralReadiness()`, which posts `{p_email:'', p_origin:'',
  p_device_id:'healthcheck'}` with the existing 8 s timeout and
  `credentials:'omit'`, and reports `{ok, syncReady, schemaVersion, httpStatus,
  error}`. It never writes to Central, and it is held for ten seconds — in the
  store, not only in the button — because Central rate-limits per IP. The card
  labels it as reachability, never as a licence.

- **One resolver, one vocabulary.** `resolveCentralIdentity()` replaces the
  inline chain and returns `{email, source}`; `centralStateFromResult()` replaces
  the inline state mapping so a refusal's `code` + `reason` reach the screen (and
  a test) intact. `maskEmail()`, `centralHostLabel()` and `readCentralDeviceId()`
  keep a render from minting a device id or leaking an address. No second status
  vocabulary was invented: `centralStatusLabel`, `centralMatchLabel` and
  `CENTRAL_STATUS_LABELS` are reused.

- **What did not change.** The seal: `CENTRAL_SEAL_FIELDS` is still exactly
  `allowed|status|tier|plan|expires_at|grace_until`, the version is still v2, and
  `started_at` / `match_mode` / `server_time` remain unsealed — a seal change
  would cost every deployed device its cached lease. Still no key in the repo, no
  second Supabase client, no session JWT leaving this project.

- 508 tests (10 new: the origin-pair rule, the identity order and its source, the
  mask, the host label, a refusal's code reaching `centralState`, the probe's exact
  body and headers — legacy `eyJ` key repeated as a bearer, modern
  `sb_publishable_` key not — plus the unconfigured, dead-network, 404 and
  wrong-body branches, and device-id reads that mint nothing). 28/28 contribution
  rules, build, Pages check and `test:security` clean. No schema change.

## [1.24.0] — 2026-11-02 · schema 18

**The subscription card says plan, start and end — and the licence authority is
gone.**

- **One card, three facts.** *Your subscription* used to lead with a price and a
  "valid until"; it now leads with what a clinic is actually asked for:

  ```
  Plan            Start date          End date
  Growth          01 Nov 2026         30 Nov 2026
  ```

  Start is `license.startsAt`, end is `license.endsAt`. The monthly/yearly toggle
  and the price are printed only when the clinic licenses itself — a centrally
  issued plan has commercial terms this build has no business quoting.

- **Where the start date comes from.** Central's answer carries `started_at`;
  `current_period_start` is accepted as the same fact under its table name. The
  chain is RPC answer → lease → sealed cache → local mirror row
  (`clinic_subscriptions.current_period_start`) → `licenseState().startsAt`, and
  five tests walk it end to end, including the offline fallback. **To light the
  start date up, the central RPC must return that column** — until it does, the
  card prints `—` rather than guessing.

- **`started_at` is deliberately outside the seal.** `CENTRAL_SEAL_FIELDS` still
  covers the six fields that decide whether a clinic may write. A start date
  grants nothing, and sealing it would mean bumping the seal version, which
  would cost every device its cached lease on upgrade for no security in return.
  `CENTRAL_UNSEALED_FIELDS` says so, and a test edits the date in the cache and
  asserts the lease stays usable.

- **A trial's start is derived, and only a trial's.** `trial_ends_at − 14 days`
  is exactly how `start_trial()` writes a trial, so that one date is arithmetic.
  Every other licence shows its stored start or `—`.

- **The separate "Managed centrally (Auto-Sync)" card is gone.** Match mode,
  last-sync time, the offline-grace date, the seal sentence and the error and
  offline banners now sit under the dates they describe. The schema version is
  no longer printed on this screen at all; the build number stays, because
  support asks for it.

- **The licence authority is removed from the client.** Deleted:
  `src/lib/authority.mjs`, `src/lib/authority-sync.mjs`, that panel and its
  store surface (`authority`, `authoritySync`, `syncAuthority`) and the boot
  phone-home, `scripts/check-public-key.mjs` with `npm run check:key`,
  `tests/authority.test.mjs` and `tests/public-key.test.mjs`, the
  `VITE_LICENSE_PUBLIC_KEY` / `VITE_LICENSE_ISSUER` plumbing in `.env.example`
  and both workflows (including the forty-line "did the key reach the bundle?"
  diagnostic), and `docs/LICENCE-AUTHORITY.md`, replaced by a shorter
  [`docs/SUBSCRIPTION.md`](docs/SUBSCRIPTION.md) that documents what actually
  exists.

- **What deliberately stays.** Schema 18's `authority_*` columns,
  `apply_authority_license()` (`service_role` only) and the rule that a bound
  clinic cannot renew, change plan or restart a trial locally. Dropping columns
  is a data-loss operation, so the columns stay until a migration says otherwise;
  the refusal they raise is now worded "managed centrally", and the Subscription
  screen explains that Central owns the plan. The `sync-clinic-license` Edge
  Function and `npm run deploy:function` remain for older deployments, with the
  script saying plainly that nothing in the app calls it any more.

- 498 tests (down 44 with the two deleted suites, up 5 for the contract window),
  28/28 contribution rules, build and Pages check clean. No schema change, no new
  secret, no function deploy.

## [1.23.1] — 2026-11-02 · schema 18

**Nothing new to learn; less code behind it.** A full sweep for unreachable code,
run over every export, import, local, context value, file and CSS class in the
project.

- **19 exports deleted, each proved unreferenced first.** The test was not "does
  it look used" but "how many places in `src/`, `tests/`, `scripts/`, `supabase/`
  and `docs/` name it" — one hit, the declaration, meant dead:
  `logic.{appointmentDateTime, queueForDate, detectConflicts, DEFAULT_DOCTOR,
  isOpenStatus}`, `messages.{MESSAGE_KINDS, BUILT_KINDS}`,
  `public-booking.{bookingIsValid, localToday}`, `rx-language.TIMINGS`,
  `schedule.rescheduleDraft`, `permissions.whoCan`, `offline.dequeue`,
  `health.GO_LIVE_CHECKLIST`, `store.STATE_TABLES`, `supabase.configError`,
  `AppointmentForm.sortedUpcoming`, `Charts.useMemoSafe`,
  `CollectPayment.METHOD_ICON`, `demo-data.demoIds`.

- **64 unused import bindings across 27 files**, found by blanking every `import …from`
  span and then counting the name in the rest of the file — a name that appears
  nowhere else is an import that was carrying nothing. The trimmer asserts after
  writing that no dropped name is still referenced, because the first version of
  it silently dropped a live one.

- **The store no longer exposes values nothing read.** `signOutCleanup`,
  `acceptInvite` (a second, unused copy of the invite-accept path — the mount
  effect still calls the `accept_invite` RPC) and `setLicenseStatus` are gone from
  the context, along with the raw `centralConfig`. `Appointments.jsx` loses a
  `weekDays` memo and `Consultations.jsx` a follow-up badge that was computed for
  every row and rendered in none.

- **`styles.css` loses 23 classes no element carries** — the print header
  (`rx-head`, `rx-doctor`, `rx-meta`, `rx-card`, `print-foot`), the old day board
  (`slot-chip`, `schedule-cell`), the sparkline chart (`chart-wrap`,
  `chart-body`, `sparkline`, `bar-track`), `skeleton`, `toolbar-actions`,
  `sheet-safe`, `card-foot`, `field-label`, `radio`, `filter-row`, `dues-pill`,
  `table-scroll`, `card-title`, `btn.pill`, `.med-schedule.otc` and their
  `@media` counterparts. Only selectors whose class string appears nowhere in
  `src/`, `index.html` or `public/sw.js` were touched, so no rule that can match
  an element was removed. `tone-*` was kept: it is built as `` `tone-${tone}` ``.

- **Two loose ends the sweep exposed.** `store.jsx` still imported
  `clearAllCache` from the sign-out path deleted above; sign-out clears the cache
  in `auth-context.jsx`, which was always the live path. `PatientDetail.jsx`
  computed an `age` nobody rendered.

- 542 tests pass, `npm run verify` is clean, no schema change, no secret, no
  function deploy. The two obfuscated modules (`central-sync.mjs`, `license.mjs`)
  and their public surface are untouched.

## [1.23.0] — 2026-11-02 · schema 18

**Keyless central subscription auto-sync, and two modules obfuscated.**

- **What changed for an operator.** A clinic's plan, seat limits, expiry and
  pause switch are now issued by `myClinicLicenseAuthority` (schema v2, RPC
  `public.sync_clinic_subscription`). There is no `LICENSE_KEY`, no RSA key pair
  and no Edge Function involved: the central project exposes ONE public RPC and
  the browser calls it directly.

  ```
  POST ${VITE_CENTRAL_SUPABASE_URL}/rest/v1/rpc/sync_clinic_subscription
  { "p_email": "<owner email, lowercase>", "p_origin": "<this origin>", "p_device_id": "<per-browser id>" }
  ```

- **Cross-project isolation, by construction.** No second `@supabase/supabase-js`
  client is created — a second client would attach *this* clinic's session JWT to
  *that* project's requests. The call is a raw `fetch` whose only credential is
  the central project's publishable key (`Authorization` repeats it only for a
  pre-`sb_publishable_` anon key). A `sb_secret_…` key, or a JWT decoding to
  `service_role`, disables the feature with an error rather than shipping.

- **Owner email for every seat.** A doctor or a receptionist sees the same
  licence as the owner because the email is resolved as owner row → clinic email
  → billing email → signed-in user. `url`-only licences work with an empty
  email, which is why that chain ends at `''` rather than throwing.

- **A sealed 7-day offline grace.** Each answer is stored with a SHA-256 seal
  over the pepper, clinic id, origin, email, device id and
  `allowed|status|tier|plan|expires_at|grace_until`. Editing the plan or the
  expiry in `localStorage` breaks the seal, and the cache is deleted — the clinic
  becomes read-only rather than upgrading itself. On a network failure the sealed
  lease is honoured only while *both* dates are in the future. On any refusal —
  `SUBSCRIPTION_PAUSED`, `SUBSCRIPTION_EXPIRED`, `SUBSCRIPTION_NOT_FOUND`,
  `SEAT_LIMIT_REACHED`, `ORIGIN_MISMATCH` — the cache is deleted immediately and
  the effective subscription becomes
  `{ status: 'expired', plan: 'solo', collection_ref: <code> }`: writes stop,
  charts and exports do not. Being plain about the seal: it is tamper-*evident*,
  not tamper-*proof* — the pepper ships in the bundle. The real enforcement stays
  in Postgres and in the central project.

- **Auto-sync on the moments that matter**: on boot (cache first, then Central),
  on `online`, on `visibilitychange` → visible, and every 30 minutes, each
  listener and the interval removed in the same effect that added it. Local
  self-service (`changePlan`, `renewSubscription`, `startTrial`) throws
  `This clinic subscription is managed centrally.` while Central is configured.

- **The Subscription screen** gains a *Managed centrally (Auto-Sync)* card —
  plan, status, match mode, valid-until, last sync, the refusal reason, and a
  **Sync now** button — and loses the local plan picker, payment dialog and trial
  restart while Central owns the licence.

- **Scoped build obfuscation.** A Vite post-transform obfuscates exactly
  `src/lib/central-sync.mjs` and `src/lib/license.mjs` (compact, control-flow
  flattening at 0.7, RC4 string array, split strings, numbers to expressions),
  and nothing else: not `node_modules`, not the React tree, not `medicines.mjs` or
  `drug-search.mjs`. It is a "do not hand a reader the plaintext" measure, not a
  secret — the module still has to run in the browser. Verified by running the
  obfuscated output: the licence rules, the seal, the refusal path and the cache
  wipe all behave identically, and the pepper, the RPC name and the cache prefix
  no longer appear in `dist/`.

- **`javascript-obfuscator` is pinned to 5.2.1**, not the latest release: from
  5.3.0 it depends on `@vercel/blob`, which pulls a `zod` version with an open
  high-severity advisory, and `npm audit --audit-level=high` counts dev
  dependencies. `latest` would have reddened every build for a reason unrelated
  to this app.

- **CI**: `pages.yml` passes both variables into the build and the configuration
  report now states whether Central is configured, fails on a
  `sb_secret|service_role` key, objectifies a half-configuration, and warns when
  the central host never reached the bundle.

## [1.22.4] — 2026-11-08 · schema 18

**Accept the public key's mismatched PEM labels.**

- The clinic Edge Function now normalizes a key beginning with
  `BEGIN RSA PUBLIC KEY` and ending with `END PUBLIC KEY` to an SPKI public
  envelope before verifying it.
- Private key material is still rejected before this normalization.
- Deploy `sync-clinic-license` v1.22.4 to apply the fix. No schema change.

## [1.22.3] — 2026-11-08 · schema 18

**Make the private-key refusal actionable.**

- The licence authority setup guide now explains `key-private` and how to
  correct the clinic Edge Function secret without exposing or using the
  authority's private signing key.
- If a private signing key was put in a clinic secret or otherwise exposed,
  rotate the signing pair at the authority, update the clinic secret to the
  public half, update the matching public build variable, and rebuild.
- Synchronized the app and function version to `1.22.3`. No schema change.

## [1.22.2] — 2026-11-02 · schema 18

**Every refusal now names the function that made it.**

- **The failure that prompted this.** The card said

  ```
  Refused: Could not verify the signature: ASN.1 error: unexpected ASN.1 DER tag:
  expected SEQUENCE, got INTEGER at DER byte 2.
  ```

  while the panel footer said `v1.22.1`. Both were true and they were about
  different things: that sentence is produced by `sync-clinic-license`, in the
  `token-key` branch, and the app build had nothing to do with it. The deployed
  function was older than the fix. Nothing on screen could have said so.

- **`x-myclinic-function`** on every response, and `version` in every body —
  refusal or success. `Access-Control-Expose-Headers` lists both
  `x-myclinic-code` and `x-myclinic-function`, because CORS hides response
  headers from the browser by default: the request succeeded, the reason was
  unreadable.

- **The card names it**: `… (licence function v1.22.2)`. A `token-key` refusal
  from a function too old to send a version reads *“the function sent no version,
  so it is older than this build — deploy sync-clinic-license again”*. That
  sentence replaces an afternoon of guessing.

- **The refusal log** carries the key format the function was holding
  (`{key: 'pkcs1'}` or `spki`), so a format complaint can be confirmed from the
  function log alone.

- **Tested from both ends**: the app-side mapping in `tests/authority.test.mjs`,
  and the function's own source in `tests/function-imports.test.mjs`, which fails
  if `FUNCTION_VERSION` drifts from `package.json` or if the headers stop being
  set.

## [1.22.1] — 2026-11-02 · schema 18

**A host is not a module.**

- **The failure that prompted this.** CI, on `npm run` of the function
  type-check:

  ```
  Download https://esm.sh/
  error: Import 'https://esm.sh/' failed: 522 <unknown status code>
      at .../sync-clinic-license/index.ts:24:30
  ```

  The 522 sent everyone to esm.sh’s status. The file had the answer: the
  import had been shortened to the bare host —

  ```ts
  import { createClient } from 'https://esm.sh';   // a web page, not a module
  ```

  A bare host serves the esm.sh landing page when it is healthy and a 522 when
  Cloudflare’s edge cannot reach the origin. Neither response is JavaScript, so
  `deno check` could never have succeeded, however well esm.sh was behaving.
  `createClient` would also have been `undefined` at runtime: a deploy from this
  commit would have failed on the first request, not at build time.

- **Fixed** — pinned again, to the version that exists:

  ```ts
  import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.119.0';
  ```

- **Guarded** — `tests/function-imports.test.mjs` reads the function and fails
  on a bare host, on a specifier with no package path, on a version that is not
  an exact `x.y.z`, and on anything computed at runtime. It needs no network, so
  it runs in `npm test` before CI ever resolves the CDN.

- **Hardened** — the type-check step in `ci.yml` and `pages.yml` caches
  `~/.cache/deno` keyed on the function file and retries three times with a
  backoff, printing which attempt failed and, on the last one, how to tell a
  CDN outage from a broken specifier.

## [1.22.0] — 2026-11-06 · schema 18

**Two envelopes, one key.**

- **The failure that prompted this.** `Refused: Could not verify the signature:
  ASN.1 error: unexpected ASN.1 DER tag: expected SEQUENCE, got INTEGER at DER
  byte 2.` That is a **PKCS#1** public key (`-----BEGIN RSA PUBLIC KEY-----`) being
  read as **SPKI**: the parser wants `SEQUENCE { SEQUENCE, BIT STRING }` and finds
  `SEQUENCE { INTEGER modulus, INTEGER exponent }` instead. Nothing in the message
  says *format*, so it reads like a broken key.
- **Both formats now verify**, in all three places that check a signature:
  - `src/lib/authority.mjs` — `publicKeyFormat()` names the envelope;
  - `supabase/functions/sync-clinic-license` — same detection, and the config gate
    logs `{format: 'pkcs1'}` so the function log is unambiguous;
  - `scripts/check-public-key.mjs` — prints `usable RSA-2048 public key (PKCS1 PEM)`.
- **Why a wrapper rather than a format name.** WebCrypto has no `pkcs1` import
  format: it is not in the specification, and Deno rejects it outright — *"the
  provided value 'pkcs1' is not a valid enum value of type KeyFormat"*. So
  `pkcs1ToSpki()` prepends the `rsaEncryption` AlgorithmIdentifier and the BIT
  STRING header, producing the same DER that Node's `export({type:'spki'})` does —
  asserted byte for byte in the tests.
- **A private key is still refused**, in either envelope, with `key-private`.
- **A PKCS#1 key in `VITE_LICENSE_PUBLIC_KEY` no longer reads as "Not in this
  build"**: `authorityConfig().enabled` accepts both formats.
- Four tests: format detection, the byte-exact wrapper, verification of one real
  RS256 token with both envelopes, and the build-variable path.

## [1.21.9] — 2026-11-06 · schema 18

**"Inbucket" is a file-naming problem, not an email problem.**

- **The wrapper looked in one place.** It checked `supabase/config.toml`; the CLI
  loads `config.toml` from wherever it finds it first. `findLegacyConfig()` now walks
  upward from the working directory, checks both names at every level, matches any
  `[inbucket]` or child table, and returns the file **and the line numbers** — or the
  list of paths it looked at, when the file is somewhere else entirely.
- **`SUPABASE_CLI=2.122.1` works now.** The wrapper passed `--remote`, a flag 2.x
  does not understand; `deployArgs()` follows the version it is given, so the
  escape hatch for a legacy config is real: `--project-ref <ref>` on 2.x,
  `--remote=<ref>` on 3.x.
- **The CLI's own error is translated.** When its output mentions `[inbucket]`, the
  wrapper says what that means — local email, not the licence function — and either
  names the file or tells you it could not find one.
- Five tests cover the search and the flag: legacy section, child table, modern
  section, nothing found, and both CLI generations.

## [1.21.8] — 2026-11-06 · schema 18

**"The function does not type-check" — it was never checked.**

- **What happened.** `npm run deploy:function` on Windows printed
  `$ npx --yes deno@2 check …`, then immediately *"the function does not
  type-check"*, with no output from `deno` at all. Node cannot `execFile()` a
  `.cmd` shim — and `npx` is one on Windows — so the spawn failed with `ENOENT`
  before the child existed, and the wrapper's bare `catch` turned that into an
  accusation about code that had never been read.
- **`scripts/lib/platform.mjs`** supplies the `shell` Windows needs, and only on
  Windows. The wrapper now runs children with `spawnSync`, prints their output, and
  on failure reports the exit status *and* the last lines the child printed.
- **The same fault was in `check:contributing`**: `npm audit` could not be spawned
  on Windows either, so the `npm-audit` rule failed for a check that never ran.
  Fixed the same way; the rule is now honest on every platform.
- **`--skip-check`** deploys without the type-check, for when `npx deno@2` is slow
  or the network is unhelpful. Every push to `main` type-checks in CI anyway.
- **`CONTRIBUTING.md`** documents the Windows `EPERM … rolldown-binding…node` that
  has interrupted four releases: `npm install` sidesteps it entirely, because it
  updates in place instead of sweeping `node_modules`.

## [1.21.7] — 2026-11-06 · schema 18

**The deploy never reached the function.**

- **What stopped it.** `npx supabase functions deploy` printed a warning about
  `--project-ref`, then a note about `[inbucket]` in `supabase/config.toml`, then
  exited. Supabase CLI **3.0.0 became `latest` on 2026-11-02** and refuses to load a
  `config.toml` written by 2.x, so it dies at *config load* — before it bundles,
  before it uploads, and with a message about local email that never mentions the
  function.
- **Why the config is not renamed here.** `[inbucket]` works on 2.x and is refused
  by 3.x; `[local_smtp]` is the reverse. This project carries no `supabase/config.toml`
  at all — `schema.sql` is applied by pasting it — so the fix is to delete the
  untracked file an older CLI left behind, not to pick a side in that trench.
- **`npm run deploy:function -- <ref>`** does the whole thing: refuses without a
  real project ref, refuses when the working tree has a config the CLI cannot load
  (naming the file and the two ways out), type-checks the function with the same
  `deno check` CI runs, then deploys with the current CLI's flags.
- **`--remote` instead of `--project-ref`** throughout the guide: deprecated in 3.x,
  removed in 4.x, and the flag that decides whether `db push` touches the remote
  database or the local one.

## [1.21.6] — 2026-11-06 · schema 18

**`token-key` was never about the token.**

- **What the log said and what it meant.** `refused 403 token-key {"authority":200}`
  — the authority answered, the request was authorised, and then the *key* could
  not be used to verify anything. The secret held the authority key-generator's
  whole output line (`LICENSE_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n…"`), and
  the function tried to decode the quotes and the literal `\n` as base64.
- **The key is now judged where it is read.** `normalisePem()` strips the `.env`
  wrapper — name, quotes, escaped newlines — so the common paste simply works. A
  genuine defect is refused at the config gate with its own code and sentence:
  `key-private` (*that is a private key, paste the public half*), `key-malformed`
  (no header, truncated, not RSA, or a body that will not parse), each naming the
  crypto error behind it.
- **`token-key` becomes rare and talkative**: it now means the signature bytes
  could not be processed, it logs the reason, and it no longer covers a
  misconfigured secret.
- **`npm run check:key`** validates a PEM before you deploy it, prints a stable
  `sha256:` fingerprint, refuses to echo a private key, and compares two keys to
  answer "are the Edge secret and the build variable the same one?" — which is the
  question behind every `token-signature`.
- **`docs/LICENCE-AUTHORITY.md`** gains the `token-key` row and the
  paste-the-value-not-the-line rule.

## [1.21.5] — 2026-11-06 · schema 18

**"Edge Function returned a non-2xx status code" is not an answer.**

- **Where the sentence came from.** `supabase.functions.invoke` keeps the HTTP
  status and discards the response body; `error.message` is that one string for
  every non-2xx. The licence function had been writing `{code, error}` all along —
  the app simply never read it, so *origin not allowed*, *not the owner* and *the
  authority refused* were indistinguishable on screen.
- **The app now reads the refusal**: `refusalFromError()` takes the code from the
  JSON body, falls back to the `x-myclinic-code` header, and maps a bare status to
  a sentence that names the likely cause. A 403 with no reason is almost always a
  **stale deployment** — the function in the project is older than the app — and
  the message now says so.
- **New mapped codes**: `http-401`, `http-403`, `http-404`, `http-500`, `refused`,
  so the card and the toast show something actionable even when nothing else
  survives.
- **A refusal never discards a valid licence.** The cached token still keeps the
  clinic writing while the authority is unhappy — now covered by a test.
- **`MYCLINIC_ORIGINS` documents the dev origins.** `http://localhost:5173` and
  `http://localhost:4173` have to be on the list, or the clinic that works on Pages
  returns 403 on your machine.

## [1.21.4] — 2026-11-06 · schema 18

**A keyless deploy now says which kind of keyless it is.**

- **The log prints what it saw**, before it judges:
  `VITE_LICENSE_PUBLIC_KEY is present: 450 bytes, starts '---…PUBLIC KEY-----',
  PEM header: 1` or `VITE_LICENSE_PUBLIC_KEY is EMPTY as far as this build job can
  see`. The value is never printed — it is public, but a log is not the place.
- **The prose spelling is a trap, so it is now a hard failure.** These docs say
  *licence*; the variable says `LICENSE`. If `VITE_LICENCE_PUBLIC_KEY` is set and the
  real one is not, the deploy fails with *Variable name is misspelled* instead of
  quietly shipping a keyless bundle — a variable under the wrong name is
  indistinguishable from no variable at all.
- **`main` is now gated like a pull request.** `ci.yml` deliberately skips `main`
  (“main is covered by pages.yml”), but `pages.yml` was not running
  `check:contributing` or `deno check` — so a direct push, which is how this project
  ships, ran neither. Both now run in the deploy workflow.
- `docs/LICENCE-AUTHORITY.md` gains the spelling and empty-value checklist entries,
  and shows the two log lines to look for.

## [1.21.3] — 2026-11-06 · schema 18

**Which build am I looking at?**

- **The authority card now prints its own build**: `This build: v1.21.3 · <stamp>`,
  on the unconnected branch and beside the fingerprint on the bound one. When a
  card says *Not in this build*, the next question is always whether the deploy in
  front of you is the one you just triggered — answering it used to mean hunting
  for the version in Settings or the landing-page footer.
- **The missing-key notice in `pages.yml` now names the three traps** that make a
  repository variable exist without reaching a bundle:
  1. *Variables*, not *Secrets* — the workflow reads `vars.VITE_LICENSE_PUBLIC_KEY`,
     and a value under Secrets leaves it empty;
  2. repository scope, not environment scope — the `build` job declares no
     `environment:`, so a variable scoped to `github-pages` is invisible to it;
  3. adding a variable starts no run — the workflow has to be re-run after.
- **`docs/LICENCE-AUTHORITY.md`** carries the same checklist as six numbered
  steps, including the PEM shape and the `.env.local`-in-CI edge case.

Nothing about the licensing logic changed: a build made *with* the key already
behaved correctly, which is what this release is for — telling those two states
apart without guessing.

## [1.21.2] — 2026-11-06 · schema 18

**A 403 that explains itself.**

- **Why the log line was useless.** The platform records the status and nothing
  else — `POST | 403`, `logs: []` — because the function returned a body but
  never logged it. Every refusal now writes one line with its code and the
  context that decided it, and repeats the code in an `x-myclinic-code` header:

  ```text
  refused 403 origin-not-allowed {"origin":"https://clinic.github.io","allow":["https://clinic.example"]}
  ```

  The licence key, the token and every Supabase key stay out of it.
- **`not-configured` now names the missing secrets** instead of listing all three,
  and `not-signed-in` records whether the token was absent or merely userless.
- **Which 403.** Three gates return it, and only `origin-not-allowed` can fire
  before sign-in — which is exactly what `auth_user: null` looks like in the
  platform log. The origin is `scheme://host[:port]`: a Pages site at
  `https://clinic.github.io/myClinic/` sends `https://clinic.github.io`, **without
  the repository path**, and a trailing slash is stripped for you. Reproduced
  locally against the same function: a wrong origin returns `403
  origin-not-allowed`, the same request with the origin allowed returns `401
  not-signed-in`, so the two causes are distinguishable in one curl.
- **`docs/LICENCE-AUTHORITY.md`** gains the 403 table, the exact `secrets set`
  invocation, and the curl that tells "wrong origin" from "no session".
- **The Edge Function is type-checked in CI** (`deno check`, via
  `denoland/setup-deno`). It found a real `BufferSource` typing error that Deploy
  had shipped, because Deploy does not type-check. Fixed in the same commit.

## [1.21.1] — 2026-11-06 · schema 18

**Yes, the warning is accurate. No, it is not about this file.**

- **What the editor flagged.** `schema.sql` trips two keyword heuristics:
  *destructive operations* and *UPDATE without a WHERE*. The file re-creates 51
  policies, 16 triggers, 20 constraints, 2 indexes and 1 function on every run —
  each with `drop … if exists` and each immediately re-created, which is what
  makes a second paste idempotent rather than a duplicate.
- **What it does not contain:** `delete from` — 0. `truncate` — 0. `drop table`,
  `drop column`, `drop schema`, `drop type` — 0.
- **The one `UPDATE` without a `WHERE`** is schema 12 clamping
  `clinics.follow_up_days` into 3–45 *before* it adds the `CHECK`, so the
  constraint cannot be rejected by a clinic already on 60 days. One integer per
  clinic, no other column touched. It is also unreachable on an applied database:
  every migration returns early once its registry row exists.
- **Measured, not asserted.** Re-applying the entire file to a schema-18 database
  holding two clinics, two patients, a consultation and an invoice:
  *tables whose contents changed: 0 rows*. Same schema version, same registry,
  same `follow_up_days`. Transcript in `docs/SCHEMA-APPLY-SAFETY.md`.
- **`docs/SCHEMA-APPLY-SAFETY.md`** is the inventory to read before pasting —
  counts, the annotated `UPDATE`, what to be careful about (run the whole file, a
  backup before constraint-adding migrations, the three verification queries).
- **A 28th contributing check** bans the shapes that *would* destroy records:
  `delete from`, `truncate`, `drop table|column|schema|type`, and any `update`
  without a `where` that has not declared itself with
  `-- unconditional-update: <reason>`. Proved both ways — removing the comment
  turns it red at line 2416; injecting a `delete from public.patients` turns it red
  at line 192.

## [1.21.0] — 2026-11-06 · schema 18

**Why the button was not there.**

- **The card only existed once the clinic was already bound.** `Subscription`
  drew the *Licence authority* card when `managed` was true, and `managed`
  becomes true only after a successful sync — so a fresh clinic had no card, no
  button, and no way to perform the first connection. The binding happened in a
  boot phone-home that is silent by design: `silent: true`, `.catch(() => {})`.
  If that failed — a missing Edge Function secret, an origin not in
  `MYCLINIC_ORIGINS`, an unreachable authority — the screen said nothing at all.
- **Four explicit states now**, from one pure function (`authorityPanel`, tested):
  *demo* · *Not in this build* · *Not connected* · *Verified / Contract ended*.
  Each names its cause and its fix; a non-owner is told the owner must act, never
  told to edit a file they cannot reach.
- **The first press is named.** **Connect to the licence authority** binds the
  clinic; **Check the licence now** refreshes an existing binding. Refusals are
  printed on the card in the words of their code (`token-signature`,
  `origin-not-allowed`, `authority-unreachable`, …) instead of being swallowed.
- **`pages.yml` never forwarded `VITE_LICENSE_PUBLIC_KEY`.** Step 1 of
  `docs/LICENCE-AUTHORITY.md` told operators to set it as a repository variable;
  the deploy workflow compiled without it, so the app was built believing no
  authority exists. It is forwarded now (and in `ci.yml`), the run log states
  whether the key reached the bundle, the job fails if a public key does not
  arrive in `dist/assets/*.js`, and it fails loudly if a **private** key was put
  in that public variable.
- **`.env.example` documents the public key**, with the reason the licence key
  can never sit beside it: a `VITE_` value is compiled into the bundle.
- **`docs/LICENCE-AUTHORITY.md`** gains a *"the button is not there"* table —
  four causes, in the order they occur, with the fix for each.

If you deployed the authority and see no card: the build was almost certainly
compiled without the key. Set the variable, **rebuild**, redeploy.

## [1.20.2] — 2026-11-06 · schema 18

**A dummy key is still an alert.**

- **The alert was real, the secret was not.** GitHub raised *publicly leaked
  secret* on `tests/contributing.test.mjs:27`: a Google-API-key-shaped fixture,
  written to prove the credential scanner detects that shape. Nothing to rotate —
  the string was invented for the test and was never a credential — but a scanner
  cannot tell the difference, so the alert was indistinguishable from a real leak
  in the audit trail, and the provider was notified.
- **The seven fixtures are now assembled from fragments** at run time
  (`fake('AIza', 'SyA…')`), so no contiguous credential-shaped string exists
  anywhere in the tracked tree. Proved by scanning all 143 tracked files with the
  project's own patterns: zero hits, `tests/` included.
- **Why our own check was green.** `SECRET_SCAN_SKIP` exempted `tests/` —
  "fixtures use obvious dummy values". They did not. That exemption is gone: test
  files are scanned like any other, and putting one literal back turns
  `npm run check:contributing` red (`tests/contributing.test.mjs:39 Google API
  key`), naming the line without echoing the value. A new test asserts the
  exemption stays gone.
- **`CONTRIBUTING.md` now shows the fragment idiom** and says why: a dummy key
  alerts exactly like a real one, notifies the provider, and trains everyone to
  ignore the next alert.

## [1.20.1] — 2026-11-06 · schema 18

**`supabase/schema.sql` says what it is.**

- **The header's released-version list stopped at 16** while the file itself
  applied 18 — schema 17 (the audit fixes) and schema 18 (the licence authority)
  were missing from it. The section index above it stopped at §7 while the file
  runs to §18. Anyone reading the top of the file to answer "which schema is
  this?" was told the wrong thing, and the operator who reported it was right.
- **`docs/SUPABASE-SETUP.md` gained the migration rows 9–18** it never had, one
  line each, taken from the registry rows the migrations write.
- **`npm run check:contributing` now compares three lists against
  `SCHEMA_VERSION`**: the header, the highest `set schema_version = N` in
  `schema.sql`, and the setup guide's table. Any disagreement fails the build —
  it has disagreed twice now, which is once too often.
- **No database change.** The migrations, the `schema_migrations` rows (1–18) and
  `app_meta.schema_version = 18` were already correct; a fresh apply reports 18
  with all eighteen rows, verified in this release. This is the file telling the
  truth about itself.

## [1.20.0] — 2026-11-06 · schema 18

**A clinic can take its subscription from the licence authority instead of
licensing itself.**

- **Three layers, one enforcement point.** The authority
  ([`myClinicLicenseAuthority`](https://github.com/rajeshlande/myClinicLicenseAuthority))
  signs a 7-day RS256 capability token. The clinic's own Edge Function
  (`supabase/functions/sync-clinic-license/`) verifies it with the SPKI public key
  and records the verdict through `apply_authority_license()` — `service_role`
  only, so a signed-in owner cannot write it. The browser verifies the same token
  again, and decides nothing: it exists so the Subscription card can show a
  *signed* tier, contract date and seat caps rather than a status string the page
  made up. Editing JavaScript in DevTools reaches none of the layers that matter.
- **The licence key never enters the bundle.** The browser asks the clinic's Edge
  Function, which holds `LICENSE_KEY` and the service role key as secrets. The
  authority's own browser-only mode embeds the key in public JS; myClinic does not
  use that mode.
- **Bound clinics stop licensing themselves.** `renew_subscription()`,
  `change_plan()` and `start_trial()` raise `license:managed` (42501) once
  `authority_subscription_id` is set, and the Subscription page shows the authority
  card instead of the plan picker and the payment dialog. This is the last
  tenant-writable door the schema-17 audit left open.
- **Tiers map onto plans**: `solo → solo`, `standard|growth → growth`,
  `chain|enterprise → chain`; an unknown tier is refused rather than guessed at.
  Seat caps follow: 1/1/1, 5/3/1, unlimited.
- **Offline stays deliberate.** The authority's contract date lands in
  `current_period_end`, so a valid token keeps the clinic writing for its seven
  days and a contract that has ended degrades to read-only through the existing
  grace window. A clinic never loses access to its own records because a network
  was down.
- **New**: `apply_authority_license()` and `unbind_authority_license()` (operator
  escape hatch, logged), the `authority_*` columns on `clinic_subscriptions`, a
  `sync` kind in `license_events`, the `authority` block in `license_state()`,
  `src/lib/authority.mjs` (verification, tiers, cache), `src/lib/authority-sync.mjs`
  (phone-home with offline fallback), and `supabase/schema-tests.sql` suite L.
  `docs/LICENCE-AUTHORITY.md` is the whole connection guide.

## [1.19.2] — 2026-11-06 · schema 17

**`npm run verify` runs on Windows.**

- **The bug.** `"test": "node --test tests/"` does not work on Windows: Node's test
  runner does not classify the directory argument as a directory there, so it
  tries to load `tests` as a module and dies with `MODULE_NOT_FOUND` before a
  single test runs. Not a test failure — the suite never started — but `npm run
  verify` stops at its first step, so nothing downstream runs either. CI never
  caught it because CI is Linux.
- **The fix.** `scripts/run-tests.mjs` builds the file list in Node
  (`readdirSync` over `tests/`, `*.test.mjs`, sorted) and spawns
  `node --test <files…>`. No shell, no globs, no directory argument — the three
  things that differ across platforms. A new test file needs no edit anywhere, and
  anything after `npm test --` is passed through to the runner.
- **The guard.** `check:contributing` used to look for the literal string
  `node --test` in `package.json`, which is why it stayed green while the script
  was broken. It now follows the pointer: the test script must not hand node a
  bare directory, and whatever it invokes must actually pass `--test`.
- **Nothing else changed.** Same schema 17, same five audit fixes as 1.19.1.

## [1.19.1] — 2026-11-06 · schema 17

**The five findings from the first full security audit, closed in the code that
caused them.**

- **The booking reference is not a phone lookup** (`booking/public-book-phone-ref-disclosure`,
  high). `public_book` answered a second booking for the same phone with
  `booking:already:16:30` — somebody else's appointment time — and returned that
  appointment's reference, which `public_booking_lookup` and `public_cancel_booking`
  then accept. The function now takes `p_client uuid` (the booking page keeps a
  random id for the visit): the same client gets its reference back and a
  `duplicate: true`, any other caller gets `booking:already` with no time and no
  reference, and the client drops any `:detail` suffix an older database still
  appends, so the time cannot reach the screen either way. A third booking per
  phone per day is refused alongside the existing 40/hour cap.
- **The offline cache is cleared on sign-out** (`client/phi-cache-not-cleared-on-signout`,
  medium). `clearAllCache()` runs on sign-out — every cached workspace and every
  outbox, leaving theme and other non-clinical keys alone — and
  `purgeExpiredCache()` runs at boot, so an expired snapshot is deleted rather
  than left in localStorage until that clinic is opened again.
- **A tenant cannot write its own licence** (`licensing/tenant-self-grant-subscription`,
  medium). `set_license_status` is revoked from `public` and `authenticated` and
  granted to `service_role` alone; `change_plan` moves plan and interval only and
  logs a `plan` event; `renew_subscription(clinic, reference, months)` requires a
  collection reference of at least four characters, caps a self-renewal at twelve
  months, sets the clinic active and logs a `renew` event to the new
  `license_events` table (owner-readable, service-role-writable); `start_trial`
  refuses a clinic that has already used its trial.
- **The counters need membership** (`rls/next-token-next-invoice-cross-tenant`,
  low). `next_token_no` and `next_invoice_number` raise `not a member of this
  clinic` for a caller from another clinic instead of returning that clinic's next
  number.
- **Writes cannot name another clinic's patient**
  (`rls/appointments-cross-tenant-patient-reference`, low). The insert and update
  policies on `appointments`, `consultations` and `invoices` require a
  same-clinic `patient_id` (and `doctor_id` where present).

Applied as schema 17 — paste `supabase/schema.sql` again; it is additive. The old
7-argument `public_book` is dropped and replaced by the 8-argument version, so a
caller still sending seven arguments keeps working and simply does not get
duplicate-reference recovery.

## [1.19.0] — 2026-11-06 · schema 16

**Contributing is now a checklist a machine runs, not a paragraph a reviewer
remembers.**

- **`CONTRIBUTING.md` carries the four standards**: zero-trust security (no
  hardcoded secrets, push protection, input sanitisation at the boundary, dependency
  safe-listing, private vulnerability disclosure), performance (listener and timer
  cleanup, no blocking calls in the bundle, batched database access, lazy routes),
  coding and style (the gates, the naming table, the testing rule, the documentation
  rule) and the pull-request process.
- **The Cloudflare [`security-audit`](https://github.com/cloudflare/security-audit-skill)
  skill is vendored** at `.claude/skills/security-audit/` — MIT, pinned to
  `c1c8a8c`, upstream recorded in `VENDORED.md`. Six phases, adversarial validation
  ("the agent that checks a finding is never the agent that found it"), and a hard
  rule that without an OS sandbox nothing is executed and anything unproven is filed
  as `needs_validation`.
- **`npm run check:contributing`** — 25 checks over the tracked tree: credential
  shapes, tracked `.env` files, raw HTML injection, service-role keys, the dependency
  safe-list and licence notices, listener/timer balance, blocking calls, file naming,
  stray `console.log`, test-suite presence and pure-module coverage, version
  agreement across `package.json` / `APP_VERSION` / `CHANGELOG.md`, the document set,
  and the vendored skill's presence, frontmatter, schema and validators. `--online`
  adds `npm audit`; `--strict` turns warnings into failures; `--json` is for tooling.
- **Two real defects found by its first run:**
  `src/lib/pwa.jsx` registered `visibilitychange`, `online`, `updatefound` and
  `statechange` listeners on the service worker and never removed them — the front
  desk leaves the app open all day, so each remount stacked another update check. The
  effect now collects its teardown and runs it. And `react-router` had no licence row
  in `THIRD_PARTY_NOTICES.md`; it does now, along with the vendored skill.
- CI gains the check on both Node versions, plus an `npm audit` step that already
  fails on high or critical.

## [1.18.0] — 2026-11-06 · schema 16

**A prescription is a document with pages, and every page has a footer.** Chrome
cannot repeat a running footer on its own — a `position: fixed` element prints on
every page but is emitted at the head of each page's content stream, which is what
put the footer above the letterhead — so the pagination moved into the app.

- **`src/lib/paginate.mjs`.** Page 1 takes the letterhead, the patient block and up
  to **8** medicines; middle pages take **12** each under a continuation strip
  (clinic · patient · RX number · page *n* of *m*); the last page holds at most
  **9** because it also carries the investigations, the advice and the signature.
  Two-page prescriptions are split evenly (9 rows → 5 + 4) so a single row is never
  orphaned under the signature. Row numbers run through the document; no row is
  dropped or duplicated.
- **`.print-page`.** One element per sheet, a flex column of exactly the printable
  area — 186 × 270 mm inside `@page { size: A4; margin: 12mm 12mm 14mm }` — with
  `break-after: page`. On screen it is the same page: 210 × 297 mm, same margins,
  stacked with a gap.
- **`.page-foot`.** `margin-top: auto` pins it to the bottom of the paper whatever
  is above it, and `flex: 1 1 0` makes the two blocks equal width: **left** the
  clinic, address, phone · email and the validity line; **right** the prescription
  identity, the e-prescription line, "Bring this sheet to your next visit" and
  `Page n of m · myClinic`.
- The signature block, the investigations and the advice are on the last page only;
  the continuation pages say which page they are, so a loose sheet can be refiled.

`rx-print-check.html` in the workspace is a two-page copy of the slip using the
app's own stylesheet: print it and both pages should come out with the footer at
the bottom.

## [1.17.2] — 2026-11-06 · schema 16

**The PDF prints like a prescription, not like a web page.** Three separate
defects, all of them in the print path:

- **The footer printed above the header.** `.print-foot` was `position: fixed` so
  that it would repeat on every page. Chrome paints a fixed element on every page
  but emits it at the head of each page's content stream, so the clinic address,
  the validity line and the e-prescription line landed on top of the letterhead.
  The element is gone; the document has **one footer, in flow, at the end**.
- **One page became two, and a jumbled two.** `html, body, #root` are
  `height: 100%` and `.doc-page` is `min-height: 100dvh`. In paged media those
  resolve against the page box, so the sheet overflowed a container that cannot
  fragment: the excess spilled onto page two from the top, dragging
  `break-inside: avoid` blocks with it. Print now sets `height: auto` and
  `min-height: 0` on all four.
- **Grid on paper.** Chrome's grid fragmentation is unreliable and a grid with
  `break-inside: avoid` can jump to the next page. `.rx-patient`, `.doc-foot`,
  `.inv-parties`, `.inv-settle` and `.inv-totals` are **flex rows** in print.

Also in this release:

- Paper typography: 9.6 pt body, 8.6 pt table, 7 pt labels, `@page { size: A4;
  margin: 12mm 12mm 14mm }`. A five-medicine slip with investigations, advice,
  follow-up and signature fits one page with room to spare; a longer one breaks
  between rows, never inside one, and the medicine header repeats.
- `orphans: 2; widows: 2` on paragraphs, list items and table cells.
- **GSTIN is off the prescription header** (`DocumentHeader` gained `showGstin`,
  invoices keep it). The format wants the prescriber's registration number
  there — one number fewer to misread.
- `.print-foot` markup and rules removed from both documents.

To verify: print → *Save as PDF* → A4, margins **Default**, scale **100%**. One
page, header first, table with `1-0-1` and `Qty`, one footer at the end.
`rx-print-check.html` in the workspace is a standalone copy of the slip for
printing without the app.

## [1.17.1] — 2026-11-06 · schema 16

**The sheet is a sheet of A4, on screen and on paper.** The prescription and the
invoice were shown as an 880 px card: a preview that lied, because the printed
page broke in a different place and the strip reserved for the repeated footer had
no room of its own.

- `.print-sheet` is now a real page box — **210 × 297 mm**, `box-sizing: border-box`,
  `padding: 13mm 12mm 18mm`, a hairline edge and a page shadow — the same margins
  `@page` gives the printed page. Content width is 186 mm in both, so at 100% zoom
  what is on screen is what comes out.
- `@page { size: A4; margin: 13mm 12mm 18mm }` is unchanged; print keeps
  `padding: 0` on the sheet and now reserves the **bottom 8 mm** for the fixed
  `.print-foot`, so the last line of a one-page slip no longer collides with it.
- The toolbar and the badges above and below the sheet are 210 mm wide, so they
  line up with the paper edge instead of an arbitrary 880 px.
- `.rx-sheet` no longer carries a second padding of its own — it was overriding the
  page box and turning A4 back into a card.
- On a phone (≤ 640 px) the sheet keeps its 16 px padding and drops the fixed A4
  height, rather than forcing a 297 mm page onto a 360 px screen.

No schema change; no change to the consultation form — the **Dose pattern / How
often** box in a drug row (`1-0-1`, `1-1-1`, `0-0-1`, `0-1-0`, `½-0-1`, chips, and
the read-back line) is untouched by the layout work.

## [1.17.0] — 2026-11-06 · schema 16

**The dose pattern is written, not inferred.** A prescription here is written as
three numbers — morning, afternoon, night — and 1-0-1 means more to a chemist than
"twice a day" ever will. Until now the pattern was derived from the frequency
words and could not say *which* two doses. It can now say it, because it is typed.

- **A pattern box beside "How often".** Type `1-0-1`, `1-1-1`, `0-0-1`,
  `1-1-1-1`, `½-0-1` — or tap one of six chips (1-0-0, 1-0-1, 1-1-1, 1-1-1-1,
  0-1-0, 0-0-1). Two numbers are morning and night, three are
  morning–afternoon–night, four add the evening. `0.5` is accepted and printed
  as `½`; spacing and dashes are both read.
- **The pattern decides the words, never the other way round.** `1-0-1` sets the
  frequency to "Twice a day", `½-0-½` does too (the amount is not the frequency),
  `0-1-0` has no frequency words and keeps its own. Touching the frequency
  dropdown clears the pattern, so the two can never disagree on the slip.
- **An unreadable pattern is refused where it was typed.** `0-0-0`, `5-0-1`,
  `1-0-1-1-1`, a stray letter — the field turns red, the row cannot be saved, and
  nothing is written to the database that the print would then have to ignore.
- **The pattern prints.** Under the dose on the slip in monospace (`1-0-1`), and
  beside the drug name in the WhatsApp message: `1. Metformin 500 1-0-1 — after
  food · for 1 month (60 tablets)`. Rows saved before this release still get a
  pattern, derived exactly as they were in 1.15.0.
- **The quantity follows the pattern.** `1-1-1 × 5 days → 15 tablets`,
  `0-1-0 × 5 days → 5`, `1-1-1-1 × 2 days → 8`, `½-0-1 × 10 days → 15` (a half
  tablet still comes out of a whole one, so a fraction rounds up), and
  `5 ml · 0-0-3 · 4 days → 60 ml` — a volume is counted in millilitres, not in
  spoons. For a solid, the number in the pattern *is* the count, so a row saying
  "2 tablets" with a pattern `1-0-1` dispenses 10 tablets for 5 days, not 20.

No database change: the prescription is `jsonb`, so `pattern` is a new key on the
row and needs no migration. Schema stays at 16.

## [1.16.0] — 2026-11-06 · schema 16

**The printed slip now answers to the format it will be judged against.** A
prescription in India is read against the NMC model format and the Drugs Rules:
prescriber identity with the State Medical Council number, patient identity
including address and weight, the drug with its generic name, dose, frequency,
duration **and the quantity dispensed**, the findings that justified it, the
investigations advised, and a signature. Most of that was already on the sheet.
Three things were not.

- **Quantity to be dispensed.** A `Qty` column, computed from what the doctor
  already typed: 1 tablet × twice a day × 5 days → **10 tablets**; ½ tablet daily
  for 10 days → **5 tablets**; 5 ml thrice a day for 5 days → **75 ml**; 1 puff
  twice a day for a month → **60 puffs**. Every 6 hours counts as four a day,
  every 8 hours as three. Where the arithmetic would be a guess — *when needed*,
  *once a week*, *till review*, *apply thinly* — the column prints a dash rather
  than a number a chemist would dispense to.
- **Investigations advised, as their own list (schema 16).** *CBC, HbA1c after 3
  months, X-ray chest* used to live inside the free-text advice, where it could
  not be printed under its own heading, ticked off at the next visit, or read
  back. It is now `consultations.investigations text[]`, typed comma-separated in
  the consultation (the way diagnoses already work) and printed as a list. The
  column is additive and defaulted, so an old client that never sends it keeps
  saving, and an old row reads back as an empty list.
- **The slip reads like the format.** The generic name prints in **capitals**
  under the brand; the patient's **address** joins name, age and sex; **height**
  sits beside weight in the vitals strip; the doctor's **registration number is
  repeated at the signature** with *Signature & clinic seal* under the line; and
  the footer says *computer-generated e-prescription · valid only with the
  prescriber's signature and clinic seal* — so an unsigned sheet cannot pass for a
  signed one.
- The WhatsApp version of the prescription carries the quantity too: *"1.
  Augmentin 625 — after food · twice a day · for 5 days (10 tablets)"* — the
  difference between a complete course and a second trip to the chemist.

`docs/PRESCRIPTION-FORMAT.md` maps every element of the format to the column it is
stored in and the place it prints, and states plainly what the app does not do: no
digital signature certificate, no registration-number validation, no Schedule X
register, no pharmacy licence block.

## [1.15.0] — 2026-11-06 · schema 15

**The prescription line is written the way a pad is written.** Drug, Dose, How
often, For and Food relation were five fields, three of them dropdowns, and the
doctor carried the pattern in their head: *twice a day* became `1-0-1` later, on
paper, by memory.

- **The pattern is a chip.** Four buttons beside "How often" — `1-0-0`, `1-0-1`,
  `1-1-1`, `0-0-1` — write the frequency in one tap, and the field still holds the
  words, now with the shorthand a chemist reads: `Twice a day (BD)`. Frequencies
  that have no daily pattern stay in the dropdown and never get a fabricated one
  (`dosePattern()` returns `''` for *When needed*, *every 6 hours*, *once a week*).
- **Dose chips that know the drug.** The chips are chosen from the form of the drug
  that was picked — syrup gets `5 ml` / `10 ml` / `2.5 ml` / `15 ml`, an inhaler
  `1 puff`, an injection `1 dose`, eye drops `1 drop`, a tablet `1 tablet` / `½
  tablet` / `2 tablets`. Free typing is still there; the chips just remove the two
  most common typos in a clinic: a tablet measured in millilitres and a half dose
  typed as `0.5`.
- **A half tablet is a fraction.** The pattern renders `½-0-½`, not `0.5-0-0.5` —
  a chemist reads a fraction.
- **"For" answers with a date.** Quick chips for 3, 5, 7 and 10 days, and a
  computed "till 11 Nov 2026" from `durationInDays()`, which understands *5 days*,
  *2 weeks*, *1 month*, a bare `7`, and refuses to invent a number for *till
  review*.
- **Food relation is visible.** Five chips instead of a dropdown, plus `— none —`:
  one glance shows what was chosen, and tapping the chosen one clears it.
- **The line reads back.** A dashed line under the fields shows the pattern, the
  instruction as the patient will read it in the language chosen for the slip, the
  end date, and — if the same brand is already on the prescription — a warning
  saying so.
- **Fixed:** the dose and duration `datalist`s shared two fixed ids across every
  drug row, so from the second drug onwards the browser attached suggestions to the
  first row's input. Each row now has its own ids.

The stored values are unchanged (`frequency: 'Twice a day'`, `dose: '1 tablet'`),
so prescriptions written before this release print exactly as they did.

## [1.14.1] — 2026-11-06 · schema 15

**The directory learned to hold a lakh of brands without slowing down — and
stopped picking the wrong one.** 1.14.0 shipped a typo-tolerant search tested
against the 59 brands that live inside the app. Then the real thing went in: the
Indian Medicine Dataset, 253,973 rows, 242,178 importable brands. Every query
still answered, and two problems appeared that only real data shows.

- **Half a second per keystroke.** The schema 14 function ORs a trigram
  similarity into its `WHERE` clause, which no index can serve: Postgres read all
  242,238 rows and scored each one, 435–563 ms per query. Schema 15 splits the
  term into four index-usable branches — brand prefix, brand contains, first-word
  fuzzy, first-molecule prefix/fuzzy — and ranks only what the indexes return.
  Measured on 242,238 rows, warm, p50/p95: `augmentn` 2.1/6.2 ms, `crocn`
  1.9/2.9 ms, `zerodol sp` 4.0/5.2 ms, `pantocid` 13.0/16.7 ms, `dolo`
  21.8/26.6 ms, `paracetamol` 42.9/57.0 ms, and the worst term in the set — a
  three-letter `cef` that legitimately matches 4,831 brands — 58.7/79.5 ms.
- **The wrong drug won a tie.** For `augmentn`, `Augmentox` ranked above
  `Augmentin 625`: both share seven trigrams with the query and score exactly the
  same (Dice 0.737, `pg_trgm` 0.583), and the shorter brand won on alphabetical
  order. Trigram similarity cannot separate them at any threshold. Keystroke
  distance can — `augmentn` is one deletion from *Augmentin*, two from
  *Augmentox* — so `drug_edit_distance()` now breaks the tie in SQL and
  `editDistance()` breaks it in the browser. One keystroke is worth +0.15, two
  +0.06, three is another drug.
- **A prefix is not a typo.** `paracetamol` is 0.25 similar to `para`, under any
  useful fuzzy threshold, so half-typed molecules get their own indexed branch
  (`lower(composition) text_pattern_ops`). Three letters, though, is not a
  molecule: `cef` waits for a fourth character before the molecule branches fire,
  which is most of why it answers in 59 ms instead of 167 ms.
- **GIN, not GiST.** The trigram indexes are rebuilt on `lower(brand_name)`,
  `split_part(lower(brand_name), ' ', 1)` and
  `split_part(lower(composition), ' + ', 1)`, using `gin_trgm_ops`. On 242k rows
  a `LIKE '%term%'` went from 10.6 ms (GiST) to 0.20 ms (GIN), and a `%` fuzzy
  match from 40 ms to 1.2 ms. This table is written by an import job and read by
  every prescription; GIN is the right trade, and the two GiST indexes from
  schema 14 are dropped rather than left to cost 62 MB and slow imports down.
- **The long tail imports in one command.** `--preset inmd` reads the dataset's
  columns (id, name, price, Is_discontinued, manufacturer_name, type,
  pack_size_label, short_composition1/2), detects the header rather than trusting
  it, strips the pack size out of the brand (`Augmentin 625 Duo Tablet` → brand
  `Augmentin 625 Duo`, form `Tablet`), splits `Amoxycillin (500mg)` into molecule
  and strength, collapses four pack sizes of one tablet into one row (3,890
  collapsed from 253,973 rows), skips discontinued products (7,905), and
  normalises spellings — `Amoxycillin → Amoxicillin`, `Acetaminophen →
  Paracetamol`, `Pantoprazole Sodium → Pantoprazole` — while leaving `Calcium
  Carbonate` alone. 253,973 rows → 242,178 insertable in about 5 seconds.
- **Safety classes ride along.** An imported row lands with `schedule` null and
  `classes` empty, which would leave the two-NSAID and two-PPI rules, the
  allergy-by-class check and the H1-register chip silent. `--inherit-classes`
  copies them from the curated row with the same first molecule and never
  overwrites an existing class: 98,982 of the imported rows picked up a schedule
  and a class set from the 59 curated brands.
- **A 44 MB file is written in batches.** The importer streams inserts 1,000 rows
  at a time and says plainly that the file is for `psql`, not the SQL editor.
  Memory stays flat; the first version of this, collecting every row then
  string-building the file, was killed at 512 MB heap.

Also in this release: the dataset is MIT-licensed and used as a *brand
dictionary*, not as a formulary — one row per pack, no Schedule H/H1/X, no
interaction data — so imported rows are `source='import'` and the curated 59 stay
`source='formulary'`.

## [1.14.0] — 2026-11-06 · schema 14

**The drug field stops demanding the exact spelling.** A doctor writing twelve
prescriptions before lunch does not type "Augmentin 625" with a capital A and the
right number of m's. The old search matched only prefixes and substrings, so
`Augmentn`, `amoxycillin`, `metformn` and `tab pan 40` returned "no match" — and a
field that says no to the drug in the patient's hand is a field that gets ignored.

- **Typo tolerance, offline.** Search now ranks exact → brand prefix → word start →
  molecule → keyword → trigram similarity, the same idea as Postgres' `pg_trgm`
  (Dice coefficient over padded 3-grams) but computed in the browser from the
  formulary that ships with the app. No connection needed, no round trip, no
  spinner before the first result. A multi-word term is only as strong as its
  weakest word, so `dolo 650` beats `dolo`.
- **A drug directory behind it (schema 14).** `public.medicines` holds brand,
  composition, form, strength, schedule and the classes the safety rules use, with
  GiST trigram indexes on the brand and the composition and one function,
  `search_medicine_brands(term, limit)`, granted to signed-in seats only. The 59
  starter brands are seeded, so the directory is useful the minute the SQL runs;
  the browser's own list still ranks first, because it knows this clinic's habits.
- **The composition travels with the brand.** Every suggestion shows the brand in
  bold with the generic salt, form and manufacturer in a muted line beneath, the
  way the old field did — and a directory row now brings its composition, its form
  and its dispensing schedule into the prescription line, which is what the
  duplicate-therapy, allergy and H1-register checks read.
- **A field that behaves like a good IDE.** 250 ms debounce on the directory, so
  typing does not become a query per keystroke; stale answers dropped when a newer
  keystroke has already asked; matched letters highlighted; a source label per row
  (Used here / Directory); arrow keys, Home, End and Enter; the list scrolls to the
  highlighted row; and a screen reader announces how many suggestions appeared.
- **Read-only reference data.** RLS on, one SELECT policy for authenticated, no
  INSERT/UPDATE/DELETE grant to any app role; the function is `security invoker`
  so the policy cannot be bypassed. Imports are a service-role job.
- **Two tools for real data.** `scripts/import-medicines.mjs` reads a data.gov.in /
  CDSCO / chemist export (CSV, TSV or JSON), works out which column is the brand
  and which is the composition, skips rows with no molecule, collapses duplicates
  on the same identity the database enforces, and writes idempotent SQL or pushes
  it. `scripts/rxnorm-composition.mjs` re-spells a molecule the way NLM's RxNorm
  does, so `Amoxycillin` and `Amoxicillin` are one drug to the checks.
- **Honest states.** A quiet spinner in the field while the directory is asked, "one
  more letter" below two characters, and "not in the clinic list or the directory —
  keep typing and it is saved exactly as written" instead of a dead end.

## [1.13.1] — 2026-11-04 · schema 13

**The conflict that said "this record was deleted at the clinic" was not a deletion.**
The account screen saves to `public.profiles`; an account created before the database
had `handle_new_user()` never got a row there, so the save had nothing to attach to and
the sync queue reported it as a remote deletion — on the one record that is only ever
the signed-in user's own.

- **The app heals it.** On sign-in and on save, the signed-in account writes its own
  profile row (allowed by the existing `profiles_self` policy). The queue now treats an
  update to a missing `profiles` row as a first write (`UPSERT_ON_MISSING`) and creates
  it with the edit applied, instead of raising a conflict.
- **The screen tells the truth.** A conflict on your own profile reads "Your account
  profile row is not in the database" and offers **Recreate my profile**, which writes
  it with the values you had typed. Other records keep the old wording and still need a
  human: a patient deleted at the clinic is not resurrected by an offline edit.
- **Schema 13 backfills** a profile row for every existing account, named from the
  sign-up metadata, so accounts that never open Settings are fixed too.

## [1.13.0] — 2026-11-04 · schema 12

**A clinic day is two sessions, not one window.** The app modelled hours as
`open_time`–`close_time`, so a clinic that shuts between 1 PM and 6 PM had no way to
say so and the diary offered 2 PM in an empty building. Hours are a list now — at most
two sessions per day, for the clinic and for each doctor — and the break between them
is never a slot.

- **A doctor sits inside one session.** The morning doctor is not bookable in the
  evening, and hours that would cross the clinic's break are refused by the screen, by
  the appointment sheet and by a Postgres trigger (`staff:hours`), not just hidden.
- **Days off are settings.** Weekdays (0 = Sunday) and one-off dates, on the clinic and
  on each person. The clinic being shut closes the diary for everyone; a doctor's own
  leave closes only their column. `public_book` refuses both with `booking:dayoff` and
  `booking:leave`, so the page and the API cannot disagree.
- **Follow-up validity is 3–45 days** instead of 0–180. Existing rows are clamped
  before the CHECK is added, so the migration cannot fail on data that is already there.

**"My account will not save" is fixed, and the reason is on the screen.** The account
screen sent `{ ...profile, ...prefs, theme }` to `profiles` — every key it happened to
hold, including `send_review_request`, which had no column. PostgREST refused the whole
update (PGRST204), so a name change failed because of a notification toggle, and the
person saw "Could not save." The payload is now built from the columns that exist, the
missing column exists too (schema 12), and a save writes through to the database when
the device is online so "saved" is only shown once the server has answered.

**Every failure explains itself.** `src/lib/errors.mjs` turns a refusal into what it
means and what to do: a missing column names itself and points at `supabase/schema.sql`
with the schema number, a seat that is not allowed says so, an expired session asks for
a sign-in, an unreachable server says the change is queued, and a refused value says
which constraint. The raw text is always kept on `detail`, the last five failures are
listed under **Settings → About** with a Copy button, and a crashed screen renders a
panel with the version, the schema and the same diagnostics instead of a blank page.

## [1.12.0] — 2026-11-04 · schema 11

**Four more things reach the patient's phone.** The clinic already messaged patients
by hand from its own WhatsApp. It could not send a **token**, the **appointment
details**, the **bill** or the **slip** — the first two did not exist as messages, and
the last two were "copy this and paste it somewhere".

One composer now builds all of them (`src/lib/messages.mjs`), previews the exact text,
opens `wa.me` from the clinic's own number, and writes what happened to the log:

- **Token** — the number, the doctor, how many patients are ahead and roughly how long,
  the time they were given, and the clinic's number to call.
- **Appointment** — date, time, doctor, address, "arrive 10 minutes early".
- **Bill** — number, total, paid, balance, and the clinic's UPI id when it has one.
- **Prescription** — the medicines and the directions in the language the doctor chose.
- Reminders already existed and are unchanged.

**Consent is a column.** A patient can be marked opted out of WhatsApp, with the date
it was asked for; the composer then refuses in a sentence instead of doing nothing. The
opt-out is on the patient card. No channel is auto-enrolled: every existing patient
defaults to opted-in, because the clinic was already messaging them.

**One log for every message.** Token, invoice and prescription rows join the reminder
log, so "was this patient sent their bill?" is answerable, and a message already sent
today is flagged before it goes twice. Nothing is sent automatically — this is still a
person pressing send, and the log records a person, not a guess.

Schema 11 is additive: `patients.wa_opt_in`, `patients.wa_opt_out_at`, and a widened
CHECK on `reminders.kind`. Verified on PostgreSQL 17 as a fresh install and as a
10 → 11 upgrade, each followed by `supabase/schema-tests.sql` — seven suites, rollbacks
only, including the new suite G for consent and the log.

`docs/WHATSAPP-SHARING.md` is the plan this came from, including why click-to-send is
the transport today and what a Cloud API worker would change.

305 tests in 14 suites.

## [1.11.10] — 2026-11-04 · schema 10

**The demo door opens the demo.** On the published site — the one deployment with
Supabase configured — the footer's **Open Demo** button routed a signed-out
visitor to `/login`. The single entrance the 1.11.8 notes promised therefore
ended on a sign-in form, and the URL the README calls *Live demo* had no demo
behind it. It now always opens the workspace: with no session the store is
already in demo mode against `localStorage`, the shell reads *“Demo workspace ·
sample data”*, and nothing is sent to the clinic database.

Signing in keeps its own button in the marketing nav, and it is the only other
route off the page. `tests/landing.test.mjs` pins both facts — the door does not
branch on `configured` or `user`, and `/login` survives as the Sign in target.

No database change — schema 10 covers this build. 287 tests in 13 suites.

## [1.11.9] — 2026-11-04 · schema 10

**The front desk gets its own workspace.** Reported from a live clinic: a
front-desk seat could open **Doctors & staff**, **Day close** and the
**subscription panel**, and Settings showed it the clinic's GST setup, booking
link, logos and plan — screens it could only read, never change.

Its nav is now Dashboard · Token queue · Appointments · Patients · Billing ·
Reports · Settings. Day close moved to the owner: counting the drawer, writing
down the variance and freezing the day's snapshot is reconciliation, not
collection — **the desk still takes payments at the counter** (`invoice:collect`
is unchanged; the new `day:close` capability owns the close).

Doctors keep the roster (they need to see who they share a clinic with) but lost
Day close too, and the plan panel is gone from the sidebar for anyone who cannot
open it, rather than sitting there disabled.

**Settings is per-seat.** The tab list is derived from capabilities: a front-desk
account gets *My account · Appearance & colours · Offline & sync · About &
version*; *Clinic · Logos & branding · Billing & invoices · Plan & data* are the
owner's, and "Your access" in the About tab now spells out what the seat can and
cannot do — including day close and the roster.

**README** is rebuilt in the [awesome-readme](https://github.com/matiassingers/awesome-readme)
shape: centred logo, pitch and badges; screenshots; quick start that runs in demo
mode; features by seat; the role table with the layer that enforces each row;
plans; structure; configuration; database; testing; deployment; troubleshooting;
docs index.

No database change — schema 10 covers this build. 286 tests in 13 suites; the new
`day:close` and `team:read` rules, and the derived Settings tabs, are pinned by
`tests/rbac.test.mjs`.

## [1.11.8] — 2026-11-04 · schema 10

**One demo door.** The marketing page had four ways into the demo clinic — a hero
button, the closing band, a link in the footer list and a "Sample patients"
button — so a visitor who meant to read pricing could end up in sample data, and
the page read as a demo of itself. There is now exactly one: the footer button
labelled **Open Demo**.

Everything else on the page is the product: the hero offers a single call to
action (plans, or sign up once Supabase is connected), the plan cards lead to sign
up, and the closing band — previously *"Open the demo clinic and click around"* —
now closes on the clinic's own morning. The footer keeps three link groups; the
demo is a button, not a fourth link.

**No reference project.** The repository no longer names the project myClinic's
technical foundation was adapted from — `THIRD_PARTY_NOTICES.md` credits only the
packages the app actually ships.

Two guards keep both promises: `tests/landing.test.mjs` fails if a second demo
entry appears on the marketing page or if any file names the reference project.
283 tests, 13 suites.

**Upgrading.** No database change — schema 10 covers this build.

## [1.11.7] — 2026-11-04 · schema 10

A clinic on the yearly plan was shown as monthly, quoted the monthly price, and —
the part that costs money — **renewed for one month when it had paid for twelve**.
The payment reference it had just recorded disappeared from the screen a moment
after it was saved.

**The licence view was dropping what it needed.** `licenseState()` returned
status, plan, days left and a period end, but not `interval` or `collection_ref`.
Every screen that asked for them got `undefined`: the status card fell back to
"Monthly", prices were quoted monthly, the CSV export wrote `monthly`, and the
renewal dialog passed `months: 1` to a database that would otherwise have used the
row's own interval. The view now carries both, and a test pins them.

**A payment buys the subscription's term.** Renewal reads the saved interval
(`billingPeriod`) rather than the dialog's price toggle, so browsing monthly and
then recording a payment on a yearly plan still buys a year. The demo workspace,
which added a hard-coded 30 days whatever the plan, now extends by the term paid
for — calendar months, matching `renew_subscription()` in Postgres.

**Two smaller things.** The sidebar offers "Manage subscription" only to a seat
that can open it (owner); everyone else sees the plan, the status and who to ask.
And paise print in pairs: `₹23,990.40`, never `₹23,990.4`.

**The README is rebuilt** as a project front page: what the app is, the role
table, plans and the subscription lifecycle, tech stack, project layout, local
setup, database and migration rules, testing gates, deployment, troubleshooting,
and the documentation index. A `.markdownlint.json` keeps it lint-clean.

**Upgrading.** No database change — schema 10 covers this build. If you have not
run `supabase/schema.sql` since v1.11.6, run it once.

## [1.11.6] — 2026-11-04 · schema 10

The Team page has always described three seats: the owner holds *billing, plans,
staff and every clinical record*, the doctor holds *appointments, consultations
and prescriptions*, the front desk holds *appointments, patient registration,
payments*. The app did not enforce it. A doctor could open Billing and raise an
invoice from a consultation; the front desk could open Consultations and read
every note; and Reports — promised to all three — refused the front desk. The
database was looser still: the invoice policies accepted all three roles and the
consultation policy accepted all three, so the API answered yes even where no
screen asked.

This release makes the table true in two places at once — the screens and the
policies — because a hidden button is not a rule.

**In the app.** The capability map is now the single source: `ROLE_MATRIX` prints
the Team page, the nav and every route read the same map, and the screens that
build a bill (`ConsultationForm`, `Consultations`, `PatientDetail`) ask
`can(role, 'invoice:create')` instead of assuming the person is allowed. A doctor
keeps the chart and loses Billing, the Billing tab, *Raise invoice*, *Collect* and
*Save & bill*. Front desk keeps registration, the diary, billing, payments and
the day close, and loses Consultations, Follow-ups and the note text on a
patient's chart. The owner is unchanged.

**What each side still sees.** Losing a table is not the same as losing your
numbers: `monthTotals`, `footfallSeries` and `dayTotals` take
`canSeeConsultations` and fall back to completed appointments, so the front
desk's dashboard, Reports and day close count the patients who actually came in
instead of reporting a clinic that stood still. A doctor's dashboard hides
collected/outstanding and the revenue panels, and shows the waiting queue in
their place; the balance reminders in Follow-ups are not drafted at all for a
role that cannot open an invoice.

**In Postgres (schema 10).** Two policies move and nothing else does. The invoice
policies (`invoices_read`, `invoices_write`, `invoices_update`) stop accepting
`'doctor'`; `consultations_read` stops accepting `'frontdesk'`. Both the
canonical policy definitions and the migration block carry the same lists, and a
new test fails the build if the SQL and the capability map ever disagree again —
which is how the front desk ended up able to read notes in the first place.

**Upgrading.** Run `supabase/schema.sql` again in the Supabase SQL Editor. It is
idempotent and additive: schema 10 rewrites four policies, records itself in
`schema_migrations`, and touches no clinical or billing row. Clinics already
running schema 9 upgrade in one pass.

Suites A–F pass on a fresh install and on a 9 → 10 upgrade, including new suite F,
which signs in as each of the three seats in turn and checks what each can read,
raise and settle.

## [1.11.5] — 2026-11-05 · schema 9

A clinic created after schema 8 had no public address. `create_clinic()` never
set `slug`, so the booking link Settings handed over — and every poster, WhatsApp
message and Google listing carrying it — opened a page that said *no clinic is
published at this address*. Settings did not make it obvious, because it filled
the gap with the sample clinic's slug (`sunrise-opd`): the owner copied a link
that looked right and went somewhere else.

Three things were wrong and all three are fixed.

**The address is minted when the clinic is created.** `create_clinic()` now
inserts `slug`, using a new `public.next_clinic_slug(name)`, which steps around
an address another clinic already holds (`dr-mehta-clinic`, `dr-mehta-clinic-1`).
Provisioning also no longer fails when the owner left their name blank.

**Schema 9 gives every existing clinic one.** A row-by-row backfill (not one
`UPDATE` — each pass has to see what the previous pass took) fills in a missing
slug and rewrites any that the public lookup could never match: capitals (the
lookup lowercases the address), punctuation, or a slug past 40 characters. A
`clinics_slug_format` check constraint keeps it that way.

**The owner can change it, safely.** New `public.set_clinic_slug(clinic, slug)`,
owner-only and revoked from `public`/`anon`, normalises what was typed, steps
aside on a collision and falls back to the clinic's name when the field is
cleared. It returns the address that is now live, so Settings can show exactly
that.

On the client: Settings shows the link the database answers on and nothing else —
Copy and Open stay disabled until a link exists instead of offering the demo
clinic's — and a changed name reads *"Not saved yet — patients stay on
/book/old-name until you save."* `clinicSlug()` in `public-booking.mjs` mirrors
`clinic_slug()` in SQL, and `tests/booking-link.test.mjs` holds both to the same
examples. `/book` with nothing after it no longer renders the sample clinic.

The public page also stopped waiting for the staff workspace: `/book/:slug` and
`/booking/:ref` now render outside `StoreProvider`, so a patient sees the clinic
instead of "Opening your clinic…" while the clinic's patients, invoices and diary
load (or fail to) on their phone.

**Run `supabase/schema.sql` again.** It is idempotent and additive; it registers
migration 9 and fills in every existing clinic's address. Schema 8 projects keep
working without it (the client falls back to a plain row write), but a clinic
created there still has no slug.

## [1.11.4] — 2026-11-04 · schema 8

Saving a staff member failed in a live clinic with

```
PATCH /rest/v1/staff?id=eq.… 400 (Bad Request)
{"code":"PGRST204","message":"Could not find the 'client_updated_at' column of 'staff' in the schema cache"}
```

— and then repeated every few seconds, because that operation could never succeed
but was also never given up on. Worse, it sat at the head of the outbox, so **every
write queued behind it stopped syncing**.

### Fixed
- **The offline layer no longer sends columns a table does not have.** `staff` and
  `invoices` declare neither `client_id` nor `client_updated_at`, but every queued
  update was stamped with the second and every queued create carried the first. So
  editing a staff member, and *creating an invoice* ("Save & bill"), were both
  rejected by PostgREST. `OFFLINE_COLUMNS` in `src/lib/offline.js` now mirrors the
  schema, and a new guard in `tests/schema.test.mjs` fails the build if the two
  drift apart again.
- **Idempotent replay does not need `client_id`.** The client already generates the
  row's primary key, so a replayed insert hits the duplicate key and is recognised
  as already applied; where `client_id` exists it is still used, and where it does
  not the replay dedupes on `id`. One invoice stays one invoice.
- **A rejected change can no longer block the queue.** A permanent failure (4xx with
  no recognised code) is retried `MAX_SYNC_ATTEMPTS` (5) times with backoff and is
  then moved to the sync centre as a conflict with the server's message — the rest
  of the outbox keeps draining. Network errors, rate limits, expired sessions and
  unsynced parents still retry indefinitely, as before.
- **Columns the database has not got yet are dropped, not fatal.** If a build is
  newer than the SQL that was run (the normal state during an upgrade, and permanent
  if the paste was skipped), the offending column is removed from the payload and
  the write is retried once. `PGRST204` / `column … does not exist` is now classified
  as a repair rather than a fatal error.

### Added
- `tests/sync.test.mjs` — 15 tests over the replay engine with a fake PostgREST that
  rejects unknown columns exactly the way the real one does: staff edits carry no
  stamp, clinical edits still do, an invoice create sends no `client_id` and lands
  once when replayed, a missing column is dropped and the write still lands, a
  permanently rejected change reaches a human instead of looping, a poison operation
  no longer blocks the writes behind it, and a network failure is still just a
  backoff. 240 tests total.

## [1.11.3] — 2026-11-04 · schema 8

`schema.sql` could not be applied to a new Supabase project: schema 8 (public
booking, shipped in 1.11.0) stopped at `syntax error at or near "both"`, so the
booking functions, the booking-reference column and the slug backfill were never
created. A second defect sat behind it — every online booking that created a new
patient would have failed at runtime. Both are fixed, and the schema is now applied
and exercised against a real Postgres before release.

### Fixed
- **`btrim(both '-' from x)` is not SQL.** `btrim` takes two arguments
  (`btrim(x, '-')`); the `BOTH … FROM` form belongs to `trim`. The expression is now
  a function of its own, `public.clinic_slug(name)`, so the rule has one home:
  32 characters of lower-case ASCII, hyphens at the ends trimmed, `clinic` when
  nothing survives (a name written in Devanagari, for example).
- **`public_book()` could not create a patient.** It declared a local variable named
  `code` and then queried `patients.code` in the same statement, which Postgres
  refuses as an ambiguous reference — but only when a booking needed a *new* patient,
  so it would have surfaced as "the booking page does not work for new patients" after
  the syntax error was fixed. Renamed to `patient_code`, and the column is qualified.
- **Schema 8 now checks for its own objects.** The migration skipped itself when
  `app_meta.schema_version` was already 8, which is exactly what a paste that stopped
  half-way leaves behind. It now also asks whether `public_book()` exists, so a
  half-applied database finishes on the next run instead of silently staying broken.

### Added
- `supabase/schema-tests.sql` gains **Suite C · public booking** (the five anon RPCs
  called the way the booking page calls them: profile, book, the same tap twice, one
  live booking per phone, a taken slot, the slot grid, the horizon, phone and name
  validation, a closed clinic, busy minutes leaking nothing, lookup, cancel, a
  cancelled slot being re-sold, the three-a-day flood guard, anon reading no table,
  and the definer/pinned-`search_path` shape of the surface) and **Suite D · naming**
  (`clinic_slug` pinned for case, punctuation, end hyphens, non-ASCII and null).
  Both roll back.
- `tests/schema.test.mjs` — 10 guards that run in `npm test`: no `btrim(… both … from)`,
  no variable named after a column in `public_book`, every `security definer` function
  pins `search_path`, the five RPCs are revoked from `public` and granted only to
  `anon`, the file is one transaction, dollar-quotes balance. 224 tests total.

### Verified
- `supabase/schema.sql` applied to a blank PostgreSQL 17 database: exit 0, version 8.
- Upgraded a schema-7 database carrying four clinics with null slugs (two of them
  with the same name, one with a Devanagari name): version 8, slugs
  `sunrise-multispecialty-opd`, `sunrise-multispecialty-opd-1`, `clinic`, `weird-name`.
- A version-8 database whose `public_book()` had been dropped: re-running the file
  restored it.
- All four suites pass, 45 assertions: `ALL RLS CHECKS COMPLETED`,
  `ALL LICENSING CHECKS COMPLETED`, `ALL BOOKING CHECKS COMPLETED`,
  `ALL SLUG CHECKS COMPLETED`.

## [1.11.2] — 2026-11-04 · schema 8

The marketing site and the app now have one set of breakpoints instead of a
collection of one-off media queries, and the phone version of the landing page is
built to be read on a phone rather than merely squeezed onto one. No schema change.

### Fixed
- **The footer stacks properly at every width.** It was a single flex row of seven
  items: on a phone the copyright, the version and four links wrapped into an
  unreadable line, and on a wide screen it ignored the page's 1280px container and
  started hard against the window edge. It is now a real footer — brand and pitch,
  three titled link columns, a bottom bar with the copyright and version — that goes
  two columns at 760px and one at 360px, with 44px tap targets and safe-area padding
  for the iOS home bar.
- **The closing call-to-action no longer collapses.** It used an inline
  `grid-template-columns: minmax(0,1fr) auto`, so on a phone the text was squeezed
  into a column about forty pixels wide — the heading rendered one word per line —
  while the buttons overlapped it. `.mk-final` stacks below 760px and the buttons go
  full width.
- The hero's `<br>` is ignored below 640px, so the headline wraps by measure instead
  of leaving "for" alone on its own line.
- The security cards form two even rows of three on a wide screen instead of a row of
  four with two orphans.

### Changed — the phone layout is now deliberately simpler
- **The nav folds into a menu.** The four section links no longer vanish below 900px
  with no way to reach them: a menu button opens a sheet with Features, How it works,
  Pricing, Security, the deployment guide and the patient booking page. It closes on
  Escape, on a link, and when the screen grows. On a phone the "Sign in" button moves
  into that sheet, so the bar is brand, theme, Start free, menu.
- **Twelve feature cards become twelve folded rows** below 640px — icon and title,
  tap to read the paragraph. The landing page is 2200px shorter on a 390px screen
  (8608 → 6400) with nothing removed.
- **Pricing shows one plan at a time** on a phone, behind a Solo / Growth /
  Multi-clinic switch, instead of three cards stacked 1600px deep.
- Tighter type and rhythm on a phone: smaller section padding, tighter card padding,
  and the capability chips scroll sideways on one line instead of wrapping to five.

### Added
- `src/lib/responsive.mjs` — `layoutFor(width)` (`phone` ≤640, `tablet` ≤900,
  `desktop`), `isCompact`, `usesMenu`, and the footer link groups as data.
- `src/lib/use-layout.js` — the hook that keeps the layout bucket in sync with the
  viewport, coalesced into one animation frame.
- 14 new tests (214 total) covering the breakpoints, the fallbacks and the footer
  links: every target is an in-page anchor or a route that exists, never both.

## [1.11.1] — 2026-11-04 · schema 8

Inviting a front-desk seat or another doctor did not work. In a live clinic the
invitation was written but never claimed — the invited person signed up, found no
membership, and was asked to create a clinic of their own. In the demo it created a
half-built person (named after their email, no hours, ₹0 fees) and quietly demoted
the demo user from owner to doctor, because the role was read from `staff[0]` —
whichever seat was added most recently.

### Added
- **Pending invitations** in Doctors & staff: who is waiting, their role, days left
  before the offer lapses, the link to send, and a way to withdraw it.
- The invitation carries a name, and — for a doctor — a specialty and a
  qualification, which `accept_invite()` copies onto the seat. The client writes the
  invite row directly (the same owner-only policy `invite_staff()` uses), because
  the RPC carries no specialty.

### Fixed
- **The seat is claimed on first sign-in.** `accept_invite()` is now called from
  `loadLive()` when an account has no membership, so an invited front-desk member or
  doctor lands inside the clinic instead of being pushed to onboarding.
- **The invitation link carries its token** (`#/signup?invite=<token>`), kept in
  sessionStorage across sign-up and email confirmation, and passed back to
  `accept_invite()`. The signup page recognises it: it says "You have been invited",
  hides the clinic-name field and creates the account directly into the clinic.
- **A refused claim is explained.** If the plan has no seat left, the invitation was
  withdrawn, or the address does not match, the reason is shown on the next screen —
  not swallowed by an empty catch.
- **Email confirmation lands in the app** (`#/app/dashboard`) rather than on
  onboarding, so a new owner is routed correctly and an invitee's seat is claimed
  before anything else happens.
- **The demo invite creates a complete seat**: a readable name (`priya@…` → Priya,
  `dr.new@…` → Dr. New), the clinic's hours, slot length and fees for a doctor, and a
  calendar colour no one else is using. It no longer demotes the demo owner to
  doctor afterwards.
- The clinic role and current member are read from the owner row, not from
  `staff[0]`.

## [1.11.0] — 2026-11-04 · schema 8

Patients could not book themselves. Every appointment started with a phone call the
desk answered mid-queue, and a patient who wanted to cancel had to reach a human.
This release gives each clinic a page at `/#/book/<clinic>` that works with no
account, and makes the booking a first-class appointment rather than a request.

### Added
- **Public booking page** (`/#/book/:slug`). Clinic name, brand colour and phone at the
  top; the doctor's day split into morning, afternoon and evening; a 14-day strip that
  greys out the days that are already full; name, mobile and an optional reason. No
  account, no payment, nothing clinical.
- **A reference the patient keeps** (`BK-4K7P2Q`) and a `/#/booking/:ref` page to look the
  appointment up and cancel it. Cancelling releases the slot immediately and keeps the
  record.
- **Settings → Clinic → Public booking**: on/off switch, the copyable link, the slug, how
  far ahead the diary opens (7/14/21/30 days) and a note shown to patients.
- **Reports → Where the diary comes from**: walk-in, phone, online and referral split for
  the month, so a clinic can see whether the link is working.
- `appointments.booking_ref` and `appointments.cancelled_at`; the booking page's five
  `security definer` RPCs, granted to `anon` and to nobody else.

### Changed
- An appointment's `source` now carries through from the public page (`'online'`) and is
  reported rather than assumed to be a walk-in.
- `appointments` uniqueness moved from a full constraint to a partial unique index on
  live rows, so a cancelled slot can be booked again without deleting history. Strictly
  weaker than the constraint it replaces: no row that satisfied the old rule can violate
  the new one.
- The landing page links to a real booking page and lists online booking in the
  capability strip.

### Fixed
- A clinic row that never had a `slug` (the column arrived in migration 4 for branding
  and was never filled) is given one during migration 8, derived from the clinic name.

## [1.10.1] — 2026-11-04 · schema 7

A marketing patch: the landing page did not mention the release it was selling.

### Changed
- The feature grid gains **Close the day, not a notebook** (collections by method, cash counted
  against cash expected, the frozen snapshot) and **Reminders with a paper trail** (one
  privacy-safe message per patient, WhatsApp and copy actions, a send log that stops the same
  patient being chased twice). Twelve cards, three to a row.
- The section headline reads "One clinic, from the first token to the closed day", the hero
  paragraph ends on the counted drawer, and the capability strip lists **Day close**.

No application behaviour changed.

## [1.10.0] — 2026-11-04 · schema 7

The end of the day, inside the app. Until now the front desk closed the day on a
notebook: cash counted against a total read off the billing screen, and the visits
that were never billed found later — usually by the accountant, usually a month on.
Day close does both jobs in one pass, and keeps the receipts.

### Added
- **Day close** (`/app/day-close`). Money in for any day, split by payment method,
  including part payments collected today against older bills. Cash expected in the
  drawer, cash counted, and the variance — short, over or matching — with a note.
- **A close is a snapshot, not a query.** Closing writes `day_closes` (one row per
  clinic per day) with the totals frozen at that moment, so a sheet printed at 9pm
  still agrees with the app after tomorrow's invoices arrive. A closed day can be
  reopened and re-closed; the row is updated, never stacked or deleted.
- **Missed-charge detector.** Every charge the day leaked, with the patient, the
  amount and the way to fix it: a patient marked completed with no invoice, notes
  saved with no bill, a bill from today still open (part paid or untouched), and
  dues older than a week, aged in days.
- **Reminder queue** on Follow-ups. One privacy-safe message per patient, drafted
  from three sources: booked appointments inside the reminder lead time, recalls
  that are due or overdue, and balances owed for longer than a week. Balances for
  one patient are totalled into a single message.
- **A send log** (`reminders`). Copy, open WhatsApp, mark sent or skip — the log
  records which, on which channel, when, and by whom. It is deliberately honest:
  nothing claims delivery it cannot prove. Anything logged inside its window
  (1 day for an appointment, 3 for a recall, 7 for a balance) drops out of the
  queue, so a patient is never chased twice for the same thing.
- **Quiet hours and lead time are honoured** from Settings → Reminders. Drafts made
  overnight are held for the morning rather than pretended to be sent.
- Day sheet as text for the clinic group, and as CSV for the accountant.

### Changed
- The per-recall "Remind" message and the queue now share one message builder, so
  every reminder carries the clinic, the doctor, the date and the time — never a
  diagnosis, a drug or a reason for the visit.
- The day's own navigation gains **Day close** under Records & money, and a way in
  from the dashboard header.

### Notes
- Schema 7 adds `day_closes` and `reminders` with RLS: everyone in the clinic reads
  the day sheet, the owner and front desk write it; the send log is append-only for
  staff and deletable only by an owner. The client reads both tables tolerantly, so
  a database still at schema 6 runs every other screen and says which migration is
  missing.

## [1.9.0] — 2026-11-04 · schema 6

A phone pass over the whole app. Desktop is untouched — every rule lives inside a
`max-width` query — but a doctor between rooms, or a front desk on a tablet, now gets
a layout built for a thumb instead of a squeezed desktop.

### Changed
- **Appointments day board → agenda.** On a phone each slot is a row: time and status
  in a left rail, the patient's full name across the width, the actions underneath
  where a thumb reaches them. Free and past slots collapse to a single quiet line.
- **Lists read down, not across.** Consultations, patients, invoices and the "waiting
  for notes" queue each became a two-line card with a full-width action row. The
  waiting queue in particular was unusable: its rows were a broken column of time,
  avatar, badge and button with the name spilling outside the card.
- **KPI tiles two per row** and stacked internally (icon + label, value, meta), so a
  long label can no longer collide with the number inside the accent tile.
- **The consultation sheet fills the screen.** Header and footer are sticky, the
  footer's committing action ("Save & bill") gets its own full-width row, and the
  prescription grid puts the drug name full width with dose / how often / for / food
  relation in two columns. "Recently prescribed here" is one swipeable row.
- **Long registers page themselves** — 12 rows on a phone, 80 on a desktop, with a
  "Show 12 more" row that says how many are left.
- **Wide report tables scroll inside their card** rather than wrapping every heading
  and hiding columns.
- Every interactive element is at least 38–44px, and form fields use a 16px font so
  iOS no longer zooms the page when a field is focused.

### Fixed
- The patient row's "Book" action was a borderless ghost button stretched across the
  row, so it read as empty space between the name and the icons.

## [1.8.0] — 2026-11-03 · schema 6

### Added
- **A clinic medicine master with safety checks** (`src/lib/medicines.mjs`,
  `src/components/MedicinePicker.jsx`). The drug field is now a typeahead over ~50 common
  Indian brands with their molecule, strength, form and dispensing schedule; it matches on
  brand (`dolo`), molecule (`paracetamol`) or symptom (`fever`), and picking a row fills the
  dose, frequency, duration and food relation from that medicine's default template — which
  is where the retyping actually disappears.
- **Typing is never blocked.** The field is a plain text input first and a typeahead second:
  an unknown drug is saved exactly as written, and the line then still goes through the
  safety checks using an inferred molecule when the name matches one.
- **Safety panel on every prescription** (`checkPrescriptionSafety`): duplicate molecule
  (two brands of the same salt), duplicate *class* (two NSAIDs, two PPIs, two
  antihistamines, two statins…), ~22 curated interaction pairs, and the patient's own
  free-text allergy field matched against the molecule and its class. Severity ordering is
  high → moderate → info so the dangerous finding is at the top.
- **High-severity findings must be acknowledged, and the acknowledgement is recorded.**
  Saving is blocked until the prescriber ticks *"I have reviewed this and want to prescribe
  anyway"*; the finding ids, the accepted ids, the formulary version and a timestamp are
  written to `consultations.rx_safety` (schema 6) — the audit trail a doctor needs if a case
  is questioned, without adding clicks to the everyday prescription.
- **Schedule H1 / X notice**: prescribing an H1 drug raises a register notice (not a block)
  naming the drug that must be entered in the H1 register.
- **Prescriptions are numbered** `RX/26-27/0001` — their own series, independent of
  `INV/…` invoices, session-scoped to the financial year, unique per clinic in the database
  (`consultations.rx_number`, `rx_version`, schema 6), and printed on the prescription.
- **"Recently prescribed here"** replaces the fixed template list: the drugs this clinic
  actually writes, one tap away, with their real doses.
- Prescription print now shows each drug's molecule, form and H1/X schedule under the brand
  name — what a pharmacist and the next doctor read.

### Fixed
- **The consultation dialog stole the caret on every pause.** Its "focus the first field"
  timer re-armed on every render (`onClose` was an inline function in the effect's
  dependencies), so pausing mid-word pulled the cursor to the header's Close button. It now
  focuses once, on open, and only if the user has not already moved the caret.
- **Dead interaction rules in the formulary.** Levothyroxine was tagged `thyroid` while
  three rules matched `levothyroxine`, so the calcium / iron / PPI warnings could never
  fire; `duplicateClasses` listed `ppi` twice. The test suite now fails if a rule names a
  class no medicine carries.
- A brand that already carries its strength ("Dolo 650") no longer prints it twice
  ("Dolo 650 650 mg"), and `financialYear()` accepts a `Date` as well as an ISO string.

## [1.7.0] — 2026-11-03 · schema 5

### Added
- **UPI collection on unpaid invoices.** A clinic can now set its UPI ID (VPA) in
  *Settings → Billing & invoices → Payments & UPI*; every unpaid invoice then carries a
  scannable QR with the exact balance pre-filled, on screen and on paper. The QR is
  generated locally as SVG (`src/lib/upi.mjs`, `src/components/UpiQr.jsx`) — no QR
  service, no network call, and it stays sharp when printed at 300 dpi. Money still moves
  clinic-to-patient directly; the app only records that it happened.
- **One payment sheet, three entry points.** `CollectPayment` is used by the billing list,
  the invoice document and the patient chart, so collecting behaves identically wherever
  the front desk stands. It shows the QR *before* anything is recorded (scan → confirmation
  → type the reference → save), supports part payments, and captures the method plus an
  optional reference (UPI UTR / card last-4 / receipt number).
- **`invoices.paid_on` and `invoices.payment_ref`** (schema 5) print on the invoice, so a
  settled bill says *when* and *how* it was settled.
- **A "next step" strip on the patient chart**: outstanding money with a one-tap *Collect*,
  or consultations that were never invoiced with a prompt to raise the invoice.

### Changed
- **Invoice document rebuilt** (`InvoiceView`): proper tax-invoice header with status
  stamp, billed-to / doctor / payment columns, line-item table, totals with the amount in
  words, and a pay block that becomes a *Paid in full* receipt once the balance is zero.
- **Print layout for both documents**: A4 `@page` margins, a repeating page footer with the
  clinic contact and document number, colour-exact QR and status stamp, no page breaks
  inside totals or the pay block, and a white paper background (the app's screen backdrop
  no longer leaks into the PDF).
- **Prescription** now shares the invoice's header conventions (document kind, doctor,
  register number, date), gets a framed patient strip, a real clinic footer, and no longer
  prints a red allergy alert for "None reported" or repeats the follow-up date in English.
- **Consultation → bill → collect is continuous**: *Save & bill* opens the invoice it just
  raised, an invoice created from Billing opens as a document, and a patient chart shows
  what is unbilled or unpaid instead of making the user hunt for it.

### Fixed
- **"Bill" on the consultations list opened a broken route.** It navigated to
  `/invoice/INV/2526/0001` (the invoice *number*) instead of the created row's id, landing
  on "Invoice not found". It now opens the invoice that was just written.
- Amount-in-words and payment-application helpers (`amountInWords`, `applyPayment`) live in
  `logic.mjs` so the UI and the store can never disagree about a balance.

## [1.6.0] — 2026-11-03 · schema 4

### Changed
- **`supabase/schema.sql` is now the single source of truth for the whole database.**
  The separate `licensing.sql`, `branding.sql`, `rls-tests.sql` and `licensing-tests.sql`
  files are gone. One file creates a fresh project *and* upgrades an existing one in
  place, in a single transaction, from any earlier version — so "the database needs
  updating" is answered by re-running the same file.
- **The file carries its own version story.** A header version registry, a
  `schema_migrations` ledger, `app_migrations()` and `app_schema_version()` report where a
  database stands and what this file expects. Each migration is a guarded block that
  checks the recorded version, runs only if needed, then records itself.
- `supabase/schema-tests.sql` merges both regression suites (role matrix + licensing) into
  one rolled-back run, ending in `ALL RLS CHECKS COMPLETED` / `ALL LICENSING CHECKS COMPLETED`.
- README, `docs/SUPABASE-SETUP.md` (§3 is now one step, not three) and `docs/SECURITY.md`
  document the single-file model; `npm run test:security` checks for it.

### Fixed
- **`license_state()` is now `volatile`.** It seeds a default subscription row on first
  read for a database that predates licensing, and a `stable` declaration made that write
  fail with *"INSERT is not allowed in a non-volatile function"* — the first licence check
  on an upgraded clinic would error instead of returning a plan.
- Seat-limit assertions in the test suite are now isolated in their own exception blocks,
  so a rejected insert can no longer roll back the accepted ones around it (a plpgsql
  `exception` block is a sub-transaction).

## [1.5.0] — 2026-11-03 · schema 4

### Added
- **Clinic logos.** Settings → *Logos & branding* takes a **square** logo (1:1) and a
  **wide** one (up to 4:1). Either stands in for the other, so a clinic that uploads one
  file still gets a header on its paperwork.
- **They land everywhere they should.** The wide logo heads prescriptions and invoices,
  the square one becomes the sidebar mark, and both are available for WhatsApp profile
  photos and email signatures through `brandKit()`.
- **`src/lib/branding.mjs`** — pure logo rules: a two-shape catalogue, byte-level image
  sniffing, an SVG safety check, size arithmetic and the shared brand kit.
  **`src/lib/logo.js`** — the browser half: reads the file, re-encodes through a canvas,
  drops EXIF, and keeps the output under a bounded size.
- Logo columns, their size/format guards and the `schema_version = 4` bump live in
  **§4 of `supabase/schema.sql`** (originally shipped as a separate `branding.sql`).
  11 new unit tests (75 total).

### Security
- Image **type is decided by magic bytes**, not by the file name or the browser-supplied
  MIME type, so a renamed file cannot slip through.
- **SVG logos are parsed as text and refused** when they contain script, event handlers,
  `foreignObject`, remote `href`/`xlink:href` or `@import`. Raster logos are re-encoded
  through a canvas, which strips anything that is not pixels.
- Logos are only ever stored as `data:image/…` URLs; the database constraint rejects any
  other value, so a logo field cannot be used to smuggle a remote URL into documents.
- Uploads are capped at 2 MB in, ~220 KB stored, with a hard row-level guard.

### Fixed
- **The allergy line printed as a bare `:` on every prescription** — the chip read
  `d.heading_allergy`, but the sheet exposes `d.allergy`, so the label was `undefined`
  in all ten languages. Patients with allergies now see `ALLERGY: Penicillin`.
- An invoice table wider than a 360px phone pushed the whole page sideways; the table now
  scrolls on its own.
- The landing page hero badge was hardcoded `v1.0` and had been stale since 1.1.

## [1.4.0] — 2026-11-03 · schema 3

### Added
- **`src/lib/schedule.mjs`** — one pure scheduling engine for the whole app:
  `intervalOf`, `overlaps`, `detectClashes`, `availableSlots`, `groupSlots`,
  `suggestNext`, `buildDayBoard`, `weekLoad`, `weekByDoctor`, `explainConflict`.
  Intervals are half-open, so back-to-back visits never clash and a 30-minute
  booking correctly blocks both 15-minute rows it covers. 11 new unit tests (65 total).
- **Day board** (`/app/appointments`) — a column per doctor, blocks that span their
  real duration, dashed bookable slots, a live marker on the visit happening now, and a
  separate list for bookings that sit off the slot grid so nothing silently disappears.
- **Week view** — load per doctor per day: open slots, bookings and utilisation, with a
  click-through that opens that day's board for that doctor.
- **Slot-first booking sheet** — times grouped Morning / Afternoon / Evening, booked
  slots struck through and disabled, day stepper, and a *Next free* button that jumps to
  the earliest workable slot across the clinic.
- **Undo** for cancelled and no-show bookings in the day view, with the freed slot named.
- KPI strip on the scheduling screen: scheduled, in clinic, completed, free slots and
  utilisation, all computed from the same engine as the board.

### Changed
- Availability is interval-aware everywhere. A visit now blocks its whole duration
  rather than just the starting row, and "outside working hours" is judged on the visit's
  **end** time, so a 45-minute consultation can no longer start four minutes before close.
- Demo data now seeds each appointment inside its doctor's own session, so the board,
  the token queue and Reports all describe a believable clinic day.

### Fixed
- Booking a specific time from an empty slot opened the sheet with 09:00 preselected —
  the clicked slot was dropped when the sheet re-seeded, which could book the wrong time.
- `week` did not honour an injected clock, so "today" was highlighted from the real date.

## [1.3.0] — 2026-11-03 · schema 3

### Added
- **Subscription licensing.** §3 of `supabase/schema.sql` adds `clinic_subscriptions`,
  `license_state()`, owner-only `change_plan()` / `renew_subscription()` /
  `start_trial()` / `set_license_status()`, a `seat_guard` trigger and a
  `subscription_write_guard` trigger. Every clinic starts on a 14-day Growth trial;
  yearly billing is 20% cheaper.
- **`/app/subscription`** — plan cards with proration-free upgrade/downgrade pricing,
  live seat meters, payment recording with a collection reference, and a CSV export of
  the current terms. Owner-only, mirroring the RPCs.
- **`src/lib/license.mjs`** — the pure client mirror of the database rules:
  `trial → active → grace (7 days) → read_only → expired`, seat arithmetic, pricing.
  Covered by 9 new unit tests (54 total).
- **Licence banner** in the app shell and a real status badge on the sidebar plan card.
  Quiet while healthy, loud in the last week of a trial, and unmistakable once writes stop.
- **`supabase/licensing-tests.sql`** — a rolled-back suite that proves the trial cannot be
  farmed, seat limits hold, downgrades below usage are refused, the read-only gate blocks
  writes while reads keep working, and renewal restores the active state.

### Changed
- `create_clinic()` now creates the trial subscription in the same transaction.
- The demo workspace persists its licence on first boot, so offline demos behave the same.
- `npm run test:security` now lists both database suites and their operator commands.

### Safety
- Read-only mode blocks writes in the UI **and** in Postgres; reads, printing and CSV
  export keep working in every state. Nothing is deleted when a subscription lapses.

## [1.2.1] — 2026-11-02 · schema 2

### Changed
- **Toolchain on Node 26 LTS + npm 12.2.1.** `.nvmrc` / `.node-version` pin 26.13.0
  (Lithium), `packageManager` pins npm 12.2.1, and the Pages workflow installs it
  explicitly. `engines` now states the real floor (`node >=22.22.0`, required by
  react-router 8), and CI verifies Node 22 and 26. Verified on Node 26: `npm ci`
  leaves the lockfile untouched, 45/45 tests, build, `check:pages`, `test:security`
  and `npm audit` all pass.
- **Pages workflow reports its own configuration.** It prints the resolved node/npm
  versions, fails if a placeholder Supabase URL is baked into the bundle, and emits a
  notice (or a warning) depending on whether the Supabase secrets reached the build.
  A demo-mode deploy is now visible in the Actions log instead of being discovered
  after someone tries to log in.

### Added
- **Supabase connection self-test** on the setup page (`/#/setup` → *Run test*). Six
  checks: project URL, publishable-key safety (a service-role/secret key is a hard
  fail), HTTPS origin, base-path match, REST reachability with the key, and
  `app_schema_version()` drift. Pure logic in `src/lib/health.mjs`, covered by 6 new
  unit tests.
- **[`docs/SUPABASE-SETUP.md`](docs/SUPABASE-SETUP.md)** — the go-live checklist:
  project creation, the exact redirect URLs for `rajeshlande.github.io/myClinic/`,
  repo secrets, deploy, and a troubleshooting table.

## [1.2.0] — 2026-11-02 · schema 2

### Added
- **Offline-first sync.** Writes land in a local outbox and replay to Supabase; a
  three-way field merge, an explicit conflict policy for money and status fields, and
  reviewable conflicts in a sync centre. Idempotent replay via client ids.
- **Role matrix in the database.** Per-role RLS for every clinical table,
  `invoice_guard()`, `staff_guard()`, owner-granted membership through
  `invite_staff()` / `accept_invite()`.
- **Seven accent palettes**, each with a hand-tuned light and dark ramp.
- **Prescriptions in ten Indian languages** with a print-ready A4 slip and a
  "copy for WhatsApp" action. Drug names deliberately stay in English.
- **Version management**: app/schema versions, build id, changelog UI, schema-drift
  detection (`app_schema_version()`).
- Documentation set: `docs/SECURITY.md`, `docs/DEPENDENCIES.md`, `CONTRIBUTING.md`.
- Repo is publish-ready: CI workflow (Node 22 + 24), Pages deploy workflow, issue/PR templates, `SECURITY.md`, `CONTRIBUTING.md`, Node engine pinning via `.nvmrc`.

### Fixed
- **Critical (security):** any authenticated user could self-assign the `owner` role of
  any clinic via the staff table. See `docs/SECURITY.md`.
- **High:** roles were enforced only in the UI — front desk could author consultations
  and delete records through the API.
- **High:** the whole workspace (including patient data) was persisted to one
  `localStorage` key with no expiry and no purge on sign-out.
- **Medium:** `issue_token()` trusted patient and doctor ids from another clinic.
- **Medium:** `clinics_insert` accepted any authenticated insert.
- `?new=1` deep links did not open the form when the page was already mounted.
- The offline badge crashed when mounted outside the store provider.
- Outbox operation ids collided with row ids, causing an update to be replayed as a create.

### Changed
- Upgraded the toolchain: Vite 8, `@vitejs/plugin-react` 6, lucide-react 1, React 19.3,
  react-router 7.18, supabase-js 2.118. Main bundle 552 kB → 356 kB.
- Node 22.12+ is now required (Vite 8 and supabase-js 2.118 both need it).

## [1.1.0] — 2026-11-02 · schema 1

### Added
- Walk-in token queue with daily per-doctor numbering, a waiting-room display and
  token actions at the desk.
- GitHub Pages deployment with relative-base builds and a readiness check.
- Installable PWA: update bar, install prompt, offline shell.

## [1.0.0] — 2026-10-30 · schema 1

### Added
- Appointments, patient charts, consultations, billing, follow-ups, reports and team.
- Supabase auth with PKCE, clinic-scoped RLS, integer-paise money, demo workspace.

[1.2.0]: https://github.com/rajeshlande/myClinic/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/rajeshlande/myClinic/compare/v1.0.0...v1.1.0
