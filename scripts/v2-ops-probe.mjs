#!/usr/bin/env node
/** Server/operator-only read probe. Dry-run by default. Never import in src/.
 * No SQL mutation, token minting, activation or raw error/credential output.
 */
import { pathToFileURL } from 'node:url';
export const TARGETS=Object.freeze([
  Object.freeze({name:'master',url:'https://inaqzvzfongngahxptzw.supabase.co',version:5,keyEnv:'MASTER_OPS_KEY'}),
  Object.freeze({name:'clinical',url:'https://kvxmcdezpozkvdmvmicr.supabase.co',version:22,keyEnv:'CLINICAL_OPS_KEY'}),
]);
function serverKey(key){
  if(typeof key!=='string'||!key||/[\r\n]/.test(key))return false;
  if(/^sb_secret_[A-Za-z0-9_-]+$/.test(key))return true;
  try{const parts=key.split('.');return parts.length===3&&JSON.parse(Buffer.from(parts[1],'base64url').toString()).role==='service_role';}catch{return false;}
}
export async function probeV2Operations({live=false,env=process.env,fetchImpl=globalThis.fetch}={}){
  if(!live)return {mode:'DRY_RUN',ok:true,targets:TARGETS.map(t=>({name:t.name,url:t.url,expectedVersion:t.version})),note:'No requests made. Backups, capacity and hosted trust are not tested.'};
  if(env.OPS_ALLOW_LIVE_READS!=='yes')return {mode:'LIVE_READ',ok:false,code:'LIVE_READ_APPROVAL_REQUIRED'};
  if(TARGETS.some(t=>!serverKey(env[t.keyEnv])))return {mode:'LIVE_READ',ok:false,code:'SERVER_CREDENTIALS_REQUIRED'};
  const results=[];
  for(const target of TARGETS){
    const key=env[target.keyEnv];
    const headers={apikey:key,Accept:'application/json'};
    if(!key.startsWith('sb_secret_'))headers.Authorization=`Bearer ${key}`;
    try{
      const response=await fetchImpl(`${target.url}/rest/v1/app_meta?select=schema_version&limit=1`,{
        method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(10000),cache:'no-store',
      });
      if(!response.ok){results.push({name:target.name,ok:false,code:response.status===540?'PROJECT_PAUSED':'DATABASE_READ_REFUSED',httpStatus:response.status});continue;}
      const rows=await response.json();
      if(!Array.isArray(rows)||rows.length!==1||!Number.isInteger(rows[0]?.schema_version)){
        results.push({name:target.name,ok:false,code:'INVALID_VERSION_RESPONSE'});continue;
      }
      const version=rows[0].schema_version;
      results.push({name:target.name,ok:version===target.version,code:version===target.version?'DATABASE_READ_OK':'SCHEMA_VERSION_MISMATCH',version,expectedVersion:target.version});
    }catch{results.push({name:target.name,ok:false,code:'NETWORK_OR_RESPONSE_FAILURE'});}
  }
  return {mode:'LIVE_READ',ok:results.every(r=>r.ok),results,note:'Read probe only; not tenant isolation, backup, capacity or complete schema verification.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const args=process.argv.slice(2);
  if(args.some(a=>!['--live','--dry-run'].includes(a))||(args.includes('--live')&&args.includes('--dry-run'))){
    console.error('Use --dry-run (default) or explicitly approved --live.');process.exitCode=2;
  }else{
    const result=await probeV2Operations({live:args.includes('--live')});
    console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;
  }
}
