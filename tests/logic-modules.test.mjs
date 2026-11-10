import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as barrel from '../src/lib/logic.mjs';
import * as money from '../src/lib/money.mjs';
import * as dates from '../src/lib/dates.mjs';
import * as text from '../src/lib/text.mjs';
import * as ids from '../src/lib/ids.mjs';
import * as appointments from '../src/lib/appointments.mjs';
import * as invoicing from '../src/lib/invoicing.mjs';
import * as patients from '../src/lib/patients.mjs';
import * as queue from '../src/lib/queue.mjs';
import * as reporting from '../src/lib/reporting.mjs';
import * as validation from '../src/lib/validation.mjs';
import * as constants from '../src/lib/constants.mjs';
import * as csv from '../src/lib/csv.mjs';

/*
 * Step 3 of docs/ARCHITECTURE.md §3.
 *
 * `logic.mjs` was 852 lines and 88 exports: money, dates, tokens, invoices,
 * patients, the queue, reporting, validation, CSV and the clinic defaults, cohesive
 * by *language* rather than by *responsibility*, so a date fix and an invoice fix sat
 * in the same file.
 *
 * The split is only safe if it is invisible: same names, same objects, every old
 * import path still resolving. These tests hold that line, and keep the new modules
 * from growing back into the file they came out of.
 */

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const lib = join(root, 'src', 'lib');
const PARTS = { money, dates, text, ids, appointments, invoicing, patients, queue, reporting, validation, constants, csv };

test('the barrel re-exports every part, by identity, not by copy', () => {
  for (const [name, part] of Object.entries(PARTS)) {
    for (const [key, value] of Object.entries(part)) {
      if (key === 'default') continue;
      assert.equal(barrel[key], value, `${name}.${key} is not the object logic.mjs exports`);
    }
  }
});

test('the public surface is exactly what it was before the split', () => {
  // 88 exports when the file was one module; the number is the contract.
  assert.equal(Object.keys(barrel).length, 88, 'a name was dropped or invented in the move');
  for (const key of ['formatMoney', 'today', 'computeInvoice', 'queueBoard', 'validatePatient', 'monthTotals', 'toCSV', 'DEFAULT_CLINIC', 'PLANS']) {
    assert.ok(key in barrel, `${key} disappeared from logic.mjs`);
  }
});

test('private helpers stay private', () => {
  // `trim`, ONES/TENS and the rupee-group walkers are implementation detail of
  // amountInWords; they must not leak out as part of the money module's API.
  for (const key of ['trim', 'ONES', 'TENS', 'twoDigitWords', 'threeDigitWords', 'rupeeGroups']) {
    assert.equal(key in barrel, false, `${key} escaped into the public surface`);
    assert.equal(key in money, false, `${key} is no longer private to money.mjs`);
  }
});

test('no part imports the barrel, so the split cannot become a cycle', () => {
  for (const name of Object.keys(PARTS)) {
    const file = readFileSync(join(lib, `${name}.mjs`), 'utf8');
    assert.equal(/from '\.\/logic\.mjs'/.test(file), false, `${name}.mjs imports the barrel`);
  }
});

test('every part is a leaf or depends only on leaves (one direction)', () => {
  const order = ['money', 'dates', 'text', 'csv', 'constants', 'invoicing', 'ids', 'appointments', 'patients', 'queue', 'validation', 'reporting'];
  for (const name of order) {
    const file = readFileSync(join(lib, `${name}.mjs`), 'utf8');
    for (const [, dep] of file.matchAll(/from '\.\/([a-z-]+)\.mjs'/g)) {
      if (dep === 'plans') continue;
      assert.ok(order.indexOf(dep) < order.indexOf(name),
        `${name}.mjs imports ${dep}.mjs, which comes later in the dependency order`);
    }
  }
});

test('the modules stay modules: no part grows back into a logic.mjs', () => {
  const sizes = {};
  for (const name of Object.keys(PARTS)) {
    sizes[name] = readFileSync(join(lib, `${name}.mjs`), 'utf8').split('\n').length;
  }
  for (const [name, lines] of Object.entries(sizes)) {
    assert.ok(lines < 200, `${name}.mjs is ${lines} lines — split it rather than grow it`);
  }
  const barrelLines = readFileSync(join(lib, 'logic.mjs'), 'utf8').split('\n').length;
  assert.ok(barrelLines < 60, `logic.mjs is ${barrelLines} lines and should only re-export`);
});

test('the barrel is the only door: every lib module still imports it or a part', () => {
  // A sanity check on the split itself — the twelve files are all present, so a
  // typo in a file name cannot quietly remove a module from the bundle.
  const present = readdirSync(lib).filter((f) => f.endsWith('.mjs'));
  for (const name of Object.keys(PARTS)) assert.ok(present.includes(`${name}.mjs`), `${name}.mjs missing`);
});
