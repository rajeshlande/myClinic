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

Open **SQL Editor**, paste all of `supabase/schema.sql`, run it once. It is idempotent:
tables, RLS policies, triggers, the token/invoice generators and
`app_schema_version()` are re-created safely. The last statement seeds
`app_meta.schema_version = 2`.

Confirm it worked:

```sql
select public.app_schema_version();   -- must return 2
```

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
| Database schema version | `app_schema_version()` equals the version this build needs (2) |

All green means: sign-up, sign-in, tenant isolation and cloud sync are wired.
Any red check names the exact thing to fix — no key material is ever displayed.

## 8. Security gates before real patient data

```bash
npm run test:security    # operator instructions for the RLS suite
```

Then run `supabase/rls-tests.sql` in the SQL Editor. It creates two dummy tenants in a
rolled-back transaction and asserts the role matrix, tenant isolation, token issuance
and invoice guards. See [`docs/SECURITY.md`](SECURITY.md) for the full audit summary.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Setup page says **Demo mode** after deploying | secrets missing in the repo, or the workflow ran before they were added | add the secrets, re-run the Pages workflow |
| REST check returns **401 / 403** | wrong or truncated key; or the legacy anon key was disabled | re-copy the key from Project settings → API |
| REST check says **unreachable** | project paused, wrong ref, or a proxy blocking the request | resume the project, re-check the URL |
| Schema check says **re-run schema.sql** | `app_meta` still reports v1 | run the whole `supabase/schema.sql` again |
| Login loops back to the sign-in page | redirect URL not allow-listed | add the exact hash URL from §4 |
| "Email not confirmed" | confirmation mail not clicked / SMTP rate-limited | confirm manually in Authentication → Users, or add SMTP |
