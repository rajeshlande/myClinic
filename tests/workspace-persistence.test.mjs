import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IDBFactory } from 'fake-indexeddb';
import { openWorkspacePersistence, workspaceDatabaseName, WORKSPACE_CACHE_TTL_MS } from '../src/lib/workspace-persistence.mjs';
import { TenantAuthUnavailableError } from '../src/lib/tenant-client.mjs';
const SUBJECT = '10000000-0000-4000-8000-000000000001';
const WORKSPACE = '20000000-0000-4000-8000-000000000001';
const CLINIC = '30000000-0000-4000-8000-000000000001';
const OTHER = '40000000-0000-4000-8000-000000000001';
const matches = (code) => (e) => e.code === code;
function fixture(indexedDB = new IDBFactory(), overrides = {}) {
  let active = true; let time = 1800000000000;
  const lease = { subject: SUBJECT, workspaceId: WORKSPACE, clinicId: CLINIC, ...overrides,
    assertCurrent() { if (!active) throw new TenantAuthUnavailableError('expired'); } };
  return { indexedDB, lease, expire() { active = false; }, advance(ms) { time += ms; },
    open: (options = {}) => openWorkspacePersistence({ indexedDB, lease, now: () => time, ...options }) };
}
const cache = (clinicId = CLINIC) => ({ clinic: { id: clinicId }, patients: [{ id: 'fictional' }] });
const op = (id = 'op-1') => ({ op_id: id, type: 'create', table: 'patients', clinic_id: CLINIC, row: { id: 'row', clinic_id: CLINIC } });
async function rawWrite(indexedDB, name, record) {
  const db = await new Promise((resolve,reject) => { const r=indexedDB.open(name,1); r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error); });
  await new Promise((resolve,reject)=>{ const tx=db.transaction('workspace','readwrite'); tx.objectStore('workspace').put(record,'state'); tx.oncomplete=resolve; tx.onabort=()=>reject(tx.error); }); db.close();
}

