# myClinic

**OPD management software for clinics.** Appointments, patient records, consultations, billing and follow-ups in one installable web app — responsive on a reception desktop and a doctor's phone.

Built by adapting the technical foundation of the supplied [`mycar`](https://github.com/rajeshlande/mycar) reference (React + Vite + Supabase, pure testable domain logic, integer-paise money, owner-scoped RLS, versioned PWA shell). The product, schema, workflows and interface are new.

---

## What is included

| Module | What it does |
|---|---|
| **Dashboard** | Today's OPD queue with one-tap check-in → consult, collected-vs-billed trend, footfall, follow-ups due, revenue mix, doctor performance. |
| **Appointments** | Slot-accurate booking per doctor (double bookings rejected), day grid + list views, week strip, check-in, in-consult, completed, no-show, cancel, reschedule. |
| **Patients** | Registration with auto patient IDs, clinical flags (chronic conditions, allergies), full chart: timeline, vitals, prescriptions, invoices, appointments. |
| **Consultations** | Vitals, complaint, examination, diagnoses, prescription lines, advice, follow-up date — "Save & bill" creates the invoice in one step. |
| **Billing** | GST-ready invoices with line items, discounts, part payments, payer method (cash/UPI/card/insurance/credit), outstanding dues per patient, printable invoice. |
| **Follow-ups** | Overdue / due-today / next-7-days recall lists, closed-loop "mark done", gone-quiet cohort, privacy-safe reminder copy. |
| **Reports** | Month picker, revenue trend, payer mix, revenue by category, footfall, doctor performance table, top diagnoses, appointment outcomes, utilisation, daily collection. |
| **Doctors & staff** | Doctors with their own hours, slot length, fees and calendar colour; front-desk seats; role matrix; seat count against plan. |
| **Settings** | Clinic profile, billing/GST, account, appearance (theme + density), reminders, plan, data export. |
| **PWA** | Installable, standalone display, offline app shell, shortcuts (queue / book / register / billing), theme-aware icons. |

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
npm test             # 45 unit tests (domain, offline replay, readiness)
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

Open **Supabase → SQL Editor**, paste all of [`supabase/schema.sql`](supabase/schema.sql), and run it. It is idempotent for v1 and never deletes clinical or billing records.

**Tables:** `clinics`, `staff`, `profiles`, `patients`, `appointments`, `consultations`, `invoices`.

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

Deployment, troubleshooting and the Supabase guide are also available in-app at **/#/setup**.

---

## Deploy to GitHub Pages

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

## The token queue

The front desk can serve a patient in two ways:

- **Book a slot** — Appointments → *New appointment*, or the doctor's day grid.
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

`npm run test:security` prints the operator instructions for `supabase/rls-tests.sql`,
a self-contained, rolled-back test suite that creates two dummy tenants and
asserts the role matrix, tenant isolation, token issuance and invoice guards.

A Cloudflare-format audit (`security-audit-skill`) was run against v1.1.0; the
five confirmed findings — including a critical staff self-escalation path — are
fixed in this version. See `docs/SECURITY.md`.
