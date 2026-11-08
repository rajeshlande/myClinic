/**
 * Version management.
 *
 * Three numbers that must not be confused:
 *   app    — the product version shown to users (major.minor.patch)
 *   schema — the Supabase migration this build expects (drives upgrade prompts)
 *   build  — injected at build time (commit + timestamp) for support
 */

export const APP_VERSION = '1.21.5';
export const SCHEMA_VERSION = 18;

/** Injected by vite.config.js define(). */
export const BUILD = (() => {
  try {
    return typeof __MYCLINIC_BUILD__ !== 'undefined' ? __MYCLINIC_BUILD__ : { id: 'dev', at: null };
  } catch {
    return { id: 'dev', at: null };
  }
})();

/** What changed, newest first. Shown in Settings → What's new. */
export const CHANGELOG = [
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
