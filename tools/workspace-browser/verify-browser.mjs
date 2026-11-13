import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const origin='http://127.0.0.1:4174'; // Test runner only; browser modules use relative imports.
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const results=[];let forbiddenRequests=0;
async function page(context){const p=await context.newPage();const diagnostics=[];p.on('console',m=>{if(m.type()==='error')diagnostics.push(m.text());});await p.goto(origin);try{await p.waitForFunction(()=>Boolean(window.harness),null,{timeout:5000});}catch(error){throw new Error(`Harness initialization failed: ${diagnostics.join('; ') || error.message}`);}return p;}
async function run(name,fn){const start=Date.now();const context=await browser.newContext();const errors=[];
  context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();forbiddenRequests++;return route.abort();});
  try{await fn(context);assert.deepEqual(errors,[]);results.push({name,status:'PASS',ms:Date.now()-start});console.log(`PASS ${name}`);}
  catch(error){results.push({name,status:'FAIL',error:error.stack,ms:Date.now()-start});console.error(`FAIL ${name}\n${error.stack}`);}
  finally{await context.close();}
}
try{
await run('native secure context, Web Locks and IndexedDB available',async c=>{
  const p=await page(c);assert.deepEqual(await p.evaluate(()=>({secure:isSecureContext,locks:typeof navigator.locks?.request,idb:typeof indexedDB.open})),{secure:true,locks:'function',idb:'function'});
});
await run('native IndexedDB roundtrip survives page reload',async c=>{
  const p=await page(c);await p.evaluate(()=>harness.init());assert.equal((await p.evaluate(()=>harness.write())).ok,true);
  await p.reload();await p.waitForFunction(()=>window.harness);await p.evaluate(()=>harness.init());const saved=await p.evaluate(()=>harness.read());
  assert.equal(saved.value.cache.patients[0].id,'SYNTHETIC_ONLY_RECORD');
  const meta=await p.evaluate(()=>localStorage.getItem(harness.KEY));assert.ok(!meta.includes('SYNTHETIC_ONLY_RECORD'));
});
await run('user/workspace/clinic physical namespaces remain isolated across tabs',async c=>{
  const a=await page(c);await a.evaluate(()=>harness.init());await a.evaluate(()=>harness.write());
  for(const key of ['subject','workspaceId','clinicId']){const b=await page(c);await b.evaluate(key=>harness.init({scope:{[key]:harness.OTHER}}),key);
    const saved=await b.evaluate(()=>harness.read());assert.equal(saved.value.cache,null);assert.deepEqual(saved.value.outbox,[]);await b.close();}
});
await run('native cross-tab Web Locks serialize CAS, exactly one concurrent commit succeeds',async c=>{
  const a=await page(c);const b=await page(c);await a.evaluate(()=>harness.init());await b.evaluate(()=>harness.init());
  const writes=await Promise.all([a.evaluate(()=>harness.write()),b.evaluate(()=>harness.write())]);
  assert.equal(writes.filter(x=>x.ok).length,1);assert.equal(writes.find(x=>!x.ok).code,'REVISION_CONFLICT');
});
await run('native storage event invalidates remote session and cleans remote registered cache',async c=>{
  const a=await page(c);const b=await page(c);await a.evaluate(()=>harness.init());await b.evaluate(()=>harness.init({scope:{subject:harness.OTHER}}));
  await b.evaluate(()=>harness.write());assert.equal((await a.evaluate(()=>harness.cleanup())).ok,true);
  await b.waitForFunction(()=>harness.invalidations===1);assert.equal((await b.evaluate(()=>harness.read())).code,'LIFECYCLE_BLOCKED');
  const fresh=await page(c);await fresh.evaluate(()=>harness.init({scope:{subject:harness.OTHER}}));assert.equal((await fresh.evaluate(()=>harness.read())).value.cache,null);
});
await run('durable fence rejects stale tab when no storage-event listener is installed',async c=>{
  const a=await page(c);const b=await page(c);await a.evaluate(()=>harness.init());await b.evaluate(()=>harness.init({events:false}));
  await a.evaluate(()=>harness.cleanup());assert.equal(await b.evaluate(()=>harness.invalidations),0);
  assert.equal((await b.evaluate(()=>harness.write())).code,'LIFECYCLE_BLOCKED');
});
await run('pending outbox is retained and cleanup blocks reload rather than discarding work',async c=>{
  const p=await page(c);await p.evaluate(()=>harness.init());await p.evaluate(()=>harness.write(0,true));
  assert.equal((await p.evaluate(()=>harness.cleanup())).code,'LIFECYCLE_CLEANUP_INCOMPLETE');
  await p.reload();await p.waitForFunction(()=>window.harness);
  const refusal=await p.evaluate(async()=>{try{await harness.init();return null;}catch(e){return e.code;}});assert.equal(refusal,'LIFECYCLE_BLOCKED');
  const saved=await p.evaluate(()=>harness.rawInspect());assert.equal(saved.cache,null);assert.equal(saved.outbox.length,1);
});
await run('closing lock-owning tab releases native Web Lock to waiting tab',async c=>{
  const a=await page(c);const b=await page(c);await a.evaluate(()=>harness.holdLock());await a.waitForFunction(()=>window.lockHeld);
  await b.evaluate(()=>{window.waiting=harness.init().then(()=>{window.acquired=true;});});
  assert.equal(await b.evaluate(()=>Boolean(window.acquired)),false);await a.close();await b.waitForFunction(()=>window.acquired===true);
});
await run('page closure after persisted cleanup fence leaves new tab fail-closed',async c=>{
  const a=await page(c);await a.evaluate(()=>harness.init());await a.evaluate(()=>harness.write());
  await a.evaluate(()=>{harness.setHangOpen(true);window.cleaning=harness.cleanup();});await a.waitForFunction(()=>harness.meta()?.blocked===true);
  await a.close();const b=await page(c);const refusal=await b.evaluate(async()=>{try{await harness.init();return null;}catch(e){return e.code;}});
  assert.equal(refusal,'LIFECYCLE_BLOCKED');assert.equal(await b.evaluate(()=>harness.meta().blocked),true);
});
await run('injected metadata write refusal is not reported as successful logout cleanup',async c=>{
  const a=await page(c);await a.evaluate(()=>harness.init());await a.evaluate(()=>harness.write());await a.evaluate(()=>harness.setDenyMeta(true));
  assert.equal((await a.evaluate(()=>harness.cleanup())).code,'FENCE_WRITE_FAILED');
  assert.equal((await a.evaluate(()=>harness.read())).code,'LIFECYCLE_BLOCKED');
});
await run('injected IDB open refusal during cleanup preserves blocked generation',async c=>{
  const a=await page(c);await a.evaluate(()=>harness.init());await a.evaluate(()=>harness.write());await a.evaluate(()=>harness.setFailOpen(true));
  assert.equal((await a.evaluate(()=>harness.cleanup())).code,'LIFECYCLE_CLEANUP_INCOMPLETE');assert.equal(await a.evaluate(()=>harness.meta().blocked),true);
});
await run('native IDB versionchange closes old connection without reuse',async c=>{
  const a=await page(c);await a.evaluate(()=>harness.init());await a.evaluate(()=>harness.upgrade());assert.equal((await a.evaluate(()=>harness.read())).code,'STORAGE_CLOSED');
});
await run('native cross-tab notification invalidates real controller and its old token provider',async c=>{
  const a=await page(c);const b=await page(c);assert.equal(await a.evaluate(()=>harness.initController()),'READY');assert.equal(await b.evaluate(()=>harness.initController()),'READY');
  await a.evaluate(()=>harness.write());await a.evaluate(()=>harness.controllerLogout());
  await b.waitForFunction(()=>harness.controllerState()==='DISPOSED');assert.equal((await b.evaluate(()=>harness.oldToken())).ok,false);
});
await run('stale tab cleanup cannot erase newly reopened authenticated generation',async c=>{
  const old=await page(c);const owner=await page(c);await old.evaluate(()=>harness.init({events:false}));await owner.evaluate(()=>harness.init());await owner.evaluate(()=>harness.cleanup());
  const fresh=await page(c);await fresh.evaluate(()=>harness.init());const current=await fresh.evaluate(()=>harness.read());await fresh.evaluate(revision=>harness.write(revision),current.value.revision);
  assert.equal((await old.evaluate(()=>harness.cleanup())).code,'LIFECYCLE_BLOCKED');assert.ok((await fresh.evaluate(()=>harness.read())).value.cache);
});
await run('explicit recovery clears an interrupted empty-queue cleanup, never a stale generation',async c=>{
  const a=await page(c);await a.evaluate(()=>harness.init());await a.evaluate(()=>harness.write());
  await a.evaluate(()=>{harness.setHangOpen(true);window.cleaning=harness.cleanup();});await a.waitForFunction(()=>harness.meta()?.blocked===true);await a.close();
  const p=await page(c);await p.evaluate(()=>harness.initRecovery());const report=await p.evaluate(()=>harness.recoveryInspect());assert.equal(report.ok,true);assert.equal(report.value.workspaces[0].pendingCount,0);
  const result=await p.evaluate(epoch=>harness.recoveryRetry(epoch),report.value.expectedEpoch);assert.equal(result.value.status,'CLEARED');
  const fresh=await page(c);await fresh.evaluate(()=>harness.init());assert.equal((await fresh.evaluate(()=>harness.read())).value.cache,null);
});
await run('native recovery summary and retry preserve pending writes and keep block',async c=>{
  const p=await page(c);await p.evaluate(()=>harness.init());await p.evaluate(()=>harness.write(0,true));await p.evaluate(()=>harness.cleanup());await p.evaluate(()=>harness.initRecovery());
  const report=await p.evaluate(()=>harness.recoveryInspect());assert.equal(report.value.workspaces[0].pendingCount,1);assert.ok(!JSON.stringify(report).includes('SYNTHETIC_ONLY_RECORD'));
  const result=await p.evaluate(epoch=>harness.recoveryRetry(epoch),report.value.expectedEpoch);assert.equal(result.value.status,'BLOCKED');assert.equal(result.value.pendingWorkspaceCount,1);
  const raw=await p.evaluate(()=>harness.rawInspect());assert.equal(raw.outbox.length,1);assert.equal(raw.cache,null);
});
await run('recovery never exposes foreign namespace identifiers or cleans foreign work',async c=>{
  const p=await page(c);await p.evaluate(()=>harness.init());await p.evaluate(()=>harness.write(0,true));await p.evaluate(()=>harness.cleanup());await p.evaluate(()=>harness.initRecovery(harness.OTHER));
  const report=await p.evaluate(()=>harness.recoveryInspect());assert.deepEqual(report.value.workspaces,[]);assert.equal(report.value.otherWorkspaceCount,1);
  const result=await p.evaluate(epoch=>harness.recoveryRetry(epoch),report.value.expectedEpoch);assert.equal(result.code,'RECOVERY_NO_OWN_SCOPES');assert.equal(await p.evaluate(()=>harness.meta().blocked),true);
});
await run('account change invalidates inspected recovery confirmation before mutation',async c=>{
  const p=await page(c);await p.evaluate(()=>harness.init());await p.evaluate(()=>harness.write(0,true));await p.evaluate(()=>harness.cleanup());await p.evaluate(()=>harness.initRecovery());
  const report=await p.evaluate(()=>harness.recoveryInspect());await p.evaluate(()=>harness.recoverySignIn(harness.OTHER));
  const result=await p.evaluate(epoch=>harness.recoveryRetry(epoch),report.value.expectedEpoch);assert.equal(result.code,'RECOVERY_REVIEW_REQUIRED');assert.equal(await p.evaluate(()=>harness.meta().epoch),report.value.expectedEpoch);
});
await run('two reviewed recovery tabs cannot use a stale epoch to override each other',async c=>{
  const p=await page(c);await p.evaluate(()=>harness.init());await p.evaluate(()=>harness.write());await p.evaluate(()=>{harness.setFailOpen(true);});await p.evaluate(()=>harness.cleanup());await p.close();
  const a=await page(c);const b=await page(c);await a.evaluate(()=>harness.initRecovery());await b.evaluate(()=>harness.initRecovery());
  const ra=await a.evaluate(()=>harness.recoveryInspect());const rb=await b.evaluate(()=>harness.recoveryInspect());
  assert.equal((await a.evaluate(epoch=>harness.recoveryRetry(epoch),ra.value.expectedEpoch)).value.status,'CLEARED');
  const result=await b.evaluate(epoch=>harness.recoveryRetry(epoch),rb.value.expectedEpoch);assert.equal(result.ok,false);assert.equal(result.code,'RECOVERY_NOT_BLOCKED');
});
await run('native replay acknowledgement durably commits queue/cache/conflicts together',async c=>{
  const p=await page(c);await p.evaluate(()=>harness.initController());await p.evaluate(()=>harness.write(0,true));
  const result=await p.evaluate(()=>harness.flush());assert.equal(result.value.status,'ACKNOWLEDGED');
  await p.reload();await p.waitForFunction(()=>window.harness);await p.evaluate(()=>harness.initController());
  const saved=await p.evaluate(()=>harness.read());assert.equal(saved.value.cache,null);assert.deepEqual(saved.value.outbox,[]);assert.deepEqual(saved.value.conflicts,[]);
});
await run('native replay conflicts remain durable and block cleanup and recovery',async c=>{
  const p=await page(c);await p.evaluate(()=>harness.initController());await p.evaluate(()=>harness.write(0,true));await p.evaluate(()=>harness.setReplayFailure(true));
  const result=await p.evaluate(()=>harness.flush());assert.equal(result.value.newConflictCount,1);
  const saved=await p.evaluate(()=>harness.read());assert.equal(saved.value.outbox.length,0);assert.equal(saved.value.conflicts[0].sourceOp.op_id,'synthetic-op');
  assert.equal((await p.evaluate(()=>harness.cleanup())).code,'LIFECYCLE_CLEANUP_INCOMPLETE');
  await p.evaluate(()=>harness.initRecovery());const summary=await p.evaluate(()=>harness.recoveryInspect());assert.equal(summary.value.workspaces[0].pendingCount,1);
});
await run('native concurrent append during replay refuses ACK without losing either queue item',async c=>{
  const p=await page(c);await p.evaluate(()=>harness.initController());await p.evaluate(()=>harness.write(0,true));await p.evaluate(()=>{harness.pauseReplay();window.replayResult=harness.flush();});
  await p.waitForFunction(()=>window.replayPaused);assert.equal((await p.evaluate(()=>harness.append())).ok,true);await p.evaluate(()=>harness.releaseReplay());
  const result=await p.evaluate(()=>window.replayResult);assert.equal(result.code,'REPLAY_ACK_CONFLICT');
  assert.equal((await p.evaluate(()=>harness.read())).value.outbox.length,2);
});
await run('native per-namespace replay lock refuses simultaneous flush in another tab',async c=>{
  const a=await page(c);const b=await page(c);await a.evaluate(()=>harness.initController());await b.evaluate(()=>harness.initController());await a.evaluate(()=>harness.write(0,true));
  await a.evaluate(()=>{harness.pauseReplay();window.replayResult=harness.flush();});await a.waitForFunction(()=>window.replayPaused);
  assert.equal((await b.evaluate(()=>harness.flush())).value.status,'BUSY');await a.evaluate(()=>harness.releaseReplay());
  assert.equal((await a.evaluate(()=>window.replayResult)).value.status,'ACKNOWLEDGED');assert.equal(await b.evaluate(()=>harness.replayCalls),0);
});
await run('native staged loader publishes and durably caches exact scoped snapshot',async c=>{
  const p=await page(c);await p.evaluate(()=>harness.initController());await p.evaluate(()=>harness.initLoader());
  const result=await p.evaluate(()=>harness.load());assert.equal(result.value.state,'READY');assert.equal(result.value.patientCount,1);
  const saved=await p.evaluate(()=>harness.read());assert.equal(saved.value.cache.clinic.id,await p.evaluate(()=>harness.CLINIC));assert.equal(saved.value.cache.currentStaff.role,'owner');
});
await run('native delayed clinical load cannot republish PHI after controller logout',async c=>{
  const p=await page(c);await p.evaluate(()=>harness.initController());await p.evaluate(()=>{harness.initLoader();harness.pauseLoad();window.loading=harness.load();});
  await p.waitForFunction(()=>window.loadPaused);await p.evaluate(()=>harness.controllerLogout());assert.equal((await p.evaluate(()=>harness.loaderState())).dataCleared,true);
  await p.evaluate(()=>harness.releaseLoad());assert.equal((await p.evaluate(()=>window.loading)).ok,false);assert.equal((await p.evaluate(()=>harness.loaderState())).dataCleared,true);
});
await run('native enqueue during load protects local work and refuses cache publication',async c=>{
  const p=await page(c);await p.evaluate(()=>harness.initController());await p.evaluate(()=>{harness.initLoader();harness.pauseLoad();window.loading=harness.load();});
  await p.waitForFunction(()=>window.loadPaused);await p.evaluate(()=>harness.append());await p.evaluate(()=>harness.releaseLoad());
  assert.equal((await p.evaluate(()=>window.loading)).code,'LOAD_ACK_CONFLICT');assert.equal((await p.evaluate(()=>harness.read())).value.outbox.length,1);assert.equal((await p.evaluate(()=>harness.loaderState())).dataCleared,true);
});
const patientCommand={type:'create',table:'patients',values:{full_name:'SYNTHETIC WRITER PATIENT',code:'W01'}};
await run('native optimistic command durably pairs cache/outbox across reload',async c=>{
  const p=await page(c);await p.evaluate(()=>harness.initController());await p.evaluate(()=>harness.seedWriter());
  const result=await p.evaluate(cmd=>harness.command(cmd),patientCommand);assert.equal(result.ok,true);assert.equal(result.value.status,'QUEUED');
  await p.reload();await p.waitForFunction(()=>window.harness);await p.evaluate(()=>harness.initController());
  const state=(await p.evaluate(()=>harness.read())).value;
  assert.equal(state.outbox.length,1);assert.equal(state.outbox[0].op_id,result.value.opId);
  assert.equal(state.cache.patients[0].id,result.value.rowId);assert.equal(state.cache.patients[0]._offline,true);
  assert.equal(state.outbox[0].row._offline,undefined);assert.equal(await p.evaluate(()=>harness.replayCalls),0);
});
await run('native concurrent optimistic commands keep one CAS winner and permit reviewed retry',async c=>{
  const a=await page(c);const b=await page(c);await a.evaluate(()=>harness.initController());await b.evaluate(()=>harness.initController());await a.evaluate(()=>harness.seedWriter());
  for(const p of [a,b]){await p.evaluate(cmd=>{harness.pauseWriter();window.writing=harness.command(cmd);},patientCommand);await p.waitForFunction(()=>window.writerPaused);}
  await Promise.all([a.evaluate(()=>harness.releaseWriter()),b.evaluate(()=>harness.releaseWriter())]);
  const results=await Promise.all([a.evaluate(()=>window.writing),b.evaluate(()=>window.writing)]);
  assert.equal(results.filter(x=>x.ok).length,1);assert.equal(results.find(x=>!x.ok).code,'WRITE_ACK_CONFLICT');
  const winner=(await a.evaluate(()=>harness.read())).value;assert.equal(winner.outbox.length,1);assert.equal(winner.cache.patients.length,1);
  const retried=await b.evaluate(cmd=>harness.command(cmd),{...patientCommand,values:{...patientCommand.values,code:'W02'}});assert.equal(retried.ok,true);
  const state=(await a.evaluate(()=>harness.read())).value;assert.equal(state.outbox.length,2);assert.equal(state.cache.patients.length,2);assert.equal(state.outbox[0].op_id,winner.outbox[0].op_id);
});
await run('native stale operation after paused read cannot enqueue or alter cache',async c=>{
  const p=await page(c);await p.evaluate(()=>harness.initController());await p.evaluate(()=>harness.seedWriter());
  await p.evaluate(cmd=>{harness.pauseWriter();window.writing=harness.command(cmd);},patientCommand);await p.waitForFunction(()=>window.writerPaused);
  await p.evaluate(()=>{harness.invalidateWriter();harness.releaseWriter();});assert.equal((await p.evaluate(()=>window.writing)).ok,false);
  const raw=await p.evaluate(()=>harness.rawInspect());assert.equal(raw.outbox.length,0);assert.equal(raw.cache.patients.length,0);
});
await run('native injected write refusal and expired licence preserve durable state',async c=>{
  const p=await page(c);await p.evaluate(()=>harness.initController());await p.evaluate(()=>harness.seedWriter());
  const before=(await p.evaluate(()=>harness.read())).value;
  assert.equal((await p.evaluate(cmd=>harness.command(cmd,{storageFailure:true}),patientCommand)).code,'SYNTHETIC_QUOTA');
  assert.equal((await p.evaluate(cmd=>harness.command(cmd,{expired:true}),patientCommand)).code,'WRITE_LICENCE_BLOCKED');
  const after=(await p.evaluate(()=>harness.read())).value;assert.equal(after.revision,before.revision);assert.deepEqual(after.cache,before.cache);assert.deepEqual(after.outbox,[]);
});
await run('native repeated optimistic edits retain complete FIFO bases',async c=>{
  const p=await page(c);await p.evaluate(()=>harness.initController());await p.evaluate(()=>harness.seedWriter());
  const created=await p.evaluate(cmd=>harness.command(cmd),patientCommand);
  for(const notes of ['first edit','second edit'])assert.equal((await p.evaluate(cmd=>harness.command(cmd),{type:'update',table:'patients',id:created.value.rowId,values:{notes}})).ok,true);
  const state=(await p.evaluate(()=>harness.read())).value;assert.equal(state.outbox.length,3);assert.equal(state.outbox[1].base.notes,undefined);assert.equal(state.outbox[2].base.notes,'first edit');assert.equal(state.outbox[2].base._offline,undefined);assert.equal(state.cache.patients[0].notes,'second edit');
});
await run('native facade publishes loaded and durably queued immutable observations',async c=>{
  const p=await page(c);await p.evaluate(()=>harness.initController());await p.evaluate(()=>harness.initFacade());
  assert.equal((await p.evaluate(()=>harness.facadeLoad())).value.state,'READY');
  const receipt=await p.evaluate(cmd=>harness.facadeCommand(cmd),patientCommand);assert.equal(receipt.value.status,'QUEUED');
  const view=await p.evaluate(()=>harness.facadeSnapshot());assert.equal(view.state,'READY');assert.equal(view.pendingCount,1);assert.equal(view.data.patients[0].id,receipt.value.rowId);
  assert.equal((await p.evaluate(()=>harness.read())).value.outbox[0].op_id,receipt.value.opId);
  assert.equal(await p.evaluate(()=>Object.isFrozen(harness.facadeSnapshot().data.patients[0])),true);
});
await run('native facade delayed load clears immediately on logout and refuses stale publication',async c=>{
  const p=await page(c);await p.evaluate(()=>harness.initController());await p.evaluate(()=>{harness.initFacade();harness.pauseLoad();window.facadeLoading=harness.facadeLoad();});
  await p.waitForFunction(()=>window.loadPaused);assert.equal((await p.evaluate(()=>harness.facadeLoad())).code,'STORE_BUSY');
  await p.evaluate(()=>harness.controllerLogout());assert.equal((await p.evaluate(()=>harness.facadeSnapshot())).data,null);
  await p.evaluate(()=>harness.releaseLoad());assert.equal((await p.evaluate(()=>window.facadeLoading)).ok,false);assert.equal((await p.evaluate(()=>harness.facadeSnapshot())).data,null);
});
await run('native facade disposal clears PHI and closes future commands',async c=>{
  const p=await page(c);await p.evaluate(()=>harness.initController());await p.evaluate(()=>harness.initFacade());await p.evaluate(()=>harness.facadeLoad());
  await p.evaluate(()=>harness.disposeFacade());const view=await p.evaluate(()=>harness.facadeSnapshot());assert.equal(view.state,'DISPOSED');assert.equal(view.data,null);
  assert.equal((await p.evaluate(cmd=>harness.facadeCommand(cmd),patientCommand)).code,'STORE_CLOSED');
});
await run('native reviewed local conflict discard is explicit and durable across reload',async c=>{
 const p=await page(c);await p.evaluate(()=>harness.initController());await p.evaluate(()=>harness.seedConflict());await p.evaluate(()=>harness.initConflictReview());
 const review=(await p.evaluate(()=>harness.inspectConflicts())).value;assert.equal(review.conflicts.length,1);
 const receipt=await p.evaluate(r=>harness.discardConflicts({...r,confirmDiscardLocal:true}),review);assert.equal(receipt.value.status,'LOCAL_CONFLICTS_DISCARDED');
 assert.equal((await p.evaluate(r=>harness.discardConflicts({...r,confirmDiscardLocal:true}),review)).code,'REVIEW_CONFIRMATION_REQUIRED');
 await p.reload();await p.waitForFunction(()=>window.harness);await p.evaluate(()=>harness.initController());const state=(await p.evaluate(()=>harness.read())).value;
 assert.deepEqual(state.conflicts,[]);assert.equal(state.cache,null);assert.equal(await p.evaluate(()=>harness.replayCalls),0);
});
await run('native two reviewed tabs cannot discard against a stale revision',async c=>{
 const a=await page(c),b=await page(c);await a.evaluate(()=>harness.initController());await b.evaluate(()=>harness.initController());await a.evaluate(()=>harness.seedConflict());
 for(const p of [a,b])await p.evaluate(()=>harness.initConflictReview());
 const ar=(await a.evaluate(()=>harness.inspectConflicts())).value,br=(await b.evaluate(()=>harness.inspectConflicts())).value;
 assert.equal((await a.evaluate(r=>harness.discardConflicts({...r,confirmDiscardLocal:true}),ar)).ok,true);
 assert.equal((await b.evaluate(r=>harness.discardConflicts({...r,confirmDiscardLocal:true}),br)).code,'REVIEW_CHANGED');
 assert.deepEqual((await b.evaluate(()=>harness.read())).value.conflicts,[]);
});
await run('native review panel renders fresh comparison as text and requires explicit loss acknowledgement',async c=>{
 const p=await page(c);await p.evaluate(()=>harness.initController());await p.evaluate(()=>harness.seedConflict());await p.evaluate(()=>harness.mountConflictPanel());
 await p.getByRole('button',{name:'Fetch fresh comparison'}).click();await p.getByLabel('Local sources and fresh server comparison').waitFor();
 assert.match(await p.locator('#conflict-panel pre').textContent(),/SYNTHETIC TEXT ONLY/);assert.equal(await p.locator('#conflict-panel img').count(),0);
 const discard=p.getByRole('button',{name:'Discard reviewed local changes'});assert.equal(await discard.isDisabled(),true);
 await p.getByRole('checkbox').check();await discard.click();await p.getByRole('status').filter({hasText:'Reviewed local conflicts discarded'}).waitFor();
 assert.deepEqual((await p.evaluate(()=>harness.read())).value.conflicts,[]);assert.equal(await p.locator('#conflict-panel pre').count(),0);assert.equal(await p.evaluate(()=>harness.replayCalls),0);
});
await run('native review panel cancellation retains sources and clears displayed PHI',async c=>{
 const p=await page(c);await p.evaluate(()=>harness.initController());await p.evaluate(()=>harness.seedConflict());await p.evaluate(()=>harness.mountConflictPanel());
 await p.getByRole('button',{name:'Fetch fresh comparison'}).click();await p.getByLabel('Local sources and fresh server comparison').waitFor();
 await p.getByRole('button',{name:'Cancel without discarding'}).click();assert.equal(await p.locator('#conflict-panel pre').count(),0);assert.equal((await p.evaluate(()=>harness.read())).value.conflicts.length,1);
});
await run('native review panel invalidation clears comparison and prevents stale confirmation',async c=>{
 const p=await page(c);await p.evaluate(()=>harness.initController());await p.evaluate(()=>harness.seedConflict());await p.evaluate(()=>harness.mountConflictPanel());
 await p.getByRole('button',{name:'Fetch fresh comparison'}).click();await p.getByLabel('Local sources and fresh server comparison').waitFor();
 await p.evaluate(()=>harness.invalidateWriter());assert.equal(await p.locator('#conflict-panel pre').count(),0);assert.equal(await p.getByRole('checkbox').count(),0);
 await p.evaluate(()=>harness.disposeConflictPanel());assert.equal(await p.locator('#conflict-panel').textContent(),'');
});
await run('native pending fresh comparison cannot repopulate disposed panel',async c=>{
 const p=await page(c);await p.evaluate(()=>harness.initController());await p.evaluate(()=>harness.seedConflict());await p.evaluate(()=>{harness.mountConflictPanel();harness.pauseLoad();});
 await p.getByRole('button',{name:'Fetch fresh comparison'}).click();await p.waitForFunction(()=>window.loadPaused);
 await p.evaluate(()=>{harness.disposeConflictPanel();harness.releaseLoad();});
 // Drain the comparison continuation via an in-page observation of durable state.
 assert.equal((await p.evaluate(()=>harness.read())).value.conflicts.length,1);
 assert.equal(await p.locator('#conflict-panel').textContent(),'');
});
await run('native attendance no-show and late restoration keep same durable token and FIFO bases',async c=>{
 const p=await page(c);await p.evaluate(()=>harness.initController());const id=await p.evaluate(()=>harness.seedAttendance());
 for(const action of ['no-show','arrive'])assert.equal((await p.evaluate(cmd=>harness.command(cmd),{type:'attendance',table:'appointments',id,values:{action}})).value.status,'QUEUED');
 await p.reload();await p.waitForFunction(()=>window.harness);await p.evaluate(()=>harness.initController());const state=(await p.evaluate(()=>harness.read())).value;
 assert.equal(state.cache.appointments[0].token_no,7);assert.equal(state.cache.appointments[0].status,'checked-in');assert.match(state.cache.appointments[0].notes,/Arrived late/);
 assert.equal(state.outbox.length,2);assert.equal(state.outbox[0].base.status,'booked');assert.equal(state.outbox[1].base.status,'no-show');assert.equal(state.outbox[1].patch.token_no,undefined);
});
await run('native attendance other-day and full-note refusals preserve durable state',async c=>{
 const p=await page(c);await p.evaluate(()=>harness.initController());
 for(const [options,code] of [[{otherDay:true},'WRITE_ATTENDANCE_STATE_DENIED'],[{fullNotes:true},'WRITE_ATTENDANCE_NOTES_FULL']]){
   const id=await p.evaluate(o=>harness.seedAttendance(o),options);const before=(await p.evaluate(()=>harness.read())).value;
   assert.equal((await p.evaluate(cmd=>harness.command(cmd),{type:'attendance',table:'appointments',id,values:{action:'arrive-late'}})).code,code);
   const after=(await p.evaluate(()=>harness.read())).value;assert.equal(after.revision,before.revision);assert.equal(after.cache.appointments[0].status,'booked');assert.deepEqual(after.outbox,[]);
 }
});
await run('native replay conflict barrier preserves tail and blocks later sends/review bypass',async c=>{
 const p=await page(c);await p.evaluate(()=>harness.initController());await p.evaluate(()=>harness.write(0,true));await p.evaluate(()=>harness.append());await p.evaluate(()=>harness.setReplayFailure(true));
 const first=await p.evaluate(()=>harness.flush());assert.equal(first.value.status,'NEEDS_REVIEW');assert.equal(first.value.remainingCount,1);assert.equal(await p.evaluate(()=>harness.replayCalls),1);
 const before=(await p.evaluate(()=>harness.read())).value;assert.equal(before.conflicts.length,1);assert.equal(before.outbox[0].op_id,'new-synthetic-op');
 await p.evaluate(()=>harness.setReplayFailure(false));assert.equal((await p.evaluate(()=>harness.flush())).value.status,'BLOCKED_CONFLICTS');assert.equal(await p.evaluate(()=>harness.replayCalls),1);
 assert.deepEqual((await p.evaluate(()=>harness.read())).value,before);
 await p.evaluate(()=>harness.initConflictReview());assert.equal((await p.evaluate(()=>harness.inspectConflicts())).code,'REVIEW_QUEUED_WORK');
});
}finally{
  const summary={runtime:process.version,browser:await browser.version(),origin,syntheticOnly:true,forbiddenRequests,passed:results.filter(x=>x.status==='PASS').length,failed:results.filter(x=>x.status==='FAIL').length,results};
  await writeFile(new URL(process.env.RESULT_FILE??'browser-results.json',import.meta.url),JSON.stringify(summary,null,2)+'\n');await browser.close();
  console.log(`Browser: ${summary.browser}; ${summary.passed}/${results.length} PASS; non-harness requests: ${forbiddenRequests}`);
  if(summary.failed||forbiddenRequests)process.exitCode=1;
}
