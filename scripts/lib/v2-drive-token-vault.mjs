// Server-only grant encryption codec. Persistence/ownership fencing is separate.
// Use an independent backend vault key, NEVER a Drive-stored or backup data key.
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
const SCOPE='https://www.googleapis.com/auth/drive.file';
const fail=()=>{throw Error('DRIVE_VAULT_INVALID');};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(v);
const exact=(o,keys)=>o&&Object.getPrototypeOf(o)===Object.prototype&&Object.keys(o).sort().join('|')===[...keys].sort().join('|');
function binding(m){if(!exact(m,['format','keyId','userId','clinicId','revision'])||m.format!==1||![m.keyId,m.userId,m.clinicId].every(id)||!Number.isSafeInteger(m.revision)||m.revision<1)fail();}
function secret(v){if(typeof v!=='string'||v.length<1||v.length>8192||/[\r\n]/.test(v))fail();}
const aad=m=>Buffer.from(JSON.stringify(['clinic-drive-refresh-grant-v1',m.keyId,m.userId,m.clinicId,m.revision]));
function decode(s,length){if(typeof s!=='string'||s.length>32768)fail();const b=Buffer.from(s,'base64');if(b.toString('base64')!==s||(length!==undefined&&b.length!==length))fail();return b;}
export function sealDriveGrant({key,keyId,userId,clinicId,revision,refreshToken}){
  try{
    if(!Buffer.isBuffer(key)||key.length!==32)fail();secret(refreshToken);
    const metadata={format:1,keyId,userId,clinicId,revision};binding(metadata);
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(aad(metadata));
    const raw=Buffer.from(JSON.stringify({refreshToken,scope:SCOPE}));
    const ciphertext=Buffer.concat([cipher.update(raw),cipher.final()]);
    return {metadata,iv:iv.toString('base64'),ciphertext:ciphertext.toString('base64'),tag:cipher.getAuthTag().toString('base64')};
  }catch{fail();}
}
export function openDriveGrant({envelope,keys,userId,clinicId,revision}){
  try{
    if(!exact(envelope,['metadata','iv','ciphertext','tag'])||!(keys instanceof Map))fail();
    const m=envelope.metadata;binding(m);
    // Expected revision must come from a trusted authoritative connection record.
    if(m.userId!==userId||m.clinicId!==clinicId||m.revision!==revision)fail();
    const key=keys.get(m.keyId);if(!Buffer.isBuffer(key)||key.length!==32)fail();
    const d=createDecipheriv('aes-256-gcm',key,decode(envelope.iv,12));d.setAAD(aad(m));d.setAuthTag(decode(envelope.tag,16));
    const raw=Buffer.concat([d.update(decode(envelope.ciphertext)),d.final()]);if(raw.length>16384)fail();
    const p=JSON.parse(raw.toString('utf8'));if(!exact(p,['refreshToken','scope'])||p.scope!==SCOPE)fail();secret(p.refreshToken);
    return p; // Backend memory only. Never serialize through an owner API response.
  }catch{fail();}
}
