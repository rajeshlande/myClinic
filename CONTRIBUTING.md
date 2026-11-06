# Contributing

Small clinical SaaS, one shared database, real patient data in production. Two rules
matter more than style: **never break tenant isolation**, and **never lose a
clinician's concurrent edit**.

Everything below is enforced where it can be. `npm run check:contributing` is the
machine's copy of this document — it scans the tracked tree, the dependency list, the
test layout and the vendored audit skill, and it fails the build on the rules that are
not negotiable. CI runs it on every pull request.

---

## 1. Security & privacy standards (zero-trust)

**No hardcoded secrets.** Never commit API keys, passwords, bearer tokens or personal
credentials. Configuration arrives through environment variables only:

```bash
cp .env.example .env.local     # VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
```

Only **public** values belong in a `VITE_` variable — anything there is compiled into
the bundle and shipped to the browser. A `service_role` or `sb_secret_…` key in a
`VITE_` variable is a full-database compromise; `src/lib/supabase.js` and
`src/lib/health.mjs` refuse to start with one, and the Setup screen says so in plain
words. The check script fails the build if a credential-shaped string reaches a
tracked file.

**Push protection.** Enable **Secret scanning** and **Push Protection** in the fork's
Settings → Code security. A push containing a known credential shape is blocked before
it lands, which is the only point at which a leaked key is still harmless. If a secret
does land: rotate it first, then rewrite history — deleting the commit is not enough,
because the object stays reachable until the fork is garbage-collected.

**Input sanitisation at the boundary.** Every input is validated where it enters the
system, then escaped on the way out:

- the form layer validates in `src/lib/logic.mjs` (`validateConsultation`,
  `validateInvoice`, …) before a payload is built;
- Postgres is the **authority**, not the client: row-level security and the
  `check` constraints in `supabase/schema.sql` refuse what the UI would have refused;
- nothing is injected as HTML — the checker fails on `dangerouslySetInnerHTML`,
  `.innerHTML` or `insertAdjacentHTML`. React escapes everything else;
- SQL is never concatenated: the client talks to Supabase's PostgREST builder and the
  RPCs; a `security definer` function re-authorises each id it accepts (see
  `issue_token()` in `supabase/schema.sql`).

**Dependency safe-listing.** No third-party library without a reason. A runtime
dependency has to be (a) on the safe-list in `scripts/check-contributing.mjs`,
(b) listed with its licence in `THIRD_PARTY_NOTICES.md`, and (c) maintained and free
of known advisories. `npm audit --audit-level=high` runs in CI; `npm run audit:deps`
runs it locally. Today that list is eight packages, all of them either React, the
Supabase client, icons, fonts, a QR encoder or the router.

**Security vulnerabilities.** Do **not** open a public issue. Use the repository's
**Security** tab → *Report a vulnerability* (private advisory). See
[`SECURITY.md`](SECURITY.md) for scope, what is already known, and how to run the
database verification yourself.

### The security-audit skill

