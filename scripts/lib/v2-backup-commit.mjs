// Operator-only storage protocol. Adapter must provide durable, strongly
// consistent immutable writes and linearizable compare-and-swap. No live adapter.
import {createHash} from 'node:crypto';
import {openBatch} from './v2-backup-core.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(v);
const fail=()=>{throw Error('BACKUP_COMMIT_FAILED');};
const exact=(o,ks)=>o&&Object.getPrototypeOf(o)===Object.prototype&&Object.keys(o).sort().join('|')===[...ks].sort().join('|');
function checkHead(h,project,schema){
  if(!exact(h,['project','schema','revision','digest','watermark','batchId','createdAt'])||h.project!==project||h.schema!==schema||!Number.isSafeInteger(h.revision)||h.revision<1||!hex(h.digest)||!Number.isSafeInteger(h.watermark)||h.watermark<0||!id(h.batchId)||typeof h.createdAt!=='string'||!Number.isFinite(Date.parse(h.createdAt)))fail();
}
const same=(a,b)=>a===null||b===null?a===b:['project','schema','revision','digest','watermark','batchId','createdAt'].every(k=>a[k]===b[k]);
export async function commitBackup({entry,key,store,project,schema,expectedHead=null}){
  // expectedHead must be the previously authenticated committed checkpoint.
  // No source ACK callback: this checkpoint is the sole cursor in this protocol.
  try{
    if(!id(project)||!Number.isSafeInteger(schema)||schema<1||!store||!['getObject','putObjectIfAbsent','readHead','compareAndSwapHead'].every(k=>typeof store[k]==='function'))fail();
    const snapshot={object:Buffer.from(entry.object),digest:entry.digest};
    const {manifest:m}=openBatch({...snapshot,key});
    if(m.project!==project||m.schema!==schema)fail();
    if(expectedHead!==null){checkHead(expectedHead,project,schema);expectedHead={...expectedHead};}
    if(expectedHead===null){if(m.kind!=='baseline')fail();}
    else if(m.kind!=='increment'||m.previous!==expectedHead.digest||m.low!==expectedHead.watermark||Date.parse(m.createdAt)<Date.parse(expectedHead.createdAt)||m.batchId===expectedHead.batchId)fail();
    const next={project,schema,revision:(expectedHead?.revision??0)+1,digest:snapshot.digest,watermark:m.high,batchId:m.batchId,createdAt:m.createdAt};
    const scope=`v2/${project}/schema-${schema}`,path=`${scope}/objects/${snapshot.digest}`;
    const readHead=async()=>{const h=await store.readHead(scope);if(h!==null)checkHead(h,project,schema);return h;};
    const verify=async()=>{const stored=await store.getObject(path);if(!Buffer.isBuffer(stored)||stored.length!==snapshot.object.length||hash(stored)!==snapshot.digest||!stored.equals(snapshot.object))fail();};
    const current=await readHead();
    if(same(current,next)){await verify();return {status:'ALREADY_COMMITTED',head:next};}
    if(!same(current,expectedHead))return {status:'CONFLICT',head:current};
    // Write-once operation may report either newly created or existing object.
    // It must NEVER overwrite a different object. Read-back is always required.
    await store.putObjectIfAbsent(path,snapshot.object);
    await verify();
    const exchanged=await store.compareAndSwapHead(scope,expectedHead,next);
    if(typeof exchanged!=='boolean')fail();
    const observed=await readHead();
    if(same(observed,next))return {status:exchanged?'COMMITTED':'ALREADY_COMMITTED',head:next};
    if(exchanged)fail(); // ACK/read inconsistency must not look successful.
    return {status:'CONFLICT',head:observed};
  }catch{fail();}
}
export async function loadCommittedChain({store,project,schema,keys,expectedHead,maxBatches=128,maxBytes=32*1024*1024}){
  // Trusted caller supplies exact checkpoint; object listing is not authority.
  try{
    if(!id(project)||!Number.isSafeInteger(schema)||schema<1)fail();
    checkHead(expectedHead,project,schema);
    expectedHead={...expectedHead};
    if(!(keys instanceof Map)||!Number.isInteger(maxBatches)||maxBatches<1||maxBatches>10000||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>256*1024*1024)fail();
    const batches=[],seen=new Set();let digest=expectedHead.digest,total=0;
    while(digest!==null){
      if(!hex(digest)||seen.has(digest)||batches.length>=maxBatches)fail();seen.add(digest);
      const object=await store.getObject(`v2/${project}/schema-${schema}/objects/${digest}`);
      if(!Buffer.isBuffer(object)||object.length>8*1024*1024||(total+=object.length)>maxBytes)fail();
      const untrusted=JSON.parse(object.toString('utf8'));
      const {manifest:m}=openBatch({object,digest,key:keys.get(untrusted?.manifest?.keyId)});
      if(m.project!==project||m.schema!==schema)fail();
      if(!batches.length&&(m.high!==expectedHead.watermark||m.batchId!==expectedHead.batchId||m.createdAt!==expectedHead.createdAt))fail();
      batches.push({object:Buffer.from(object),digest});digest=m.previous;
    }
    return batches.reverse(); // Caller must run restoreChain for full ordering validation.
  }catch{fail();}
}
