# Changelog

All notable changes to myClinic. Versions follow semver; `schema` refers to the
Supabase migration level this release expects (`app_schema_version()`).

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
  project creation, the exact redirect URLs for `rajeshlande.github.io/myclinic/`,
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

[1.2.0]: https://github.com/rajeshlande/myclinic/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/rajeshlande/myclinic/compare/v1.0.0...v1.1.0
