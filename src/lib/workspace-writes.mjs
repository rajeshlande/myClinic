/** Staged local-only patient/basic-booking commands. No server calls or flush.
 * Commit optimistic cache and its complete operation in one scoped CAS write.
 */
import { workspaceDatabaseName, WorkspaceStorageError } from './workspace-persistence.mjs';
import { licenceAllowsClinicalWrites } from './workspace-boot.mjs';
import { canWrite, licenseState } from './license.mjs';
import { can } from './permissions.js';
import { visibleBranchIds } from './branch-config.mjs';
import { validatePatient, validateAppointment } from './validation.mjs';
import { arrivalPatch, noShowPatch, isArrivedLate, isPastSlot } from './token-policy.mjs';
import { localISO } from './dates.mjs';
const fail = (code) => new WorkspaceStorageError(code);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELDS = {
  patients: new Set(['code','full_name','phone','email','gender','dob','age_years','blood_group','address','city','emergency_contact','tags','allergies','notes','archived']),
  appointments: new Set(['patient_id','doctor_id','scheduled_on','scheduled_at','duration_minutes','kind','reason','notes','source']),
};
function plain(value) { return value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function patientValid(row) {
  if (Object.keys(validatePatient(row)).length || typeof row.code !== 'string' || row.code.length < 2 || row.code.length > 24) throw fail('WRITE_INVALID_PATIENT');
  for (const [key,max] of Object.entries({full_name:120,phone:24,email:120,address:300,city:80,emergency_contact:120,allergies:500,notes:2000})) {
    if (row[key] !== undefined && (typeof row[key] !== 'string' || row[key].length > max)) throw fail('WRITE_INVALID_PATIENT');
  }
  if ((row.age_years != null && (!Number.isInteger(row.age_years) || row.age_years < 0 || row.age_years > 130))
    || (row.gender !== undefined && !['Female','Male','Other'].includes(row.gender))
    || (row.blood_group !== undefined && !['','A+','A-','B+','B-','AB+','AB-','O+','O-'].includes(row.blood_group))
    || (row.archived !== undefined && typeof row.archived !== 'boolean')
    || (row.tags !== undefined && (!Array.isArray(row.tags) || row.tags.some(t=>typeof t!=='string')))) throw fail('WRITE_INVALID_PATIENT');
}

export async function commitWorkspaceCommand({ lease, persistence, command, now = Date.now,
  randomId = () => globalThis.crypto.randomUUID() } = {}) {
  if (typeof lease?.assertCurrent !== 'function' || typeof persistence?.read !== 'function' || typeof persistence?.commit !== 'function') throw fail('WRITE_UNAVAILABLE');
  let input;
  try { input = structuredClone(command); } catch { throw fail('WRITE_INVALID_COMMAND'); }
  if (!plain(input) || !['create','update','delete','attendance'].includes(input.type) || !Object.hasOwn(FIELDS,input.table)
    || Object.keys(input).some(k=>!['type','table','id','values'].includes(k))) throw fail('WRITE_UNSUPPORTED_COMMAND');
  const attendance=input.type==='attendance';
  const { table, id }=input;const type=attendance?'update':input.type;
  let values = input.values ?? {};
  const action=attendance?values?.action:null;
  if(attendance && (table!=='appointments'||!plain(values)||Object.keys(values).length!==1||!['arrive','arrive-late','no-show'].includes(action)))throw fail('WRITE_INVALID_ATTENDANCE');
  if (!plain(values) || (!attendance && Object.keys(values).some(k=>!FIELDS[table].has(k))) || (type==='delete' && Object.keys(values).length)
    || (type==='update' && !Object.keys(values).length) || (type==='create' && id !== undefined)
    || (type!=='create' && (typeof id!=='string' || !UUID.test(id)))) throw fail('WRITE_INVALID_COMMAND');
  lease.assertCurrent();
  if (persistence.name !== workspaceDatabaseName(lease)) throw fail('WRITE_SCOPE_MISMATCH');
  const initial = await persistence.read(); lease.assertCurrent();
  const cache = initial.cache;
  if (!cache || cache.clinic?.id !== lease.clinicId || !Array.isArray(cache[table])) throw fail('WRITE_CACHE_REQUIRED');
  if (initial.conflicts?.length) throw fail('WRITE_UNRESOLVED_CONFLICTS');
  const own = cache.staff?.filter(s=>s.user_id===lease.subject && s.active===true) ?? [];
  if (own.length!==1 || own[0].role!==lease.memberRole || cache.currentStaff?.id!==own[0].id) throw fail('WRITE_MEMBERSHIP_MISMATCH');
  const member = own[0];
  const at = Number(now());
  if (!Number.isFinite(at) || at<0) throw fail('INVALID_CLOCK');
  if (!licenceAllowsClinicalWrites(lease.licence) || !Number.isFinite(Date.parse(lease.licence?.expires_at))
    || Date.parse(lease.licence.expires_at)<=at || cache.subscriptionUnknown!==false
    || cache.subscription?.clinic_id!==lease.clinicId || !licenceAllowsClinicalWrites(cache.subscription)
    || !canWrite(licenseState(cache.subscription,new Date(at)))) throw fail('WRITE_LICENCE_BLOCKED');
  const capability = attendance ? 'appointment:token' : table==='patients' ? (type==='delete'?'patient:delete':'patient:write') : (type==='delete'?'appointment:delete':'appointment:write');
  if (!can(member.role,capability) || (table==='patients' && Object.hasOwn(values,'archived') && !can(member.role,'patient:archive'))) throw fail('WRITE_CAPABILITY_DENIED');
  const existing = type==='create' ? null : cache[table].find(row=>row.id===id);
  if (type!=='create' && (!existing || existing.clinic_id!==lease.clinicId)) throw fail('WRITE_ROW_UNAVAILABLE');
  if (type==='delete' && table==='patients' && ['appointments','consultations','invoices','reminders'].some(t=>cache[t]?.some(r=>r.patient_id===id))) throw fail('WRITE_SPECIALIZED_COMMAND_REQUIRED');
  let branchId;
  if (table==='appointments') {
    const allowed = visibleBranchIds(member.role,member.id,cache.staffBranches,cache.branches);
    if (!allowed.length || (member.role!=='owner' && allowed.length!==1)) throw fail('WRITE_BRANCH_DENIED');
    branchId = existing?.branch_id ?? cache.activeBranchId;
    if (!allowed.includes(branchId)) throw fail('WRITE_BRANCH_DENIED');
    if (!attendance && (existing?.token_no != null || (existing && existing.status!=='booked'))) throw fail('WRITE_SPECIALIZED_COMMAND_REQUIRED');
    if (existing && Object.hasOwn(values,'source')) throw fail('WRITE_SPECIALIZED_COMMAND_REQUIRED');
  }
  if(attendance){
    const date=new Date(at);
    if(!Number.isInteger(existing.token_no)||existing.token_no<1||existing.token_no>999
      || !['booked','checked-in','no-show'].includes(existing.status)
      || existing.scheduled_on!==localISO(date)
      || (action==='no-show'&&existing.status==='no-show')
      || (action==='arrive'&&existing.status==='checked-in'))throw fail('WRITE_ATTENDANCE_STATE_DENIED');
    const hhmm=`${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
    const minutes=date.getHours()*60+date.getMinutes();
    values=action==='no-show'?noShowPatch():arrivalPatch(existing,{at:hhmm,nowMinutes:minutes,forceLate:action==='arrive-late'});
    if(action!=='no-show' && (action==='arrive-late'||existing.status==='no-show'||isArrivedLate(existing)||isPastSlot(existing,minutes)) && !isArrivedLate(values))throw fail('WRITE_ATTENDANCE_NOTES_FULL');
  }
  function freshId() {
    const value=randomId();
    if (typeof value!=='string' || !UUID.test(value)) throw fail('WRITE_INVALID_ID');
    return value;
  }
  const rowId = type==='create' ? freshId() : id;
  const opId = freshId();
  if ((type==='create' && cache[table].some(row=>row.id===rowId)) || rowId===opId
    || initial.outbox.some(op=>op.op_id===opId)) throw fail('WRITE_ID_COLLISION');
  const stamp = new Date(at).toISOString();
  const base = existing ? structuredClone(existing) : null;
  if (base) delete base._offline;
  const patch = { ...values, updated_at: stamp, client_updated_at: stamp };
  let row = type==='create' ? { ...(table==='patients'?{archived:false}:{status:'booked',token_no:null,source:'walk-in',duration_minutes:15}),
    ...values, id:rowId, clinic_id:lease.clinicId, client_id:rowId, created_at:stamp, updated_at:stamp, client_updated_at:stamp,
    ...(branchId?{branch_id:branchId}:{}) } : type==='update' ? { ...existing, ...patch } : null;
  if (type!=='delete') {
    if (table==='patients') patientValid(row);
    else {
      if (['kind','reason','notes','scheduled_at','scheduled_on','patient_id','doctor_id'].some(k=>typeof row[k]!=='string' && row[k]!==undefined)
        || (row.reason?.length??0)>300 || (row.notes?.length??0)>1000 || Object.keys(validateAppointment(attendance?{...row,scheduled_at:String(row.scheduled_at).slice(0,5)}:row)).length || !(attendance?/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?$/:/^([01]\d|2[0-3]):[0-5]\d$/).test(row.scheduled_at)
        || !Number.isInteger(row.duration_minutes) || row.duration_minutes<5 || row.duration_minutes>240
        || !['walk-in','phone','online','referral'].includes(row.source)) throw fail('WRITE_INVALID_APPOINTMENT');
      const patient=cache.patients?.find(p=>p.id===row.patient_id && p.clinic_id===lease.clinicId && p.archived!==true);
      const doctor=cache.staff?.find(s=>s.id===row.doctor_id && s.clinic_id===lease.clinicId && s.active===true && ['owner','doctor'].includes(s.role));
      if (!patient || !doctor || (member.role==='doctor' && doctor.id!==member.id)
        || !cache.staffBranches?.some(a=>a.staff_id===doctor.id && a.branch_id===branchId && a.active===true && a.clinic_id===lease.clinicId)) throw fail('WRITE_REFERENCE_DENIED');
      if (cache.appointments.some(a=>a.id!==rowId && a.doctor_id===row.doctor_id && a.scheduled_on===row.scheduled_on && a.scheduled_at===row.scheduled_at && a.status!=='cancelled')) throw fail('WRITE_SLOT_CONFLICT');
    }
  }
  const next = { ...cache, [table]: type==='create' ? [{...row,_offline:true},...cache[table]]
    : type==='update' ? cache[table].map(r=>r.id===rowId?{...row,_offline:true}:r) : cache[table].filter(r=>r.id!==rowId) };
  const op = { op_id:opId, type, table, clinic_id:lease.clinicId, queued_at:stamp, attempts:0,
    ...(type==='create'?{row,client_id:rowId}:{id:rowId}), ...(type==='update'?{patch,base}:{}) };
  lease.assertCurrent();
  // No blind retry/coalescing: a CAS collision must be reread/revalidated, and
  // earlier operations remain in FIFO order with their original merge bases.
  try { await persistence.commit({expectedRevision:initial.revision,cache:next,outbox:[...initial.outbox,op]}); }
  catch(error){if(error?.code==='REVISION_CONFLICT')throw fail('WRITE_ACK_CONFLICT');throw error;}
  lease.assertCurrent();
  return Object.freeze({status:'QUEUED',opId,rowId}); // Not a server-saved result.
}
