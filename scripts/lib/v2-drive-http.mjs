// Framework-neutral server Request/Response boundary. No listener or deployment.
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(v);
const summary=v=>v&&typeof v.connected==='boolean'&&(v.lastBackupAt===null||(Number.isSafeInteger(v.lastBackupAt)&&v.lastBackupAt>=0))?{connected:v.connected,lastBackupAt:v.lastBackupAt}:null;
const jobSummary=v=>{
  const statuses=['QUEUED','RUNNING','STAGED','COMPLETED','CANCELLED'];
  if(!v||!id(v.jobId)||!statuses.includes(v.status)||!Number.isSafeInteger(v.createdAt)||v.createdAt<0||(v.finishedAt!==null&&(!Number.isSafeInteger(v.finishedAt)||v.finishedAt<v.createdAt))||(v.status==='COMPLETED'&&v.finishedAt===null))return null;
  return {jobId:v.jobId,status:v.status,createdAt:v.createdAt,finishedAt:v.finishedAt};
};
export function createDriveBackupHandler({publicOrigin,verifySession,resolveOwner,verifyCsrf,admitRequest,oauth,resolveCallbackClinic,readStatus,requestBackup,readLatestJob=null,readJobStatus=null,readOverview=null}){
  const base=new URL(publicOrigin);
  if(base.origin!==publicOrigin||base.protocol!=='https:'||![verifySession,resolveOwner,verifyCsrf,admitRequest,resolveCallbackClinic,readStatus,requestBackup].every(f=>typeof f==='function')||!['begin','complete','disconnect'].every(k=>typeof oauth?.[k]==='function'))throw Error('DRIVE_HTTP_CONFIGURATION_REQUIRED');
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Pragma':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"};
  const response=(status,body)=>new Response(JSON.stringify(body),{status,headers});
  const error=status=>response(status,{error:status===401?'AUTHENTICATION_REQUIRED':status===403?'OWNER_ACTION_REFUSED':status===429?'TRY_LATER':'BACKUP_ACTION_UNAVAILABLE'});
  async function owner(session,clinicId){const a=await resolveOwner(session,clinicId);return a&&a.active===true&&a.role==='owner'&&id(a.userId)&&a.clinicId===clinicId;}
  return async request=>{
    try{
      const u=new URL(request.url);
      if(u.origin!==publicOrigin)return error(403);
      const callback=u.pathname==='/v2/drive/callback';
      const match=u.pathname.match(/^\/v2\/clinics\/([A-Za-z0-9][A-Za-z0-9_-]{0,95})\/drive-backup(?:\/(connect|disconnect|backup|overview))?$/);
      const jobMatch=u.pathname.match(/^\/v2\/clinics\/([A-Za-z0-9][A-Za-z0-9_-]{0,95})\/drive-backup\/jobs\/([A-Za-z0-9][A-Za-z0-9_-]{0,95})$/);
      if(!callback&&!match&&!jobMatch)return response(404,{error:'NOT_FOUND'});
      const action=callback?'callback':jobMatch?'job':match[2]??'status';
      if(request.method!==(['callback','status','job','overview'].includes(action)?'GET':'POST'))return response(405,{error:'METHOD_NOT_ALLOWED'});
      if(!callback&&u.search)return error(400);
      const session=await verifySession(request);if(!session)return error(401);
      if(await admitRequest(session,action)!==true)return error(429);
      if(callback){
        // Google redirect has no same-origin POST/CSRF header. Signed-in session,
        // unguessable single-use state and owner/clinic binding are mandatory.
        if([...u.searchParams.keys()].some(k=>!['code','state','scope','authuser','prompt','error','error_description'].includes(k)))return error(400);
        if(u.searchParams.getAll('state').length!==1||u.searchParams.getAll('code').length!==1||u.searchParams.has('error'))return error(400);
        const state=u.searchParams.get('state'),code=u.searchParams.get('code');
        if(!/^[-_A-Za-z0-9]{43}$/.test(state)||!code||code.length>4096||/[\r\n]/.test(code))return error(400);
        const clinicId=await resolveCallbackClinic(session,state);if(!id(clinicId)||!await owner(session,clinicId))return error(403);
        const result=await oauth.complete({session,clinicId,state,code});if(!summary(result)?.connected)return error(503);
        // Fixed route only; never reflect query/return URL/token into redirect.
        return new Response(null,{status:303,headers:{...headers,Location:`${publicOrigin}/#/settings?tab=backups`}});
      }
      const clinicId=(jobMatch??match)[1];if(!await owner(session,clinicId))return error(403);
      if(action==='job'){
        const latest=jobMatch[2]==='latest',reader=latest?readLatestJob:readJobStatus;
        if(typeof reader!=='function')return error(503);
        const result=await reader({session,clinicId,...(latest?{}:{jobId:jobMatch[2]})});
        if(latest&&result===null)return response(200,{job:null});
        const safe=jobSummary(result);return safe?response(200,{job:safe}):error(503);
      }
      if(action==='overview'){
        if(typeof readOverview!=='function')return error(503);
        const result=await readOverview({session,clinicId}),safe=summary(result),job=result?.job===null?null:jobSummary(result?.job);
        return safe&&(result.job===null||job)?response(200,{...safe,job}):error(503);
      }
      if(action!=='status'){
        if(request.headers.get('origin')!==publicOrigin||request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return error(403);
        const csrf=request.headers.get('x-clinic-csrf');
        if(!csrf||csrf.length>256||/[\r\n]/.test(csrf)||await verifyCsrf(session,csrf)!==true)return error(403);
        // No caller-provided identity/role/token/target accepted in action bodies.
        const reader=request.body?.getReader();let body='';
        if(reader){try{let count=0;const chunks=[];for(;;){const r=await reader.read();if(r.done)break;if((count+=r.value.length)>1024)return error(413);chunks.push(Buffer.from(r.value));}body=Buffer.concat(chunks).toString('utf8');}finally{try{await reader.cancel();}catch{}reader.releaseLock();}}
        if(body!==''&&body.trim()!=='{}')return error(400);
      }
      if(action==='connect'){
        const r=await oauth.begin({session,clinicId});
        if(typeof r?.consentUrl!=='string'||r.consentUrl.length>8192)return error(503);
        // Strict consent URL validation also runs in browser controller.
        return response(200,{consentUrl:r.consentUrl});
      }
      if(action==='backup'){
        // Enqueue is NOT completion. Owner UI must explicitly show pending state.
        const result=await requestBackup({session,clinicId});
        if(!result||!id(result.jobId)||!['QUEUED','RUNNING','STAGED'].includes(result.status))return error(503);
        return response(202,{jobId:result.jobId,status:result.status});
      }
      const result=action==='disconnect'?await oauth.disconnect({session,clinicId}):await readStatus({session,clinicId});
      const safe=summary(result);return safe?response(200,safe):error(503);
    }catch{return error(503);}
  };
}
