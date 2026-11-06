#!/usr/bin/env node
/**
 * Import an Indian drug list into the directory (schema 14).
 *
 * What this is for
 * ----------------
 * The app ships 59 brands so that a fresh install is useful. Real practice needs
 * the long tail — the strip the patient is holding. That list has to come from
 * somewhere official, and in India the free ones are:
 *
 *   • data.gov.in (CDSCO / NPPA catalogues) — CSV or JSON exports, varying
 *     column names, sometimes one file per therapeutic group;
 *   • a state drug-control price list (DPCO schedule) — brand + strength + pack;
 *   • the clinic's own purchase register exported from the chemist's software.
 *
 * This script takes any of those as CSV, TSV or JSON, works out which column is
 * the brand and which is the composition, normalises what it can, and prints
 * SQL — or pushes straight to Supabase with a service-role key.
 *
 * Deliberately conservative
 * -------------------------
 *   • It never guesses a composition. A row without one is reported and skipped:
 *     a brand with a blank molecule would print a prescription the chemist cannot
 *     dispense against.
 *   • It never overwrites a curated row. Duplicates are ignored, not updated —
 *     `on conflict do nothing` in SQL, `resolution=ignore-duplicates` on the REST
 *     path. Re-importing last month's file is therefore free of consequences.
 *   • It prints what it will do before it does it. `--push` is the only flag that
 *     writes anything, and it must be given explicitly.
 *
 * Usage
 * -----
 *   node scripts/import-medicines.mjs --file cdsco-drugs.csv
 *   node scripts/import-medicines.mjs --file drugs.json --sql medicines.sql
 *   node scripts/import-medicines.mjs --file drugs.csv --push
 *
 *   --push needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.
 *   Never put a service-role key in the browser build; this runs on a laptop.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Column names seen in the wild → what they mean to us. Compared lowercased. */
export const COLUMN_ALIASES = {
  brand: ['brand', 'brand name', 'brand_name', 'brandname', 'product', 'product name', 'trade name', 'tradename', 'medicine', 'medicine name', 'drug', 'drug name', 'name of drug', 'item'],
  composition: ['composition', 'generic', 'generic name', 'salt', 'salt composition', 'molecule', 'api', 'content', 'drug composition', 'active ingredient', 'ingredients'],
  form: ['form', 'dosage form', 'dosageform', 'presentation', 'type'],
  strength: ['strength', 'dose', 'dosage', 'potency', 'label claim', 'strength/unit'],
  manufacturer: ['manufacturer', 'company', 'marketer', 'mfr', 'manufactured by', 'brand owner', 'applicant'],
  schedule: ['schedule', 'schedule h', 'drug schedule', 'schedule type'],
};

const slug = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Minimal RFC-4180 CSV reader, in two pieces.
 *
 * `forEachCsvRow` is the real one: it hands each record to a callback and keeps
 * nothing, so a 31 MB, 254,000-row export costs one row of memory instead of a
 * quarter of a million arrays. The first version of this file collected every
 * row and was killed by the OOM killer on exactly that file — a real dataset is
 * not a fixture, and an importer that dies is an importer nobody trusts.
 */
export function forEachCsvRow(text, onRow, delimiter = ',') {
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  let row = [];
  let field = '';
  let quoted = false;
  let any = false;
  const flushRow = () => {
    row.push(field);
    field = '';
    if (row.some((cell) => String(cell).trim() !== '')) onRow(row);
    row = [];
    any = false;
  };
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    any = true;
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(field); field = ''; }
    else if (ch === '\n') flushRow();
    else if (ch === '\r') { /* swallowed; \n ends the record */ }
    else field += ch;
  }
  if (any || field.length || row.length) flushRow();
}

/** The same reader, collected — used by tests and by small files. */
export function parseCsv(text, delimiter = ',') {
  const rows = [];
  forEachCsvRow(text, (row) => rows.push(row), delimiter);
  return rows;
}

/** Work out which column is which, from the header row. Unmapped columns are dropped. */
export function guessColumns(header = []) {
  const keys = header.map(slug);
  const found = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const index = keys.findIndex((key) => aliases.includes(key));
    if (index !== -1) found[field] = index;
  }
  return found;
}

/** '500mg' → '500 mg'; '10mg+5mg' → '10 mg + 5 mg'. Cheap, and it prints better. */
export function tidyStrength(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/(\d)\s*(mg|mcg|g|ml|iu|%)\b/gi, '$1 $2')
    .replace(/\s*\+\s*/g, ' + ')
    .trim();
}

