# Contributing

Small clinical SaaS, one shared database, real patient data in production. Two rules
matter more than style: **never break tenant isolation**, and **never lose a
clinician's concurrent edit**.

## Setup

```bash
nvm use            # Node 22.12+ (see .nvmrc)
npm ci
npm run dev        # http://localhost:5173 — runs the demo clinic, no keys needed
```

To exercise the live paths you need a **scratch** Supabase project:

```bash
cp .env.example .env.local     # add VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
# paste supabase/schema.sql into the SQL editor, then:
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/rls-tests.sql
```

## Before you open a PR

```bash
npm test                 # 39 tests: money, invoices, queue, sync engine, role matrix
npm run verify           # + production build + GitHub Pages readiness
npm run test:security    # prints the RLS verification procedure
```

CI runs the same commands on Node 22 and 24, plus a build from a repository sub-path.

## Changing the database

- `supabase/schema.sql` must stay **re-runnable** — guard everything with
  `create ... if not exists` / `create or replace` / `drop policy if exists`.
- Bump `SCHEMA_VERSION` in `src/lib/version.js` and add a `CHANGELOG` entry.
- Add an assertion to `supabase/rls-tests.sql` for every new policy. The suite runs
  inside a transaction and rolls back, so it is safe to re-run.
- Every `security definer` function must re-authorise **each id it accepts**, not just
  the clinic. `issue_token()` is the reference implementation.

## Changing a role rule

The matrix exists twice on purpose: in Postgres (authority) and in
`src/lib/permissions.js` (so the UI never offers a refused action). Change both, then
add a test to `tests/logic.test.mjs`.

## Changing domain logic

`src/lib/logic.mjs`, `offline.js`, `rx-language.js` and `permissions.js` are pure — no
network, no DOM. Keep them that way and they stay testable. If you need a side effect,
pass it in (see `replayOutbox({ db })`).

## Commits

Conventional prefixes are appreciated (`feat:`, `fix:`, `docs:`, `chore:`). Keep the
subject in the imperative mood.

## What we will not merge

- A dependency that ships a service-role key or talks to a third-party analytics service.
- Client-side-only authorisation.
- Anything that caches authenticated API responses in the service worker.
