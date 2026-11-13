#!/usr/bin/env node
// No real telemetry input. Demonstrates fail-closed policy with synthetic data.
import {evaluateOperations,DEFAULT_POLICY} from './lib/v2-ops-status.mjs';
if(process.argv.length>2){console.error('Synthetic operations drill accepts no arguments.');process.exitCode=2;}
else{
  try{
    const now=Date.parse('2026-01-10T00:00:00.000Z');
    const fresh={lastSuccessAt:now,lastAttemptAt:now,lastAttemptOk:true};
    const healthy={now,project:'clinical',backup:fresh,probe:fresh,sync:fresh,restore:fresh,capacity:{measuredAt:now,bytes:13000000}};
    const cases=[
      {name:'fresh',input:healthy,expected:'OK'},
      {name:'missing_restore_evidence',input:{...healthy,restore:null},expected:'UNKNOWN'},
      {name:'missed_backup',input:{...healthy,backup:{lastSuccessAt:now-DEFAULT_POLICY.backupMaxAgeMs-1,lastAttemptAt:now-DEFAULT_POLICY.backupMaxAgeMs-1,lastAttemptOk:true}},expected:'ALERT'},
      {name:'failed_probe',input:{...healthy,probe:{lastSuccessAt:now-1,lastAttemptAt:now,lastAttemptOk:false}},expected:'ALERT'},
      {name:'capacity_warning',input:{...healthy,capacity:{measuredAt:now,bytes:400000000}},expected:'ALERT'},
    ];
    const results=cases.map(c=>({name:c.name,status:evaluateOperations(c.input).status,expected:c.expected}));
    if(results.some(r=>r.status!==r.expected))throw Error();
    console.log(JSON.stringify({mode:'SYNTHETIC_POLICY_ONLY',ok:true,results,networkRequests:0,alertsDelivered:0,note:'No scheduler, measurement, notification, live evidence or activation.'},null,2));
  }catch{console.error('OPS_SYNTHETIC_DRILL_FAILED');process.exitCode=1;}
}
