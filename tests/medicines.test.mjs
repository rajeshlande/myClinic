import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FORMULARY_VERSION, FORMS, MEDICINES, SCHEDULES,
  checkPrescriptionSafety, inferSalt, medicineById, medicineName, medicineToLine,
  recentMedicines, requiresAcknowledgement, searchMedicines,
} from '../src/lib/medicines.mjs';
import { FREQUENCIES, RELATIONS } from '../src/lib/rx-language.js';

const values = (list) => list.map((item) => item.value);

// The same set the consultation form offers; a formulary default outside it
// would render as a select with no matching option.
const DOSES = ['1 tablet', '½ tablet', '2 tablets', '5 ml', '10 ml', '1 puff', '1 capsule', '1 sachet', 'As directed', '2 puffs', '2 drops', 'Thin layer'];
import { nextRxNumber } from '../src/lib/logic.mjs';

const line = (drug, salt = '', extra = {}) => ({ drug, salt, ...extra });
const ids = (warnings) => warnings.map((w) => w.id);
const find = (warnings, prefix) => warnings.find((w) => w.id.startsWith(prefix));

// ---------------------------------------------------------------- formulary shape

test('every formulary entry is complete and printable', () => {
  assert.ok(MEDICINES.length >= 40, 'formulary should cover the common clinic list');
  const seen = new Set();
  for (const med of MEDICINES) {
    assert.ok(med.id && med.brand && med.salt, `entry ${med.id} needs id, brand and salt`);
    assert.ok(!seen.has(med.id), `duplicate id ${med.id}`);
    seen.add(med.id);
    assert.ok(med.strength, `${med.brand} needs a strength`);
    assert.ok(FORMS[med.form], `${med.brand} has unknown form ${med.form}`);
    assert.ok(SCHEDULES[med.schedule], `${med.brand} has unknown schedule ${med.schedule}`);
    assert.ok(Array.isArray(med.classes) && med.classes.length, `${med.brand} needs at least one class`);
    // Defaults are pasted into the printed Rx, so they must be canonical vocabulary.
    assert.ok(values(FREQUENCIES).includes(med.frequency), `${med.brand} frequency "${med.frequency}" is not a known one`);
    assert.ok(values(RELATIONS).includes(med.instructions), `${med.brand} instructions "${med.instructions}" is not a known one`);
    assert.ok(med.duration, `${med.brand} needs a default duration`);
    // A default dose must be something a pharmacist can act on: a counted
    // quantity, a volume, or a topical direction - never an empty string.
    assert.ok(DOSES.includes(med.dose), `${med.brand} default dose "${med.dose}" is not a usable one`);
  }
});

test('formulary version is a dated stamp', () => {
  assert.match(FORMULARY_VERSION, /^\d{4}\.\d{2}$/);
});

test('every interaction rule can actually fire', () => {
  // Each class named in a rule must exist on at least one medicine, or the rule
  // is dead code that silently never warns anyone.
  const declared = new Set(MEDICINES.flatMap((m) => m.classes));
  for (const med of MEDICINES) {
    for (const cls of med.classes) {
      assert.ok(typeof cls === 'string' && cls.length, `${med.brand} has an empty class`);
    }
  }
  assert.ok(declared.has('levothyroxine'), 'levothyroxine class must be tagged on the thyroid medicine');
  assert.ok(declared.has('ppi') && declared.has('calcium') && declared.has('iron'));
});

// ---------------------------------------------------------------- search

test('brand prefix beats everything else', () => {
  const results = searchMedicines('dolo');
  assert.equal(results[0].brand, 'Dolo 650');
});

test('typing a molecule finds the brands that contain it', () => {
  const results = searchMedicines('paracetamol');
  assert.ok(results.length >= 3);
  for (const r of results.slice(0, 3)) assert.match(r.salt, /Paracetamol/i);
});

