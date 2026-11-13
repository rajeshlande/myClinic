#!/usr/bin/env node
// Synthetic-only, in-memory drill. No DB, file IO, environment keys or network.
import {randomBytes} from 'node:crypto';
import {sealBatch,restoreChain,planRetention} from './lib/v2-backup-core.mjs';
if(process.argv.length>2){console.error('Synthetic drill accepts no arguments or real input.');process.exitCode=2;}
else{
  try{
    const key=randomBytes(32),keys=new Map([['ephemeral',key]]);
    const manifest={format:1,batchId:'fixture-baseline',project:'synthetic-only',schema:22,keyId:'ephemeral',kind:'baseline',previous:null,low:0,high:0,createdAt:'2026-01-01T00:00:00.000Z'};
    const baseline=sealBatch({manifest,key,payload:{tables:{patients:[{id:'fixture-patient'}],appointments:[]}}});
    const increment=sealBatch({manifest:{...manifest,batchId:'fixture-increment',kind:'increment',previous:baseline.digest,low:0,high:1,createdAt:'2026-01-02T00:00:00.000Z'},key,payload:{transactions:[{sequence:1,changes:[{op:'delete',table:'patients',id:'fixture-patient'},{op:'upsert',table:'patients',id:'fixture-replacement',row:{id:'fixture-replacement'}},{op:'upsert',table:'appointments',id:'fixture-visit',row:{id:'fixture-visit',patient_id:'fixture-replacement'}}]}]}});
    const options={keys,project:'synthetic-only',schema:22,targetDigest:increment.digest};
    const restored=restoreChain({...options,batches:[baseline,increment]});
    if(restored.watermark!==1||restored.tables.patients.length!==1||restored.tables.appointments[0].patient_id!==restored.tables.patients[0].id)throw Error();
    let rejected=0;
    for(const batches of [[increment],[baseline],[baseline,increment,increment]]){
      try{restoreChain({...options,batches});}catch{rejected++;}
    }
    const damaged={...increment,object:Buffer.from(increment.object)};damaged.object[damaged.object.length-1]^=1;
    try{restoreChain({...options,batches:[baseline,damaged]});}catch{rejected++;}
    const now=Date.parse('2026-02-01T00:00:00.000Z');
    const plan=planRetention({now,chains:[{restorePoint:now,digests:[baseline.digest,increment.digest]}]});
    if(rejected!==4||plan.keep.length!==2||plan.candidates.length!==0)throw Error();
    console.log(JSON.stringify({mode:'SYNTHETIC_IN_MEMORY_ONLY',ok:true,restoredWatermark:1,restoredTableCounts:{patients:1,appointments:1},negativeChecksPassed:rejected,retainedDependencyObjects:plan.keep.length,networkRequests:0,note:'Ephemeral key discarded on exit. Not a hosted restore, PHI export, RPO or durable storage test.'},null,2));
  }catch{console.error('SYNTHETIC_DRILL_FAILED');process.exitCode=1;}
}
