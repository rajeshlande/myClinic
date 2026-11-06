import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FUZZY_FLOOR, FUZZY_MIN_LENGTH, MAX_RESULTS, MIN_QUERY_LENGTH, TIERS,
  editDistance, foldDoseUnits, highlightRanges, mergeSearchResults, normaliseDrugText,
  scoreMedicine, searchCatalogue, similarity, trigrams,
} from '../src/lib/drug-search.mjs';
import {
  MEDICINES, formCode, medicineFromDirectoryRow, searchMedicines,
} from '../src/lib/medicines.mjs';

const brands = (list) => list.map((m) => m.brand);

// ------------------------------------------------------------------ the basics

test('search text is folded the way a clinic types it', () => {
  assert.equal(normaliseDrugText('  Dolo   650 '), 'dolo 650');
  assert.equal(normaliseDrugText('Augmentin-625'), 'augmentin 625');
  assert.equal(foldDoseUnits('Dolo 650 mg'), 'dolo 650mg');
  assert.equal(foldDoseUnits('Asthalin 100 mcg'), 'asthalin 100mcg');
  assert.equal(normaliseDrugText(''), '');
  assert.equal(normaliseDrugText(null), '');
});

test('trigram similarity behaves like pg_trgm: 1 for identical, 0 for unrelated', () => {
  assert.equal(similarity('augmentin', 'augmentin'), 1);
  assert.equal(similarity('augmentin', 'zzzzzzzz'), 0);
  const oneLetterOff = similarity('augmentin', 'augmentn');
  assert.ok(oneLetterOff > FUZZY_FLOOR, `one missing letter should clear the floor (${oneLetterOff})`);
  assert.ok(oneLetterOff < 1);
  // symmetric, and a near miss outranks a distant word
  assert.equal(similarity('dolo', 'dol'), similarity('dol', 'dolo'));
  assert.ok(similarity('augmentin', 'augmentn') > similarity('augmentin', 'azithral'));
  assert.equal(trigrams('').size, 0);
});

// ---------------------------------------------------------------- the ranking

test('a brand prefix ranks its own brand first', () => {
  assert.equal(brands(searchCatalogue(MEDICINES, 'dolo'))[0], 'Dolo 650');
  assert.equal(brands(searchCatalogue(MEDICINES, 'pan'))[0], 'Pan 40');
  assert.equal(brands(searchCatalogue(MEDICINES, 'azithral'))[0], 'Azithral');
});

test('an exact brand name scores at the top of the table', () => {
  const [first] = searchCatalogue(MEDICINES, 'Montair-LC');
  assert.equal(first.brand, 'Montair-LC');
  assert.equal(first.score, TIERS.brandExact);
});

test('word starts inside a brand are found, not just the first word', () => {
  const results = searchCatalogue(MEDICINES, 'advance');
  assert.equal(results[0]?.brand, 'Crocin Advance');
});

test('a molecule finds every brand that contains it', () => {
  const results = searchCatalogue(MEDICINES, 'paracetamol');
  assert.ok(results.length >= 3);
  for (const row of results.slice(0, 3)) assert.match(row.salt, /paracetamol/i);
});

test('typos still find the drug — the reason this file exists', () => {
  const cases = [
    ['augmentn', 'Augmentin 625'],     // one letter dropped
    ['amoxycillin', 'Mox'],            // the spelling a clinic actually writes
    ['metformn', 'Glycomet'],          // one letter dropped
    ['crocn', 'Crocin Advance'],       // vowel dropped
  ];
  for (const [typo, expected] of cases) {
    const found = brands(searchCatalogue(MEDICINES, typo));
    assert.ok(found.includes(expected), `"${typo}" should offer ${expected}, got ${found.join(', ') || 'nothing'}`);
  }
});

test('a typo never outranks an exact prefix', () => {
  // "pan" prefixes Pan 40; "pam" is one letter away from it and must not lead.
  assert.equal(brands(searchCatalogue(MEDICINES, 'pan'))[0], 'Pan 40');
});

test('strength and form are part of how a drug is named', () => {
  assert.equal(brands(searchCatalogue(MEDICINES, 'azithral 500'))[0], 'Azithral');
  assert.equal(brands(searchCatalogue(MEDICINES, 'calpol 250'))[0], 'Calpol 250');
});

test('rubbish finds nothing rather than everything', () => {
  assert.deepEqual(searchCatalogue(MEDICINES, 'zzzznotadrug'), []);
  assert.deepEqual(searchCatalogue(MEDICINES, 'qqqq'), []);
});

test('below two characters nothing is searched at all', () => {
  assert.equal(MIN_QUERY_LENGTH, 2);
  assert.deepEqual(searchCatalogue(MEDICINES, 'a'), []);
  assert.deepEqual(searchCatalogue(MEDICINES, ' '), []);
  assert.deepEqual(searchCatalogue(MEDICINES, ''), []);
});

