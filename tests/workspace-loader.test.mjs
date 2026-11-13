import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IDBFactory } from 'fake-indexeddb';
import { createWorkspaceStoreLoader, readWorkspaceClinicalSnapshot } from '../src/lib/workspace-loader.mjs';
import { createWorkspaceOperations } from '../src/lib/workspace-operations.mjs';
import { createWorkspaceLifecycle } from '../src/lib/workspace-lifecycle.mjs';
import { TenantAuthUnavailableError } from '../src/lib/tenant-client.mjs';
const USER='10000000-0000-4000-8000-000000000001', WS='20000000-0000-4000-8000-000000000001', CLINIC='30000000-0000-4000-8000-000000000001';
const matches=code=>e=>e.code===code;
const defer=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function fixture(role='owner'){
  const calls=[];let hook;let cap=Infinity;let noCount=false;let rpcError=null;let rpcData={clinic_id:CLINIC,status:'active',can_write:true};const errors={};
  const tables={clinics:[{id:CLINIC}],profiles:[{id:USER,branch_scope:'all'}],staff:[{id:'seat',clinic_id:CLINIC,user_id:USER,role,active:true}],
    branches:[{id:'b1',clinic_id:CLINIC,active:true},{id:'b2',clinic_id:CLINIC,active:true}],
    staff_branches:[{clinic_id:CLINIC,staff_id:'seat',branch_id:'b1',active:true}],patients:[{id:'fictional-patient',clinic_id:CLINIC}],
    appointments:[{id:'appointment',clinic_id:CLINIC,branch_id:'b1'}],consultations:[],invoices:[],day_closes:[],reminders:[],invites:[]};
  const client={from(table){const filters=[];let start=0,end=499;let single=false;const orders=[];
    const q={select(){return q;},eq(k,v){filters.push(['eq',k,v]);return q;},in(k,v){filters.push(['in',k,v]);return q;},order(k){orders.push(k);return q;},range(a,b){start=a;end=b;return q;},single(){single=true;return q;},maybeSingle(){single=true;return q;},then(resolve,reject){return (async()=>{
      calls.push({table,filters,orders,start,end});if(hook)await hook(table);
      if(errors[table])return {error:errors[table],data:null};
      // Deliberately don't filter synthetic rows: scope validation must also catch
      // a malformed/cross-tenant backend response instead of trusting fake RLS.
      const rows=structuredClone(tables[table]??[]);return {data:single?(rows[0]??null):rows.slice(start,Math.min(end+1,start+cap)),count:noCount?null:rows.length};
    })().then(resolve,reject);}};return q;},async rpc(name,args){calls.push({rpc:name,args});if(hook)await hook('rpc');return {data:rpcData,error:rpcError};}};
  let snapshot=Object.freeze({state:'READY',selectedWorkspaceId:WS,workspaces:[{workspace_id:WS,clinic_id:CLINIC,member_role:role}]});const listeners=new Set();
  const controller={getSnapshot:()=>snapshot,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},getPersistenceScope:()=>({subject:USER,workspaceId:WS,clinicId:CLINIC}),getClinicalClient(){if(snapshot.state!=='READY')throw new TenantAuthUnavailableError();return client;}};
  const values=new Map();let fence=0;const queues=new Map();const locks={request(name,options,fn){const prior=queues.get(name)??Promise.resolve();const result=prior.then(()=>fn({name}));queues.set(name,result.catch(()=>{}));return result;}};
  const lifecycle=createWorkspaceLifecycle({locks,metadataStorage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)},indexedDB:new IDBFactory(),randomId:()=>`loader-${++fence}`});
  const loader=createWorkspaceStoreLoader({controller,lifecycle});
  return {tables,calls,errors,controller,lifecycle,loader,cap(n){cap=n;},noCount(){noCount=true;},lease:()=>createWorkspaceOperations(controller).lease(),hook(fn){hook=fn;},rpcError(e){rpcError=e;},rpcData(value){rpcData=value;},
    change(state='CONNECTING'){snapshot=Object.freeze({...snapshot,state});for(const fn of listeners)fn();},dispose(){loader.dispose();lifecycle.dispose();}};
}
test('full owner load uses exact membership, server licence and frozen snapshot',async()=>{
  const f=fixture();const result=await f.loader.load();assert.equal(result.state,'READY');assert.equal(result.data.currentStaff.id,'seat');assert.equal(result.data.branchScope,'all');assert.equal(result.data.subscription.status,'active');assert.ok(Object.isFrozen(result.data.patients[0]));
  for(const call of f.calls.filter(c=>c.table&&!['clinics','profiles'].includes(c.table)))assert.ok(call.filters.some(x=>x[1]==='clinic_id'&&x[2]===CLINIC));
  assert.equal(f.calls.find(c=>c.rpc).args.p_clinic,CLINIC);f.dispose();
});
for(const role of ['doctor','frontdesk'])test(`${role} cannot restore owner all-branch view; clinical branch tables explicitly filtered`,async()=>{
  const f=fixture(role);const data=await readWorkspaceClinicalSnapshot(f.lease());assert.equal(data.branchScope,'b1');assert.deepEqual(data.invites,[]);assert.ok(!f.calls.some(c=>c.table==='invites'));
  for(const table of ['appointments','consultations','invoices','day_closes'])assert.ok(f.calls.find(c=>c.table===table).filters.some(x=>x[0]==='in'&&x[1]==='branch_id'&&x[2][0]==='b1'));
  assert.ok(!f.calls.find(c=>c.table==='patients').filters.some(x=>x[0]==='in'));f.dispose();
});
test('no owner fallback if own mirrored staff row is absent/inactive/wrong role',async()=>{
  for(const mutation of [s=>s.user_id='other',s=>s.active=false,s=>s.role='doctor']){const f=fixture();mutation(f.tables.staff[0]);await assert.rejects(f.loader.load(),matches('CLINICAL_MEMBERSHIP_MISMATCH'));assert.ok(!f.calls.some(c=>c.table==='patients'));assert.equal(f.loader.getSnapshot().data,null);f.dispose();}
});
test('duplicate current-user memberships fail before PHI',async()=>{
  const f=fixture();f.tables.staff.push({...f.tables.staff[0],id:'duplicate'});await assert.rejects(f.loader.load(),matches('CLINICAL_MEMBERSHIP_MISMATCH'));f.dispose();
});
test('non-owner missing or multiple branches are refused rather than invented',async()=>{
  for(const rows of [[],[{clinic_id:CLINIC,staff_id:'seat',branch_id:'b1',active:true},{clinic_id:CLINIC,staff_id:'seat',branch_id:'b2',active:true}]]){
    const f=fixture('doctor');f.tables.staff_branches=rows;await assert.rejects(f.loader.load(),matches('CLINICAL_BRANCH_UNAVAILABLE'));f.dispose();}
});
test('cross-clinic PHI and cross-branch non-owner responses fail closed',async()=>{
  const f=fixture();f.tables.patients[0].clinic_id='other';await assert.rejects(f.loader.load(),matches('CLINICAL_ROW_SCOPE_MISMATCH'));f.dispose();
  const g=fixture('doctor');g.tables.appointments[0].branch_id='b2';await assert.rejects(g.loader.load(),matches('CLINICAL_ROW_SCOPE_MISMATCH'));g.dispose();
});
test('profile identity mismatch fails; absent profile never auto-creates one',async()=>{
  const f=fixture();f.tables.profiles[0].id='other';await assert.rejects(f.loader.load(),matches('CLINICAL_PROFILE_MISMATCH'));f.dispose();
  const g=fixture();g.tables.profiles=[];assert.equal((await g.loader.load()).data.profile,null);g.dispose();
});
test('missing required schema table fails instead of masquerading as empty clinic',async()=>{
  const f=fixture();f.errors.day_closes={code:'42P01',message:'sensitive backend detail'};await assert.rejects(f.loader.load());assert.equal(f.loader.getSnapshot().errorCode,'LOAD_FAILED');assert.ok(!JSON.stringify(f.loader.getSnapshot()).includes('sensitive'));f.dispose();
});
test('licence unavailable stays unknown, but wrong-clinic verdict refuses snapshot',async()=>{
  const f=fixture();f.rpcError({message:'unavailable'});const data=(await f.loader.load()).data;assert.equal(data.subscription,null);assert.equal(data.subscriptionUnknown,true);f.dispose();
  const g=fixture();g.rpcData({clinic_id:'other',status:'active'});await assert.rejects(g.loader.load(),matches('CLINICAL_LICENCE_SCOPE_MISMATCH'));g.dispose();
});
test('paged reads do not silently stop at one Supabase result page',async()=>{
  const f=fixture();f.tables.patients=Array.from({length:501},(_,i)=>({id:`p-${i}`,clinic_id:CLINIC}));assert.equal((await f.loader.load()).data.patients.length,501);assert.equal(f.calls.filter(c=>c.table==='patients').length,2);f.dispose();
});
test('pending writes prevent remote load and optimistic cache overwrite',async()=>{
  const f=fixture();const store=await f.lifecycle.open(f.lease());await store.commit({expectedRevision:0,outbox:[{op_id:'op',type:'delete',table:'patients',clinic_id:CLINIC,id:'row'}]});store.close();
  await assert.rejects(f.loader.load(),matches('LOAD_UNRESOLVED_WORK'));assert.equal(f.calls.length,0);assert.equal(f.loader.getSnapshot().errorCode,'LOAD_UNRESOLVED_WORK');f.dispose();
});
test('concurrent append during load causes CAS refusal and preserves new work',async()=>{
  const f=fixture();let done=false;f.hook(async table=>{if(table!=='patients'||done)return;done=true;const store=await f.lifecycle.open(f.lease());const current=await store.read();await store.commit({expectedRevision:current.revision,outbox:[{op_id:'op',type:'delete',table:'patients',clinic_id:CLINIC,id:'row'}]});store.close();});
  await assert.rejects(f.loader.load(),matches('LOAD_ACK_CONFLICT'));const store=await f.lifecycle.open(f.lease());assert.equal((await store.read()).outbox.length,1);store.close();assert.equal(f.loader.getSnapshot().data,null);f.dispose();
});
test('controller transition clears visible PHI synchronously',async()=>{
  const f=fixture();await f.loader.load();f.change();assert.equal(f.loader.getSnapshot().state,'IDLE');assert.equal(f.loader.getSnapshot().data,null);f.dispose();
});
test('delayed old-workspace response cannot publish or cache after invalidation',async()=>{
  const f=fixture();const entered=defer(),release=defer();f.hook(async table=>{if(table==='patients'){entered.resolve();await release.promise;}});
  const loading=f.loader.load();const rejected=assert.rejects(loading);await entered.promise;f.change();release.resolve();await rejected;assert.equal(f.loader.getSnapshot().state,'IDLE');assert.equal(f.loader.getSnapshot().data,null);f.dispose();
});
test('overlapping load cannot publish older response over newer result',async()=>{
  const f=fixture();const entered=defer(),release=defer();let first=true;f.hook(async table=>{if(table==='patients'&&first){first=false;entered.resolve();await release.promise;}});
  const old=f.loader.load();const rejected=assert.rejects(old,matches('LOAD_SUPERSEDED'));await entered.promise;await f.loader.load();release.resolve();await rejected;assert.equal(f.loader.getSnapshot().state,'READY');f.dispose();
});
test('dispose invalidates in-flight reads and cannot reopen',async()=>{
  const f=fixture();f.loader.dispose();await assert.rejects(f.loader.load(),matches('LOAD_CLOSED'));assert.equal(f.loader.getSnapshot().state,'DISPOSED');f.lifecycle.dispose();
});
test('live entry points do not import staged loader',()=>{
  for(const path of ['../src/App.jsx','../src/main.jsx','../src/lib/store.jsx'])assert.ok(!readFileSync(new URL(path,import.meta.url),'utf8').includes('workspace-loader'));
});

