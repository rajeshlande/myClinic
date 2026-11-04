# myClinic

**OPD management software for clinics.** Appointments, patient records, consultations, billing and follow-ups in one installable web app — responsive on a reception desktop and a doctor's phone.

Built by adapting the technical foundation of the supplied [`mycar`](https://github.com/rajeshlande/mycar) reference (React + Vite + Supabase, pure testable domain logic, integer-paise money, owner-scoped RLS, versioned PWA shell). The product, schema, workflows and interface are new.

---

## What is included

| Module | What it does |
|---|---|
| **Dashboard** | Today's OPD queue with one-tap check-in → consult, collected-vs-billed trend, footfall, follow-ups due, revenue mix, doctor performance. |
| **Branding** | Upload a square and a wide clinic logo — they appear on prescriptions, invoices and the sidebar, print correctly offline, and feed WhatsApp and email later through one brand kit. |
| **Appointments** | Interval-accurate day board per doctor (a 30-minute visit occupies 30 minutes), week load view, list view, next-free suggestion, check-in, in-consult, completed, no-show, cancel with undo, reschedule. |
| **Public booking** | A page at `/#/book/<clinic>` a patient can open with no account: clinic identity and brand colour, a doctor picker, a 14-day strip that greys out the days that are full, the doctor's day in morning/afternoon/evening blocks, then name, mobile and an optional reason. Slots come from the same `availableSlots` engine the front desk uses, so a patient and a receptionist cannot double-book a time; the database refuses the same slot twice. The patient gets a reference (`BK-4K7P2Q`) to cancel with, and the appointment lands on the calendar with source **Booked online**. |
| **Patients** | Registration with auto patient IDs, clinical flags (chronic conditions, allergies), full chart: timeline, vitals, prescriptions, invoices, appointments. |
| **Consultations** | Vitals, complaint, examination, diagnoses, prescription lines, advice, follow-up date — "Save & bill" creates the invoice in one step. The drug field is a **medicine master typeahead** (brand / molecule / symptom) that fills dose, frequency, duration and food relation, and runs **safety checks** on every prescription. |
| **Billing** | GST-ready invoices with line items, discounts, part payments, payer method (cash/UPI/card/insurance/credit), outstanding dues per patient, printable invoice. Unpaid invoices carry a scannable **UPI QR** with the exact balance pre-filled — set the clinic VPA in Settings → Billing & invoices → Payments & UPI. |
| **Follow-ups** | Overdue / due-today / next-7-days recall lists, closed-loop "mark done", gone-quiet cohort, and a **reminder queue**: one privacy-safe message per patient for booked appointments, due recalls and week-old balances, with copy / WhatsApp actions and a send log that stops the same patient being chased twice. |
| **Day close** | The day's collections split by payment method, cash counted against cash expected with the variance written down, the missed charges found for you (seen but never billed, bills still open, dues older than a week), and a **frozen snapshot** per day — reopen to amend, never overwrite silently. Shareable as text or CSV. |
| **Reports** | Month picker, revenue trend, payer mix, revenue by category, footfall, doctor performance table, top diagnoses, appointment outcomes, **where the diary comes from** (walk-in / phone / online / referral), utilisation, daily collection. |
| **Doctors & staff** | Doctors with their own hours, slot length, fees and calendar colour; front-desk seats; role matrix; seat count against plan. **Invite staff by email** — the invitation carries the name, role and (for a doctor) specialty and qualification, shows up under Pending invitations with the link to send, and grants the seat the first time the person signs in with that address. Nobody can enrol themselves. |
| **Settings** | Clinic profile, **public booking** (on/off, copyable link, the slug, how far ahead the diary opens, the note patients see), billing/GST, account, appearance (theme + density), reminders, plan, data export. |
| **PWA** | Installable, standalone display, offline app shell, shortcuts (queue / book / register / billing), theme-aware icons. |
| **Any screen** | One set of breakpoints (`src/lib/responsive.mjs`): phone ≤640, tablet ≤900, desktop above. On a phone the app runs on a bottom tab bar; the marketing page folds its nav into a menu, its twelve feature cards into tap-to-read rows and its three plans behind a Solo / Growth / Multi-clinic switch, and the footer stacks to two columns and then one. Nothing is hidden that a wide screen shows — only folded. |

Live demo data: the app boots into **Sunrise Multispecialty OPD** with six months of fictional patients, appointments, consultations and invoices — no configuration needed.

---

## Requirements

- Node.js **26 LTS** (pinned in `.nvmrc` / `.node-version` → 26.13.0) and **npm 12.2.1** (`packageManager`)
- Any Node from **22.22+** also works; CI verifies 22 and 26
- npm
- A Supabase project (only when you want real accounts and cloud persistence)
- HTTPS for a deployed PWA; `localhost` is also a secure context

---

## 1. Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # 150 unit tests (domain, day book, offline replay, readiness)
npm run build        # production bundle in dist/
```

No `.env` required — the app runs in **demo mode** until Supabase keys are present. Everything you change in the demo is stored in this browser's `localStorage` and can be reset from **Settings → Plan & data**.

## 2. Connect Supabase

The full operator walkthrough (project creation, exact redirect URLs, repo secrets,
deploy and the in-app self-test) is in [`docs/SUPABASE-SETUP.md`](docs/SUPABASE-SETUP.md).

```bash
cp .env.example .env.local
```

```dotenv
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-PUBLISHABLE-OR-ANON-KEY
```

Restart the dev server (or rebuild) after changing env values.

> **Never** put a `service_role` / `sb_secret_…` key in a `VITE_` variable — Vite ships those values to the browser. `src/lib/supabase.js` refuses non-HTTPS URLs and privileged keys at build time.

## 3. Create the database

Open **Supabase → SQL Editor**, paste all of [`supabase/schema.sql`](supabase/schema.sql), and run it. **This is the only SQL a clinic ever runs.** It is idempotent from any version and never deletes clinical or billing records.

**Tables:** `clinics`, `staff`, `profiles`, `patients`, `appointments`, `consultations`, `invoices`.

**One file, every version.** `supabase/schema.sql` carries its own migration history:
a version registry, a `schema_migrations` ledger, and `app_schema_version()`. A fresh
project and a database created two releases ago both end up identical — you answer
"the database needs updating" by re-running the same file. Nothing is ever destructive,
so re-running it on an up-to-date database is a no-op.

Check where a project stands with:

```sql
select * from public.app_schema_version();   -- current version + expected version
select * from public.app_migrations();        -- which migration each section applied
```

The dev-only verification suite is [`supabase/schema-tests.sql`](supabase/schema-tests.sql)
— four suites, all rolled back: role matrix, licensing, **public booking** (the five
`anon` RPCs called the way a stranger with a link calls them, including every refusal)
and the naming rules. Never run it on production.

If a paste stops half-way, run the file again. Every statement is guarded, so the
second run skips what already exists and finishes what did not — including schema 8,
which checks for its own functions rather than trusting the version number alone.

What the schema enforces:

- **Row-level security everywhere.** A user only sees clinics they are staff of (`is_clinic_staff()`), so one clinic can never read another's patients — even with a crafted request.
- **Atomic onboarding** through `create_clinic(jsonb, jsonb)`: clinic + owner staff row + default clinic on the profile, in one transaction.
- **No double booking** — unique `(doctor_id, scheduled_on, scheduled_at)`.
- **Money as integer paise**, with `paid_paise ≤ total_paise`.
- **Server-side sequences** for patient codes (`next_patient_code`) and invoice numbers (`next_invoice_number`).
- `updated_at` triggers on every mutable table; owner-only writes on `clinics`.

### Data rules

- Money is integer **paise** (₹1,250.50 → `125050`), never floats.
- INR only in this release; no implicit currency conversion.
- Deleting a clinic cascades; patients are **archived**, not deleted, so clinical history and invoices survive.
- Invoice numbers are unique per clinic.

## 4. Authentication setup

In **Authentication → URL configuration**:

1. **Site URL** = your deployed app URL (include the repo path on GitHub Pages).
2. Add redirect URLs:

```text
http://localhost:5173/#/login
http://localhost:5173/#/reset-password
https://YOUR-APP.example/#/login
https://YOUR-APP.example/#/reset-password
```

The client uses the **PKCE** flow and requires email confirmation. For a public launch, configure custom SMTP — Supabase's built-in sender is rate-limited.

## 5. First-drive checklist

- [ ] Schema run in the intended project.
- [ ] Both `VITE_` values added, server restarted / rebuilt.
- [ ] Site URL + both redirect URLs configured.
- [ ] Sign up, confirm the email, sign in.
- [ ] Complete clinic setup; add a second doctor with different hours.
- [ ] Book two patients into the same slot → the second is rejected.
- [ ] Run a consultation and use **Save & bill**.
- [ ] Collect a part payment; confirm the balance shows on the patient chart.
- [ ] Mark a follow-up done; confirm it leaves the recall list.
- [ ] Invite reception (`frontdesk`) and confirm billing settings are owner-only.
- [ ] Deploy over HTTPS, install the PWA, reload offline.

---

## Architecture

```
src/
├─ App.jsx                  routing + auth/data gates
├─ main.jsx                 providers, theme boot, SW registration
├─ components/
│  ├─ AppLayout.jsx         sidebar / mobile tab bar / ⌘K palette
│  ├─ ui.jsx                design-system primitives + toasts
│  ├─ Charts.jsx            dependency-free SVG charts
│  ├─ AppointmentForm.jsx   slot-aware booking
│  ├─ PatientForm.jsx       registration with validation
│  ├─ ConsultationForm.jsx  notes + vitals + prescription
│  └─ InvoiceForm.jsx       line-item billing with live totals
├─ lib/
│  ├─ logic.mjs             ★ pure domain logic, fully unit-tested
│  ├─ store.jsx             demo (localStorage) ⇄ Supabase adapter
│  ├─ auth-context.jsx      session, sign-up/in, reset
│  ├─ supabase.js           guarded client + friendly auth errors
│  ├─ demo-data.js          deterministic six-month demo clinic
│  └─ theme.js              light / dark / system + density
├─ pages/                   Landing, auth, Onboarding, Setup + 10 app pages
└─ styles.css               design tokens, layout, responsive rules
public/                     manifest, service worker, icons
supabase/schema.sql         multi-tenant schema with RLS
tests/logic.test.mjs        money, invoices, slots, analytics, CSV, validation
```

**Design decisions**

- **`logic.mjs` holds every calculation** (money, slot generation, invoice totals, analytics, validation). It has no React or network imports, so it is unit-tested directly and reused by both demo and live modes.
- **One store, two backends.** `store.jsx` exposes `create / update / remove / createClinic` and runs them either against `localStorage` (demo) or Supabase. Pages never branch on mode.
- **Money never touches floating point.** Parsing is regex-validated and paise-rounded; invoices clamp `paid ≤ total`.
- **Mobile first, desktop rich.** The same components render a sticky sidebar + command palette above 1080 px, and a thumb-reachable tab bar, sheet modals and stacked rows below it.
- **Charts are hand-rolled SVG** — no chart library, no layout shift, works in the offline shell.

## Accessibility & privacy notes

- Semantic headings, labelled inputs, `aria-current` navigation, visible focus rings, `Esc` closes dialogs, toasts announce via `role="status"`.
- Colour is never the only signal — statuses carry text labels.
- Reminder templates deliberately exclude diagnoses and medications.
- The demo workspace is explicitly labelled fictional; nothing is sent to a server.

## Known limits in this build

- Reminder **sending** (WhatsApp/SMS) is not wired — the app generates privacy-safe copy to paste. Automatic sending needs a provider and opt-in.
- Plan changes are simulated; connect a payment provider before charging clinics.
- Consultation editing is append-only (create a new visit) to keep the clinical record honest.
- No file attachments (reports, scans) yet.
- Public booking confirms on screen and by a WhatsApp message the patient sends themselves — there
  is no automatic SMS or email confirmation, and no deposit. It needs **schema 8**
  (`public_clinic_profile`, `public_booking_busy`, `public_book`, `public_booking_lookup`,
  `public_cancel_booking`); on an older database the page says so and asks you to run
  `supabase/schema.sql`. In a live clinic the desk sees a booking when the app next loads — there is
  no realtime channel yet, so demo mode (which shares one browser profile) is the only place it
  appears without a refresh.

Deployment, troubleshooting and the Supabase guide are also available in-app at **/#/setup**.

---

## Deploy to GitHub Pages

### Push this repository

The Git history is already initialised on `main` with a `v1.2.1` tag, and
`node_modules/`, `dist/` and `.env.local` are ignored. The target repository is
<https://github.com/rajeshlande/myClinic> (already created and empty).

```bash
git remote add origin https://github.com/rajeshlande/myClinic.git
git push -u origin main --follow-tags
```

Then set the two repository secrets (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`),
turn on **Settings → Pages → Source: GitHub Actions**, and follow
[`docs/SUPABASE-SETUP.md`](docs/SUPABASE-SETUP.md). The Pages path is case-sensitive:
the repository is `myClinic`, so the site lives at `/myClinic/`.


