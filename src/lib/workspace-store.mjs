/** Inert external-store facade. No React, legacy imports, automatic load/flush or
 * cache fallback. A READY view is an acknowledged observation, not live server truth.
 */
import { createWorkspaceOperations } from './workspace-operations.mjs';
import { createWorkspaceStoreLoader } from './workspace-loader.mjs';
import { commitWorkspaceCommand } from './workspace-writes.mjs';
import { workspaceDatabaseName, WorkspaceStorageError } from './workspace-persistence.mjs';
const fail=code=>new WorkspaceStorageError(code);
function freeze(value){if(value && typeof value==='object' && !Object.isFrozen(value)){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}
export function createWorkspaceStore({controller,lifecycle}={}) {
  const operations=createWorkspaceOperations(controller);
  const loader=createWorkspaceStoreLoader({controller,lifecycle});
  const listeners=new Set();let generation=0;let busy=false;let disposed=false;
  let view=freeze({state:'IDLE',data:null,errorCode:'',pendingCount:0});
  function publish(state,data=null,errorCode='',pendingCount=0){
    view=freeze({state,data,errorCode,pendingCount});
    for(const fn of listeners){try{fn();}catch{/* observer only */}}
  }
  const unsubscribe=controller.subscribe(()=>{generation++;busy=false;publish('IDLE');});
  function begin(state){
    if(disposed)throw fail('STORE_CLOSED');
    if(busy)throw fail('STORE_BUSY');
    const op=++generation;busy=true;publish(state);return op;
  }
  function current(op,lease){if(disposed||op!==generation)throw fail('STORE_SUPERSEDED');lease?.assertCurrent();}
  function errorView(op,error){if(!disposed&&op===generation)publish('ERROR',null,
    ['WRITE_ACK_CONFLICT','LOAD_ACK_CONFLICT','LOAD_UNRESOLVED_WORK','WRITE_UNRESOLVED_CONFLICTS','WRITE_LICENCE_BLOCKED'].includes(error?.code)?error.code:'STORE_ACTION_FAILED');}
  return Object.freeze({
    getSnapshot:()=>view,
    subscribe(fn){if(disposed)throw fail('STORE_CLOSED');if(typeof fn!=='function')throw new TypeError('listener required');listeners.add(fn);return()=>listeners.delete(fn);},
    async load(){
      const op=begin('LOADING');
      try{
        current(op);const result=await loader.load();current(op);
        publish('READY',result.data);current(op);return view;
      }catch(error){errorView(op,error);throw error;}
      finally{if(op===generation)busy=false;}
    },
    async command(command){
      if(disposed)throw fail('STORE_CLOSED');
      if(busy)throw fail('STORE_BUSY');
      if(view.state!=='READY'||!view.data)throw fail('STORE_NOT_READY');
      // Clone before waiting for lifecycle.open; callers cannot mutate the intent.
      let intent;try{intent=structuredClone(command);}catch{throw fail('WRITE_INVALID_COMMAND');}
      const op=begin('WRITING');let store;
      try{
        current(op);const lease=operations.lease();
        store=await lifecycle.open(lease);current(op,lease);
        if(store.name!==workspaceDatabaseName(lease))throw fail('STORE_SCOPE_MISMATCH');
        const receipt=await commitWorkspaceCommand({lease,persistence:store,command:intent});current(op,lease);
        const saved=await store.read();current(op,lease);
        // A racing replay may ACK this operation or invalidate its optimistic
        // cache before readback. Do not reconstruct or publish an obsolete view.
        if(!saved.cache||saved.cache.clinic?.id!==lease.clinicId||saved.conflicts?.length
          ||!saved.outbox.some(o=>o.op_id===receipt.opId))throw fail('STORE_RECONCILIATION_REQUIRED');
        const data=structuredClone(saved.cache);
        current(op,lease);publish('READY',data,'',saved.outbox.length);current(op,lease);
        return receipt;
      }catch(error){errorView(op,error);throw error;}
      finally{store?.close();if(op===generation)busy=false;}
    },
    dispose(){if(disposed)return;disposed=true;generation++;busy=false;unsubscribe();loader.dispose();publish('DISPOSED');listeners.clear();},
  });
}
