import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateOperations,DEFAULT_POLICY} from '../scripts/lib/v2-ops-status.mjs';
const now=100*86400000;
const success=at=>({lastSuccessAt:at,lastAttemptAt:at,lastAttemptOk:true});
const fixture=()=>({now,project:'clinical',backup:success(now),probe:success(now),sync:success(now),restore:success(now),capacity:{measuredAt:now,bytes:13*1000000}});
const invalid=f=>assert.throws(f,/^Error: OPS_STATUS_INVALID_INPUT$/);
test('fresh evidence yields OK without changing input',()=>{const f=fixture(),before=structuredClone(f),r=evaluateOperations(f);assert.equal(r.status,'OK');assert.equal(r.checks.length,5);assert.deepEqual(f,before);});
test('missing evidence is UNKNOWN, never a green completion',()=>{const f=fixture();for(const k of ['backup','probe','sync','restore','capacity'])f[k]=null;const r=evaluateOperations(f);assert.equal(r.status,'UNKNOWN');assert.ok(r.checks.every(c=>c.code==='NO_EVIDENCE'));});
for(const [field,limit] of [['backup','backupMaxAgeMs'],['probe','probeMaxAgeMs'],['sync','syncMaxAgeMs'],['restore','restoreMaxAgeMs']]){
  test(`${field} is OK exactly at age target, alerts one millisecond later`,()=>{const f=fixture();f[field]=success(now-DEFAULT_POLICY[limit]);assert.equal(evaluateOperations(f).status,'OK');f[field]=success(now-DEFAULT_POLICY[limit]-1);assert.equal(evaluateOperations(f).status,'ALERT');});
  test(`${field} latest failed attempt beats older successful result`,()=>{const f=fixture();f[field]={lastSuccessAt:now-1,lastAttemptAt:now,lastAttemptOk:false};const r=evaluateOperations(f);assert.equal(r.status,'ALERT');assert.ok(r.checks.some(c=>c.code==='LATEST_ATTEMPT_FAILED'));});
}
test('first failed attempt with no success alerts',()=>{const f=fixture();f.backup={lastSuccessAt:null,lastAttemptAt:now,lastAttemptOk:false};assert.equal(evaluateOperations(f).status,'ALERT');});
test('400 decimal MB threshold warns inclusively, does not mutate flags',()=>{const f=fixture();f.capacity.bytes=400000000-1;assert.equal(evaluateOperations(f).status,'OK');f.capacity.bytes++;const r=evaluateOperations(f);assert.equal(r.status,'ALERT');assert.equal(r.checks.at(-1).code,'WARNING_THRESHOLD_REACHED');assert.ok(!Object.hasOwn(r,'accessEnabled'));});
test('old low capacity sample cannot conceal growth',()=>{const f=fixture();f.capacity.measuredAt=now-DEFAULT_POLICY.backupMaxAgeMs-1;assert.equal(evaluateOperations(f).checks.at(-1).code,'MEASUREMENT_OVERDUE');});
test('alerts dominate unknown evidence',()=>{const f=fixture();f.restore=null;f.capacity.bytes=400000000;assert.equal(evaluateOperations(f).status,'ALERT');});
test('unknown evidence dominates otherwise healthy checks',()=>{const f=fixture();f.restore=null;assert.equal(evaluateOperations(f).status,'UNKNOWN');});
test('future times, NaN, negatives and undefined input refused',()=>{for(const v of [now+1,NaN,-1,undefined]){const f=fixture();f.probe.lastAttemptAt=v;invalid(()=>evaluateOperations(f));}});
test('success cannot predate attempt or occur after latest attempt',()=>{for(const v of [now-1,now+1,null]){const f=fixture();f.backup.lastSuccessAt=v;invalid(()=>evaluateOperations(f));}});
test('raw credential and error fields are refused without echo',()=>{const f=fixture();f.probe.error='DO_NOT_LOG_PRIVATE';invalid(()=>evaluateOperations(f));});
test('invalid project, time and policy refused',()=>{for(const extra of [{project:'legacy'},{now:-1},{now:NaN},{policy:{unknown:1}},{policy:{syncMaxAgeMs:0}},{policy:{probeMaxAgeMs:Infinity}}])invalid(()=>evaluateOperations({...fixture(),...extra}));});
test('reviewed custom thresholds are explicit and deterministic',()=>{const f=fixture();f.sync=success(now-2);const policy={syncMaxAgeMs:1};assert.equal(evaluateOperations({...f,policy}).status,'ALERT');assert.deepEqual(evaluateOperations({...f,policy}),evaluateOperations({...f,policy}));});
test('invalid capacity data refused',()=>{for(const bytes of [-1,Infinity,'13000000',1.5]){const f=fixture();f.capacity.bytes=bytes;invalid(()=>evaluateOperations(f));}});
test('defaults are frozen and unchanged after override',()=>{assert.ok(Object.isFrozen(DEFAULT_POLICY));evaluateOperations({...fixture(),policy:{capacityWarningBytes:1}});assert.equal(DEFAULT_POLICY.capacityWarningBytes,400000000);});
