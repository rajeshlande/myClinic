#!/usr/bin/env node
import {readFileSync,readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
// Run only AFTER an explicit VITE_APP_TARGET=v2-staging build.
const root=readFileSync('dist/index.html','utf8');
const staging=readFileSync('dist/v2-staging.html','utf8');
for(const html of [root,staging]) {
 assert.match(html,/v2 staging boundary/);
 assert.ok(!html.includes('/src/'));
 const paths=[...html.matchAll(/src="\.\/(assets\/[^"?]+\.js)"/g)].map(x=>x[1]);
 assert.ok(paths.length>0);
 for(const path of paths)readFileSync('dist/'+path);
}
const assets=readdirSync('dist/assets').filter(x=>x.endsWith('.js'));
const js=assets.map(x=>readFileSync('dist/assets/'+x,'utf8')).join('\n');
for(const forbidden of ['nosqdnmnztsikfygyiqa','accept_invite','license_state','myclinic.cache.v2.legacy'])assert.ok(!js.includes(forbidden),'Legacy clinical behaviour must not ship in staging assets');
assert.match(js,/trust boundary test/);
console.log('PASS: both staging entries built; no original clinical project or legacy invite/licence RPC in emitted JS.');
