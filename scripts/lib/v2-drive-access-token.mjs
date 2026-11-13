// Backend-only bridge: encrypted connection -> refreshed short-lived access token.
// Repository MUST resolve fresh active-owner authority and connection fencing.
import {openDriveGrant,sealDriveGrant} from './v2-drive-token-vault.mjs';
const fail=()=>{throw Error('DRIVE_CONNECTION_UNAVAILABLE');};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(v);
const same=(a,b)=>a&&b&&a.enabled===true&&b.enabled===true&&a.userId===b.userId&&a.clinicId===b.clinicId&&a.revision===b.revision;
export function createDriveAccessTokenProvider({clinicId,repository,keys,activeKeyId,transport}){
  if(!id(clinicId)||!(keys instanceof Map)||!id(activeKeyId)||typeof repository?.readAuthorizedConnection!=='function'||typeof repository?.replaceGrantIfCurrent!=='function'||typeof transport?.refresh!=='function')throw Error('DRIVE_CONNECTION_CONFIGURATION_REQUIRED');
  return async function getAccessToken(){
    try{
      const c=structuredClone(await repository.readAuthorizedConnection(clinicId));
      if(!c||c.enabled!==true||c.clinicId!==clinicId||!id(c.userId)||!Number.isSafeInteger(c.revision)||c.revision<1)fail();
      const expected={userId:c.userId,clinicId,revision:c.revision};
      const grant=openDriveGrant({envelope:c.envelope,keys,...expected});
      const refreshed=await transport.refresh({refreshToken:grant.refreshToken});
      if(!refreshed||typeof refreshed.accessToken!=='string'||!refreshed.accessToken||/[\r\n]/.test(refreshed.accessToken)||!Array.isArray(refreshed.grantedScopes)||refreshed.grantedScopes.length!==1||refreshed.grantedScopes[0]!==grant.scope)fail();
      // Recheck after Google call: disconnect/reconnect/revocation wins.
      const current=await repository.readAuthorizedConnection(clinicId);if(!same(c,current))fail();
      if(refreshed.refreshToken!==undefined&&refreshed.refreshToken!==grant.refreshToken){
        const revision=c.revision+1;
        const envelope=sealDriveGrant({key:keys.get(activeKeyId),keyId:activeKeyId,userId:c.userId,clinicId,revision,refreshToken:refreshed.refreshToken});
        // Actual implementation must atomically check authority+enabled+revision,
        // replace ciphertext and bump revision; never an unconditional update.
        if(await repository.replaceGrantIfCurrent({...expected,nextRevision:revision,envelope})!==true)fail();
      }
      return refreshed.accessToken; // Never return via owner/browser API.
    }catch{fail();}
  };
}
