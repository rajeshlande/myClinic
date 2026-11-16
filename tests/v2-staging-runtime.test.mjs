import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stagingConfig,createStagingRuntime,STAGING_MASTER} from '../src/lib/v2-staging-runtime.mjs';
const env={VITE_CENTRAL_SUPABASE_URL:STAGING_MASTER,VITE_CENTRAL_SUPABASE_ANON_KEY:'sb_publishable_synthetic_only'};
test('staging missing config refuses before constructing any client',()=>{
 let calls=0;assert.throws(()=>createStagingRuntime({env:{},createClient(){calls++;}}),/STAGING_CONFIG_REQUIRED/);assert.equal(calls,0);
});
test('staging pins Central origin and excludes old clinical/static env',()=>{
 for(const url of ['https://nosqdnmnztsikfygyiqa.supabase.co',STAGING_MASTER+'/',STAGING_MASTER+'/path','http://localhost'])assert.equal(stagingConfig({...env,VITE_CENTRAL_SUPABASE_URL:url}).ok,false);
 assert.equal(stagingConfig({VITE_SUPABASE_URL:STAGING_MASTER,VITE_SUPABASE_ANON_KEY:env.VITE_CENTRAL_SUPABASE_ANON_KEY}).ok,false);
 assert.equal(stagingConfig(env).ok,true);
});
test('new Central mapping rejects previous Central URL and previous project anon JWT',()=>{
 assert.equal(STAGING_MASTER,'https://yzgwrnqlugyrzqymzmps.supabase.co');
 assert.equal(stagingConfig({...env,VITE_CENTRAL_SUPABASE_URL:'https://inaqzvzfongngahxptzw.supabase.co'}).ok,false);
 const jwt=(ref,role='anon')=>'synthetic.'+Buffer.from(JSON.stringify({ref,role})).toString('base64url')+'.synthetic';
 assert.equal(stagingConfig({...env,VITE_CENTRAL_SUPABASE_ANON_KEY:jwt('yzgwrnqlugyrzqymzmps')}).ok,true);
 assert.equal(stagingConfig({...env,VITE_CENTRAL_SUPABASE_ANON_KEY:jwt('inaqzvzfongngahxptzw')}).ok,false);
 assert.equal(stagingConfig({...env,VITE_CENTRAL_SUPABASE_ANON_KEY:jwt('yzgwrnqlugyrzqymzmps','service_role')}).ok,false);
});
test('staging rejects privileged and malformed public key shapes',()=>{
 for(const key of ['sb_secret_example','service_role','abc','','a.e30.c'])assert.equal(stagingConfig({...env,VITE_CENTRAL_SUPABASE_ANON_KEY:key}).ok,false);
});
function fixture({boot={},loginError=false}={}){
 const calls=[];let user=null;let callback;
 const master={auth:{onAuthStateChange(fn){callback=fn;return {data:{subscription:{unsubscribe(){calls.push('unsubscribe');}}}};},
 async getUser(){calls.push('getUser');return {data:{user}};},
 async signInWithPassword(){calls.push('signIn');if(loginError)return {error:new Error('sensitive provider text')};user={id:'synthetic-user'};return {data:{user}};},
 async signOut(options){calls.push(['signOut',options]);user=null;callback('SIGNED_OUT',null);return {};}
 },async rpc(name){calls.push(name);return {data:boot};},functions:{async invoke(){throw Error('not expected');}}};
 const runtime=createStagingRuntime({env,createClient(url,key,options){calls.push({url,options});return master;},mountClinicalClient(){throw Error('not expected');}});
 return {runtime,calls};
}
test('constructing staging makes no auth/RPC call and explicitly disables persistence, redirects and refresh',async()=>{
 const {runtime,calls}=fixture();assert.equal(calls.length,1);assert.deepEqual(calls[0].options.auth,{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,storageKey:'myclinic.staging.memory'});assert.equal(runtime.controller.getSnapshot().state,'SIGNED_OUT');await runtime.close();assert.deepEqual(calls.find(x=>Array.isArray(x)),['signOut',{scope:'local'}]);
});
test('explicit synthetic login runs existing boot and stays not ready for old response',async()=>{
 const {runtime,calls}=fixture();await runtime.signIn('synthetic@example.invalid','test-only');assert.equal(runtime.controller.getSnapshot().state,'NOT_READY');assert.ok(calls.includes('sync_clinic_subscription'));assert.throws(()=>runtime.controller.getClinicalClient());await runtime.close();
});
test('reviewed dynamic destination and workspace reach controlled picker without a clinical request',async()=>{
 const {runtime}=fixture({boot:{workspaces:[{workspace_id:'synthetic-workspace',clinic_id:'synthetic-clinic',tenant_slug:'synthetic',member_role:'owner',ready:true,licence:{status:'active',can_write:true}}],clinical:{clinical_url:'https://kvxmcdezpozkvdmvmicr.supabase.co',clinical_publishable_key:'synthetic-public-only'}}});
 await runtime.signIn('synthetic@example.invalid','test-only');assert.equal(runtime.controller.getSnapshot().state,'CHOOSE_WORKSPACE');assert.throws(()=>runtime.controller.getClinicalClient());await runtime.close();
});
test('wrong clinical destination from Central blocks boot before mint or clinical mount',async()=>{
 for(const url of ['https://nosqdnmnztsikfygyiqa.supabase.co','https://unreviewed.example']) {
  const {runtime}=fixture({boot:{clinical:{clinical_url:url,clinical_publishable_key:'synthetic-public-only'}}});
  await runtime.signIn('synthetic@example.invalid','test-only');assert.equal(runtime.controller.getSnapshot().state,'ERROR');assert.equal(runtime.controller.getSnapshot().errorCode,'BOOT_FAILED');await runtime.close();
 }
});
test('provider errors are sanitized and no boot/fallback occurs',async()=>{
 const {runtime,calls}=fixture({loginError:true});await assert.rejects(runtime.signIn('synthetic@example.invalid','test-only'),/^Error: STAGING_SIGN_IN_REFUSED$/);assert.ok(!calls.includes('sync_clinic_subscription'));await runtime.close();
});
test('logout uses local scope and no shared browser storage is supplied',async()=>{
 const {runtime,calls}=fixture();await runtime.controller.logout();assert.deepEqual(calls.find(x=>Array.isArray(x)),['signOut',{scope:'local'}]);await runtime.close();
});
test('separate staging composition excludes legacy app/store/SW and legacy entry remains unchanged',()=>{
 const entry=readFileSync(new URL('../src/v2-staging.jsx',import.meta.url),'utf8');
 for(const forbidden of ["'./App.jsx'","'./lib/auth-context.jsx'","'./lib/store.jsx'",'localStorage','sessionStorage','serviceWorker.register'])assert.ok(!entry.includes(forbidden));
 assert.match(entry,/WorkspaceGate/);assert.match(entry,/No clinical query or write/);
 const main=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');assert.ok(!main.includes('v2-staging'));
 const vite=readFileSync(new URL('../vite.config.js',import.meta.url),'utf8');assert.match(vite,/staging: 'v2-staging.html'/);
});