test('namespace includes all three UUIDs and refuses arbitrary names/anonymous scope', () => {
  const scope = {subject:SUBJECT,workspaceId:WORKSPACE,clinicId:CLINIC};
  assert.ok(workspaceDatabaseName(scope).startsWith('myclinic-v2-'));
  const names = new Set([workspaceDatabaseName(scope), ...['subject','workspaceId','clinicId'].map(k=>workspaceDatabaseName({...scope,[k]:OTHER}))]);
  assert.equal(names.size,4);
  for (const subject of ['',null,'anon','../other']) assert.throws(()=>workspaceDatabaseName({...scope,subject}),matches('INVALID_SCOPE'));
});
test('open requires current lease and available IDB', async () => {
  await assert.rejects(openWorkspacePersistence(),matches('LEASE_REQUIRED'));
  const f=fixture(); f.expire(); await assert.rejects(f.open(),TenantAuthUnavailableError);
  await assert.rejects(fixture().open({indexedDB:null}),matches('STORAGE_UNAVAILABLE'));
});
test('empty read then atomic cache and outbox roundtrip', async () => {
  const f=fixture(); const store=await f.open();
  assert.deepEqual(await store.read(),{revision:0,cache:null,outbox:[]});
  assert.equal(await store.commit({expectedRevision:0,cache:cache(),outbox:[op()]}),1);
  assert.deepEqual(await store.read(),{revision:1,cache:cache(),outbox:[op()]}); store.close();
});
test('database persists across close and reopen without sharing object references', async () => {
  const f=fixture(); let store=await f.open(); const state=cache();
  await store.commit({expectedRevision:0,cache:state}); state.patients[0].id='changed'; store.close();
  store=await f.open(); assert.equal((await store.read()).cache.patients[0].id,'fictional'); store.close();
});
test('separate user, workspace and clinic have isolated physical stores', async () => {
  const idb=new IDBFactory(); const first=fixture(idb); const a=await first.open();
  await a.commit({expectedRevision:0,cache:cache(),outbox:[op()]});
  for (const key of ['subject','workspaceId','clinicId']) {
    const other=await fixture(idb,{[key]:OTHER}).open(); assert.deepEqual(await other.read(),{revision:0,cache:null,outbox:[]}); other.close();
  } a.close();
});
test('TTL expires cache at boundary but never expires unsynced outbox', async () => {
  const f=fixture(); const store=await f.open(); await store.commit({expectedRevision:0,cache:cache(),outbox:[op()]});
  f.advance(WORKSPACE_CACHE_TTL_MS); const record=await store.read(); assert.equal(record.cache,null); assert.equal(record.outbox.length,1); store.close();
});
test('clock rollback hides cache and invalid clock refuses', async () => {
  const f=fixture(); const store=await f.open(); await store.commit({expectedRevision:0,cache:cache()});
  f.advance(-1); assert.equal((await store.read()).cache,null); store.close();
  const broken=await f.open({now:()=>NaN}); await assert.rejects(broken.read(),matches('INVALID_CLOCK')); broken.close();
});
test('CAS prevents two tabs from silently overwriting queued writes', async () => {
  const f=fixture(); const a=await f.open(); const b=await f.open();
  const results=await Promise.allSettled([a.commit({expectedRevision:0,outbox:[op('a')]}),b.commit({expectedRevision:0,outbox:[op('b')]})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.code,'REVISION_CONFLICT');
  assert.equal((await a.read()).outbox.length,1); a.close(); b.close();
});
test('cache mismatch and malformed outbox abort whole transaction', async () => {
  const f=fixture(); const store=await f.open();
  await assert.rejects(store.commit({expectedRevision:0,cache:cache(OTHER),outbox:[op()]}),TenantAuthUnavailableError);
  for (const outbox of [[{...op(),clinic_id:OTHER}], [{...op(),row:{id:'row',clinic_id:OTHER}}], [op(),op()], [{...op(),table:'profiles'}], [{...op(),op_id:''}], [{...op(),type:'update',id:'row',patch:{clinic_id:OTHER}}]]) {
    await assert.rejects(store.commit({expectedRevision:0,cache:cache(),outbox}),matches('INVALID_OUTBOX'));
  }
  assert.deepEqual(await store.read(),{revision:0,cache:null,outbox:[]}); store.close();
});
test('quota/clone failure never claims successful durable commit', async () => {
  const f=fixture(); const store=await f.open(); const state=cache(); state.notCloneable=()=>{};
  await assert.rejects(store.commit({expectedRevision:0,cache:state})); assert.equal((await store.read()).revision,0); store.close();
});
test('expired lease refuses read and commit', async () => {
  const f=fixture(); const store=await f.open(); f.expire();
  await assert.rejects(store.read(),TenantAuthUnavailableError);
  await assert.rejects(store.commit({expectedRevision:0,cache:cache()}),TenantAuthUnavailableError); store.close();
});
test('lease expiring while transaction is queued aborts write', async () => {
  const f=fixture(); const store=await f.open(); const writing=store.commit({expectedRevision:0,cache:cache()}); f.expire();
  await assert.rejects(writing,TenantAuthUnavailableError); store.close();
  const reopened=await fixture(f.indexedDB).open(); assert.equal((await reopened.read()).revision,0); reopened.close();
});
test('cleanup after logout clears cache but retains and reports pending writes', async () => {
  const f=fixture(); const store=await f.open(); await store.commit({expectedRevision:0,cache:cache(),outbox:[op()]}); f.expire();
  await assert.rejects(store.cleanup(),matches('PENDING_WRITES_RETAINED'));
  await assert.rejects(store.read(),matches('STORAGE_CLOSED'));
  const reopened=await fixture(f.indexedDB).open(); const saved=await reopened.read(); assert.equal(saved.cache,null); assert.equal(saved.outbox.length,1); reopened.close();
});
test('cleanup with no pending writes succeeds after expiry', async () => {
  const f=fixture(); const store=await f.open(); await store.commit({expectedRevision:0,cache:cache()}); f.expire(); await store.cleanup();
  const reopened=await fixture(f.indexedDB).open(); assert.equal((await reopened.read()).cache,null); reopened.close();
});
test('only explicit discard removes pending work and cannot touch another namespace', async () => {
  const f=fixture(); const a=await f.open(); const otherFixture=fixture(f.indexedDB,{subject:OTHER}); const b=await otherFixture.open();
  await a.commit({expectedRevision:0,outbox:[op()]}); await b.commit({expectedRevision:0,outbox:[op()]}); await a.cleanup({discardPending:true});
  const again=await f.open(); assert.equal((await again.read()).outbox.length,0); assert.equal((await b.read()).outbox.length,1); again.close(); b.close();
});
test('corrupt or scope-mismatched envelopes fail closed without silent repair', async () => {
  const f=fixture(); let store=await f.open(); const name=store.name; store.close();
  for (const record of [{version:99}, {version:1,scope:{subject:OTHER,workspaceId:WORKSPACE,clinicId:CLINIC},revision:0,cache:null,outbox:[]}]) {
    await rawWrite(f.indexedDB,name,record); store=await f.open(); await assert.rejects(store.read(),matches('CORRUPT_RECORD')); store.close();
  }
});
test('open error, blocked and timeout fail without legacy fallback', async () => {
  for (const event of ['onerror','onblocked']) {
    await assert.rejects(fixture().open({indexedDB:{open(){const request={}; queueMicrotask(()=>request[event]()); return request;}}}),matches(event==='onerror'?'OPEN_FAILED':'OPEN_BLOCKED'));
  }
  await assert.rejects(fixture().open({indexedDB:{open:()=>({})},openTimeoutMs:5}),matches('OPEN_TIMEOUT'));
});
test('version change closes the connection and requires explicit reopen', async () => {
  const f=fixture(); const store=await f.open();
  const db=await new Promise((resolve,reject)=>{const r=f.indexedDB.open(store.name,2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  await assert.rejects(store.read(),matches('STORAGE_CLOSED')); db.close();
});
test('live entry points do not import persistence or migrate legacy data', () => {
  for (const file of ['../src/App.jsx','../src/main.jsx','../src/lib/store.jsx','../src/lib/offline.js']) {
    assert.ok(!readFileSync(new URL(file,import.meta.url),'utf8').includes('workspace-persistence'));
  }
});

test('commit captures payload before its transaction runs', async () => {
  const f=fixture(); const store=await f.open(); const state=cache(); const outbox=[op()];
  const write=store.commit({expectedRevision:0,cache:state,outbox});
  state.clinic.id=OTHER; outbox.length=0; await write;
  const saved=await store.read(); assert.equal(saved.cache.clinic.id,CLINIC); assert.equal(saved.outbox.length,1); store.close();
});
test('expired cache is removed durably and advances CAS revision without deleting queue', async () => {
  const f=fixture(); let store=await f.open(); await store.commit({expectedRevision:0,cache:cache(),outbox:[op()]});
  f.advance(WORKSPACE_CACHE_TTL_MS); assert.equal((await store.read()).revision,2); store.close();
  // A clock rollback/reopen must not resurrect the physically removed cache.
  const fresh=fixture(f.indexedDB); store=await fresh.open(); const saved=await store.read();
  assert.equal(saved.cache,null); assert.equal(saved.revision,2); assert.equal(saved.outbox.length,1); store.close();
});
