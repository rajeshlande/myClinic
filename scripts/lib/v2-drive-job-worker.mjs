// Server-only single-job orchestration. No scheduler/source exporter supplied.
// Use only a reviewed authoritative repository in production (not fixture owners).
export function createDriveJobWorker({jobs,ensureFolder,getArchive,prepareBatch,backupKeys}){
  if(!['claim','readWork','stage','complete'].every(k=>typeof jobs?.[k]==='function')||![ensureFolder,getArchive,prepareBatch].every(f=>typeof f==='function')||!(backupKeys instanceof Map))throw Error('DRIVE_WORKER_CONFIGURATION_REQUIRED');
  const keyFor=entry=>{
    if(!Buffer.isBuffer(entry?.object)||entry.object.length>8*1024*1024)throw Error();
    const key=backupKeys.get(JSON.parse(entry.object.toString('utf8'))?.manifest?.keyId);
    if(!Buffer.isBuffer(key)||key.length!==32)throw Error();return key;
  };
  return async function runJob(jobId){
    try{
      let work=await jobs.claim({jobId,leaseMs:300000});if(!work)return {jobId,status:'NOT_CLAIMED'};
      const folder=await ensureFolder();
      work=await jobs.readWork({jobId,leaseToken:work.leaseToken});
      if(folder?.verified!==true||folder.clinicId!==work.clinicId||folder.userId!==work.userId||folder.revision!==work.revision||folder.fileId!==work.folderId||folder.bindingId!==work.bindingId)throw Error();
      const archive=await getArchive({work,folder});
      if(typeof archive?.reserveFileId!=='function'||typeof archive?.uploadEncrypted!=='function')throw Error();
      if(!work.entry){
        // Trusted backend adapter must provide consistent complete source window.
        // No plaintext or key is persisted by this worker; encrypted bytes only.
        const entry=await prepareBatch(work),fileId=await archive.reserveFileId();
        work=await jobs.stage({jobId,leaseToken:work.leaseToken,entry,key:keyFor(entry),fileId});
      }
      work=await jobs.readWork({jobId,leaseToken:work.leaseToken});
      const receipt=await archive.uploadEncrypted({entry:work.entry,key:keyFor(work.entry),fileId:work.fileId});
      return await jobs.complete({jobId,leaseToken:work.leaseToken,receipt});
    }catch{throw Error('DRIVE_JOB_WORKER_FAILED');}
  };
}
