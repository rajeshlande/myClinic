# Supabase go-live checklist

myClinic runs in **demo mode** until two public values are present at build time.
This page is the shortest path from an empty Supabase project to a live clinic,
and it ends with a self-test you can run in the browser.

Target deployment for this repository:

| Item | Value |
| --- | --- |
| Pages URL | `https://rajeshlande.github.io/myClinic/` |
| Login redirect | `https://rajeshlande.github.io/myClinic/#/login` |
| Reset redirect | `https://rajeshlande.github.io/myClinic/#/reset-password` |
| Schema version required | **v2** (`supabase/schema.sql`) |
| App version | 1.2.1 |

---

## 1. Create the project

1. <https://supabase.com/dashboard> → **New project**. Pick the region closest to the clinic (Mumbai / `ap-south-1` for India).
2. Save the database password somewhere safe — the app never needs it.
3. Wait for provisioning; a **paused** project answers every request with a network error and will fail the self-test.

## 2. Copy the two public values

**Project settings → API**:

| Supabase field | Environment variable | Notes |
| --- | --- | --- |
| Project URL | `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` — HTTPS only |
| Publishable key (`sb_publishable_…`) or anon key | `VITE_SUPABASE_ANON_KEY` | Public by design; RLS is what protects data |

> Never put the **service_role** / `sb_secret_…` key in a `VITE_` variable. Vite inlines
> every `VITE_*` value into the JavaScript bundle, so a secret key would be handed to
> every visitor. The app refuses to boot in live mode if the key looks like a secret.

Local development:

```bash
cp .env.example .env.local     # then paste both values
npm run dev                    # http://localhost:5173/#/setup
```

`.env.local` is git-ignored.

## 3. Apply the schema

Open **SQL Editor**, paste all of `supabase/schema.sql`, and run it.

**That is the whole database step.** The file is the single source of truth for every
version — there are no per-release scripts to apply in order, and nothing to look up
when a clinic's database "needs updating": re-run the same file.

It is written to be safe from any starting point:

| Starting point | What happens |
| --- | --- |
| Empty project | every table, policy, trigger and function is created; version set to 8 |
| Already at the current version | no-op — guarded blocks see the version and skip |
| An older database (v1 … v7) | the missing migrations apply in place, straight to v8; clinical and billing rows are never touched |
| Interrupted half-way | the whole file is one transaction — either it fully applies or nothing changes |

Nothing in the file drops a table or deletes a row. Re-running it can never be destructive.

The version story lives inside the file itself:

```sql
select public.app_schema_version();   -- current version + the version this file expects
select * from public.app_migrations(); -- one row per migration: version, name, applied_at
select * from public.schema_migrations; -- the raw ledger the guards consult
```

Expected output for a current database — `version = 8`, `expected = 8`, and eight ledger
rows: `1 core`, `2 roles-and-offline`, `3 licensing`, `4 branding`, `5 upi`, `6 rx`,
`7 day-close`, `8 public-booking`.

### What each migration added

