import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {releaseTarget,guardedEntryPlugin} from '../scripts/lib/v2-entry-policy.mjs';
test('unknown release targets refuse instead of falling back',()=>{
 assert.equal(releaseTarget(''),'legacy');assert.equal(releaseTarget('v2-staging'),'v2-staging');assert.throws(()=>releaseTarget('v2-stagin'));
});
test('staging root transforms before module discovery and cannot mount main',()=>{
 const plugin=guardedEntryPlugin('v2-staging');assert.equal(plugin.transformIndexHtml.order,'pre');
 for(const filename of ['/repo/index.html','C:\\repo\\index.html']){
 const html=plugin.transformIndexHtml.handler('<script src="/src/main.jsx"></script>',{filename});
 assert.match(html,/src\/v2-staging.jsx/);assert.ok(!html.includes('main.jsx'));
 }
});
test('legacy root and explicit staging HTML remain unchanged by policy',()=>{
 assert.equal(guardedEntryPlugin('').transformIndexHtml.handler('legacy',{filename:'/repo/index.html'}),'legacy');
 assert.equal(guardedEntryPlugin('v2-staging').transformIndexHtml.handler('explicit',{filename:'/repo/v2-staging.html'}),'explicit');
});
test('staging entry reads only the two explicitly allowed build variables',()=>{
 const entry=readFileSync(new URL('../src/v2-staging.jsx',import.meta.url),'utf8');
 assert.deepEqual([...entry.matchAll(/import\.meta\.env\.([A-Z_]+)/g)].map(m=>m[1]).sort(),['VITE_CENTRAL_SUPABASE_ANON_KEY','VITE_CENTRAL_SUPABASE_URL']);
 assert.ok(!/import\.meta\.env(?!\.)/.test(entry));
});
test('Pages v2 deployment selects isolated target and excludes legacy build credentials',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/pages.yml',import.meta.url),'utf8');
 assert.match(workflow,/VITE_APP_TARGET:.*refs\/heads\/v2\/account-trust-validation.*v2-staging/);
 for(const name of ['VITE_SUPABASE_URL','VITE_SUPABASE_ANON_KEY']) assert.match(workflow,new RegExp(name+':.*github.ref !=.*secrets\\.'+name));
});
