#!/usr/bin/env node
/**
 * myClinic · deploy the licence Edge Function, without the CLI's footguns.
 *
 * Two failures made this script exist, both of which looked like something else:
 *
 *  1. Supabase CLI 3.0.0 became `latest` on 2026-11-02 and refuses to load a
 *     `supabase/config.toml` containing the old `[inbucket]` section. It exits at
 *     *config load* — before bundling — with a message about local email that
 *     never mentions the function. Renaming the section fixes v3 and breaks every
 *     2.x CLI ("config.config has invalid keys: local_smtp"), so this project
 *     carries no config at all: `schema.sql` is pasted, not migrated.
 *  2. Node cannot `execFile` a `.cmd` shim, and `npx` is one on Windows, so the
 *     first version spawned nothing and blamed the type-checker.
 *
 *   npm run deploy:function -- <project-ref>
 *   SUPABASE_PROJECT_REF=abcdefghijklmnop npm run deploy:function
 *   npm run deploy:function -- <ref> --skip-check       # CI type-checks anyway
 *   SUPABASE_CLI=2.122.1 npm run deploy:function -- <ref>   # CLI that accepts a legacy config
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { WINDOWS, shellOptions } from './lib/platform.mjs';

export const FUNCTION = 'sync-clinic-license';

/** `--remote` is 3.x; 2.x only understands `--project-ref`, and has no `=` form. */
export function deployArgs(cliVersion, ref) {
  const major = Number(String(cliVersion).split('.')[0]) || 3;
  return major >= 3
    ? ['functions', 'deploy', FUNCTION, `--remote=${ref}`]
    : ['functions', 'deploy', FUNCTION, '--project-ref', ref];
}

/**
 * Where a legacy `supabase/config.toml` might be, and whether it has the section
 * the current CLI refuses.
 *
 * The file is untracked, generated once by an older CLI, and not necessarily in
 * the working directory — so this walks upward and reports every path it looked
 * at. "The CLI says [inbucket] and I cannot find the file" is the state that
 * costs a round trip.
 */
export function findLegacyConfig(start = process.cwd(), levels = 6, fs = { existsSync, readFileSync }) {
  const seen = [];
  let dir = start;
  for (let level = 0; level < levels; level += 1) {
    for (const candidate of [join(dir, 'supabase', 'config.toml'), join(dir, 'config.toml')]) {
      seen.push(candidate);
      if (!fs.existsSync(candidate)) continue;
      const text = String(fs.readFileSync(candidate, 'utf8'));
      const lines = text.split('\n')
        .map((line, index) => [line, index + 1])
        .filter(([line]) => /^\s*\[inbucket(\]|\.)/.test(line))
        .map(([, index]) => index);
      return {
        file: candidate,
        lines,
        legacy: lines.length > 0,
        localSmtp: /^\s*\[local_smtp(\]|\.)/m.test(text),
        seen,
      };
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return { file: '', lines: [], legacy: false, localSmtp: false, seen };
}

const die = (message, hint = '') => {
  console.error(`✗ ${message}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
};

function main() {
  const args = process.argv.slice(2);
  const skipCheck = args.includes('--skip-check');
  const REF = (args.find((a) => !a.startsWith('-')) || process.env.SUPABASE_PROJECT_REF || '').trim();
  const CLI = (process.env.SUPABASE_CLI || '3').trim();
  const major = Number(CLI.split('.')[0]) || 3;

  if (!/^[a-z]{20}$/.test(REF)) {
    die(
      `A project ref is required (20 lowercase letters), got "${REF || '(none)'}".`,
      'npm run deploy:function -- <project-ref>   ·   or set SUPABASE_PROJECT_REF',
    );
  }

  const found = findLegacyConfig();
  if (found.legacy) {
    die(
      `${found.file} still has the pre-3.0 [inbucket] section (line ${found.lines.join(', ')}), so the CLI refuses to load it and exits before bundling.`,
      `This project does not need that file: rm ${JSON.stringify(found.file)}  (it is not tracked). `
      + 'Or rename [inbucket] to [local_smtp] — but only if every CLI you use is 3.0 or newer. '
      + 'The third way is a CLI that still accepts it: SUPABASE_CLI=2.122.1 npm run deploy:function -- <ref>',
    );
  }
  if (found.file && found.localSmtp && major < 3) {
    die(
      `${found.file} uses [local_smtp], which only CLI 3.0+ understands — and SUPABASE_CLI is ${CLI}.`,
      'Use the default CLI (3) or rename the section back to [inbucket].',
    );
  }

  /**
   * Run something and *show* what it said. The first version used execFileSync
   * with inherited stdio and a bare catch: on Windows the spawn failed with
   * ENOENT before the child existed, nothing was printed, and the wrapper blamed
   * the type-checker for a failure it never had.
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
          ? 'On Windows npm/npx/deno are .cmd shims. Run the two commands by hand — neither needs node_modules.'
          : '',
      );
    }
    if (result.status !== 0) {
      if (/\[inbucket\]/i.test(out)) {
        die(
          'The CLI could not load a supabase/config.toml and exited before bundling — those words are about local email, never about this function.',
          found.file
            ? `It reported ${found.file}, which this run did not think had a legacy section. Rename [inbucket] to [local_smtp], or delete the file (it is not tracked).`
            : `No config.toml was found from ${process.cwd()} upward (${found.seen.length} paths checked), so the CLI is reading one from elsewhere. Find it with:  grep -rn "inbucket" --include=*.toml .`,
        );
      }
      const tail = out.split('\n').slice(-6).join('\n  ');
      die(
        `\`${command} ${argv[0] ?? ''}\` exited ${result.status}.`,
        tail ? `it said:\n  ${tail}` : 'it printed nothing.',
      );
    }
  };

  // 1. It has to type-check: a green deploy of an unbuildable function is a trap.
  //    `--skip-check` exists because CI runs this on every push to main.
  if (skipCheck) {
    console.log('· skipping the type-check (--skip-check); CI runs it on every push to main');
  } else {
    run('npx', ['--yes', 'deno@2', 'check', `supabase/functions/${FUNCTION}/index.ts`]);
  }

  // 2. Deploy, with the flag this CLI version understands.
  run('npx', ['--yes', `supabase@${CLI}`, ...deployArgs(CLI, REF)]);

  console.log('');
  console.log('Deployed. Note what this function is now:');
  console.log('  · nothing in the app calls it since 1.24.0 — the keyless Central Auto-Sync');
  console.log('    path replaced it, and the RS256 licence-authority client was removed');
  console.log('  · it is kept so an older build can still be pointed at a working deployment,');
  console.log('    and so the schema 18 columns have a writer; see docs/SUBSCRIPTION.md');
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('deploy-licence-function.mjs')) main();
