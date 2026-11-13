import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IDBFactory } from 'fake-indexeddb';
import { createWorkspaceLifecycle, WORKSPACE_LIFECYCLE_KEY } from '../src/lib/workspace-lifecycle.mjs';
import { openWorkspacePersistence } from '../src/lib/workspace-persistence.mjs';
import { TenantAuthUnavailableError } from '../src/lib/tenant-client.mjs';
const SUBJECT='10000000-0000-4000-8000-000000000001';
const WORKSPACE='20000000-0000-4000-8000-000000000001';
const CLINIC='30000000-0000-4000-8000-000000000001';
const OTHER='40000000-0000-4000-8000-000000000001';
const matches=code=>e=>e.code===code;
function environment() {
  const indexedDB=new IDBFactory(); const values=new Map(); const listeners=new Set(); let random=0;
  let barrier=Promise.resolve(); let held=0; let maxHeld=0;
  const locks={ request(name,options,callback) {
    assert.equal(options.mode,'exclusive');
    const result=barrier.then(async()=>{held++; maxHeld=Math.max(maxHeld,held);try{return await callback();}finally{held--;}});
    barrier=result.catch(()=>{}); return result;
  } };
  const metadataStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
  const eventTarget={addEventListener:(type,fn)=>listeners.add(fn),removeEventListener:(type,fn)=>listeners.delete(fn)};
  const options={locks,metadataStorage,indexedDB,eventTarget,randomId:()=>`epoch-${++random}`};
  return {options,values,listeners, get maxHeld(){return maxHeld;},
    make(extra={}) {return createWorkspaceLifecycle({...options,...extra});},
    event(key=WORKSPACE_LIFECYCLE_KEY){for(const fn of listeners) fn({key});} };
}
function lease(extra={}) {let current=true; return {subject:SUBJECT,workspaceId:WORKSPACE,clinicId:CLINIC,...extra,
  assertCurrent(){if(!current)throw new TenantAuthUnavailableError('expired');},expire(){current=false;}};}
const state=()=>({clinic:{id:CLINIC},patients:[{id:'fictional'}]});
const pending=()=>[{op_id:'op',type:'delete',table:'patients',clinic_id:CLINIC,id:'fictional'}];

