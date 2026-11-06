# The drug directory

How the prescription field finds a medicine, what lives in the database, and how to
put real Indian drug data in it.

## The problem it solves

Indian OPD practice prescribes by **brand** ("Augmentin 625", "Pantocid 40",
"Zerodol SP") but dispenses and audits by **molecule** ("Amoxicillin + Clavulanic
acid", "Pantoprazole"). A prescription slip has to carry both: the chemist reads the
brand, the inspector reads the salt, and the app's own safety checks — duplicate
molecule, duplicate class, recorded allergy, H1 register — read the salt too.

So the field has to do three things at once:

1. find the brand from whatever the doctor types, in under a blink, typos included;
2. show the composition next to it, so the doctor sees what is being written;
3. hand the whole thing — brand, salt, form, schedule — to the prescription line.

## Three layers, cheapest first

| Layer | Where | Answers | Works offline | Cost |
| --- | --- | --- | --- | --- |
| Clinic history | this browser | drugs this clinic actually writes | yes | none |
| Starter formulary | `src/lib/medicines.mjs` (59 brands) | the common OPD list, with dose defaults | yes | none |
| Drug directory | `public.medicines`, schema 14 | the long tail — thousands of brands | no | one query per pause in typing |

The browser always answers first. `src/lib/drug-search.mjs` scores the history and
the starter formulary synchronously on the keystroke, and 250 ms later, if the clinic
is online, the directory's answer is merged underneath. Nothing waits for the
network to show a familiar brand, and nothing breaks when there is no network.

### The ranking, in order

| Tier | Example | Weight |
| --- | --- | --- |
| exact brand | `dolo 650` | 1000 |
| brand prefix (shorter brand wins) | `dolo` → Dolo 650 | 900 |
| word start inside the brand | `advance` → Crocin Advance | 860 |
| exact molecule | `pantoprazole` | 830 |
| molecule prefix / word start | `parac` | 800 / 740 |
| brand contains | `625` | 700 |
| molecule contains | `cillin` | 660 |
| strength | `500` in "500 mg" | 560 |
| keyword (symptom, class) | `fever`, `cough` | 520 / 460 |
| trigram similarity (typos) | `augmentn` → Augmentin 625 | 300–560 |
| a line this clinic has written | history bonus | +40 |

Ties break alphabetically, always — the same query offers the same list every time.
A doctor has to be able to predict the field.

**Trigram similarity** is the same maths as Postgres' `pg_trgm`: pad the string,
take every 3-character window, and compare two sets with Dice's coefficient. One
dropped letter (`augmentn`), one wrong letter (`amoxycillin`) or a swapped pair
(`crocni`) still scores above the 0.34 floor; anything below it is treated as a
different word, so `zzzznotadrug` returns nothing rather than everything.

**Multi-word terms** only count when every word lands somewhere, and then only as
strongly as the weakest word. `dolo 650` therefore beats `dolo`, and `dolo zzz` does
not lead with Dolo.

## The database (schema 14)

```sql
public.medicines (
  id uuid primary key default gen_random_uuid(),
  brand_name   text not null,
  composition  text not null default '',
  form         text,          -- 'Tablet', 'Syrup', 'Injection', 'Respules'…
  strength     text,          -- '500 mg + 125 mg'
  manufacturer text,
  schedule     text,          -- OTC | H | H1 | X, or null when unknown
  classes      text[],        -- 'ppi', 'nsaid', 'penicillin'… drives the safety rules
  keywords     text not null default '',
  source       text not null default 'formulary',   -- 'formulary' | 'import'
  created_at, updated_at timestamptz
)
```

- **Identity** is `lower(brand_name) + lower(strength) + lower(form)`. "Augmentin
  625" (tablet) and "Augmentin 625 Duo" (sachet) are different rows.
- **Indexes**: GiST `gist_trgm_ops` on `brand_name` and on `composition`. If the
  server cannot create `pg_trgm`, the migration says so and falls back to a
  `text_pattern_ops` index with prefix matching — the table and the function still
  work, the app simply gets no fuzzy rows from the server (its own search fuzzes).
- **Read-only for the app**: RLS on, one `for select to authenticated using (true)`
  policy, no INSERT/UPDATE/DELETE grant to `anon` or `authenticated`.
- **The function** is `security invoker` — deliberately not `security definer` — so
  the table's policy decides who reads it and a future tightening cannot be
  bypassed by a function call.

```sql
select * from public.search_medicine_brands('augmentn');           -- 8 rows, ranked
select * from public.search_medicine_brands('pantoprazole', 5);    -- cap 1..25
```

It returns `id, brand_name, composition, form, strength, manufacturer, schedule,
classes, score`. Two guards: a term shorter than two characters returns no rows
(not an error), and the limit is clamped to 1…25 so no caller can pull the table.

Ranking mirrors the browser exactly — exact, prefix, word-start, composition,
keyword, then `similarity()` — which is why a directory row slots into the local
list without re-sorting it.

## Putting real data in

The app ships 59 brands so a fresh install is useful. Everything else is imported.

### From data.gov.in / CDSCO / a chemist's export

```bash
# see what the file contains, and what would be skipped — writes nothing
node scripts/import-medicines.mjs --file cdsco-drugs.csv

# write idempotent SQL for the Supabase SQL editor
node scripts/import-medicines.mjs --file cdsco-drugs.csv --sql import-medicines.sql

# or push it with a service-role key (never in the browser build)
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
  node scripts/import-medicines.mjs --file cdsco-drugs.csv --push
```

The reader takes CSV, TSV and JSON. Column names are recognised from the aliases in
`COLUMN_ALIASES` (`Brand Name`, `Trade Name`, `Product`, `Medicine`… for the brand;
`Composition`, `Generic Name`, `Salt`, `Molecule`… for the composition), because no
two Indian exports agree on a header. What it refuses to do:

- **guess a composition.** A row with a brand and no molecule is reported and
  skipped — a blank salt would print a prescription the chemist cannot dispense.
- **overwrite a curated row.** Duplicates are ignored (`on conflict do nothing` /
  `resolution=ignore-duplicates`), so re-importing last month's file is free of
  consequences.
- **write without being asked.** `--push` is the only flag that touches the
  database; the default run is a dry summary.

Strength and composition are tidied on the way in (`500mg+125mg` → `500 mg + 125
mg`, `AMOXICILLIN+CLAVULANIC ACID` → `Amoxicillin + Clavulanic acid`), and an
unrecognised dispensing schedule is stored as `null` rather than guessed.

### Spelling the molecule one way: RxNorm

```bash
node scripts/rxnorm-composition.mjs --check "amoxycillin"
node scripts/rxnorm-composition.mjs --file drugs.csv --out drugs.clean.csv
```

RxNorm (US NLM, free, no key) is asked `approximateTerm` for each molecule; a match
scoring 0.8 or better re-spells it. Salt forms and parentheticals are dropped before
comparing (`Amoxycillin Trihydrate` → `Amoxycillin`). A molecule RxNorm does not know
keeps the source spelling — this is a spelling aid, never a gate, and it never drops
a row. The script runs one request at a time with a small pause: NLM asks that you do
not burst it, and this is a laptop tool, not part of the build.

Why bother: `Amoxycillin` and `Amoxicillin` are one drug to a doctor and two strings
to a duplicate-therapy check.

## Using the field

In a consultation, the drug field is `src/components/MedicinePicker.jsx`:

- type two characters — the local list appears immediately;
- pause — the directory answers and is merged in, labelled **Directory**; lines this
  clinic has written are labelled **Used here**;
- `↑` `↓` to move, `Home` `End` to jump, `Enter` to take one, `Esc` to close and keep
  what you typed;
- the chosen row fills the brand, the composition, the form, the schedule and — for
  the shipped formulary only — the dose, frequency, duration and food relation;
- a drug nobody has heard of is still saved exactly as written. The field never
  blocks.

## What the directory deliberately does not do

- **No dosing.** A directory row arrives with no dose, frequency or duration. Dose
  is a clinical decision about this patient; the app does not guess it.
- **No writes from the app.** Nobody signed in can add or edit a row. That keeps one
  clinic's typo out of everyone else's suggestions.
- **No retroactive edits to prescriptions.** A prescription stores its own copy of
  the brand and the molecule it was written with, so a later directory correction
  cannot rewrite what a patient was handed.
- **No blocking alerts.** The safety rules stay advisory and acknowledgeable, as
  before. The directory widens what they can see; it does not decide anything.

## Verify it

```bash
npm test                        # 378 unit tests, including 24 on drug search
psql "$DATABASE_URL" -f supabase/schema.sql
psql "$DATABASE_URL" -f supabase/schema-tests.sql   # suite J: "ALL DRUG DIRECTORY CHECKS COMPLETED"
```

Suite J holds the four things that matter: the seed is present, the obvious brand
leads (and `augmentn` finds Augmentin), the guards hold (one letter, null, blank,
clamped limit), and the table is read-only to every app role while the function is
not `SECURITY DEFINER`.

## Where the code lives

| File | What it holds |
| --- | --- |
| `src/lib/drug-search.mjs` | scoring, trigram similarity, highlighting, merging |
| `src/lib/medicines.mjs` | the 59-brand starter formulary, safety rules, directory-row mapping |
| `src/components/MedicinePicker.jsx` | the combobox: debounce, keyboard, labels, spinner |
| `src/lib/store.jsx` | `searchDrugDirectory(term)` — cached, never throws, empty when offline |
| `supabase/schema.sql` §14 | table, indexes, RLS, `search_medicine_brands()`, seed |
| `supabase/schema-tests.sql` suite J | the assertions above |
| `scripts/import-medicines.mjs` | CSV/TSV/JSON → SQL or REST, with a dry run |
| `scripts/rxnorm-composition.mjs` | RxNorm spelling normalisation |
