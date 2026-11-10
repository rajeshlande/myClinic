# Architecture

What this codebase is, how it is held together, where it holds and where it
doesn't, and the order in which the weak parts get fixed.

Measured at **v1.26.0** (`bc7d94d`), schema 18. Every number here is reproducible —
the command that produced it is in the line below it, so this document can be
re-measured instead of trusted.

---

## 1. Shape

A **functional core with an imperative shell**:

```
  pages/ + components/         React, one screen per file, lazy-routed
        ↓  (imports)
  lib/store.jsx                the one stateful seam: data, cache, queue, licence
        ↓  (imports)
  lib/*.mjs                    pure domain: 43 modules, 21 of them import nothing
        ↓  (never called from lib/)
  supabase/                    Postgres is the authority: RLS, triggers, one RPC
```

- **The dependency arrow only points down.** `grep 'import .*components/' src/lib`
  returns nothing, and no `lib` module imports the store. That is the property that
  lets 529 tests run in a terminal with no browser, no network and no React.
- **There is one class in the app** — `components/ErrorBoundary.jsx extends
  React.Component`, because React requires it. Everything else is functions,
  plain objects and data tables. Inheritance is not used as a design tool.
- **The database is the contract, the client is the mirror.** Seat caps, the
  read-only gate, role permissions and refusal codes are enforced in
  `supabase/schema.sql`; `src/lib/` re-states them so the UI never offers what the
  server will reject. The database is the authority in every dispute.

```bash
$ grep -rn "extends " src --include=*.js* | wc -l          # 1
$ ls src/lib/*.mjs src/lib/*.js src/lib/*.jsx | wc -l      # 43
$ for f in src/lib/*.mjs src/lib/*.js; do [ "$(grep -c '^import ' $f)" -eq 0 ] && echo $f; done | wc -l   # 21
```

---

## 2. SOLID, honestly

SOLID assumes class hierarchies and interface declarations. This app has neither,
so four of the five letters are scored in their functional translation:

- **SRP** — does a module have one reason to change?
- **OCP** — is a new variant an edit to *data*, or a branch in five screens?
- **LSP** — does a substituted value honour the contract the caller was promised?
- **ISP** — does a consumer receive only what it needs to do its job?
- **DIP** — does high-level logic depend on an abstraction, or on a concrete client?

| Principle | Grade | Evidence |
| --- | --- | --- |
| Single Responsibility | **B** | 21/43 lib modules are pure leaves, `logic.mjs` is a 26-line barrel (v1.29.0) and `Settings.jsx` is down from 969 lines to 275 with eight 62–198-line tab components (v1.30.0) — but `store.jsx` is still 1,031 lines / 13 imports and `ConsultationForm.jsx` 682 |
| Open/Closed | **B−** | **2 `switch` statements** in all of `src/`; rules are tables (`MATRIX`, `PLAN_LIMITS`, `CENTRAL_CODES`, `PAYMENT_METHODS`, `APPOINTMENT_TYPES`). A new refusal code = **2 files**; a new plan = **8 JS files + `schema.sql`** |
| Liskov Substitution | **n/a → B** | No hierarchies. The functional analogue is honoured except one silent widening: `PLAN_LIMITS[plan] ?? PLAN_LIMITS.growth` treats an unknown plan as Growth, where `schema.sql` would reject it |
| Interface Segregation | **C** | Pure modules take narrow arguments; but **32 files** call `useStore()`, which spreads `...state` and publishes 30+ keys — every screen can read every table |
| Dependency Inversion | **A−** | Only **3 files** import the concrete Supabase client; `central-sync.mjs` takes `fetch`/`storage`/`now` as parameters. One deliberate exception: `import.meta.env` is read at module scope in `supabase.js` |

### 2.1 Where it is solid

1. **The layering holds by absence, not by convention.** No import path exists from
   domain code to UI code, so the rule cannot be forgotten.
2. **Data over conditionals.** Adding an appointment type, a payment method, a
   capability or a refusal code is an edit to one table.
3. **Injection at the volatile boundary.** `syncCentralSubscription({ config,
   clinicId, email, origin, storage, fetchImpl, now })` knows nothing about
   Supabase, the browser clock or the platform's fetch.
4. **The tests assert behaviour, against the real modules.** They import
   `license.mjs`, `visit-flow.mjs`, `schedule.mjs` and assert outcomes.
5. **Design properties are mechanically enforced** by `check:contributing`: every
   pure module must be exercised by a test, listeners and intervals must balance,
   no `console.log`, no blocking I/O in the bundle, routes lazy, no dependency
   outside the reviewed safe-list.
