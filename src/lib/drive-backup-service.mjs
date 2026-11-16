// Staged v2 same-origin service client. Never stores session or Google tokens.
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(v);
const phases=['QUEUED','RUNNING','STAGED','COMPLETED','CANCELLED'];
function job(v){
  if(!v||!id(v.jobId)||!phases.includes(v.status)||!Number.isSafeInteger(v.createdAt)||v.createdAt<0||(v.finishedAt!==null&&(!Number.isSafeInteger(v.finishedAt)||v.finishedAt<v.createdAt))||(v.status==='COMPLETED'&&v.finishedAt===null))throw Error();
  return {jobId:v.jobId,status:v.status,createdAt:v.createdAt,finishedAt:v.finishedAt};
}
export function createDriveBackupService({getCsrfToken,fetchImpl=globalThis.fetch}){
  if(typeof getCsrfToken!=='function'||typeof fetchImpl!=='function')throw Error('BACKUP_SERVICE_CONFIGURATION_REQUIRED');
  async function call(clinicId,action='',jobId=null){
    try{
      if(!id(clinicId)||(action==='jobs'&&!id(jobId)))throw Error();
      const mutation=action!==''&&action!=='jobs'&&action!=='overview';
      const headers={Accept:'application/json'},options={method:mutation?'POST':'GET',credentials:'same-origin',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000),headers};
      if(mutation){const csrf=await getCsrfToken();if(typeof csrf!=='string'||!csrf||csrf.length>256||/[\r\n]/.test(csrf))throw Error();headers['X-Clinic-CSRF']=csrf;headers['Content-Type']='application/json';options.body='{}';}
      const r=await fetchImpl(`/v2/clinics/${clinicId}/drive-backup${action?`/${action}`:''}${action==='jobs'?`/${jobId}`:''}`,options);
      if(!r.ok)throw Error();const reader=r.body?.getReader();if(!reader)throw Error();
      const chunks=[];let length=0;
      try{for(;;){const {done,value}=await reader.read();if(done)break;if((length+=value.length)>16384)throw Error();chunks.push(value);}}
      finally{try{await reader.cancel();}catch{}reader.releaseLock();}
      const bytes=new Uint8Array(length);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
      const p=JSON.parse(new TextDecoder().decode(bytes));
      // Only return explicit safe shapes. Unknown token/error fields never enter UI.
      if(action==='overview'&&r.status===200&&typeof p.connected==='boolean'&&(p.lastBackupAt===null||Number.isSafeInteger(p.lastBackupAt)&&p.lastBackupAt>=0))return {connected:p.connected,lastBackupAt:p.lastBackupAt,job:p.job===null?null:job(p.job)};
      if(action==='jobs'&&r.status===200)return {job:p.job===null&&jobId==='latest'?null:job(p.job)};
      if(action==='connect'&&r.status===200&&typeof p.consentUrl==='string')return {consentUrl:p.consentUrl};
      if(action==='backup'&&r.status===202&&['QUEUED','RUNNING','STAGED'].includes(p.status)&&id(p.jobId))return {status:p.status,jobId:p.jobId};
      if((action===''||action==='disconnect')&&r.status===200&&typeof p.connected==='boolean'&&(p.lastBackupAt===null||Number.isSafeInteger(p.lastBackupAt)&&p.lastBackupAt>=0))return {connected:p.connected,lastBackupAt:p.lastBackupAt};
      throw Error();
    }catch{throw Error('BACKUP_SERVICE_UNAVAILABLE');}
  }
  return {overview:({clinicId})=>call(clinicId,'overview'),status:({clinicId})=>call(clinicId),beginConnect:({clinicId})=>call(clinicId,'connect'),disconnect:({clinicId})=>call(clinicId,'disconnect'),backupNow:({clinicId})=>call(clinicId,'backup'),latestJob:({clinicId})=>call(clinicId,'jobs','latest'),jobStatus:({clinicId,jobId})=>call(clinicId,'jobs',jobId)};
}
