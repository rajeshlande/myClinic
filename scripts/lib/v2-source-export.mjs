// Backend-only source-window validator/encoder. No live DB client or fallback.
// readWindow MUST use one consistent source snapshot + complete commit journal.
import {createHash} from 'node:crypto';
import {sealBatch} from './v2-backup-core.mjs';
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(v);
const plain=v=>v&&Object.getPrototypeOf(v)===Object.prototype;
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const exact=(v,fields)=>plain(v)&&Object.keys(v).sort().join('|')===[...fields].sort().join('|');
const fail=()=>{throw Error('SOURCE_EXPORT_REFUSED');};
function identity(table,clinicId,row){
  if(!plain(row)||row[table.scopeColumn]!==clinicId)fail();
  const key={};
  for(const column of table.keyColumns){const v=row[column];if(!['string','boolean','number'].includes(typeof v)||(typeof v==='number'&&(!Number.isFinite(v)||Math.abs(v)>Number.MAX_SAFE_INTEGER||Object.is(v,-0)))||typeof v==='string'&&v.length>1024)fail();key[column]=v;}
  const hash=createHash('sha256').update(JSON.stringify(['clinic-backup-row-v1',table.name,clinicId,Object.entries(key)])).digest('hex');
  return {id:hash,key};
}
export function createSourceExportPreparer({source,tables,readWindow,limits={}}){
  if(!exact(source,['project','clinicId','schema','streamId'])||!id(source.project)||!id(source.clinicId)||!id(source.streamId)||!Number.isSafeInteger(source.schema)||source.schema<1||typeof readWindow!=='function'||!Array.isArray(tables)||!tables.length)throw Error('SOURCE_EXPORT_CONFIGURATION_REQUIRED');
  const inventory=new Map();
  for(const t of tables){if(!t||!id(t.name)||inventory.has(t.name)||!id(t.scopeColumn)||!Array.isArray(t.keyColumns)||!t.keyColumns.length||t.keyColumns.some(k=>!id(k))||new Set(t.keyColumns).size!==t.keyColumns.length)throw Error('SOURCE_EXPORT_CONFIGURATION_REQUIRED');inventory.set(t.name,{name:t.name,scopeColumn:t.scopeColumn,keyColumns:[...t.keyColumns].sort()});}
  const config={...source},maxRows=limits.maxRows??5000,maxTransactions=limits.maxTransactions??1000,maxChanges=limits.maxChanges??10000;
  if(![maxRows,maxTransactions,maxChanges].every(v=>Number.isSafeInteger(v)&&v>=1&&v<=100000))throw Error('SOURCE_EXPORT_CONFIGURATION_REQUIRED');
  return async function prepare({previousDigest=null,low=null,key,keyId,batchId,createdAt}){
    try{
      const baseline=previousDigest===null&&low===null;
      if(!baseline&&(!(typeof previousDigest==='string'&&/^[a-f0-9]{64}$/.test(previousDigest))||!integer(low)))fail();
      const raw=await readWindow({source:{...config},mode:baseline?'baseline':'increment',low,maxRows,maxTransactions,maxChanges});
      if(!raw||!exact(raw.source,['project','clinicId','schema','streamId'])||Object.keys(config).some(k=>raw.source[k]!==config[k])||!integer(raw.high)||!integer(raw.retainedFrom)||raw.retainedFrom<1||raw.retainedFrom>raw.high+1||!id(raw.snapshotId)||raw.complete!==true)fail();
      let payload;
      if(baseline){
        if(!exact(raw,['source','snapshotId','complete','high','retainedFrom','tables'])||!exact(raw.tables,[...inventory.keys()]))fail();
        let count=0;const encoded=[];
        for(const [name,t] of inventory){const rows=raw.tables[name];if(!Array.isArray(rows)||(count+=rows.length)>maxRows)fail();encoded.push([name,rows.map(row=>({...identity(t,config.clinicId,row),data:row}))]);}
        payload={tables:Object.fromEntries(encoded)};
      }else{
        if(!exact(raw,['source','snapshotId','complete','high','retainedFrom','transactions'])||!Array.isArray(raw.transactions)||raw.transactions.length>maxTransactions||raw.high<low||low<raw.retainedFrom-1)fail();
        if(raw.high===low){if(raw.transactions.length!==0)fail();return {status:'NO_CHANGES',watermark:low};}
        if(!raw.transactions.length)fail();let next=low+1,count=0;
        const transactions=raw.transactions.map(tx=>{
          if(!exact(tx,['sequence','changes'])||tx.sequence!==next++||!Array.isArray(tx.changes)||!tx.changes.length||(count+=tx.changes.length)>maxChanges)fail();
          const changes=tx.changes.map(c=>{
            const t=inventory.get(c.table);if(!t)fail();
            if(c.op==='upsert'&&exact(c,['op','table','row'])){const k=identity(t,config.clinicId,c.row);return {op:'upsert',table:t.name,id:k.id,row:{...k,data:c.row}};}
            if(c.op==='delete'&&exact(c,['op','table','key'])){
              if(!exact(c.key,[...new Set([...t.keyColumns,t.scopeColumn])]))fail();
              return {op:'delete',table:t.name,id:identity(t,config.clinicId,c.key).id};
            }
            fail();
          });return {sequence:tx.sequence,changes};
        });if(next-1!==raw.high)fail();payload={transactions};
      }
      const manifest={format:1,batchId,project:config.project,schema:config.schema,keyId,kind:baseline?'baseline':'increment',previous:baseline?null:previousDigest,low:baseline?raw.high:low,high:raw.high,createdAt};
      const entry=sealBatch({manifest,key,payload});
      return {status:'READY',entry,watermark:raw.high}; // No plaintext rows returned.
    }catch{fail();}
  };
}