6. **A small dependency surface** — 8 runtime, 3 dev packages. In a clinical app
   every dependency is both a licence obligation and a supply-chain risk.

### 2.2 Where it is not

**`store.jsx` is the god object.** 1,030 lines owning Supabase access, the offline
cache, demo mode, the write queue, conflict resolution, invites, licensing, seat
usage, drug-directory search, Central sync *and* the context value. It spreads the
whole dataset into context, so Interface Segregation cannot be enforced: the
published interface is "everything".

**The plan vocabulary *was* the clearest Open/Closed failure — fixed in v1.27.0.**
It used to live in eight files, so a fourth plan was a nine-file edit (eight JS
files plus three places in `schema.sql`), and a missed file showed as a price on one
screen disagreeing with the cap on the next. `src/lib/plans.mjs` now owns it, a test
fails if a quoted plan id appears anywhere else in `src/`, and every consumer uses
`planId()` / `planLabel()` / `planLimits()` / `planPrice()` instead of a ternary.

```bash
$ grep -rn "'solo'\|'growth'\|'chain'" src | grep -v plans.mjs | wc -l   # 0 (was 8 files)
```

The remaining Open/Closed gap is the **JS ↔ SQL** one below, which step 2 closes.

**Every business rule exists twice, once in JS and once in SQL — deliberately, and
as of v1.28.0 with a test holding the two copies together** (§3 step 2).
Seat caps (`PLAN_LIMITS` vs the `case p_plan` ladder, `schema.sql:746`), the write
gate (`canWrite` vs `can_write`), status vocabularies (`licenseState` vs
`check (status in (...))`, `schema.sql:765`). This is the right architecture — the
server must not trust the browser, and the UI must not offer what the server will
refuse — but **nothing tests the two sides together**, so drift is silent. That is
the highest-value gap in the design.

**`logic.mjs` *was* the "utils" gravity well — fixed in v1.29.0.** 852 lines and 88
exports, cohesive by language rather than responsibility. It is now twelve modules
(`money`, `dates`, `text`, `ids`, `appointments`, `invoicing`, `patients`, `queue`,
`reporting`, `validation`, `constants`, `csv`) behind a 26-line barrel, with tests
that keep the barrel complete and stop any part growing back past 200 lines.

**The LSP wobble.** An unknown plan silently becomes Growth in the UI while the
database would refuse it: the mirror is more permissive than the authority.

### 2.3 The DIP lesson worth remembering

v1.25.1 fixed a client that never called Central. The cause was not a missing
feature but an **unfinished inversion**: `fetch` was injected, nothing at the
composition root supplied one, and the suite always injected a fake — so a missing
default surfaced as "network unavailable" and 508 tests stayed green.

> Injection without a default, and without a test through the real boundary, is an
> incompleteness — not a virtue.

The fix: the platform fetch is the default, and six tests go through
`globalThis.fetch` on purpose, so the wiring is exercised rather than simulated.
The same test applies to every future injection point (see §3, step 2).

---

## 3. The remediation plan, lowest risk first

Ordered by **effort and blast radius**, not by severity — none of the five is
currently producing a bug; all five are producing change cost. One step per
release, each shippable on its own, each reversible with `git revert`.

Standing rules for every step: **no new dependency, no public API change, no
behaviour change, no test deleted**, version bumped in lockstep
(`package.json`, `src/lib/version.js`, `CHANGELOG.md`), shipped as a git bundle,
and every gate green (`npm test`, `build`, `check:pages`, `check:contributing`,
`test:security`).

### Step 1 — `src/lib/plans.mjs`: one source for the plan vocabulary  · *lowest risk* · **DONE v1.27.0**

> **Result.** `plans.mjs` owns the ids, caps, prices, labels, blurbs, seat lines,
> the catalogue and the Central tier map; nine files consume it; `license.mjs`,
> `logic.mjs` and `central-sync.mjs` re-export their old names so no call site
> moved. Acceptance met: **zero** quoted plan ids outside `plans.mjs` (8 files
> before), enforced by `tests/plans.test.mjs`. One copy change, disclosed: the seat
> message now reads "1 doctor seat / 5 doctor seats". 538 tests, build green.



**Problem.** `'solo' | 'growth' | 'chain'` appears in 8 JS files; caps, prices,
labels and blurbs are each defined somewhere different.

**Do.** Create `plans.mjs` exporting `PLAN_IDS`, `PLAN_LIMITS`, `PLAN_PRICE`,
`PLAN_LABEL`, `PLAN_BLURB`, `planOrder()`. Every other module imports from it;
`license.mjs` keeps its function signatures and re-exports for compatibility.

