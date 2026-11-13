#!/usr/bin/env node
/** One-shot synthetic runner: owns and stops its local server. No account keys. */
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const cwd=fileURLToPath(new URL('.',import.meta.url));
const server=spawn(process.execPath,['server.mjs'],{cwd,stdio:['ignore','pipe','pipe']});
try{
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>finish(new Error('Synthetic server startup timed out')),10000);
    function finish(error){clearTimeout(timer);server.stdout.off('data',onData);server.off('exit',onExit);server.off('error',onError);error?reject(error):resolve();}
    function onData(data){if(String(data).includes('listening on 4174'))finish();}
    function onExit(){finish(new Error('Synthetic server could not start; check port4174'));}
    function onError(){finish(new Error('Synthetic server process unavailable'));}
    server.stdout.on('data',onData);server.once('exit',onExit);server.once('error',onError);
  });
  const status=await new Promise((resolve,reject)=>{
    const test=spawn(process.execPath,['verify-browser.mjs'],{cwd,stdio:'inherit',env:{...process.env,RESULT_FILE:process.env.RESULT_FILE??'local-browser-results.json'}});
    test.once('error',reject);test.once('exit',code=>resolve(code??1));
  });
  process.exitCode=status;
}catch{console.error('Synthetic browser checks could not run. Check dependencies, Chromium installation and port4174.');process.exitCode=1;}
finally{server.kill();}