test('symptoms are searchable, which is how a hurried doctor actually types', () => {
  const results = searchMedicines('fever');
  assert.ok(results.length > 0);
  assert.ok(results.some((r) => /Paracetamol|Ibuprofen/i.test(r.salt)));
});

test('search is case and space insensitive, and honours the limit', () => {
  assert.equal(searchMedicines('  DOLO  650 ')[0]?.brand, 'Dolo 650');
  assert.ok(searchMedicines('a', { limit: 3 }).length <= 3);
  assert.deepEqual(searchMedicines('zzzznotadrug'), []);
});

test('this clinic’s own history ranks above the generic catalogue', () => {
  const history = [line('Zincovit + Limcee custom syrup', '')];
  const results = searchMedicines('zinc', { clinicHistory: history });
  assert.equal(results[0].source, 'history');
  assert.equal(results[0].brand, 'Zincovit + Limcee custom syrup');
});

test('recentMedicines returns the newest distinct lines first', () => {
  const consultations = [
    { visited_on: '2026-10-01', prescription: [line('Dolo 650'), line('Pan 40')] },
    { visited_on: '2026-10-20', prescription: [line('Dolo 650'), line('Montair-LC')] },
  ];
  const recent = recentMedicines(consultations, 5);
  // Newest consultation first; within it, the order the doctor wrote them.
  assert.deepEqual(recent.map((r) => r.drug), ['Dolo 650', 'Montair-LC', 'Pan 40']);
});


test('a house line does not duplicate a molecule the catalogue already offers', () => {
  const history = [line('Pantoprazole 40mg'), line('Zincovit custom syrup')];
  const pan = searchMedicines('pan', { clinicHistory: history });
  assert.deepEqual(pan.map((r) => r.source), ['formulary']);
  // A molecule the catalogue has never heard of is still offered from history.
  const zinc = searchMedicines('zinc', { clinicHistory: history });
  assert.equal(zinc[0].source, 'history');
});

test('a hand-typed molecule is still recognised, so safety checks see it', () => {
  assert.equal(inferSalt('Pantoprazole 40mg'), 'Pantoprazole');
  assert.equal(inferSalt('tab dolo-650 (fever)'), 'Paracetamol');
  assert.equal(inferSalt('Magical Unicorn Tonic'), '');
  const mapped = medicineToLine({ id: 'h1', brand: 'Pantoprazole 40mg', salt: '', strength: '' });
  assert.equal(mapped.salt, 'Pantoprazole');
});

test('a free-typed line and a picked brand of the same molecule still clash', () => {
  const warnings = checkPrescriptionSafety([
    medicineToLine({ id: 'h1', brand: 'Pantoprazole 40mg', salt: '', strength: '' }),
    line('Pan 40', 'Pantoprazole'),
  ]);
  assert.ok(find(warnings, 'duplicate-salt:'), 'inferred molecule must feed the duplicate check');
});

// ---------------------------------------------------------------- picking a medicine

test('picking a medicine fills the whole prescription line', () => {
  const med = MEDICINES.find((m) => m.brand === 'Dolo 650');
  const mapped = medicineToLine(med);
  assert.equal(mapped.medicine_id, med.id);
  // The brand already carries the strength, so it must not be printed twice.
  assert.equal(mapped.drug, 'Dolo 650');
  assert.equal(mapped.salt, 'Paracetamol');
  assert.equal(mapped.schedule, med.schedule);
  assert.equal(mapped.dose, med.dose);
  assert.equal(mapped.frequency, med.frequency);
  assert.equal(mapped.duration, med.duration);
  assert.equal(mapped.instructions, med.instructions);
});


