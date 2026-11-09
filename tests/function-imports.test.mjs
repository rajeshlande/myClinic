import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * The CI failure that prompted this file:
 *
 *   Download https://esm.sh/
 *   error: Import 'https://esm.sh/' failed: 522 <unknown status code>
 *       at .../sync-clinic-license/index.ts:24:30
 *
 * Nothing was wrong with esm.sh, and nothing was wrong with the key code. The
 * specifier had been shortened to the bare host — `from 'https://esm.sh'` — and
 * a host is not a module. It answers with a web page when it is healthy and with
 * a 522 when Cloudflare's edge cannot reach it, and neither is JavaScript. The
 * 522 made it look like an outage in someone else's infrastructure, so the file
 * needs to be read, not the CDN.
 *
 * These tests read the file. They need no network, so they catch the mistake
 * before CI ever reaches for esm.sh.
 */

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const FUNCTION = join(root, 'supabase', 'functions', 'sync-clinic-license', 'index.ts');

const source = readFileSync(FUNCTION, 'utf8');

/** Every module specifier the function imports, in source order. */
function specifiers(src) {
  const found = [];
  for (const m of src.matchAll(/^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gm)) found.push(m[1]);
  for (const m of src.matchAll(/^\s*export\s[^;]*?from\s+['"]([^'"]+)['"]/gm)) found.push(m[1]);
  for (const m of src.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) found.push(m[1]);
  return found;
}

