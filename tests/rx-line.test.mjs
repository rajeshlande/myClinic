import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FREQUENCIES, FREQUENCY_SHORTHAND, PATTERN_PRESETS, RELATIONS,
  doseChoicesFor, dosePattern, dosesPerDay, dosesPerDayFor, durationInDays,
  formatDosePattern, frequencyForPattern, frequencyKey, parseDosePattern,
  patientInstruction, patternPhrase, quantityToDispense, slotsForFrequency,
} from '../src/lib/rx-language.js';
import { validateConsultation } from '../src/lib/logic.mjs';
import { paginateRows, pageOffsets } from '../src/lib/paginate.mjs';

// ------------------------------------------------ the pattern, not the sentence

test('a pattern is what the pad says: 1-0-1, not "twice a day"', () => {
  assert.equal(dosePattern({ frequency: 'Once a day', dose: '1 tablet' }), '1-0-0');
  assert.equal(dosePattern({ frequency: 'Twice a day', dose: '1 tablet' }), '1-0-1');
  assert.equal(dosePattern({ frequency: 'Three times a day', dose: '1 tablet' }), '1-1-1');
  assert.equal(dosePattern({ frequency: 'Four times a day', dose: '1 tablet' }), '1-1-1-1');
  assert.equal(dosePattern({ frequency: 'At night', dose: '1 tablet' }), '0-0-1');
});

test('a half tablet is a fraction, not a decimal', () => {
  assert.equal(dosePattern({ frequency: 'Twice a day', dose: '½ tablet' }), '½-0-½');
  assert.equal(dosePattern({ frequency: 'Once a day', dose: 'half tablet' }), '½-0-0');
  assert.equal(dosePattern({ frequency: 'Twice a day', dose: '2 tablets' }), '2-0-2');
});

test('the frequencies with no daily pattern get words, not a made-up pattern', () => {
  for (const frequency of ['When needed', 'Every 6 hours', 'Every 8 hours', 'Once a week', 'As directed', '']) {
    assert.equal(dosePattern({ frequency, dose: '1 tablet' }), '', `${frequency} should have no pattern`);
  }
});

test('the chips write a pattern the helper agrees with', () => {
  for (const p of PATTERN_PRESETS) {
    assert.deepEqual(parseDosePattern(p.pattern), parseDosePattern(p.pattern), `${p.pattern} must parse`);
    assert.equal(formatDosePattern(parseDosePattern(p.pattern)), p.pattern);
    assert.ok(p.hint.length > 0);
    // A preset that names a frequency must agree with the one the helper implies.
    const implied = frequencyForPattern(p.pattern);
    if (implied) assert.ok(FREQUENCIES.some((f) => f.value === implied), `${implied} must be storable`);
  }
});

/* ------------------------------------------------- the typed pattern: 1-0-1 */

test('the pad notation is read as morning, afternoon, night', () => {
  assert.deepEqual(parseDosePattern('1-0-1'), [1, 0, 1]);
  assert.deepEqual(parseDosePattern('1-1-1'), [1, 1, 1]);
  assert.deepEqual(parseDosePattern('0-0-1'), [0, 0, 1]);
  assert.deepEqual(parseDosePattern('½-0-1'), [0.5, 0, 1]);
  assert.deepEqual(parseDosePattern('0.5-0-1'), [0.5, 0, 1], '0.5 is accepted and printed as ½');
  assert.deepEqual(parseDosePattern('1-1-1-1'), [1, 1, 1, 1], 'a fourth slot is the evening');
  assert.deepEqual(parseDosePattern('1-1'), [1, 1], 'two numbers are morning and night');
  assert.deepEqual(parseDosePattern(' 1 - 0 - 1 '), [1, 0, 1], 'spacing is not a pattern error');
  assert.deepEqual(parseDosePattern('2-0-2'), [2, 0, 2], 'two tablets a dose is allowed');
});

test('a pattern that cannot be followed is refused, not guessed at', () => {
  for (const bad of ['', '   ', '1', '0-0-0', '5-0-1', '9-9-9', '1-0-1-1-1', 'abc', '1-0-x', null, undefined]) {
    assert.equal(parseDosePattern(bad), null, `${JSON.stringify(bad)} is not a pattern`);
  }
});

