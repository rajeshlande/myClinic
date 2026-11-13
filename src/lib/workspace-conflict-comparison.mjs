/** Fresh, SELECT-only conflict comparison. Not a transaction or write authority. */
import { TABLES, supportsColumn } from './offline.js';
import { WorkspaceStorageError } from './workspace-persistence.mjs';
const fail=code=>new WorkspaceStorageError(code);
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}
export async function readWorkspaceConflictComparison({lease,conflicts,now=Date.now}={}){
  if(typeof lease?.assertCurrent!=='function'||typeof lease?.run!=='function')throw fail('COMPARISON_UNAVAILABLE');
  lease.assertCurrent();if(lease.memberRole!=='owner')throw fail('COMPARISON_OWNER_REQUIRED');
  if(!Array.isArray(conflicts)||!conflicts.length||conflicts.length>50)throw fail('COMPARISON_BATCH_LIMIT');
  const entries=structuredClone(conflicts),seen=new Set();
  for(const c of entries){const op=c?.sourceOp;
    if(!c?.id||seen.has(c.id)||!TABLES.includes(c.table)||c.clinic_id!==lease.clinicId||op?.clinic_id!==lease.clinicId||op.table!==c.table||op.op_id!==c.opId
      ||!['create','update','delete'].includes(op.type))throw fail('COMPARISON_INVALID_SOURCE');
    seen.add(c.id);
    const rowId=op.type==='create'?op.row?.id:op.id;
    if(typeof rowId!=='string'||!rowId||(op.type==='create'&&op.row?.clinic_id!==lease.clinicId))throw fail('COMPARISON_INVALID_SOURCE');
  }
  async function select(table,key,value){
    if(typeof value!=='string'||!value)throw fail('COMPARISON_INVALID_SOURCE');
    const response=await lease.run(client=>client.from(table).select('*').eq('clinic_id',lease.clinicId).eq(key,value).maybeSingle());
    lease.assertCurrent();if(response?.error||!response||!Object.hasOwn(response,'data'))throw fail('COMPARISON_READ_FAILED');
    const row=response.data;
    if(row!==null&&(!row||Array.isArray(row)||row.clinic_id!==lease.clinicId||row[key]!==value))throw fail('COMPARISON_SCOPE_MISMATCH');
    return row===null?null:structuredClone(row);
  }
  const comparisons=[];
  for(const c of entries){const op=c.sourceOp;
    const byId=await select(c.table,'id',op.type==='create'?op.row.id:op.id);
    const clientId=op.type==='create'?(op.client_id??op.row.client_id):null;
    const byClientId=clientId&&supportsColumn(c.table,'client_id')?await select(c.table,'client_id',clientId):null;
    comparisons.push({conflictId:c.id,table:c.table,sourceOp:op,capturedRemote:c.remote??null,byId,byClientId});
  }
  lease.assertCurrent();const at=Number(now());if(!Number.isFinite(at)||at<0)throw fail('INVALID_CLOCK');
  return freeze({observedAt:at,comparisons,warning:'Separate reads, not a transactional snapshot. A null result means no visible row returned, not proof of deletion. Server values may change after this comparison.'});
}
