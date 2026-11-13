// Staged v2 same-origin service client. Never stores session or Google tokens.
export function createDriveBackupService({getCsrfToken,fetchImpl=globalThis.fetch}){
  if(typeof getCsrfToken!=='function'||typeof fetchImpl!=='function')throw Error('BACKUP_SERVICE_CONFIGURATION_REQUIRED');
  async function call(clinicId,action=''){
    try{
      if(typeof clinicId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(clinicId))throw Error();
      const headers={Accept:'application/json'},options={method:action?'POST':'GET',credentials:'same-origin',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000),headers};
      if(action){const csrf=await getCsrfToken();if(typeof csrf!=='string'||!csrf||csrf.length>256||/[\r\n]/.test(csrf))throw Error();headers['X-Clinic-CSRF']=csrf;headers['Content-Type']='application/json';options.body='{}';}
      const r=await fetchImpl(`/v2/clinics/${clinicId}/drive-backup${action?`/${action}`:''}`,options);
      if(!r.ok)throw Error();const reader=r.body?.getReader();if(!reader)throw Error();
      const chunks=[];let length=0;
      try{for(;;){const {done,value}=await reader.read();if(done)break;if((length+=value.length)>16384)throw Error();chunks.push(value);}}
      finally{try{await reader.cancel();}catch{}reader.releaseLock();}
      const bytes=new Uint8Array(length);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
      const p=JSON.parse(new TextDecoder().decode(bytes));
      // Only return explicit safe shapes. Unknown token/error fields never enter UI.
      if(action==='connect'&&r.status===200&&typeof p.consentUrl==='string')return {consentUrl:p.consentUrl};
      if(action==='backup'&&r.status===202&&p.status==='QUEUED'&&typeof p.jobId==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(p.jobId))return {status:'QUEUED',jobId:p.jobId};
      if((action===''||action==='disconnect')&&r.status===200&&typeof p.connected==='boolean'&&(p.lastBackupAt===null||Number.isSafeInteger(p.lastBackupAt)&&p.lastBackupAt>=0))return {connected:p.connected,lastBackupAt:p.lastBackupAt};
      throw Error();
    }catch{throw Error('BACKUP_SERVICE_UNAVAILABLE');}
  }
  return {status:({clinicId})=>call(clinicId),beginConnect:({clinicId})=>call(clinicId,'connect'),disconnect:({clinicId})=>call(clinicId,'disconnect'),backupNow:({clinicId})=>call(clinicId,'backup')};
}
