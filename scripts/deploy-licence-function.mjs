#!/usr/bin/env node
/**
 * myClinic · deploy the licence Edge Function, without the CLI's footguns.
 *
 * `npx supabase functions deploy` failed on 2026-11-02 for a reason that has
 * nothing to do with this repository: Supabase CLI 3.0.0 became `latest` that day
 * and refuses to load a `supabase/config.toml` containing the old `[inbucket]`
 * section — it exits before bundling anything, with a message about local email
 * that says nothing about the function. Renaming the section fixes v3 and breaks
 * every 2.x CLI ("config.config has invalid keys: local_smtp"), so the safe move
 * is to not carry a config we do not use: this project is applied by pasting
 * schema.sql, not by `supabase start`.
 *
 *   npm run deploy:function -- <project-ref>
 *   SUPABASE_PROJECT_REF=abcdefghijklmnop npm run deploy:function
 *   npm run deploy:function -- <ref> --skip-check      # CI type-checks anyway
 *   SUPABASE_CLI=2.122.1 npm run deploy:function -- <ref>
 *
 * The function is type-checked first (the same `deno check` CI runs), because a
 * deploy that succeeds with a broken bundle is worse than one that fails.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { WINDOWS, shellOptions } from './lib/platform.mjs';

const FUNCTION = 'sync-clinic-license';
const args = process.argv.slice(2);
const skipCheck = args.includes('--skip-check');
const REF = (args.find((a) => !a.startsWith('-')) || process.env.SUPABASE_PROJECT_REF || '').trim();
const CLI = (process.env.SUPABASE_CLI || '3').trim();

const die = (message, hint = '') => {
  console.error(`✗ ${message}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
};

if (!/^[a-z]{20}$/.test(REF)) {
  die(
    `A project ref is required (20 lowercase letters), got "${REF || '(none)'}".`,
    'npm run deploy:function -- <project-ref>   ·   or set SUPABASE_PROJECT_REF',
  );
}

/**
 * The trap, seen before the CLI sees it. This file is not tracked — an older CLI
 * generated it once and it has been sitting in the working tree ever since.
 */
const config = 'supabase/config.toml';
if (existsSync(config)) {
  const text = readFileSync(config, 'utf8');
  if (/^\s*\[inbucket\]/m.test(text)) {
    die(
      `${config} still has the pre-3.0 [inbucket] section, so the CLI refuses to load it and exits before bundling.`,
      'This project does not need the file: rm supabase/config.toml  (it is not tracked). '
      + 'Or rename [inbucket] to [local_smtp] — but only if every CLI you use is 3.0 or newer.',
    );
  }
}

/**
 * Run something and *show* what it said. The first version of this script used
 * execFileSync with inherited stdio and a bare catch: on Windows the spawn failed
 * with ENOENT before the child existed, nothing was printed, and the wrapper
 * blamed the type-checker for a failure it never had.
 */
const run = (command, argv) => {
  console.log(`$ ${command} ${argv.join(' ')}`);
  const result = spawnSync(command, argv, { encoding: 'utf8', ...shellOptions() });
  const out = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (out) console.log(out);

  if (result.error) {
    die(
      `Could not run \`${command}\`: ${result.error.message}`,
      WINDOWS
        ? 'On Windows npm/npx/deno are .cmd shims; if this is ENOENT or EINVAL, run the two commands by hand (below) — they do not need node_modules.'
        : '',
    );
  }
  if (result.status !== 0) {
    const tail = out.split('\n').slice(-6).join('\n  ');
    die(
      `\`${command} ${argv[0] ?? ''}\` exited ${result.status}.`,
      tail ? `it said:\n  ${tail}` : 'it printed nothing.',
    );
  }
};

// 1. It has to type-check: a green deploy of an unbuildable function is a trap.
//    `--skip-check` exists because CI already runs this on every push to main, and
//    because `npx deno@2` downloads ~40 MB the first time.
if (skipCheck) {
  console.log('· skipping the type-check (--skip-check); CI runs it on every push to main');
} else {
  run('npx', ['--yes', 'deno@2', 'check', `supabase/functions/${FUNCTION}/index.ts`]);
}

// 2. Deploy. `--remote` replaces `--project-ref`, which is deprecated in 3.x and
//    removed in 4.x.
run('npx', ['--yes', `supabase@${CLI}`, 'functions', 'deploy', FUNCTION, `--remote=${REF}`]);

console.log('');
console.log('Deployed. What to watch for on the next attempt from the app:');
console.log('  · the function log now carries a line per refusal — `refused 403 <code> {…}`');
console.log('  · `key-private` / `key-malformed` name a bad LICENSE_PUBLIC_KEY before the authority is called');
console.log('  · anything else is answered by `npm run check:key` and docs/LICENCE-AUTHORITY.md');
if (!skipCheck) console.log('  · the bundle came from a function that passed `deno check`');
