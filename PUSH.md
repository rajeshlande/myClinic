# Pushing myClinic to GitHub (bundle method)

The build sandbox has no GitHub credentials, so nothing is pushed from here — it
hands over a **git bundle**: one file containing real git objects, refs and tags.
Your clone stays a normal clone; `git bundle verify` reports it as a complete
source of history.

Current state of <https://github.com/rajeshlande/myClinic.git>: `main` at
`7dab99c` *"docs: PUSH.md for the v1.9.0 bundles"*, tags `v1.2.1 … v1.9.0`.
Everything after that — v1.10.0 and its commits — is in the bundles below.

Two files, pick according to what you already have:

| File | Size | Use it when |
|---|---|---|
| `myClinic-update-to-v1.10.0.bundle` | ~20 KB | You already have the repo on GitHub or on disk at `7dab99c`. **Recommended** — it is a delta and fast-forwards. |
| `myClinic-full-v1.10.0.bundle` | ~10 MB | You want a standalone clone source (new machine, no GitHub access yet, or the repo is empty). |

Both carry `main` and every release tag `v1.2.1 … v1.10.0`.

## Route A · update an existing clone, then push (recommended)

The update bundle declares `7dab99c` as its prerequisite, so it applies to your
existing clone as-is — no re-download of ten rounds of history.

```bash
git clone https://github.com/rajeshlande/myClinic.git myClinic   # skip if already cloned
cd myClinic
git fetch /path/to/myClinic-update-to-v1.10.0.bundle \
  'refs/heads/main:refs/remotes/bundle/main' 'refs/tags/*:refs/tags/*'
git merge --ff-only refs/remotes/bundle/main

git push origin main
git push origin refs/tags/v1.10.0
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
github.com/rajeshlande/myClinic → fetch the bundle → `git merge --ff-only` lands
on the v1.10.0 commit, exit code 0, working tree clean, **150/150 tests** pass,
`npm run build` and `npm run check:pages` clean, tags `v1.3.0 … v1.10.0` present
and `v1.2.1` untouched.

## Route B · clone the full bundle, then push

```bash
git clone -b main myClinic-full-v1.10.0.bundle myClinic
cd myClinic
git remote set-url origin https://github.com/rajeshlande/myClinic.git
git push -u origin main
git push origin refs/tags/v1.10.0
```

(A fresh clone *can* be pushed with `--follow-tags`; the explicit tag list above
still avoids the pre-existing `v1.2.1` on GitHub.)

## What is in these commits

| Commit | Release | Scope |
|---|---|---|
| `f2feaba` | **1.10.0** · schema 7 | Day close (collections by method, cash reconciliation, frozen `day_closes` snapshot), the missed-charge detector, and the reminder queue with a `reminders` send log that honours quiet hours. Plus mobile layouts for both new screens. |
| `7dab99c` | docs | This file, for the v1.9.0 bundles. |
| `3fdee7b` | **1.9.0** · schema 6 | Phone layout for every screen: agenda day board, lists that read down, full-screen consultation sheet with pinned actions, paged registers, 38px+ touch targets. Plus `buildDayBoard` now honours its injected clock. |
| `8df4296` | **1.8.0** · schema 6 | Medicine master typeahead with dose defaults, prescription safety, acknowledgement logged to `consultations.rx_safety`, `RX/26-27/0001` numbering. |
| `cc0ca35` | **1.7.0** · schema 5 | UPI QR collection, one payment sheet everywhere, rebuilt documents, `supabase/schema.sql` as the single source of truth for the database. |

## Verify a bundle before you trust it

```bash
git bundle verify myClinic-update-to-v1.10.0.bundle    # refs + required base
git bundle verify myClinic-full-v1.10.0.bundle         # "complete history"
git clone -b main myClinic-full-v1.10.0.bundle /tmp/check
cd /tmp/check && npm ci && npm test && npm run build && npm run check:pages
```

## After the push (nothing in the bundle can do this for you)

1. **Settings → Secrets and variables → Actions** → add `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY`.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Watch the workflow: it prints `node -v` / `npm -v` (expect `v26.13.0` /
   `12.2.1`), then either `Supabase keys present` or a demo-mode warning, then deploys.
4. Site: <https://rajeshlande.github.io/myClinic/> · self-test: `/#/setup`.
5. **Run the database migration**: paste `supabase/schema.sql` into the Supabase SQL
   editor once. It is idempotent and lands the project at schema **7** — the version
   this build expects, adding `day_closes` and `reminders` to the schema 6 columns
   (`rx_number`, `rx_version`, `rx_safety`). Until it is run, Day close and the
   reminder log say so on screen and cannot write; every other screen works.

### What schema 7 changes

- New table `day_closes`: one row per clinic per day, `unique (clinic_id, closed_on)`,
  with the frozen `totals` jsonb, `expected_cash_paise`, `counted_cash_paise`,
  `variance_paise`, `note`, `status` (`closed` / `reopened`) and `closed_by`.
  Read by owner, doctor and front desk; written by owner and front desk; no delete
  policy — a close is reopened, never removed.
- New table `reminders`: `draft_key`, `kind`, `ref_id`, `channel`, `status`
  (`copied` / `opened` / `sent` / `skipped`), `body`, `logged_on`, `sent_at`,
  `sent_by`. Append-only for staff; only an owner may delete a row.
- Both are additive and guarded by `app_schema_version() >= 7`, so re-running the
  file on a schema 6 database applies just this block and changes nothing else.
