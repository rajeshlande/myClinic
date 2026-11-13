import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mountWorkspaceConflictPanel} from '../src/lib/workspace-conflict-panel.mjs';
test('standalone panel imports without DOM/network and refuses absent dependencies',()=>{
 assert.equal(typeof mountWorkspaceConflictPanel,'function');
 assert.throws(()=>mountWorkspaceConflictPanel(),/review panel dependencies required/);
});
test('live entrypoints do not mount the staged conflict panel',()=>{
 for(const path of ['src/App.jsx','src/main.jsx','src/lib/store.jsx'])assert.ok(!readFileSync(path,'utf8').includes('workspace-conflict-panel'));
});
test('downloaded browser harness resolves application paths relative to repository',()=>{
 const source=readFileSync('tools/workspace-browser/server.mjs','utf8');
 assert.ok(source.includes("new URL('../../', import.meta.url)"));
 assert.ok(!source.includes('/home/user/'));
});