The repo ships a workflow at `.github/workflows/pages.yml` that tests, builds and publishes
on every push to `main`.

1. Push the project to GitHub.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. Optionally add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` under
   **Settings → Secrets and variables → Actions** (without them the deployed site runs in demo mode).
4. The app goes live at `https://<user>.github.io/<repo>/`.

Why it works without editing the config:

| Concern | How it is handled |
| --- | --- |
| Sub-path hosting (`/repo/`) | Vite builds with a **relative base** (`./`); set `VITE_BASE` only if you want absolute URLs |
| Client-side routes | **Hash router** — `/#/app/dashboard` needs no server rewrite |
| Service worker | registered with a **relative scope**, caches only app files (never clinical data or Supabase calls) |
| Jekyll | `public/.nojekyll` keeps hashed asset folders intact |
| Deep links | CI copies `index.html` to `404.html` as a fallback |
| Custom domain | works unchanged — relative assets and hash routes are domain agnostic |

`npm run verify` runs the unit tests, the production build and a Pages readiness check
(relative assets, manifest icons, SW scoping) locally.

## Subscription licensing

myClinic is sold as a subscription, enforced in Postgres rather than in the UI.

| Plan | Price | Seats |
| --- | --- | --- |
| Solo | ₹999 / month | 1 doctor, 1 front desk, 1 branch |
| Growth | ₹2,499 / month | 5 doctors, 3 front desk, 1 branch |
| Multi-clinic | ₹5,999 / month | unlimited |

