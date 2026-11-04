# Changelog

All notable changes to myClinic. Versions follow semver; `schema` refers to the
Supabase migration level this release expects (`app_schema_version()`).

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
