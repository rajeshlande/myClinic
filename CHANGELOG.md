# Changelog

All notable changes to myClinic. Versions follow semver; `schema` refers to the
Supabase migration level this release expects (`app_schema_version()`).

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
