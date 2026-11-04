# Pushing myClinic to GitHub (bundle method)

The build sandbox has no GitHub credentials, so nothing is pushed from here — it
hands over a **git bundle**: one file containing real git objects, refs and tags.
Your clone stays a normal clone; `git bundle verify` reports it as a complete
source of history.

Current state of <https://github.com/rajeshlande/myClinic.git>: `main` at
`e417a41` *"docs: PUSH.md points at the v1.11.2 commit"*, tags `v1.10.0 …
v1.11.2`. Everything after that is in the bundles below — **three releases, one
push**: **1.11.3, the schema fix**, **1.11.4, the offline-sync fix**, and
**1.11.5, the booking link**, which is the first release to ask for schema **9**.

Two files, pick according to what you already have:

| File | Size | Use it when |
|---|---|---|
| `myClinic-update-to-v1.11.5.bundle` | ~45 KB | You already have the repo on GitHub or on disk at `e417a41` (v1.11.2 pushed) — which is where GitHub is now. **Recommended** — it is a delta and fast-forwards. |
| `myClinic-full-v1.11.5.bundle` | ~10 MB | You want a standalone clone source (new machine, no GitHub access yet, or the repo is empty). |

Both carry `main` and the three tags GitHub does not have yet — `v1.11.3`,
`v1.11.4` and `v1.11.5` — plus every earlier tag.

## Route A · update an existing clone, then push (recommended)

The update bundle declares `e417a41` as its prerequisite, so it applies to your
existing clone as-is — no re-download of the history you already pushed. It lands
**three** commits of product (`436efe2` the schema fix, `b7c64cd` the offline-sync
fix, and the two commits that make up 1.11.5) plus three docs commits.

```bash
git clone https://github.com/rajeshlande/myClinic.git myClinic   # skip if already cloned
cd myClinic
git fetch /path/to/myClinic-update-to-v1.11.5.bundle \
  'refs/heads/main:refs/remotes/bundle/main' 'refs/tags/*:refs/tags/*'
git merge --ff-only refs/remotes/bundle/main

git push origin main
git push origin refs/tags/v1.11.3 refs/tags/v1.11.4 refs/tags/v1.11.5
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
`git merge --ff-only` lands on the v1.11.5 commit, exit code 0, working tree
clean, **252/252 tests** pass, `npm run build` and `npm run check:pages` clean,
tags `v1.11.3 … v1.11.5` present and `v1.2.1` untouched.

## Route B · clone the full bundle, then push

```bash
git clone -b main myClinic-full-v1.11.5.bundle myClinic
cd myClinic
git remote set-url origin https://github.com/rajeshlande/myClinic.git
git push -u origin main
git push origin refs/tags/v1.11.3 refs/tags/v1.11.4 refs/tags/v1.11.5
```

(A fresh clone *can* be pushed with `--follow-tags`; the explicit tag list above
still avoids the pre-existing `v1.2.1` on GitHub.)

## What is in these commits

| Commit | Release | Scope |
|---|---|---|
| `7145671` | **1.11.5** · schema 9 | The booking link works from the moment a clinic is created. Settings shows the address the database answers on (Copy/Open disabled until one exists) instead of the sample clinic's `sunrise-opd`, a renamed link says "patients stay on /book/old-name until you save", and `/book/:slug` renders outside `<StoreProvider>` so a patient no longer watches "Opening your clinic…". **Run `supabase/schema.sql` again — it lands schema 9.** |
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
git bundle verify myClinic-update-to-v1.11.5.bundle    # refs + required base (e417a41)
git bundle verify myClinic-full-v1.11.5.bundle         # "complete history"
git clone -b main myClinic-full-v1.11.5.bundle /tmp/check
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
   schema **9**, the version this build expects; coming from schema 8 it applies just
   the schema 9 block, from schema 7 the 8 and 9 blocks.
   Until it is run, booking still works but a *newly created* clinic has no public
   address (the app falls back to a plain row write), so **clinic creation needs
   schema 9 to hand out a working link**. Nothing else is affected.
6. **Existing clinic has no link?** Open Settings → Clinic → Public booking and press
   “Save booking settings” once: either schema 9's backfill already gave it an address
   (it runs when the file is applied) or the save mints one.

### What schema 9 changes

Everything is additive and the block only runs when `app_schema_version() < 9`.

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

Verified on PostgreSQL 17 as a fresh install **and** as an upgrade from schema 8,
both followed by `supabase/schema-tests.sql` (five suites, rollbacks only).

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
