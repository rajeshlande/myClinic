#!/usr/bin/env node
// Fixed synthetic data only. Uses a private temporary Linux directory and removes it.
import {mkdtemp,rm,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {createLocalBackupStore} from './lib/v2-backup-local-store.mjs';
import {sealBatch,restoreChain} from './lib/v2-backup-core.mjs';
import {commitBackup,loadCommittedChain} from './lib/v2-backup-commit.mjs';
let root;
if(process.argv.length>2||process.platform!=='linux'){console.error('Synthetic disk drill requires Linux and accepts no arguments.');process.exitCode=2;}
else{
  try{
    root=await mkdtemp(join(tmpdir(),'v2-synthetic-disk-'));await chmod(root,0o700);
    const key=randomBytes(32),keys=new Map([['ephemeral',key]]),project='synthetic-only',schema=22;
    const manifest={format:1,batchId:'baseline',project,schema,keyId:'ephemeral',kind:'baseline',previous:null,low:0,high:0,createdAt:'2026-01-01T00:00:00.000Z'};
    const baseline=sealBatch({manifest,key,payload:{tables:{patients:[{id:'fixture-patient'}]}}});
    let store=await createLocalBackupStore({root});
    const first=await commitBackup({store,entry:baseline,key,project,schema});
    const increment=sealBatch({manifest:{...manifest,batchId:'increment',kind:'increment',previous:baseline.digest,low:0,high:1},key,payload:{transactions:[{sequence:1,changes:[{op:'delete',table:'patients',id:'fixture-patient'}]}]}});
    const second=await commitBackup({store,entry:increment,key,project,schema,expectedHead:first.head});
    store=await createLocalBackupStore({root});
    const head=await store.readHead(`v2/${project}/schema-${schema}`);
    const batches=await loadCommittedChain({store,project,schema,keys,expectedHead:head});
    const restored=restoreChain({batches,keys,project,schema,targetDigest:head.digest});
    if(first.status!=='COMMITTED'||second.status!=='COMMITTED'||restored.watermark!==1||restored.tables.patients.length!==0)throw Error();
    const retry=await commitBackup({store,entry:increment,key,project,schema,expectedHead:first.head});
    if(retry.status!=='ALREADY_COMMITTED')throw Error();
    await rm(root,{recursive:true,force:true});root=undefined;
    console.log(JSON.stringify({mode:'SYNTHETIC_LOCAL_DISK_ONLY',ok:true,committedBatches:2,restoredWatermark:1,retryStatus:retry.status,temporaryDirectoryRemoved:true,networkRequests:0,note:'Not offsite storage, power-loss proof, real DB restore or RPO evidence.'},null,2));
  }catch{console.error('SYNTHETIC_DISK_DRILL_FAILED');process.exitCode=1;}
  finally{if(root)try{await rm(root,{recursive:true,force:true});}catch{console.error('SYNTHETIC_TEMP_CLEANUP_FAILED');process.exitCode=1;}}
}
