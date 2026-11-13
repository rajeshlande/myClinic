import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IDBFactory } from 'fake-indexeddb';
import { openWorkspacePersistence } from '../src/lib/workspace-persistence.mjs';
import { flushWorkspaceOutbox } from '../src/lib/workspace-replay.mjs';
import { TenantAuthUnavailableError } from '../src/lib/tenant-client.mjs';
const subject='10000000-0000-4000-8000-000000000001';
const workspaceId='20000000-0000-4000-8000-000000000001';
const clinicId='30000000-0000-4000-8000-000000000001';
const matches=code=>e=>e.code===code;
const op=(id='op-1')=>({op_id:id,type:'delete',table:'patients',clinic_id:clinicId,id:`row-${id}`});
const create=()=>({...op(),type:'create',client_id:'local-id',row:{id:'row-new',client_id:'local-id',clinic_id:clinicId,name:'SYNTHETIC ONLY'}});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function fixture(ops=[op()]){
  let active=true;let hook;let failure;const calls=[];const server=new Map();const indexedDB=new IDBFactory();
  const client={from(table){let action='select',row,id,localId;
    const q={select(){return q;},eq(column,value){if(column==='id')id=value;if(column==='client_id')localId=value;return q;},
      insert(value){action='insert';row=value;return q;},update(value){action='update';row=value;return q;},delete(){action='delete';return q;},
      maybeSingle(){return q;},single(){return q;},then(resolve,reject){return (async()=>{
        calls.push({action,table,id});if(hook)await hook(action);if(failure)return {data:null,error:failure};
        if(action==='select')return {data:id?server.get(id)??null:[...server.values()].find(r=>r.client_id===localId)??null};
        if(action==='insert'){server.set(row.id,structuredClone(row));return {data:structuredClone(row)};}
        if(action==='update'){const saved={...server.get(id),...row};server.set(id,saved);return {data:saved};}
        server.delete(id);return {data:null};
      })().then(resolve,reject);}};return q;}};
  const lease={subject,workspaceId,clinicId,assertCurrent(){if(!active)throw new TenantAuthUnavailableError('expired');},
    async run(fn){this.assertCurrent();const value=await fn(client);this.assertCurrent();return value;}};
  const held=new Set();const locks={async request(name,options,callback){if(held.has(name))return callback(null);held.add(name);try{return await callback({name});}finally{held.delete(name);}}};
  const persistence=await openWorkspacePersistence({lease,indexedDB});await persistence.commit({expectedRevision:0,cache:{clinic:{id:clinicId}},outbox:ops});
  return {lease,persistence,indexedDB,locks,calls,server,hook(fn){hook=fn;},fail(error){failure=error;},expire(){active=false;},
    flush(extra={}){return flushWorkspaceOutbox({lease,persistence,locks,...extra});},
    async inspect(){const raw=await openWorkspacePersistence({lease:{...lease,assertCurrent(){}},indexedDB});try{return await raw.read();}finally{raw.close();}},close(){persistence.close();}};
}
test('delete acknowledgement atomically clears queue and invalidates cache',async()=>{
  const f=await fixture();const result=await f.flush();assert.equal(result.status,'ACKNOWLEDGED');assert.equal(result.appliedCount,1);
  const saved=await f.persistence.read();assert.equal(saved.cache,null);assert.deepEqual(saved.outbox,[]);assert.deepEqual(saved.conflicts,[]);f.close();
});
test('successful create uses existing replay dedupe and is not inserted twice',async()=>{
  const item=create();const f=await fixture([item]);f.server.set(item.row.id,item.row);
  await f.flush();assert.equal(f.calls.filter(c=>c.action==='insert').length,0);assert.equal((await f.persistence.read()).outbox.length,0);f.close();
});
test('server rejection persists complete source operation and unresolved conflict before dropping queue item',async()=>{
  const item=create();const f=await fixture([item]);f.fail({code:'42501',status:403,message:'SYNTHETIC sensitive backend detail'});
  const result=await f.flush();assert.equal(result.newConflictCount,1);const saved=await f.persistence.read();assert.equal(saved.outbox.length,0);
  assert.deepEqual(saved.conflicts[0].sourceOp,item);assert.ok(!saved.conflicts[0].message.includes('sensitive'));assert.equal(saved.conflicts[0].clinic_id,clinicId);f.close();
});
test('unresolved conflicts survive reopen and prevent cleanup/recovery treating queue as empty',async()=>{
  const f=await fixture([create()]);f.fail({code:'42501',status:403,message:'denied'});await f.flush();
  assert.equal((await f.persistence.inspectPending()).pendingCount,1);
  await assert.rejects(f.persistence.cleanup(),matches('PENDING_WRITES_RETAINED'));
  const saved=await f.inspect();assert.equal(saved.conflicts.length,1);assert.equal(saved.outbox.length,0);f.close();
});
test('temporary failure retains queued work with retry metadata',async()=>{
  const f=await fixture();f.fail({message:'NetworkError',status:503});const result=await f.flush();assert.equal(result.status,'STOPPED');
  const saved=await f.persistence.read();assert.equal(saved.outbox[0].attempts,1);assert.ok(Number.isFinite(saved.outbox[0].next_attempt_at));f.close();
});
test('FIFO backoff never skips head to send later dependent work',async()=>{
  const f=await fixture([{...op(),next_attempt_at:Date.now()+60000},op('later')]);assert.equal((await f.flush()).status,'BACKOFF');assert.equal(f.calls.length,0);f.close();
});
test('second flush returns BUSY instead of concurrent duplicate replay',async()=>{
  const f=await fixture();const entered=deferred();const release=deferred();f.hook(async()=>{entered.resolve();await release.promise;});
  const first=f.flush();await entered.promise;assert.equal((await f.flush()).status,'BUSY');release.resolve();await first;assert.equal(f.calls.length,1);f.close();
});
test('lease expiry during network work keeps durable original queue and rejects result',async()=>{
  const f=await fixture();f.hook(()=>{f.expire();});await assert.rejects(f.flush(),TenantAuthUnavailableError);
  assert.equal((await f.inspect()).outbox.length,1);f.close();
});
test('concurrent append causes ACK conflict without deleting new or original queue items',async()=>{
  const f=await fixture();let done=false;f.hook(async()=>{if(done)return;done=true;const current=await f.persistence.read();await f.persistence.commit({expectedRevision:current.revision,outbox:[...current.outbox,op('new-append')]});});
  await assert.rejects(f.flush(),matches('REPLAY_ACK_CONFLICT'));assert.deepEqual((await f.persistence.read()).outbox.map(o=>o.op_id),['op-1','new-append']);f.close();
});
test('an edited in-flight queue item is not overwritten by replay acknowledgement',async()=>{
  const f=await fixture();f.hook(async()=>{const current=await f.persistence.read();await f.persistence.commit({expectedRevision:current.revision,outbox:[{...op(),id:'edited-row'}]});});
  await assert.rejects(f.flush(),matches('REPLAY_ACK_CONFLICT'));assert.equal((await f.persistence.read()).outbox[0].id,'edited-row');f.close();
});
test('failed durable acknowledgement never reports success or loses conflict source',async()=>{
  const f=await fixture([create()]);f.fail({code:'42501',status:403,message:'denied'});
  await assert.rejects(f.flush({persistence:{name:f.persistence.name,read:()=>f.persistence.read(),commit(){throw new Error('synthetic quota');}}}));
  const saved=await f.persistence.read();assert.equal(saved.outbox.length,1);assert.equal(saved.conflicts,undefined);f.close();
});
test('maximum50 operations acknowledged per flush; tail retained in order',async()=>{
  const f=await fixture(Array.from({length:51},(_,i)=>op(`n-${i}`)));const result=await f.flush();assert.equal(result.appliedCount,50);assert.equal((await f.persistence.read()).outbox[0].op_id,'n-50');f.close();
});
test('auth token denial is never transformed into durable rejected conflict/removal',async()=>{
  const f=await fixture([create()]);f.fail(new TenantAuthUnavailableError('synthetic denied'));await assert.rejects(f.flush(),TenantAuthUnavailableError);
  assert.equal((await f.persistence.read()).outbox.length,1);assert.equal((await f.persistence.read()).conflicts,undefined);f.close();
});
test('storage fence read refusal prevents clinical network operation',async()=>{
  const f=await fixture();await assert.rejects(f.flush({persistence:{name:f.persistence.name,read(){throw new Error('fenced');},commit(){assert.fail();}}}));assert.equal(f.calls.length,0);f.close();
});
test('scope mismatch and unavailable lock API fail closed',async()=>{
  const f=await fixture();await assert.rejects(f.flush({locks:null}),matches('REPLAY_UNAVAILABLE'));
  await assert.rejects(f.flush({persistence:{name:'wrong',read(){},commit(){}}}),matches('REPLAY_SCOPE_MISMATCH'));f.close();
});
test('invalid conflict envelope aborts cache/queue update atomically',async()=>{
  const f=await fixture();const current=await f.persistence.read();
  await assert.rejects(f.persistence.commit({expectedRevision:current.revision,cache:null,outbox:[],conflicts:[{id:'bad',clinic_id:clinicId,table:'patients',opId:'op-1',sourceOp:{...op(),clinic_id:subject}}]}));
  const saved=await f.persistence.read();assert.ok(saved.cache);assert.equal(saved.outbox.length,1);f.close();
});
test('empty queue reports BLOCKED_CONFLICTS without acknowledging away existing conflicts',async()=>{
  const f=await fixture([create()]);f.fail({code:'42501',status:403,message:'denied'});await f.flush();assert.equal((await f.flush()).status,'BLOCKED_CONFLICTS');assert.equal((await f.persistence.read()).conflicts.length,1);f.close();
});
test('live app and legacy offline engine do not import staged replay',()=>{
  for(const file of ['../src/App.jsx','../src/main.jsx','../src/lib/store.jsx','../src/lib/offline.js'])assert.ok(!readFileSync(new URL(file,import.meta.url),'utf8').includes('workspace-replay'));
});

