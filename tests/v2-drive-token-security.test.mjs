import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {sealDriveGrant,openDriveGrant} from '../scripts/lib/v2-drive-token-vault.mjs';
import {createGoogleDriveTokenTransport} from '../scripts/lib/v2-drive-google-tokens.mjs';
const key=randomBytes(32),key2=randomBytes(32),scope='https://www.googleapis.com/auth/drive.file';
const input={key,keyId:'vault-k1',userId:'u1',clinicId:'c1',revision:1,refreshToken:'SYNTHETIC_REFRESH_NOT_REAL'};
const seal=(extra={})=>sealDriveGrant({...input,...extra});
const open=(envelope,extra={})=>openDriveGrant({envelope,keys:new Map([['vault-k1',key]]),userId:'u1',clinicId:'c1',revision:1,...extra});
const bad=f=>assert.throws(f,/^Error: DRIVE_VAULT_INVALID$/);
test('vault encrypts grant with purpose and binding, never returns plaintext envelope',()=>{const e=seal();assert.ok(!JSON.stringify(e).includes(input.refreshToken));assert.deepEqual(open(e),{refreshToken:input.refreshToken,scope});});
test('vault uses fresh nonce per grant seal',()=>assert.notEqual(seal().ciphertext,seal().ciphertext));
for(const binding of [{userId:'other'},{clinicId:'other'},{revision:2}])test(`grant cannot move to another binding ${JSON.stringify(binding)}`,()=>bad(()=>open(seal(),binding)));
test('grant metadata cannot be edited even with matching supplied expectation',()=>{const e=seal();e.metadata.clinicId='other';bad(()=>open(e,{clinicId:'other'}));});
test('missing, wrong or retired vault key refused',()=>{bad(()=>open(seal(),{keys:new Map()}));bad(()=>open(seal(),{keys:new Map([['vault-k1',key2]])}));});
test('vault key rotation supported while explicitly retaining old key',()=>{const e=seal({key:key2,keyId:'vault-k2'});assert.equal(open(e,{keys:new Map([['vault-k2',key2]])}).refreshToken,input.refreshToken);});
test('corrupt tag/ciphertext and malformed encoding refused',()=>{for(const field of ['tag','iv','ciphertext']){const e=seal();e[field]='not-base64!';bad(()=>open(e));}});
test('plaintext extra fields and malformed grant metadata refused',()=>{const e=seal();e.refreshToken='LEAK';bad(()=>open(e));for(const extra of [{revision:0},{key:Buffer.alloc(1)},{refreshToken:'bad\nvalue'},{refreshToken:'x'.repeat(8193)}])bad(()=>seal(extra));});
const response=(extra={})=>({access_token:'SYNTHETIC_ACCESS',refresh_token:'SYNTHETIC_REFRESH',token_type:'Bearer',expires_in:3600,scope,...extra});
function transport({data=response(),status=200,failFetch=false}={}){const calls=[];const t=createGoogleDriveTokenTransport({clock:()=>1000,getClientCredentials:async()=>({clientId:'fixture.apps.googleusercontent.com',clientSecret:'SYNTHETIC_SECRET'}),fetchImpl:async(url,options)=>{calls.push({url,options});if(failFetch)throw Error('DO_NOT_EXPOSE_TOKEN');return new Response(JSON.stringify(data),{status});}});return {t,calls};}
const codeInput={code:'SYNTHETIC_CODE',verifier:'a'.repeat(43),redirectUri:'https://clinic.example/callback'};
const reject=fn=>assert.rejects(fn,/^Error: GOOGLE_DRIVE_TOKEN_FAILED$/);
test('code exchange posts credentials and PKCE in body only to pinned Google endpoint',async()=>{const {t,calls}=transport(),r=await t.exchange(codeInput),c=calls[0];assert.equal(c.url,'https://oauth2.googleapis.com/token');assert.equal(c.options.method,'POST');assert.equal(c.options.redirect,'error');assert.equal(c.options.body.get('code_verifier'),codeInput.verifier);assert.equal(c.options.body.get('client_secret'),'SYNTHETIC_SECRET');assert.equal(r.expiresAt,3601000);assert.deepEqual(r.grantedScopes,[scope]);});
test('refresh omits unrelated grants and accepts omitted unchanged scope',async()=>{const {t,calls}=transport({data:response({scope:undefined,refresh_token:undefined})}),r=await t.refresh({refreshToken:input.refreshToken});assert.equal(calls[0].options.body.get('grant_type'),'refresh_token');assert.deepEqual(r.grantedScopes,[scope]);assert.equal(r.refreshToken,undefined);});
test('refresh returns rotation token only when provided',async()=>{const {t}=transport();assert.equal((await t.refresh({refreshToken:'fixture'})).refreshToken,'SYNTHETIC_REFRESH');});
for(const data of [response({scope:'https://www.googleapis.com/auth/drive'}),response({scope:scope+' email'}),response({scope:undefined}),response({refresh_token:undefined}),response({expires_in:0}),response({expires_in:'3600'}),response({token_type:'Other'}),response({access_token:'bad\r\nvalue'})])test(`invalid exchange response refused ${Object.keys(data).join(',')} ${JSON.stringify(data).length}`,async()=>{const {t}=transport({data});await reject(()=>t.exchange(codeInput));});
test('provider 400/401/403 and network errors are sanitized',async()=>{for(const options of [{status:400},{status:401},{status:403},{failFetch:true}])await reject(()=>transport(options).t.exchange(codeInput));});
test('invalid callback URI/verifier/code are refused before network',async()=>{for(const extra of [{redirectUri:'http://clinic.example/callback'},{redirectUri:'https://clinic.example/callback?next=evil'},{verifier:'short'},{code:'bad\nvalue'}]){const {t,calls}=transport();await reject(()=>t.exchange({...codeInput,...extra}));assert.equal(calls.length,0);}});
test('malformed and oversized token response bodies refused',async()=>{for(const body of ['not-json','x'.repeat(16385)]){const t=createGoogleDriveTokenTransport({getClientCredentials:async()=>({clientId:'fixture.apps.googleusercontent.com',clientSecret:'fixture'}),fetchImpl:async()=>new Response(body)});await reject(()=>t.exchange(codeInput));}});
test('callback exchange to vault integration keeps access token out of persisted envelope',async()=>{const {t}=transport(),r=await t.exchange(codeInput);const e=seal({refreshToken:r.refreshToken});assert.ok(!JSON.stringify(e).includes(r.accessToken));assert.ok(!JSON.stringify(e).includes(r.refreshToken));assert.equal(open(e).refreshToken,r.refreshToken);});

