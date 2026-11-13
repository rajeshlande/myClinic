// Server-only OAuth coordinator. No HTTP server, credentials or deployed storage.
// resolveOwner, transactions/state and encrypted vault adapters are mandatory.
import {randomBytes,createHash} from 'node:crypto';
const digest=v=>createHash('sha256').update(v).digest('base64url');
const token=()=>randomBytes(32).toString('base64url');
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(v);
const fail=()=>{throw Error('DRIVE_OWNER_AUTHORIZATION_FAILED');};
export function createDriveOwnerOAuth({clientId,redirectUri,resolveOwner,stateStore,google,vault,clock=Date.now}){
  const redirect=new URL(redirectUri);
  if(!/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId)||redirect.protocol!=='https:'||redirect.username||redirect.password||redirect.search||redirect.hash||typeof resolveOwner!=='function'||typeof stateStore?.create!=='function'||typeof stateStore?.claim!=='function'||typeof google?.exchange!=='function'||typeof google?.cleanupUnstoredGrant!=='function'||typeof vault?.saveEncrypted!=='function'||typeof vault?.disconnect!=='function')throw Error('DRIVE_OAUTH_CONFIGURATION_REQUIRED');
  async function owner(session,clinicId){
    if(!session||!id(clinicId))fail();
    const a=await resolveOwner(session,clinicId);
    if(!a||!id(a.userId)||a.clinicId!==clinicId||a.active!==true||a.role!=='owner')fail();
    return {userId:a.userId,clinicId};
  }
  return {
    async begin({session,clinicId}){
      try{
        const a=await owner(session,clinicId),state=token(),verifier=token(),now=clock();
        if(!Number.isSafeInteger(now)||now<0)fail();
        // Backend-only state record. create must persist atomically, no overwrite.
        await stateStore.create(digest(state),{...a,verifier,expiresAt:now+600000});
        const q=new URLSearchParams({client_id:clientId,redirect_uri:redirectUri,response_type:'code',scope:'https://www.googleapis.com/auth/drive.file',state,code_challenge:digest(verifier),code_challenge_method:'S256',access_type:'offline',prompt:'consent select_account'});
        return {consentUrl:`https://accounts.google.com/o/oauth2/v2/auth?${q}`};
      }catch{fail();}
    },
    async complete({session,clinicId,state,code}){
      let credentials;
      try{
        const a=await owner(session,clinicId);
        if(typeof state!=='string'||!/^[-_A-Za-z0-9]{43}$/.test(state)||typeof code!=='string'||code.length<1||code.length>4096||/[\r\n]/.test(code))fail();
        // claim MUST atomically check owner, clinic, expiry and consume exactly once.
        const record=await stateStore.claim(digest(state),{...a,now:clock()});
        if(!record||record.userId!==a.userId||record.clinicId!==clinicId||!Number.isSafeInteger(record.expiresAt)||record.expiresAt<=clock()||!/^[-_A-Za-z0-9]{43}$/.test(record.verifier))fail();
        credentials=await google.exchange({code,verifier:record.verifier,redirectUri});
        if(typeof credentials?.refreshToken!=='string'||!credentials.refreshToken||credentials.refreshToken.length>8192||!Array.isArray(credentials.grantedScopes)||credentials.grantedScopes.length!==1||credentials.grantedScopes[0]!=='https://www.googleapis.com/auth/drive.file')fail();
        const current=await owner(session,clinicId);if(current.userId!==a.userId)fail();
        // Vault MUST encrypt token at rest with clinic/user-bound AAD, independent
        // of backup/Drive keys. Never return tokens/account-wide grants to browser.
        await vault.saveEncrypted({...a,refreshToken:credentials.refreshToken,scope:'https://www.googleapis.com/auth/drive.file'});
        return {connected:true,lastBackupAt:null};
      }catch{
        // Adapter must not blindly revoke grants shared by another clinic binding.
        // Queue redacted follow-up if safe grant cleanup cannot complete here.
        if(credentials?.refreshToken)try{await google.cleanupUnstoredGrant(credentials.refreshToken);}catch{/* record sanitized operator failure in real adapter */}
        fail();
      }
    },
    async disconnect({session,clinicId}){
      try{
        const a=await owner(session,clinicId);
        // Atomic disable job admission + erase clinic binding. A reviewed vault
        // implementation queues grant cleanup when no other clinic shares it.
        await vault.disconnect(a);
        return {connected:false,lastBackupAt:null};
      }catch{fail();}
    },
  };
}