test('the pattern becomes the words a patient reads, and the words a chemist counts', () => {
  assert.equal(patternPhrase([1, 0, 1]), 'in the morning · at night');
  assert.equal(patternPhrase([0, 1, 0]), 'in the afternoon');
  assert.equal(patternPhrase([0.5, 0, 1]), '½ in the morning · 1 at night');
  assert.equal(patternPhrase([1, 1, 1], 'hi'), 'सुबह · दोपहर · रात में');
  assert.equal(patternPhrase([]), '');
  const rx = { dose: '1 tablet', frequency: 'Twice a day', pattern: '0-1-0', duration: '5 days' };
  assert.equal(patientInstruction(rx), 'in the afternoon · for 5 days', 'the pattern overrides the words');
});

test('the typed pattern decides the frequency words, so the two cannot contradict', () => {
  assert.equal(frequencyForPattern('1-0-1'), 'Twice a day');
  assert.equal(frequencyForPattern('½-0-½'), 'Twice a day', 'the amount does not change the frequency');
  assert.equal(frequencyForPattern('1-1'), 'Twice a day');
  assert.equal(frequencyForPattern('1-1-1-1'), 'Four times a day');
  assert.equal(frequencyForPattern('0-0-1'), 'At night');
  assert.equal(frequencyForPattern('0-1-0'), '', 'an afternoon-only dose has no word for it');
  assert.equal(frequencyForPattern('nonsense'), '');
});

test('a dose skipped or doubled by the pattern changes the quantity with it', () => {
  const qty = (pattern, dose = '1 tablet', duration = '5 days') => quantityToDispense({ dose, frequency: 'Twice a day', pattern, duration });
  assert.equal(qty('1-0-1').label, '10 tablets');
  assert.equal(qty('1-1-1').label, '15 tablets');
  assert.equal(qty('0-1-0').label, '5 tablets');
  assert.equal(qty('1-1-1-1', '1 tablet', '2 days').label, '8 tablets');
  assert.equal(qty('½-0-1', '½ tablet', '10 days').label, '15 tablets', 'half a tablet still comes out of a whole one');
  assert.equal(qty('0-0-2', '1 tablet', '7 days').label, '14 tablets');
  // A volume is dosed by the millilitre: 5 ml at night, not five at night.
  assert.equal(qty('0-0-3', '5 ml', '4 days').label, '60 ml');
  assert.equal(dosesPerDayFor({ pattern: '1-0-1' }), 2);
  assert.equal(dosesPerDayFor({ frequency: 'Three times a day' }), 3);
  assert.equal(dosesPerDay('1-0-1'), 2, 'a pattern in the frequency field still counts');
});

test('a pattern is what prints, and a half tablet is rounded up to a whole one', () => {
  assert.equal(dosePattern({ pattern: '0-1-0', frequency: 'Twice a day', dose: '1 tablet' }), '0-1-0');
  assert.equal(dosePattern({ pattern: '1-0-1', frequency: 'Twice a day', dose: '½ tablet' }), '1-0-1', 'the typed pattern wins');
  assert.equal(dosePattern({ pattern: '', frequency: '1-0-1', dose: '1 tablet' }), '1-0-1', 'a pattern typed as the frequency is still a pattern');
  assert.equal(quantityToDispense({ dose: '½ tablet', frequency: 'Once a day', duration: '3 days' }).label, '2 tablets');
});

test('every frequency has a shorthand a chemist can read', () => {
  for (const f of FREQUENCIES) {
    assert.ok(FREQUENCY_SHORTHAND[f.key], `${f.value} has no shorthand`);
    assert.ok(FREQUENCY_SHORTHAND[f.key].length <= 5);
  }
});

test('times of day round-trip through the stored sentence', () => {
  assert.deepEqual(slotsForFrequency('Twice a day'), ['morning', 'night']);
  assert.deepEqual(slotsForFrequency('bd'), ['morning', 'night']);
  assert.deepEqual(slotsForFrequency('Three times a day'), ['morning', 'afternoon', 'night']);
  assert.deepEqual(slotsForFrequency('When needed'), []);
  assert.deepEqual(slotsForFrequency(''), []);
  // a hand-typed frequency from an older prescription still resolves
  assert.equal(frequencyKey('2 times a day'), 'bd');
  assert.deepEqual(slotsForFrequency('2 times a day'), ['morning', 'night']);
});

// -------------------------------------------------------------- how long it runs