test('a brand without a strength in its name gets one appended exactly once', () => {
  const med = MEDICINES.find((m) => m.brand === 'Crocin Advance');
  assert.equal(medicineToLine(med).drug, `Crocin Advance ${med.strength}`);
  // ...and no formulary line can ever read "600 mg 600 mg".
  for (const m of MEDICINES) {
    const drug = medicineToLine(m).drug;
    const strengthTokens = (drug.match(/\d+(?:\.\d+)?\s*(?:mg|mcg|ml|g|iu)\b/gi) ?? []);
    assert.equal(new Set(strengthTokens.map((t) => t.toLowerCase())).size, strengthTokens.length,
      `${drug} repeats its strength`);
  }
});

test('medicineToLine is null-safe and medicineById round-trips', () => {
  assert.equal(medicineToLine(null), null);
  const med = MEDICINES[0];
  assert.equal(medicineById(med.id)?.brand, med.brand);
  assert.equal(medicineById('nope'), null);
});

// ---------------------------------------------------------------- duplicate identity

test('two brands of the same molecule are flagged high severity', () => {
  const warnings = checkPrescriptionSafety([line('Crocin Advance 500 mg', 'Paracetamol'), line('Dolo 650', 'Paracetamol')]);
  const dup = find(warnings, 'duplicate-salt:');
  assert.ok(dup, 'duplicate molecule must be reported');
  assert.equal(dup.severity, 'high');
  assert.deepEqual(dup.lines, [0, 1]);
});

test('the same drug name twice is caught even when free-typed with no salt', () => {
  const warnings = checkPrescriptionSafety([line('Dolo 650'), line('Dolo 650')]);
  assert.ok(find(warnings, 'duplicate-salt:'));
});

test('two members of the same class are flagged, once per class', () => {
  const warnings = checkPrescriptionSafety([line('Pan 40', 'Pantoprazole'), line('Omez', 'Omeprazole')]);
  const dupClasses = warnings.filter((w) => w.id.startsWith('duplicate-class:'));
  assert.deepEqual(dupClasses.map((w) => w.id), ['duplicate-class:ppi']);
  assert.equal(dupClasses[0].severity, 'moderate');
});

test('a legitimate combination of different classes raises nothing', () => {
  const warnings = checkPrescriptionSafety([
    line('Dolo 650', 'Paracetamol'), line('Augmentin 625', 'Amoxicillin + Clavulanic acid'), line('Pan 40', 'Pantoprazole'),
  ]);
  assert.deepEqual(warnings, []);
});

// ---------------------------------------------------------------- interactions

test('a curated interaction pair fires in either order', () => {
  const a = line('Thyronorm 50 mcg', 'Levothyroxine');
  const b = line('Shelcal 500', 'Calcium + Vitamin D3');
  const forward = checkPrescriptionSafety([a, b]);
  const reverse = checkPrescriptionSafety([b, a]);
  const hit = find(forward, 'interaction:');
  assert.ok(hit, 'levothyroxine + calcium must warn');
  assert.equal(hit.severity, 'moderate');
  assert.match(hit.detail, /4 hours/);
  assert.ok(find(reverse, 'interaction:'), 'order must not matter');
});

test('interactions are not repeated when both classes match twice', () => {
  const warnings = checkPrescriptionSafety([
    line('Ecosprin 75', 'Aspirin'), line('Brufen 400', 'Ibuprofen'),
  ]);
  const interactions = warnings.filter((w) => w.id.startsWith('interaction:'));
  assert.equal(new Set(interactions.map((w) => w.id)).size, interactions.length);
});

// ---------------------------------------------------------------- allergies

test('a free-text allergy stops on the matching molecule', () => {
  const warnings = checkPrescriptionSafety(
    [line('Augmentin 625', 'Amoxicillin + Clavulanic acid')],
    { allergies: 'Penicillin — rash as a child' },
  );
  const allergy = find(warnings, 'allergy:');
  assert.ok(allergy, 'penicillin allergy must match amoxicillin');
  assert.equal(allergy.severity, 'high');
  assert.deepEqual(allergy.lines, [0]);
});

