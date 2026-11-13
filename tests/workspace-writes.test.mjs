import test from 'node:test';
import assert from 'node:assert/strict';
import { commitWorkspaceCommand } from '../src/lib/workspace-writes.mjs';
import { workspaceDatabaseName, WorkspaceStorageError } from '../src/lib/workspace-persistence.mjs';
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function setup(role='owner') {
  let current=true, seq=100;
  const lease={subject:uuid(1),workspaceId:uuid(2),clinicId:uuid(3),memberRole:role,licence:{status:'active',expires_at:'2099-01-01'},assertCurrent(){if(!current)throw new WorkspaceStorageError('STALE');}};
  const staff={id:uuid(4),user_id:lease.subject,clinic_id:lease.clinicId,role,active:true};
  const doctor=role==='frontdesk'?{...staff,id:uuid(9),user_id:uuid(10),role:'doctor'}:staff;
  const patient={id:uuid(5),clinic_id:lease.clinicId,full_name:'Test patient',code:'P01',archived:false};
  let state={revision:1,outbox:[],conflicts:[],cache:{clinic:{id:lease.clinicId},staff:role==='frontdesk'?[staff,doctor]:[staff],currentStaff:staff,patients:[patient],appointments:[],consultations:[],invoices:[],branches:[{id:uuid(6),clinic_id:lease.clinicId,active:true}],staffBranches:[{staff_id:staff.id,branch_id:uuid(6),clinic_id:lease.clinicId,active:true},{staff_id:doctor.id,branch_id:uuid(6),clinic_id:lease.clinicId,active:true}],activeBranchId:uuid(6),subscriptionUnknown:false,subscription:{clinic_id:lease.clinicId,status:'active',can_write:true}}};
  const persistence={name:workspaceDatabaseName(lease),async read(){return structuredClone(state);},async commit(change){lease.assertCurrent();if(change.expectedRevision!==state.revision)throw new WorkspaceStorageError('REVISION_CONFLICT');state={...state,...structuredClone(change),revision:state.revision+1};}};
  return {lease,persistence,get state(){return state;},stale(){current=false;},run(command,extras={}){return commitWorkspaceCommand({lease,persistence,command,now:()=>Date.parse('2026-11-02'),randomId:()=>uuid(seq++),...extras});},booking(){return {type:'create',table:'appointments',values:{patient_id:patient.id,doctor_id:doctor.id,scheduled_on:'2026-11-02',scheduled_at:'09:00'}};}};
}
const create={type:'create',table:'patients',values:{full_name:'New patient',code:'P02'}};
const update={type:'update',table:'patients',id:uuid(5),values:{notes:'Local edit'}};
test('create commits optimistic cache and complete FIFO source together',async()=>{const f=setup();const result=await f.run(create);assert.equal(result.status,'QUEUED');assert.equal(f.state.revision,2);assert.equal(f.state.outbox.length,1);assert.equal(f.state.cache.patients[0].id,result.rowId);assert.equal(f.state.cache.patients[0]._offline,true);assert.equal(f.state.outbox[0].row._offline,undefined);assert.equal(f.state.outbox[0].row.clinic_id,f.lease.clinicId);});
test('update retains base and earlier queued operation',async()=>{const f=setup();await f.run(update);await f.run({...update,values:{notes:'Second'}});assert.equal(f.state.outbox.length,2);assert.equal(f.state.outbox[0].base.notes,undefined);assert.equal(f.state.outbox[1].base.notes,'Local edit');assert.equal(f.state.outbox[1].base._offline,undefined);});
for(const role of ['owner','doctor','frontdesk'])test(`${role} can book within assigned branch`,async()=>{const f=setup(role);await f.run(f.booking());assert.equal(f.state.outbox[0].row.branch_id,uuid(6));});
test('frontdesk cannot archive patients',async()=>{const f=setup('frontdesk');await assert.rejects(f.run({...update,values:{archived:true}}),{code:'WRITE_CAPABILITY_DENIED'});assert.equal(f.state.revision,1);});
test('doctor cannot delete patients',async()=>{const f=setup('doctor');await assert.rejects(f.run({type:'delete',table:'patients',id:uuid(5)}),{code:'WRITE_CAPABILITY_DENIED'});});
test('owner cannot generically cascade-delete patient clinical history',async()=>{const f=setup();f.state.cache.invoices.push({patient_id:uuid(5)});await assert.rejects(f.run({type:'delete',table:'patients',id:uuid(5)}),{code:'WRITE_SPECIALIZED_COMMAND_REQUIRED'});});
for(const table of ['invoices','consultations','staff','clinic','profile','toString'])test(`generic ${table} commands refused`,async()=>{const f=setup();await assert.rejects(f.run({...create,table}),{code:'WRITE_UNSUPPORTED_COMMAND'});});
for(const key of ['clinic_id','branch_id','id','client_id','status','token_no','__proto__'])test(`scope/specialized field ${key} cannot enter patient patch`,async()=>{const f=setup();const values=JSON.parse(`{"${key}":"bad"}`);await assert.rejects(f.run({...update,values}),{code:'WRITE_INVALID_COMMAND'});});
for(const [label,mutate,code] of [
 ['scope',f=>f.persistence.name='other','WRITE_SCOPE_MISMATCH'],
 ['membership',f=>f.state.cache.staff[0].role='frontdesk','WRITE_MEMBERSHIP_MISMATCH'],
 ['expired Master verdict',f=>f.lease.licence.expires_at='2020-01-01','WRITE_LICENCE_BLOCKED'],
 ['unknown subscription',f=>f.state.cache.subscriptionUnknown=true,'WRITE_LICENCE_BLOCKED'],
 ['clinical read-only',f=>f.state.cache.subscription.can_write=false,'WRITE_LICENCE_BLOCKED'],
 ['conflicts',f=>f.state.conflicts.push({id:'conflict'}),'WRITE_UNRESOLVED_CONFLICTS'],
 ['no cache',f=>f.state.cache=null,'WRITE_CACHE_REQUIRED'],
])test(`${label} refuses without commit`,async()=>{const f=setup();mutate(f);await assert.rejects(f.run(create),{code});assert.equal(f.state.revision,1);});
test('CAS conflict preserves the concurrent queue/cache',async()=>{const f=setup();f.persistence.commit=async()=>{f.state.revision++;f.state.outbox.push({op_id:'other'});throw new WorkspaceStorageError('REVISION_CONFLICT');};await assert.rejects(f.run(create),{code:'WRITE_ACK_CONFLICT'});assert.equal(f.state.cache.patients.length,1);assert.equal(f.state.outbox.length,1);});
test('storage refusal never mutates the source cache',async()=>{const f=setup();f.persistence.commit=async()=>{throw new WorkspaceStorageError('QUOTA');};await assert.rejects(f.run(update),{code:'QUOTA'});assert.equal(f.state.cache.patients[0].notes,undefined);});
test('stale lease before commit refuses local mutation',async()=>{const f=setup();const read=f.persistence.read;f.persistence.read=async()=>{const result=await read();f.stale();return result;};await assert.rejects(f.run(update),{code:'STALE'});assert.equal(f.state.revision,1);});
test('invalidation after durable commit is not reported successful',async()=>{const f=setup();const commit=f.persistence.commit;f.persistence.commit=async c=>{await commit(c);f.stale();};await assert.rejects(f.run(update),{code:'STALE'});assert.equal(f.state.outbox.length,1);});
test('foreign branch booking refused',async()=>{const f=setup('frontdesk');f.state.cache.activeBranchId=uuid(99);await assert.rejects(f.run(f.booking()),{code:'WRITE_BRANCH_DENIED'});});
test('archived patient booking refused',async()=>{const f=setup();f.state.cache.patients[0].archived=true;await assert.rejects(f.run(f.booking()),{code:'WRITE_REFERENCE_DENIED'});});
test('existing token appointment needs specialized command',async()=>{const f=setup();await f.run(f.booking());const row=f.state.cache.appointments[0];row.token_no=1;await assert.rejects(f.run({type:'update',table:'appointments',id:row.id,values:{notes:'test'}}),{code:'WRITE_SPECIALIZED_COMMAND_REQUIRED'});});
test('duplicate slot refused',async()=>{const f=setup();await f.run(f.booking());await assert.rejects(f.run(f.booking()),{code:'WRITE_SLOT_CONFLICT'});});
test('invalid patient name refused',async()=>{const f=setup();await assert.rejects(f.run({...create,values:{code:'P02',full_name:''}}),{code:'WRITE_INVALID_PATIENT'});});
test('real persistence atomically stores cache and replayable operation',async()=>{
  const {IDBFactory}=await import('fake-indexeddb');
  const {openWorkspacePersistence}=await import('../src/lib/workspace-persistence.mjs');
  const f=setup();const store=await openWorkspacePersistence({lease:f.lease,indexedDB:new IDBFactory()});
  try {
    await store.commit({expectedRevision:0,cache:f.state.cache});
    const result=await commitWorkspaceCommand({lease:f.lease,persistence:store,command:create,randomId:(()=>{let n=500;return()=>uuid(n++);})()});
    const stored=await store.read();assert.equal(stored.outbox[0].op_id,result.opId);assert.equal(stored.cache.patients[0].id,result.rowId);
    assert.equal(stored.outbox[0].row.clinic_id,f.lease.clinicId);
  } finally {store.close();}
});
test('caller changes after invocation cannot change durable command',async()=>{
 const f=setup();let release;const gate=new Promise(r=>release=r);const read=f.persistence.read;
 f.persistence.read=async()=>{await gate;return read();};
 const command=structuredClone(create);const pending=f.run(command);command.values.full_name='Changed';release();await pending;
 assert.equal(f.state.outbox[0].row.full_name,'New patient');
});
