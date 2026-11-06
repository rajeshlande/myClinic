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

/** Minimal RFC-4180 CSV reader: quotes, escaped quotes, CRLF, embedded newlines. */
export function parseCsv(text, delimiter = ',') {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch === '\r') { /* swallowed; \n ends the record */ }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  // Drop the trailing empty record a final newline leaves behind.
  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ''));
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
export function readDrugFile(text, { filename = '' } = {}) {
  const trimmed = String(text ?? '').trim();
  const isJson = filename.toLowerCase().endsWith('.json') || trimmed.startsWith('[') || trimmed.startsWith('{');

  if (isJson) {
    const parsed = JSON.parse(trimmed);
    const list = Array.isArray(parsed) ? parsed : (parsed.data ?? parsed.rows ?? parsed.records ?? []);
    const skipped = [];
    const rows = [];
    for (const item of list) {
      const cells = {
        brand: item.brand_name ?? item.brandName ?? item.brand ?? item.product_name ?? item.name,
        composition: item.composition ?? item.generic ?? item.salt ?? item.content,
        form: item.form ?? item.dosage_form,
        strength: item.strength ?? item.dose,
        manufacturer: item.manufacturer ?? item.company,
        schedule: item.schedule,
      };
      const mapped = mapRow(
        [cells.brand, cells.composition, cells.form, cells.strength, cells.manufacturer, cells.schedule],
        { brand: 0, composition: 1, form: 2, strength: 3, manufacturer: 4, schedule: 5 },
      );
      if (mapped.skipped) skipped.push(mapped.skipped);
      else rows.push(mapped.row);
    }
    return summarise(rows, skipped, list.length);
  }

  const delimiter = filename.toLowerCase().endsWith('.tsv') || (trimmed.split('\n')[0] ?? '').includes('\t') ? '\t' : ',';
  const table = parseCsv(trimmed, delimiter);
  const [header, ...body] = table;
  const columns = guessColumns(header);
  if (columns.brand == null || columns.composition == null) {
    throw new Error(`could not find a brand and a composition column in: ${header.join(' | ')}`);
  }
  const skipped = [];
  const rows = [];
  for (const cells of body) {
    const mapped = mapRow(cells, columns);
    if (mapped.skipped) skipped.push(mapped.skipped);
    else rows.push(mapped.row);
  }
  return summarise(rows, skipped, body.length);
}

function summarise(rows, skipped, total) {
  const seen = new Set();
  const unique = [];
  const duplicates = [];
  for (const row of rows) {
    const key = rowKey(row);
    if (seen.has(key)) { duplicates.push(row.brand_name); continue; }
    seen.add(key);
    unique.push(row);
  }
  return { rows: unique, skipped, duplicates, total };
}

const quote = (value) => (value == null ? 'null' : `'${String(value).replace(/'/g, "''")}'`);

/** The rows as an idempotent SQL insert, ready for the Supabase SQL editor. */
export function toInsertSql(rows, { batch = 200 } = {}) {
  if (!rows.length) return '-- nothing to import\n';
  const columns = ['brand_name', 'composition', 'form', 'strength', 'manufacturer', 'schedule', 'keywords', 'source'];
  const chunks = [];
  for (let i = 0; i < rows.length; i += batch) {
    const slice = rows.slice(i, i + batch);
    const values = slice.map((row) => `  (${columns.map((c) => quote(row[c])).join(', ')})`).join(',\n');
    chunks.push(`insert into public.medicines (${columns.join(', ')}) values\n${values}\non conflict do nothing;`);
  }
  return `${chunks.join('\n\n')}\n`;
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
    console.error('usage: node scripts/import-medicines.mjs --file <drugs.csv|drugs.json> [--sql out.sql] [--push]');
    process.exit(2);
  }

  const text = await readFile(file, 'utf8');
  const result = readDrugFile(text, { filename: file });
  console.log(`read ${result.total} rows from ${file}`);
  console.log(`  ${result.rows.length} importable, ${result.skipped.length} skipped, ${result.duplicates.length} duplicates in the file`);
  for (const reason of result.skipped.slice(0, 8)) console.log(`  skipped: ${reason}`);
  if (result.skipped.length > 8) console.log(`  … and ${result.skipped.length - 8} more skipped rows`);
  for (const row of result.rows.slice(0, 5)) {
    console.log(`  ${row.brand_name} — ${row.composition}${row.strength ? ` · ${row.strength}` : ''}${row.form ? ` · ${row.form}` : ''}`);
  }
  if (result.rows.length > 5) console.log(`  … and ${result.rows.length - 5} more`);

  const outFile = arg('--sql');
  if (outFile) {
    await writeFile(outFile, toInsertSql(result.rows), 'utf8');
    console.log(`wrote ${outFile} — paste it into the Supabase SQL editor (or psql -f it)`);
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
