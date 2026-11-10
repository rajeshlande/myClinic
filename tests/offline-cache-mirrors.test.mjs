import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  DEMO_KEY, clearDemoSnapshot, mergeRemoteRow, mirrorState, readDemoSnapshot, writeDemoSnapshot,
} from '../src/lib/offline-cache.js';

/**
 * The two mirrors a workspace is written to.
 *
 * The demo snapshot and the per-clinic cache were both inline in `store.jsx`,
 * touching `localStorage` and `setState` in the same breath — which meant the two
 * cases that actually happen in a clinic (a phone in private mode, a full storage
 * quota) could not be exercised at all. v1.31.0 moved them to `offline-cache.js`
 * where the storage is an argument.
 */

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

/** The smallest thing that behaves like localStorage. */
function fakeStorage({ failOnWrite = false, failOnRead = false } = {}) {
  const data = new Map();
  return {
    data,
    getItem: (k) => { if (failOnRead) throw new Error('SecurityError'); return data.has(k) ? data.get(k) : null; },
    setItem: (k, v) => { if (failOnWrite) throw new Error('QuotaExceededError'); data.set(k, v); },
    removeItem: (k) => { data.delete(k); },
  };
}

const clinic = { id: 'c1', name: 'Test Clinic' };

/* ------------------------------------------------------------ demo snapshot */

test('the demo snapshot round-trips and keeps its key', () => {
  const storage = fakeStorage();
  const state = { clinic, patients: [{ id: 'p1' }] };
  writeDemoSnapshot(state, storage);
  assert.equal(DEMO_KEY, 'myclinic.demo.v1');
  assert.deepEqual(readDemoSnapshot(storage), state);
  assert.ok(storage.data.has('myclinic.demo.v1'));
});

test('a snapshot without a clinic reads as no snapshot at all', () => {
  const storage = fakeStorage();
  // a half-written state must not reach the app: it would show onboarding to a
  // user who already has a workspace
  for (const raw of ['{}', '{"patients":[]}', 'null', 'not json at all', '[]']) {
    storage.setItem(DEMO_KEY, raw);
    assert.equal(readDemoSnapshot(storage), null, `read "${raw}" as a workspace`);
  }
  assert.equal(readDemoSnapshot(fakeStorage()), null);
});

test('private mode and a full quota are not errors', () => {
  const blocked = fakeStorage({ failOnRead: true, failOnWrite: true });
  assert.equal(readDemoSnapshot(blocked), null);
  assert.doesNotThrow(() => writeDemoSnapshot({ clinic }, blocked));
  assert.doesNotThrow(() => clearDemoSnapshot(blocked));
});

test('clearing the snapshot leaves nothing behind', () => {
  const storage = fakeStorage();
  writeDemoSnapshot({ clinic }, storage);
  clearDemoSnapshot(storage);
  assert.equal(readDemoSnapshot(storage), null);
  assert.equal(storage.data.size, 0);
});

/* ----------------------------------------------------------------- mirroring */

test('mirrorState writes the demo key in demo mode and the clinic cache when live', () => {
  const storage = fakeStorage();
  const written = [];
  // the cache half goes through offline.js, which reads the real localStorage, so
  // this test asserts the branch that was chosen rather than the bytes
  assert.equal(mirrorState({ mode: 'demo', userId: 'u1', state: { clinic }, storage }), 'demo');
  assert.equal(written.length, 0);
  assert.ok(storage.data.has(DEMO_KEY));
});

test('a live workspace with no clinic yet is cached nowhere rather than under a wrong key', () => {
  const storage = fakeStorage();
  assert.equal(mirrorState({ mode: 'live', userId: 'u1', state: { clinic: null }, storage }), 'none');
  assert.equal(mirrorState({ mode: 'live', userId: null, state: { clinic }, storage }), 'none');
  assert.equal(storage.data.size, 0, 'nothing should have been written');
});

/* --------------------------------------------------------------------- merge */

test('a returned row merges into the list instead of appearing twice', () => {
  const list = [{ id: 'p1', name: 'Asha', phone: '1' }, { id: 'p2', name: 'Ravi' }];
  const merged = mergeRemoteRow(list, { id: 'p1', phone: '90000' });
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0], { id: 'p1', name: 'Asha', phone: '90000' });
  assert.deepEqual(merged[1], list[1]);
});

test('a locally-created row is matched by client_id until the server id arrives', () => {
  const list = [{ client_id: 'tmp-1', name: 'New patient' }];
  const merged = mergeRemoteRow(list, { id: 'srv-9', client_id: 'tmp-1', name: 'New patient' });
  assert.equal(merged.length, 1, 'the optimistic row and its server row are one row');
  assert.equal(merged[0].id, 'srv-9');
  assert.equal(merged[0].client_id, 'tmp-1');
});

test('an unknown row goes to the front, and the input list is not mutated', () => {
  const list = [{ id: 'p1' }];
  const merged = mergeRemoteRow(list, { id: 'p2' });
  assert.deepEqual(merged.map((r) => r.id), ['p2', 'p1']);
  assert.deepEqual(list, [{ id: 'p1' }]);
  // and the empty and missing cases are the same case
  assert.deepEqual(mergeRemoteRow([], { id: 'x' }), [{ id: 'x' }]);
  assert.deepEqual(mergeRemoteRow(undefined, { id: 'x' }), [{ id: 'x' }]);
  assert.deepEqual(mergeRemoteRow(list, null), list);
});

/* -------------------------------------------------------------------- ratchet */

test('neither the demo key nor the merge rule is written down twice', () => {
  const store = read('../src/lib/store.jsx');
  const cache = read('../src/lib/offline-cache.js');
  const tab = read('../src/components/settings/PlanDataTab.jsx');
  // one home for the key: the module
  assert.doesNotMatch(store, /'myclinic\.demo\.v1'/, 'store.jsx still names the demo key');
  assert.doesNotMatch(tab, /'myclinic\.demo\.v1'/, 'the reset button still names the demo key');
  assert.match(tab, /clearDemoSnapshot\(\)/);
  // one home for the merge: the module
  assert.doesNotMatch(store, /r\.client_id === row\.client_id/, 'store.jsx still merges rows itself');
  assert.match(store, /mergeRemoteRow\(prev\[table\], row\)/);
  // and the module stays a leaf: it may not read React or the store
  assert.doesNotMatch(cache, /from 'react'/);
  const code = cache.replace(/\/\*[\s\S]*?\*\//g, '');   // the doc comment may name store.jsx
  assert.doesNotMatch(code, /store\.jsx/);
  assert.ok(cache.split('\n').length < 160, 'offline-cache.js is growing into a store again');
});