const SPECS = specifiers(source);
const REMOTE = SPECS.filter((s) => /^https?:\/\//.test(s));

test('the function reads its imports at all', () => {
  assert.ok(SPECS.length > 0, 'no import specifiers found — did the file move?');
});

test('a remote import is a module URL, not a bare host', () => {
  assert.ok(REMOTE.length > 0, 'expected at least one remote import (the Supabase client)');
  for (const spec of REMOTE) {
    const url = new URL(spec);
    assert.notEqual(
      url.pathname.replace(/\/+$/, ''),
      '',
      `"${spec}" is a bare host. It serves a web page, not a module — deno resolves it to HTML when esm.sh is up and to a 522 when it is not. Use the full package URL, e.g. https://esm.sh/@supabase/supabase-js@2.119.0`,
    );
    assert.ok(
      url.pathname.split('/').filter(Boolean).length >= 1,
      `"${spec}" has no package path`,
    );
  }
});

test('a remote import is pinned to one exact version', () => {
  for (const spec of REMOTE) {
    const path = new URL(spec).pathname;
    const pinned = /@(\d+\.\d+\.\d+)(?:[/?]|$)/.exec(path);
    assert.ok(
      pinned,
      `"${spec}" is not pinned to an exact x.y.z version. A floating major would let a new upstream release change what the clinic runs without a commit here.`,
    );
  }
});

test('the Supabase client is imported from a version that exists', () => {
  const client = SPECS.find((s) => s.includes('@supabase/supabase-js'));
  assert.ok(client, 'createClient is gone — the function cannot read the registry');
  const version = /@supabase\/supabase-js@(\d+\.\d+\.\d+)/.exec(client);
  assert.ok(version, `expected an exact version in "${client}"`);
  // 2.119.0 is the release that `npm view @supabase/supabase-js version` reported
  // when this pin was written; the point of the assertion is that the pin is a
  // number someone chose, not a range.
  assert.match(version[1], /^\d+\.\d+\.\d+$/);
});

test('no import was left as a template or an empty string', () => {
  for (const spec of SPECS) {
    assert.notEqual(spec.trim(), '', 'an empty import specifier');
    assert.ok(!spec.includes('${'), `"${spec}" is computed at runtime, so nothing can check it`);
  }
});

/*
 * The step that runs it is worth guarding too: a retry is the difference between
 * "esm.sh had a bad minute" and a red build on an unrelated commit.
 */
const WORKFLOWS = ['.github/workflows/ci.yml', '.github/workflows/pages.yml'].map((rel) => ({
  rel,
  text: readFileSync(join(root, rel), 'utf8'),
}));

test('every workflow that type-checks the function retries the fetch', () => {
  for (const { rel, text } of WORKFLOWS) {
    assert.match(text, /deno check "\$FN"/, `${rel} no longer type-checks the function — restore the step`);
    assert.match(text, /for attempt in 1 2 3/, `${rel} must retry: esm.sh is a third-party CDN`);
    assert.match(text, /attempt \$attempt of 3/, `${rel} must say which attempt failed`);
  }
});

test('every workflow caches the Deno module cache', () => {
  for (const { rel, text } of WORKFLOWS) {
    assert.match(text, /uses: actions\/cache@v4/, `${rel} should cache ~/.cache/deno`);
    assert.match(text, /path: ~\/\.cache\/deno/, `${rel} caches the wrong directory`);
  }
});

/* ------------------------------------- the function says which build it is
 * Without this, a refusal could not be attributed to a version, and every
 * diagnosis began by guessing whether the deployed function was older than the
 * app — the guessing that cost the releases before this one.
 */

test('the function declares a version', () => {
  const declared = /const FUNCTION_VERSION = '(\d+\.\d+\.\d+)';/.exec(source);
  assert.ok(declared, 'FUNCTION_VERSION is gone — a refusal is anonymous again');
});

test('the function never claims a release that does not exist yet', () => {
  // The function is bumped in the same commit that changes it, and it must never
  // run ahead of the app: a function reporting 1.23.0 while the release is 1.22.x
  // would make the very header this file protects into a lie. Being *behind* is
  // normal and is exactly what the refusal text is for — a function older than
  // the build says so, and the card tells the owner to deploy it again.
  const declared = /const FUNCTION_VERSION = '(\d+\.\d+\.\d+)';/.exec(source)[1];
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const rank = (v) => v.split('.').map(Number);
  const [dMajor, dMinor, dPatch] = rank(declared);
  const [pMajor, pMinor, pPatch] = rank(pkg.version);
  const ahead = dMajor - pMajor || dMinor - pMinor || dPatch - pPatch;
  assert.ok(ahead <= 0, `FUNCTION_VERSION ${declared} is newer than the app (${pkg.version})`);
});

test('every FUNCTION_VERSION is a release in the changelog', () => {
  // A version nobody can look up is not a diagnosis. If the function is bumped,
  // the release that carries it is written down.
  const declared = /const FUNCTION_VERSION = '(\d+\.\d+\.\d+)';/.exec(source)[1];
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, new RegExp(`^## \\[?${declared.replace(/\./g, '\\.')}\\]?`, 'm'),
    `FUNCTION_VERSION ${declared} has no CHANGELOG entry`);
});

test('a mismatched public PEM envelope is normalized as SPKI', () => {
  assert.match(source, /if \(\/END RSA PUBLIC KEY\/\.test\(value\)\) return \{ pem: value, format: 'pkcs1' \};/);
  assert.match(
    source,
    /if \(\/END PUBLIC KEY\/\.test\(value\)\) \{[\s\S]*?value\.replace\('-----BEGIN RSA PUBLIC KEY-----', '-----BEGIN PUBLIC KEY-----'\)[\s\S]*?format: 'spki'/,
  );
  assert.ok(
    source.indexOf("if (/PRIVATE KEY/.test(value))") < source.indexOf("if (/BEGIN RSA PUBLIC KEY/.test(value))"),
    'private key material must be rejected before public-envelope normalization',
  );
});

test('every response carries the version, and the browser may read it', () => {
  assert.match(source, /'x-myclinic-function': FUNCTION_VERSION/, 'the header is set on responses');
  assert.match(source, /version: FUNCTION_VERSION/, 'the body carries it too');
  assert.match(
    source,
    /'Access-Control-Expose-Headers': 'x-myclinic-code, x-myclinic-function'/,
    'without Expose-Headers the browser cannot read either header back',
  );
});