test('requires Web Locks and durable metadata, no unsafe fallback',()=>{
  assert.throws(()=>createWorkspaceLifecycle(),matches('LIFECYCLE_UNAVAILABLE'));
  const env=environment(); assert.throws(()=>env.make({locks:null}),matches('LIFECYCLE_UNAVAILABLE'));
});
test('construction is inert except optional listener; registry only after verified open',async()=>{
  const env=environment(); const runtime=env.make(); assert.equal(env.values.size,0);
  const expired=lease();expired.expire();await assert.rejects(runtime.open(expired),TenantAuthUnavailableError);
  assert.equal(env.values.size,0); const store=await runtime.open(lease());
  const meta=JSON.parse(env.values.get(WORKSPACE_LIFECYCLE_KEY));assert.equal(meta.scopes.length,1);assert.equal(meta.blocked,false);store.close();runtime.dispose();
});
test('facade reads/commits serialize across simulated tabs',async()=>{
  const env=environment();const a=env.make();const b=env.make();const sa=await a.open(lease());const sb=await b.open(lease());
  const result=await Promise.allSettled([sa.commit({expectedRevision:0,cache:state()}),sb.commit({expectedRevision:0,cache:state()})]);
  assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(env.maxHeld,1);
  a.dispose();b.dispose();
});
test('registry deduplicates database and tracks other workspace even after handle closes',async()=>{
  const env=environment();const runtime=env.make();const first=await runtime.open(lease());first.close();
  const second=await runtime.open(lease());second.close();const third=await runtime.open(lease({workspaceId:OTHER}));third.close();
  assert.equal(JSON.parse(env.values.get(WORKSPACE_LIFECYCLE_KEY)).scopes.length,2);
  await runtime.cleanup();assert.deepEqual(JSON.parse(env.values.get(WORKSPACE_LIFECYCLE_KEY)).scopes,[]);runtime.dispose();
});
test('logout clears all registered caches, including remotely opened namespace',async()=>{
  const env=environment();const a=env.make();const b=env.make();const sa=await a.open(lease());const sb=await b.open(lease({subject:OTHER}));
  await sa.commit({expectedRevision:0,cache:state()});await sb.commit({expectedRevision:0,cache:state()});await a.cleanup();
  await assert.rejects(sb.read(),matches('LIFECYCLE_BLOCKED'));
  const c=env.make();const fresh=await c.open(lease({subject:OTHER}));assert.equal((await fresh.read()).cache,null);
  a.dispose();b.dispose();c.dispose();
});
test('durable fence blocks old tab even without delivery of a storage event',async()=>{
  const env=environment();let invalidations=0;const a=env.make();const b=env.make({onInvalidate:()=>{invalidations++;}});
  await a.open(lease());const sb=await b.open(lease());await a.cleanup();
  await assert.rejects(sb.commit({expectedRevision:0,cache:state()}),matches('LIFECYCLE_BLOCKED'));assert.equal(invalidations,1);
  await assert.rejects(b.open(lease()),matches('LIFECYCLE_BLOCKED'));a.dispose();b.dispose();
});
test('storage notification invalidates UI callback immediately and only once',async()=>{
  const env=environment();let count=0;const a=env.make();const b=env.make({onInvalidate:()=>{count++;}});
  await a.open(lease());await b.open(lease());env.event('unrelated');assert.equal(count,0);
  await a.cleanup();env.event();env.event();assert.equal(count,1);a.dispose();b.dispose();assert.equal(env.listeners.size,0);
});
test('retained pending work leaves durable block for new tabs and attempts other namespaces',async()=>{
  const env=environment();const a=env.make();const sa=await a.open(lease());const other=await a.open(lease({subject:OTHER}));
  await sa.commit({expectedRevision:0,cache:state(),outbox:pending()});await other.commit({expectedRevision:0,cache:state()});
  await assert.rejects(a.cleanup(),matches('LIFECYCLE_CLEANUP_INCOMPLETE'));
  const meta=JSON.parse(env.values.get(WORKSPACE_LIFECYCLE_KEY));assert.equal(meta.blocked,true);assert.equal(meta.scopes.length,2);
  const b=env.make();await assert.rejects(b.open(lease()),matches('LIFECYCLE_BLOCKED'));
  // Raw test-only inspection proves pending records survive, not a recovery API.
  const raw=await openWorkspacePersistence({lease:lease(),indexedDB:env.options.indexedDB});const saved=await raw.read();assert.equal(saved.cache,null);assert.equal(saved.outbox.length,1);raw.close();
  const rawOther=await openWorkspacePersistence({lease:lease({subject:OTHER}),indexedDB:env.options.indexedDB});assert.equal((await rawOther.read()).cache,null);rawOther.close();a.dispose();b.dispose();
});
test('old coordinator cannot erase a newer login via stale cleanup',async()=>{
  const env=environment();const old=env.make();const owner=env.make();await old.open(lease());await owner.open(lease());await owner.cleanup();
  const next=env.make();const fresh=await next.open(lease());await fresh.commit({expectedRevision:(await fresh.read()).revision,cache:state()});
  const before=env.values.get(WORKSPACE_LIFECYCLE_KEY);await assert.rejects(old.cleanup(),matches('LIFECYCLE_BLOCKED'));
  assert.equal(env.values.get(WORKSPACE_LIFECYCLE_KEY),before);assert.ok((await fresh.read()).cache);old.dispose();owner.dispose();next.dispose();
});
test('concurrent cleanup calls share one operation and failure cannot silently retry',async()=>{
  const env=environment();const runtime=env.make();const store=await runtime.open(lease());await store.commit({expectedRevision:0,outbox:pending()});
  const a=runtime.cleanup();const b=runtime.cleanup();assert.equal(a,b);
  await assert.rejects(a,matches('LIFECYCLE_CLEANUP_INCOMPLETE'));assert.equal(runtime.cleanup(),a);runtime.dispose();
});
test('metadata write failure prevents creation of PHI database registry',async()=>{
  const env=environment();const broken=env.make({metadataStorage:{...env.options.metadataStorage,setItem(){throw new Error('quota');}}});
  await assert.rejects(broken.open(lease()),matches('FENCE_WRITE_FAILED'));
  assert.deepEqual(await env.options.indexedDB.databases(),[]);broken.dispose();
});
test('fence write failure on logout does not report cleanup success',async()=>{
  const env=environment();let fail=false;const runtime=env.make({metadataStorage:{...env.options.metadataStorage,setItem(k,v){if(fail)throw new Error('quota');env.options.metadataStorage.setItem(k,v);}}});
  await runtime.open(lease());fail=true;await assert.rejects(runtime.cleanup(),matches('FENCE_WRITE_FAILED'));await assert.rejects(runtime.open(lease()),matches('LIFECYCLE_BLOCKED'));runtime.dispose();
});
test('corrupt/missing fence blocks old handle instead of reconstructing registry',async()=>{
  for(const replacement of [null,'{bad',JSON.stringify({version:1,epoch:'x',blocked:false,scopes:[{}]})]){
    const env=environment();const runtime=env.make();const store=await runtime.open(lease());
    if(replacement===null)env.values.delete(WORKSPACE_LIFECYCLE_KEY);else env.values.set(WORKSPACE_LIFECYCLE_KEY,replacement);
    await assert.rejects(store.read());await assert.rejects(runtime.open(lease()),matches('LIFECYCLE_BLOCKED'));runtime.dispose();
  }
});
test('dispose closes local handles but does not purge or revoke other cooperating tabs',async()=>{
  const env=environment();const a=env.make();const b=env.make();const sa=await a.open(lease());const sb=await b.open(lease());await sa.commit({expectedRevision:0,cache:state()});
  const before=env.values.get(WORKSPACE_LIFECYCLE_KEY);a.dispose();assert.equal(env.values.get(WORKSPACE_LIFECYCLE_KEY),before);assert.ok((await sb.read()).cache);b.dispose();
});
test('commit inputs captured before waiting for Web Lock',async()=>{
  const env=environment();const runtime=env.make();const store=await runtime.open(lease());const payload={expectedRevision:0,cache:state()};
  const promise=store.commit(payload);payload.cache.clinic.id=OTHER;await promise;assert.equal((await store.read()).cache.clinic.id,CLINIC);runtime.dispose();
});
test('expired lease cannot open or use coordinated storage',async()=>{
  const env=environment();const runtime=env.make();const active=lease();const store=await runtime.open(active);active.expire();
  await assert.rejects(store.read(),TenantAuthUnavailableError);await assert.rejects(runtime.open(active),TenantAuthUnavailableError);runtime.dispose();
});
test('live entry points do not import lifecycle coordinator',()=>{
  for(const file of ['../src/App.jsx','../src/main.jsx','../src/lib/store.jsx','../src/lib/offline.js'])assert.ok(!readFileSync(new URL(file,import.meta.url),'utf8').includes('workspace-lifecycle'));
});

test('commit queued after logout cannot repopulate a cleaned namespace',async()=>{
  const env=environment();const owner=env.make();const remote=env.make();await owner.open(lease());const store=await remote.open(lease());
  const cleaning=owner.cleanup();const late=store.commit({expectedRevision:0,cache:state()});
  await cleaning;await assert.rejects(late,matches('LIFECYCLE_BLOCKED'));
  const fresh=env.make();const reopened=await fresh.open(lease());assert.equal((await reopened.read()).cache,null);
  owner.dispose();remote.dispose();fresh.dispose();
});
test('crash-equivalent blocked fence survives creation of a new coordinator',async()=>{
  const env=environment();const runtime=env.make();await runtime.open(lease());
  const meta=JSON.parse(env.values.get(WORKSPACE_LIFECYCLE_KEY));env.values.set(WORKSPACE_LIFECYCLE_KEY,JSON.stringify({...meta,epoch:'crashed-cleanup',blocked:true}));
  const next=env.make();await assert.rejects(next.open(lease()),matches('LIFECYCLE_BLOCKED'));runtime.dispose();next.dispose();
});
