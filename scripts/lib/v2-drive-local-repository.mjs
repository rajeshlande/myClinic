// Linux-only local preparation repository; NEVER a production authority mirror.
// Administrative fixture access below must not be exposed via HTTP/UI.
import {DatabaseSync} from 'node:sqlite';
import {open,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,join} from 'node:path';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {sealDriveGrant,openDriveGrant} from './v2-drive-token-vault.mjs';
import {createLocalDriveJobs} from './v2-drive-local-jobs.mjs';
const fail=()=>{throw Error('DRIVE_LOCAL_REPOSITORY_FAILED');};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(v);
const hash=v=>typeof v==='string'&&/^[-_A-Za-z0-9]{43}$/.test(v);
const integer=v=>Number.isSafeInteger(v)&&v>=0;
export async function createLocalDriveRepository({root,keys,activeKeyId,clock=Date.now}){
  let db;
  try{
    if(process.platform!=='linux'||typeof root!=='string'||!root.startsWith('/')||root==='/'||resolve(root)!==root||!(keys instanceof Map)||!id(activeKeyId)||!Buffer.isBuffer(keys.get(activeKeyId))||keys.get(activeKeyId).length!==32||typeof clock!=='function')fail();
    let p='/';for(const segment of root.split('/').filter(Boolean)){p=join(p,segment);const s=await lstat(p);if(!s.isDirectory()||s.isSymbolicLink())fail();}
    const st=await lstat(root);if(st.uid!==process.getuid()||(st.mode&0o077)!==0)fail();
    const path=join(root,'drive-connections.sqlite');
    const file=await open(path,constants.O_RDWR|constants.O_CREAT|constants.O_NOFOLLOW,0o600);
    try{const s=await file.stat();if(!s.isFile()||s.uid!==process.getuid()||(s.mode&0o077)!==0)fail();await file.sync();}finally{await file.close();}
    // SQLite sidecars must not follow pre-existing links in a reused directory.
    for(const suffix of ['-wal','-shm','-journal']){
      try{const s=await lstat(path+suffix);if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o077)!==0)fail();}catch(e){if(e.code!=='ENOENT')throw e;}
    }
    db=new DatabaseSync(path);db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=0;');
    db.exec(`CREATE TABLE IF NOT EXISTS local_owner_fixture(clinic TEXT NOT NULL, user_id TEXT NOT NULL, active INTEGER NOT NULL CHECK(active IN(0,1)), PRIMARY KEY(clinic,user_id));
CREATE TABLE IF NOT EXISTS oauth_states(hash TEXT PRIMARY KEY, clinic TEXT NOT NULL, user_id TEXT NOT NULL, expires INTEGER NOT NULL, encrypted TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS connections(clinic TEXT PRIMARY KEY, user_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), enabled INTEGER NOT NULL CHECK(enabled IN(0,1)), envelope TEXT);
CREATE TABLE IF NOT EXISTS drive_folders(clinic TEXT PRIMARY KEY, user_id TEXT NOT NULL, revision INTEGER NOT NULL, file_id TEXT NOT NULL, binding_id TEXT NOT NULL, verified_at INTEGER);`);
    const dir=await open(root,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await dir.sync();}finally{await dir.close();}
    let closed=false;
    const guard=fn=>(...args)=>{try{if(closed)fail();return fn(...args);}catch{fail();}};
    function txn(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){try{db.exec('ROLLBACK');}catch{}throw e;}}
    function now(){const n=clock();if(!integer(n))fail();return n;}
    function allowed(userId,clinicId){return id(userId)&&id(clinicId)&&db.prepare('SELECT active FROM local_owner_fixture WHERE clinic=? AND user_id=?').get(clinicId,userId)?.active===1;}
    const connection=clinic=>db.prepare('SELECT * FROM connections WHERE clinic=?').get(clinic);
    function current(a){if(!a||!allowed(a.userId,a.clinicId)||!Number.isSafeInteger(a.revision)||a.revision<1)return false;const c=connection(a.clinicId);return Boolean(c&&c.enabled===1&&c.user_id===a.userId&&c.revision===a.revision);}
    function folderRecord(row){return row?{clinicId:row.clinic,userId:row.user_id,revision:row.revision,fileId:row.file_id,bindingId:row.binding_id,verifiedAt:row.verified_at}:null;}
    function stateAad(h,r){return Buffer.from(JSON.stringify(['clinic-drive-oauth-state-v1',h,r.userId,r.clinicId,r.expiresAt]));}
    function encryptState(h,r){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',keys.get(activeKeyId),iv);c.setAAD(stateAad(h,r));return JSON.stringify({keyId:activeKeyId,iv:iv.toString('base64'),data:Buffer.concat([c.update(r.verifier,'utf8'),c.final()]).toString('base64'),tag:c.getAuthTag().toString('base64')});}
    function decryptState(h,row){const e=JSON.parse(row.encrypted),key=keys.get(e.keyId);if(!Buffer.isBuffer(key)||key.length!==32)fail();const r={userId:row.user_id,clinicId:row.clinic,expiresAt:row.expires};const d=createDecipheriv('aes-256-gcm',key,Buffer.from(e.iv,'base64'));d.setAAD(stateAad(h,r));d.setAuthTag(Buffer.from(e.tag,'base64'));const verifier=Buffer.concat([d.update(Buffer.from(e.data,'base64')),d.final()]).toString('utf8');if(!hash(verifier))fail();return {...r,verifier};}
    const localJobs=createLocalDriveJobs({db,txn,now,allowed,current,guard});
    const api={
      jobs:localJobs.api,
      // Fixture/admin API only. Production MUST replace with authoritative owner
      // membership reads and transactionally fenced access, not this local table.
      setFixtureOwnerAccess:guard(({userId,clinicId,active})=>{if(!id(userId)||!id(clinicId)||typeof active!=='boolean')fail();db.prepare('INSERT INTO local_owner_fixture VALUES(?,?,?) ON CONFLICT(clinic,user_id) DO UPDATE SET active=excluded.active').run(clinicId,userId,Number(active));}),
      resolveOwner:guard((session,clinicId)=>allowed(session?.userId,clinicId)?{userId:session.userId,clinicId,active:true,role:'owner'}:null),
      lookupCallbackClinic:guard((h,userId)=>{if(!hash(h)||!id(userId))fail();const r=db.prepare('SELECT * FROM oauth_states WHERE hash=?').get(h);return r&&r.user_id===userId&&r.expires>now()&&allowed(userId,r.clinic)?r.clinic:null;}),
      stateStore:{
        create:guard((h,r)=>txn(()=>{const n=now();if(!hash(h)||!r||!hash(r.verifier)||!integer(r.expiresAt)||r.expiresAt<=n||r.expiresAt>n+600000||!allowed(r.userId,r.clinicId))fail();db.prepare('INSERT INTO oauth_states VALUES(?,?,?,?,?)').run(h,r.clinicId,r.userId,r.expiresAt,encryptState(h,r));})),
        claim:guard((h,a)=>txn(()=>{const n=now();if(!hash(h)||!a||!integer(a.now)||a.now>n||n-a.now>10000)fail();const row=db.prepare('SELECT * FROM oauth_states WHERE hash=?').get(h);if(!row||row.user_id!==a.userId||row.clinic!==a.clinicId||row.expires<=n||!allowed(a.userId,a.clinicId))return null;const r=decryptState(h,row);db.prepare('DELETE FROM oauth_states WHERE hash=?').run(h);return r;})),
      },
      vault:{
        saveEncrypted:guard(r=>txn(()=>{if(!r||r.scope!=='https://www.googleapis.com/auth/drive.file'||!allowed(r.userId,r.clinicId))fail();const old=connection(r.clinicId),revision=(old?.revision??0)+1;const envelope=sealDriveGrant({key:keys.get(activeKeyId),keyId:activeKeyId,userId:r.userId,clinicId:r.clinicId,revision,refreshToken:r.refreshToken});db.prepare('INSERT INTO connections VALUES(?,?,?,?,?) ON CONFLICT(clinic) DO UPDATE SET user_id=excluded.user_id,revision=excluded.revision,enabled=1,envelope=excluded.envelope').run(r.clinicId,r.userId,revision,1,JSON.stringify(envelope));db.prepare('DELETE FROM drive_folders WHERE clinic=?').run(r.clinicId);localJobs.cancelClinic(r.clinicId);})),
        disconnect:guard(a=>txn(()=>{if(!allowed(a?.userId,a?.clinicId))fail();const c=connection(a.clinicId);if(c){if(!integer(c.revision+1))fail();db.prepare('UPDATE connections SET revision=revision+1,enabled=0,envelope=NULL WHERE clinic=?').run(a.clinicId);}db.prepare('DELETE FROM oauth_states WHERE clinic=?').run(a.clinicId);db.prepare('DELETE FROM drive_folders WHERE clinic=?').run(a.clinicId);localJobs.cancelClinic(a.clinicId);})),
      },
      repository:{
        readAuthorizedConnection:guard(clinicId=>{if(!id(clinicId))fail();const c=connection(clinicId);return c&&c.enabled===1&&allowed(c.user_id,clinicId)?{clinicId,userId:c.user_id,revision:c.revision,enabled:true,envelope:JSON.parse(c.envelope)}:null;}),
        replaceGrantIfCurrent:guard(a=>txn(()=>{if(!a||!allowed(a.userId,a.clinicId)||a.nextRevision!==a.revision+1)return false;const c=connection(a.clinicId);if(!c||c.enabled!==1||c.user_id!==a.userId||c.revision!==a.revision)return false;openDriveGrant({envelope:a.envelope,keys,userId:a.userId,clinicId:a.clinicId,revision:a.nextRevision});db.prepare('UPDATE connections SET revision=?,envelope=? WHERE clinic=?').run(a.nextRevision,JSON.stringify(a.envelope),a.clinicId);db.prepare('UPDATE drive_folders SET revision=? WHERE clinic=? AND user_id=? AND revision=?').run(a.nextRevision,a.clinicId,a.userId,a.revision);localJobs.advanceRevision(a.clinicId,a.userId,a.revision,a.nextRevision);return true;})),
      },
      folders:{
        readBindingIfCurrent:guard(a=>txn(()=>{if(!current(a))return null;const f=db.prepare('SELECT * FROM drive_folders WHERE clinic=? AND user_id=? AND revision=?').get(a.clinicId,a.userId,a.revision);return folderRecord(f);})),
        reserveIfCurrent:guard(a=>txn(()=>{if(!current(a))return null;if(typeof a.fileId!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(a.fileId)||!id(a.bindingId))fail();const old=db.prepare('SELECT * FROM drive_folders WHERE clinic=?').get(a.clinicId);if(old){if(old.user_id!==a.userId||old.revision!==a.revision)return null;return folderRecord(old);}db.prepare('INSERT INTO drive_folders VALUES(?,?,?,?,?,NULL)').run(a.clinicId,a.userId,a.revision,a.fileId,a.bindingId);return folderRecord(db.prepare('SELECT * FROM drive_folders WHERE clinic=?').get(a.clinicId));})),
        verifyIfCurrent:guard(a=>txn(()=>{if(!current(a))return false;const result=db.prepare('UPDATE drive_folders SET verified_at=? WHERE clinic=? AND user_id=? AND revision=? AND file_id=? AND binding_id=?').run(now(),a.clinicId,a.userId,a.revision,a.fileId,a.bindingId);return result.changes===1;})),
      },
      readOwnerStatus:guard(a=>{if(!allowed(a?.userId,a?.clinicId))fail();const c=connection(a.clinicId),connected=Boolean(c&&c.enabled===1&&allowed(c.user_id,a.clinicId));if(connected)openDriveGrant({envelope:JSON.parse(c.envelope),keys,userId:c.user_id,clinicId:a.clinicId,revision:c.revision});return {connected,lastBackupAt:connected?localJobs.lastBackupAt(a.clinicId):null};}),
      purgeExpiredStates:guard(()=>db.prepare('DELETE FROM oauth_states WHERE expires<=?').run(now()).changes),
      close:()=>{if(!closed){db.close();closed=true;}},
    };
    return api;
  }catch{try{db?.close();}catch{}fail();}
}
