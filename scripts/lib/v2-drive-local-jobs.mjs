// Internal local SQLite job/ledger extension. Called only by local repository.
// No Google/HTTP/source DB operations; fixture authority is NOT production auth.
import {randomBytes} from 'node:crypto';
import {openBatch} from './v2-backup-core.mjs';
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(v);
const fileId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(v);
const fail=()=>{throw Error('DRIVE_LOCAL_JOB_FAILED');};
const active="status IN ('QUEUED','RUNNING','STAGED')";
export function createLocalDriveJobs({db,txn,now,allowed,current,guard}){
  db.exec(`CREATE TABLE IF NOT EXISTS backup_jobs(
job_id TEXT PRIMARY KEY,clinic TEXT NOT NULL,user_id TEXT NOT NULL,requested_by TEXT NOT NULL,revision INTEGER NOT NULL,
folder_id TEXT NOT NULL,binding_id TEXT NOT NULL,project TEXT NOT NULL,schema_version INTEGER NOT NULL,
status TEXT NOT NULL CHECK(status IN('QUEUED','RUNNING','STAGED','COMPLETED','CANCELLED')),
expected_digest TEXT,expected_high INTEGER,lease_token TEXT,lease_until INTEGER,attempts INTEGER NOT NULL DEFAULT 0,
candidate BLOB,digest TEXT,file_id TEXT,batch_id TEXT,high INTEGER,source_created TEXT,created_at INTEGER NOT NULL,finished_at INTEGER);
CREATE UNIQUE INDEX IF NOT EXISTS backup_one_active_clinic ON backup_jobs(clinic) WHERE ${active};
CREATE UNIQUE INDEX IF NOT EXISTS backup_unique_batch ON backup_jobs(clinic,binding_id,batch_id) WHERE batch_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS backup_heads(clinic TEXT NOT NULL,binding_id TEXT NOT NULL,project TEXT NOT NULL,schema_version INTEGER NOT NULL,
digest TEXT NOT NULL,high INTEGER NOT NULL,file_id TEXT NOT NULL,source_created TEXT NOT NULL,finished_at INTEGER NOT NULL,PRIMARY KEY(clinic,binding_id));`);
  const get=jobId=>db.prepare('SELECT * FROM backup_jobs WHERE job_id=?').get(jobId);
  const head=j=>db.prepare('SELECT * FROM backup_heads WHERE clinic=? AND binding_id=?').get(j.clinic,j.binding_id);
  function stillAuthorized(j){
    if(!j||!allowed(j.requested_by,j.clinic)||!current({userId:j.user_id,clinicId:j.clinic,revision:j.revision}))return false;
    const f=db.prepare('SELECT * FROM drive_folders WHERE clinic=?').get(j.clinic);
    return Boolean(f&&f.user_id===j.user_id&&f.revision===j.revision&&f.file_id===j.folder_id&&f.binding_id===j.binding_id&&f.verified_at!==null);
  }
  function leased(jobId,token){
    if(!id(jobId)||typeof token!=='string'||!/^[-_A-Za-z0-9]{43}$/.test(token))fail();
    const j=get(jobId);if(!j||!['RUNNING','STAGED'].includes(j.status)||j.lease_token!==token||j.lease_until<=now()||!stillAuthorized(j))fail();return j;
  }
  function work(j){return {jobId:j.job_id,clinicId:j.clinic,userId:j.user_id,revision:j.revision,folderId:j.folder_id,bindingId:j.binding_id,project:j.project,schema:j.schema_version,status:j.status,expectedDigest:j.expected_digest,expectedHigh:j.expected_high,leaseToken:j.lease_token,leaseUntil:j.lease_until,attempts:j.attempts,...(j.candidate===null?{}:{entry:{object:Buffer.from(j.candidate),digest:j.digest},fileId:j.file_id})};}
  const cancelClinic=clinic=>db.prepare(`UPDATE backup_jobs SET status='CANCELLED',lease_token=NULL,lease_until=NULL WHERE clinic=? AND ${active}`).run(clinic);
  const api={
    enqueue:guard(a=>txn(()=>{
      // Source project/schema MUST come from reviewed backend registry, not HTTP body.
      if(!a||!allowed(a.userId,a.clinicId)||!id(a.project)||!Number.isSafeInteger(a.schema)||a.schema<1)fail();
      const c=db.prepare('SELECT * FROM connections WHERE clinic=?').get(a.clinicId),f=db.prepare('SELECT * FROM drive_folders WHERE clinic=?').get(a.clinicId);
      if(!c||!current({userId:c.user_id,clinicId:a.clinicId,revision:c.revision})||!f||f.user_id!==c.user_id||f.revision!==c.revision||f.verified_at===null)fail();
      const existing=db.prepare(`SELECT * FROM backup_jobs WHERE clinic=? AND ${active}`).get(a.clinicId);
      if(existing&&stillAuthorized(existing)){if(existing.project!==a.project||existing.schema_version!==a.schema)fail();return {jobId:existing.job_id,status:existing.status};}
      if(existing)cancelClinic(a.clinicId);
      const h=db.prepare('SELECT * FROM backup_heads WHERE clinic=? AND binding_id=?').get(a.clinicId,f.binding_id);
      if(h&&(h.project!==a.project||h.schema_version!==a.schema))fail();
      const jobId=randomBytes(24).toString('hex');
      db.prepare(`INSERT INTO backup_jobs(job_id,clinic,user_id,requested_by,revision,folder_id,binding_id,project,schema_version,status,expected_digest,expected_high,created_at) VALUES(?,?,?,?,?,?,?,?,?,'QUEUED',?,?,?)`).run(jobId,a.clinicId,c.user_id,a.userId,c.revision,f.file_id,f.binding_id,a.project,a.schema,h?.digest??null,h?.high??null,now());
      return {jobId,status:'QUEUED'};
    })),
    claim:guard(({jobId,leaseMs=60000})=>txn(()=>{
      if(!id(jobId)||!Number.isSafeInteger(leaseMs)||leaseMs<1000||leaseMs>300000)fail();
      const j=get(jobId),n=now();if(!j||!['QUEUED','RUNNING','STAGED'].includes(j.status))return null;
      if(!stillAuthorized(j)){db.prepare("UPDATE backup_jobs SET status='CANCELLED',lease_token=NULL,lease_until=NULL WHERE job_id=?").run(jobId);return null;}
      if(j.lease_until!==null&&j.lease_until>n)return null;
      if(!Number.isSafeInteger(n+leaseMs))fail();const token=randomBytes(32).toString('base64url');
      db.prepare("UPDATE backup_jobs SET status=CASE WHEN candidate IS NULL THEN 'RUNNING' ELSE 'STAGED' END,lease_token=?,lease_until=?,attempts=attempts+1 WHERE job_id=?").run(token,n+leaseMs,jobId);
      return work(get(jobId));
    })),
    readWork:guard(({jobId,leaseToken})=>txn(()=>work(leased(jobId,leaseToken)))),
    stage:guard(({jobId,leaseToken,entry,key,fileId:remoteId})=>txn(()=>{
      const j=leased(jobId,leaseToken);if(!fileId(remoteId)||!Buffer.isBuffer(entry?.object)||entry.object.length>8*1024*1024)fail();
      const object=Buffer.from(entry.object),digest=entry.digest,{manifest:m}=openBatch({object,digest,key});
      if(j.candidate!==null){if(j.digest!==digest||j.file_id!==remoteId||!Buffer.from(j.candidate).equals(object))fail();return work(j);}
      if(m.project!==j.project||m.schema!==j.schema_version)fail();
      if(j.expected_digest===null){if(m.kind!=='baseline'||m.previous!==null)fail();}
      else if(m.kind!=='increment'||m.previous!==j.expected_digest||m.low!==j.expected_high)fail();
      const h=head(j);if((h?.digest??null)!==j.expected_digest||h&&Date.parse(m.createdAt)<Date.parse(h.source_created))fail();
      db.prepare("UPDATE backup_jobs SET status='STAGED',candidate=?,digest=?,file_id=?,batch_id=?,high=?,source_created=? WHERE job_id=?").run(object,digest,remoteId,m.batchId,m.high,m.createdAt,jobId);
      return work(get(jobId));
    })),
    complete:guard(({jobId,leaseToken,receipt})=>txn(()=>{
      const j=leased(jobId,leaseToken);if(j.status!=='STAGED'||j.candidate===null||!receipt||receipt.verified!==true||receipt.digest!==j.digest||receipt.fileId!==j.file_id||receipt.bytes!==j.candidate.length)fail();
      const h=head(j);if((h?.digest??null)!==j.expected_digest||(h?.high??null)!==j.expected_high)fail();
      const finishedAt=now();
      db.prepare('INSERT INTO backup_heads VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(clinic,binding_id) DO UPDATE SET digest=excluded.digest,high=excluded.high,file_id=excluded.file_id,source_created=excluded.source_created,finished_at=excluded.finished_at').run(j.clinic,j.binding_id,j.project,j.schema_version,j.digest,j.high,j.file_id,j.source_created,finishedAt);
      db.prepare("UPDATE backup_jobs SET status='COMPLETED',lease_token=NULL,lease_until=NULL,finished_at=? WHERE job_id=?").run(finishedAt,jobId);
      return {jobId,status:'COMPLETED',digest:j.digest,watermark:j.high,finishedAt};
    })),
    ownerStatus:guard(({userId,clinicId,jobId})=>{
      if(!allowed(userId,clinicId)||!id(jobId))fail();const j=get(jobId);if(!j||j.clinic!==clinicId)fail();
      return {jobId,status:j.status,createdAt:j.created_at,finishedAt:j.finished_at};
    }),
  };
  return {api,cancelClinic,advanceRevision:(clinic,userId,oldRevision,nextRevision)=>db.prepare(`UPDATE backup_jobs SET revision=? WHERE clinic=? AND user_id=? AND revision=? AND ${active}`).run(nextRevision,clinic,userId,oldRevision),lastBackupAt:clinic=>{
    const f=db.prepare('SELECT binding_id FROM drive_folders WHERE clinic=?').get(clinic);if(!f)return null;
    return db.prepare('SELECT finished_at FROM backup_heads WHERE clinic=? AND binding_id=?').get(clinic,f.binding_id)?.finished_at??null;
  }};
}
