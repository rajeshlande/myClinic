// Operator-only, bounded in-memory backup format prototype. No network or SQL.
// Input MUST already be a consistent, complete baseline/transaction journal.
import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
const MAX=4*1024*1024;
const fail=()=>{throw new Error('BACKUP_VALIDATION_FAILED');};
const plain=o=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&Object.getPrototypeOf(o)===Object.prototype;
const exact=(o,keys)=>plain(o)&&Object.keys(o).sort().join('|')===[...keys].sort().join('|');
const id=s=>typeof s==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(s);
const seq=n=>Number.isSafeInteger(n)&&n>=0;
const hash=b=>createHash('sha256').update(b).digest('hex');
const hex=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const keyOK=k=>Buffer.isBuffer(k)&&k.length===32;
function metadata(m){
  if(!exact(m,['format','batchId','project','schema','keyId','kind','previous','low','high','createdAt'])||m.format!==1||![m.batchId,m.project,m.keyId].every(id)||!Number.isSafeInteger(m.schema)||m.schema<1||!seq(m.low)||!seq(m.high)||m.high<m.low||!['baseline','increment'].includes(m.kind)||typeof m.createdAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(m.createdAt)||!Number.isFinite(Date.parse(m.createdAt)))fail();
  if(m.kind==='baseline'?(m.previous!==null||m.low!==m.high):(!hex(m.previous)||m.high===m.low))fail();
}
function jsonValue(v,depth=0){
  if(depth>64)fail();
  if(v===null||typeof v==='boolean'||typeof v==='string')return;
  if(typeof v==='number'){if(!Number.isFinite(v)||Math.abs(v)>Number.MAX_SAFE_INTEGER||Object.is(v,-0))fail();return;}
  if(Array.isArray(v)){for(let i=0;i<v.length;i++){if(!Object.hasOwn(v,i))fail();jsonValue(v[i],depth+1);}if(Object.keys(v).length!==v.length)fail();return;}
  if(!plain(v)||Object.getOwnPropertySymbols(v).length)fail();
  for(const descriptor of Object.values(Object.getOwnPropertyDescriptors(v))){if(!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))fail();jsonValue(descriptor.value,depth+1);}
}
function row(r){if(!plain(r)||!id(r.id))fail();jsonValue(r);}
function payload(m,p){
  if(m.kind==='baseline'){
    if(!exact(p,['tables'])||!plain(p.tables)||Object.keys(p.tables).length===0)fail();
    for(const [table,rows] of Object.entries(p.tables)){
      if(!id(table)||!Array.isArray(rows))fail();
      const ids=new Set();for(const r of rows){row(r);if(ids.has(r.id))fail();ids.add(r.id);}
    }
  }else{
    if(!exact(p,['transactions'])||!Array.isArray(p.transactions)||p.transactions.length===0)fail();
    let next=m.low+1;
    for(const tx of p.transactions){
      if(!exact(tx,['sequence','changes'])||tx.sequence!==next++||!Array.isArray(tx.changes)||!tx.changes.length)fail();
      for(const c of tx.changes){
        if(c.op==='upsert'){if(!exact(c,['op','table','id','row']))fail();row(c.row);if(c.id!==c.row.id)fail();}
        else if(c.op==='delete'){if(!exact(c,['op','table','id']))fail();}
        else fail();
        if(!id(c.table)||!id(c.id))fail();
      }
    }
    if(next-1!==m.high)fail();
  }
}
const bytes=m=>Buffer.from(JSON.stringify(m));
export function sealBatch({manifest,key,payload:data}){
  try{
    if(!keyOK(key))fail();metadata(manifest);payload(manifest,data);
    const raw=bytes(data);if(raw.length>MAX)fail();
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
    cipher.setAAD(bytes(manifest));
    const encrypted=Buffer.concat([cipher.update(gzipSync(raw)),cipher.final()]);
    const envelope={manifest,iv:iv.toString('base64'),ciphertext:encrypted.toString('base64'),tag:cipher.getAuthTag().toString('base64')};
    return {object:bytes(envelope),digest:hash(bytes(envelope))};
  }catch{fail();}
}
function decode(s,size){
  if(typeof s!=='string'||!s.length||s.length>MAX*2)fail();
  const b=Buffer.from(s,'base64');if(b.toString('base64')!==s||(size!==undefined&&b.length!==size))fail();return b;
}
export function openBatch({object,digest,key}){
  try{
    if(!keyOK(key)||!Buffer.isBuffer(object)||object.length>MAX*2||!hex(digest)||hash(object)!==digest)fail();
    const e=JSON.parse(object.toString('utf8'));
    if(!exact(e,['manifest','iv','ciphertext','tag']))fail();metadata(e.manifest);
    const d=createDecipheriv('aes-256-gcm',key,decode(e.iv,12));
    d.setAAD(bytes(e.manifest));d.setAuthTag(decode(e.tag,16));
    const zipped=Buffer.concat([d.update(decode(e.ciphertext)),d.final()]);
    const p=JSON.parse(gunzipSync(zipped,{maxOutputLength:MAX}).toString('utf8'));
    payload(e.manifest,p);return {manifest:e.manifest,payload:p};
  }catch{fail();}
}
export function restoreChain({batches,keys,project,schema,targetDigest}){
  // Caller must obtain targetDigest through a trusted inventory. A valid older
  // chain alone cannot detect a missing latest batch (rollback/truncation).
  try{
    if(!Array.isArray(batches)||!batches.length||!id(project)||!Number.isSafeInteger(schema)||!hex(targetDigest)||!(keys instanceof Map))fail();
    let previous=null,high=null,time=null;const seen=new Set(),tables=new Map();
    for(const entry of batches){
      // Read key ID only to look up an allowlisted key. Never trust until GCM verifies.
      if(!Buffer.isBuffer(entry.object)||entry.object.length>MAX*2)fail();
      const untrusted=JSON.parse(entry.object.toString('utf8'));
      const opened=openBatch({...entry,key:keys.get(untrusted?.manifest?.keyId)}),m=opened.manifest,p=opened.payload;
      if(m.project!==project||m.schema!==schema||seen.has(m.batchId)||(time!==null&&Date.parse(m.createdAt)<time))fail();seen.add(m.batchId);time=Date.parse(m.createdAt);
      if(previous===null){
        if(m.kind!=='baseline')fail();
        for(const [table,rows] of Object.entries(p.tables))tables.set(table,new Map(rows.map(r=>[r.id,r])));
      }else{
        if(m.kind!=='increment'||m.previous!==previous||m.low!==high)fail();
        for(const tx of p.transactions)for(const c of tx.changes){
          const t=tables.get(c.table);if(!t)fail();
          if(c.op==='delete')t.delete(c.id);else t.set(c.id,c.row);
        }
      }
      previous=entry.digest;high=m.high;
    }
    if(previous!==targetDigest)fail();
    return {project,schema,watermark:high,digest:previous,tables:Object.fromEntries([...tables].map(([t,rows])=>[t,[...rows.values()]]))};
  }catch{fail();}
}
export function planRetention({chains,now,days=30}){
  // Inventory-only planning. Never deletes objects; retains complete dependencies.
  try{
    if(!Array.isArray(chains)||!Number.isFinite(now)||!Number.isInteger(days)||days<1||days>365)fail();
    const keep=new Set(),all=new Set(),cutoff=now-days*86400000;
    for(const chain of chains){
      if(!exact(chain,['restorePoint','digests'])||!Number.isFinite(chain.restorePoint)||chain.restorePoint>now||!Array.isArray(chain.digests)||!chain.digests.length||!chain.digests.every(hex)||new Set(chain.digests).size!==chain.digests.length)fail();
      for(const d of chain.digests){all.add(d);if(chain.restorePoint>=cutoff)keep.add(d);}
    }
    if(!keep.size)fail(); // Never recommend deleting every known recovery point.
    return {keep:[...keep].sort(),candidates:[...all].filter(d=>!keep.has(d)).sort(),note:'Untrusted inventory plan only. Validate chains, object-lock and legal retention before any deletion.'};
  }catch{fail();}
}