The [Cloudflare `security-audit` skill](https://github.com/cloudflare/security-audit-skill)
is vendored at **`.claude/skills/security-audit/`** (MIT, pinned commit recorded in
`VENDORED.md`), so a coding agent opened on this repository has the same audit
procedure as everyone else without a network install. Do not edit those files.

Ask for it in plain language — *"security audit this codebase"*, *"find security
vulnerabilities in ./src"* — and the agent runs the six phases: reconnaissance,
coverage-led hunting, candidate validation, structured output, independent record
verification, reporting. Two rules from the skill are worth repeating here because
they are the whole reason it works:

- **The agent that checks a finding is never the agent that found it.** Findings are
  written as `confirmed`, `needs_validation` or `rejected`, and a `confirmed` one
  needs a concrete principal, resource and outcome — not a checklist deviation.
- **No sandbox, no execution.** Without an OS-enforced sandbox the audit stays
  source-first and anything that would need running is filed as `needs_validation`.
  It never probes the deployed site, the live Supabase project, or real patient data.

Run it before a release, or when a change touches RLS, auth, sharing or the sync
engine. It is guidance by default; only an explicit audit request runs the full
workflow and writes report files. Preflight the vendored copy with
`npm run check:contributing -- --only skill`.

---

## 2. Performance guidelines

**Resource management.** Clean up what you add: remove every `addEventListener`
(including `matchMedia` and `navigator.serviceWorker`), `clearInterval` every
`setInterval`, and abort in-flight fetches on unmount. `src/lib/pwa.jsx` is the
reference — the service worker listeners are collected in a `teardown` array because
the front desk leaves the app open all day and React re-runs an effect on a remount.
The checker counts registrations against cleanups per file.

**Optimised execution.** Nothing blocking in the browser bundle: no `execSync`,
`readFileSync`, `writeFileSync` (the checker fails on those). Heavy work — drug
search normalisation, the Rx language layer, invoice arithmetic — lives in pure
modules under `src/lib/` where it is measured and tested rather than sprinkled through
components.

**Database efficiency.** One round trip beats N. The store loads a clinic's data in
batches and merges it (`src/lib/store.jsx`), the drug directory is imported once
rather than queried per keystroke, and `search_medicine_brands` is a single RPC over
an indexed table. If a screen needs data the store does not hold, add a batched fetch
or an RPC — never a query inside a `map`.

**Asset optimisation.** Images are compressed and sized before they are committed;
routes are lazy (`src/App.jsx` uses `lazy(() => import(...))` with `Suspense`, so the
prescription and invoice screens are not in the first chunk); fonts are the two
variable families in the dependency list, not a webfont per heading.

---

## 3. Coding & style standards

**Automated formatting.** Run the gates before you push — they are the same ones CI
runs:

```bash
npm test                     # node scripts/run-tests.mjs — 439 tests
npm run verify               # tests + production build + Pages readiness
npm run check:contributing   # this document, checked
npm run test:security        # prints the RLS verification procedure
```

Markdown is linted against the committed `.markdownlint.json`:

```bash
npx markdownlint-cli2 "**/*.md"
```

JavaScript is gated by the test suite and the build rather than a formatter: there is
no ESLint/Prettier in this repository, so match the surrounding file — two-space
indent, single quotes, trailing commas in multi-line literals, no semicolon-free code.

**Naming conventions.**

| Kind | Convention | Example |
| --- | --- | --- |
| Variables, functions | `camelCase` | `quantityToDispense`, `paginateRows` |
| Components, pages | `PascalCase`, file named after the component | `ConsultationForm.jsx`, `PrescriptionView.jsx` |
| Constants and registries | `UPPER_CASE` | `SCHEMA_VERSION`, `FREQUENCIES`, `ALLOWED_DEPENDENCIES` |
| Pure modules | lower-case files in `src/lib/` | `rx-language.js`, `paginate.mjs` |
| Database | snake_case, plural tables | `consultations`, `follow_up_on` |

`src/components/ui.jsx` is the one deliberate exception: it is the shared primitive
kit, not a component. The checker enforces the rest.

**Testing.** Every bug fix and every feature ships with tests — a fix without a test is
a fix that comes back. Put them in `tests/<area>.test.mjs`; the pure logic in
`src/lib/` is testable by design (no network, no DOM), so there is no excuse. Coverage
must not go down: `npm test` is the gate, and a pure module with no test importing it
is reported by `npm run check:contributing`.

**Documentation.** A change in behaviour updates, in the same commit: the code comment
that explains *why*, the `CHANGELOG.md` entry, `APP_VERSION` in `src/lib/version.js`
(and `SCHEMA_VERSION` if the database changed), and the relevant file in `docs/`.
A schema change also updates `supabase/schema-tests.sql`.

---

## 4. Pull request process

1. **Fork the repository** and work on a descriptive branch:
   `feature/add-login-validation`, `fix/memory-leak`, `docs/prescription-format`.
2. **Commit messages** in the imperative mood, with the conventional prefix the
   history already uses — `feat(rx): …`, `fix(print): …`, `docs: …`, `chore: …`.
3. **Open a PR** against `main`. Say what changed, which issue it closes, and **how to
   test it** — the commands you ran, and anything an operator has to do (a schema
   paste, a new environment variable).
4. **Code review.** Every automated check must be green — `npm test`, the build from
   both base paths, the Pages readiness check, the contributing checks, the
   dependency audit, and the security checklist — and a maintainer has to approve.
   Reviews here focus on the two rules at the top of this file: tenant isolation and
   concurrent edits.

---

## Setup

```bash
nvm use            # Node 26 LTS (see .nvmrc); npm 12.2.1 via packageManager
npm ci
npm run dev        # http://localhost:5173 — runs the demo clinic, no keys needed
```

To exercise the live paths you need a **scratch** Supabase project:

```bash
cp .env.example .env.local     # add VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
# paste supabase/schema.sql into the SQL editor, then:
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/schema-tests.sql
```

CI runs the same commands on Node 22 and 26, plus a build from a repository sub-path.

## Changing the database

- `supabase/schema.sql` must stay **re-runnable** — guard everything with
  `create ... if not exists` / `create or replace` / `drop policy if exists`.
- Bump `SCHEMA_VERSION` in `src/lib/version.js` and add a `CHANGELOG` entry.
- Add an assertion to `supabase/schema-tests.sql` for every new policy. The suite runs
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

## What we will not merge

- A dependency that ships a service-role key or talks to a third-party analytics service.
- Client-side-only authorisation.
- Anything that caches authenticated API responses in the service worker.
- A credential, a real patient record or a production connection string in the diff,
  even in a comment, even in a test fixture.
- A change to `supabase/schema.sql` that is not re-runnable, or that adds a policy with
  no assertion in `supabase/schema-tests.sql`.
