# Changelog

All notable changes to myClinic. Versions follow semver; `schema` refers to the
Supabase migration level this release expects (`app_schema_version()`).

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
- **`supabase/branding.sql`** — an upgrade script for existing databases that adds the
  columns, the size guards and bumps `app_meta.schema_version` to 4. Fresh installs get
  it from `schema.sql`. 11 new unit tests (75 total).

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
- **Subscription licensing.** `supabase/licensing.sql` adds `clinic_subscriptions`,
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