test('a duration counts days, and refuses to invent one', () => {
  assert.equal(durationInDays('5 days'), 5);
  assert.equal(durationInDays('1 day'), 1);
  assert.equal(durationInDays('2 weeks'), 14);
  assert.equal(durationInDays('1 month'), 30);
  assert.equal(durationInDays('3 months'), 90);
  assert.equal(durationInDays('7'), 7);            // "5 days" typed as just a number
  assert.equal(durationInDays('till review'), null);
  assert.equal(durationInDays(''), null);
  assert.equal(durationInDays(null), null);
});

// ---------------------------------------------------- dose chips suit the drug form

test('dose chips follow the form of the drug', () => {
  assert.deepEqual(doseChoicesFor('Tablet'), ['1 tablet', '½ tablet', '2 tablets']);
  assert.deepEqual(doseChoicesFor(''), ['1 tablet', '½ tablet', '2 tablets']);
  assert.deepEqual(doseChoicesFor('Capsule'), ['1 capsule', '2 capsules']);
  assert.deepEqual(doseChoicesFor('Syrup'), ['5 ml', '10 ml', '2.5 ml', '15 ml']);
  assert.deepEqual(doseChoicesFor('Suspension'), ['5 ml', '10 ml', '2.5 ml', '15 ml']);
  assert.deepEqual(doseChoicesFor('Inhaler'), ['1 puff', '2 puffs', '1 respule']);
  assert.deepEqual(doseChoicesFor('Injection'), ['1 dose', '0.5 ml', '1 ml']);
  assert.deepEqual(doseChoicesFor('Sachet'), ['1 sachet', '½ sachet']);
  assert.deepEqual(doseChoicesFor('Eye Drops'), ['1 drop', '2 drops']);
  assert.deepEqual(doseChoicesFor('Cream'), ['Apply thinly', 'Apply twice']);
});

test('no chip ever offers a unit the form cannot be given in', () => {
  assert.equal(doseChoicesFor('Syrup').some((d) => d.includes('tablet')), false);
  assert.equal(doseChoicesFor('Inhaler').some((d) => d.includes('ml')), false);
  assert.equal(doseChoicesFor('Tablet').some((d) => d.includes('puff')), false);
});

// ----------------------------------------------------------------- the food chip

test('food relation chips cover every stored value, and none of them is a sentence', () => {
  for (const r of RELATIONS) {
    assert.ok(r.value === r.value.trim());
    assert.ok(r.value.length <= 16, `${r.value} is too long for a chip`);
  }
  assert.equal(RELATIONS.some((r) => r.value === ''), false, 'the empty option is drawn separately');
});

// ------------------------------------------------- what the chemist hands over

test('a course has a quantity, and it is arithmetic not a guess', () => {
  const qty = (dose, frequency, duration) => quantityToDispense({ dose, frequency, duration })?.label ?? null;
  assert.equal(qty('1 tablet', 'Twice a day', '5 days'), '10 tablets');
  assert.equal(qty('1 tablet', 'Once a day', '7 days'), '7 tablets');
  assert.equal(qty('½ tablet', 'Once a day', '10 days'), '5 tablets');
  assert.equal(qty('2 tablets', 'Three times a day', '5 days'), '30 tablets');
  assert.equal(qty('5 ml', 'Three times a day', '5 days'), '75 ml');
  assert.equal(qty('1 puff', 'Twice a day', '1 month'), '60 puffs');
  assert.equal(qty('1 capsule', 'At night', '7 days'), '7 capsules');
  // every 6 hours is four a day, every 8 hours is three: that is the point
  assert.equal(qty('1 tablet', 'Every 6 hours', '2 days'), '8 tablets');
  assert.equal(qty('1 tablet', 'Every 8 hours', '2 days'), '6 tablets');
});

test('a quantity is a dash when it would be a lie', () => {
  const qty = (dose, frequency, duration) => quantityToDispense({ dose, frequency, duration });
  assert.equal(qty('1 tablet', 'When needed', '5 days'), null, 'SOS has no per-day rate');
  assert.equal(qty('1 tablet', 'Once a week', '1 month'), null);
  assert.equal(qty('1 tablet', 'Twice a day', 'till review'), null, 'no length, no total');
  assert.equal(qty('Apply thinly', 'Twice a day', '5 days'), null, 'a cream is not counted');
  assert.equal(qty('As directed', 'Twice a day', '5 days'), null);
  assert.equal(qty('1 tablet', '', '5 days'), null);
  assert.equal(qty('', 'Twice a day', '5 days'), null);
});