| Version | Section | Contents |
| --- | --- | --- |
| 1 | §1 | `clinics`, `staff`, `profiles`, `patients`, `appointments`, `consultations`, `invoices`, RLS policies, `create_clinic()`, `issue_token()` |
| 2 | §2 | role helpers, invitation flow, offline/replay support columns |
| 3 | §3 | `clinic_subscriptions`, `plan_seat_limit()`, `plan_price_paise()`, `license_state()`, `change_plan()`, `renew_subscription()`, `start_trial()`, `set_license_status()`, `seat_guard`, `subscription_write_guard` |
| 4 | §4 | `logo_square_url`, `logo_wide_url`, `logo_on_documents` with size/format guards |
| 5 | §5 | UPI collection: `upi_id`, `upi_payee_name`, `upi_qr_on_invoices`, plan gate |
| 6 | §6 | prescription numbering (`rx_number`, `rx_version`, `rx_safety`), per-clinic unique |
| 7 | §7 | `day_closes` (frozen day snapshot, cash reconciliation) and `reminders` (append-only send log) |
| 8 | §8 | public booking: `clinics.booking_*`, `appointments.booking_ref` / `cancelled_at`, live-slot partial unique index, five `anon`-granted RPCs |
| 9 | §9 | clinic slug: `clinics.slug` (unique), backfill for existing clinics, owner-editable `set_clinic_slug()` |
| 10 | §10 | role split: notes readable by owner + doctor, money writable by owner + front desk — the split the Team page prints |
| 11 | §11 | WhatsApp consent (`patients.wa_opt_in`, `wa_opt_out_at`) and a message log that accepts token, invoice and prescription rows |
| 12 | §12 | sessions and days off (`clinics.sessions`, `staff.sessions`, `closed_weekdays`, `closed_dates`), 3–45 day follow-up window |
| 13 | §13 | a profile row for every existing account — the missing row that made the account screen unsaveable |
| 14 | §14 | drug directory: `medicines`, trigram indexes, `search_medicine_brands()` for signed-in seats, starter rows |
| 15 | §15 | drug search at 240,000 rows: index-usable candidates, GIN trigrams, `drug_edit_distance()` for typo ties |
| 16 | §16 | `consultations.investigations` — the tests advised at the visit, printed on the slip |
| 17 | §17 | audit fixes: the booking reference belongs to the device that made it, one door to a paid state with a collection log, membership checks on the counter helpers, same-clinic patient on every clinical write |
| 18 | §18 | licence authority: `authority_*` columns, `apply_authority_license()` (`service_role` only), renewal/plan/trial refused once bound, the `authority` block in `license_state()` |
| 19 | §19 | set-up collects: `create_clinic()` writes hours, days off, sessions, GSTIN, the follow-up window and the doctor's registration number, each range-checked and defaulted when absent |
| 20 | §20 | branches: child `branches` table, `staff_branches` assignments, `branch_id` on visits/invoices, a default **Main branch** for every clinic, owner-only `create_branch()` / `set_staff_branches()` / `set_active_branch()` RPCs, and branch-scoped RLS |

Confirm the licensing and branding objects exist:

```sql
select public.license_state('<your-clinic-uuid>'::uuid);  -- status, plan, seats, can_write
select logo_square_url, logo_wide_url from public.clinics limit 1;
```

Both logo columns only accept `data:image/…` URLs and are capped at 700 KB / 900 KB, so a
clinic row (and the offline snapshot that carries it) stays small. Logos are uploaded in
**Settings → Logos & branding**, resized in the browser before they are saved.

Check the public booking surface once, from outside the clinic (schema 8):

```sql
set role anon;
select public.public_clinic_profile('<your-clinic-slug>');   -- name, address, doctors
select count(*) from public.patients;                        -- permission denied
reset role;
```

The first statement answering and the second refusing is the whole design: a patient's
browser can call five named functions, and read no table at all. Turn the page off per
clinic in **Settings → Clinic → Public booking**.

## 4. Configure authentication

**Authentication → URL configuration**:

- **Site URL**: `https://rajeshlande.github.io/myClinic/`
- **Redirect URLs** (add all four):
  - `https://rajeshlande.github.io/myClinic/#/login`
  - `https://rajeshlande.github.io/myClinic/#/reset-password`
  - `http://localhost:5173/#/login`
  - `http://localhost:5173/#/reset-password`

**Authentication → Providers → Email**: keep *Confirm email* on. The client uses the
PKCE flow, which requires the redirect allow-list above.

For a real clinic, add **custom SMTP** — the built-in sender is rate-limited to a
handful of mails per hour and is not suitable for onboarding staff.

## 5. Add the GitHub repository secrets

**Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | the publishable / anon key |

The Pages workflow inlines them at build time; they are never committed.
Without them the site still deploys — in demo mode, which is fine for a preview.

Leave the `VITE_BASE` **variable** unset: the build uses relative asset URLs and
works from `/myClinic/` as-is. Set it to `/myClinic/` only if you deliberately want
absolute paths.

## 5b. What the build reports about itself

The Pages workflow prints, in the Actions log:

- `node -v` / `npm -v` — must read **v26.13.0** and **12.2.1**
- `::notice::Supabase keys present` **or** `::warning::… the site will deploy in demo mode`
- `::error::` and a failed job if a placeholder URL (`YOUR-PROJECT`, `abc.supabase.co`) was
  baked into the bundle
