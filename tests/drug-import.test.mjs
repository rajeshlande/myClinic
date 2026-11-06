import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COLUMN_ALIASES, INHERIT_CLASSES_SQL, brandFromProductName, compositionFromParts, forEachCsvRow,
  formFromProductName, guessColumns, isIndianMedicineDataset, mapRow, normaliseMolecule, parseCsv,
  readDrugFile, rowKey, tidyComposition, tidyStrength, toInsertSql, writeInsertSqlFile,
} from '../scripts/import-medicines.mjs';
import {
  MIN_MATCH, canonicaliseComposition, canonicaliseList, splitComposition,
} from '../scripts/rxnorm-composition.mjs';

const CSV = [
  'Brand Name,Composition,Dosage Form,Strength,Company',
  'Augmentin 625,AMOXICILLIN+CLAVULANIC ACID,Tablet,500mg+125mg,GSK',
  'Pantocid 40,pantoprazole,Tablet,40 mg,Sun Pharma',
  '"Zerodol, SP",Aceclofenac+Paracetamol,Tablet,100mg+325mg,Ipca',
  ',Paracetamol,Tablet,500 mg,Nobody',            // no brand → skipped
  'Mystery Tonic,,Syrup,,Local',                  // no composition → skipped
  'Pantocid 40,pantoprazole,Tablet,40 mg,Sun Pharma', // duplicate → collapsed
].join('\n');

// ------------------------------------------------------------------- the reader

test('CSV is read the way a spreadsheet wrote it, quotes and all', () => {
  const rows = parseCsv('a,b\n"x, y","he said ""hi"""\n\nlast,field');
  assert.deepEqual(rows, [['a', 'b'], ['x, y', 'he said "hi"'], ['last', 'field']]);
  assert.deepEqual(parseCsv('a\tb\n1\t2', '\t'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv(''), []);
});

test('the columns are recognised by the names the exports actually use', () => {
  const columns = guessColumns(['Trade Name', 'Generic Name', 'Dosage Form', 'Strength', 'Marketer']);
  assert.equal(columns.brand, 0);
  assert.equal(columns.composition, 1);
  assert.equal(columns.form, 2);
  assert.equal(columns.strength, 3);
  assert.equal(columns.manufacturer, 4);
  // a header with nothing we know maps nothing, rather than guessing a column
  assert.deepEqual(guessColumns(['alpha', 'beta']), {});
  assert.ok(COLUMN_ALIASES.brand.includes('trade name'));
});

test('a row becomes a directory row, tidied', () => {
  const columns = guessColumns(['Brand Name', 'Composition', 'Dosage Form', 'Strength', 'Company']);
  const { row } = mapRow(['Augmentin 625', 'AMOXICILLIN+CLAVULANIC ACID', 'Tablet', '500mg+125mg', 'GSK'], columns);
  assert.equal(row.brand_name, 'Augmentin 625');
  assert.equal(row.composition, 'Amoxicillin + Clavulanic acid');
  assert.equal(row.strength, '500 mg + 125 mg');
  assert.equal(row.form, 'Tablet');
  assert.equal(row.manufacturer, 'GSK');
  assert.equal(row.source, 'import');
  assert.match(row.keywords, /augmentin 625/);
});

test('a row without a brand or without a molecule is refused, with the reason', () => {
  const columns = guessColumns(['Brand Name', 'Composition']);
  assert.match(mapRow(['', 'Paracetamol'], columns).skipped, /no brand/);
  assert.match(mapRow(['Mystery Tonic', ''], columns).skipped, /no composition/);
});

test('strength and composition are printed the way a slip expects', () => {
  assert.equal(tidyStrength('500mg+125mg'), '500 mg + 125 mg');
  assert.equal(tidyStrength('  40   mg '), '40 mg');
  assert.equal(tidyComposition('AMOXICILLIN+CLAVULANIC ACID'), 'Amoxicillin + Clavulanic acid');
  assert.equal(tidyComposition(''), '');
});

test('an unknown dispensing schedule is stored as none, not as a guess', () => {
  const columns = guessColumns(['Brand Name', 'Composition', 'Schedule']);
  assert.equal(mapRow(['X 10', 'Y', 'H1'], columns).row.schedule, 'H1');
  assert.equal(mapRow(['X 10', 'Y', 'Q'], columns).row.schedule, null);
});

test('the whole file is read: importable, skipped and duplicate counts add up', () => {
  const result = readDrugFile(CSV, { filename: 'drugs.csv' });
  assert.equal(result.total, 6);
  assert.equal(result.rows.length, 3);
  assert.equal(result.skipped.length, 2);
  assert.equal(result.duplicates.length, 1);
  assert.deepEqual(result.rows.map((r) => r.brand_name), ['Augmentin 625', 'Pantocid 40', 'Zerodol, SP']);
});

test('a JSON export is read too, whatever it calls its wrapper', () => {
  const json = JSON.stringify({ data: [{ brandName: 'Calpol 250', generic: 'paracetamol', dose: '250mg/5ml', dosage_form: 'Syrup' }] });
  const result = readDrugFile(json, { filename: 'drugs.json' });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].brand_name, 'Calpol 250');
  assert.equal(result.rows[0].composition, 'Paracetamol');
  assert.equal(result.rows[0].source, 'import');
});