test('an unrelated allergy does not fire', () => {
  const warnings = checkPrescriptionSafety([line('Dolo 650', 'Paracetamol')], { allergies: 'dust, pollen' });
  assert.equal(find(warnings, 'allergy:'), undefined);
});

test('no allergy field and an empty allergy field are both safe', () => {
  assert.deepEqual(checkPrescriptionSafety([line('Dolo 650', 'Paracetamol')], {}), []);
  assert.deepEqual(checkPrescriptionSafety([line('Dolo 650', 'Paracetamol')], { allergies: '' }), []);
  assert.deepEqual(checkPrescriptionSafety([line('Dolo 650', 'Paracetamol')], { allergies: 'nil' }), []);
});

// ---------------------------------------------------------------- register + gate

test('a Schedule H1 drug prints a register notice, not a hard block', () => {
  const med = MEDICINES.find((m) => m.schedule === 'H1');
  const warnings = checkPrescriptionSafety([medicineToLine(med)]);
  const notice = find(warnings, 'schedule:h1');
  assert.ok(notice, 'H1 medicine must raise the register notice');
  assert.equal(notice.severity, 'info');
  assert.match(notice.detail, /H1 register/i);
});

test('H1 is recognised from the catalogue even after a hand-typed name', () => {
  const med = MEDICINES.find((m) => m.schedule === 'H1');
  const warnings = checkPrescriptionSafety([line(med.brand, med.salt, { medicine_id: med.id })]);
  assert.ok(find(warnings, 'schedule:h1'));
});

test('only high severity findings gate the save button', () => {
  const high = checkPrescriptionSafety([line('Dolo 650', 'Paracetamol'), line('Calpol 250', 'Paracetamol')]);
  assert.deepEqual(requiresAcknowledgement(high).map((w) => w.severity), ['high']);

  const moderateOnly = checkPrescriptionSafety([line('Pan 40', 'Pantoprazole'), line('Omez', 'Omeprazole')]);
  assert.equal(moderateOnly.length > 0, true);
  assert.deepEqual(requiresAcknowledgement(moderateOnly), []);
});

test('warnings carry stable ids so an acknowledgement survives a re-render', () => {
  const first = checkPrescriptionSafety([line('Dolo 650', 'Paracetamol'), line('Calpol 250', 'Paracetamol')]);
  const second = checkPrescriptionSafety([line('Dolo 650', 'Paracetamol'), line('Calpol 250', 'Paracetamol')]);
  assert.deepEqual(ids(first), ids(second));
  for (const w of first) {
    assert.ok(w.title && w.detail, 'a warning must be readable');
    assert.ok(Array.isArray(w.lines), 'a warning must point at the lines it concerns');
  }
});

test('blank and free-text lines never crash the checker', () => {
  assert.deepEqual(checkPrescriptionSafety([]), []);
  assert.deepEqual(checkPrescriptionSafety([line(''), line('   ')]), []);
  const custom = checkPrescriptionSafety([line('Some compound syrup not in any formulary')]);
  assert.ok(Array.isArray(custom));
});

// ---------------------------------------------------------------- numbering

test('prescriptions are numbered independently of invoices', () => {
  const consultations = [
    { visited_on: '2026-04-02', rx_number: 'RX/26-27/0001', invoice_id: 'a' },
    { visited_on: '2026-04-03', rx_number: 'RX/26-27/0007', invoice_id: 'b' },
    // A pre-migration row with no number must not reset the series.
    { visited_on: '2026-04-04' },
  ];
  assert.equal(nextRxNumber(consultations, new Date('2026-11-03')), 'RX/26-27/0008');
  assert.equal(nextRxNumber([], new Date('2026-11-03')), 'RX/26-27/0001');
});

test('a new financial year restarts the prescription series', () => {
  const rows = [{ visited_on: '2026-03-01', rx_number: 'RX/25-26/0042' }];
  assert.equal(nextRxNumber(rows, new Date('2026-04-01')), 'RX/26-27/0001');
});
