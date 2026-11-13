// Operator-only Linux local-filesystem adapter. NOT offsite/cloud backup.
// Requires a private, trusted local filesystem with working fsync/link/rename.
import {constants} from 'node:fs';
import {open,mkdir,lstat,link,rename,unlink,rmdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
const fail=()=>{throw Error('BACKUP_LOCAL_STORE_FAILED');};
const MAX=8*1024*1024;
const scopePattern=/^v2\/[A-Za-z0-9][A-Za-z0-9_-]{0,95}\/schema-[1-9][0-9]{0,14}$/;
const fields=['project','schema','revision','digest','watermark','batchId','createdAt'];
const same=(a,b)=>a===null||b===null?a===b:fields.every(k=>a[k]===b[k]);
function head(h,scope){
  if(h===null)return;
  const [,project,version]=scope.split('/');
  if(!h||Object.getPrototypeOf(h)!==Object.prototype||Object.keys(h).sort().join('|')!==[...fields].sort().join('|')||h.project!==project||h.schema!==Number(version.slice(7))||!Number.isSafeInteger(h.revision)||h.revision<1||!Number.isSafeInteger(h.watermark)||h.watermark<0||!/^[a-f0-9]{64}$/.test(h.digest)||typeof h.batchId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(h.batchId)||typeof h.createdAt!=='string'||!Number.isFinite(Date.parse(h.createdAt)))fail();
}
async function syncDir(path){const f=await open(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await f.sync();}finally{await f.close();}}
async function directory(path){
  try{await mkdir(path,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
  const s=await lstat(path);if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o077)!==0||s.uid!==process.getuid())fail();
}
async function read(path,max){
  let f;
  try{f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);}
  catch(e){if(e.code==='ENOENT')return null;throw e;}
  try{
    const st=await f.stat();if(!st.isFile()||st.size>max||(st.mode&0o077)!==0||st.uid!==process.getuid())fail();
    // Bound actual read even if a faulty/external writer expands file after stat.
    const b=Buffer.alloc(max+1);let offset=0;
    while(offset<b.length){const {bytesRead}=await f.read(b,offset,b.length-offset,null);if(!bytesRead)break;offset+=bytesRead;}
    if(offset>max)fail();return b.subarray(0,offset);
  }finally{await f.close();}
}
export async function createLocalBackupStore({root}){
  try{
    if(process.platform!=='linux'||typeof root!=='string'||!root.startsWith('/')||resolve(root)!==root||root==='/')fail();
    // Root MUST already exist. Caller provisions a private non-shared directory.
    // Reject symlink ancestors rather than pretending pathname checks are a sandbox.
    let ancestor='/';for(const part of root.split('/').filter(Boolean)){ancestor=join(ancestor,part);const s=await lstat(ancestor);if(!s.isDirectory()||s.isSymbolicLink())fail();}
    await directory(root);
    async function scopeDir(scope){
      if(typeof scope!=='string'||!scopePattern.test(scope))fail();
      let p=root;for(const part of scope.split('/')){const parent=p;p=join(p,part);await directory(p);await syncDir(parent);}
      return p;
    }
    async function objectPath(path){
      if(typeof path!=='string')fail();const i=path.indexOf('/objects/');if(i<0)fail();
      const scope=path.slice(0,i),digest=path.slice(i+9);if(!/^[a-f0-9]{64}$/.test(digest))fail();
      const p=await scopeDir(scope),objects=join(p,'objects');await directory(objects);await syncDir(p);return {path:join(objects,digest),parent:objects,digest};
    }
    async function writeTemp(parent,buffer){
      const path=join(parent,`.pending-${randomBytes(16).toString('hex')}`),f=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
      try{await f.writeFile(buffer);await f.sync();}finally{await f.close();}return path;
    }
    const protect=fn=>async(...args)=>{try{return await fn(...args);}catch{fail();}};
    const readHeadRaw=async(scope,p)=>{const b=await read(join(p,'head.json'),4096);if(b===null)return null;const h=JSON.parse(b.toString('utf8'));head(h,scope);return h;};
    return {
      getObject:protect(async(path)=>{const p=await objectPath(path);return read(p.path,MAX);}),
      putObjectIfAbsent:protect(async(path,buffer)=>{
        if(!Buffer.isBuffer(buffer)||buffer.length>MAX)fail();const snapshot=Buffer.from(buffer);
        const p=await objectPath(path);
        if(createHash('sha256').update(snapshot).digest('hex')!==p.digest)fail();
        const temp=await writeTemp(p.parent,snapshot);
        try{
          try{await link(temp,p.path);}catch(e){if(e.code!=='EEXIST')throw e;}
          const stored=await read(p.path,MAX);if(!stored||!stored.equals(snapshot))fail();
          await syncDir(p.parent);
        }finally{await unlink(temp);await syncDir(p.parent);}
      }),
      readHead:protect(async(scope)=>{const p=await scopeDir(scope);return readHeadRaw(scope,p);}),
      compareAndSwapHead:protect(async(scope,expected,next)=>{
        // Snapshot all caller data before the first await.
        head(expected,scope);head(next,scope);if(next===null||next.revision!==(expected?.revision??0)+1)fail();
        const old=expected===null?null:{...expected},candidate={...next};
        const p=await scopeDir(scope),lock=join(p,'.checkpoint-lock');
        // Never steal/reclaim a lock: a leftover lock requires offline review.
        await mkdir(lock,{mode:0o700});await syncDir(p);
        let temp;
        try{
          const current=await readHeadRaw(scope,p);if(!same(current,old))return false;
          const object=await read(join(p,'objects',candidate.digest),MAX);
          if(!object||createHash('sha256').update(object).digest('hex')!==candidate.digest)fail();
          temp=await writeTemp(p,Buffer.from(JSON.stringify(candidate)));
          await rename(temp,join(p,'head.json'));temp=undefined;await syncDir(p);return true;
        }finally{
          if(temp)await unlink(temp);
          await rmdir(lock);await syncDir(p);
        }
      }),
    };
  }catch{fail();}
}
