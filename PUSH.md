# Pushing myClinic to GitHub (bundle method)

The build sandbox has no GitHub credentials, so nothing is pushed from here — it
hands over a **git bundle**: one file containing real git objects, refs and tags.
Your clone stays a normal clone; `git bundle verify` reports it as a complete
source of history.

Current state of <https://github.com/rajeshlande/myClinic.git>: `main` at
`e417a41` *"docs: PUSH.md points at the v1.11.2 commit"*, tags `v1.10.0 …
v1.11.2`. Everything after that is in the bundles below — **four releases, one
push**: **1.11.3, the schema fix**, **1.11.4, the offline-sync fix**, **1.11.5,
the booking link** (schema **9**) and **1.11.6, the role split**, which is the
first release to ask for schema **10**.

Two files, pick according to what you already have:

| File | Size | Use it when |
|---|---|---|
| `myClinic-update-to-v1.11.6.bundle` | ~66 KB | You already have the repo on GitHub or on disk at `e417a41` (v1.11.2 pushed) — which is where GitHub is now. **Recommended** — it is a delta and fast-forwards. |
| `myClinic-full-v1.11.6.bundle` | ~10 MB | You want a standalone clone source (new machine, no GitHub access yet, or the repo is empty). |

Both carry `main` and the four tags GitHub does not have yet — `v1.11.3`,
`v1.11.4`, `v1.11.5` and `v1.11.6` — plus every earlier tag.

## Route A · update an existing clone, then push (recommended)

The update bundle declares `e417a41` as its prerequisite, so it applies to your
existing clone as-is — no re-download of the history you already pushed. It lands
**four** commits of product (`436efe2` the schema fix, `b7c64cd` the offline-sync
fix, the two that make up 1.11.5, and the two that make up 1.11.6) plus four docs
commits.

```bash
git clone https://github.com/rajeshlande/myClinic.git myClinic   # skip if already cloned
cd myClinic
git fetch /path/to/myClinic-update-to-v1.11.6.bundle \
  'refs/heads/main:refs/remotes/bundle/main' 'refs/tags/*:refs/tags/*'
git merge --ff-only refs/remotes/bundle/main

git push origin main
git push origin refs/tags/v1.11.3 refs/tags/v1.11.4 refs/tags/v1.11.5 refs/tags/v1.11.6
```

`--ff-only` is deliberate: if it refuses, the history is not what the bundle
expects and you should stop rather than invent a merge.

Tags are pushed **by name** rather than with `--tags`/`--follow-tags` on purpose:
**`v1.2.1` already exists on GitHub pointing at `53c0957`, while in this history
it points at `5224806`.** The bundle therefore carries only the tags GitHub does
not have, so nothing is rejected and no published tag is rewritten. If you want
the old tag moved onto this history, do it deliberately:
`git push --force origin refs/tags/v1.2.1` (only if nothing references it).

Verified from this sandbox against the live repository: `git clone` of
github.com/rajeshlande/myClinic (lands on `e417a41`) → fetch the bundle →
`git merge --ff-only` lands on the v1.11.6 commit, exit code 0, working tree
clean, **264/264 tests** pass, `npm run build` and `npm run check:pages` clean,
tags `v1.11.3 … v1.11.6` present and `v1.2.1` untouched.

## Route B · clone the full bundle, then push

```bash
git clone -b main myClinic-full-v1.11.6.bundle myClinic
cd myClinic
git remote set-url origin https://github.com/rajeshlande/myClinic.git
git push -u origin main
git push origin refs/tags/v1.11.3 refs/tags/v1.11.4 refs/tags/v1.11.5 refs/tags/v1.11.6
```

(A fresh clone *can* be pushed with `--follow-tags`; the explicit tag list above
still avoids the pre-existing `v1.2.1` on GitHub.)

## What is in these commits

