import { mountWorkspaceConflictPanel } from '/modules/workspace-conflict-panel.mjs';
import { createWorkspaceConflictReview } from '/modules/workspace-conflicts.mjs';
import { createWorkspaceStore } from '/modules/workspace-store.mjs';
import { commitWorkspaceCommand } from '/modules/workspace-writes.mjs';
import { createWorkspaceStoreLoader } from '/modules/workspace-loader.mjs';
import { flushWorkspaceOutbox } from '/modules/workspace-replay.mjs';
import { createWorkspaceRecovery } from '/modules/workspace-recovery.mjs';
import { createWorkspaceLifecycle, WORKSPACE_LIFECYCLE_KEY, WORKSPACE_LIFECYCLE_LOCK } from '/modules/workspace-lifecycle.mjs';
import { openWorkspacePersistence } from '/modules/workspace-persistence.mjs';
import { createWorkspaceController } from '/modules/workspace-controller.mjs';
import { createWorkspaceOperations } from '/modules/workspace-operations.mjs';
import { createTenantSession } from '/modules/tenant-client.mjs';
const SUBJECT='10000000-0000-4000-8000-000000000001';
const WORKSPACE='20000000-0000-4000-8000-000000000001';
const CLINIC='30000000-0000-4000-8000-000000000001';
const OTHER='40000000-0000-4000-8000-000000000001';
const KEY=WORKSPACE_LIFECYCLE_KEY;
const state=()=>({clinic:{id:CLINIC},patients:[{id:'SYNTHETIC_ONLY_RECORD'}]});
const pending=()=>[{op_id:'synthetic-op',type:'delete',table:'patients',clinic_id:CLINIC,id:'SYNTHETIC_ONLY_RECORD'}];
let panel; let conflictReview; let facade; let writerHold; let releaseWriter; let loader; let loadHold; let releaseLoad;
let lifecycle; let store; let controller; let oldClient; let recovery; let recoverySubject=SUBJECT; let recoveryAuthEvent;
let replayFailure=false; let replayHold=null; let releaseReplay; let replayCalls=0;
let hangOpen=false; let failOpen=false; let denyMeta=false;
let active=true; let invalidations=0; let heldResolve;
const nativeOpen=indexedDB.open.bind(indexedDB);
const idb={open(...args){if(hangOpen)return {};if(failOpen)throw new Error('synthetic storage unavailable');return nativeOpen(...args);}};
const metadata={getItem:key=>localStorage.getItem(key),setItem(key,value){if(denyMeta)throw new Error('synthetic metadata quota');localStorage.setItem(key,value);}};
function lease(extra={}) {return {subject:SUBJECT,workspaceId:WORKSPACE,clinicId:CLINIC,...extra,assertCurrent(){if(!active)throw new Error('synthetic expired lease');}};}
async function attempt(fn){try{return {ok:true,value:await fn()};}catch(error){return {ok:false,code:error.code??error.name};}}
function makeLifecycle({events=true}={}) {
  return createWorkspaceLifecycle({locks:navigator.locks,metadataStorage:metadata,indexedDB:idb,eventTarget:events?window:null,
    onInvalidate(){invalidations++;if(controller)return controller.dispose();}});
}
function clinicalQuery(table){
  let action='select',single=false,start=0,end=499;
  const q={select(){return q;},delete(){action='delete';return q;},eq(){return q;},in(){return q;},order(){return q;},range(a,b){start=a;end=b;return q;},single(){single=true;return q;},maybeSingle(){single=true;return q;},then(resolve,reject){return (async()=>{
    if(action==='delete'){replayCalls++;if(replayHold){window.replayPaused=true;await replayHold;}return replayFailure?{data:null,error:{code:'42501',status:403,message:'synthetic rejected change'}}:{data:null};}
    if(table==='patients'&&loadHold){window.loadPaused=true;await loadHold;}
    const rows=({clinics:[{id:CLINIC}],profiles:[{id:SUBJECT,branch_scope:'all'}],staff:[{id:'seat',clinic_id:CLINIC,user_id:SUBJECT,role:'owner',active:true}],
      branches:[{id:'b1',clinic_id:CLINIC,active:true}],staff_branches:[{staff_id:'seat',branch_id:'b1',clinic_id:CLINIC,active:true}],patients:state().patients.map(row=>({...row,clinic_id:CLINIC,notes:'<img src=x onerror=alert(1)> SYNTHETIC TEXT ONLY'}))})[table]??[];
    return {data:single?(rows[0]??null):rows.slice(start,end+1),count:rows.length};
  })().then(resolve,reject);}};return q;
}
function masterFixture(){
  const masterUrl='https://master.example.supabase.co';
  const row={workspace_id:WORKSPACE,clinic_id:CLINIC,tenant_slug:'synthetic-clinic',name:'Synthetic clinic',member_role:'owner',ready:true,licence:{status:'active',can_write:true,expires_at:'2099-01-01T00:00:00Z'}};
  let authEvent;
  const master={auth:{async getUser(){return {data:{user:{id:SUBJECT}}};},onAuthStateChange(fn){authEvent=fn;return {data:{subscription:{unsubscribe(){}}}};},
    async signOut(){authEvent?.('SIGNED_OUT',null);return {error:null};}},
    async rpc(){return {data:{workspaces:[row],selected_workspace_id:WORKSPACE,licence:row.licence,
      clinical:{clinical_url:'https://clinical.example.supabase.co',clinical_publishable_key:'synthetic-public-key'},booking:'booking:synthetic-clinic'}};},
    functions:{async invoke(){const time=Math.floor(Date.now()/1000);return {data:{token:'synthetic-not-a-signed-jwt',claims:{sub:SUBJECT,workspace_id:WORKSPACE,clinic_id:CLINIC,
      tenant_slug:'synthetic-clinic',member_role:'owner',iss:`${masterUrl}/functions/v1/oidc`,aud:'authenticated',role:'authenticated',kid:'synthetic-kid',alg:'RS256',iat:time,exp:time+900}}};}}};
  controller=createWorkspaceController({masterClient:master,masterUrl,
    clearLegacyCache:()=>lifecycle.cleanup(),
    mountClinicalClient(descriptor,provider){return createTenantSession({descriptor,tokenProvider:provider,
      createClientImpl(url,key,config){return {config,async removeAllChannels(){return ['ok'];},
        async rpc(){return {data:{clinic_id:CLINIC,status:'active',can_write:true}};},from:clinicalQuery};}});}});
}
window.harness={SUBJECT,WORKSPACE,CLINIC,OTHER,KEY,LOCK:WORKSPACE_LIFECYCLE_LOCK,
  get invalidations(){return invalidations;},
  async init(options={}) {lifecycle=makeLifecycle(options);store=await lifecycle.open(lease(options.scope));return store.name;},
  async initController(){masterFixture();lifecycle=makeLifecycle();await controller.boot();await controller.select(WORKSPACE);oldClient=controller.getClinicalClient();
    store=await lifecycle.open(createWorkspaceOperations(controller).lease());return controller.getSnapshot().state;},
  initRecovery(subject=SUBJECT){recoverySubject=subject;recovery=createWorkspaceRecovery({locks:navigator.locks,metadataStorage:metadata,indexedDB:idb,
    masterClient:{auth:{async getUser(){return {data:{user:recoverySubject?{id:recoverySubject}:null}};},onAuthStateChange(fn){recoveryAuthEvent=fn;return {data:{subscription:{unsubscribe(){}}}};}}}});},
  recoveryInspect:()=>attempt(()=>recovery.inspect()),
  recoveryRetry:expectedEpoch=>attempt(()=>recovery.retryCleanup({expectedEpoch,confirmRetry:true})),
  recoverySignIn(subject){recoverySubject=subject;recoveryAuthEvent?.('SIGNED_IN',{user:{id:subject}});},
  flush:()=>attempt(()=>flushWorkspaceOutbox({lease:createWorkspaceOperations(controller).lease(),persistence:store,locks:navigator.locks})),
  setReplayFailure(value){replayFailure=value;},
  pauseReplay(){replayHold=new Promise(resolve=>{releaseReplay=resolve;});window.replayPaused=false;},
  releaseReplay(){releaseReplay?.();},
  append:()=>attempt(async()=>{const current=await store.read();return store.commit({expectedRevision:current.revision,outbox:[...current.outbox,{...pending()[0],op_id:'new-synthetic-op',id:'new-synthetic-row'}]});}),
  get replayCalls(){return replayCalls;},
  async seedAttendance({otherDay=false,fullNotes=false}={}){
    await this.seedWriter();const s=await store.read();const d=new Date();if(otherDay)d.setDate(d.getDate()-1);
    const day=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const patientId='50000000-0000-4000-8000-000000000001',appointmentId='60000000-0000-4000-8000-000000000001';
    const cache={...s.cache,activeBranchId:'b1',branches:[{id:'b1',clinic_id:CLINIC,active:true}],staffBranches:[{staff_id:OTHER,branch_id:'b1',clinic_id:CLINIC,active:true}],
      patients:[{id:patientId,clinic_id:CLINIC,archived:false}],appointments:[{id:appointmentId,clinic_id:CLINIC,branch_id:'b1',patient_id:patientId,doctor_id:OTHER,scheduled_on:day,scheduled_at:'00:00:00',duration_minutes:15,status:'booked',source:'walk-in',token_no:7,notes:fullNotes?'x'.repeat(1000):''}]};
    await store.commit({expectedRevision:s.revision,cache});return appointmentId;
  },
  async seedWriter(){
    const current=await store.read();
    const staff={id:OTHER,clinic_id:CLINIC,user_id:SUBJECT,role:'owner',active:true};
    return store.commit({expectedRevision:current.revision,cache:{clinic:{id:CLINIC},staff:[staff],currentStaff:staff,patients:[],appointments:[],consultations:[],invoices:[],reminders:[],branches:[],staffBranches:[],subscriptionUnknown:false,subscription:{clinic_id:CLINIC,status:'active',can_write:true}}});
  },
  pauseWriter(){writerHold=new Promise(r=>{releaseWriter=r;});window.writerPaused=false;},
  releaseWriter(){releaseWriter?.();},
  invalidateWriter(){controller.dispose();},
  command:(command,options={})=>attempt(async()=>{
    const original=createWorkspaceOperations(controller).lease();
    const scoped=options.expired?{...original,licence:{...original.licence,expires_at:'2000-01-01'}}:original;
    const persistence={name:store.name,async read(){const value=await store.read();if(writerHold){window.writerPaused=true;await writerHold;}return value;},
      commit(value){if(options.storageFailure)throw Object.assign(new Error('injected write refusal'),{code:'SYNTHETIC_QUOTA'});return store.commit(value);}};
    return commitWorkspaceCommand({lease:scoped,persistence,command});
  }),
  async seedConflict(){const s=await store.read();const sourceOp=pending()[0];return store.commit({expectedRevision:s.revision,cache:null,outbox:[],conflicts:[{id:'synthetic-conflict',opId:sourceOp.op_id,table:sourceOp.table,clinic_id:CLINIC,sourceOp}]});},
  mountConflictPanel(){const root=document.createElement('section');root.id='conflict-panel';document.body.append(root);panel=mountWorkspaceConflictPanel({root,controller,lifecycle,locks:navigator.locks});},
  disposeConflictPanel(){panel.dispose();},
  initConflictReview(){conflictReview=createWorkspaceConflictReview({lease:createWorkspaceOperations(controller).lease(),persistence:store,locks:navigator.locks});},
  inspectConflicts:()=>attempt(()=>conflictReview.inspect()),
  discardConflicts:confirmation=>attempt(()=>conflictReview.discardLocal(confirmation)),
  initFacade(){facade=createWorkspaceStore({controller,lifecycle});},
  facadeLoad:()=>attempt(async()=>{const result=await facade.load();return {state:result.state};}),
  facadeCommand:command=>attempt(()=>facade.command(command)),
  facadeSnapshot:()=>facade.getSnapshot(),
  disposeFacade(){facade.dispose();},
  initLoader(){loader=createWorkspaceStoreLoader({controller,lifecycle});},
  load:()=>attempt(async()=>{const view=await loader.load();return {state:view.state,patientCount:view.data.patients.length};}),
  loaderState:()=>({state:loader.getSnapshot().state,dataCleared:loader.getSnapshot().data===null,errorCode:loader.getSnapshot().errorCode}),
  pauseLoad(){loadHold=new Promise(resolve=>{releaseLoad=resolve;});window.loadPaused=false;},
  releaseLoad(){releaseLoad?.();},
  controllerState:()=>controller?.getSnapshot().state,
  oldToken:()=>attempt(()=>oldClient.config.accessToken()),
  controllerLogout:()=>controller.logout().then(()=>controller.getSnapshot().state),
  read:()=>attempt(()=>store.read()),
  write:(revision=0,queue=false)=>attempt(()=>store.commit({expectedRevision:revision,cache:state(),outbox:queue?pending():[]})),
  cleanup:()=>attempt(()=>lifecycle.cleanup()),
  meta:()=>JSON.parse(localStorage.getItem(KEY)),
  expire(){active=false;},
  setHangOpen(value){hangOpen=value;},setFailOpen(value){failOpen=value;},setDenyMeta(value){denyMeta=value;},
  async rawInspect(scope={}){const raw=await openWorkspacePersistence({lease:lease(scope),indexedDB});try{return await raw.read();}finally{raw.close();}},
  holdLock(){window.lockHeld=false;window.holding=navigator.locks.request(WORKSPACE_LIFECYCLE_LOCK,{mode:'exclusive'},()=>{
    window.lockHeld=true;return new Promise(resolve=>{heldResolve=resolve;});});},
  releaseLock(){heldResolve?.();},
  async upgrade(){const name=store.name;await new Promise((resolve,reject)=>{const request=indexedDB.open(name,2);request.onsuccess=()=>{request.result.close();resolve();};request.onerror=()=>reject(request.error);});},
};
document.querySelector('#status').textContent='Native browser test harness ready. Synthetic data only.';