test('reusing an unresolved conflict ID cannot overwrite its retained original source',async()=>{
  const f=await fixture([create()]);f.fail({code:'42501',status:403,message:'denied'});await f.flush();const first=await f.persistence.read();
  await f.persistence.commit({expectedRevision:first.revision,outbox:[create()]});
  assert.equal((await f.flush()).status,'BLOCKED_CONFLICTS');const saved=await f.persistence.read();assert.equal(saved.outbox.length,1);assert.deepEqual(saved.conflicts,first.conflicts);f.close();
});

test('conflict-aware acknowledgement upgrades envelope so old version1-only readers fail closed',async()=>{
  const f=await fixture();await f.flush();
  const db=await new Promise((resolve,reject)=>{const r=f.indexedDB.open(f.persistence.name,1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const record=await new Promise((resolve,reject)=>{const r=db.transaction('workspace').objectStore('workspace').get('state');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  assert.equal(record.version,2);assert.ok(Array.isArray(record.conflicts));assert.notEqual(record.version,1);db.close();f.close();
});

// Reconciliation barrier: never drain an optimistic dependency tail past conflict.
test('first rejected source stops all later network work and retains FIFO tail',async()=>{
 const items=[create(),op('later-1'),op('later-2')];const f=await fixture(items);f.fail({code:'42501',status:403,message:'denied'});
 const result=await f.flush();assert.equal(result.status,'NEEDS_REVIEW');assert.equal(result.newConflictCount,1);
 const state=await f.persistence.read();assert.deepEqual(state.outbox,items.slice(1));assert.deepEqual(state.conflicts[0].sourceOp,items[0]);
 assert.equal(f.calls.some(c=>c.action==='delete'),false);f.close();
});
test('existing conflicts block later flush without remote access or revision change',async()=>{
 const f=await fixture([create(),op('later')]);f.fail({code:'42501',status:403,message:'denied'});await f.flush();const before=await f.persistence.read(),calls=f.calls.length;f.fail(null);
 const result=await f.flush();assert.equal(result.status,'BLOCKED_CONFLICTS');assert.equal(result.remainingCount,1);assert.equal(f.calls.length,calls);assert.deepEqual(await f.persistence.read(),before);f.close();
});
test('successful FIFO prefix is acknowledged but first conflict stops the tail',async()=>{
 const items=[op('success'),create(),op('tail')];const f=await fixture(items);f.hook(action=>{if(action==='select')f.fail({code:'42501',status:403,message:'denied'});});
 const result=await f.flush();assert.equal(result.appliedCount,1);assert.equal(result.status,'NEEDS_REVIEW');const state=await f.persistence.read();assert.deepEqual(state.outbox,[items[2]]);assert.equal(state.conflicts.length,1);assert.equal(state.cache,null);f.close();
});
test('deleted-remotely conflict stops dependent updates before they can recreate or overwrite',async()=>{
 const first={...op('missing'),type:'update',id:'same-row',base:{id:'same-row',clinic_id:clinicId,notes:'base'},patch:{notes:'first'}};
 const second={...first,op_id:'dependent',patch:{notes:'second'}};const f=await fixture([first,second]);const result=await f.flush();assert.equal(result.status,'NEEDS_REVIEW');assert.equal(f.calls.length,1);assert.deepEqual((await f.persistence.read()).outbox,[second]);f.close();
});
test('temporary retry retains current source metadata and unattempted tail',async()=>{
 const items=[op('head'),op('tail')];const f=await fixture(items);f.fail({status:503,message:'network unavailable'});const result=await f.flush();assert.equal(result.status,'STOPPED');const state=await f.persistence.read();assert.equal(state.outbox[0].attempts,1);assert.deepEqual(state.outbox[1],items[1]);assert.equal(f.calls.length,1);f.close();
});
test('manual-field conflict may apply current-source nonmanual fields but never attempts next source',async()=>{
 const first={...op('status-change'),type:'update',table:'appointments',id:'appointment',base:{id:'appointment',clinic_id:clinicId,status:'booked',notes:'before'},patch:{status:'checked-in',notes:'desk note'}};
 const second={...first,op_id:'dependent-complete',patch:{status:'completed'}};
 const f=await fixture([first,second]);f.server.set('appointment',{id:'appointment',clinic_id:clinicId,status:'cancelled',notes:'before'});
 const result=await f.flush();assert.equal(result.status,'NEEDS_REVIEW');assert.equal(result.newConflictCount,1);assert.equal(f.calls.filter(c=>c.action==='select').length,1);
 const state=await f.persistence.read();assert.deepEqual(state.outbox,[second]);assert.equal(state.conflicts[0].sourceOp.op_id,first.op_id);assert.equal(f.server.get('appointment').status,'cancelled');f.close();
});