test('server row cap below requested page size does not truncate counted results',async()=>{
  const f=fixture();f.cap(1);const data=(await f.loader.load()).data;assert.equal(data.branches.length,2);assert.equal(f.calls.filter(c=>c.table==='branches').length,2);f.dispose();
});
test('missing counts, duplicate IDs and table limits fail instead of publishing partial snapshot',async()=>{
  const f=fixture();f.noCount();await assert.rejects(f.loader.load(),matches('CLINICAL_COUNT_REQUIRED'));f.dispose();
  const g=fixture();g.tables.patients.push({...g.tables.patients[0]});await assert.rejects(g.loader.load(),matches('CLINICAL_DUPLICATE_ROW'));g.dispose();
  const h=fixture();h.tables.patients=Array.from({length:10001},(_,i)=>({id:`p-${i}`,clinic_id:CLINIC}));await assert.rejects(h.loader.load(),matches('CLINICAL_PAGE_LIMIT'));h.dispose();
});
test('count changes during pagination refuse inconsistent table',async()=>{
  const f=fixture();f.cap(1);let reads=0;f.hook(table=>{if(table==='branches'&&++reads===2)f.tables.branches.push({id:'b3',clinic_id:CLINIC,active:true});});
  await assert.rejects(f.loader.load(),matches('CLINICAL_DIRECTORY_CHANGED'));f.dispose();
});
test('conflict-only pending work blocks reload as well as queued work',async()=>{
  const f=fixture();const store=await f.lifecycle.open(f.lease());const sourceOp={op_id:'op',type:'delete',table:'patients',clinic_id:CLINIC,id:'row'};
  await store.commit({expectedRevision:0,outbox:[],conflicts:[{id:'conflict',opId:'op',table:'patients',clinic_id:CLINIC,sourceOp}]});store.close();
  await assert.rejects(f.loader.load(),matches('LOAD_UNRESOLVED_WORK'));assert.equal(f.calls.length,0);f.dispose();
});