Yearly billing is 20% cheaper. Every clinic starts on a **14-day Growth trial**.

**Lifecycle:** `trial → active → grace (7 days past the period) → read_only → expired`.
Writes are blocked from `read_only` onwards by a trigger (`subscription_write_guard`);
**reads, printing and CSV export never stop**, so a billing problem can never lock a
clinic out of a patient's chart. Renewal is recorded with a collection reference
(UPI / bank / reseller) — card data never enters myClinic.

Where it lives:

- `supabase/schema.sql` §3 — table, RPCs, seat trigger, write gate (migration 3)
- `supabase/schema-tests.sql` — rolled-back regression suite
- `src/lib/license.mjs` — the client mirror of those rules (unit-tested)
- `/app/subscription` — plan, seats, payment recording, export of the terms

## The public surface

Three routes sit outside the app shell and outside authentication:

| Route | Who opens it | What it can do |
|---|---|---|
| `/#/book` and `/#/book/:slug` | any patient with the link | read the clinic's public profile, the doctors' hours and which minutes are busy; book one appointment |
| `/#/booking/:ref` | the patient who holds that reference | see their appointment, cancel it |

Nothing else is reachable: there is no policy that lets `anon` read a table, only the five
`security definer` functions in migration 8, each granted explicitly and each returning one row or
one narrow shape. `public_booking_busy` returns *times and lengths* — never a patient id, a name or a
reason. The slot rules are enforced twice: in the client by `availableSlots` (the same function the
day board uses) and in the database by a partial unique index on live rows plus a per-doctor-per-day
advisory lock, so the last slot cannot be sold twice at 11pm.