/** 'AMOXICILLIN+CLAVULANIC ACID' → 'Amoxicillin + Clavulanic acid'. */
export function tidyComposition(value) {
  return String(value ?? '')
    .split('+')
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' + ');
}

const SCHEDULES = new Set(['OTC', 'H', 'H1', 'X']);


/* ------------------------------------------------------------------------- *
 * Preset: the "Indian Medicine Dataset" shape
 *
 * github.com/junioralive/Indian-Medicine-Dataset — 253,973 products scraped
 * from an Indian pharmacy catalogue. One row per *pack*, with the form and the
 * strength embedded in free text:
 *
 *   name                       Augmentin 625 Duo Tablet
 *   short_composition1         Amoxycillin  (500mg)
 *   short_composition2           Clavulanic Acid (125mg)
 *   Is_discontinued            FALSE
 *
 * Three things have to be undone before this can be a prescription catalogue:
 * the form has to come out of the name, the strength has to come out of the
 * composition, and the same brand in four pack sizes has to become one row.
 * That is all this preset does.
 * ------------------------------------------------------------------------- */

/** Words that name a dosage form rather than a brand. */
export const FORM_WORDS = [
  'tablet', 'tablets', 'capsule', 'capsules', 'syrup', 'suspension', 'injection', 'infusion',
  'cream', 'ointment', 'gel', 'drops', 'drop', 'spray', 'inhaler', 'rotacap', 'respules',
  'sachet', 'powder', 'granules', 'lotion', 'shampoo', 'suppository', 'patch', 'solution',
  'emulsion', 'mouthwash', 'paste', 'foam', 'liniment', 'elixir', 'lozenge', 'lozenges',
  'vial', 'ampoule', 'liquid', 'granules', 'dusting', 'oral', 'topical', 'ophthalmic',
];

const FORM_CANON = {
  tablet: 'Tablet', tablets: 'Tablet', capsule: 'Capsule', capsules: 'Capsule',
  syrup: 'Syrup', suspension: 'Suspension', injection: 'Injection', infusion: 'Infusion',
  cream: 'Cream', ointment: 'Ointment', gel: 'Gel', drops: 'Drops', drop: 'Drops',
  spray: 'Spray', inhaler: 'Inhaler', rotacap: 'Rotacap', respules: 'Respules',
  sachet: 'Sachet', powder: 'Powder', granules: 'Granules', lotion: 'Lotion',
  shampoo: 'Shampoo', suppository: 'Suppository', patch: 'Patch', solution: 'Solution',
  emulsion: 'Emulsion', mouthwash: 'Mouthwash', paste: 'Paste', foam: 'Foam',
  liniment: 'Liniment', elixir: 'Elixir', lozenge: 'Lozenges', lozenges: 'Lozenges',
  vial: 'Injection', ampoule: 'Injection', liquid: 'Syrup', dusting: 'Powder',
};

/** 'Augmentin 625 Duo Tablet' → 'Tablet'. Null when the name never says. */
export function formFromProductName(name) {
  const tokens = String(name ?? '').split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    const key = token.toLowerCase().replace(/[^a-z]/g, '');
    if (FORM_CANON[key]) return FORM_CANON[key];
  }
  return null;
}

/** 'Dolo 650 Tablet SR' → 'Dolo 650 SR'. Only the form word is removed. */
export function brandFromProductName(name) {
  const tokens = String(name ?? '').split(/\s+/).filter(Boolean);
  const kept = tokens.filter((token) => {
    const key = token.toLowerCase().replace(/[^a-z]/g, '');
    return !FORM_WORDS.includes(key);
  });
  return (kept.length ? kept : tokens).join(' ').replace(/\s+/g, ' ').trim();
}

