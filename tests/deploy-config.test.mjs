import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deployArgs, findLegacyConfig } from '../scripts/deploy-licence-function.mjs';

/*
 * The deploy that never reached the function: Supabase CLI 3.0.0 refuses a
 * `supabase/config.toml` written by 2.x, and the file is untracked — generated
 * once by an older CLI, in a directory nobody remembers.
 */

const scratch = () => mkdtempSync(join(tmpdir(), 'myclinic-cfg-'));
const root = dirname(dirname(fileURLToPath(import.meta.url)));

test('the legacy section is found where the CLI would look', () => {
  const dir = scratch();
  mkdirSync(join(dir, 'supabase'));
  writeFileSync(join(dir, 'supabase', 'config.toml'), '[project]\nid = "x"\n\n[inbucket]\nenabled = true\n');
  const found = findLegacyConfig(dir);
  assert.equal(found.legacy, true);
  assert.equal(found.file, join(dir, 'supabase', 'config.toml'));
  assert.deepEqual(found.lines, [4], 'the line number is what makes it fixable in one edit');
});

test('it walks upward, because the file outlives the directory it was made in', () => {
  const dir = scratch();
  const inner = join(dir, 'app', 'src');
  mkdirSync(inner, { recursive: true });
  writeFileSync(join(dir, 'config.toml'), '[inbucket.smtp]\nport = 54325\n');
  const found = findLegacyConfig(inner);
  assert.equal(found.legacy, true, 'a child table is rejected by the same prefix rule');
  assert.equal(found.file, join(dir, 'config.toml'));
});

test('a modern config is reported, not refused', () => {
  const dir = scratch();
  mkdirSync(join(dir, 'supabase'));
  writeFileSync(join(dir, 'supabase', 'config.toml'), '[project]\nid = "x"\n\n[local_smtp]\nenabled = true\n');
  const found = findLegacyConfig(dir);
  assert.equal(found.legacy, false);
  assert.equal(found.localSmtp, true);
});

test('no config is a finding too: it lists what it looked at', () => {
  const dir = scratch();
  const found = findLegacyConfig(dir, 3);
  assert.equal(found.file, '');
  assert.equal(found.legacy, false);
  assert.ok(found.seen.length >= 6, 'every candidate path is reported, so the next search is cheap');
  assert.ok(found.seen.includes(join(dir, 'supabase', 'config.toml')), 'the working directory first');
  assert.ok(found.seen.includes(join(dir, 'config.toml')));
  assert.ok(found.seen.length > 2, 'and then the parents, so a stray file elsewhere is still named');
});

test('the deploy flag follows the CLI version it is given', () => {
  assert.deepEqual(deployArgs('3', 'abcdefghijklmnopqrst'),
    ['functions', 'deploy', 'sync-clinic-license', '--remote=abcdefghijklmnopqrst']);
  assert.deepEqual(deployArgs('3.0.1', 'abcdefghijklmnopqrst'),
    ['functions', 'deploy', 'sync-clinic-license', '--remote=abcdefghijklmnopqrst']);
  assert.deepEqual(deployArgs('2.122.1', 'abcdefghijklmnopqrst'),
    ['functions', 'deploy', 'sync-clinic-license', '--project-ref', 'abcdefghijklmnopqrst'],
    '2.x does not understand --remote at all');
});

/*
 * The Cloudflare failure that prompted this section:
 *
 *   Success: Build command completed
 *   Executing user deploy command: npx wrangler deploy
 *   ✘ [ERROR] Error parsing file: /opt/buildhome/repo/vite.config.js
 *   Failed: error occurred while running deploy command
 *
 * The build was perfect; the deploy could not start. With no wrangler config,
 * `wrangler deploy` cannot tell what it is deploying, so it tries to *detect*
 * the framework by bundling `vite.config.js` with esbuild. That pulls in Vite's
 * own rolldown graph, which reaches for two optional peers this project
 * deliberately does not install (`esbuild`, `@vitejs/devtools/config`), and the
 * resolution failure surfaces as "Error parsing file" — which reads like a
 * syntax error in a file that is perfectly valid.
 *
 * An explicit `assets.directory` removes the guess: static files only, no
 * Worker script, nothing to detect. These tests read the config from disk, so a
 * future edit that reintroduces detection (a stray `main`, a missing
 * `assets.directory`) fails here instead of in the deploy log.
 */

/** JSONC in, object out: block and line comments stripped, then parsed. */
const readJsonc = (file) => JSON.parse(
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, ''),
);

test('the Cloudflare config deploys static assets and nothing else', () => {
  const cfg = readJsonc(join(root, 'wrangler.jsonc'));
  assert.equal(cfg.assets?.directory, './dist', 'points at what vite build emits');
  assert.equal(cfg.main, undefined,
    'a Worker entry would put wrangler back in bundle mode, which is the failure');
  assert.equal(cfg.assets?.not_found_handling, 'none',
    'hash routing needs no SPA fallback, and one would answer 200 for a missing chunk');
  assert.ok(cfg.name, 'a name is required to deploy');
  assert.match(cfg.compatibility_date ?? '', /^\d{4}-\d{2}-\d{2}$/);
});

test('the config survives a parse with the obfuscation plugin in the build', () => {
  // The whole point of the file is that wrangler never reads vite.config.js.
  // If it ever has to, this is the shape that breaks: ESM in a .js config that
  // imports a CJS dev dependency, inside a package with "type": "module".
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.type, 'module');
  assert.ok(readFileSync(join(root, 'vite.config.js'), 'utf8').includes('javascript-obfuscator'),
    'the import that esbuild follows into node_modules when it should not');
  assert.ok(readFileSync(join(root, 'wrangler.jsonc'), 'utf8').includes('assets'),
    'and the file that keeps it from being followed');
});

test('_headers keeps the worker and the shell uncached on every static host', () => {
  const headers = readFileSync(join(root, 'public', '_headers'), 'utf8');
  // A cached sw.js pins the whole clinic to an old bundle for the whole TTL:
  // the deploy looks successful and the app behaves stale.
  const sw = headers.split(/\n(?=\S)/).find((block) => /^\/sw\.js\s*$/m.test(block));
  assert.ok(sw, '/sw.js must have its own block');
  assert.match(sw, /no-cache/);
  assert.match(headers, /\/assets\/\*[\s\S]*?immutable/, 'hashed chunks may be cached hard');
  assert.match(headers, /\/index\.html[\s\S]*?no-cache/, 'the shell must revalidate');
});
