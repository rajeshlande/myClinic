// Server-only private app-created Drive folder transport + fenced coordinator.
// No secrets/configuration, live calls or repository supplied by default.
import {randomBytes} from 'node:crypto';
const safeId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(v);
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(v);
const fail=()=>{throw Error('DRIVE_FOLDER_UNAVAILABLE');};
const name='Clinic encrypted backups';
async function json(r){
  if(!r.ok)fail();const length=r.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>16384))fail();
  const reader=r.body?.getReader();if(!reader)fail();const chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;if((size+=value.length)>16384)fail();chunks.push(Buffer.from(value));}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  finally{try{await reader.cancel();}catch{}reader.releaseLock();}
}
export function createDriveFolderTransport({getAccessToken,fetchImpl=globalThis.fetch}){
  if(typeof getAccessToken!=='function'||typeof fetchImpl!=='function')throw Error('DRIVE_FOLDER_CONFIGURATION_REQUIRED');
  async function request(url,options={}){
    const token=await getAccessToken();if(typeof token!=='string'||!token||/[\r\n]/.test(token))fail();
    return fetchImpl(url,{...options,headers:{...options.headers,Authorization:`Bearer ${token}`,Accept:'application/json'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
  }
  return {
    async reserveFolderId(){try{const p=await json(await request('https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=drive&type=files'));if(!Array.isArray(p.ids)||p.ids.length!==1||!safeId(p.ids[0]))fail();return p.ids[0];}catch{fail();}},
    async createOrVerify({fileId,clinicId,bindingId}){
      try{
        if(!safeId(fileId)||!id(clinicId)||!id(bindingId))fail();
        const body=JSON.stringify({id:fileId,name,mimeType:'application/vnd.google-apps.folder',appProperties:{purpose:'clinic-encrypted-backup-folder-v1',clinicId,bindingId}});
        const created=await request('https://www.googleapis.com/drive/v3/files?fields=id',{method:'POST',headers:{'Content-Type':'application/json'},body});
        if(!created.ok&&created.status!==409)fail();
        const p=await json(await request(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,trashed,ownedByMe,shared,appProperties,capabilities(canAddChildren)`));
        if(p.id!==fileId||p.name!==name||p.mimeType!=='application/vnd.google-apps.folder'||p.trashed!==false||p.ownedByMe!==true||p.shared!==false||p.capabilities?.canAddChildren!==true||p.appProperties?.purpose!=='clinic-encrypted-backup-folder-v1'||p.appProperties?.clinicId!==clinicId||p.appProperties?.bindingId!==bindingId)fail();
        return {fileId,clinicId,bindingId,verified:true};
      }catch{fail();}
    },
  };
}
export function createDriveFolderBinding({clinicId,connections,folders,drive}){
  if(!id(clinicId)||typeof connections?.readAuthorizedConnection!=='function'||!['readBindingIfCurrent','reserveIfCurrent','verifyIfCurrent'].every(k=>typeof folders?.[k]==='function')||typeof drive?.reserveFolderId!=='function'||typeof drive?.createOrVerify!=='function')throw Error('DRIVE_FOLDER_CONFIGURATION_REQUIRED');
  return async function ensureVerifiedFolder(){
    try{
      const c=structuredClone(await connections.readAuthorizedConnection(clinicId));if(!c||c.enabled!==true||c.clinicId!==clinicId||!id(c.userId)||!Number.isSafeInteger(c.revision)||c.revision<1)fail();
      const expected={clinicId,userId:c.userId,revision:c.revision};
      let intent=await folders.readBindingIfCurrent(expected);
      if(!intent){
        const fileId=await drive.reserveFolderId();if(!safeId(fileId))fail();
        // Persist ID/binding BEFORE remote create. Concurrent attempts converge.
        intent=await folders.reserveIfCurrent({...expected,fileId,bindingId:randomBytes(24).toString('hex')});
      }
      if(!intent||intent.clinicId!==clinicId||intent.userId!==c.userId||intent.revision!==c.revision||!safeId(intent.fileId)||!id(intent.bindingId))fail();
      // Always reverify, even an earlier VERIFIED binding (owner can trash/share).
      const result=await drive.createOrVerify({fileId:intent.fileId,clinicId,bindingId:intent.bindingId});
      if(result?.verified!==true||result.fileId!==intent.fileId||result.clinicId!==clinicId||result.bindingId!==intent.bindingId)fail();
      const receipt={...expected,fileId:intent.fileId,bindingId:intent.bindingId};
      if(await folders.verifyIfCurrent(receipt)!==true)fail();
      return {...receipt,verified:true}; // Not a backup/upload receipt.
    }catch{fail();}
  };
}
