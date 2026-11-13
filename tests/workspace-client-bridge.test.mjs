import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWorkspaceClientBridge } from '../src/lib/workspace-client-bridge.mjs';
import { TenantAuthUnavailableError } from '../src/lib/tenant-client.mjs';

test('bridge requires an explicit controller', () => {
  for (const input of [null, {}, { getSnapshot() {} }]) assert.throws(() => createWorkspaceClientBridge(input), TypeError);
});
test('all non-ready states refuse without calling client accessor', () => {
  for (const state of ['SIGNED_OUT', 'LOADING', 'CONNECTING', 'CHOOSE_WORKSPACE', 'NOT_READY', 'SIGNING_OUT', 'ERROR', 'DISPOSED', undefined]) {
    const bridge = createWorkspaceClientBridge({ getSnapshot: () => ({ state }), getClinicalClient() { assert.fail('must not resolve'); } });
    assert.throws(bridge.getClient, TenantAuthUnavailableError);
  }
});
test('bridge resolves per operation and never caches a previous workspace client', () => {
  let state = 'READY'; let client = { id: 'a' };
  const bridge = createWorkspaceClientBridge({ getSnapshot: () => ({ state }), getClinicalClient: () => client });
  const getClient = bridge.getClient;
  assert.equal(getClient().id, 'a'); state = 'CONNECTING'; assert.throws(getClient);
  client = { id: 'b' }; state = 'READY'; assert.equal(getClient().id, 'b');
  state = 'SIGNED_OUT'; assert.throws(getClient);
  assert.ok(Object.isFrozen(bridge));
});
test('controller denial and missing client cannot trigger a fallback', () => {
  const base = { getSnapshot: () => ({ state: 'READY' }) };
  assert.throws(createWorkspaceClientBridge({ ...base, getClinicalClient: () => null }).getClient, TenantAuthUnavailableError);
  const denial = new TenantAuthUnavailableError('revoked');
  assert.throws(createWorkspaceClientBridge({ ...base, getClinicalClient: () => { throw denial; } }).getClient, (e) => e === denial);
});
test('live entry points do not import staged gate or bridge', () => {
  for (const file of ['../src/App.jsx', '../src/main.jsx', '../src/lib/store.jsx', '../src/lib/supabase.js']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.ok(!/WorkspaceGate|workspace-client-bridge/.test(source));
  }
});
