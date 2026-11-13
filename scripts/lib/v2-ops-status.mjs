// Operator-only policy evaluator. No database, network, credentials or alert delivery.
const HOUR=3600000;
const exact=(o,ks)=>o&&Object.getPrototypeOf(o)===Object.prototype&&Object.keys(o).sort().join('|')===[...ks].sort().join('|');
const time=(v,now)=>Number.isSafeInteger(v)&&v>=0&&v<=now;
const fail=()=>{throw Error('OPS_STATUS_INVALID_INPUT');};
export const DEFAULT_POLICY=Object.freeze({backupMaxAgeMs:24*HOUR,probeMaxAgeMs:72*HOUR,syncMaxAgeMs:HOUR,restoreMaxAgeMs:30*24*HOUR,capacityWarningBytes:400*1000*1000});
export function evaluateOperations({now,project,backup,probe,sync,restore,capacity,policy={}}){
  try{
    if(!Number.isSafeInteger(now)||now<0||!['master','clinical'].includes(project)||!exact(policy,Object.keys(policy))||Object.keys(policy).some(k=>!Object.hasOwn(DEFAULT_POLICY,k)))fail();
    const limits={...DEFAULT_POLICY,...policy};
    if(Object.values(limits).some(v=>!Number.isSafeInteger(v)||v<1))fail();
    const checks=[];
    function ageCheck(name,observation,maxAge){
      if(observation===null){checks.push({check:name,status:'UNKNOWN',code:'NO_EVIDENCE'});return;}
      if(!exact(observation,['lastSuccessAt','lastAttemptAt','lastAttemptOk'])||typeof observation.lastAttemptOk!=='boolean'||!time(observation.lastAttemptAt,now)||(observation.lastSuccessAt!==null&&!time(observation.lastSuccessAt,observation.lastAttemptAt))||(observation.lastAttemptOk&&observation.lastSuccessAt!==observation.lastAttemptAt))fail();
      if(!observation.lastAttemptOk){checks.push({check:name,status:'ALERT',code:'LATEST_ATTEMPT_FAILED'});return;}
      if(observation.lastSuccessAt===null){checks.push({check:name,status:'UNKNOWN',code:'NO_SUCCESS'});return;}
      const ageMs=now-observation.lastSuccessAt;
      checks.push({check:name,status:ageMs>maxAge?'ALERT':'OK',code:ageMs>maxAge?'OVERDUE':'WITHIN_TARGET',ageMs,maxAgeMs:maxAge});
    }
    ageCheck('backup',backup,limits.backupMaxAgeMs);
    ageCheck('database_probe',probe,limits.probeMaxAgeMs);
    ageCheck('membership_sync',sync,limits.syncMaxAgeMs);
    ageCheck('restore_drill',restore,limits.restoreMaxAgeMs);
    if(capacity===null)checks.push({check:'database_capacity',status:'UNKNOWN',code:'NO_EVIDENCE'});
    else{
      if(!exact(capacity,['measuredAt','bytes'])||!time(capacity.measuredAt,now)||!Number.isSafeInteger(capacity.bytes)||capacity.bytes<0)fail();
      const stale=now-capacity.measuredAt>limits.backupMaxAgeMs;
      checks.push({check:'database_capacity',status:stale||capacity.bytes>=limits.capacityWarningBytes?'ALERT':'OK',code:stale?'MEASUREMENT_OVERDUE':capacity.bytes>=limits.capacityWarningBytes?'WARNING_THRESHOLD_REACHED':'BELOW_WARNING_THRESHOLD',bytes:capacity.bytes,warningBytes:limits.capacityWarningBytes});
    }
    return {project,evaluatedAt:now,status:checks.some(c=>c.status==='ALERT')?'ALERT':checks.some(c=>c.status==='UNKNOWN')?'UNKNOWN':'OK',checks,note:'Policy result only. Not an uptime, backup integrity, quota or restore guarantee. No flags changed.'};
  }catch{fail();}
}
