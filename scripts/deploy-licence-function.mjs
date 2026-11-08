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
 *   SUPABASE_CLI=2.122.1 npm run deploy:function -- <ref>   # pin an older CLI
 *
 * The function is type-checked first (the same `deno check` CI runs), because a
 * deploy that succeeds with a broken bundle is worse than one that fails.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const FUNCTION = 'sync-clinic-license';
const REF = (process.argv[2] || process.env.SUPABASE_PROJECT_REF || '').trim();
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

const run = (cmd, args, extra = {}) => {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  return execFileSync(cmd, args, { stdio: 'inherit', ...extra });
};

// 1. It has to type-check: a green deploy of an unbuildable function is a trap.
try {
  run('npx', ['--yes', 'deno@2', 'check', `supabase/functions/${FUNCTION}/index.ts`]);
} catch {
  die('The function does not type-check, so it was not deployed.', 'Fix the error above, then run this again.');
}

// 2. Deploy. `--remote` replaces `--project-ref`, which is deprecated in 3.x and
//    removed in 4.x.
try {
  run('npx', ['--yes', `supabase@${CLI}`, 'functions', 'deploy', FUNCTION, `--remote=${REF}`]);
} catch {
  die(
    'The deploy exited non-zero.',
    'Re-run it by hand to see the full message: npx supabase@3 functions deploy '
    + `${FUNCTION} --remote=${REF} --debug`,
  );
}

console.log('');
console.log('Deployed. What to watch for on the next attempt from the app:');
console.log('  · the function log now carries a line per refusal — `refused 403 <code> {…}`');
console.log('  · `key-private` / `key-malformed` name a bad LICENSE_PUBLIC_KEY before the authority is called');
console.log('  · anything else is answered by `npm run check:key` and docs/LICENCE-AUTHORITY.md');
