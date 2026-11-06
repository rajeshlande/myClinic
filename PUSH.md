# Pushing myClinic to GitHub (bundle method)

The build sandbox has no GitHub credentials, so nothing is pushed from here — it
hands over a **git bundle**: one file containing real git objects, refs and tags.
Your clone stays a normal clone; `git bundle verify` reports it as a complete
source of history.

**State of the remote (verified 2026-11-06):** `main` is at `48c089a` (v1.13.1),
deployed by Pages run #9, and the live site serves 1.13.1 / schema 13. All
twenty-three tags are there, up to `v1.13.1`.

**This bundle adds one commit and one tag:** the **1.14.0** release — the drug
directory, typo-tolerant drug search, the import and RxNorm tools — tagged
`v1.14.0`, on top of `48c089a`.

Two files, pick according to what you already have:

| File | Size | Use it when |
| --- | --- | --- |
| `myClinic-update-to-v1.14.0.bundle` | ~40 KB | You already have the repo at `48c089a` — **recommended**. It is a delta and fast-forwards. |
| `myClinic-full-v1.14.0.bundle` | ~11 MB | You want a standalone clone source (new machine, no GitHub access yet, or the repo is empty). |

Both carry `main` (1.14.0 plus this document) and every tag from `v1.2.1` to
`v1.14.0`.

## Route A · update the clone you already pushed (recommended)

```bash
cd ~/Desktop/SNDT_APP/New_folder/myClinic
git status                      # expect: clean, HEAD at 48c089a
git remote -v                   # expect: origin → github.com/rajeshlande/myClinic.git

git fetch /path/to/myClinic-update-to-v1.14.0.bundle \
  'refs/heads/main:refs/remotes/bundle/main' \
  'refs/tags/*:refs/tags/*'

git merge --ff-only refs/remotes/bundle/main

git log --oneline -3            # feat(rx) 1.14.0 / fix(sync) 1.13.1 / docs PUSH
git push origin main
git push --atomic origin refs/tags/v1.14.0
```

`--ff-only` is deliberate: if it refuses, the history is not what the bundle
expects and you should stop rather than invent a merge.

The tag goes up **by name** rather than with `--tags`/`--follow-tags` because
`v1.2.1` already exists on GitHub pointing at `53c0957`, while in this history it
points at another commit. Nothing published gets rewritten.

## Route B · clone the full bundle, then push

```bash
git clone -b main /path/to/myClinic-full-v1.14.0.bundle myClinic
cd myClinic
git remote set-url origin git@github.com:rajeshlande/myClinic.git
git push origin main
git push --atomic origin refs/tags/v1.14.0
```

## What is in this release

**1.14.0 — the drug field stops demanding the exact spelling.**

- **Typo tolerance that works offline.** Search ranks exact → brand prefix → word
  start → molecule → keyword → trigram similarity, computed in the browser
  (`src/lib/drug-search.mjs`). `Augmentn`, `amoxycillin`, `metformn`, `crocn` and
  `tab pan 40` all find the drug. A multi-word term is only as strong as its
  weakest word.
- **A drug directory in the database (schema 14).** `public.medicines` — brand,
  composition, form, strength, schedule, classes — with GiST trigram indexes and
  `search_medicine_brands(term, limit)` granted to signed-in seats only. 59 starter
  brands are seeded, so the directory is useful the minute the SQL runs.
- **The composition travels with the brand**: brand bold, salt and form muted
  beneath, matched letters highlighted, a source label per row (Used here /
  Directory), 250 ms debounce, arrow keys / Home / End / Enter, and a screen-reader
  count.
- **Read-only reference data**: RLS on, one SELECT policy for authenticated, no
  write grant to any app role, and the function is `security invoker`.
- **Two tools for real data**: `scripts/import-medicines.mjs` (data.gov.in / CDSCO
  / chemist CSV, TSV or JSON → idempotent SQL or a REST push, with a dry run) and
  `scripts/rxnorm-composition.mjs` (re-spell a molecule the way NLM's RxNorm does).
- **Small fix carried along**: the public booking page now has copy for
  `booking:dayoff` and `booking:leave`, which the database has emitted since schema
  12 and the page answered with "Could not book that slot."

Full detail: `docs/DRUG-DIRECTORY.md`, `CHANGELOG.md`, and Settings → What's new.

## What schema 14 changes

One new table, two indexes, one function, 59 seeded rows. No existing table is
altered, no row is read or rewritten, and nothing is dropped.

- `public.medicines` — `brand_name`, `composition`, `form`, `strength`,
  `manufacturer`, `schedule` (OTC / H / H1 / X or null), `classes text[]`,
  `keywords`, `source`, timestamps. Identity is `lower(brand_name) +
  lower(strength) + lower(form)`.
- `create extension if not exists pg_trgm`, then GiST indexes on `brand_name` and
  `composition`. If the server cannot create the extension the migration says so
  and falls back to a `text_pattern_ops` index with prefix matching — the table and
  function still work.
- `public.search_medicine_brands(p_term text, p_limit integer default 8)`, `stable`,
  `security invoker`, pinned `search_path`, execute granted to `authenticated`
  only.
- RLS on with one SELECT policy; `revoke all` from `anon` and `authenticated`, then
  `grant select` to `authenticated`.
- `schema_migrations` gains `(14, 'drug-directory', '1.14.0', …)` and `app_meta`
  moves to 14.

## Verify a bundle before you trust it

```bash
git bundle verify /path/to/myClinic-update-to-v1.14.0.bundle   # from inside a repo
git bundle list-heads /path/to/myClinic-update-to-v1.14.0.bundle
```

Expected: `refs/heads/main` and `refs/tags/v1.14.0`, and the bundle is reported
"okay" against your clone.

## After the push (nothing in the bundle can do this for you)

1. **Run `supabase/schema.sql`** — the whole file, once. It lands the project at
   schema **14** and seeds the 59 starter brands. Confirm with
   `select public.app_schema_version();` → **14** and
   `select count(*) from public.medicines;` → **59**.
2. **Import the long tail** (optional, and the point of the table):
   `node scripts/import-medicines.mjs --file <your export>` prints what it would
   do; `--sql out.sql` writes SQL you can paste, `--push` writes directly with a
   service-role key.
3. **Reload the site once** (or Settings → About → **Reload this build**) so the
   service worker picks up the new bundle rather than the cached 1.13.1.
4. **Try the field**: a consultation, type `augmentn` — Augmentin 625 should be the
   first suggestion with its composition under it. In the demo workspace the
   directory is absent by design (no database), so the same result comes from the
   shipped formulary.

If Pages shows 1.14.0 / schema 13, the app is telling you the database is behind —
that is the prompt to run the SQL, not a bug in the build.
