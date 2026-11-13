import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IDBFactory } from 'fake-indexeddb';
import { createWorkspaceRecovery } from '../src/lib/workspace-recovery.mjs';
import { createWorkspaceLifecycle, WORKSPACE_LIFECYCLE_KEY } from '../src/lib/workspace-lifecycle.mjs';
import { openWorkspacePersistence } from '../src/lib/workspace-persistence.mjs';
const USER='10000000-0000-4000-8000-000000000001';
const WS='20000000-0000-4000-8000-000000000001';
const CLINIC='30000000-0000-4000-8000-000000000001';
const OTHER='40000000-0000-4000-8000-000000000001';
const scope={subject:USER,workspaceId:WS,clinicId:CLINIC};
const matches=code=>e=>e.code===code;
const pending=()=>[{op_id:'synthetic-op',type:'delete',table:'patients',clinic_id:CLINIC,id:'synthetic-patient'}];
function environment(scopes=[scope]) {
  const indexedDB=new IDBFactory(); let chain=Promise.resolve(); let epoch=0;let subject=USER;let listener;let getUserHook;
  const values=new Map([[WORKSPACE_LIFECYCLE_KEY,JSON.stringify({version:1,epoch:'blocked-0',blocked:true,scopes})]]);
  const metadataStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
  const locks={request(name,options,callback){const result=chain.then(callback);chain=result.catch(()=>{});return result;}};
  const masterClient={auth:{async getUser(){if(getUserHook)return getUserHook();return {data:{user:subject?{id:subject}:null}};},onAuthStateChange(fn){listener=fn;return {data:{subscription:{unsubscribe(){listener=null;}}}};}}};
  const options={masterClient,locks,metadataStorage,indexedDB,randomId:()=>`recovery-${++epoch}`};
  return {options,values,meta:()=>JSON.parse(values.get(WORKSPACE_LIFECYCLE_KEY)),make:extra=>createWorkspaceRecovery({...options,...extra}),
    signIn(id){subject=id;listener?.('SIGNED_IN',{user:{id}});},setGetUser(fn){getUserHook=fn;},
    async raw(s=scope){return openWorkspacePersistence({lease:{...s,assertCurrent(){}},indexedDB});},
    async seed({s=scope,queue=false}={}){const store=await this.raw(s);await store.commit({expectedRevision:0,cache:{clinic:{id:CLINIC},patients:[{id:'synthetic-patient'}]},outbox:queue?pending():[]});store.close();} };
}
test('requires native-Master Auth verification API, Web Locks and metadata',()=>{
  assert.throws(()=>createWorkspaceRecovery(),matches('RECOVERY_AUTH_REQUIRED'));
  const env=environment();assert.throws(()=>env.make({locks:null}),matches('LIFECYCLE_UNAVAILABLE'));
});
test('inspect returns own counts only, with no patient rows or foreign identifiers',async()=>{
  const foreign={...scope,subject:OTHER,workspaceId:OTHER};const env=environment([scope,foreign]);await env.seed({queue:true});
  const recovery=env.make();const report=await recovery.inspect();assert.equal(report.workspaces[0].pendingCount,1);assert.equal(report.otherWorkspaceCount,1);
  const text=JSON.stringify(report);assert.ok(!text.includes('synthetic-patient'));assert.ok(!text.includes(OTHER));assert.ok(Object.isFrozen(report.workspaces));recovery.dispose();
});
test('readonly summary does not purge expired cache or advance durable revision',async()=>{
  const env=environment();await env.seed();const recovery=env.make({now:()=>Date.now()+86400001});
  assert.equal((await recovery.inspect()).workspaces[0].hasCache,true);
  const raw=await env.raw();const summary=await raw.inspectPending();assert.equal(summary.revision,1);assert.equal(summary.hasCache,true);raw.close();recovery.dispose();
});
test('unauthenticated and server-denied users cannot inspect or mutate fence',async()=>{
  const env=environment();const recovery=env.make();const before=env.values.get(WORKSPACE_LIFECYCLE_KEY);
  env.signIn(null);await assert.rejects(recovery.inspect(),matches('RECOVERY_AUTH_REQUIRED'));
  env.setGetUser(()=>({error:{message:'secret server detail'}}));await assert.rejects(recovery.retryCleanup({expectedEpoch:'blocked-0',confirmRetry:true}),matches('RECOVERY_AUTH_REQUIRED'));
  assert.equal(env.values.get(WORKSPACE_LIFECYCLE_KEY),before);recovery.dispose();
});
test('inspect refused for nonblocked or corrupt fence rather than repairing it',async()=>{
  const env=environment();const recovery=env.make();env.values.set(WORKSPACE_LIFECYCLE_KEY,JSON.stringify({...env.meta(),blocked:false}));
  await assert.rejects(recovery.inspect(),matches('RECOVERY_NOT_BLOCKED'));env.values.set(WORKSPACE_LIFECYCLE_KEY,'bad');await assert.rejects(recovery.inspect(),matches('CORRUPT_FENCE'));recovery.dispose();
});
test('retry requires explicit confirmation and current inspected epoch',async()=>{
  const env=environment();const recovery=env.make();
  await assert.rejects(recovery.retryCleanup({expectedEpoch:'blocked-0'}),matches('RECOVERY_CONFIRMATION_REQUIRED'));
  await assert.rejects(recovery.retryCleanup({expectedEpoch:'old',confirmRetry:true}),matches('RECOVERY_STALE'));
  assert.equal(env.meta().epoch,'blocked-0');recovery.dispose();
});
test('empty own queue permits cleanup retry and a NEW lifecycle instance only',async()=>{
  const env=environment();await env.seed();const recovery=env.make();const inspected=await recovery.inspect();
  const result=await recovery.retryCleanup({expectedEpoch:inspected.expectedEpoch,confirmRetry:true});assert.equal(result.status,'CLEARED');assert.equal(env.meta().blocked,false);assert.deepEqual(env.meta().scopes,[]);
  const runtime=createWorkspaceLifecycle(env.options);const facade=await runtime.open({...scope,assertCurrent(){}});assert.equal((await facade.read()).cache,null);runtime.dispose();recovery.dispose();
});
test('pending work is retained; retry cannot unblock or automatically discard it',async()=>{
  const env=environment();await env.seed({queue:true});const recovery=env.make();await recovery.inspect();const result=await recovery.retryCleanup({expectedEpoch:'blocked-0',confirmRetry:true});
  assert.equal(result.status,'BLOCKED');assert.equal(result.pendingWorkspaceCount,1);assert.equal(env.meta().blocked,true);
  const raw=await env.raw();const data=await raw.read();assert.equal(data.cache,null);assert.equal(data.outbox.length,1);raw.close();
  await assert.rejects(recovery.retryCleanup({expectedEpoch:'blocked-0',confirmRetry:true}),matches('RECOVERY_STALE'));recovery.dispose();
});
test('retry never opens another account database and leaves its scope blocked',async()=>{
  const foreign={...scope,subject:OTHER,workspaceId:OTHER};const env=environment([scope,foreign]);await env.seed();await env.seed({s:foreign,queue:true});const recovery=env.make();await recovery.inspect();
  const result=await recovery.retryCleanup({expectedEpoch:'blocked-0',confirmRetry:true});assert.equal(result.blocked,true);assert.equal(result.cleanedCount,1);assert.equal(result.otherWorkspaceCount,1);assert.deepEqual(env.meta().scopes,[foreign]);
  const raw=await env.raw(foreign);const saved=await raw.read();assert.ok(saved.cache);assert.equal(saved.outbox.length,1);raw.close();recovery.dispose();
});
test('account with no own scopes cannot rotate or clear other-account fence',async()=>{
  const foreign={...scope,subject:OTHER};const env=environment([foreign]);const recovery=env.make();await recovery.inspect();
  await assert.rejects(recovery.retryCleanup({expectedEpoch:'blocked-0',confirmRetry:true}),matches('RECOVERY_NO_OWN_SCOPES'));assert.equal(env.meta().epoch,'blocked-0');recovery.dispose();
});
test('accounts can sequentially finish only their own already-empty scopes',async()=>{
  const foreign={...scope,subject:OTHER,workspaceId:OTHER};const env=environment([scope,foreign]);await env.seed();await env.seed({s:foreign});const recovery=env.make();await recovery.inspect();
  assert.equal((await recovery.retryCleanup({expectedEpoch:'blocked-0',confirmRetry:true})).blocked,true);env.signIn(OTHER);
  const report=await recovery.inspect();assert.equal(report.workspaces.length,1);
  assert.equal((await recovery.retryCleanup({expectedEpoch:report.expectedEpoch,confirmRetry:true})).blocked,false);recovery.dispose();
});
test('crashed fence with empty registry can be explicitly cleared by verified user',async()=>{
  const env=environment([]);const recovery=env.make();assert.equal((await recovery.inspect()).workspaces.length,0);
  assert.equal((await recovery.retryCleanup({expectedEpoch:'blocked-0',confirmRetry:true})).status,'CLEARED');recovery.dispose();
});
test('concurrent retries serialize and stale second review cannot override first',async()=>{
  const env=environment();await env.seed();const recovery=env.make();await recovery.inspect();const results=await Promise.allSettled([recovery.retryCleanup({expectedEpoch:'blocked-0',confirmRetry:true}),recovery.retryCleanup({expectedEpoch:'blocked-0',confirmRetry:true})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(env.meta().blocked,false);recovery.dispose();
});
test('identity change during verified access prevents result release and unblock',async()=>{
  const env=environment();await env.seed();const recovery=env.make();let calls=0;
  env.setGetUser(()=>{if(++calls===2)env.signIn(OTHER);return {data:{user:{id:USER}}};});
  await assert.rejects(recovery.inspect());assert.equal(env.meta().blocked,true);recovery.dispose();
});
test('identity change after cleanup fence rotation leaves block and registry intact',async()=>{
  const env=environment();await env.seed();let recovery;const storage={...env.options.metadataStorage,setItem(k,v){env.options.metadataStorage.setItem(k,v);if(JSON.parse(v).epoch!=='blocked-0')env.signIn(OTHER);}};
  recovery=env.make({metadataStorage:storage});await recovery.inspect();await assert.rejects(recovery.retryCleanup({expectedEpoch:'blocked-0',confirmRetry:true}));assert.equal(env.meta().blocked,true);assert.equal(env.meta().scopes.length,1);recovery.dispose();
});
test('metadata write refusal cannot clear fence or report success',async()=>{
  const env=environment();await env.seed();const recovery=env.make({metadataStorage:{...env.options.metadataStorage,setItem(){throw new Error('quota');}}});
  await recovery.inspect();
  await assert.rejects(recovery.retryCleanup({expectedEpoch:'blocked-0',confirmRetry:true}),matches('FENCE_WRITE_FAILED'));assert.equal(env.meta().blocked,true);recovery.dispose();
});
test('storage failure is summarized without PHI/errors and stays blocked on retry',async()=>{
  const env=environment();const recovery=env.make({indexedDB:{open(){throw new Error('sensitive storage detail');}}});
  const report=await recovery.inspect();assert.equal(report.workspaces[0].status,'UNAVAILABLE');assert.ok(!JSON.stringify(report).includes('sensitive'));
  const result=await recovery.retryCleanup({expectedEpoch:'blocked-0',confirmRetry:true});assert.equal(result.failedWorkspaceCount,1);assert.equal(env.meta().blocked,true);recovery.dispose();
});
test('dispose invalidates recovery and unregisters Auth listener',async()=>{
  const env=environment();const recovery=env.make();recovery.dispose();recovery.dispose();await assert.rejects(recovery.inspect(),matches('RECOVERY_CLOSED'));
});
test('live app/store entry points do not import recovery',()=>{
  for(const file of ['../src/App.jsx','../src/main.jsx','../src/lib/store.jsx'])assert.ok(!readFileSync(new URL(file,import.meta.url),'utf8').includes('workspace-recovery'));
});

test('same-instance verified review is mandatory and invalidated by account change',async()=>{
  const env=environment();const recovery=env.make();
  await assert.rejects(recovery.retryCleanup({expectedEpoch:'blocked-0',confirmRetry:true}),matches('RECOVERY_REVIEW_REQUIRED'));
  await recovery.inspect();env.signIn(OTHER);
  await assert.rejects(recovery.retryCleanup({expectedEpoch:'blocked-0',confirmRetry:true}),matches('RECOVERY_REVIEW_REQUIRED'));
  assert.equal(env.meta().epoch,'blocked-0');recovery.dispose();
});