test('a file with no brand column is an error, not a silent empty import', () => {
  assert.throws(() => readDrugFile('alpha,beta\n1,2', { filename: 'x.csv' }), /could not find a brand/);
});

test('identity matches the database: brand + strength + form', () => {
  assert.equal(rowKey({ brand_name: 'Dolo 650', strength: '650 mg', form: 'Tablet' }), rowKey({ brand_name: 'DOLO-650', strength: '650mg', form: 'tablet' }));
  assert.notEqual(rowKey({ brand_name: 'Dolo 650', strength: '650 mg', form: 'Tablet' }), rowKey({ brand_name: 'Dolo 650', strength: '650 mg', form: 'Sachet' }));
});

test('the SQL is idempotent and escapes what a chemist typed', () => {
  const sql = toInsertSql([
    { brand_name: "D'Mannose 500", composition: 'D-Mannose', form: 'Sachet', strength: '500 mg', manufacturer: null, schedule: null, keywords: 'd mannose', source: 'import' },
  ]);
  assert.match(sql, /insert into public\.medicines/);
  assert.match(sql, /'D''Mannose 500'/);
  assert.match(sql, /null/);
  assert.match(sql, /on conflict do nothing;/);
  assert.equal(toInsertSql([]), '-- nothing to import\n');
});

// -------------------------------------------------------------------- rxnorm

test('a composition is split into molecules for matching', () => {
  assert.deepEqual(splitComposition('Amoxicillin + Clavulanic acid'), ['Amoxicillin', 'Clavulanic acid']);
  assert.deepEqual(splitComposition('Amoxycillin Trihydrate'), ['Amoxycillin']);
  assert.deepEqual(splitComposition('Metformin hydrochloride (SR)'), ['Metformin']);
  assert.deepEqual(splitComposition(''), []);
});

test('a close RxNorm match re-spells the molecule, and nothing else is touched', async () => {
  const lookup = async (term) => (term.toLowerCase() === 'amoxycillin'
    ? { rxcui: '723', score: 0.95, name: 'amoxicillin' }
    : null);
  const result = await canonicaliseComposition('Amoxycillin + Clavulanic acid', { lookup });
  assert.equal(result.composition, 'Amoxicillin + Clavulanic acid');
  assert.equal(result.changed, true);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].from, 'Amoxycillin');
  assert.equal(result.matches[0].to, 'Amoxicillin');
});

test('a weak match or no match leaves the source spelling alone', async () => {
  const weak = await canonicaliseComposition('Amoxycillin', { lookup: async () => ({ rxcui: '1', score: MIN_MATCH - 0.2, name: 'amoxicillin' }) });
  assert.equal(weak.composition, 'Amoxycillin');
  assert.equal(weak.changed, false);
  const none = await canonicaliseComposition('Unicornium', { lookup: async () => null });
  assert.equal(none.composition, 'Unicornium');
  assert.equal(none.changed, false);
  // and an empty composition is not an error
  assert.equal((await canonicaliseComposition('', { lookup: async () => null })).composition, '');
});

