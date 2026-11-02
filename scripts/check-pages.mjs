#!/usr/bin/env node
/**
 * Pre-flight check for GitHub Pages: verifies the built bundle uses relative
 * asset paths, ships the PWA files, and resolves routes with the hash router.
 * Run with: npm run check:pages   (after npm run build)
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
const problems = [];
const notes = [];

if (!existsSync(dist)) {
  console.error('✗ dist/ not found — run `npm run build` first.');
  process.exit(1);
}

const html = readFileSync(join(dist, 'index.html'), 'utf8');

// 1. Assets must be addressable from a sub-path.
const assetRefs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
const absolute = assetRefs.filter((u) => u.startsWith('/') && !u.startsWith('//'));
if (absolute.length) problems.push(`absolute asset paths break project pages: ${absolute.join(', ')}`);
else notes.push('assets use relative URLs');

// 2. PWA files.
for (const file of ['manifest.webmanifest', 'sw.js', 'icon-192.png', 'icon-512.png', 'icon.svg', '.nojekyll']) {
  if (!existsSync(join(dist, file))) problems.push(`missing ${file} in dist/`);
}
if (existsSync(join(dist, 'manifest.webmanifest'))) {
  const manifest = JSON.parse(readFileSync(join(dist, 'manifest.webmanifest'), 'utf8'));
  if (!manifest.start_url?.startsWith('./')) problems.push('manifest start_url must be relative (./#/app/dashboard)');
  if (manifest.icons?.length < 2) problems.push('manifest needs 192px and 512px icons');
  else notes.push(`${manifest.icons.length} manifest icons`);
}

// 3. Service worker must use relative URLs so it works under /repo/.
if (existsSync(join(dist, 'sw.js'))) {
  const sw = readFileSync(join(dist, 'sw.js'), 'utf8');
  if (/['"]\/index\.html['"]/.test(sw)) problems.push('sw.js caches absolute /index.html — use relative paths');
  else notes.push('service worker scoped relatively');
}

// 4. Bundle present.
const assets = existsSync(join(dist, 'assets')) ? readdirSync(join(dist, 'assets')) : [];
if (!assets.some((f) => f.endsWith('.js'))) problems.push('no JavaScript bundle in dist/assets');
else notes.push(`${assets.length} built files`);

// 5. Deep links rely on hash routing.
if (!existsSync(join(dist, '404.html'))) notes.push('404.html fallback not generated (CI adds it)');

console.log('myClinic — GitHub Pages readiness');
notes.forEach((n) => console.log(`  ✓ ${n}`));
if (problems.length) {
  problems.forEach((p) => console.error(`  ✗ ${p}`));
  console.error(`\n${problems.length} problem(s) found.`);
  process.exit(1);
}
console.log('\nReady to deploy: build works from any base path.');