test('the limit is honoured and the order is stable across calls', () => {
  const once = brands(searchCatalogue(MEDICINES, 'tab', { limit: 3 }));
  const twice = brands(searchCatalogue(MEDICINES, 'tab', { limit: 3 }));
  assert.deepEqual(once, twice);
  assert.ok(once.length <= 3);
  assert.ok(searchCatalogue(MEDICINES, 'dolo', { limit: 1 }).length <= 1);
});

test('scores are numbers and never negative', () => {
  for (const row of searchCatalogue(MEDICINES, 'dolo 650')) {
    assert.equal(typeof row.score, 'number');
    assert.ok(row.score > 0);
  }
});

test('a multi-word query is only as strong as its weakest word', () => {
  const strong = scoreMedicine({ brand: 'Dolo 650', salt: 'Paracetamol', strength: '650 mg' }, 'dolo 650');
  const weak = scoreMedicine({ brand: 'Dolo 650', salt: 'Paracetamol', strength: '650 mg' }, 'dolo zzz');
  assert.ok(strong > weak);
});

// -------------------------------------------------------------- the highlights

test('only the letters that matched are highlighted', () => {
  assert.deepEqual(highlightRanges('Augmentin 625', 'augm'), [[0, 4]]);
  assert.deepEqual(highlightRanges('Augmentin 625', '625'), [[10, 13]]);
  // two tokens, one row, in reading order
  assert.deepEqual(highlightRanges('Dolo 650', 'dolo 650'), [[0, 4], [5, 8]]);
  assert.deepEqual(highlightRanges('Montair-LC', 'lc'), [[8, 10]]);
  // a typo is not a literal match: nothing is underlined, so nothing looks broken
  assert.deepEqual(highlightRanges('Augmentin 625', 'augmentn'), []);
});

// ------------------------------------------------------------------ the merge

test('a directory row that repeats a brand and molecule is not shown twice', () => {
  const local = [{ id: 'a', brand: 'Dolo 650', salt: 'Paracetamol', score: 900 }];
  const remote = [
    { id: 'b', brand: 'Dolo 650', salt: 'Paracetamol', score: 950, source: 'directory' },
    { id: 'c', brand: 'Pantocid 40', salt: 'Pantoprazole', score: 400, source: 'directory' },
  ];
  const merged = mergeSearchResults(local, remote);
  assert.deepEqual(brands(merged), ['Dolo 650', 'Pantocid 40']);
  // the local row is the one kept: it carries this clinic's dose defaults
  assert.equal(merged[0].id, 'a');
});

test('a very close directory match can still lead, and the cap still holds', () => {
  const local = [{ id: 'a', brand: 'Pan 40', salt: 'Pantoprazole', score: 400 }];
  const remote = [{ id: 'b', brand: 'Pantocid 40', salt: 'Pantoprazole', score: 980, source: 'directory' }];
  assert.deepEqual(brands(mergeSearchResults(local, remote)), ['Pantocid 40', 'Pan 40']);
  const many = Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, brand: `Brand ${i}`, salt: 'X', score: 100 - i }));
  assert.equal(mergeSearchResults([], many).length, MAX_RESULTS);
});

// ------------------------------------------------------- the clinic's own list

test('the clinic’s own history still ranks above the catalogue', () => {
  const history = [{ drug: 'Zincovit + Limcee custom syrup', salt: '' }];
  const results = searchMedicines('zinc', { clinicHistory: history });
  assert.equal(results[0].source, 'history');
  assert.equal(results[0].brand, 'Zincovit + Limcee custom syrup');
});

test('a house line of a molecule the catalogue already has is not offered twice', () => {
  const history = [{ drug: 'Pantoprazole 40mg', salt: 'Pantoprazole' }];
  const results = searchMedicines('pan', { clinicHistory: history });
  assert.deepEqual(results.map((r) => r.source), ['formulary']);
});

test('searchMedicines inherits the typo tolerance', () => {
  assert.equal(searchMedicines('augmentn')[0]?.brand, 'Augmentin 625');
  assert.deepEqual(searchMedicines('zzzznotadrug'), []);
  assert.deepEqual(searchMedicines('a'), []);
});

// --------------------------------------------------------- directory rows → app