/** 'Amoxycillin  (500mg)' → { molecule: 'Amoxycillin', strength: '500 mg' }. */
export function parseCompositionPart(part) {
  const text = String(part ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const match = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(text);
  const molecule = (match ? match[1] : text).replace(/\s+/g, ' ').trim();
  const strength = match ? tidyStrength(match[2]) : '';
  if (!molecule) return null;
  // A pack that says "(as trihydrate)" is telling us about the salt form, not
  // the dose: keep the molecule, drop a strength that is not a quantity.
  const dose = /\d/.test(strength) ? strength : '';
  return { molecule: normaliseMolecule(molecule), strength: dose };
}

/**
 * Salt forms and spellings that must not stop two rows being the same drug.
 *
 * A directory row and a catalogue row are matched on the composition string, so
 * "Amoxycillin" (the spelling an Indian pack uses, and the one this dataset
 * carries) would otherwise never clash with the formulary's "Amoxicillin" — and
 * the duplicate-molecule warning would stay silent on a doubled dose. The same
 * goes for salt forms: "Pantoprazole Sodium" is Pantoprazole.
 *
 * This is deliberately a small, readable list rather than a clever rule. For the
 * long tail, scripts/rxnorm-composition.mjs asks RxNorm for the canonical name.
 */
export const SALT_WORDS = [
  'sodium', 'potassium', 'hydrochloride', 'hcl', 'calcium', 'sulphate', 'sulfate', 'tartrate',
  'maleate', 'succinate', 'besylate', 'mesylate', 'mesilate', 'trihydrate', 'dihydrate',
  'monohydrate', 'anhydrous', 'acetate', 'propionate', 'furoate', 'nitrate', 'citrate',
  'phosphate', 'dipropionate', 'valerate', 'butyrate', 'stearate', 'fumarate', 'oxalate',
  'lactate', 'gluconate', 'palmitate', 'decanoate', 'enantate', 'proxetil', 'axetil',
  'medoxomil', 'cilexetil', 'erbumine', 'trometamol', 'hydrate',
];

export const MOLECULE_SYNONYMS = {
  amoxycillin: 'Amoxicillin',
  acetaminophen: 'Paracetamol',
  chlorphenamine: 'Chlorpheniramine',
  frusemide: 'Furosemide',
  lignocaine: 'Lidocaine',
  adrenaline: 'Adrenaline',
  noradrenaline: 'Noradrenaline',
  'vitamin b1': 'Thiamine',
  'vitamin b6': 'Pyridoxine',
  'vitamin b12': 'Methylcobalamin',
  'vitamin c': 'Ascorbic acid',
  'vitamin d3': 'Cholecalciferol',
};

/** 'Pantoprazole Sodium' → 'Pantoprazole'; 'Amoxycillin' → 'Amoxicillin'. */
export function normaliseMolecule(molecule) {
  const tokens = String(molecule ?? '').split(/\s+/).filter(Boolean);
  // Never strip a name down to nothing: "Calcium Carbonate" keeps both words.
  while (tokens.length > 1 && SALT_WORDS.includes(tokens[tokens.length - 1].toLowerCase())) tokens.pop();
  const name = tokens.join(' ').replace(/\s+/g, ' ').trim();
  if (!name) return '';
  const synonym = MOLECULE_SYNONYMS[name.toLowerCase()];
  const out = synonym ?? name;
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** Join short_composition1 + short_composition2 into a directory row. */
export function compositionFromParts(parts = []) {
  const parsed = parts.map(parseCompositionPart).filter(Boolean);
  if (!parsed.length) return { composition: '', strength: '' };
  const molecules = [];
  for (const part of parsed) {
    // 'Amoxycillin Trihydrate' next to 'Amoxycillin' is the same molecule twice.
    const key = part.molecule.toLowerCase().split(' ')[0];
    if (molecules.some((m) => m.toLowerCase().split(' ')[0] === key)) continue;
    molecules.push(part.molecule);
  }
  const strengths = parsed.map((p) => p.strength).filter(Boolean);
  return { composition: molecules.join(' + '), strength: [...new Set(strengths)].join(' + ') };
}

/** Is this header row the Indian Medicine Dataset? */
export function isIndianMedicineDataset(header = []) {
  const keys = header.map(slug);
  return keys.includes('name') && keys.some((k) => k.startsWith('short composition'));
}

/** The same signals, for a JSON export of it. */
export function isIndianMedicineRecord(item = {}) {
  return Boolean((item.name ?? item.brand_name) && (item.short_composition1 ?? item.shortComposition1) !== undefined);
}

/** One Indian Medicine Dataset row → a directory row, or a reason to skip. */
export function mapDatasetRow(cells, columns, { includeDiscontinued = false } = {}) {
  const at = (field) => (columns[field] == null ? '' : String(cells[columns[field]] ?? '').trim());
  const name = at('name').replace(/\s+/g, ' ');
  const discontinued = /^(true|1|yes)$/i.test(at('discontinued'));
  if (discontinued && !includeDiscontinued) return { skipped: `${name}: discontinued`, discontinued: true };
  if (!name) return { skipped: 'no product name' };
  const parts = [at('composition1'), at('composition2')].filter(Boolean);
  const { composition, strength } = compositionFromParts(parts);
  if (!composition) return { skipped: `${name}: no composition` };
  const brand = brandFromProductName(name);
  if (!brand) return { skipped: `${name}: no brand name` };
  return {
    row: {
      brand_name: brand,
      composition,
      form: formFromProductName(name),
      strength: strength || null,
      manufacturer: at('manufacturer') || null,
      schedule: null,
      keywords: slug(`${brand} ${composition} ${at('manufacturer')} ${at('pack')}`),
      source: 'import',
    },
  };
}

const DATASET_COLUMNS = {
  name: 1, composition1: 7, composition2: 8, manufacturer: 4, discontinued: 3, pack: 6, type: 5,
};

/** One raw row → a directory row, or a reason it was skipped. */
export function mapRow(cells, columns) {
  const at = (field) => (columns[field] == null ? '' : String(cells[columns[field]] ?? '').trim());
  const brand = at('brand').replace(/\s+/g, ' ');
  const composition = tidyComposition(at('composition'));
  if (!brand) return { skipped: 'no brand name' };
  if (!composition) return { skipped: `${brand}: no composition` };
  if (brand.length > 160) return { skipped: `${brand.slice(0, 24)}…: brand name too long` };
  const schedule = SCHEDULES.has(at('schedule').toUpperCase()) ? at('schedule').toUpperCase() : null;
  return {
    row: {
      brand_name: brand,
      composition,
      form: at('form') || null,
      strength: tidyStrength(at('strength')) || null,
      manufacturer: at('manufacturer') || null,
      schedule,
      keywords: slug(`${brand} ${composition} ${at('manufacturer')}`),
      source: 'import',
    },
  };
}

/** Identity is the same one the database enforces: brand + strength + form. */
export const rowKey = (row) => `${slug(row.brand_name)}|${slug(tidyStrength(row.strength))}|${slug(row.form)}`;

/** Read a file (CSV, TSV or JSON) into `{ rows, skipped, total }`. */
export function readDrugFile(text, { filename = '', preset = null, limit = 0 } = {}) {
  const trimmed = String(text ?? '').trim();
  const isJson = filename.toLowerCase().endsWith('.json') || trimmed.startsWith('[') || trimmed.startsWith('{');

  if (isJson) {
    if (trimmed.length > 40_000_000) {
      throw new Error('that JSON file is too large to load in memory — use the CSV export of the same data');
    }
    return readJsonDrugs(trimmed, { preset, limit });
  }

  const delimiter = filename.toLowerCase().endsWith('.tsv') || (trimmed.split('\n')[0] ?? '').includes('\t') ? '\t' : ',';

  const acc = newAccumulator();
  let header = null;
  let columns = null;
  let presetName = 'generic';
  forEachCsvRow(trimmed, (cells) => {
    if (!header) {
      header = cells;
      // The Indian Medicine Dataset needs its own mapping: form and strength are
      // inside free text there, not in columns of their own.
      if (preset === 'inmd' || (!preset && isIndianMedicineDataset(header))) {
        presetName = 'inmd';
        columns = DATASET_COLUMNS;
      } else {
        columns = guessColumns(header);
        if (columns.brand == null || columns.composition == null) {
          throw new Error(`could not find a brand and a composition column in: ${header.join(' | ')}`);
        }
      }
      return;
    }
    if (limit && acc.rows.length >= limit) return;
    const mapped = presetName === 'inmd' ? mapDatasetRow(cells, columns) : mapRow(cells, columns);
    accept(acc, mapped);
  }, delimiter);

  return finish(acc, { preset: presetName, limit });
}

/** JSON exports: the generic shape, or the dataset's own. */
function readJsonDrugs(trimmed, { preset = null, limit = 0 } = {}) {
  const parsed = JSON.parse(trimmed);
  const list = Array.isArray(parsed) ? parsed : (parsed.data ?? parsed.rows ?? parsed.records ?? []);
  const dataset = preset === 'inmd' || (!preset && list.length > 0 && isIndianMedicineRecord(list[0]));
  const acc = newAccumulator();
  for (const item of list) {
    if (limit && acc.rows.length >= limit) break;
    const mapped = dataset
      ? mapDatasetRow(
        [item.id, item.name, item['price(₹)'], item.Is_discontinued, item.manufacturer_name,
          item.type, item.pack_size_label, item.short_composition1, item.short_composition2],
        DATASET_COLUMNS,
      )
      : mapRow(
        [item.brand_name ?? item.brandName ?? item.brand ?? item.product_name ?? item.name,
          item.composition ?? item.generic ?? item.salt ?? item.content,
          item.form ?? item.dosage_form, item.strength ?? item.dose,
          item.manufacturer ?? item.company, item.schedule],
        { brand: 0, composition: 1, form: 2, strength: 3, manufacturer: 4, schedule: 5 },
      );
    accept(acc, mapped);
  }
  return finish(acc, { preset: dataset ? 'inmd' : 'generic', limit });
}

/**
 * Counters, not lists: a 254,000-row file skips thousands of rows and repeats
 * thousands more, and holding every reason (or every brand) in memory is how an
 * importer becomes an outage. Fifty examples are enough to see the pattern.
 */
function newAccumulator() {
  return {
    rows: [], seen: new Set(), skipped: [], skippedCount: 0, discontinued: 0,
    duplicateCount: 0, duplicates: [], total: 0,
  };
}

const SAMPLE = 50;

function accept(acc, mapped) {
  acc.total += 1;
  if (mapped.skipped) {
    acc.skippedCount += 1;
    if (mapped.discontinued) acc.discontinued += 1;
    if (acc.skipped.length < SAMPLE) acc.skipped.push(mapped.skipped);
    return;
  }
  const key = rowKey(mapped.row);
  if (acc.seen.has(key)) {
    acc.duplicateCount += 1;
    if (acc.duplicates.length < SAMPLE) acc.duplicates.push(mapped.row.brand_name);
    return;
  }
  acc.seen.add(key);
  acc.rows.push(mapped.row);
}

function finish(acc, { preset, limit }) {
  return {
    rows: limit ? acc.rows.slice(0, limit) : acc.rows,
    skipped: acc.skipped,
    skippedCount: acc.skippedCount,
    duplicates: acc.duplicates,
    duplicateCount: acc.duplicateCount,
    discontinued: acc.discontinued,
    total: acc.total,
    preset,
  };
}

const quote = (value) => (value == null ? 'null' : `'${String(value).replace(/'/g, "''")}'`);

/** The rows as an idempotent SQL insert, ready for the Supabase SQL editor. */
export function toInsertSql(rows, { batch = 200, inheritClasses = false } = {}) {
  if (!rows.length) return '-- nothing to import\n';
  const columns = ['brand_name', 'composition', 'form', 'strength', 'manufacturer', 'schedule', 'keywords', 'source'];
  const chunks = [];
  for (let i = 0; i < rows.length; i += batch) {
    const slice = rows.slice(i, i + batch);
    const values = slice.map((row) => `  (${columns.map((c) => quote(row[c])).join(', ')})`).join(',\n');
    chunks.push(`insert into public.medicines (${columns.join(', ')}) values\n${values}\non conflict do nothing;`);
  }
  return `${chunks.join('\n\n')}\n${inheritClasses ? `\n${INHERIT_CLASSES_SQL}` : ''}`;
}

/**
 * Copy the safety metadata the dataset does not carry.
 *
 * The Indian Medicine Dataset has no dispensing schedule and no drug classes, but
 * the clinic's own 59 curated rows do — and a class is what makes "two NSAIDs",
 * the penicillin allergy warning and the H1 register notice fire. This statement
 * gives every imported row the classes and schedule of the curated row with the
 * same first molecule, so a 1mg-sourced "Pantocid 40" is checked exactly like the
 * shipped "Pan 40".
 */
export const INHERIT_CLASSES_SQL = `-- Give imported rows the safety metadata of the curated formulary, by molecule.
-- Safe to run more than once; it never overwrites a class a row already has.
update public.medicines m
   set classes  = case when cardinality(m.classes) = 0 then s.classes else m.classes end,
       schedule = coalesce(m.schedule, s.schedule),
       updated_at = now()
  from public.medicines s
 where s.source = 'formulary'
   and m.source <> 'formulary'
   and cardinality(s.classes) > 0
   and lower(split_part(btrim(m.composition), ' + ', 1)) = lower(split_part(btrim(s.composition), ' + ', 1))
   and (cardinality(m.classes) = 0 or m.schedule is null);
`;

const INSERT_COLUMNS = ['brand_name', 'composition', 'form', 'strength', 'manufacturer', 'schedule', 'keywords', 'source'];

/**
 * Write the insert statement a batch at a time.
 *
 * A 242,000-row import is a 45 MB file; building that string in memory first is
 * how the importer gets killed halfway and leaves a half-written statement. This
 * streams it, so memory stays flat however large the catalogue is.
 */
export async function writeInsertSqlFile(rows, path, { batch = 1000, inheritClasses = false } = {}) {
  const out = createWriteStream(path, 'utf8');
  // One error listener for the life of the stream: adding one per write is a
  // leak (and Node says so, loudly, on a 242,000-row file).
  let failed = null;
  out.on('error', (error) => { failed = error; });
  const write = (chunk) => new Promise((resolve, reject) => {
    if (failed) return reject(failed);
    if (out.write(chunk)) return resolve();
    return out.once('drain', resolve);
  });
  for (let i = 0; i < rows.length; i += batch) {
    const slice = rows.slice(i, i + batch);
    const values = slice.map((row) => `  (${INSERT_COLUMNS.map((c) => quote(row[c])).join(', ')})`).join(',\n');
    await write(`insert into public.medicines (${INSERT_COLUMNS.join(', ')}) values\n${values}\non conflict do nothing;\n\n`);
  }
  if (inheritClasses) await write(`${INHERIT_CLASSES_SQL}\n`);
  await new Promise((resolve) => out.end(resolve));
  return rows.length;
}

/** Push through PostgREST with the service role. Duplicates are ignored, never updated. */
async function push(rows, { url, key, batch = 200 }) {
  let sent = 0;
  for (let i = 0; i < rows.length; i += batch) {
    const slice = rows.slice(i, i + batch);
    const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/medicines?on_conflict=brand_name,strength,form`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify(slice),
    });
    if (!res.ok) {
      throw new Error(`import failed at row ${i}: ${res.status} ${await res.text()}`);
    }
    sent += slice.length;
  }
  return sent;
}

async function main(argv) {
  const arg = (flag) => {
    const i = argv.indexOf(flag);
    return i === -1 ? null : argv[i + 1];
  };
  const file = arg('--file');
  if (!file) {
    console.error('usage: node scripts/import-medicines.mjs --file <drugs.csv|drugs.json> [--preset inmd] [--limit N] [--sql out.sql] [--inherit-classes] [--push]');
    process.exit(2);
  }
  const preset = arg('--preset');
  const limit = Number(arg('--limit') ?? 0) || 0;

  const text = await readFile(file, 'utf8');
  const result = readDrugFile(text, { filename: file, preset, limit });
  console.log(`read ${result.total} rows from ${file}`);
  if (result.preset === 'inmd') console.log('  (Indian Medicine Dataset shape: form and strength pulled out of the free text)');
  const dupNote = result.duplicateCount ? `, ${result.duplicateCount} collapsed (same brand, strength and form in another pack)` : '';
  console.log(`  ${result.rows.length} importable${limit ? ` (limited to ${limit})` : ''}, ${result.skippedCount} skipped${dupNote}`);
  if (result.discontinued) console.log(`  ${result.discontinued} of the skipped rows are discontinued products`);
  for (const reason of result.skipped.slice(0, 5)) console.log(`  skipped: ${reason}`);
  if (result.skippedCount > 5) console.log(`  … ${result.skippedCount - 5} more skipped rows (same reasons)`);
  for (const row of result.rows.slice(0, 5)) {
    console.log(`  ${row.brand_name} — ${row.composition}${row.strength ? ` · ${row.strength}` : ''}${row.form ? ` · ${row.form}` : ''}`);
  }
  if (result.rows.length > 5) console.log(`  … and ${result.rows.length - 5} more`);

  const outFile = arg('--sql');
  if (outFile) {
    const inherit = argv.includes('--inherit-classes');
    if (result.rows.length > 5000) {
      await writeInsertSqlFile(result.rows, outFile, { inheritClasses: inherit });
      console.log(`wrote ${outFile} in batches — too big for the SQL editor: open it with psql or the Supabase CLI`);
      console.log(`  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f ${outFile}`);
    } else {
      await writeFile(outFile, toInsertSql(result.rows, { inheritClasses: inherit }), 'utf8');
      console.log(`wrote ${outFile} — paste it into the Supabase SQL editor (or psql -f it)`);
    }
  }

  if (argv.includes('--push')) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      console.error('--push needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment');
      process.exit(2);
    }
    const sent = await push(result.rows, { url, key });
    console.log(`pushed ${sent} rows to ${url}`);
    console.log('now run this once in the SQL editor, so the imported rows inherit the curated classes and schedules:');
    console.log(INHERIT_CLASSES_SQL);
  } else if (!outFile) {
    console.log('dry run — nothing was written. Add --sql <file> or --push to write.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