**Acceptance.** `grep -rl "'solo'" src | wc -l` → **1**. `PLAN_LIMITS` still equals
the SQL ladder by eye-check plus step 2's test. Diff touches imports only.

**Risk.** Low — a data move with no logic change; `npm test` covers pricing and
seat math already. **Rollback:** revert the commit; no data or schema involved.

### Step 2 — a test that holds the JS mirror against the SQL authority  · *low risk, highest value* · **DONE v1.28.0**

> **Result.** `tests/schema-parity.test.mjs` compares `plan_seat_limit()`,
> `plan_price_paise()`, both plan-id constraints, the column default and the licence
> status vocabulary against the client, by reading `schema.sql` as text. It found a
> **10× yearly-price error** in `plan_price_paise()` on its first run (₹95,904 where
> the mirror says ₹9,590.40 for Solo) — uncalled, so never billed, but wrong. The
> constants are corrected, and a mutation test proves the suite fails when the two
> sides disagree.



**Problem.** The client mirror and the database can drift without a single test
failing (see §2.2). There is no database in CI, but the *rules* are readable text.

**Do.** Add `tests/schema-parity.test.mjs`: parse `supabase/schema.sql` for
`case p_plan when '<id>' then … <n>` and the `check (status in (...))` lists, and
assert they match `PLAN_LIMITS` and the client status lists. Same for the plan ids
in the two `default 'growth' check (plan in (...))` columns.

**Acceptance.** Adding a plan to `plans.mjs` without touching `schema.sql` (or the
reverse) **fails** the test with the offending plan named. No network, no
database, no new dependency — pure file parsing, like `deploy-config.test.mjs`.

**Risk.** Low, and it retires the biggest architectural gap. **Rollback:** delete
the test file.

### Step 3 — split `logic.mjs` behind a barrel  · *low risk* · **DONE v1.29.0**

> **Result.** Twelve modules (largest 126 lines) behind a 26-line barrel; every one
> of the 88 names is re-exported and a test asserts the re-export is the identical
> object. No call site and no existing test changed — the one repointed test read
> `logic.mjs` for `canSeeConsultations`, which now lives in `reporting.mjs`. Seven
> new tests also forbid a part importing the barrel, cap a part at 200 lines and the
> barrel at 60, so the file cannot grow back. 552 tests, build green.



**Problem.** 88 exports and 852 lines, cohesive by language rather than purpose;
unrelated edits collide.

**Do.** Move into `money.mjs` (paise, format, words), `dates.mjs` (`today`,
`addDays`, `formatDate`, `shiftMonth`, `financialYear`), `invoicing.mjs`
(`computeLine`, `computeInvoice`, `invoiceStatus`, `invoiceBalance`,
`nextRxNumber`), `patients.mjs` (`patientSearch`, `patientVisits`,
`followUpDue`), `queue-utils.mjs` (`queueBoard`, `queueState`, `tokenLabel`,
`averageWait`). **`logic.mjs` becomes a re-export barrel**, so no call site changes
and no test changes.

**Acceptance.** Every existing import path still resolves; 529 tests unchanged and
green; `logic.mjs` under 60 lines (barrel only); `check:contributing`'s
"every pure module is exercised" check still passes for each new module (each gets
a test import, or the split follows the existing test files).

**Risk.** Low. **Rollback:** revert; the barrel means nothing outside moved.

### Step 4 — split `Settings.jsx` (969 lines, 8 tabs) into tab components  · *medium risk*  · **DONE v1.30.0**

**Do.** `pages/settings/ClinicTab.jsx`, `BrandingTab.jsx`, `BillingTab.jsx`,
`AccountTab.jsx`, `AppearanceTab.jsx`, `SyncTab.jsx`, `PlanDataTab.jsx`,
`AboutTab.jsx`, with `Settings.jsx` reduced to the tab list, the shared form state
and the save actions. Keep the same tab ids (they are not in the URL today, so no
deep links break).

**Acceptance.** No tab's markup is left on the page; every tab renders identically
at 375 px and 1440 px; no prop drilled more than one level; behaviour unchanged by
inspection of the diff (moves, not edits).

