#!/usr/bin/env node
/**
 * Run the whole suite with node's test runner, on every platform and every Node.
 *
 * `node --test tests/` is the obvious command and it is what CI used to run, but
 * it is not portable: on Windows the directory argument is not classified as a
 * directory, so the runner tries to load `tests` as a module and the suite fails
 * with MODULE_NOT_FOUND before a single test runs. Letting the shell expand
 * `tests/*.test.mjs` is no better — npm runs scripts through cmd.exe on Windows,
 * which does not expand globs, and node only learned to expand them itself in
 * 22.6.
 *
 * So the file list is built here, in Node, and passed as arguments. One list, no
 * shell, no globs, no directory handling: whatever `tests/` contains is what
 * runs, and a new test file needs no edit to this script or to package.json.
 */

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = join(root, 'tests');

let names;
try {
  names = readdirSync(dir);
} catch {
  console.error(`run-tests: no tests directory at ${dir}`);
  process.exit(1);
}

const files = names
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => join(dir, name));

if (files.length === 0) {
  console.error(`run-tests: no *.test.mjs files in ${dir}`);
  process.exit(1);
}

// Anything left over on the command line is passed through to the runner, so
// `npm test -- --test-name-pattern booking` still works.
const extra = process.argv.slice(2);
const run = spawnSync(process.execPath, ['--test', ...extra, ...files], {
  cwd: root,
  stdio: 'inherit',
});

if (run.error) {
  console.error(`run-tests: could not start node --test — ${run.error.message}`);
  process.exit(1);
}
process.exit(run.status ?? 1);
