/** Staged standalone DOM review panel. Never mounted by the live app.
 * All clinical strings use textContent; no HTML rendering or PHI logging.
 */
import { createWorkspaceOperations } from './workspace-operations.mjs';
import { createWorkspaceConflictReview } from './workspace-conflicts.mjs';
import { readWorkspaceConflictComparison } from './workspace-conflict-comparison.mjs';
export function mountWorkspaceConflictPanel({root,controller,lifecycle,locks}={}){
  if(!root?.ownerDocument||typeof controller?.subscribe!=='function'||typeof lifecycle?.open!=='function')throw new TypeError('review panel dependencies required');
  const doc=root.ownerDocument,operations=createWorkspaceOperations(controller);
  let generation=0,closed=false,review=null,store=null,confirmation=null,busy=false;
  const removers=[];
  function listen(element,event,fn){element.addEventListener(event,fn);removers.push(()=>element.removeEventListener(event,fn));}
  function replace(...children){for(const remove of removers.splice(0))remove();root.replaceChildren(...children);}
  function node(tag,text){const e=doc.createElement(tag);if(text!==undefined)e.textContent=text;return e;}
  function clearReview(){review?.dispose();review=null;store?.close();store=null;confirmation=null;}
  function reset(message){clearReview();replace();const heading=node('h2','Local conflict review');const status=node('p',message);status.setAttribute('role','status');const inspect=node('button','Fetch fresh comparison');inspect.type='button';inspect.disabled=closed||busy;listen(inspect,'click',inspectNow);root.append(heading,status,inspect);}
  function current(op,lease){if(closed||op!==generation)throw Error('review superseded');lease?.assertCurrent();}
  async function inspectNow(){
    if(closed||busy)return;busy=true;const op=++generation;reset('Fetching scoped local sources and fresh server values…');
    let ownedStore=null,ownedReview=null;
    try{
      const lease=operations.lease();ownedStore=await lifecycle.open(lease);current(op,lease);
      ownedReview=createWorkspaceConflictReview({lease,persistence:ownedStore,locks});
      const inspected=await ownedReview.inspect();current(op,lease);
      const comparison=await readWorkspaceConflictComparison({lease,conflicts:inspected.conflicts});current(op,lease);
      const checked=await ownedStore.read();current(op,lease);
      if(checked.revision!==inspected.expectedRevision)throw Error('review changed');
      store=ownedStore;review=ownedReview;ownedStore=null;ownedReview=null;confirmation=inspected;
      replace(node('h2','Review ALL local conflicted changes'),node('p',inspected.warning),node('p',comparison.warning));
      const pre=node('pre',JSON.stringify(comparison,null,2));pre.setAttribute('aria-label','Local sources and fresh server comparison');root.append(pre);
      const label=node('label');const checkbox=node('input');checkbox.type='checkbox';checkbox.setAttribute('aria-label','I reviewed all conflicts and accept losing these local changes');label.append(checkbox,doc.createTextNode(' I reviewed ALL conflicts and accept losing these local changes. This does not undo server changes.'));
      const discard=node('button','Discard reviewed local changes');discard.type='button';discard.disabled=true;
      listen(checkbox,'change',()=>{discard.disabled=!checkbox.checked||busy;});
      listen(discard,'click',async()=>{
        if(closed||busy||!checkbox.checked||!confirmation)return;
        busy=true;discard.disabled=true;checkbox.disabled=true;const selected=confirmation;confirmation=null;
        try{current(op,lease);await review.discardLocal({...selected,confirmDiscardLocal:true});current(op,lease);busy=false;reset('Reviewed local conflicts discarded. Reload the workspace through its guarded loader; server values have not been modified.');}
        catch{if(!closed&&op===generation){busy=false;reset('Resolution not confirmed. Durable state may have changed; fetch a new comparison before deciding again.');}}
      });
      const cancel=node('button','Cancel without discarding');cancel.type='button';listen(cancel,'click',()=>{if(busy||closed)return;generation++;reset('Review cancelled. No resolution requested.');});
      root.append(label,discard,cancel);busy=false;
    }catch{if(!closed&&op===generation){busy=false;reset('Review unavailable or changed. No resolution was requested. Fetch again under a current owner session.');}}
    finally{ownedReview?.dispose();ownedStore?.close();}
  }
  const unsubscribe=controller.subscribe(()=>{generation++;busy=false;reset('Workspace session changed. Fetch a new comparison under current authorization.');});
  reset('Owner review only. Nothing is discarded until you review and explicitly confirm.');
  return Object.freeze({dispose(){if(closed)return;closed=true;generation++;busy=false;unsubscribe();clearReview();replace();}});
}