Turn it off in **Settings → Clinic → Public booking**; the link then shows the clinic's phone number
and nothing else.

---

## The token queue

The front desk can serve a patient in two ways:

- **Book a slot** — Appointments → click any dashed *Available* cell on a doctor's day
  board (the time is carried into the sheet), or **New** to pick a slot yourself. Busy
  slots are struck through, and *Next free* jumps to the earliest workable time.
- **Issue a token** — Queue → *Issue token* (⌘K works too). One screen: patient (or register
  inline), doctor, visit type → the next number is reserved and the slip is ready to print.

Numbering restarts every morning **per doctor**, so morning patients get `T-01, T-02…` again
tomorrow without renumbering history. Cancelled and no-show tokens keep their number, so two
patients never hold the same printed token on the same day.

Queue states: **Not arrived → Waiting → In the room → Done** (plus **No show**). The Queue page
shows now-serving, up-next with live wait times, the full token table, a waiting-room display
mode for the lounge screen, and a *Completed today* list for billing. In Postgres the same rules
are enforced by `next_token_no()`, `issue_token()` and a unique index on
`(doctor_id, scheduled_on, token_no)`.

## Installable app (PWA)

- Manifest with maskable icons, `start_url` and `scope` relative to the deploy path.
- Versioned service worker: app shell + hashed assets cached, clinical data never cached.
- In-app **Install** nudge (Android/desktop prompt, iOS Share → Add to Home Screen hint).
- **Update available** bar with a one-tap reload; the SW re-checks whenever the app regains focus.
- Offline banner, offline boot from cache, safe-area insets and a bottom tab bar on phones.

