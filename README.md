# myClinic

**OPD management software for single- and multi-doctor clinics.** Appointments,
public booking, token queue, patient records, consultations, prescriptions, GST
billing and follow-ups — one installable web app that works on the reception
desktop and on the doctor's phone, including when the internet does not.

[![CI](https://github.com/rajeshlande/myClinic/actions/workflows/ci.yml/badge.svg)](https://github.com/rajeshlande/myClinic/actions/workflows/ci.yml)
[![Deploy](https://github.com/rajeshlande/myClinic/actions/workflows/pages.yml/badge.svg)](https://github.com/rajeshlande/myClinic/actions/workflows/pages.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-26.13.0-brightgreen.svg)](.nvmrc)

[Live demo](https://rajeshlande.github.io/myClinic/) ·
[Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md) ·
[Security policy](SECURITY.md)

![Dashboard](screenshots/dashboard.png)

---

## Contents

- [What this is](#what-this-is)
- [Features](#features)
- [Roles and permissions](#roles-and-permissions)
- [Plans and subscription](#plans-and-subscription)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Database](#database)
- [Testing and quality gates](#testing-and-quality-gates)
- [Deployment](#deployment)
- [Offline and PWA behaviour](#offline-and-pwa-behaviour)
- [Troubleshooting](#troubleshooting)
- [Documentation](#documentation)
- [Versioning and releases](#versioning-and-releases)
- [Contributing](#contributing)
- [License](#license)

---

## What this is

A clinic's day runs on one queue and one bill. Most software makes the
receptionist fight the software to get there. myClinic is built around three
constraints:

- **The queue is the day.** Tokens, check-in, "in consult", "done" — and the day
  board is interval-accurate, so a 30-minute visit occupies 30 minutes of the
  doctor's morning.
- **Money is integer paise, everywhere.** No floating-point rupees and no
  rounding drift between the consultation, the invoice, the day close and the
  report.
- **The server is the authority.** Roles, seat limits and the read-only gate are
  Postgres policies and triggers, not hidden buttons. The client mirrors those
  rules so it never offers an action the server would reject.

It ships as a single-page PWA: installable, offline-first, and hash-routed so it
deploys under any sub-path without rewriting URLs.

## Features

### Front desk

- **Token queue** — walk-in tokens, live waiting / in-consult / done states,
  average wait, one tap to consult.
- **Appointments** — day board per doctor (interval-accurate), week load, list
  view, next-free suggestion, check-in → in-consult → completed, no-show, cancel
  with undo, reschedule.
- **Patient registration** — automatic patient codes (`PT-00001`), phone-digit
  dedupe, clinical flags, and a full chart with timeline.
- **Billing** — GST-ready invoices, line items, discounts, part payments, payer
  method (cash / UPI / card / insurance / credit), outstanding dues per patient,
  and a printable invoice carrying a scannable **UPI QR** with the exact balance.
- **Day close** — collections split by method, cash counted against cash
  expected with the variance written down, missed charges found automatically,
  and a **frozen snapshot** per day: reopen to amend, never overwrite silently.
- **Reminders** — one privacy-safe message per patient for tomorrow's
  appointments, due recalls and week-old balances, with a send log that honours
  quiet hours so nobody is chased twice.

### Doctor

- **Consultations** — vitals, complaint, examination, diagnoses, prescription
  lines, advice and the next follow-up date.
- **Medicine master** — typeahead by brand / molecule / symptom that fills dose,
  frequency, duration and food relation, with safety checks on every
  prescription.
- **Prescriptions** — `RX/<fy>/<seq>` numbering, print-ready, in ten Indian
  languages (en, hi, mr, ta, te, bn, gu, kn, ml, pa).
- **Follow-ups** — overdue / due-today / next-7-days lists, closed-loop "mark
  done", and a gone-quiet cohort.

### Practice owner

- **Dashboard and reports** — revenue trend, payer mix, footfall, appointment
  outcomes, doctor performance, top diagnoses, where the diary comes from
  (walk-in / phone / online / referral) and daily collection.
- **Public booking** — a page at `/#/book/<clinic-slug>` a patient opens with no
  account: doctor picker, a 14-day strip that greys out full days, and real slots
  from the same engine the front desk uses, so a patient and a receptionist
  cannot double-book. The patient gets a `BK-…` reference to cancel with.
- **Doctors and staff** — per-doctor hours, slot length, fees and calendar
  colour; email invitations claimed on first sign-in; role matrix; seat count
  against the plan.
- **Branding and settings** — clinic profile, logos used on documents,
  GST/billing, booking settings, theme and density, data export.

### Platform

- **Offline-first** — an outbox replays writes when the connection returns, and
  conflicts surface in a sync centre instead of overwriting a clinician's edit.
- **Multi-tenant by policy** — every row carries `clinic_id`, and RLS decides
  access; a client-supplied claim is never trusted.
- **Responsive** — one set of breakpoints (`src/lib/responsive.mjs`) and a bottom
  tab bar on phones. Nothing is hidden that a wide screen shows.

## Roles and permissions

Three seats, one table — printed on the Team page, enforced by the nav, the
routes, the screens **and** the database (schema 10).

| Capability | Owner | Doctor | Front desk |
| --- | :--: | :--: | :--: |
| Dashboard & reports | ✓ | ✓ | ✓ |
| Patient charts | ✓ | ✓ | ✓ |
| Consultations & prescriptions | ✓ | ✓ | — |
| Billing & payments | ✓ | — | ✓ |
| Clinic settings & plan | ✓ | — | — |
| Invite or remove staff | ✓ | — | — |

How it is enforced:

| Layer | Mechanism |
| --- | --- |
| Screens | `can(role, capability)` from `src/lib/permissions.js` drives every button, tab and section. |
| Routes | `<RequireCapability>` in `src/App.jsx` redirects a role that cannot open a page instead of showing a dead screen. |
| Database | `consultations_read` = owner + doctor; `invoices_read/_write/_update` = owner + front desk; staff changes are guarded by policies and the `staff_guard()` trigger. |
| Numbers | A role without consultation access still sees its footfall: totals fall back to completed appointments, so the desk never reads a real day as an empty one. |

`tests/rbac.test.mjs` fails the build if the capability map and the SQL role
lists ever drift apart.

## Plans and subscription

Three plans, seat-limited, priced in the app and enforced in the database.

| Plan | Monthly | Yearly (2 months free) | Doctors | Front desk | Branches |
| --- | --- | --- | --- | --- | --- |
| Solo | ₹999 | ₹9,590 | 1 | 1 | 1 |
| Growth | ₹2,499 | ₹23,990 | 5 | 3 | 1 |
| Multi-clinic | ₹5,999 | ₹57,590 | unlimited | unlimited | unlimited |

Lifecycle: **14-day trial** → **active** → **7-day grace** after the period ends
(writes still work, with a banner) → **read-only**. No card processing happens
inside the app: a payment is recorded against a UPI / bank / reseller reference,
and the term is always the subscription's own interval — a yearly clinic renews
for twelve months, whatever a price toggle says.

What licensing never does, enforced the same way:

- **Never holds data hostage.** An expired clinic can read and export everything.
- **Never deletes anything.** Lapsing pauses writes; records, staff and history
  stay exactly where they were.
- **Never trusts the client.** Seat limits and the write gate are Postgres
  triggers and RLS, mirrored by the UI so the refusal is explained before it
  happens.

Only the **owner** can change the plan or record a payment (`clinic:settings`).

## Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| UI | React 19, React Router 8 (hash routing), hand-written CSS | No component-library churn; hash routing deploys under any sub-path. |
| Build | Vite 8 | Fast dev server, relative-asset production bundles. |
| Data | Supabase (Postgres + Auth + RLS) | The database is the security boundary, not the client. |
| Offline | `src/lib/offline.js` | Cache keyed per user and clinic, 24 h TTL, separate outbox. |
| Tests | `node --test`, `supabase/schema-tests.sql` | Domain logic in plain JS; policies tested in a real Postgres. |
| Deploy | GitHub Actions → GitHub Pages | Nothing to run, nothing to pay for the demo. |

## Project structure

```text
src/
  App.jsx                 routes and capability guards
  lib/
    logic.mjs             pure domain logic: money, invoices, slots, totals, reports
    daybook.mjs           day close: totals, missed charges, reconciliation
    license.mjs           plans, prices, trial/grace/read-only, billing period
    permissions.js        the capability matrix: one source for UI and tests
    store.jsx             the single data store (live Supabase or demo mode)
    offline.js            cache, outbox, conflict resolution
    demo-data.js          six months of fictional clinic data for demo mode
  pages/                  one file per screen (Dashboard, Billing, DayClose, …)
  components/             forms, layout, charts, document shells
supabase/
  schema.sql              the database: tables, policies, functions, migrations 1→10
  schema-tests.sql        six rolled-back SQL suites (roles, licensing, booking, …)
tests/                    276 unit tests across 12 suites
docs/                     setup, security, dependency and gap analysis
scripts/                  check-pages.mjs, security-check.mjs
```

## Getting started

### Prerequisites

- **Node 26 LTS** (pinned in `.nvmrc` / `.node-version` → 26.13.0); any Node
  **≥ 22.22** also works
- **npm 12.2.1** (`packageManager`)
- A Supabase project — only when you want real accounts and cloud persistence

### Demo mode (no configuration)

```bash
npm ci
npm run dev            # http://localhost:5173
```

With no keys the app boots into **Sunrise Multispecialty OPD** with six months of
fictional patients, appointments, consultations and invoices. Everything is kept
in this browser's `localStorage`; **Settings → Plan & data** resets it.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on `0.0.0.0:5173` |
| `npm run build` | Production bundle in `dist/` |
| `npm run preview` | Serve the built bundle |
| `npm test` | 276 unit tests (domain, day book, licensing, RBAC, sync, schema guards) |
| `npm run check:pages` | Verifies the bundle is deployable (relative assets, SPA fallback, no absolute paths) |
| `npm run test:security` | The anon-side checklist: tables refuse, RPCs answer |
| `npm run verify` | `test` + `build` + `check:pages` — the gate CI runs |

## Configuration

Copy `.env.example` to `.env.local`. Only **public** values belong in a `VITE_`
variable.

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | live mode | `https://<ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | live mode | Publishable / anon key. **Never** a service-role key. |
| `VITE_BASE` | no | Force an absolute asset base; leave empty for relative assets. |

Missing keys are not an error: the build runs in demo mode and says so in the
deploy log.

## Database

`supabase/schema.sql` is the whole database — tables, policies, `security definer`
functions and every migration up to the current schema version, gated by
`app_schema_version()`. It is **idempotent and additive**: run it whole, as often
as you like, and it applies only the blocks you are missing.

```bash
# once per project, in the Supabase SQL editor (whole file), or:
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/schema.sql

# then prove it, against a scratch project:
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/schema-tests.sql
```

Current schema: **10**. The app warns when the database is behind it, and every
upgrade path is exercised before a release — a fresh install and an N → N+1
upgrade, both followed by the SQL suites.

Data rules that never change:

- Every tenant row carries `clinic_id`; policies read it, never a client claim.
- Ids are `uuid` (`gen_random_uuid()`); codes (`PT-…`, `INV/…`, `RX/…`) are minted
  server-side.
- Money is `bigint` paise; timestamps are `timestamptz`.
- Deleting a clinic cascades to its records; deleting a patient is restricted
  while invoices exist.

## Testing and quality gates

```bash
npm run verify                 # unit tests, build, deployability
node scripts/security-check.mjs
```

| Gate | Scope |
| --- | --- |
| `npm test` | **276 tests / 12 suites**: domain logic, day book, licensing, RBAC matrix, invites, medicines, payments, public booking, offline replay, responsive breakpoints, schema-shaped guards. |
| `supabase/schema-tests.sql` | **Six SQL suites** in rolled-back transactions: RLS role matrix, licensing, public booking, slug handling, booking links, role split and self-promotion. |
| CI (`ci.yml`) | Node 22 and 26, tests, build, Pages readiness, sub-path build, security checklist, `npm audit --audit-level=high`. |

SQL is never shipped unverified: it is applied to a real PostgreSQL 17 and the
suites run against it, on a fresh database and as an upgrade from the previous
schema.

## Deployment

GitHub Pages, driven by `.github/workflows/pages.yml` on every push to `main`
(and on `workflow_dispatch`):

1. **Settings → Secrets and variables → Actions**: add `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` (optional — without them the deploy is a demo build).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push to `main`. The workflow tests, builds, checks the bundle, adds a
   `404.html` fallback and deploys.

The site lives at `https://<owner>.github.io/<repo>/`. Assets are relative, so a
project page, a custom domain and `localhost` all work from the same build.
`/#/setup` is the in-app self-test: environment, schema version, RLS, and what
this build expects.

## Offline and PWA behaviour

- Installable, standalone display, theme-aware icons, and shortcuts (queue /
  book / register / billing).
- An **outbox** queues writes while offline and replays them in order when the
  connection returns.
- The cache is keyed per user **and** per clinic, expires after 24 h, and is
  purged on sign-out — a shared reception machine leaves no patient data behind.
- Conflicts appear in a **sync centre**: nothing is merged automatically, money
  fields hold back as a set, and a human resolves them.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Pushed to `main`, no deploy ran | GitHub Actions was degraded, or the run was never created. **Actions → Deploy to GitHub Pages → Run workflow**; check `githubstatus.com`. |
| The app says the schema is behind | Paste `supabase/schema.sql` into the SQL editor, whole file. It is additive; nothing is lost. |
| A doctor cannot open Billing, or the desk cannot open Consultations | Intended since schema 10 — see [Roles and permissions](#roles-and-permissions). Move the person to the seat that owns the job. |
| Booking link 404s | The clinic has no slug. Schema 9 backfills it; **Settings → Clinic → Public booking → Save** mints one. |
| Demo data looks stale | **Settings → Plan & data → Reset demo workspace**. |
| Deploy builds but shows demo mode | The two Supabase secrets did not reach the build; the deploy log names the missing one. |

## Documentation

| Document | Contents |
| --- | --- |
| [`docs/SUPABASE-SETUP.md`](docs/SUPABASE-SETUP.md) | Project creation, redirect URLs, secrets, deploy, self-test. |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Threat model, findings and their remediation status. |
| [`SECURITY.md`](SECURITY.md) | How to report a vulnerability, privately. |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Setup, conventions, and what must never regress. |
| [`CHANGELOG.md`](CHANGELOG.md) | Every release, with the schema version it needs. |
| [`PUSH.md`](PUSH.md) | How this repository hands over releases as git bundles. |
| [`docs/PRODUCT-GAP-ANALYSIS.md`](docs/PRODUCT-GAP-ANALYSIS.md) | What is deliberately **not** built yet, and why. |
| [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) | Dependencies and licences. |

## Versioning and releases

Two numbers travel together and must not be confused:

- **App version** (`package.json`, `src/lib/version.js`) — semantic, e.g. `1.11.7`.
- **Schema version** (`app_schema_version()`) — a migration level. A release that
  needs a new one says so in its changelog entry and in the app.

Every release: `npm run verify` green, SQL applied to a real Postgres, a test for
whatever was fixed, `CHANGELOG.md` updated, a git tag, and the database
instruction the operator needs.

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) first. Two rules outrank style: **never
break tenant isolation**, and **never lose a clinician's concurrent edit**. New
behaviour comes with a test; a change to SQL comes with a suite in
`supabase/schema-tests.sql`.

## License

MIT — see [`LICENSE`](LICENSE).