- the resolved `VITE_BASE` (empty = relative assets, correct for `/myClinic/`)

## 6. Deploy

**Settings → Pages → Build and deployment → Source: GitHub Actions**, then push to
`main` (or run the workflow manually). The workflow prints a notice saying whether the
Supabase keys reached the build — read it before sharing the URL.

### Deploying somewhere else (Cloudflare, Netlify, Vercel, S3, a VPS)

The app is a static, hash-routed SPA: `vite build` emits `dist/`, every route is
`/#/…`, asset URLs are relative, and `VITE_*` is inlined at build time. Any HTTPS
static host works; there is no server code and no SPA rewrite to configure.

**Cloudflare Workers Builds** needs the repository's `wrangler.jsonc`, which declares
`assets.directory: "./dist"` and no `main`. Without it `wrangler deploy` cannot tell
what it is deploying, tries to detect the framework by bundling `vite.config.js` with
esbuild, and fails with `Error parsing file: …/vite.config.js` — a build fault that
reads like a syntax error. `public/_headers` travels with the build so `index.html`
and `sw.js` are served `no-cache` and `/assets/*` as `immutable` on every host.

**Allow for one thing before you switch hosts:** `p_origin` is
`window.location.origin`, and it is half of the licence match. A new host is a new
origin, so add a Central subscription row for it (keeping the old one alive through
the overlap) and add it to **Authentication → URL Configuration** (Site URL and
Redirect URLs), or signup-confirmation and password-reset links bounce to the old
host. A refusal deletes the sealed lease immediately; only a genuine transport
failure gets the grace window.

## 7. Verify from inside the app

Visit `https://rajeshlande.github.io/myClinic/#/setup` and press **Run test** in the
*Connection self-test* card. Six checks run:

| Check | Passes when |
| --- | --- |
| Project URL is set | `VITE_SUPABASE_URL` is non-empty |
| Publishable key is set | a key is present **and** it is not a service-role/secret key |
| Project URL is HTTPS | the URL starts with `https://` |
| Base path matches deployment | assets are relative (`./`) or the base equals the Pages sub-path |
| REST API reachable with this key | `GET /rest/v1/` with the key returns 2xx (not 401/403) |
| Database schema version | `app_schema_version()` equals the version this build needs (20) |

All green means: sign-up, sign-in, tenant isolation and cloud sync are wired.
Any red check names the exact thing to fix — no key material is ever displayed.

## 8. Security gates before real patient data

```bash
npm run test:security    # operator instructions for the RLS suite
```

Then run `supabase/schema-tests.sql` in the SQL Editor. Sixteen rolled-back suites
assert the role matrix, tenant isolation, token issuance, invoice guards, seat
limits, grace/read-only licensing, plan changes and schema-20 branch configuration
— ending in `ALL RLS CHECKS COMPLETED`,
`ALL LICENSING CHECKS COMPLETED` and
`ALL BRANCH CONFIGURATION CHECKS COMPLETED`. Suite M proves owners can hold several
branches, seats hold one, patients stay shared and front desk cannot read another
branch's appointments or invoices. **Development projects only**; it rolls itself
back, but never point it at real patient data. See [`docs/SECURITY.md`](SECURITY.md)
for the full audit summary.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Setup page says **Demo mode** after deploying | secrets missing in the repo, or the workflow ran before they were added | add the secrets, re-run the Pages workflow |
| REST check returns **401 / 403** | wrong or truncated key; or the legacy anon key was disabled | re-copy the key from Project settings → API |
| REST check says **unreachable** | project paused, wrong ref, or a proxy blocking the request | resume the project, re-check the URL |
| Schema check says **re-run schema.sql** | `app_meta` reports an older version | run the whole `supabase/schema.sql` again — it upgrades in place |
| Login loops back to the sign-in page | redirect URL not allow-listed | add the exact hash URL from §4 |
| "Email not confirmed" | confirmation mail not clicked / SMTP rate-limited | confirm manually in Authentication → Users, or add SMTP |