---

## Offline-first sync

Clinical work does not stop when the Wi-Fi does. Every write lands in a local
outbox first and replays to Supabase when the connection returns.

| Concern | How it works |
| --- | --- |
| Local-first writes | `src/lib/offline.js` — the UI updates immediately, the network catches up |
| No duplicates | every row carries a client-generated id; replay checks `client_id` before inserting |
| Merge policy | field-by-field three-way merge against the version the device last saw |
| Money & status | **never** auto-merged — a human picks between "this device" and "clinic database" |
| Deleted elsewhere | the offline edit is queued for review instead of being silently dropped |
| Retries | exponential backoff with jitter, capped at 30 s; network errors keep the change queued |
| Cache lifetime | 24 h TTL, keyed per user **and** clinic, wiped on sign-out |
| Visibility | a bottom bar shows offline / queued / conflict state, tap for the full sync centre |

The replay engine (`replayOutbox`) is a pure function tested against a fake
database, so idempotency, merging, conflicts and retries are covered without a
network (`tests/logic.test.mjs`).

## Roles & data access

Enforced in Postgres by RLS, mirrored in the client so the UI never offers an
action the server would refuse (`src/lib/permissions.js`).

| Capability | Owner | Doctor | Front desk |
| --- | :-: | :-: | :-: |
| Register patients, book appointments | ✓ | ✓ | ✓ |
| Issue tokens, run the queue | ✓ | ✓ | ✓ |
| Write consultations & prescriptions | ✓ | ✓ | — |
| Create invoices, collect payment | ✓ | ✓ | ✓ |
| Void a paid invoice | ✓ | — | — |
| Delete clinical records | ✓ | — | — |
| Money reports | ✓ | — | — |
| Team, roles, clinic settings | ✓ | — | — |

