/**
 * Version management.
 *
 * Three numbers that must not be confused:
 *   app    — the product version shown to users (major.minor.patch)
 *   schema — the Supabase migration this build expects (drives upgrade prompts)
 *   build  — injected at build time (commit + timestamp) for support
 */

export const APP_VERSION = '1.42.0';
export const SCHEMA_VERSION = 21;

/** Injected by vite.config.js define(). */
export const BUILD = (() => {
  try {
    return typeof __MYCLINIC_BUILD__ !== 'undefined' ? __MYCLINIC_BUILD__ : { id: 'dev', at: null };
  } catch {
    return { id: 'dev', at: null };
  }
})();

/** What changed, newest first. Kept as the in-app version history; the
 *  Settings → What's new card was hidden in v1.35.5 at the clinic's request. */
export const CHANGELOG = [
  {
    version: '1.42.0', date: '2026-11-10', schema: 21,
    highlights: [
      '**Item 9 is complete.** The second confirmed branch release turns schema 20 into a working branch workspace. A new pure `src/lib/branch-scope.mjs` owns the view rule: an owner sees **All branches** or one branch, while a doctor or front-desk seat is always resolved to its single assignment.',
      '**One switcher, one answer.** `BranchSwitcher` sits in the sidebar (and the mobile drawer that shares it) and the desktop topbar. A front desk gets a static branch label and no switcher. `All branches` keeps one real `activeBranchId` for new rows, so a combined view never writes an `all` branch.',
      '**Lists, reports and day close follow the view.** The provider filters appointments, consultations, invoices and day closes in one place. Day close is deliberately scoped to the real cash-drawer branch even when an owner views all branches; reports and billing name the branch being shown.',
      '**Seat meters and invitations are real.** `seatUsageCounts()` counts active `branches` rows instead of hard-coding one. Invite staff now carries `branch_id`; `accept_invite()` retires the implicit Main assignment and starts an invited seat on the chosen branch.',
      '**Schema 21 is additive.** `day_closes.branch_id`, `invites.branch_id` and `profiles.branch_scope` join the tables; day-close uniqueness becomes clinic + branch + day, policies call `can_access_branch()`, and `set_branch_scope()` / a five-argument `invite_staff()` join the RPCs. The top-level legacy `accept_invite()` is guarded so a re-run cannot restore the old body. `create_clinic()` keeps its signature; no table, column or clinical row is dropped.',
      'Plan-first item 9 (§9), release 2 of 2. 5 branch-view tests, 1 schema ratchet and 4 new wiring ratchets: **729 tests / 43 files**, 17 rolled-back PostgreSQL suites, all gates green. Lib census 55 modules (22 import nothing); clean clone verified.',
    ],
  },
  {
    version: '1.41.0', date: '2026-11-10', schema: 20,
    highlights: [
      '**Branch Configuration is real now.** Item 9 of `docs/PLAN-v1.33.md` (§9) begins with schema 20: a child `branches` table under one clinic, a `staff_branches` assignment table, and `branch_id` on appointments / consultations / invoices. Patients stay shared; visits and bills are tagged by branch. Drug directory and subscription stay shared.',
      '**Owners get several branches; everyone else gets one.** A new pure `src/lib/branch-config.mjs` owns the assignment rule. `set_staff_branches()` enforces it in Postgres, and the Doctors & staff roster plus the new **Settings → Branches** tab read the same assignment table.',
      '**Owners see all branches; front desk sees only its own.** `user_branch_ids()` and `can_access_branch()` add branch scoping to the existing role matrix. A front-desk seat cannot read another branch’s appointments or invoices, and a null `branch_id` on a pre-schema-20 row stays readable.',
      '**No RPC signature changed.** A `tag_branch()` insert trigger fills `branch_id` from `current_branch_id()`, so `issue_token()`, public booking and every existing write keep working. `create_clinic()` keeps its signature: an after-insert trigger creates **Main branch** and assigns the owner.',
      '**Schema 20 is additive and idempotent.** Existing clinics are backfilled with **Main branch**, every active staff row gets an assignment, and old visits/invoices are tagged. `SCHEMA_VERSION` is 20; paste `supabase/schema.sql` once in the Supabase SQL editor. v1.42.0 adds the sidebar switcher and branch-scoped list queries.',
      'Plan-first item 9 (§9). 11 pure branch-rule tests, 4 store/UI wiring ratchets, 15 schema ratchets and a real PostgreSQL 17 suite M: **720 tests / 42 suites**, all gates green and a clean clone verified. The lib census is 54 modules (22 import nothing); `create_clinic()` keeps its two-argument signature.',
    ],
  },
  {
    version: '1.35.6', date: '2026-11-02', schema: 19,
    highlights: [
      '**One plan, one answer.** A clinic on a Central Multi-clinic licence with a stale `clinics.plan` row used to read **Growth plan / Main branch** on Doctors & staff while Subscription read **Plan Multi-clinic** and a raw Central tier. Team, Plan & data, Subscription and the sidebar now all use one effective plan: the Central verdict (its tier already translated by `planForTier()`), then the licence plan, with `clinics.plan` only as a last-resort display fallback.',
      '**Branch and seats follow that same plan.** A new pure `src/lib/current-plan.mjs` normalises the answer through `planId()`; `src/lib/staff-branch.mjs` and `PLAN_LIMITS` then give Multi-clinic **Branches enabled**, **Multi-clinic · branch-capable** and unlimited seats instead of Growth / **Main branch**. No quoted plan id lives outside `src/lib/plans.mjs`.',
      '**Subscription speaks in human names.** The plan card and CSV export use `planLabel()` / `centralPlanLabel()`; **Central plan: Multi-clinic** replaces a raw tier id. The billing interval also comes from one helper, `currentInterval()`, rather than a second inline rule.',
      '**Plan & data no longer edits a legacy column.** Its **Change plan** dialog now calls `store.changePlan()` (the real subscription RPC) and preserves the licence interval. When Central owns the plan, it shows **Issued by Central**, hides the local catalogue price and offers no local switch.',
      'Plan-first item 15 (§15). 17 new pure tests in `tests/current-plan.test.mjs`, settings and subscription ratchets updated: **703 tests / 41 suites**, all gates green. `clinics.plan` stays in the database as a legacy fallback; no schema, RPC, store, seed or `SCHEMA_VERSION` change; lib census 53 modules (22 import nothing).',
    ],
  },
  {
    version: '1.35.5', date: '2026-11-02', schema: 19,
    highlights: [
      '**About & version is one line now.** The tab shows only `App version v1.35.5` — the Schema `v19` tile, Build number, **Recent problems**, **What’s new / Release notes for this workspace**, the **Your access** matrix and the two version buttons are gone. Diagnostics still exist in `ErrorBoundary` and the scripts; permissions are still enforced in Postgres.',
      '**Plan & data is quieter.** The footer `myClinic v1.0 · connected · 4 patients · 6 consultations` line is removed. The plan card, seat meters, CSV exports and demo reset are unchanged.',
      '**Doctors & staff has a plan-aware Branch badge.** A new pure `src/lib/staff-branch.mjs` reads the licensed branch cap: Solo / Growth show **Main branch**, Multi-clinic shows a branch name already on the row or **Multi-clinic · branch-capable**. The header now says Solo / Growth / Multi-clinic instead of a raw plan id. This is a **label, not item 9** — no branches table, `staff.branch_id`, RPC or store field; real multi-branch data still needs the three decisions in `docs/PLAN-v1.33.md` §9.',
      '**One way out on mobile.** The drawer no longer repeats **Sign out** beside the account row’s icon, and no longer offers **Issue token / New appointment / Register patient**. The mobile header and command palette keep their shortcuts. A mobile CSS fix also stops the black area below a scrolled page: the document grows with its content, `html` is painted with `var(--bg)`, and the body tint scrolls instead of staying fixed.',
      'Plan-first item 14 (§14). 8 pure tests for the branch rules, 3 CSS/mobile ratchets, 3 new Settings ratchets and the sidebar tests updated for the single sign-out: **686 tests / 41 suites**, all gates green. No schema, RPC, store, seed or `SCHEMA_VERSION` change; lib census 52 modules (22 import nothing).',
    ],
  },
  {
    version: '1.35.4', date: '2026-11-02', schema: 19,
    highlights: [
      '**One token per patient per day.** Issuing a token used to insert a row unconditionally, so the same patient could hold T-03 at 09:15 and T-08 at 11:40 — two names on the display and two possible bills. **Issue a token** now checks the patient against the day and refuses with the number they already have. The check runs again from the freshest store at the moment of the click, so a stale board or a double click cannot write a second number.',
      '**A refused token is not a dead end.** The desk gets an inline explanation with the existing number and its state, plus **Use T-xx** (print / WhatsApp / bill that same token), **Mark arrived** and **Arrived late**. Cancelled numbers do not burn the day; if duplicates already exist from before, the desk is told how many and which is the earliest.',
      '**No show, not arrived and arrived later are now real states.** A token marked No show used to vanish from the queue entirely — which is exactly why the desk issued another one when the patient turned up. No-show tokens stay visible in a **No show / arrived later** strip and in the token table, and **Arrived late** puts the *same* number back in the queue. Not-arrived tokens can be marked Arrived or No show, and an arrival past its slot is labelled late automatically. The queue header counts all three.',
      'All rules live in the tested pure module `src/lib/token-policy.mjs`; “arrived late” is a small note marker, not a new status, so the six-value status check in the schema is untouched. 12 new tests and a 37-check SSR smoke render the real duplicate refusal and the real queue. The guard is a client-side fresh-store check, not a database constraint — a strict multi-client race would need a server-side unique index. No schema, RPC, store, seed or `SCHEMA_VERSION` change.',
    ],
  },
  {
    version: '1.35.3', date: '2026-11-02', schema: 19,
    highlights: [
      '**The token can now be sent on WhatsApp the moment it is issued.** The “Token issued” screen had Done, Print slip and Next patient — but no way to send the number while the patient was still standing at the desk, even though the consent-aware composer and the token message already existed elsewhere. It now offers **Send on WhatsApp**, **Print slip** and **Download slip image**.',
      '**The token print slip is redesigned.** The old **Print slip** called the browser print on the whole app: `.slip` was a CSS class that no element used. The new counter slip carries the clinic name and brand colour, a large token number, patient, doctor, visit, date and time, fee, queue position and what to do next. Printing now puts **only the slip** on an 80 mm page.',
      '**The same slip goes with the WhatsApp message as an image.** A `wa.me` link can carry text but not an attachment, so **Share image + message** hands the slip PNG and the exact message text to the phone’s share sheet together; on a desktop, **Download slip PNG** gives you the image to attach in WhatsApp Web. The message says the slip is attached, and every send is still logged. A patient who opted out of WhatsApp is still refused with a reason.',
      'One self-contained SVG in `src/lib/token-slip.mjs` drives the preview, the printed sheet and the PNG through a data-URI image — with every patient name XML-escaped, so a name cannot inject markup. 14 new tests and a 41-check SSR smoke render the real issued state, the composer with the slip, the desktop fallback and the opt-out refusal. No schema, RPC, store or seed change.',
    ],
  },
  {
    version: '1.35.2', date: '2026-11-02', schema: 19,
    highlights: [
      '**Patient records now has a date filter.** The register had two fixed date rules — “New this month” and “Not seen recently” — but no way to choose a date, so a desk wanting everyone registered in the first week of November had to export the whole register and sort the CSV by hand. A compact bar under the tabs adds a **From** / **To** range, quick ranges (Today, Last 7 days, This month, Last 30 days, Last 90 days) and a **Clear** button.',
      '**Both dates are selectable.** The request did not say which date, so the field picker offers **Registered** (the default — the same date the “New this month” tab reads) and **Last seen** (the permission-aware last visit, which already falls back to completed appointments when the front desk cannot read consultations). Switching the field switches the result.',
      'The filtered set is the list: it feeds search, the **All** tab count, the on-screen “N patients” head and **Export**, so the CSV contains exactly what the desk sees. An `aria-live` line states the active field, range and match count; a reversed range shows an inline error and keeps every row instead of an empty register. A range can also be linked to with `?from=…&to=…&dateField=…`.',
      'All rules live in `src/lib/patient-dates.mjs` (10 tests); an SSR smoke renders the unfiltered register, a real date-filtered view, the Last seen field, a reversed range and a malformed link. No schema, RPC, store or seed change.',
    ],
  },
  {
    version: '1.35.1', date: '2026-11-02', schema: 19,
    highlights: [
      '**Each person in the room now has their own Consult and Done.** v1.35.0 put one shared **Consult** (which only opened the first patient) and a row of **Done** buttons at the bottom of the card. Both seats now carry their own token, name, wait and status badge together with their own **Consult** and **Done**, and every button acts on that patient alone — the Talking token and the Waiting in room token alike.',
      'With two people in the room the buttons name their token — **Consult T-09 / Done T-09** beside **Consult T-10 / Done T-10** — so two identical buttons can never be confused. The labels come from `roomSeats()` in `src/lib/queue.mjs`, not from an inline rule in the page. With one person the labels stay plain **Consult / Done** as before.',
      'No change to the room limit, the board shape, the schema or any other screen. 2 new tests and 9 new server-render checks pin the per-seat buttons.',
    ],
  },
  {
    version: '1.35.0', date: '2026-11-02', schema: 19,
    highlights: [
      '**The consulting room holds two people, and now shows both.** `queueBoard()` returned a single `serving` per doctor while “Call next” unconditionally flipped a second token to `in-consult` — the data could hold two patients and every screen showed only one. The board now reports `inRoom` (every token, in order), `roomCount`, `roomLimit` and `roomSeats()`. The first token, T-09, is drawn large with a **Talking** badge; the second, T-10, sits beneath it in small type as **Waiting in room**; a `2 / 2` badge sits in the card header.',
      '**A third call is refused in words, not silently.** One constant, `ROOM_LIMIT = 2`, gates every call-in control — the room card, “Up next” and each row of the token table — against a board recomputed from the store at the moment of the click, so a stale tab or a fast double click cannot make three. “Call next” is disabled with an inline reason, and a toast names the two people already in the room.',
      '**The lounge and the dashboard agree with the desk.** The waiting-room display lists both tokens and says **Please wait** rather than **Please proceed** when the room is full; the dashboard’s “N in the room” counts people rather than doctors and its token strip lists both numbers. Completing either consultation frees a seat.',
      'Backwards compatible: `serving` is still `inRoom[0]`, so every older reader keeps working. 12 new tests plus a server-render smoke that checks T-09 is large and T-10 is small. No schema change.',
    ],
  },
  {
    version: '1.34.0', date: '2026-11-02', schema: 19,
    highlights: [
      '**The two phone numbers on the set-up screen were one field.** Step 1’s “clinic phone” and step 2’s “doctor’s phone” both bound `form.phone`, so typing the doctor’s mobile rewrote the clinic’s contact number, and the clinic row was created with whichever was typed last. They are separate values now, judged by separate rules: the clinic may be a landline the front desk answers, the doctor must be a mobile a reminder can reach.',
      '**The hours were collected and thrown away.** The screen asked for the opening and closing time, the follow-up window and the doctor’s registration number, sent them to `create_clinic()`, and the function inserted none of them: a clinic set up as 10:00–19:00 with Sunday closed was created at 09:00–20:00, open every day, follow-up 15 days. Schema 19 writes what the screen collects — sessions, days off, GSTIN, the follow-up window and the doctor’s own row — each range-checked against the column, defaulted when absent, so a client from before this release creates exactly the clinic it created yesterday.',
      '**An unreadable fee silently became ₹500.** `moneyToPaise` was wrapped in a `try` that kept the default on failure. Every fee is now read before the step can advance, with the error on the field: “Enter the fee in rupees, like 500 or 250.50”.',
      'Three steps became four — a review of what is about to be created, with an edit link back to each step — every rule moved into `src/lib/onboarding.mjs` (22 tests), and the half-filled form is kept in `localStorage` so a reload on a phone in a queue no longer costs the address and the fees that were just typed.',
    ],
  },
  {
    version: '1.33.0', date: '2026-11-02', schema: 18,
    highlights: [
      '**The sidebar scrolls on a short screen.** On a 1280×720 laptop the links plus the plan card were taller than the window, and nothing could scroll: `.sidebar` was a 100dvh flex column with no overflow, and a flex child only shrinks if it is told it may. The last links and the account row were simply unreachable. The *links* are now the scroll region — with the `min-height: 0` that makes shrinking possible — while the brand, the plan card and the account row stay pinned. Quiet scrollbar, a stable gutter so labels do not shift, and `overscroll-behavior: contain` so scrolling the menu never scrolls the page behind it.',
      '**A sign-out button where people actually work.** Signing out existed only in Settings → My account and in the mobile drawer; a shared front-desk machine had no way out from the sidebar. The account row now has one, next to the name: same call as Settings makes, absent in a demo workspace (no session to end), disabled while it runs, with an accessible name and a double-click guard.',
      'A plan for the eight remaining requests — the follow-ups recall bug, empty drug lines, two patients in the room, payments recorded once, owner-only invoice cancellation, patient registration and branches — is committed as `docs/PLAN-v1.33.md`, one release per item, lowest risk first, with the diagnosis and the acceptance test for each. 600 tests.',
    ],
  },
  {
    version: '1.32.0', date: '2026-11-02', schema: 18,
    highlights: [
      '**The licence composition left the provider.** `license.mjs` already decided what a subscription means — `licenseState`, `canWrite`, `seatUsage`, `billingPeriod`, `extendPeriod` are pure and tested on their own. What sat inside `StoreProvider` was the composition: that Central\'s answer outranks the clinic\'s own row, that a demo workspace is exempt from "Central owns the plan", that a branch is one seat, and the exact subscription row a demo click writes. That is now `src/lib/licensing-adapter.js` — injected, clocked, with no React and no Supabase.',
      'Three rules that were restated in several places are now each stated once: `resolveLicense()` (Central\'s silence reads as read-only, never as free), `assertPlanIsLocal()` (the same refusal, in Central\'s own words, from the same constant) and `writeGate()` — which returns *two* facts because there have always been two: what a screen shows and what the write path enforces. They differ in exactly one place, a demo workspace whose sandbox trial has lapsed, and that divergence is now written down instead of being implicit in two expressions.',
      'The demo arithmetic is named and testable: `demoPlanChange`, `demoRenewal` (a payment buys the plan\'s own term — twelve months on a yearly plan, never the hard-coded 30 days that once made a yearly clinic look broken) and `demoTrial`. `store.jsx` is 981 lines, from 1,031 at the start of step 5. 594 tests.',
    ],
  },
  {
    version: '1.31.0', date: '2026-11-02', schema: 18,
    highlights: [
      '**The outbox flush loop left the provider.** `offline.js` already owned the queue itself — the keys, the TTL, the backoff, the pure `replayOutbox` — but the three things that touch React and Supabase were written inline inside `StoreProvider`, where no test could reach them: the concrete database adapter, the decision of whether a tick should flush at all, and what the sync pill says afterwards. They are now `src/lib/offline-queue.js`, and the adapter takes the client as an argument instead of importing it.',
      'The cache mirrors went the same way. Reading and writing the demo snapshot, choosing between the demo key and the per-clinic cache, and folding a server row into a list the client already shows are now pure functions in `src/lib/offline-cache.js` that take the storage — so a phone in private mode and a full quota are two assertions instead of two assumptions. The demo key is named in exactly one place.',
      'A regression the build cannot see was caught by a provider smoke and fixed before release: the adapter was being built in a `useMemo`, and a demo workspace has no Supabase client at all, so the first render of the demo build threw. It is now built only when a client exists, and a test holds that. `store.jsx` is 999 lines, from 1,031. 579 tests.',
    ],
  },
  {
    version: '1.30.0', date: '2026-11-02', schema: 18,
    highlights: [
      '**`Settings.jsx` went from 969 lines to 275.** Eight `{activeTab === …}` blocks were interleaved with the page state, both save handlers and three modals, so an invoice-footer change and a sync-card change touched the same file. Each tab now has its own component in `src/components/settings/` — clinic, branding, billing, account, appearance, sync, about, plan (62–198 lines each) — and the page keeps the tab list, the shared form state and the save actions.',
      'Moves, not edits: every panel is the original markup verbatim, and it was proved rather than asserted — the extracted blocks compare byte-for-byte with v1.29.0 once whitespace is normalised, and server-rendering the whole page before and after produces the same 2,151 characters of text. Nothing a clinic sees, at any width, changes.',
      'Eight new tests hold the split: every tab id has a panel and no panel exists without a tab, the tab order and the `clinic` default are unchanged, the four owner-only tabs still sit inside `canEdit`, no panel imports the page back or writes to the database apart from the plan switch it always made, `MiniStat` has one definition, and the page may not grow back past 300 lines. 560 tests.',
    ],
  },
  {
    version: '1.29.0', date: '2026-11-09', schema: 18,
    highlights: [
      '**`logic.mjs` went from 852 lines and 88 exports to a 26-line barrel.** It held money, dates, tokens, invoices, patients, the queue, reporting, validation, CSV and the clinic defaults — cohesive by language rather than by responsibility, so a date fix and an invoice fix sat in the same file. It is now twelve focused modules: `money`, `dates`, `text`, `ids`, `appointments`, `invoicing`, `patients`, `queue`, `reporting`, `validation`, `constants`, `csv` (largest 126 lines).',
      'The move is invisible by design: `logic.mjs` re-exports every name from the same module, so no call site and no existing test changed, and a test asserts each re-export is the **identical object** rather than a copy. A second test keeps the split honest — no part may import the barrel, the modules must stay in one dependency direction, and any part that grows past 200 lines fails the suite.',
      'Seven new tests. 552 tests.',
    ],
  },
  {
    version: '1.28.0', date: '2026-11-09', schema: 18,
    highlights: [
      '**The client mirror is now pinned to the SQL authority.** Every business rule in this app exists twice on purpose — once in Postgres, which decides, and once in `src/lib`, so the UI never offers what the server will reject. Seat caps, prices, plan ids and licence statuses were duplicated with **nothing testing the pair**, so drift was silent. `tests/schema-parity.test.mjs` parses `supabase/schema.sql` and compares it with the client: a cap, a price, a plan id or a status changed on one side only now fails the suite and names the offender.',
      'It found drift on its first run: `plan_price_paise()` quoted the yearly price at **ten times** the monthly-derived figure — ₹95,904 for Solo where the mirror said ₹9,590.40. Nothing called that function, so no invoice was ever wrong, which is exactly why nobody noticed; the constants are corrected and the authority now agrees with the mirror it is supposed to be mirrored by.',
      'Seven new tests, no network and no database: the file is read as text, the same technique as `function-imports.test.mjs`. Proved to bite by mutation — changing Growth from 5 doctors to 6 in SQL fails the suite with “PLAN_LIMITS in src/lib/plans.mjs has drifted from plan_seat_limit() in schema.sql”. 545 tests.',
    ],
  },
  {
    version: '1.27.0', date: '2026-11-09', schema: 18,
    highlights: [
      '**The plan vocabulary has one home.** The three plan ids were written down in eight files — caps and prices in `license.mjs`, the catalogue in `logic.mjs`, the tier map in `central-sync.mjs`, two fallbacks in `store.jsx`, and four screens each re-deriving labels and seat caps with their own nested ternary. Adding a plan was a nine-file edit, and a missed file showed up as a price on one screen disagreeing with the cap on the next. `src/lib/plans.mjs` now holds the ids, caps, prices, labels, blurbs, seat lines, the catalogue and the Central tier map; everything else imports it.',
      'The move is behaviour-preserving, with two named exceptions: a quoted plan id can no longer appear anywhere else in `src/` (a test fails if one does), and the seat message now reads “1 doctor seat / 5 doctor seats” instead of “1 doctors seat”. The database remains the authority for caps and prices; `plans.mjs` is its mirror, and step 2 of the architecture plan pins the two copies together.',
      'Nine new tests cover the vocabulary itself — order, defaults, normalisation, prices, the sales-led plan, tier translation — plus the re-exported names the old import paths rely on, so `license.mjs`, `logic.mjs` and `central-sync.mjs` keep their public surface. 538 tests.',
    ],
  },
  {
    version: '1.26.1', date: '2026-11-09', schema: 18,
    highlights: [
      '`docs/ARCHITECTURE.md` writes down what this codebase is: a functional core (30 modules under `src/lib`, 17 of which import nothing) behind a thin React shell, with Postgres as the authority and the client as its mirror. Every claim in it carries the command that measured it, so it can be re-measured instead of trusted.',
      'It also records where the design is weak, in public: `store.jsx` is 1,030 lines and publishes 30+ keys to 32 files, the plan vocabulary lives in 8 JS files plus `schema.sql`, and every business rule exists twice — once in JavaScript, once in SQL — with nothing testing the two copies together. Grades: DIP A−, OCP B−, SRP C+, ISP C.',
      'The refactor plan is ordered by effort and blast radius, not severity, one step per release: a single `plans.mjs` (v1.27.0), a schema-parity test that fails when the JS mirror and the SQL authority disagree (v1.28.0), `logic.mjs` split behind a re-export barrel (v1.29.0), `Settings.jsx` split into its eight tab components (v1.30.0), and `store.jsx` split by capability in four sub-releases (v1.31.0+). No step changes behaviour, the database, the RPC contract or the seal.',
    ],
  },
  {
    version: '1.26.0', date: '2026-11-09', schema: 18,
    highlights: [
      '**A visit now ends the same way from every screen.** Saving a consultation used to finish in five different places depending on where the doctor was standing: the dashboard said “billing is one tap away” while the invoice it had just raised was behind two menus, the queue and the appointments board closed in silence, and the consultation list jumped straight to the invoice and skipped the prescription slip. One sheet now opens on save — *Visit saved — what next?* — showing where the visit got to (Token → Consultation → Prescription → Invoice → Follow-up) and offering only what is still missing: collect the fee, print the slip, book the return visit.',
      'The five steps of a visit are data now (`src/lib/visit-flow.mjs`), not five copies of a callback: which step is done, which is next, and which actions may be offered. A visit is complete when the patient has a slip, a bill and a return date — not when the note was saved.',
      '**No more double billing from the queue.** “Bill” was offered on every completed token, so a second tap after “Save & bill” raised a duplicate invoice for the same visit. The button now reads “Collect ₹x” when the visit already has an unpaid bill, opens the payment sheet on that exact invoice, and only says “Bill” when nothing has been raised.',
      'The follow-up is one tap: the sheet books the return visit with the date the doctor wrote down (or the clinic default), the same doctor and a reason taken from the diagnosis.',
    ],
  },
  {
    version: '1.25.2', date: '2026-11-09', schema: 18,
    highlights: [
      '**The Cloudflare deploy never started.** `npm run build` succeeded, obfuscation and all, and then the deploy step died with `Error parsing file: /opt/buildhome/repo/vite.config.js`. With no wrangler config, `wrangler deploy` cannot tell what it is deploying, so it tries to *detect* the framework by bundling `vite.config.js` with esbuild — which follows Vite 8\'s rolldown graph into two optional peers this project deliberately does not install (`esbuild`, `@vitejs/devtools/config`) and reports the resolution failure as a parse error in a file that is perfectly valid. `wrangler.jsonc` now names the asset directory explicitly: static files only, no Worker script, nothing to detect.',
      'A `_headers` file ships in `public/`, so whichever static host you use (Workers, Pages, Netlify) serves `index.html` and `sw.js` with `no-cache` and hashed `assets/*` as `immutable`. A CDN-cached service worker pins the whole clinic to an old bundle for the cache lifetime — the deploy looks successful and the app behaves stale.',
      'Three tests read the deploy config from disk, so detection cannot come back by accident: `assets.directory` is `./dist`, there is no `main`, `not_found_handling` stays `none` (hash routing needs no SPA fallback, and one would answer 200 for a missing chunk), and `_headers` keeps the worker and the shell uncached. 517 tests.',
    ],
  },
  {
    version: '1.25.1', date: '2026-11-09', schema: 18,
    highlights: [
      '**The client never actually called Central.** The central subscription call takes `fetch` as an injected dependency so tests can run without a network — and no caller in the app ever passed one. Every browser threw `no fetch` before opening a socket, the catch around it reported that as “could not be reached”, and the central project has therefore received **zero** requests since the feature shipped. Both `syncCentralSubscription()` and `probeCentralReadiness()` now default to the platform’s own `fetch`; the injection point stays, for tests.',
      'A build that genuinely has no HTTP client now says exactly that: code `FETCH_UNAVAILABLE`, the sentence “this build cannot make HTTP requests”, and a red panel on the diagnostic card — never “offline”, never a grace lease. The outage branch is reachable only for a real transport failure (a `TypeError` from `fetch`, our own 8 s abort, a 5xx), and anything else thrown there reports itself as `CLIENT_ERROR`.',
      'Every refusal code the card can show now carries one explanatory sentence — `SUBSCRIPTION_NOT_FOUND`, `ORIGIN_MISMATCH`, `SEAT_LIMIT_REACHED`, `SUBSCRIPTION_PAUSED`, `SUBSCRIPTION_EXPIRED`, `RATE_LIMITED`, `INVALID_EMAIL`, `INVALID_ORIGIN`, `MISSING_IDENTITY`, `FETCH_UNAVAILABLE` — with Central’s own code and reason printed verbatim above it.',
      'Six regression tests go through `globalThis.fetch` instead of an injected fake, because a test that always injects one cannot see a missing one: one POST with the right URL, headers and body, a sealed cache entry on an allowed answer, the same for the probe, `FETCH_UNAVAILABLE` when no fetch exists anywhere, and the outage branch still working for a real `TypeError`. 514 tests.',
    ],
  },
  {
    version: '1.25.0', date: '2026-11-09', schema: 18,
    highlights: [
      'Settings → Subscription gains a **Central Auto-Sync** card that says what this build sends to the central subscription service and what came back: whether Auto-Sync is configured (and in what words it is not), the central host, live or demo mode, the owner email that will be sent **and which field produced it**, the origin, the device id, and the last answer with its `code`, `status`, match mode and `reason` verbatim. It exists because Central records nothing when it refuses — a paused row, a wrong pinned address and a build with no central project all look identical from the central dashboard.',
      '**Test Central connection** runs a zero-side-effect readiness probe (`p_email`/`p_origin` empty, a health-check device id) and reports the schema version it finds. It is labelled as what it is: proof that the project answers and the RPC exists — never proof that this clinic is licensed. It cannot be pressed more than once every ten seconds, because Central rate-limits per IP.',
      'The identity is now resolved by one exported function that also names its source — owner staff row, clinic email, billing email, or the signed-in user — so a dual-pinned mismatch can be fixed by pinning *that* address rather than guessing. Emails are masked on the card with a reveal toggle, and the readiness card never prints a key, the seal pepper or a seal.',
      'A refused sync keeps its code and reason all the way into the store’s state, so "the client called and was refused" is now distinguishable from "the client never called" on the client’s own screen. 508 tests.',
    ],
  },
  {
    version: '1.24.0', date: '2026-11-02', schema: 18,
    highlights: [
      'The Subscription screen now answers the three questions it is opened for, in one card: **Plan · Start date · End date**. The start date is the central project’s own — `started_at`, or `current_period_start` under its table name — carried from the RPC answer through the sealed lease into the licence the screen reads. When Central sends no start date the card shows `—`; it is never computed from the end date, because a guessed billing date is worse than a blank one. A trial is the single exception: its start is exactly its end minus fourteen days, which is how the trial is written.',
      'The separate “Managed centrally (Auto-Sync)” card is gone — its match mode, last-sync time, offline-grace date and warning banners now sit under the dates they belong to. The schema version no longer appears on this screen; the build number does, because support asks for it.',
      '**The licence authority is gone.** No licence key, no RSA pair, no “Check the licence now”, no `VITE_LICENSE_PUBLIC_KEY`, no `npm run check:key`. The RS256 client (`authority.mjs`, `authority-sync.mjs`), its store surface and its panel were deleted in this release; the keyless Central Auto-Sync path replaced them entirely. The database keeps schema 18’s `authority_*` columns and `apply_authority_license()` — dropping columns is a data-loss operation — and the refusal they raise still stops a bound clinic renewing itself, now worded as “managed centrally”.',
      'Nothing a clinic does changed and nothing is lost: reads and exports never stop, writes stop only when a plan lapses, and the subscription screen shows the same plan it did before. 498 tests pass.',
    ],
  },
  {
    version: '1.23.1', date: '2026-11-02', schema: 18,
    highlights: [
      'A sweep for code nobody reaches: 19 exported helpers and constants, 64 imported names, five local variables and four store values that nothing read (`signOutCleanup`, `acceptInvite`, `setLicenseStatus`, the raw central config) are gone. Nothing a clinic does changed — each removal was proved unreferenced first: one hit in the whole repo, the declaration itself.',
      'That sweep also found the leftovers of an older prescription sheet and an older day board in `styles.css`: 23 CSS classes no element carries any more. Their rules are deleted, so the stylesheet no longer carries a print header, a sparkline or a slot chip that cannot appear.',
      'Two real bugs surfaced while proving the surfaces were clean. The Consultations register computed a follow-up badge for every visit and never rendered it; it now renders nothing and computes nothing. And the store still imported `clearAllCache` after the sign-out path that used it was removed — the import is gone, and sign-out still clears the offline cache through `auth-context.jsx`.',
      'No schema change, no new secret, no deploy step: this release is the same app with less behind it. 542 tests still pass.',
    ],
  },
  {
    version: '1.23.0', date: '2026-11-02', schema: 18,
    highlights: [
      'The subscription can now be managed from the central project with **no licence key, no RSA key pair and no Edge Function**. The browser posts three non-secret facts — the owner’s email, this deployment’s origin and a per-browser device id — to one public RPC (`sync_clinic_subscription`) and the answer decides the plan, the seat limits and the expiry.',
      'That call is a plain `fetch`: no second Supabase client exists, so this clinic’s session token can never travel to another project. The only credential sent is the central project’s own *publishable* key — a `sb_secret_…` or service-role key is refused at load time, in the app and in the Pages workflow.',
      'Every answer is sealed with a SHA-256 digest over the plan, tier, status and both dates plus this clinic, origin, owner and device; an edit in DevTools breaks the seal and the clinic drops to read-only instead of promoting itself. A paused or expired answer deletes the cache in the same tick. Without a connection, the sealed licence keeps the clinic writing until its dates pass — and never past them.',
      'Two modules are obfuscated at build time (`central-sync.mjs` and `license.mjs`) and nothing else is; the clinical modules, the React tree and `node_modules` are untouched.',
    ],
  },
  {
    version: '1.22.4', date: '2026-11-08', schema: 18,
    highlights: [
      'The licence function now repairs a known public-key label mismatch: `BEGIN RSA PUBLIC KEY` paired with `END PUBLIC KEY` is normalized to an SPKI public key before verification.',
      'Private-key PEMs are still rejected before normalization. The clinic secret must contain the authority public key, never its private signing key.',
      'Deploy the updated sync-clinic-license function (v1.22.4) to apply the compatibility fix. No database schema change is required.',
    ],
  },
  {
    version: '1.22.3', date: '2026-11-08', schema: 18,
    highlights: [
      'The licence authority setup guide now explains the `key-private` refusal and the required correction: the clinic Edge Function receives only the authority public key, never its private signing key.',
      'If a private signing key was placed in a clinic secret or otherwise exposed, rotate the authority signing pair, update the clinic Edge Function secret and the matching public build variable, then rebuild the app.',
      'The app and licence function both report version 1.22.3; no database schema change is required.',
    ],
  },
  {
    version: '1.22.2', date: '2026-11-02', schema: 18,
    highlights: [
      'A refusal could not be attributed to a version. The frontend and the licence Edge Function deploy separately, and the panel shows only the app build — so “Could not verify the signature: unexpected ASN.1 DER tag” from a function several releases behind looked like a bug in the build on screen.',
      'Every response from `sync-clinic-license` now carries `x-myclinic-function`, and every refusal names its version on the card: *(licence function v1.22.2)*. A `token-key` refusal from a function too old to say so reads *“the function sent no version, so it is older than this build — deploy sync-clinic-license again”*.',
      'The refusal log line adds the key format it was holding (`pkcs1` or `spki`), and `Access-Control-Expose-Headers` now lists both headers — without it the browser could send the request but never read back what happened.',
    ],
  },
  {
    version: '1.22.1', date: '2026-11-02', schema: 18,
    highlights: [
      'A CI type-check of the licence Edge Function failed with “Import \'https://esm.sh/\' failed: 522” — and nothing was wrong with esm.sh. The import had been shortened to the bare host, `from \'https://esm.sh\'`, and a host is not a module: it answers with a web page when it is healthy and with a 522 when Cloudflare’s edge cannot reach it. Neither is JavaScript.',
      'The specifier is pinned again (`https://esm.sh/@supabase/supabase-js@2.119.0`), and `tests/function-imports.test.mjs` now reads the function and refuses a bare host, an unpinned version or an empty specifier — without any network, so the mistake is caught before CI reaches for a CDN.',
      'The type-check step now caches Deno’s module cache and retries three times: a bad minute at a third-party CDN is an outage, not a bug in the clinic, and it should not turn into a red build on an unrelated commit.',
    ],
  },
  {
    version: '1.22.0', date: '2026-11-06', schema: 18,
    highlights: [
      'A licence public key arrives in one of two envelopes, and only one of them was accepted: `BEGIN PUBLIC KEY` (SPKI) worked, `BEGIN RSA PUBLIC KEY` (PKCS#1) failed with “ASN.1 DER tag: expected SEQUENCE, got INTEGER at DER byte 2” — a message about DER that never mentions the key format. Both work now, in the browser, in the Edge Function and in `npm run check:key`.',
      'WebCrypto has no `pkcs1` import format at all — it is not in the spec, and Deno rejects the string outright — so a PKCS#1 key is wrapped into SPKI before importing. The wrapper reproduces the SPKI export byte for byte, and a test asserts exactly that.',
      'The format is now named everywhere it matters: `publicKeyFormat()`, the config gate’s log line, `npm run check:key` (‘usable RSA-2048 public key (PKCS1 PEM)’), and the secret being a private key is still refused rather than converted.',
    ],
  },
  {
    version: '1.21.9', date: '2026-11-06', schema: 18,
    highlights: [
      'The deploy still died on `[inbucket]` with a config.toml nobody could point at: the wrapper only looked in `supabase/config.toml`, while the CLI reads whatever it finds first. It now walks upward from the working directory, names the file and the line, and reports how many paths it checked when it finds nothing.',
      '`SUPABASE_CLI=2.122.1` is a working escape hatch again: the wrapper used to pass `--remote`, which 2.x does not understand at all. The flag now follows the CLI version — `--remote=<ref>` for 3.x, `--project-ref <ref>` for 2.x.',
      'When the CLI fails and its own words mention `[inbucket]`, the wrapper translates: those words are about local email, never about the licence function, and here is the file to delete.',
    ],
  },
  {
    version: '1.21.8', date: '2026-11-06', schema: 18,
    highlights: [
      '`npm run deploy:function` said “the function does not type-check” on Windows without printing a line of type-check output — because the type-check had never started. Node cannot execFile a `.cmd` shim, and `npx` is one on Windows: the spawn failed with ENOENT and the wrapper blamed the code. `scripts/lib/platform.mjs` now supplies the shell that Windows needs, and the wrapper prints what the child actually said.',
      'The same fault sat in `check:contributing`: `npm audit` could not be spawned on Windows, so the rule reported “audit failed” for a check that never ran. Fixed the same way.',
      '`--skip-check` deploys without the type-check for when `npx deno@2` is slow or the network is not playing; CI runs it on every push to main regardless.',
      'CONTRIBUTING.md documents the Windows `EPERM … rolldown-binding…node` that has now interrupted four releases: `npm install` avoids it entirely, because it does not sweep node_modules.',
    ],
  },
  {
    version: '1.21.7', date: '2026-11-06', schema: 18,
    highlights: [
      'The licence function never deployed — and not because of the function. Supabase CLI 3.0.0 became `latest` on 2026-11-02 and refuses to load a `supabase/config.toml` written by 2.x, so `functions deploy` exits at config load with a message about local email. This project carries no config.toml at all; the file an older CLI left in the working tree is the thing to delete.',
      '`npm run deploy:function -- <ref>` replaces the one-liner: it checks the project ref, refuses when the CLI cannot load the local config and says which file and which two ways out, type-checks the function with the same `deno check` CI runs, and then deploys.',
      'The guide now uses `--remote` instead of `--project-ref` (deprecated in 3.x, removed in 4.x, and the flag that decides whether `db push` hits the remote database or the local one).',
    ],
  },
  {
    version: '1.21.6', date: '2026-11-06', schema: 18,
    highlights: [
      '`token-key` in the licence log was not about the token: the authority answered (200), the caller was allowed, and then the *public key* could not verify anything — because the Edge secret held the key generator’s whole `.env` line, quotes and `\\n` included. `normalisePem()` now strips the wrapper, so the ordinary paste works.',
      'A key that really is wrong is refused at the config gate, in its own words: `key-private` (*that is a private key — paste the public half*), or `key-malformed` with the actual crypto error — no header, truncated, not RSA, or an unparseable body. `token-key` now means only what it says.',
      '`npm run check:key` checks a PEM before you deploy it, prints a stable fingerprint, refuses to echo a private key, and compares two keys — the question behind every `token-signature`.',
    ],
  },
  {
    version: '1.21.5', date: '2026-11-06', schema: 18,
    highlights: [
      'Every refusal from the licence function reached the screen as the same seven words — “Edge Function returned a non-2xx status code” — because supabase-js keeps the status and throws the body away. The app now reads the `{code, error}` body and the `x-myclinic-code` header, so a wrong origin, a non-owner and an authority refusal each arrive as themselves, and the card shows the sentence rather than the plumbing.',
      'When even the body is unreadable — a function deployed before it explained itself — the status is mapped to a sentence that names the likely cause: a 403 with no reason means the deployment is older than the app, so redeploy it.',
      'A refusal no longer touches the licence the clinic already holds: a valid cached token still keeps the clinic writing, which is the offline promise and was untested on this path.',
      '`docs/LICENCE-AUTHORITY.md` now puts the local dev origins in the `MYCLINIC_ORIGINS` example — `http://localhost:5173` and `:4173` — because a clinic that works on Pages returns 403 on your own machine until they are listed.',
    ],
  },
  {
    version: '1.21.4', date: '2026-11-06', schema: 18,
    highlights: [
      'A keyless deploy was silent about *why*: the log said “No licence authority” whether the variable was absent, empty, or filed under a different name. It now prints what the build could see — `VITE_LICENSE_PUBLIC_KEY is present: 450 bytes, starts “-----BEGIN PUBLIC KEY-----”, PEM header: 1` or `… is EMPTY as far as this build job can see` — and fails outright if the variable exists under the prose spelling `VITE_LICENCE_PUBLIC_KEY` with a C, because that looks exactly like no variable at all.',
      'The checks that only ran on pull requests now run on `main` too: `check:contributing` (28 rules) and `deno check` on the licence Edge Function. `ci.yml` skips `main` by design, so a direct push — which is how this project actually ships — was never gated by either.',
      '`docs/LICENCE-AUTHORITY.md` gains the spelling and empty-value entries in its “the variable is set and it still says Not in this build” checklist.',
    ],
  },
  {
    version: '1.21.3', date: '2026-11-06', schema: 18,
    highlights: [
      '“Not in this build” now prints the build it is talking about: `This build: v1.21.3 · <stamp>`. The first question a stale deploy asks is “is this even the artifact I just made?”, and the card could not answer it — the version was two screens away in Settings.',
      'The deploy notice for a missing public key names the three ways a repository variable exists and still does not reach the bundle: the Variables tab (`vars.*` does not read Secrets), repository scope (the build job declares no `environment:`, so an environment-scoped variable is invisible), and the fact that adding a variable starts no build. Re-running the workflow is the fix.',
      '`docs/LICENCE-AUTHORITY.md` gains the matching six-line checklist for “the variable is set and the card still says Not in this build”.',
    ],
  },
  {
    version: '1.21.2', date: '2026-11-06', schema: 18,
    highlights: [
      'A `POST | 403` in the Edge Function log used to be a shrug: the platform records the status and nothing else, because the function never logged its own refusals. Every refusal now writes one line — code, status and the context that decided it (the origin and the allowlist, the clinic id, the names of any missing secret) — and repeats the code in an `x-myclinic-code` response header.',
      'The 403 has three gates and only one of them can fire before sign-in, so `auth_user: null` in the platform log points at it: `origin-not-allowed`. The origin is `scheme://host[:port]` — a Pages site at `/myClinic/` sends `https://clinic.github.io`, without the repository path. `docs/LICENCE-AUTHORITY.md` now carries that table, the `secrets set` that fixes it, and a two-line curl that tells the two causes apart.',
      'The licence Edge Function is type-checked in CI (`deno check`). It immediately found a `BufferSource` typing error Deploy had shipped, because Deploy does not type-check — that is fixed too.',
    ],
  },
  {
    version: '1.21.1', date: '2026-11-06', schema: 18,
    highlights: [
      'The Supabase SQL editor warns that `schema.sql` “includes destructive operations” and “runs an UPDATE without a WHERE clause”. Both are true of SQL in general and neither is a finding about this file: the drops are 51 policies, 20 constraints, 16 triggers, 2 indexes and 1 function, every one with `if exists` and every one re-created immediately after. There are zero `delete`, zero `truncate` and zero drops of tables or columns.',
      '`docs/SCHEMA-APPLY-SAFETY.md` is the inventory, including the single `UPDATE` without a `WHERE` — schema 12 clamping `clinics.follow_up_days` into 3–45 before adding the CHECK — and the measured proof that re-applying the whole file to a schema-18 database with live rows changes not one row.',
      'A 28th check keeps the warning from ever becoming true: `delete from`, `truncate`, `drop table|column|schema|type`, or an `update` with no `where`, fails the build unless the update explains itself in a comment. Verified by removing the comment and by injecting a `delete from`.',
    ],
  },
  {
    version: '1.21.0', date: '2026-11-06', schema: 18,
    highlights: [
      'The authority card could not be found because on a fresh clinic it did not exist: it was drawn only once the clinic was *already bound*, and the binding happened in a silent boot sync. A clinic that had never bound saw no card, no button, and — if that sync failed — no message either. The card now has four explicit states (not in this build · not connected · bound · demo), each naming what to do next.',
      'The first press has a name: **Connect to the licence authority** binds the clinic, and only after that does the button read **Check the licence now**. A refusal is printed on the card in the words of its code instead of vanishing into a background promise.',
      'The real gap for a Pages deploy: `pages.yml` never passed `VITE_LICENSE_PUBLIC_KEY` to the build, so the variable the setup guide told you to set had no effect on the bundle. It is forwarded now, with a log line that says whether the key reached the build — and the job fails outright if a **private** key is put in that public variable.',
      '.env.example finally documents the variable, and `docs/LICENCE-AUTHORITY.md` gains a “the button is not there” table of the four causes and their fixes.',
    ],
  },
  {
    version: '1.20.2', date: '2026-11-06', schema: 18,
    highlights: [
      'A “publicly leaked secret” alert on tests/contributing.test.mjs:27 was a Google-API-key-shaped fixture, not a credential — but a scanner cannot know that, so the seven credential shapes in that file are now assembled from fragments at run time and no scannable string exists in the repository at all.',
      'The reason our own check stayed green is worth fixing too: `tests/` was on the scan’s skip list (“fixtures use obvious dummy values”). It is not skipped any more. `npm run check:contributing` now scans test files like any other and fails on a credential-shaped literal in a fixture — verified by putting one back.',
      'CONTRIBUTING.md says how to write a fixture that does not cost you an alert, and why: a dummy key alerts exactly like a real one, notifies the provider, and is indistinguishable from a real incident in the audit trail.',
    ],
  },
  {
    version: '1.20.1', date: '2026-11-06', schema: 18,
    highlights: [
      '`supabase/schema.sql` now lists every released schema version. The header still stopped at 16 while the file itself applied 18, so anyone reading the top of the file to answer “which schema is this?” got a wrong answer — and the section index stopped at §7 while the file ran to §18. Both are complete now, and `docs/SUPABASE-SETUP.md` gains the migration rows 9–18 it was missing.',
      'A check so the three lists cannot drift apart again: `npm run check:contributing` compares the schema.sql header, the highest `set schema_version = N` in the file and the setup guide’s table against `SCHEMA_VERSION`, and fails on any disagreement. It has disagreed twice.',
      'No database change — the migrations, the registry rows and `app_meta` were already correct at 18. This release is the file telling the truth about itself.',
    ],
  },
  {
    version: '1.20.0', date: '2026-11-06', schema: 18,
    highlights: [
      'A clinic can now take its subscription from the licence authority. The authority signs a 7-day RS256 capability token; this clinic’s own Supabase Edge Function verifies it, records the verdict, and only then does the database treat the clinic as paid. The licence key never enters the bundle.',
      'The browser verifies the same token with the same public key — not because the screen is trusted, but so it can show a signed fact: tier, contract date, seat caps and the deployment fingerprint, with a “Check the licence now” button and a six-hourly phone-home on boot.',
      'Once bound, a clinic stops being able to license itself: renewal, plan change and a fresh trial raise `license:managed` and are removed from the screen. That closes the last tenant-writable door the audit left open.',
      'Offline is unchanged, deliberately: a valid token keeps the clinic working for its seven days, and a contract that has ended degrades to read-only through the existing grace window rather than locking anyone out of their own records.',
    ],
  },
  {
    version: '1.19.2', date: '2026-11-06', schema: 17,
    highlights: [
      '`npm test` works on Windows. `node --test tests/` does not: node’s runner does not treat the directory argument as a directory there, so it tries to load `tests` as a module and the suite dies with MODULE_NOT_FOUND before the first test runs — 0 of 439 tests, and `npm run verify` stops at the first step. The file list is now built in node by `scripts/run-tests.mjs` and passed as arguments: no shell, no globs, no directory handling. The same 439 tests run on Windows, Linux and macOS, and in CI.',
      'A check so it cannot come back: `npm run check:contributing` refuses a test script that hands node a bare directory, and follows the script to confirm it really reaches the test runner rather than looking for the string `node --test`.',
      'Nothing in the database or the app changed — schema 17, same five audit fixes as 1.19.1.',
    ],
  },
  {
    version: '1.19.1', date: '2026-11-06', schema: 17,
    highlights: [
      'The booking reference is no longer a phone lookup. A stranger who typed a patient’s phone number and a slot used to be answered with `booking:already:16:30` — the time of somebody else’s appointment — and could collect that appointment’s reference and cancel it. The refusal is now the same sentence whatever the number and whatever the slot, carries no time and no reference, and the reference is only handed back to the device that booked (a random id kept for that visit, sent as `p_client`).',
      'Signing out now clears the offline copy of the clinic. Patients, consultations and invoices are cached in localStorage so the app works without a network; the cache was scoped to the device but not to the session, so the next person to open the browser on a shared front-desk machine could still read the previous user’s patients from the cache. Sign-out clears every cached workspace and outbox, and expired snapshots are deleted at boot instead of waiting for the same clinic to be opened again.',
      'A tenant can no longer write its own licence. `set_license_status` is now `service_role` only; `change_plan` moves the plan and the interval but not the status; `renew_subscription` needs a collection reference of four characters or more, caps a self-renewal at twelve months and records what was claimed in a new `license_events` table; and `start_trial` refuses a second trial for the same clinic.',
      'Two helpers stopped answering questions about other clinics: `next_token_no` and `next_invoice_number` now assert membership of the clinic they are asked about, instead of counting rows and returning the next number to any signed-in user who passed a doctor or clinic id.',
      'A row can no longer name another clinic’s patient. The write policies on appointments, consultations and invoices check that the `patient_id` (and the `doctor_id` where there is one) belongs to the same clinic as the row being written.',
    ],
  },
  {
    version: '1.19.0', date: '2026-11-06', schema: 16,
    highlights: [
      'CONTRIBUTING.md now states the four standards we actually hold each other to — zero-trust security, performance, coding and style, and the pull-request process — with the commands that check them rather than advice that cannot be checked.',
      'The Cloudflare security-audit skill is vendored in the repository (.claude/skills/security-audit, MIT, pinned to c1c8a8c), so a coding agent opened on this repository runs the same six-phase audit as everyone else: reconnaissance, coverage-led hunting, candidate validation, structured output, independent verification, reporting. The agent that checks a finding is never the agent that found it.',
      'New `npm run check:contributing`: 25 checks over the tracked tree, the dependency safe-list, licence notices, listener cleanups, naming, test coverage of the pure modules, version agreement and the vendored skill. CI fails on any of them. It found two real defects on its first run — a service-worker effect that registered listeners without removing them, and a missing licence row.',
    ],
  },
  {
    version: '1.18.0', date: '2026-11-06', schema: 16,
    highlights: [
      'A prescription is now a document with pages, laid out by the app instead of left to the browser. Every page carries a footer pinned to the bottom of the paper — two blocks of the same width, the clinic and its address on the left, the document identity, the e-prescription line and “Page 2 of 3” on the right — whether the page is full or almost empty.',
      'Long prescriptions paginate: page one holds the letterhead, the patient and up to eight medicines; middle pages hold twelve each under a continuation strip (clinic · patient · RX number · page); the last page leaves room for the investigations, the advice and the signature. Two-page prescriptions are split evenly rather than filling page one and orphaning a row under the signature. Nothing is dropped or renumbered: row numbers run through the document.',
      'The footer cannot drift, because it is not fixed, repeated or guessed at — each page is a flex column and the footer is pushed to the bottom with margin-top. That also settles the earlier PDF defects: no fixed elements, no grid, no viewport heights in paged media.',
    ],
  },
  {
    version: '1.17.2', date: '2026-11-06', schema: 16,
    highlights: [
      'Fixed the generated PDF: the footer no longer prints above the header, and the slip no longer scatters across two pages. `html, body, #root` were height:100% and the print page was min-height:100dvh, so in paged media the sheet overflowed a box that cannot break — the overflow went to page two from the top and took the footer with it.',
      'The repeating footer is gone. It was `position: fixed`, and Chrome paints a fixed element at the head of every printed page — which is exactly why the clinic address and the validity line appeared first, before the letterhead. The prescription now carries one footer, in flow, at the end, where the format puts it.',
      'No grid in print. Chrome fragments grid containers unreliably and a grid with break-inside:avoid can jump to the top of the next page. The patient block, the footer and the invoice blocks are flex rows on paper — same look, predictable breaks.',
      'Typed for paper: 9.6 pt body, 8.6 pt table, 7 pt labels, with 12 mm top, 12 mm side and 14 mm bottom margins. A five-medicine slip with investigations, advice, follow-up and signature now sits on one A4 page with room to spare.',
      'The GSTIN is off the prescription header. It is a bill element; the format asks for the prescriber’s registration number there, and one number fewer is one fewer to misread. Invoices keep it.',
    ],
  },
  {
    version: '1.17.1', date: '2026-11-06', schema: 16,
    highlights: [
      'The prescription and the invoice are shown as a sheet of A4 — 210 × 297 mm — on screen as well as on paper. The sheet used to be an 880 px card, so what you saw was not what the printer produced: the page broke in a different place and the strip reserved for the repeated footer had no room of its own. The page box now carries the same 13 mm top, 12 mm side and 18 mm bottom margins that @page gives the printed page, so at 100% zoom the screen is the paper.',
      'The bottom 8 mm of a printed sheet is kept clear for the footer that repeats on every page, so the last line of a one-page slip no longer sits under it. The toolbar and the buttons above and below the sheet line up with the page edge instead of an arbitrary 880 px.',
      'On a phone the sheet keeps its 16 px padding and drops the fixed A4 height instead of forcing a 297 mm page onto a 360 px screen.',
    ],
  },
  {
    version: '1.17.0', date: '2026-11-06', schema: 16,
    highlights: [
      'The dose pattern is now something you write, not something the app infers. Beside “How often” there is a pattern box: type 1-0-1, 1-1-1, 0-0-1, 1-1-1-1, ½-0-1 — morning, afternoon, night, in the order a pad is written — or tap one of the six chips. Two numbers mean morning and night, four add the evening.',
      'The pattern you type decides the words, not the other way round. 1-0-1 sets “Twice a day”, 0-1-0 keeps the midday dose and drops the other two, and the instruction line under the row reads back “in the morning · at night” in the language chosen for the slip. A pattern the app cannot read (0-0-0, 5-0-1, a stray letter) is refused where it was typed instead of being saved and quietly dropped.',
      'The pattern prints on the prescription under the dose — 1-0-1 — and travels in the WhatsApp message next to the drug name, because a chemist in this country reads the pattern before the sentence.',
      'The quantity follows the pattern: 1-1-1 for 5 days is 15 tablets, 0-1-0 for 5 days is 5, ½-0-1 for 10 days is 15 (a half tablet still comes out of a whole one), and 5 ml at night for 4 days is 60 ml — a volume is dosed by the millilitre, not by the spoon.',
    ],
  },
  {
    version: '1.16.0', date: '2026-11-06', schema: 16,
    highlights: [
      'The printed prescription now carries the quantity to be dispensed — “1 tablet twice a day for 5 days” prints as 10 tablets, a half tablet daily for 10 days as 5 tablets, 5 ml thrice a day for 5 days as 75 ml. It is arithmetic on what you already typed, never a guess: “when needed”, “till review” and “apply thinly” print a dash rather than a number that would be wrong.',
      'Tests advised are their own field now (schema 16), listed under “Investigations advised” on the slip instead of buried in the advice — CBC, HbA1c after 3 months, X-ray chest. Type them comma-separated in the consultation, the way diagnoses already work.',
      'The slip reads like the prescribed format: the generic name in capitals under the brand (AMOXICILLIN + CLAVULANIC ACID), the patient’s address with name, age and sex, height alongside weight, and the doctor’s registration number repeated at the signature with “Signature & seal” under the line.',
      'The footer says what an e-prescription has to say: computer-generated, valid only with the doctor’s signature and clinic seal, and the phone and email of the clinic that issued it.',
    ],
  },
  {
    version: '1.15.0', date: '2026-11-06', schema: 15,
    highlights: [
      'The prescription line is written the way a pad is written. Beside “How often” there are now four chips — 1-0-0, 1-0-1, 1-1-1, 0-0-1 — so one tap writes the pattern a chemist reads, while the field keeps the words (“Twice a day (BD)”) that print on the slip. The frequencies with no daily pattern (When needed, every 6 hours, once a week) are still in the dropdown, and are never given a pattern they do not have.',
      'Dose chips follow the drug you picked: a syrup offers 5 ml and 10 ml, an inhaler 1 puff, an injection 1 dose, eye drops 1 drop, a tablet 1 tablet / ½ tablet / 2 tablets. Nobody types “5 ml” into a tablet any more, and nobody has to type “½”.',
      '“For” has quick chips (3d, 5d, 7d, 10d) and a computed end date — “till 11 Nov 2026” — so the course length is checked at a glance instead of counted on fingers. “Food relation” is five visible chips instead of a dropdown, with “— none —” as a sixth.',
      'Under the fields, one dashed line reads the whole line back: the pattern (1-0-1), the patient instruction in the language chosen for the slip, and the date the course ends. If the same brand is already on this prescription, it says so there.',
      'Fixed while in there: the dose and duration suggestion lists used the same two ids on every drug row, so the second row’s suggestions were attached to the first row’s input. Each row now has its own.',
    ],
  },
  {
    version: '1.14.1', date: '2026-11-06', schema: 15,
    highlights: [
      'The drug directory keeps its speed when it is full. The Indian Medicine Dataset — 253,973 rows, 242,178 usable brands — now imports in one command, and the field still answers in single-digit milliseconds on the names a clinic types most ("augmentn" 2 ms, "zerodol sp" 4 ms, "pantocid" 13 ms). Schema 14\'s search was correct but took half a second at that size; schema 15 collects candidates from indexes instead of scoring every row, and replaces the trigram indexes with the faster kind (GIN) now that the table is written by an import and read by every prescription.',
      'A typo no longer lands on the wrong drug. With 242,000 brands loaded, "augmentn" put Augmentox above Augmentin 625 — both share the same seven trigrams, and the shorter name won the tie. Keystroke distance settles it now: "augmentn" is one deletion from Augmentin and two from Augmentox, so the drug the doctor meant is the first row.',
      'Half-typed molecules still work. "para", "amox" and "metf" match the composition from its start, because a prefix is not a typo ("paracetamol" is only 0.25 similar to "para").',
      'Importing the long tail is a supported path, not a script you have to read first: --preset inmd detects the dataset\'s columns, strips the pack size out of the brand, splits "Amoxycillin (500mg)" into molecule and strength, folds four pack sizes of one tablet into one row, skips discontinued products, and normalises spellings (Amoxycillin → Amoxicillin, Acetaminophen → Paracetamol). --inherit-classes copies the safety classes and dispensing schedule from the 59 curated brands onto the imported rows that share a molecule, so duplicate-therapy and allergy checks stop being silent.',
      'A 44 MB import file is written in batches with psql in mind, and the message says so instead of suggesting you paste it into the SQL editor.',
    ],
  },
  {
    version: '1.14.0', date: '2026-11-06', schema: 14,
    highlights: [
      'The drug field forgives typing. "Augmentn", "amoxycillin", "metformn", "crocn" and "tab pan 40" all find the drug you meant — the search now ranks a brand prefix first, then a near-miss spelling, then the molecule, instead of demanding the exact start of the name.',
      'A drug directory behind that field (schema 14). The 59 brands that ship inside the app still answer instantly and offline; on a connection the field also asks the clinic\'s own directory, so the long tail — the strip in the patient\'s hand — is one pause away.',
      'The composition is always on the row: brand in bold, generic salt and form underneath in a muted line, so the chemist and the drug inspector read what the safety checks read.',
      'Matched letters are highlighted, the source of each suggestion is labelled (Used here / Directory), the list can be walked with arrow keys, Home, End and Enter, and a screen reader announces how many suggestions appeared.',
      'The directory is read-only reference data. Every signed-in seat can read it; nothing in the app can edit it — imports run from scripts/import-medicines.mjs with a service-role key, and the 59 starter rows are already there after the SQL runs.',
      'Two tools for real data: scripts/import-medicines.mjs reads a data.gov.in / CDSCO / chemist CSV or JSON export and writes idempotent SQL (or pushes it), and scripts/rxnorm-composition.mjs re-spells a molecule the way RxNorm does, so "Amoxycillin" and "Amoxicillin" are one drug to the duplicate-therapy check.',
      'The field says what it is doing: a quiet spinner while the directory is asked, "one more letter" below two characters, and a plain "not in the list — it saves exactly as written" instead of a dead end.',
    ],
  },
  {
    version: '1.13.1', date: '2026-11-04', schema: 13,
    highlights: [
      'The sync conflict that said "this record was deleted at the clinic" on the account screen is fixed at its cause: an account created before the database had the sign-up trigger had no row in profiles at all, so saving your name had nothing to attach to. Nobody had deleted anything.',
      'The app now writes the signed-in account\'s own profile row on sign-in and on save, and the queue treats a missing profile as a first write rather than a deletion — so an offline edit to your account lands as a new row instead of becoming a conflict.',
      'A conflict on your own profile now says what actually happened ("Your account profile row is not in the database") and offers Recreate my profile, which writes it with the values you had typed. Discard still works.',
      'Schema 13 backfills a profile row for every existing account, with the name from sign-up, so the situation cannot come back for anyone who never opens Settings.',
      'Conflicts on other records are unchanged and still ask a human: a patient deleted at the clinic is not resurrected by an offline edit, and the review screen now shows the record id it would recreate.',
    ],
  },
  {
    version: '1.13.0', date: '2026-11-04', schema: 12,
    highlights: [
      'A clinic day can now be two sessions — 9 AM–1 PM and 6 PM–10 PM — and the break between them is never offered as a slot. Settings → Clinic profile edits both, with the length of each session shown as you type.',
      'A doctor sits inside one of the clinic\'s sessions. The morning doctor is not bookable in the evening, and hours that would cross the clinic\'s break are refused on the screen, in the appointment sheet and by the database.',
      'Days off are settings now, for the clinic and for each doctor: pick weekdays (Sunday, or every second Saturday) and add one-off holidays. Closed days offer no slots anywhere — the desk, the booking page and the API all agree — and the screen says which day is next.',
      'Follow-up validity is a 3 to 45 day window instead of 0 to 180. Values already saved are clamped rather than refused, so no clinic is left with a row the new rule would reject.',
      '"My account" now saves. The screen was sending every preference it held — including one the database had no column for — so PostgREST refused the whole update and a name change failed because of a notification toggle. The payload is built from the columns that exist, and the missing column exists as well (schema 12).',
      'Every save now answers with the reason it failed instead of "Could not save.": which column is missing (and that schema.sql needs re-running), which seat is not allowed, that the session expired, that the server is unreachable, or which value the database refused. Settings → About lists the last few failures with a Copy button for support.',
      'Saves on the settings screens wait for the database. The queue still protects the till when the wifi drops, but a person watching a Save button is told the truth immediately — "saved" no longer appears before the server has answered.',
      'A crashed screen no longer leaves a blank page: it says what broke, shows the version and schema, and offers to copy the diagnostics for support.',
    ],
  },
  {
    version: '1.12.0', date: '2026-11-04', schema: 11,
    highlights: [
      'The token, the appointment, the bill and the slip can now be sent to the patient on WhatsApp from the clinic\'s own number — one composer, the exact text visible before it goes, and a log entry for every message.',
      'The token message carries the number, the doctor and how many patients are ahead; the appointment carries the date, the time, the doctor and the address; the bill carries the total, what was paid, what is left and the clinic\'s UPI id; the slip carries the medicines and the directions in the language the doctor chose.',
      'A patient can now be marked as opted out of WhatsApp, and the composer refuses with the reason instead of quietly doing nothing. Opt-out is a column (schema 11), not a note in the paper file.',
      'Token, invoice and prescription messages join the reminder log, so "was this patient sent their bill?" has an answer. A message already sent today is flagged before it is sent twice.',
    ],
  },
  {
    version: '1.11.10', date: '2026-11-04', schema: 10,
    highlights: [
      'The demo door now opens the demo. On a deployment with Supabase configured — which is what the published site is — the footer\'s "Open Demo" button sent a signed-out visitor to the sign-in form, so the one entrance the release notes promised landed on a login screen. It opens the workspace now: a visitor without a session is already in demo mode, and the shell says so.',
      'Signing in keeps its own button in the marketing nav, and nothing else on the page enters the app. The demo still writes only to this browser — it never reaches the clinic database.',
    ],
  },
  {
    version: '1.11.9', date: '2026-11-04', schema: 10,
    highlights: [
      'The front desk gets its own workspace back: no Doctors & staff, no Day close, no Subscription and no plan box in the sidebar. Its nav is Dashboard, Token queue, Appointments, Patients, Billing, Reports and Settings.',
      'Day close is now the owner\'s screen. Counting the drawer, writing down a variance and freezing the day\'s snapshot are reconciliation, not collection — the desk still takes payments at the counter.',
      'Settings shows a seat only the tabs it can act on: a front-desk account gets My account, Appearance, Offline & sync and About; the clinic profile, logos, GST setup, booking link and plan are the owner\'s.',
      'The plan panel is gone from the sidebar for anyone who cannot open it — a doctor or a desk seat no longer sees an upgrade box it cannot use.',
      'The README follows the awesome-readme shape: centred logo and pitch, badges, screenshots, quick start, features by seat, role table, plans, structure, configuration, database, testing, deployment, troubleshooting and docs.',
    ],
  },
  {
    version: '1.11.8', date: '2026-11-04', schema: 10,
    highlights: [
      'The marketing page has one way into the demo: the footer button, "Open Demo". The hero, the closing band, the plan cards and the footer link list no longer drop a visitor into sample data — they lead to plans, sign up or the deployment guide.',
      'The hero now offers a single call to action instead of three, and the closing band talks about the clinic\'s morning rather than the demo clinic.',
      'Every reference to the reference project myClinic grew out of is gone from the repository, including the third-party notices, which now credit only the packages the app actually ships.',
    ],
  },
  {
    version: '1.11.7', date: '2026-11-04', schema: 10,
    highlights: [
      'A yearly subscription now behaves like one. The licence view dropped the billing interval and the payment reference, so a clinic paying yearly was shown as monthly, quoted the monthly price, renewed for a single month instead of twelve, and lost the UPI reference it had just recorded.',
      'A payment now buys the term the clinic is actually on. The Monthly/Yearly toggle inside the plan dialog only previews prices — it can no longer shorten a yearly renewal because you happened to be browsing monthly.',
      'Recording a payment in the demo workspace used to add a hard-coded 30 days whatever the plan; it now adds the term you paid for, calendar-correct, matching the database.',
      'The sidebar no longer offers "Manage subscription" to a doctor or a front desk seat, which could not open it since the role split. They see the plan and its status, and who to ask.',
      'Paise are shown as paise: a yearly price reads ₹23,990.40, not ₹23,990.4.',
      'The README is rebuilt as a proper project front page — what the app is, the role table, plans, local setup, database, tests, deployment, troubleshooting and where the deeper docs live.',
    ],
  },
  {
    version: '1.11.6', date: '2026-11-04', schema: 10,
    highlights: [
      'The clinic now keeps the two halves of the work apart, exactly as the Team page has always described them: the doctor owns the chart, the front desk owns the till, the owner owns both. Until now the app said that and the database did not — anyone holding a seat could read it all.',
      'A doctor no longer sees Billing, the Billing tab on a patient, or the ability to raise an invoice from a consultation. "Save & bill" is gone from the consultation form; the visit is saved and the front desk bills it.',
      'Front desk no longer opens Consultations, Follow-ups or any consultation note. It keeps registration, the diary, billing, payments, reports and the day close.',
      'The money and clinical numbers each role still needs keep working: the front desk\'s dashboard, reports and day close count visits from the appointments that actually happened instead of reporting a quiet clinic, and a doctor\'s dashboard keeps its footfall while the collected/outstanding figures give way to the queue.',
      'Reports is now open to the front desk (it was the one row the Team page promised and the app refused), with money panels for the desk and clinical panels for the doctor.',
      'Schema 10 puts the same line in Postgres. The invoice policies drop the doctor seat and the consultation policy drops the front-desk seat, so the API refuses what the screens no longer offer — a hidden button is not the only thing standing between a role and the wrong half of the clinic.',
    ],
  },
  {
    version: '1.11.5', date: '2026-11-05', schema: 9,
    highlights: [
      'The booking link works the moment a clinic is created. A new clinic used to be provisioned with no public address at all, so the link Settings handed over — and every poster, WhatsApp message and Google listing carrying it — opened a page that said no clinic is published at this address.',
      'Settings now shows the link the database actually answers on, and only that one. Copy and Open are disabled until a link exists, instead of silently offering the sample clinic\'s address.',
      'Clearing the link name no longer empties the address: it falls back to the clinic\'s name. A name another clinic already holds gets a free one (-1) instead of a failed save.',
      'Changing the link name says so until you save — "patients stay on /book/old-name until you save" — so you never hand out a link that has not gone live yet.',
      'The public booking page no longer waits for the staff workspace to load: it renders on its own, so a patient on a slow phone sees the clinic instead of "Opening your clinic…".',
      'Schema 9 fills in an address for every existing clinic, including one saved with capitals or punctuation, and blocks anything that cannot be put in a URL.',
    ],
  },
  {
    version: '1.11.1', date: '2026-11-04', schema: 8,
    highlights: [
      'Inviting a front-desk seat or another doctor now works end to end: the invitation carries the name, role, specialty and qualification, and the seat is granted the first time the person signs in with that email.',
      'A new "Pending invitations" list shows who is waiting, how many days the offer has left, and gives you the link to send — or lets you withdraw it.',
      'An invited person is no longer sent to set up a clinic of their own. Their seat is claimed on first sign-in, and if that is refused (a full plan, a withdrawn invitation) the reason is shown on the next screen instead of being swallowed.',
      'In the demo, inviting a doctor used to create a half-built person — named after their email, no hours, ₹0 fees — and demoted you from owner to doctor. It now creates a complete seat and keeps you the owner.',
    ],
  },
  {
    version: '1.11.0', date: '2026-11-04', schema: 8,
    highlights: [
      'Public booking: every clinic gets a page at /#/book/<clinic> that a patient can open without an account — pick a doctor, pick a free slot, leave a name and a number, get a reference.',
      'Slots come from the same engine the front desk uses, so an online booking and a walk-in can never disagree about what is free. The database refuses the same slot twice.',
      'A booking is a normal appointment: it lands on the calendar with source “Booked online”, creates or matches the patient card by phone, and shows up in the token queue like any other.',
      'Patients cancel themselves with their reference — the slot returns to the diary immediately and the record stays. Reports gain “Where the diary comes from”.',
      'Settings → Clinic gains the booking link, the on/off switch, how far ahead the diary opens, and the note patients see.',
    ],
  },
  {
    version: '1.10.1', date: '2026-11-04', schema: 7,
    highlights: [
      'The landing page now advertises day close and the reminder queue, so the two things a solo clinic buys this for are visible before signing in.',
    ],
  },
  {
    version: '1.10.0', date: '2026-11-04', schema: 7,
    highlights: [
      'Day close: one screen with the money that came in, split by how it was paid, against the cash you count in the drawer — with the difference written down before you close.',
      'Closing the day stores a snapshot, so the sheet you printed at 9pm still matches tomorrow after new invoices arrive. Reopen it to amend, never to overwrite silently.',
      'Missed charges are found for you: a patient seen but never billed, a bill still open from today, and dues that have been owed longer than a week.',
      'A reminder queue drafts one privacy-safe message per patient — tomorrow\'s appointments, recalls that are due, and balances older than a week — with copy, WhatsApp and a send log.',
      'The send log records what actually happened (copied, opened, sent, skipped) so the same patient is never messaged twice for the same thing.',
      'Your quiet hours and reminder lead time from Settings are respected: drafts made overnight are waiting for the morning.',
    ],
  },
  {
    version: '1.9.0', date: '2026-11-04', schema: 6,
    highlights: [
      'Phones get their own layout: the appointment day board becomes an agenda, lists read down instead of across, and the consultation sheet fills the screen with its actions pinned at the bottom.',
      'KPI tiles sit two to a row, so the dashboard is a screen and a half instead of four screens.',
      'Long registers page themselves — 12 rows at a time on a phone — instead of scrolling through 200 invoices.',
      'Nothing tappable is smaller than a thumb, and text fields use a 16px font so iOS stops zooming the page on focus.',
      'Wide report tables scroll inside their card instead of crushing every column.',
    ],
  },
  {
    version: '1.8.0', date: '2026-11-03', schema: 6,
    highlights: [
      'Medicine master: the drug field autocompletes brands, molecules and symptoms, and fills the dose, frequency, duration and food relation for you.',
      'Typing is never blocked — an unknown drug is saved exactly as written.',
      'Safety checks on every prescription: the same molecule twice, two drugs of the same class, curated interactions, and the patient\'s recorded allergies.',
      'High-severity findings must be acknowledged before saving, and the acknowledgement is stored on the prescription.',
      'Schedule H1 drugs raise a register notice instead of a block.',
      'Prescriptions are numbered RX/26-27/0001 — their own series, independent of invoices — and print with each drug\'s molecule.',
      'Fixed the consultation dialog stealing the cursor whenever typing paused.',
    ],
  },
  {
    version: '1.7.0', date: '2026-11-03', schema: 5,
    highlights: [
      'UPI collection: every unpaid invoice carries a scannable QR with the exact balance, on screen and on paper.',
      'One payment sheet everywhere — billing, invoice and patient chart — with part payments and a payment reference.',
      'Invoice and prescription documents rebuilt to print as clean A4 pages, with a proper header, amount in words and a payment block.',
      'Consultation → bill → collect is now one continuous flow.',
    ],
  },
  {
    version: '1.6.0', date: '2026-11-03', schema: 4,
    highlights: [
      'supabase/schema.sql is now the single source of truth: one file creates a new database and upgrades an old one in place.',
      'The database reports its own schema version, so the app can say exactly what needs updating.',
    ],
  },
  {
    version: '1.5.0', date: '2026-11-03', schema: 4,
    highlights: [
      'Upload a square and a wide clinic logo; both appear on prescriptions, invoices and the sidebar.',
      'Logos are resized in the browser before saving, so they print offline and stay small.',
      'Turn logos off per clinic for letterhead that already carries them.',
      'One brand kit feeds documents today and WhatsApp or email later — same name, colour and logo.',
      'Fixed the allergy line printing as a bare colon on every prescription.',
    ],
  },
  {
    version: '1.4.0', date: '2026-11-03', schema: 3,
    highlights: [
      'Appointment scheduling rebuilt: a per-doctor day board where a 30-minute visit occupies 30 minutes, not two separate cells.',
      'Week view shows load per doctor per day — open slots, booked counts and utilisation in one glance.',
      'The booking sheet blocks interval-accurate clashes, groups slots by morning/afternoon/evening and offers the next free slot.',
      'Cancel or no-show is undoable from the day view; nothing leaves the board without a way back.',
      'Free-slot and utilisation figures now come from one shared scheduling engine (11 new unit tests).',
    ],
  },
  {
    version: '1.3.0', date: '2026-11-03', schema: 3,
    highlights: [
      'Subscription licensing: 14-day trial, monthly or yearly plans, 7-day grace, read-only fallback.',
      'Seat limits per plan enforced by a Postgres trigger, not just the UI.',
      'Subscription screen: plan changes, payment recording, seat meters and an export of the terms.',
      'Solo → Growth → Multi-clinic, with proration-free upgrades and 20% off yearly.',
    ],
  },
  {
    version: '1.2.1', date: '2026-11-02', schema: 2,
    highlights: [
      'Node 26 LTS with npm 12.2.1 pinned via .nvmrc, .node-version and packageManager.',
      'Supabase connection self-test on the setup page: URL, key safety, REST reachability and schema drift.',
      'GitHub Pages deploy hardened: Node 26 build, configuration report and a bundle-ready commit.',
    ],
  },
  {
    version: '1.2.0', date: '2026-11-02', schema: 2,
    highlights: [
      'Offline-first: work without internet, changes sync automatically with conflict handling.',
      'Role matrix enforced in the database — owner, doctor and front desk each see only what they run.',
      'Seven accent colours, each with a tuned light and dark palette.',
      'Prescription directions in ten Indian languages, with a print-ready slip.',
      'Security hardening from the Cloudflare-format audit (RLS, tokens, cache scoping).',
    ],
  },
  {
    version: '1.1.0', date: '2026-11-02', schema: 1,
    highlights: [
      'Walk-in token queue with daily per-doctor numbering and a waiting-room display.',
      'GitHub Pages deployment with relative-base builds and a readiness check.',
      'Installable PWA with an update bar and offline shell.',
    ],
  },
  {
    version: '1.0.0', date: '2026-10-30', schema: 1,
    highlights: ['Appointments, patient charts, consultations, billing, follow-ups, reports and team.'],
  },
];

export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * Check the database's reported schema version against what this build needs.
 * The server function `app_schema_version()` returns an integer.
 */
export function schemaStatus(serverVersion) {
  if (serverVersion == null) return { state: 'unknown', server: null, client: SCHEMA_VERSION };
  const diff = compareVersions(serverVersion, SCHEMA_VERSION);
  if (diff === 0) return { state: 'match', server: serverVersion, client: SCHEMA_VERSION };
  if (diff < 0) return { state: 'server-behind', server: serverVersion, client: SCHEMA_VERSION };
  return { state: 'client-behind', server: serverVersion, client: SCHEMA_VERSION };
}

export const BUILD_LABEL = BUILD.at
  ? `${BUILD.id} · ${new Date(BUILD.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
  : BUILD.id;
