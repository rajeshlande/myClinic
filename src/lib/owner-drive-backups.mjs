// Staged v2 owner settings controller. No Google tokens, storage or database fallback.
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(v);
const scopeKey=a=>a&&a.active===true&&a.role==='owner'&&id(a.userId)&&id(a.clinicId)?`${a.userId}/${a.clinicId}`:null;
const allowedScopes='https://www.googleapis.com/auth/drive.file';
export function validateDriveConsentUrl(value,redirectUri){
  try{
    const url=new URL(value),redirect=new URL(redirectUri);
    if(redirect.protocol!=='https:'||redirect.username||redirect.password||redirect.hash||redirect.search)throw Error();
    if(url.origin!=='https://accounts.google.com'||url.pathname!=='/o/oauth2/v2/auth'||url.hash||url.username||url.password)throw Error();
    const q=url.searchParams,allowed=['client_id','redirect_uri','response_type','scope','state','code_challenge','code_challenge_method','access_type','prompt'];
    if([...q.keys()].some(k=>!allowed.includes(k))||allowed.some(k=>q.getAll(k).length!==1)||q.get('redirect_uri')!==redirectUri||q.get('response_type')!=='code'||q.get('scope')!==allowedScopes||q.get('code_challenge_method')!=='S256'||q.get('access_type')!=='offline'||q.get('prompt')!=='consent select_account'||!q.get('client_id')?.endsWith('.apps.googleusercontent.com')||!/^[-_A-Za-z0-9]{43,128}$/.test(q.get('state'))||!/^[-_A-Za-z0-9]{43}$/.test(q.get('code_challenge')))throw Error();
    return url.href;
  }catch{throw Error('DRIVE_CONSENT_UNAVAILABLE');}
}
export function createOwnerDriveBackups({getAccess,service=null,redirectUri,onConsent}){
  if(typeof getAccess!=='function'||typeof onConsent!=='function')throw Error('BACKUP_SETTINGS_DEPENDENCIES_REQUIRED');
  let disposed=false,generation=0;
  const listeners=new Set();
  const blank=()=>({phase:scopeKey(getAccess())?'IDLE':'FORBIDDEN',connected:false,lastBackupAt:null,configured:Boolean(service),error:null});
  let state=Object.freeze(blank());
  const publish=patch=>{state=Object.freeze({...state,...patch});for(const fn of listeners)fn();};
  function reset(){generation++;state=Object.freeze(blank());for(const fn of listeners)fn();}
  async function run(action){
    const access=getAccess(),scope=scopeKey(access);
    if(disposed||!scope){if(!disposed)reset();return false;}
    if(state.phase==='BUSY')return false;
    if(!service){publish({phase:'UNAVAILABLE',error:'Google Drive backup service is not configured.'});return false;}
    const ticket=++generation;
    const current=()=>!disposed&&ticket===generation&&scopeKey(getAccess())===scope;
    publish({phase:'BUSY',error:null});
    try{
      // Hints route the request; backend MUST independently authorise active owner.
      const result=await action({clinicId:access.clinicId});
      if(!current())return false;
      if(result?.consentUrl){const url=validateDriveConsentUrl(result.consentUrl,redirectUri);publish({phase:'IDLE'});onConsent(url);return true;}
      if(!result||typeof result.connected!=='boolean'||(result.lastBackupAt!==null&&(!Number.isSafeInteger(result.lastBackupAt)||result.lastBackupAt<0)))throw Error();
      publish({phase:'READY',connected:result.connected,lastBackupAt:result.lastBackupAt});return true;
    }catch{if(current())publish({phase:'ERROR',error:'Backup action failed. Please retry or contact your administrator.'});return false;}
    finally{if(!disposed&&ticket===generation&&scopeKey(getAccess())!==scope)reset();}
  }
  return {
    getSnapshot:()=>state,
    subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},
    refresh:()=>run(input=>service.status(input)),
    connect:()=>run(input=>service.beginConnect(input)),
    disconnect:()=>run(input=>service.disconnect(input)),
    backupNow:()=>run(input=>service.backupNow(input)),
    invalidate:reset,
    dispose:()=>{disposed=true;generation++;listeners.clear();state=Object.freeze({phase:'DISPOSED',connected:false,lastBackupAt:null,configured:false,error:null});},
  };
}
