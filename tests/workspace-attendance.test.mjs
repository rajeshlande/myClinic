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
const clock=()=>new Date(2026,10,2,10,0).getTime();
async function token(role='owner',status='booked'){
 const f=setup(role);await f.run(f.booking());const row=f.state.cache.appointments[0];row.status=status;row.token_no=7;row.scheduled_at='09:00:00';
 return {...f, get state(){return f.state;},attend(action,extra={}){return f.run({type:'attendance',table:'appointments',id:row.id,values:{action}},{now:clock,...extra});},row};
}
for(const role of ['owner','doctor','frontdesk'])test(`${role} arrival uses existing token, records late marker and queues scoped update`,async()=>{
 const f=await token(role);await f.attend('arrive');const row=f.state.cache.appointments[0];assert.equal(row.token_no,7);assert.equal(row.status,'checked-in');assert.match(row.notes,/Arrived late/);const op=f.state.outbox[1];assert.equal(op.type,'update');assert.equal(op.base.status,'booked');assert.equal(op.base._offline,undefined);assert.equal(op.patch.token_no,undefined);assert.equal(op.patch.branch_id,undefined);
});
test('no-show restores same token as late arrival without new token issuance',async()=>{const f=await token();await f.attend('no-show');assert.equal(f.state.cache.appointments[0].status,'no-show');await f.attend('arrive');assert.equal(f.state.cache.appointments[0].status,'checked-in');assert.equal(f.state.cache.appointments[0].token_no,7);assert.match(f.state.cache.appointments[0].notes,/Arrived late/);assert.equal(f.state.outbox.length,3);});
test('full notes refuse late marker truncation rather than silently losing attendance',async()=>{const f=await token();f.row.notes='x'.repeat(1000);await assert.rejects(f.attend('arrive-late'),{code:'WRITE_ATTENDANCE_NOTES_FULL'});assert.equal(f.state.cache.appointments[0].status,'booked');assert.equal(f.state.outbox.length,1);});
for(const status of ['completed','cancelled','in-consult'])test(`${status} refuses attendance`,async()=>{const f=await token('owner',status);await assert.rejects(f.attend('arrive'),{code:'WRITE_ATTENDANCE_STATE_DENIED'});assert.equal(f.state.outbox.length,1);});
test('repeated unchanged arrival refused',async()=>{const f=await token('owner','checked-in');await assert.rejects(f.attend('arrive'),{code:'WRITE_ATTENDANCE_STATE_DENIED'});});
test('repeated no-show refused',async()=>{const f=await token('owner','no-show');await assert.rejects(f.attend('no-show'),{code:'WRITE_ATTENDANCE_STATE_DENIED'});});
test('non-token record refused',async()=>{const f=await token();f.row.token_no=null;await assert.rejects(f.attend('arrive'),{code:'WRITE_ATTENDANCE_STATE_DENIED'});});
test('other day cannot be marked using device-local attendance clock',async()=>{const f=await token();f.row.scheduled_on='2026-11-01';await assert.rejects(f.attend('arrive'),{code:'WRITE_ATTENDANCE_STATE_DENIED'});});
test('doctor cannot mark another doctor token',async()=>{const f=await token('doctor');f.row.doctor_id=uuid(99);await assert.rejects(f.attend('arrive'),{code:'WRITE_REFERENCE_DENIED'});});
test('forged extra fields cannot change token or scope',async()=>{const f=await token();await assert.rejects(f.run({type:'attendance',table:'appointments',id:f.row.id,values:{action:'arrive',token_no:9}},{now:clock}),{code:'WRITE_INVALID_ATTENDANCE'});});
test('unknown attendance action refused',async()=>{const f=await token();await assert.rejects(f.attend('complete'),{code:'WRITE_INVALID_ATTENDANCE'});});
test('licence refusal also applies to attendance',async()=>{const f=await token();f.lease.licence.can_write=false;await assert.rejects(f.attend('arrive'),{code:'WRITE_LICENCE_BLOCKED'});});
test('storage refusal does not publish changed attendance',async()=>{const f=await token();f.persistence.commit=async()=>{throw new WorkspaceStorageError('QUOTA');};await assert.rejects(f.attend('arrive'),{code:'QUOTA'});assert.equal(f.state.cache.appointments[0].status,'booked');});
test('generic status/token patch still refused',async()=>{const f=await token();await assert.rejects(f.run({type:'update',table:'appointments',id:f.row.id,values:{status:'checked-in'}}),{code:'WRITE_INVALID_COMMAND'});});
