import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DOSE_PATTERNS, FREQUENCIES, FREQUENCY_SHORTHAND, RELATIONS,
  doseChoicesFor, dosePattern, dosesPerDay, durationInDays, frequencyKey,
  quantityToDispense, slotsForFrequency,
} from '../src/lib/rx-language.js';
import { validateConsultation } from '../src/lib/logic.mjs';

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

test('the four pattern chips write a pattern the helper agrees with', () => {
  for (const p of DOSE_PATTERNS) {
    const known = FREQUENCIES.find((f) => f.value === p.frequency);
    assert.ok(known, `${p.frequency} must be a storable frequency`);
    assert.equal(
      dosePattern({ frequency: p.frequency, dose: '1 tablet' }), p.pattern,
      `${p.frequency} chip says ${p.pattern}`,
    );
    assert.equal(FREQUENCY_SHORTHAND[known.key], p.short);
    assert.ok(p.hint.length > 0);
  }
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
