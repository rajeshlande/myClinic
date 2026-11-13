/** Staged explicit local-conflict review. No remote writes, force overwrite,
 * automatic dismissal or claim that a stored remote row is current server truth.
 */
import { workspaceDatabaseName, WorkspaceStorageError } from './workspace-persistence.mjs';
const fail=code=>new WorkspaceStorageError(code);
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}
export function createWorkspaceConflictReview({lease,persistence,locks,now=Date.now,randomId=()=>globalThis.crypto.randomUUID()}={}){
  if(typeof lease?.assertCurrent!=='function'||typeof persistence?.read!=='function'||typeof persistence?.commit!=='function'||typeof locks?.request!=='function')throw fail('REVIEW_UNAVAILABLE');
  let review=null,closed=false,sequence=0;
  function current(){if(closed)throw fail('REVIEW_CLOSED');lease.assertCurrent();if(lease.memberRole!=='owner')throw fail('REVIEW_OWNER_REQUIRED');if(persistence.name!==workspaceDatabaseName(lease))throw fail('REVIEW_SCOPE_MISMATCH');}
  function clock(){const at=Number(now());if(!Number.isFinite(at)||at<0)throw fail('INVALID_CLOCK');return at;}
  return Object.freeze({
    async inspect(){
      current();review=null;const op=++sequence;
      const initial=await persistence.read();current();if(op!==sequence)throw fail('REVIEW_SUPERSEDED');
      if(initial.outbox.length)throw fail('REVIEW_QUEUED_WORK');
      if(!initial.conflicts?.length)throw fail('REVIEW_NO_CONFLICTS');
      // Whole-batch review avoids silently dropping a source while retaining a
      // dependent conflict. Pending normal queue work must be reconciled first.
      const conflicts=structuredClone(initial.conflicts);
      for(const entry of conflicts)if(entry.clinic_id!==lease.clinicId||entry.sourceOp?.clinic_id!==lease.clinicId)throw fail('REVIEW_SCOPE_MISMATCH');
      const at=clock();const id=randomId();if(typeof id!=='string'||!id)throw fail('REVIEW_INVALID_ID');
      review={id,revision:initial.revision,at};
      return freeze({reviewId:id,expectedRevision:initial.revision,expiresAt:at+300000,conflicts,
        warning:'Discarding removes ALL reviewed local conflict sources. It does not undo server writes or confirm current server values.'});
    },
    async discardLocal({reviewId,expectedRevision,confirmDiscardLocal}={}){
      current();
      const selected=review;review=null;sequence++; // Every attempted confirmation is one-use.
      if(!selected||reviewId!==selected.id||expectedRevision!==selected.revision||confirmDiscardLocal!==true)throw fail('REVIEW_CONFIRMATION_REQUIRED');
      const at=clock();if(at<selected.at||at>=selected.at+300000)throw fail('REVIEW_EXPIRED');
      return locks.request(`myclinic-v2-replay-${persistence.name}`,{mode:'exclusive',ifAvailable:true},async lock=>{
        if(!lock)throw fail('REVIEW_BUSY');current();
        const initial=await persistence.read();current();
        const commitAt=clock();if(commitAt<selected.at||commitAt>=selected.at+300000)throw fail('REVIEW_EXPIRED');
        if(initial.revision!==selected.revision)throw fail('REVIEW_CHANGED');
        if(initial.outbox.length)throw fail('REVIEW_QUEUED_WORK');
        if(!initial.conflicts?.length)throw fail('REVIEW_NO_CONFLICTS');
        try{await persistence.commit({expectedRevision:selected.revision,cache:null,outbox:[],conflicts:[]});}
        catch(error){if(error?.code==='REVISION_CONFLICT')throw fail('REVIEW_CHANGED');throw error;}
        current();return freeze({status:'LOCAL_CONFLICTS_DISCARDED',discardedCount:initial.conflicts.length,reloadRequired:true});
      });
    },
    dispose(){closed=true;review=null;sequence++;},
  });
}
