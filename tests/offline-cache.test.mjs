import test from 'node:test';
import assert from 'node:assert/strict';
import { cacheKey, clearAllCache, purgeExpiredCache, readCache, writeCache } from '../src/lib/offline.js';

/**
 * The offline cache holds patients, consultations and invoices, so its lifetime is
 * a security property and not just a freshness one. These tests give the module a
 * localStorage of its own.
 */
function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => map.clear(),
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
  };
}

const USER = '11111111-1111-4111-8111-111111111111';
const CLINIC = 'aaaaaaaa-0000-4000-8000-000000000001';
const DAY = 24 * 60 * 60 * 1000;
const state = { patients: [{ id: 'p1', full_name: 'Patient Alpha' }], consultations: [{ id: 'c1' }] };

test('an expired snapshot is refused on read and deleted on purge', () => {
  globalThis.localStorage = memoryStorage();
  writeCache(USER, CLINIC, state, Date.now() - 2 * DAY);      // written two days ago

  assert.equal(readCache(USER, CLINIC), null, 'the read path already refused it');
  assert.ok(globalThis.localStorage.getItem(cacheKey(USER, CLINIC)), 'but the bytes were still there');

  assert.equal(purgeExpiredCache(), 1);
  assert.equal(globalThis.localStorage.getItem(cacheKey(USER, CLINIC)), null);
});

test('a fresh snapshot survives the purge', () => {
  globalThis.localStorage = memoryStorage();
  writeCache(USER, CLINIC, state);
  assert.equal(purgeExpiredCache(), 0);
  assert.deepEqual(readCache(USER, CLINIC).state.patients[0].full_name, 'Patient Alpha');
});

test('signing out removes every cached workspace and every outbox', () => {
  globalThis.localStorage = memoryStorage();
  writeCache(USER, CLINIC, state);
  writeCache('22222222-2222-4222-8222-222222222222', CLINIC, state);
  globalThis.localStorage.setItem(`myclinic.outbox.v2.${USER}`, JSON.stringify([{ op_id: 'o1' }]));
  globalThis.localStorage.setItem('myclinic.theme', 'dark');   // not clinical data

  assert.equal(clearAllCache(), 3);
  assert.equal(globalThis.localStorage.getItem(cacheKey(USER, CLINIC)), null);
  assert.equal(globalThis.localStorage.getItem(`myclinic.outbox.v2.${USER}`), null);
  assert.equal(globalThis.localStorage.getItem('myclinic.theme'), 'dark');
});
