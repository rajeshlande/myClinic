// Local synthetic harness. Deliberately serves only an allowlisted module set.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../../', import.meta.url));
const own = fileURLToPath(new URL('.', import.meta.url));
const modules = new Set(['offline.js','tenant-client.mjs','workspace-persistence.mjs','workspace-operations.mjs',
  'workspace-controller.mjs','workspace-storage.mjs','workspace-boot.mjs','workspace-lifecycle.mjs','workspace-recovery.mjs','workspace-replay.mjs','workspace-outbox.mjs','workspace-loader.mjs','branch-config.mjs','branch-scope.mjs','staff-branch.mjs','plans.mjs','workspace-conflict-comparison.mjs','workspace-conflict-panel.mjs','workspace-conflicts.mjs','workspace-store.mjs','workspace-writes.mjs','license.mjs','permissions.js','validation.mjs','dates.mjs','token-policy.mjs','queue.mjs']);
http.createServer(async (request,response) => {
  const path = new URL(request.url, 'http://harness.invalid').pathname;
  response.setHeader('Cache-Control','no-store');
  response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'");
  try {
    if (path === '/') {
      response.setHeader('Content-Type','text/html');
      response.end('<!doctype html><html lang="en"><title>Synthetic workspace browser checks</title><h1>Synthetic workspace browser checks</h1><p>Local test harness only. No live clinic, login, patient data or database connection.</p><p id="status">Loading test modules…</p><script type="module" src="/harness.mjs"></script></html>');
      return;
    }
    if (path === '/contract/tier-contract.json') { response.setHeader('Content-Type','application/json'); response.end(await readFile(`${repo}contract/tier-contract.json`)); return; }
    let file;
    if (path === '/harness.mjs') file = `${own}harness.mjs`;
    else if (path.startsWith('/modules/') && modules.has(path.slice(9))) file = `${repo}src/lib/${path.slice(9)}`;
    else { response.writeHead(404); response.end('Not found'); return; }
    response.setHeader('Content-Type','text/javascript');
    response.end(await readFile(file));
  } catch { response.writeHead(500); response.end('Harness read failed'); }
}).listen(4174,'0.0.0.0',()=>console.log('Synthetic workspace browser harness listening on 4174'));