**As shipped (v1.30.0).** Eight components in `src/components/settings/` (62–198
lines each) hold the markup verbatim; `Settings.jsx` is 275 lines. The plan asked
for under 200, which counted the tab list and the form state but not the save
actions the same paragraph keeps on the page — `saveClinic` and `saveProfile` are
110 of those 275 lines. Moving them into `useSettingsActions()` is the remaining
opportunity, deliberately left as its own change. Ten tabs turned out to be eight:
the tab list has held eight ids since 1.26. Identical rendering was proved by
normalising the extracted markup against the v1.29.0 blocks (byte-for-byte) and by
server-rendering the whole page on both sides (same 2,151 characters); 375 px
behaviour follows from identical markup and class names, since no panel sets a
width of its own. `tests/settings-tabs.test.mjs` holds the result — page under 300
lines, panels under 200, owner-only tabs still inside `canEdit`.

**Risk.** Medium — the largest visual surface in the app, and CSS classes are
global. **Rollback:** revert; no data involved.

### Step 5 — `store.jsx`: split by capability, then segregate the context  · *highest risk, do last*

Staged, and each stage ships on its own:

1. **Extract the write queue and offline cache** into `sync-engine.mjs` (the logic
   already lives largely in `offline.js`; the store keeps only the wiring). The
   public store API does not change.
2. **Extract the licensing adapter** into `license-source.js` — one place that
   turns a Central answer or a cached lease into `license` + `licenseSeats`.
3. **Extract the Central adapter** (already mostly `central-sync.mjs`) so the store
   only calls it.
4. **Split the context**: `DataContext` (tables), `ActionsContext` (stable
   callbacks), and selector hooks (`usePatients()`, `useInvoices()`, `useLicense()`)
   so a screen receives only what it needs — the first real enforcement of ISP in
   this codebase.

**Acceptance.** `store.jsx` under 400 lines after stages 1–3; after stage 4 no page
imports `useStore()` directly for read-only data; every one of the 32 call sites
migrated in a single release with no behaviour change; 529 tests green throughout.

**Risk.** High — this is the seam every screen touches. Mitigation: the four
stages are separate releases, each with the suite green, and stage 4 is mechanical
(find-and-replace of a read hook per table) so the diff is reviewable. **Rollback:**
revert the stage; the public API is unchanged until stage 4 ships.

### Sequencing

| Release | Step | Why this order |
| --- | --- | --- |
| v1.27.0 | 1 — `plans.mjs` | pure data move, unblocks step 2 |
| v1.28.0 | 2 — schema-parity test | retires the only silent-drift risk |
| v1.29.0 | 3 — `logic.mjs` barrel split | no call-site changes |
| v1.30.0 · **DONE** | 4 — Settings tabs | visual surface, needed a careful 375 px pass |
| v1.31.0+ | 5 — store, four sub-releases | touches every screen; do it with the least other work in flight |

Nothing in this plan changes the database, the RPC contract, the sealed lease, the
licence model or any screen's behaviour. If a step starts needing a behaviour
change to be worth doing, it is out of scope — stop and re-plan.

---

## 4. Rules that must survive the refactor

1. **The database is the authority.** No rule may move into the client because it is
   convenient; the client mirrors, the server decides.
2. **No new dependency** without the safe-list and `THIRD_PARTY_NOTICES.md` updated.
3. **Domain code stays pure.** No `lib/*.mjs` may import React, the store, or a
   component — the arrow points down only.
4. **Every injected dependency needs a default and a test through the real
   boundary** (§2.3).
5. **No rule twice without a test holding the two copies together** (§3 step 2).
6. **Clinical safety is not refactorable**: the prescription safety checks, the dose
   pattern parser, the read-only gate and the seal are behaviour-frozen by tests. A
   move may change where code lives, never what it decides.

---

## 5. How to re-measure

```bash
# shape
grep -rn "extends " src --include=*.js* | wc -l                       # classes: expect 1
grep -rl "useStore" src | wc -l                                       # ISP: expect 32 → lower
wc -l src/lib/store.jsx src/pages/Settings.jsx src/lib/logic.mjs     # SRP hotspots (logic is a 26-line barrel since 1.29.0)
wc -l src/components/settings/*.jsx                                  # the eight tab panels (v1.30.0)
grep -rn "switch (" src | wc -l                                       # OCP: expect 2

# coupling of the plan vocabulary (step 1)
grep -rn "'solo'\|'growth'\|'chain'" src | grep -v plans.mjs | wc -l  # expect 0 (since 1.27.0)

# the mirror vs the authority (step 2)
grep -n "case p_plan" -A 4 supabase/schema.sql | head
grep -n "PLAN_LIMITS" -A 4 src/lib/license.mjs

# layers
grep -rn "^import .*components/" src/lib || echo "no upward imports"
```