test('a whole list is cleaned in order, one at a time', async () => {
  const calls = [];
  const lookup = async (term) => { calls.push(term); return null; };
  const out = await canonicaliseList(['Paracetamol', 'Pantoprazole'], { lookup, pauseMs: 0 });
  assert.equal(out.length, 2);
  assert.deepEqual(calls, ['Paracetamol', 'Pantoprazole']);
  assert.equal(out[0].composition, 'Paracetamol');
});

/* ------------------------------------------- the Indian Medicine Dataset */

const INMD_CSV = [
  'id,name,price(₹),Is_discontinued,manufacturer_name,type,pack_size_label,short_composition1,short_composition2',
  '1,Augmentin 625 Duo Tablet,223.42,FALSE,Glaxo SmithKline Pharmaceuticals Ltd,allopathy,strip of 10 tablets,Amoxycillin  (500mg) ,Clavulanic Acid (125mg)',
  '2,Azithral 500 Tablet,132.36,FALSE,Alembic Pharmaceuticals Ltd,allopathy,strip of 5 tablets,Azithromycin (500mg),',
  '3,Azee 250 Tablet,54.10,TRUE,Cipla Ltd,allopathy,strip of 10 tablets,Azithromycin (250mg),',
  '4,Dolo 650 Tablet,30.50,FALSE,Micro Labs Ltd,allopathy,strip of 15 tablets,Paracetamol (650mg),',
  '5,Dolo 650 Tablet,30.50,FALSE,Micro Labs Ltd,allopathy,strip of 10 tablets,Paracetamol (650mg),',
  '6,Calpol 250mg/5ml Suspension,62.00,FALSE,GSK,allopathy,bottle of 60 ml,Paracetamol (250mg/5ml),',
].join('\n');

test('the dataset is recognised by its header, and its rows are understood', () => {
  assert.equal(isIndianMedicineDataset(['id', 'name', 'price(₹)', 'Is_discontinued', 'manufacturer_name', 'type', 'pack_size_label', 'short_composition1', 'short_composition2']), true);
  assert.equal(isIndianMedicineDataset(['Brand Name', 'Composition']), false);

  const result = readDrugFile(INMD_CSV, { filename: 'indian_medicine_data.csv' });
  assert.equal(result.preset, 'inmd');
  assert.equal(result.total, 6);
  assert.equal(result.discontinued, 1, 'the discontinued product is counted');
  assert.equal(result.skippedCount, 1);
  assert.equal(result.duplicateCount, 1, 'the same brand in two pack sizes is one row');
  assert.deepEqual(result.rows.map((r) => r.brand_name), ['Augmentin 625 Duo', 'Azithral 500', 'Dolo 650', 'Calpol 250mg/5ml']);
});

test('the form comes out of the name and the strength out of the composition', () => {
  const result = readDrugFile(INMD_CSV, { filename: 'x.csv' });
  const augmentin = result.rows.find((r) => r.brand_name === 'Augmentin 625 Duo');
  assert.equal(augmentin.composition, 'Amoxicillin + Clavulanic Acid');
  assert.equal(augmentin.strength, '500 mg + 125 mg');
  assert.equal(augmentin.form, 'Tablet');
  assert.equal(augmentin.manufacturer, 'Glaxo SmithKline Pharmaceuticals Ltd');
  const calpol = result.rows.find((r) => r.brand_name.startsWith('Calpol'));
  assert.equal(calpol.form, 'Suspension');
  assert.equal(calpol.strength, '250 mg/5 ml');
});

test('a brand is the name without the form word, and nothing more', () => {
  assert.equal(brandFromProductName('Augmentin 625 Duo Tablet'), 'Augmentin 625 Duo');
  assert.equal(brandFromProductName('Dolo 650 Tablet SR'), 'Dolo 650 SR');
  assert.equal(brandFromProductName('Alkamax MB Oral'), 'Alkamax MB');
  assert.equal(formFromProductName('Human Actrapid Injection 40 IU/ml'), 'Injection');
  assert.equal(formFromProductName('Otrivin Nasal Spray'), 'Spray');
  assert.equal(formFromProductName('Mystery Tonic'), null);
});

