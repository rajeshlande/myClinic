# Pushing myClinic to GitHub (bundle method)

The build sandbox has no GitHub credentials, so nothing is pushed from here — it
hands over a **git bundle**: one file containing real git objects, refs and tags.
Your clone stays a normal clone; `git bundle verify` reports it as a complete
source of history.

Current state of <https://github.com/rajeshlande/myClinic.git>: `main` at
`53c0957` *"docs: PUSH.md…"*, one tag (`v1.2.1`). Everything after that — v1.3.0,
v1.4.0, v1.5.0, v1.7.0, v1.8.0 and their four commits — is in the bundles below.

Two files, pick according to what you already have:

| File | Size | Use it when |
|---|---|---|
| `myClinic-update-to-v1.8.0.bundle` | ~160 KB | You already have the repo on GitHub or on disk at `53c0957`. **Recommended** — it is a delta and fast-forwards. |
| `myClinic-full-v1.8.0.bundle` | ~10 MB | You want a standalone clone source (new machine, no GitHub access yet, or the repo is empty). |

Both carry `main` and every release tag `v1.2.1 … v1.8.0`.

## Route A · update an existing clone, then push (recommended)

The update bundle declares `53c0957` as its prerequisite, so it applies to your
existing clone as-is — no re-download of ten rounds of history.

```bash
git clone https://github.com/rajeshlande/myClinic.git myClinic   # skip if already cloned
cd myClinic
git fetch /path/to/myClinic-update-to-v1.8.0.bundle \
  'refs/heads/main:refs/remotes/bundle/main' 'refs/tags/*:refs/tags/*'
git merge --ff-only refs/remotes/bundle/main

git push origin main
git push origin refs/tags/v1.3.0 refs/tags/v1.4.0 refs/tags/v1.5.0 \
               refs/tags/v1.7.0 refs/tags/v1.8.0
```

`--ff-only` is deliberate: if it refuses, the history is not what the bundle
expects and you should stop rather than invent a merge.

Tags are pushed by name rather than with `--tags`/`--follow-tags` on purpose:
**`v1.2.1` already exists on GitHub pointing at `53c0957`, while in this history
it points at `5224806`.** The bundle therefore carries only the tags GitHub does
not have, so nothing is rejected and no published tag is rewritten. If you want
the old tag moved onto this history, do it deliberately:
`git push --force origin refs/tags/v1.2.1` (only if nothing references it).

Verified from this sandbox against the live repository: `git clone` of
github.com/rajeshlande/myClinic → fetch the bundle → `git merge --ff-only` lands
on `d5a69a0`, exit code 0, working tree clean, tags `v1.3.0 … v1.8.0` present and
`v1.2.1` untouched.

## Route B · clone the full bundle, then push

```bash
git clone -b main myClinic-full-v1.8.0.bundle myClinic
cd myClinic
git remote set-url origin https://github.com/rajeshlande/myClinic.git
git push -u origin main
git push origin refs/tags/v1.3.0 refs/tags/v1.4.0 refs/tags/v1.5.0 \
               refs/tags/v1.7.0 refs/tags/v1.8.0
```

(A fresh clone *can* be pushed with `--follow-tags`; the explicit tag list above
still avoids the pre-existing `v1.2.1` on GitHub.)

Verified from this sandbox: cloned from the bundle, `npm test` → **119 passed**,
`npm run build` and `npm run check:pages` → clean, 13 commits of history present.

## What is in these commits

| Commit | Release | Scope |
|---|---|---|
| `d5a69a0` | docs | This file, for the v1.8.0 bundles. |
| `cc0ca35` | **1.7.0** · schema 5 | UPI QR collection on unpaid invoices, one payment sheet for billing/invoice/patient chart, rebuilt invoice and prescription documents, and `supabase/schema.sql` as the single source of truth for the whole database. |
| `8df4296` | **1.8.0** · schema 6 | Medicine master typeahead with dose defaults, prescription safety (duplicate molecule/class, interactions, allergies, H1 notice), acknowledgement logged to `consultations.rx_safety`, and `RX/26-27/0001` prescription numbering. Also fixes the consultation dialog stealing the caret. |

Both commits were built and tested **in isolation** (`88` and `119` tests
passing respectively) so a bisect over this range never lands on a broken tree.

## Verify a bundle before you trust it

```bash
git bundle verify myClinic-update-to-v1.8.0.bundle    # refs + required base
git bundle verify myClinic-full-v1.8.0.bundle         # "complete history"
git clone -b main myClinic-full-v1.8.0.bundle /tmp/check
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
   editor once. It is idempotent and lands the project at schema **6** — the version
   this build expects, including `rx_number`, `rx_version` and `rx_safety`.