| Commit | Release | Scope |
|---|---|---|
| `00cd9c7` | **1.11.6** · schema 10 | Every screen now asks `can(role, capability)` instead of assuming: the Team page prints `ROLE_MATRIX`, and the nav, routes, patient tabs and buttons read the same map. A doctor loses Billing, the Billing tab, *Raise invoice*, *Collect* and *Save & bill*; the front desk loses Consultations, Follow-ups and all note text, and gains Reports (the one row the Team page promised and the app refused). The "Day close" quick action, the quick-register invoice button, the greeting's unpaid count, the command palette's invoice search and the printable `/invoice/:id` / `/prescription/:id` routes follow the same rule. Dashboard, Reports, Day close and Patients fall back to completed appointments so a role without consultation access still sees its own footfall. **Run `supabase/schema.sql` again — it lands schema 10.** |
| `50807c7` | **1.11.6** · schema 10 | The database now draws the same line. `consultations_read` drops `frontdesk`; `invoices_read`, `invoices_write` and `invoices_update` drop `doctor`, so a doctor can neither read a bill nor settle one and an update is not a side door into the insert policy. The canonical policy block and the migration block carry identical role lists — their drift is exactly how the desk kept read access from schema 5 to 9. Suite F signs in as each seat in turn and checks what it can read, raise and settle, and pins the three self-promotion routes. `tests/rbac.test.mjs` fails the build if the SQL and the capability map ever disagree again. |
| `7145671` | **1.11.5** · schema 9 | The booking link works from the moment a clinic is created. Settings shows the address the database answers on (Copy/Open disabled until one exists) instead of the sample clinic's `sunrise-opd`, a renamed link says "patients stay on /book/old-name until you save", and `/book/:slug` renders outside `<StoreProvider>` so a patient no longer watches "Opening your clinic…". |
| `d007bb7` | **1.11.5** · schema 9 | `create_clinic()` never set `slug`, so a clinic onboarded after schema 8 had no public address and its link 404'd. Schema 9 mints one at provisioning (`next_clinic_slug()`), backfills and repairs every existing clinic (capitals, punctuation, over-length), adds a `clinics_slug_format` check, and adds `set_clinic_slug()` — owner-only, revoked from anon, collision-safe. Suite E follows one link from provisioning to the anon profile. |
| `b7c64cd` | **1.11.4** · schema 8 | Offline sync stopped dead after a staff edit: the replay stamped `client_updated_at` and sent `client_id` to tables that have neither (`staff`, `invoices`), so PostgREST answered 400 / PGRST204 forever and every write behind it waited. The client now mirrors the schema (`OFFLINE_COLUMNS`, guarded by a test), a missing column is dropped and the write retried, and a change the server keeps refusing goes to the sync centre after five attempts instead of blocking the queue. No schema change. |
| `436efe2` | **1.11.3** · schema 8 | `schema.sql` could not be applied to a new project: schema 8 stopped at `syntax error at or near "both"` (`btrim(both '-' from …)` — that is `trim`, not `btrim`), and `public_book()` would then have failed for every new patient because a local variable was named `code`. The slug rule is now `public.clinic_slug(name)`, the variable is `patient_code`, schema 8 re-applies itself when its functions are missing, and two new rolled-back SQL suites plus 10 `npm test` guards cover both. **Run `supabase/schema.sql` again — no re-paste in parts.** |
| `5ffade1` | **1.11.2** · schema 8 | Responsive pass. One set of breakpoints (`src/lib/responsive.mjs`); the marketing footer rebuilt as a real footer that stacks 3 → 2 → 1 columns; the closing CTA stacks instead of squeezing its heading to one word a line; the nav folds into a menu below 900px, the twelve feature cards into tap-to-read rows and the three plans behind a tab switch on a phone — 2200px less scrolling at 390px with nothing removed. No schema change. |
| `31f0e4a` | **1.11.1** · schema 8 | Staff invitations actually work: the invite row carries name/role/specialty, `accept_invite()` is claimed on first sign-in instead of leaving the invitee to create their own clinic, Pending invitations lists and can withdraw an offer, and the demo invite no longer creates a half-built doctor or demote the owner. No schema change. |
| `7ec613b` | **1.11.0** · schema 8 | Public booking. `/#/book/<slug>` books a real slot with no account; `/#/booking/<ref>` looks it up and cancels it. Five `anon`-granted RPCs, booking references, a partial unique index so a cancelled slot can be re-sold, `source='online'` carried to Reports, and the booking settings in Settings → Clinic. Plus a landing-page CTA and 36 new tests. |
| `a49747e` | **1.10.1** · schema 7 | Marketing only: two landing-page feature cards (day close, reminders with a paper trail), a Day close strip chip, and a headline that runs to the closed day. No app behaviour changed. |
| `f2feaba` | **1.10.0** · schema 7 | Day close (collections by method, cash reconciliation, frozen `day_closes` snapshot), the missed-charge detector, and the reminder queue with a `reminders` send log that honours quiet hours. Plus mobile layouts for both new screens. |
| `7dab99c` | docs | PUSH.md for the v1.9.0 bundles. |
| `3fdee7b` | **1.9.0** · schema 6 | Phone layout for every screen: agenda day board, lists that read down, full-screen consultation sheet with pinned actions, paged registers, 38px+ touch targets. Plus `buildDayBoard` now honours its injected clock. |
| `8df4296` | **1.8.0** · schema 6 | Medicine master typeahead with dose defaults, prescription safety, acknowledgement logged to `consultations.rx_safety`, `RX/<fy>/<seq>` numbering. |
| `cc0ca35` | **1.7.0** · schema 5 | UPI QR collection, one payment sheet everywhere, rebuilt documents, `supabase/schema.sql` as the single source of truth for the database. |

## Verify a bundle before you trust it

```bash
git bundle verify myClinic-update-to-v1.11.6.bundle    # refs + required base (e417a41)
git bundle verify myClinic-full-v1.11.6.bundle         # "complete history"
git clone -b main myClinic-full-v1.11.6.bundle /tmp/check
cd /tmp/check && npm ci && npm test && npm run build && npm run check:pages
```