test('a directory row becomes a prescription-ready medicine', () => {
  const med = medicineFromDirectoryRow({
    id: 'uuid-1', brand_name: 'Pantocid 40', composition: 'Pantoprazole',
    form: 'Tablet', strength: '40mg', manufacturer: 'Sun Pharma',
    schedule: 'H', classes: ['ppi'],
  });
  assert.equal(med.id, 'uuid-1');
  assert.equal(med.brand, 'Pantocid 40');
  assert.equal(med.salt, 'Pantoprazole');
  assert.equal(med.form, 'tab');
  assert.equal(med.strength, '40mg');
  assert.equal(med.schedule, 'H');
  assert.deepEqual(med.classes, ['ppi']);
  assert.equal(med.source, 'directory');
  // The directory is reference data: it never invents a dose for this patient.
  assert.equal(med.dose, '');
  assert.equal(med.frequency, '');
  assert.equal(med.duration, '');
  assert.match(med.keywords, /sun pharma/);
});

test('a directory row without a brand is not a medicine', () => {
  assert.equal(medicineFromDirectoryRow(null), null);
  assert.equal(medicineFromDirectoryRow({ composition: 'Paracetamol' }), null);
  assert.equal(medicineFromDirectoryRow({ brand_name: '   ' }), null);
});

test('a pack’s wording maps onto the form the app knows', () => {
  assert.equal(formCode('Tablet'), 'tab');
  assert.equal(formCode('tablets'), 'tab');
  assert.equal(formCode('Capsule'), 'cap');
  assert.equal(formCode('Suspension'), 'syrup');
  assert.equal(formCode('Injection'), 'inj');
  assert.equal(formCode('Respules'), 'neb');
  assert.equal(formCode('Ointment'), 'oint');
  assert.equal(formCode('gel'), 'gel');
  assert.equal(formCode('Something new'), null);
  assert.equal(formCode(null), null);
});

test('a row with an unknown schedule is treated as having none', () => {
  const med = medicineFromDirectoryRow({ brand_name: 'X 10', composition: 'Y', schedule: 'Q' });
  assert.equal(med.schedule, null);
});

test('a typo prefers the word that matches over a shorter wrong brand', () => {
  // The real case, found by loading a 242,000-row directory: "Augmentox" is a
  // shorter string than "Augmentin 625", so whole-string similarity alone hands
  // it the win. Word-level similarity is what makes the doctor's drug lead.
  const catalogue = [
    { id: 'decoy', brand: 'Augmentox 625', salt: 'Amoxicillin', strength: '625 mg', keywords: '' },
    { id: 'real', brand: 'Augmentin 625', salt: 'Amoxicillin + Clavulanic acid', strength: '500 mg + 125 mg', keywords: '' },
  ];
  assert.equal(brands(searchCatalogue(catalogue, 'augmentn'))[0], 'Augmentin 625');
  assert.equal(brands(searchCatalogue(catalogue, 'augmentn'))[0], 'Augmentin 625');
  // and an exact prefix still beats both
  assert.equal(brands(searchCatalogue(catalogue, 'augmento'))[0], 'Augmentox 625');
});

// ------------------------------------------------- keystrokes, and short words

test('edit distance counts keystrokes and stops at the cap', () => {
  assert.equal(editDistance('augmentn', 'augmentin'), 1);
  assert.equal(editDistance('augmentn', 'augmentox'), 2);
  assert.equal(editDistance('amoxycillin', 'amoxicillin'), 1);
  assert.equal(editDistance('dolo', 'dolo'), 0);
  assert.equal(editDistance('crocni', 'crocin'), 2);           // a swapped pair
  assert.equal(editDistance('zzzzzzzz', 'paracetamol', 2), 3); // capped, not computed
});

test('nothing shorter than three characters fuzzes', () => {
  // Two letters are a prefix, not a typo: fuzzing them used to answer "pan" with
  // "Zerodol-P", because the single letter "P" scored as a near-miss.
  const catalogue = [
    { id: 'a', brand: 'Pan 40', salt: 'Pantoprazole', strength: '40 mg', keywords: '' },
    { id: 'b', brand: 'Zerodol-P', salt: 'Aceclofenac + Paracetamol', strength: '100 mg + 325 mg', keywords: '' },
  ];
  assert.equal(brands(searchCatalogue(catalogue, 'pan')).includes('Zerodol-P'), false);
  assert.equal(FUZZY_MIN_LENGTH, 3);
  // a one-letter query is not even a prefix
  assert.deepEqual(searchCatalogue(catalogue, 'p'), []);
});

test('a one keystroke typo outranks a two keystroke lookalike', () => {
  const [first, second] = searchCatalogue([
    { id: 'a', brand: 'Augmentox 625', salt: 'Amoxicillin', strength: '625 mg', keywords: '' },
    { id: 'b', brand: 'Augmentin 625', salt: 'Amoxicillin + Clavulanic acid', strength: '500 mg + 125 mg', keywords: '' },
  ], 'augmentn');
  assert.equal(first.brand, 'Augmentin 625');
  assert.ok(first.score > second.score, `${first.score} should beat ${second.score}`);
});