test('salt forms and Indian spellings do not hide the same drug', () => {
  assert.equal(normaliseMolecule('Amoxycillin'), 'Amoxicillin');
  assert.equal(normaliseMolecule('Acetaminophen'), 'Paracetamol');
  assert.equal(normaliseMolecule('Pantoprazole Sodium'), 'Pantoprazole');
  assert.equal(normaliseMolecule('Cefpodoxime Proxetil'), 'Cefpodoxime');
  // a drug that *is* a salt keeps its name
  assert.equal(normaliseMolecule('Calcium Carbonate'), 'Calcium Carbonate');
  assert.equal(normaliseMolecule('Sodium Bicarbonate'), 'Sodium Bicarbonate');
  assert.equal(normaliseMolecule(''), '');
  // and the whole composition inherits the normalisation
  assert.deepEqual(compositionFromParts(['Amoxycillin (500mg)', 'Clavulanic Acid (125mg)']), {
    composition: 'Amoxicillin + Clavulanic Acid', strength: '500 mg + 125 mg',
  });
});

test('the same molecule twice in one composition is listed once', () => {
  assert.equal(compositionFromParts(['Amoxycillin (500mg)', 'Amoxicillin (250mg)']).composition, 'Amoxicillin');
});

test('a limit stops at N importable rows and is reported', () => {
  const result = readDrugFile(INMD_CSV, { filename: 'x.csv', limit: 2 });
  assert.equal(result.rows.length, 2);
});

test('the CSV reader streams, and gives the same rows as the collected one', () => {
  const text = 'a,b\n"x, y","he said ""hi"""\n\nlast,field\n';
  const collected = [];
  forEachCsvRow(text, (row) => collected.push(row));
  assert.deepEqual(collected, parseCsv(text));
  assert.deepEqual(collected, [['a', 'b'], ['x, y', 'he said "hi"'], ['last', 'field']]);
});

test('the inherited-safety SQL is offered when asked for', () => {
  const rows = [{ brand_name: 'Pantocid 40', composition: 'Pantoprazole', form: 'Tablet', strength: '40 mg', manufacturer: null, schedule: null, keywords: '', source: 'import' }];
  assert.doesNotMatch(toInsertSql(rows), /update public\.medicines/);
  const withInherit = toInsertSql(rows, { inheritClasses: true });
  assert.match(withInherit, /update public\.medicines m/);
  assert.match(withInherit, /source = 'formulary'/);
  // it must never overwrite a class that is already there
  assert.match(withInherit, /cardinality\(m\.classes\) = 0/);
});

// --------------------------------------- a 44 MB file is written, not assembled

test('a large import is written in batches, and psql can read it', async () => {
  const { mkdtemp, readFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'inmd-sql-'));
  const path = join(dir, 'import.sql');

  const rows = Array.from({ length: 2500 }, (_, i) => ({
    brand_name: `Brand ${i}`, composition: 'Paracetamol', form: 'Tablet', strength: '500 mg',
    manufacturer: 'Test Labs', schedule: null, keywords: '', source: 'import',
  }));
  const written = await writeInsertSqlFile(rows, path, { batch: 1000 });
  assert.equal(written, 2500);

  const sql = await readFile(path, 'utf8');
  const statements = sql.match(/^insert into public\.medicines/gm) ?? [];
  assert.equal(statements.length, 3, 'one statement per 1,000 rows');
  assert.match(sql, /on conflict do nothing;/);
  assert.equal((sql.match(/^  \(/gm) ?? []).length, 2500);
  assert.doesNotMatch(sql, /INHERIT/i, 'no class inheritance unless it was asked for');
});

test('--inherit-classes appends the inheritance statement, once', async () => {
  const { mkdtemp, readFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'inmd-sql-'));
  const path = join(dir, 'import.sql');
  const rows = [{ brand_name: 'X 1', composition: 'Paracetamol', form: 'Tablet', strength: '500 mg', manufacturer: '', schedule: null, keywords: '', source: 'import' }];

  await writeInsertSqlFile(rows, path, { batch: 500, inheritClasses: true });
  const sql = await readFile(path, 'utf8');
  assert.equal(sql.split(INHERIT_CLASSES_SQL).length - 1, 1);
});