const {createDriveAccessTokenProvider}=await import('../scripts/lib/v2-drive-access-token.mjs');
function providerFixture({rotate=false,disconnect=false,cas=false}={}){
  let record={userId:'u1',clinicId:'c1',revision:1,enabled:true,envelope:seal()},writes=0;
  const provider=createDriveAccessTokenProvider({clinicId:'c1',keys:new Map([['vault-k1',key],['vault-k2',key2]]),activeKeyId:'vault-k2',repository:{readAuthorizedConnection:async()=>record,replaceGrantIfCurrent:async p=>{writes++;if(!cas)return false;record={...record,revision:p.nextRevision,envelope:p.envelope};return true;}},transport:{refresh:async()=>{if(disconnect)record.enabled=false;return {accessToken:'SYNTHETIC_SHORT_TOKEN',grantedScopes:[scope],...(rotate?{refreshToken:'SYNTHETIC_ROTATED'}:{})};}}});
  return {provider,getRecord:()=>record,getWrites:()=>writes};
}
test('token provider decrypts only on backend and returns short-lived access token',async()=>{const f=providerFixture();assert.equal(await f.provider(),'SYNTHETIC_SHORT_TOKEN');assert.equal(f.getWrites(),0);});
test('disconnect during refresh fences token release even when repository mutates same object',async()=>{const f=providerFixture({disconnect:true});await assert.rejects(()=>f.provider(),/^Error: DRIVE_CONNECTION_UNAVAILABLE$/);});
test('rotated refresh token encrypted under active key and conditionally persisted before release',async()=>{const f=providerFixture({rotate:true,cas:true});assert.equal(await f.provider(),'SYNTHETIC_SHORT_TOKEN');const r=f.getRecord();assert.equal(r.revision,2);assert.equal(r.envelope.metadata.keyId,'vault-k2');assert.equal(open(r.envelope,{keys:new Map([['vault-k2',key2]]),revision:2}).refreshToken,'SYNTHETIC_ROTATED');assert.ok(!JSON.stringify(r).includes('SYNTHETIC_ROTATED'));});
test('rotation conflict fails closed rather than dropping new grant token',async()=>{const f=providerFixture({rotate:true,cas:false});await assert.rejects(()=>f.provider(),/^Error: DRIVE_CONNECTION_UNAVAILABLE$/);assert.equal(f.getRecord().revision,1);});
