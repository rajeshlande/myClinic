import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceOperations } from '../src/lib/workspace-operations.mjs';
import { createWorkspaceOutboxDb } from '../src/lib/workspace-outbox.mjs';
import { TenantAuthUnavailableError } from '../src/lib/tenant-client.mjs';
function fixture() {
  let snapshot = { state: 'READY', selectedWorkspaceId: 'ws-a', workspaces: [{ workspace_id: 'ws-a', clinic_id: 'clinic-a' }] };
  let response = { data: { id: 'row', clinic_id: 'clinic-a' }, error: null };
  const calls = [];
  const q = { then(resolve, reject) { return Promise.resolve(response).then(resolve, reject); } };
  for (const method of ['select', 'eq', 'maybeSingle', 'single', 'insert', 'update', 'delete']) q[method] = (...args) => { calls.push([method, ...args]); return q; };
  const client = { from(table) { calls.push(['from', table]); return q; } };
  const controller = { getSnapshot: () => snapshot, getClinicalClient: () => { if (snapshot.state !== 'READY') throw new TenantAuthUnavailableError('not ready'); return client; } };
  const operations = createWorkspaceOperations(controller);
  return { controller, operations, calls, transition(state = 'READY') { snapshot = { ...snapshot, state }; },
    respond(value) { response = value; }, db() { return createWorkspaceOutboxDb(operations.lease()); } };
}
const defer = () => { let resolve; let reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
test('operations refuse missing controllers and non-ready leases', () => {
  assert.throws(() => createWorkspaceOperations(null), TypeError);
  const f=fixture(); f.transition('SIGNED_OUT'); assert.throws(f.operations.lease, TenantAuthUnavailableError);
});
test('current lease returns result and preserves current operation errors', async () => {
  const f=fixture(); const lease=f.operations.lease(); assert.equal(lease.clinicId,'clinic-a');
  assert.equal(await lease.run(() => 42),42);
  const error=new Error('current'); await assert.rejects(lease.run(() => {throw error;}),e=>e===error);
});
for (const state of ['SIGNED_OUT','CONNECTING','ERROR','READY']) {
  test(`delayed success rejected after transition to ${state}, including same-workspace reconnect`, async () => {
    const f=fixture(); const pending=defer(); const result=f.operations.lease().run(()=>pending.promise);
    f.transition(state); pending.resolve('old PHI'); await assert.rejects(result,TenantAuthUnavailableError);
  });
}
test('stale server error is replaced with non-PHI authorization error', async () => {
  const f=fixture(); const pending=defer(); const result=f.operations.lease().run(()=>pending.promise);
  f.transition(); pending.reject(new Error('old patient detail'));
  await assert.rejects(result,e=>e instanceof TenantAuthUnavailableError && !e.message.includes('patient'));
});
test('expired lease never starts another request', async () => {
  const f=fixture(); const lease=f.operations.lease(); f.transition();
  await assert.rejects(lease.run(()=>assert.fail('must not start')),TenantAuthUnavailableError);
});
test('outbox reads, updates and deletes include explicit clinic filter', async () => {
  const f=fixture(); const db=f.db();
  await db.selectOne('patients',{id:'row'}); await db.update('patients','row',{name:'fixture'}); await db.remove('patients','row');
  assert.equal(f.calls.filter(c=>c[0]==='eq' && c[1]==='clinic_id' && c[2]==='clinic-a').length,3);
});
test('insert requires matching clinic and all payloads refuse tenant changes', () => {
  const f=fixture(); const db=f.db();
  for (const row of [{}, {clinic_id:'clinic-b'}, null]) assert.throws(()=>db.insert('patients',row),TenantAuthUnavailableError);
  assert.throws(()=>db.update('patients','row',{clinic_id:'clinic-b'}),TenantAuthUnavailableError);
  assert.equal(f.calls.length,0);
});
test('valid insert and client_id lookup retain replay primitives', async () => {
  const f=fixture(); const db=f.db(); await db.insert('patients',{clinic_id:'clinic-a',id:'row'});
  await db.selectOne('patients',{client_id:'local'});
  assert.ok(f.calls.some(c=>c[0]==='eq' && c[1]==='client_id' && c[2]==='local'));
});
test('table/identity refusal and stale adapter issue no request', async () => {
  const f=fixture(); const db=f.db(); await assert.rejects(db.insert('profiles',{clinic_id:'clinic-a'}),TenantAuthUnavailableError);
  assert.throws(()=>db.selectOne('patients',{})); assert.throws(()=>db.remove('patients',''));
  f.transition(); await assert.rejects(db.selectOne('patients',{id:'row'}),TenantAuthUnavailableError); assert.equal(f.calls.length,0);
});
test('foreign clinic response fails closed', async () => {
  const f=fixture(); f.respond({data:{clinic_id:'clinic-b'},error:null});
  await assert.rejects(f.db().selectOne('patients',{id:'row'}),TenantAuthUnavailableError);
});
test('missing row is tolerated for lookup/delete but not successful write acknowledgement', async () => {
  const f=fixture(); const db=f.db(); const error={code:'PGRST116'}; f.respond({data:null,error});
  assert.equal(await db.selectOne('patients',{id:'row'}),null); await db.remove('patients','row');
  await assert.rejects(db.insert('patients',{clinic_id:'clinic-a'}),e=>e===error);
  await assert.rejects(db.update('patients','row',{}),e=>e===error);
});
test('outbox rejects delayed response after logout', async () => {
  const f=fixture(); const pending=defer(); f.respond(pending.promise);
  const result=f.db().selectOne('patients',{id:'row'}); f.transition('SIGNED_OUT');
  pending.resolve({data:{clinic_id:'clinic-a'},error:null}); await assert.rejects(result,TenantAuthUnavailableError);
});

test('missing insert/update acknowledgement row fails closed instead of acknowledging a write', async () => {
  const f=fixture();f.respond({data:null,error:null});const db=f.db();
  await assert.rejects(db.insert('patients',{clinic_id:'clinic-a'}),TenantAuthUnavailableError);
  await assert.rejects(db.update('patients','row',{}),TenantAuthUnavailableError);
  assert.equal(await db.selectOne('patients',{id:'row'}),null);
});