## After the push (nothing in the bundle can do this for you)

1. **Settings → Secrets and variables → Actions** → add `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY`.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Watch the workflow: it prints `node -v` / `npm -v` (expect `v26.13.0` /
   `12.2.1`), then either `Supabase keys present` or a demo-mode warning, then deploys.
4. Site: <https://rajeshlande.github.io/myClinic/> · self-test: `/#/setup`.
   The sample clinic's booking page is at `/#/book/sunrise-opd`.
5. **Run the database migration**: paste `supabase/schema.sql` into the Supabase SQL
   editor once — the whole file, no parts. It is idempotent and lands the project at
   schema **10**, the version this build expects; coming from schema 9 it applies
   just the schema 10 block, from 8 the 9 and 10 blocks, and so on.
   Until it is run, the app already hides Billing from a doctor and Consultations
   from the front desk, but the API still answers yes to both — **schema 10 is what
   closes that**.

### What schema 10 changes

Everything is additive and the block only runs when `app_schema_version() < 10`.

- `consultations_read` — select for `owner`, `doctor`. The front desk books,
  registers and bills; it no longer reads what was written in the consulting room.
- `invoices_read` — select for `owner`, `frontdesk`.
- `invoices_write` — insert for `owner`, `frontdesk`.
- `invoices_update` — update for `owner`, `frontdesk`, with `using` **and**
  `with check` on the same roles, so an update cannot be walked through the insert
  policy.
- No column, table, function or row is dropped. Voids, paid-invoice amendments and
  deletes stay owner-only (`invoice_guard()`, `invoices_delete`).

**Who notices:** a clinic that had been letting its doctor raise or settle bills,
or letting the desk read notes, loses that. Moving a person to the seat that has
the job — the doctor to the chart, the desk to the till, the owner to both — is
the fix, not a workaround.

Verified on PostgreSQL 17 as a fresh install and as a 9 → 10 upgrade (and an 8 →
9 → 10 run), each followed by `supabase/schema-tests.sql` — six suites, rollbacks
only. Suite F is the role matrix; it signs in as owner, doctor and front desk in
turn, then tries to promote a seat and to join another clinic.

### What schema 9 changed (v1.11.5)

- `public.next_clinic_slug(name, exclude)` — a clinic name turned into a URL
  address nobody else holds (`dr-mehta-clinic`, `dr-mehta-clinic-1`, …).
- `create_clinic()` now inserts `slug` (minted with that function) and no longer
  fails when the owner's full name was left blank.
- A row-by-row backfill gives every clinic an address and rewrites any the public
  lookup could never match: capitals (the lookup lowercases what a patient typed),
  punctuation, an empty slug, or one past 40 characters.
- `clinics_slug_format` — `^[a-z0-9][a-z0-9-]*$`, 1–40 characters.
- `public.set_clinic_slug(clinic, slug)` — owner-only, revoked from `PUBLIC` and
  unavailable to `anon`, normalises what was typed, steps aside on a collision,
  falls back to the clinic's name when the field is cleared, and returns the
  address that is now live so the app can display exactly that.

### What schema 8 changed (v1.11.0 onward — already applied if you have been pushing)

- `clinics` gains `booking_enabled` (default true), `booking_horizon_days`
  (default 14, 1–60) and `booking_note` (≤120 chars).
- `appointments` gains `booking_ref` (unique per clinic where not null) and
  `cancelled_at`.
- **One constraint is replaced, not added:** the full
  `unique (doctor_id, scheduled_on, scheduled_at)` becomes a partial unique index
  `where status <> 'cancelled'`, so a cancelled slot can be booked again without
  deleting history. Strictly weaker than what it replaces — no row that satisfied
  the old rule can violate the new one.
- Five `security definer` functions with `set search_path = public`, each granted to
  `anon` and `authenticated` and revoked from `PUBLIC`:
  `public_clinic_profile(text)`, `public_booking_busy(text, uuid)`,
  `public_book(text, uuid, date, time, text, text, text)`,
  `public_booking_lookup(text)`, `public_cancel_booking(text)`.
  No policy is added for `anon` on any table — the functions are the whole surface,
  and `public_booking_busy` returns times and lengths, never a patient.
- `public_book` takes a per-doctor-per-day advisory lock, refuses a slot that
  overlaps a live appointment, caps a phone at three online bookings a day and a
  clinic at forty an hour, and matches an existing patient by phone digits before
  creating a new `PT-xxxxx` card.
- `patients_phone_digits_idx` on `(clinic_id, regexp_replace(phone, '[^0-9]', '', 'g'))`
  so the phone match is an index lookup rather than a scan.

Run `node scripts/security-check.mjs` for the anon-side checks that should follow
(set role anon; the five RPCs answer, every table refuses).
