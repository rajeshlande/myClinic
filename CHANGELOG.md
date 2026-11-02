# Changelog

All notable changes to myClinic. Versions follow semver; `schema` refers to the
Supabase migration level this release expects (`app_schema_version()`).

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
