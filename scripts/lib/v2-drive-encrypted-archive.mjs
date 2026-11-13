// Server-only encrypted archive uploader; NOT the atomic checkpoint store.
import {randomBytes,createHash} from 'node:crypto';
import {openBatch} from './v2-backup-core.mjs';
const safeId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(v);
const fail=()=>{throw Error('DRIVE_ARCHIVE_FAILED');};
const MAX=8*1024*1024;
async function limited(response,max){
  const length=response.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>max))fail();
  const reader=response.body?.getReader();if(!reader)fail();
  const chunks=[];let size=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>max)fail();chunks.push(Buffer.from(value));}return Buffer.concat(chunks);}
  finally{try{await reader.cancel();}catch{/* no raw errors */}reader.releaseLock();}
}
export function createDriveEncryptedArchive({folderId,getAccessToken,fetchImpl=globalThis.fetch}){
  if(!safeId(folderId)||typeof getAccessToken!=='function'||typeof fetchImpl!=='function')throw Error('DRIVE_ARCHIVE_CONFIGURATION_REQUIRED');
  async function request(url,options={}){
    const accessToken=await getAccessToken();if(typeof accessToken!=='string'||!accessToken||/[\r\n]/.test(accessToken))fail();
    return fetchImpl(url,{...options,headers:{...options.headers,Authorization:`Bearer ${accessToken}`},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000)});
  }
  return {
    async reserveFileId(){
      try{const r=await request('https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=drive&type=files');if(!r.ok)fail();const p=JSON.parse((await limited(r,16384)).toString());if(!Array.isArray(p.ids)||p.ids.length!==1||!safeId(p.ids[0]))fail();return p.ids[0];}catch{fail();}
    },
    async uploadEncrypted({entry,key,fileId}){
      try{
        if(!safeId(fileId)||!Buffer.isBuffer(entry.object)||entry.object.length>MAX)fail();
        const object=Buffer.from(entry.object),digest=entry.digest;
        openBatch({object,digest,key}); // No plaintext upload path; authenticates batch first.
        const name=`${digest}.backup.enc`,boundary=`clinic_backup_${randomBytes(24).toString('hex')}`;
        const metadata={id:fileId,name,mimeType:'application/octet-stream',parents:[folderId],appProperties:{backupFormat:'clinic-encrypted-v1',sha256:digest}};
        const body=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),object,Buffer.from(`\r\n--${boundary}--\r\n`)]);
        const r=await request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',{method:'POST',headers:{'Content-Type':`multipart/related; boundary=${boundary}`},body});
        // Retry uses SAME previously reserved file ID.409 is not success by itself.
        if(!r.ok&&r.status!==409)fail();
        const meta=await request(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,parents,trashed,appProperties`);
        if(!meta.ok)fail();const p=JSON.parse((await limited(meta,16384)).toString());
        if(p.id!==fileId||p.name!==name||p.trashed!==false||!Array.isArray(p.parents)||p.parents.length!==1||p.parents[0]!==folderId||p.appProperties?.sha256!==digest||p.appProperties?.backupFormat!=='clinic-encrypted-v1')fail();
        const content=await request(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);if(!content.ok)fail();
        const stored=await limited(content,MAX);if(stored.length!==object.length||createHash('sha256').update(stored).digest('hex')!==digest||!stored.equals(object))fail();
        return {fileId,digest,bytes:stored.length,verified:true};
      }catch{fail();}
    },
  };
}