test('singular stays singular, and millilitres never pluralise', () => {
  assert.equal(quantityToDispense({ dose: '1 tablet', frequency: 'Once a day', duration: '1 day' }).label, '1 tablet');
  assert.equal(quantityToDispense({ dose: '2.5 ml', frequency: 'Once a day', duration: '1 day' }).label, '2.5 ml');
});

test('doses per day covers every frequency that has a rate', () => {
  assert.equal(dosesPerDay('Once a day'), 1);
  assert.equal(dosesPerDay('Twice a day'), 2);
  assert.equal(dosesPerDay('Three times a day'), 3);
  assert.equal(dosesPerDay('Four times a day'), 4);
  assert.equal(dosesPerDay('At night'), 1);
  assert.equal(dosesPerDay('Every 6 hours'), 4);
  assert.equal(dosesPerDay('Every 8 hours'), 3);
  assert.equal(dosesPerDay('When needed'), null);
  assert.equal(dosesPerDay('Once a week'), null);
  assert.equal(dosesPerDay(''), null);
});

// ---------------------------------- the investigations list is a list, not a report

test('an investigations list is refused on the form before the database refuses it', () => {
  const base = { complaint: 'fever' };
  assert.deepEqual(validateConsultation({ ...base, investigations: 'CBC, HbA1c' }), {});
  assert.deepEqual(validateConsultation(base), {}, 'no investigations is fine');
  const long = 'x'.repeat(1001);
  assert.ok(validateConsultation({ ...base, investigations: long }).investigations);
});

/* ------------------------------------------- a prescription is a document, with pages */

test('a short prescription is one page, and the rows stay on it', () => {
  assert.deepEqual(paginateRows([]), [[]], 'no medicines is still a page — the signature needs one');
  assert.deepEqual(paginateRows([1, 2, 3]).map((p) => p.length), [3]);
  assert.deepEqual(paginateRows(Array.from({ length: 8 }, (_, i) => i)).map((p) => p.length), [8]);
});

test('two pages are balanced instead of orphaning a row under the signature', () => {
  assert.deepEqual(paginateRows(Array.from({ length: 9 }, (_, i) => i)).map((p) => p.length), [5, 4]);
  assert.deepEqual(paginateRows(Array.from({ length: 10 }, (_, i) => i)).map((p) => p.length), [5, 5]);
  assert.deepEqual(paginateRows(Array.from({ length: 13 }, (_, i) => i)).map((p) => p.length), [7, 6]);
  assert.deepEqual(paginateRows(Array.from({ length: 17 }, (_, i) => i)).map((p) => p.length), [9, 8]);
});

test('a long prescription is chunked, and the last page always has room to close', () => {
  const sizes = (n) => paginateRows(Array.from({ length: n }, (_, i) => i)).map((p) => p.length);
  // page 1 is capped at 8, middle pages at 12, and the page that also carries the
  // investigations, advice and signature at 9 — so the last sheet closes properly
  assert.deepEqual(sizes(20), [8, 8, 4]);
  assert.deepEqual(sizes(21), [8, 9, 4]);
  assert.deepEqual(sizes(32), [8, 12, 8, 4]);
  assert.deepEqual(sizes(40), [8, 12, 12, 8]);
  for (const n of [18, 19, 24, 27, 30, 45, 60]) {
    const pages = sizes(n);
    assert.equal(pages.reduce((a, b) => a + b, 0), n, `${n} rows are all placed, none lost`);
    assert.ok(pages.slice(1, -1).every((c) => c <= 12), `${n}: middle pages never overflow`);
    assert.ok(pages[pages.length - 1] <= 9, `${n}: the last page leaves room for the closing blocks`);
  }
});

test('rows are numbered through the document, not per page', () => {
  const rows = Array.from({ length: 21 }, (_, i) => `drug ${i + 1}`);
  const pages = paginateRows(rows);
  const offsets = pageOffsets(pages);
  assert.deepEqual(offsets, [0, 8, 17]);
  const numbered = pages.flatMap((page, p) => page.map((_, i) => offsets[p] + i + 1));
  assert.deepEqual(numbered, Array.from({ length: 21 }, (_, i) => i + 1));
  assert.deepEqual(pages.flat(), rows, 'no row is dropped or duplicated');
});