Membership is **granted, never self-asserted**: an owner creates an invite
(`invite_staff()`), and the invited user claims it by signing in with that email
(`accept_invite()`). A trigger (`staff_guard()`) refuses any attempt to change
your own role, clinic or active flag.

## Medicine master & prescription safety

A doctor should not retype "Tab. Dolo 650, 1 tablet, three times a day, 3 days,
after food" two hundred times a week — and should not have to remember every
interaction either. Both live in `src/lib/medicines.mjs`, offline, with no
network call and no external drug database:

- **Typeahead** over ~50 common Indian brands: brand (`dolo`), molecule
  (`paracetamol`) or symptom (`fever`). Picking a row fills the whole line —
  molecule, strength, form, dispensing schedule, dose, frequency, duration and
  food relation — from that medicine's default template.
- **Free text always wins.** The field is a plain input first: an unknown drug is
  saved exactly as written. If the name matches a known molecule it is still
  checked, because a hand-typed "Pantoprazole 40mg" is the same molecule as *Pan 40*.
- **"Recently prescribed here"** shows what this clinic actually writes, so house
  habits survive the catalogue.
- **Checks on every prescription**: duplicate molecule, duplicate class (two
  NSAIDs, two PPIs, two statins…), ~22 curated interaction pairs, and the
  patient's own free-text allergy field matched against molecule and class.
- **High-severity findings must be acknowledged** before saving, and the
  acknowledgement — finding ids, formulary version, timestamp — is written to
  `consultations.rx_safety`. Schedule H1/X drugs raise a register notice instead
  of a block.
- **Prescriptions are numbered** `RX/26-27/0001`, their own series, independent of
  invoice numbers, unique per clinic in the database and printed on the sheet.

## Prescriptions in Indian languages

Doctors write in English; patients need their directions in the language they
read. Ten languages are included — Hindi, Marathi, Gujarati, Bengali, Tamil,
Telugu, Kannada, Malayalam and Punjabi, plus English.

- Frequency, food relation and duration are translated (`src/lib/rx-language.js`).
- **Medicine names are never translated** — the chemist must read exactly what
  the doctor wrote.
- Numbers stay in Latin numerals on purpose.
- The print sheet is A4-friendly and shows the localised line with the English
  original underneath, so nothing is lost when the prescription leaves the room.
- "Copy for WhatsApp" puts the same localised text on the clipboard for the
  patient's phone.

## Theme

Seven accent palettes (teal, indigo, violet, rose, amber, ocean blue, forest),
each with a hand-tuned **light and dark** ramp — dark accents are lighter and
less saturated, not inverted. Colour never carries meaning alone: status is
always labelled.

## Version management

- `src/lib/version.js` — `APP_VERSION`, `SCHEMA_VERSION`, changelog, semver compare.
- Build id + timestamp injected by `vite.config.js`, shown in Settings → About.
- The database reports its schema version (`app_schema_version()`), so a stale
  deployment is detected rather than failing with confusing errors.
- Settings → About lists release notes and the caller's effective permissions.

## Dependencies

Every direct and transitive package, the version installed, and the latest
available stable release is tracked in [`docs/DEPENDENCIES.md`](docs/DEPENDENCIES.md).
Upgrade policy: direct dependencies are kept on the newest stable release;
transitive packages stay inside the ranges our direct dependencies declare.

## Security

`npm run test:security` prints the operator instructions for `supabase/schema-tests.sql`,
a self-contained, rolled-back test suite that creates two dummy tenants and
asserts the role matrix, tenant isolation, token issuance, invoice guards, seat
limits, grace/read-only licensing and plan changes.

A Cloudflare-format audit (`security-audit-skill`) was run against v1.1.0; the
five confirmed findings — including a critical staff self-escalation path — are
fixed in this version. See `docs/SECURITY.md`.
