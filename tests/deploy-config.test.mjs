import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deployArgs, findLegacyConfig } from '../scripts/deploy-licence-function.mjs';

/*
 * The deploy that never reached the function: Supabase CLI 3.0.0 refuses a
 * `supabase/config.toml` written by 2.x, and the file is untracked — generated
 * once by an older CLI, in a directory nobody remembers.
 */

const scratch = () => mkdtempSync(join(tmpdir(), 'myclinic-cfg-'));

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
