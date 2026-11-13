// Server-only Google OAuth HTTP transport. No credential persistence or logs.
const SCOPE='https://www.googleapis.com/auth/drive.file';
const fail=()=>{throw Error('GOOGLE_DRIVE_TOKEN_FAILED');};
const text=v=>typeof v==='string'&&v.length>0&&v.length<=8192&&!/[\r\n]/.test(v);
async function jsonBody(r){
  const length=r.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>16384))fail();
  const reader=r.body?.getReader();if(!reader)fail();const parts=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;if((size+=value.length)>16384)fail();parts.push(Buffer.from(value));}return JSON.parse(Buffer.concat(parts).toString('utf8'));}
  finally{try{await reader.cancel();}catch{/* sanitized */}reader.releaseLock();}
}
export function createGoogleDriveTokenTransport({getClientCredentials,fetchImpl=globalThis.fetch,clock=Date.now}){
  if(typeof getClientCredentials!=='function'||typeof fetchImpl!=='function'||typeof clock!=='function')throw Error('GOOGLE_DRIVE_TOKEN_CONFIGURATION_REQUIRED');
  async function exchangeForm(fields,{requireRefresh}){
    const credentials=await getClientCredentials();
    if(!credentials||typeof credentials.clientId!=='string'||!/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(credentials.clientId)||!text(credentials.clientSecret))fail();
    const body=new URLSearchParams({...fields,client_id:credentials.clientId,client_secret:credentials.clientSecret});
    const r=await fetchImpl('https://oauth2.googleapis.com/token',{method:'POST',body,headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(!r.ok)fail();const p=await jsonBody(r);
    if(!text(p.access_token)||p.token_type!=='Bearer'||!Number.isSafeInteger(p.expires_in)||p.expires_in<1||p.expires_in>86400)fail();
    // Google refresh responses may omit unchanged scopes; only inherit the
    // previously verified drive.file grant, never infer broad account authority.
    const scopes=p.scope===undefined&&!requireRefresh?[SCOPE]:typeof p.scope==='string'?p.scope.split(/\s+/).filter(Boolean):[];
    if(scopes.length!==1||scopes[0]!==SCOPE||(requireRefresh&&!text(p.refresh_token))||(p.refresh_token!==undefined&&!text(p.refresh_token)))fail();
    const now=clock();if(!Number.isSafeInteger(now)||now<0||!Number.isSafeInteger(now+p.expires_in*1000))fail();
    return {accessToken:p.access_token,expiresAt:now+p.expires_in*1000,grantedScopes:scopes,...(p.refresh_token===undefined?{}:{refreshToken:p.refresh_token})};
  }
  return {
    async exchange({code,verifier,redirectUri}){
      try{
        if(!text(code)||code.length>4096||typeof verifier!=='string'||!/^[-_A-Za-z0-9]{43,128}$/.test(verifier))fail();
        const u=new URL(redirectUri);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)fail();
        return await exchangeForm({grant_type:'authorization_code',code,code_verifier:verifier,redirect_uri:redirectUri},{requireRefresh:true});
      }catch{fail();}
    },
    async refresh({refreshToken}){
      try{if(!text(refreshToken))fail();return await exchangeForm({grant_type:'refresh_token',refresh_token:refreshToken},{requireRefresh:false});}catch{fail();}
    },
  };
}
