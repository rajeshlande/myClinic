# Pushing myClinic to GitHub (bundle method)

The build sandbox has no GitHub credentials, so nothing is pushed from here — it
hands over a **git bundle**: one file containing real git objects, refs and tags.
Your clone stays a normal clone; `git bundle verify` reports it as a complete
source of history.

**State of the remote:** `main` is at `be0711b` — v1.11.7, v1.11.8 and v1.11.9
are **deployed** (Pages run #7, live bundle reports 1.11.9 / schema 10). The
**tags** are not: that push was rejected with `remote: Internal Server Error`
during GitHub's 2026-11-04 Git Operations incident, and the remote still lists
only `v1.11.6` and older.

So this bundle carries **two commits** — v1.11.10 (the demo door fix) and the gap
analysis re-audit above it — plus the tag `v1.11.10`; the tags `v1.11.7`, `v1.11.8` and `v1.11.9` are still in the same
bundle and still need pushing. If you have not pushed since `e417a41` (v1.11.2),
use the [catch-up](#catch-up-from-v1112) section below.

Two files, pick according to what you already have:

| File | Size | Use it when |
| --- | --- | --- |
| `myClinic-update-to-v1.12.0.bundle` | ~45 KB | You already have the repo at `be0711b` (main pushed) — **recommended**. It is a delta and fast-forwards. |
| `myClinic-full-v1.12.0.bundle` | ~11 MB | You want a standalone clone source (new machine, no GitHub access yet, or the repo is empty). |

Both carry `main` and the tags `v1.11.7`, `v1.11.8`, `v1.11.9`, `v1.11.10` and `v1.12.0`.

## Route A · update the clone you already pushed (recommended)

```bash
cd ~/path/to/myClinic
git status                      # expect: clean, HEAD at be0711b
git remote -v                   # expect: origin → github.com/rajeshlande/myClinic.git

git fetch /path/to/myClinic-update-to-v1.12.0.bundle \
  'refs/heads/main:refs/remotes/bundle/main' \
  'refs/tags/*:refs/tags/*'

git merge --ff-only refs/remotes/bundle/main

git log --oneline -4            # feat(whatsapp) 1.12.0 / docs audit / fix(demo) / be0711b

git push origin main
git push --atomic origin refs/tags/v1.11.7 refs/tags/v1.11.8 \
  refs/tags/v1.11.9 refs/tags/v1.11.10 refs/tags/v1.12.0
```

`--ff-only` is deliberate: if it refuses, the history is not what the bundle
expects and you should stop rather than invent a merge.

Tags are pushed **by name** rather than with `--tags`/`--follow-tags` because
`v1.2.1` already exists on GitHub pointing at `53c0957`, while in this history it
points at `5224806`. Nothing published gets rewritten. `--atomic` matters here:
four tags go up and either all of them land or none do, so a repeat of the
2026-11-04 server error cannot leave you with `v1.11.8` published and `v1.11.9`
missing.

## Route B · clone the full bundle, then push

```bash
git clone -b main myClinic-full-v1.12.0.bundle myClinic
cd myClinic
git remote set-url origin https://github.com/rajeshlande/myClinic.git
git push -u origin main
git push --atomic origin refs/tags/v1.11.7 refs/tags/v1.11.8 \
  refs/tags/v1.11.9 refs/tags/v1.11.10
```

## Catch-up from v1.11.2

If GitHub is still at `e417a41` (v1.11.2), use the same two files — they contain
everything since — and push the four older tags by name as well:

```bash
git fetch /path/to/myClinic-full-v1.12.0.bundle \
  'refs/heads/main:refs/remotes/bundle/main' 'refs/tags/*:refs/tags/*'
git merge --ff-only refs/remotes/bundle/main

git push origin main
git push --atomic origin refs/tags/v1.11.3 refs/tags/v1.11.4 refs/tags/v1.11.5 \
  refs/tags/v1.11.6 refs/tags/v1.11.7 refs/tags/v1.11.8 refs/tags/v1.11.9 \
  refs/tags/v1.11.10 refs/tags/v1.12.0
```

The update bundle declares `be0711b` as its base, so for a clone still sitting on
`e417a41` ask for the full bundle's history instead — `git fetch` on a bundle
reports the missing prerequisite rather than half-applying it.

## What is in these commits

| Commit | Release | Scope |
| --- | --- | --- |
| `feat(whatsapp)` | **1.12.0** · schema 11 | **Four messages reach the patient.** Token (with how many ahead), appointment (date/time/doctor/address), bill (total, paid, balance, UPI id) and prescription (medicines and directions in the patient's language) all leave from the clinic's own WhatsApp through one composer. Consent is a column: `patients.wa_opt_in` / `wa_opt_out_at`, with the composer refusing an opted-out patient. The send log takes all five kinds. **Run `supabase/schema.sql` again** — schema 11 is additive. |
| `fix(demo)` | **1.11.10** · schema 10 | **The demo door opens the demo.** On the one deployment with Supabase configured — the published site — the footer's *Open Demo* button routed a signed-out visitor to `/login`, so the single entrance promised in 1.11.8 ended on a sign-in form. It always opens the workspace now; with no session the store is already in demo mode against `localStorage`, and nothing is sent to the clinic database. `tests/landing.test.mjs` pins it (287 tests). |
| `47873a3` | **1.11.9** · schema 10 | The front desk's own workspace: no Doctors & staff, no Day close, no Subscription and no plan panel; Settings shows a seat only the tabs it can act on. `day:close` becomes an owner capability (the desk still collects), `team:read` drops to owner + doctor, and the README follows the awesome-readme shape. |
| `c9e683a` | **1.11.8** · schema 10 | One demo door: the marketing page keeps a single entry into the demo workspace — the footer button **Open Demo** — and the hero, closing band, plan cards and footer links lead to plans or sign up instead. The reference project myClinic grew out of is no longer named anywhere in the repo, including `THIRD_PARTY_NOTICES.md`. `tests/landing.test.mjs` guards both. |
| `a36008a` | **1.11.7** · schema 10 | **Subscription.** The licence view dropped `interval` and `collection_ref`, so a yearly clinic read as monthly, was priced monthly, **renewed for one month instead of twelve**, and lost the payment reference it had just recorded. The view carries both now; `billingPeriod()`/`extendPeriod()` decide the term a payment buys (calendar months, matching `renew_subscription()`); the dialog's Monthly/Yearly toggle only previews prices; the demo workspace stops hard-coding 30 days. The sidebar offers "Manage subscription" only to the owner. Paise print in pairs (`₹23,990.40`). **README rebuilt** as a project front page. |
| *(the docs commit above it)* | docs | README rebuilt, CHANGELOG entry for 1.11.7, this file, `.markdownlint.json`. |
| `d9869c8` | **1.11.6** · schema 10 | Role split. Schema 10 narrows `consultations_read` to owner + doctor and `invoices_read/_write/_update` to owner + front desk, and every screen asks `can(role, capability)` instead of assuming — a doctor loses Billing, *Raise invoice* and *Save & bill*; the front desk loses Consultations, Follow-ups and note text, and gains Reports. |
| `00cd9c7` | **1.11.6** · schema 10 | The UI half of the role split: nav, routes, patient tabs, buttons, quick actions, command palette, printable `/invoice/:id` and `/prescription/:id`, plus appointment-based fallbacks so a role without consultation access still counts its footfall. |
| `7145671` | **1.11.5** · schema 9 | The booking link works from the moment a clinic is created; Settings shows the address the database answers on. |
| `d007bb7` | **1.11.5** · schema 9 | `create_clinic()` mints a slug, schema 9 backfills and repairs every existing clinic, and `set_clinic_slug()` is owner-only. |
| `b7c64cd` | **1.11.4** · schema 8 | Offline sync stopped dead after a staff edit; the client now mirrors the schema and drops columns a table does not have. |
| `436efe2` | **1.11.3** · schema 8 | `schema.sql` could not be applied to a new project (`btrim`/local variable clash); both fixed, with SQL suites covering them. |
| `5ffade1` | **1.11.2** · schema 8 | Responsive pass: one set of breakpoints, nav folds into a menu, plans behind a tab switch on a phone. |
| `31f0e4a` | **1.11.1** · schema 8 | Staff invitations work end to end. |
| `7ec613b` | **1.11.0** · schema 8 | Public booking, booking references, five anon RPCs. |
| `f2feaba` | **1.10.0** · schema 7 | Day close, missed-charge detector, reminder queue. |
| `cc0ca35` | **1.7.0** · schema 5 | UPI QR collection, one payment sheet everywhere, single-source `schema.sql`. |

## Verify a bundle before you trust it

```bash
git bundle verify myClinic-update-to-v1.12.0.bundle    # refs + required base (be0711b)
git bundle verify myClinic-full-v1.12.0.bundle         # "complete history"
git clone -b main myClinic-full-v1.12.0.bundle /tmp/check
cd /tmp/check && npm ci && npm test && npm run build && npm run check:pages
```

## After the push (nothing in the bundle can do this for you)

0. **Already deployed:** Pages run #7 published `be0711b` at 10:40Z; the live
   bundle reports 1.11.9. This push adds v1.11.10 on top — watch run #8 for it.
1. **Settings → Secrets and variables → Actions** → `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` (omit them and the deploy is a demo build).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Watch the deploy: `node -v` / `npm -v` (`v26.13.0` / `12.2.1`), then
   `Supabase keys present` or a demo-mode warning, then the deploy.
4. Site: <https://rajeshlande.github.io/myClinic/> · self-test: `/#/setup` ·
   sample booking page: `/#/book/sunrise-opd`.
5. **Database**: paste `supabase/schema.sql` into the Supabase SQL editor once —
   the whole file, no parts. It is idempotent and lands the project at schema
   **10**, which v1.11.6 and v1.11.7 both expect. Coming from 9 it applies just
   the schema 10 block; from 8 the 9 and 10 blocks; and so on.

### What schema 10 changes

Additive; the block only runs when `app_schema_version() < 10`.

- `consultations_read` — select for `owner`, `doctor`.
- `invoices_read`, `invoices_write`, `invoices_update` — `owner`, `frontdesk`
  (the update carries both `using` and `with check`).
- No column, table, function or row is dropped. Voids, paid-invoice amendments and
  deletes stay owner-only (`invoice_guard()`, `invoices_delete`).

**Who notices:** a clinic that had been letting its doctor raise or settle bills,
or its desk read notes, loses that. Moving a person to the seat that owns the job
is the fix, not a workaround.

Verified on PostgreSQL 17 as a fresh install and as a 9 → 10 upgrade, each
followed by `supabase/schema-tests.sql` — six suites, rollbacks only.

### What schema 9 changed (v1.11.5) and schema 8 before it (v1.11.0)

Schema 9 minted, backfilled and repaired `clinics.slug`, added
`clinics_slug_format` and `set_clinic_slug()`. Schema 8 added the public-booking
columns, the partial unique index that lets a cancelled slot be re-sold, and the
five `anon`-granted booking RPCs. Both blocks are inside `supabase/schema.sql` and
apply in order — you never paste one at a time.

Run `node scripts/security-check.mjs` for the anon-side checks that should follow
(set role anon; the RPCs answer, every table refuses).
