#!/usr/bin/env node
/**
 * Enforces CONTRIBUTING.md — the parts of it a machine can check.
 *
 * The guidelines are prose; prose drifts. This script is the sentence that cannot:
 * it scans the tracked tree, the dependency list, the test layout and the vendored
 * audit skill, and fails the build on the rules that are not negotiable.
 *
 *   node scripts/check-contributing.mjs            # offline, fast (CI default)
 *   node scripts/check-contributing.mjs --online   # adds npm audit
 *   node scripts/check-contributing.mjs --strict   # warnings fail too
 *   node scripts/check-contributing.mjs --json     # machine-readable
 *   node scripts/check-contributing.mjs --only secrets,deps
 *
 * Exit code is 1 when any check fails (or, with --strict, warns).
 */
import { execFileSync } from 'node:child_process';
import { shellOptions } from './lib/platform.mjs';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname } from 'node:path';

/* ------------------------------------------------------------------ vocabulary */

/**
 * Dependency safe-list (CONTRIBUTING §1). A new runtime dependency has to be a
 * deliberate edit to this list *and* a row in THIRD_PARTY_NOTICES.md, which is the
 * point: the review happens here, not after the install.
 */
export const ALLOWED_DEPENDENCIES = [
  '@fontsource-variable/inter',
  '@fontsource-variable/manrope',
  '@supabase/supabase-js',
  'lucide-react',
  'qrcode-generator',
  'react',
  'react-dom',
  'react-router',
];

export const ALLOWED_DEV_DEPENDENCIES = ['@vitejs/plugin-react', 'vite'];

/** Files we never scan for secrets, and why. */
export const SECRET_SCAN_SKIP = [
  'package-lock.json',          // integrity hashes, not credentials
  'src/lib/demo-data.js',       // fictional patients and a demo clinic
  'supabase/schema-tests.sql',  // fixture UUIDs
  '.claude/skills/security-audit/', // vendored upstream, MIT, no credentials
];

// `tests/` used to be on that list, "fixtures use obvious dummy values". They did
// not: seven credential-shaped literals sat in tests/contributing.test.mjs, and
// GitHub's secret scanning raised a publicly-leaked-secret alert on one of them
// because it cannot tell a fixture from a leak. A scanner has no skip list, so
// neither do we — test fixtures are assembled from fragments instead, and this
// check fails if that discipline lapses.

/**
 * Secret shapes worth failing a build over. Each is anchored to something a real
 * credential looks like — a generic "password = ..." rule finds only test fixtures
 * and teaches contributors to ignore the check.
 */
export const SECRET_PATTERNS = [
  { id: 'private-key', label: 'private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { id: 'supabase-secret', label: 'Supabase secret key', re: /\bsb_secret_[A-Za-z0-9_-]{16,}/ },
  { id: 'supabase-service-role', label: 'service_role key in source', re: /service_role["'\s:=]+eyJ[A-Za-z0-9_-]{10,}/i },
  { id: 'jwt', label: 'JSON Web Token', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { id: 'aws', label: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'github-token', label: 'GitHub token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{22,}/ },
  { id: 'openai', label: 'API key with a sk- prefix', re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { id: 'slack', label: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { id: 'google-api', label: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: 'cloudflare-token', label: 'Cloudflare API token', re: /\b(?:CLOUDFLARE|CF)_API_TOKEN\s*[:=]\s*["'][A-Za-z0-9_-]{30,}["']/ },
];

/** Source extensions we read. Binaries, images and the lockfile are not text. */
export const TEXT_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.sql', '.md',
  '.css', '.html', '.yml', '.yaml', '.toml', '.sh', '.example', '',
]);

/* --------------------------------------------------------------------- scanning */

/** Every file git tracks, minus the ones a scan should not read. */
export function trackedFiles({ cwd = process.cwd() } = {}) {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\0').filter(Boolean);
}

export function isScannable(file) {
  if (SECRET_SCAN_SKIP.some((skip) => file === skip || file.startsWith(skip))) return false;
  if (file.split('/').some((part) => part === 'node_modules' || part === 'dist')) return false;
  const ext = extname(file);
  return TEXT_EXTENSIONS.has(ext);
}

/**
 * Find credentials in one file's text. Returns the pattern ids that matched, each
 * with the line number — never the matched text: a secret in a CI log is a second
 * leak, and the person who needs it already has the file.
 */
export function findSecrets(file, text) {
  const hits = [];
  const lines = text.split('\n');
  for (const { id, label, re } of SECRET_PATTERNS) {
    lines.forEach((line, i) => {
      if (re.test(line)) hits.push({ file, line: i + 1, id, label });
    });
  }
  return hits;
}

/**
 * `supabase/schema.sql` is pasted whole into the Supabase SQL editor by real
 * operators, and the editor warns before it runs: "destructive operations" and
 * "UPDATE without a WHERE clause". Both warnings are keyword heuristics, and this
 * file trips them by design — it re-creates 51 policies, 16 triggers and 20
 * constraints with `drop … if exists`, which is how a re-run stays idempotent.
 *
 * The warnings are still worth taking seriously, because a genuine `delete from`
 * or `drop table` in this file would wipe a clinic's patients the first time
 * somebody pasted it. So the shapes that *would* destroy data are banned here,
 * and any `update` without a `where` must say why on the line above:
 *
 *     -- unconditional-update: <what it touches, and why every row is intended>
 *
 * docs/SCHEMA-APPLY-SAFETY.md explains what the editor's two warnings mean and
 * what the file does and does not do.
 */
export const DESTRUCTIVE_SQL = [
  { id: 'delete', re: /\bdelete\s+from\b/i, label: 'DELETE' },
  { id: 'truncate', re: /\btruncate\b/i, label: 'TRUNCATE' },
  { id: 'drop-object', re: /\bdrop\s+(?:table|schema|database|type|column)\b/i, label: 'DROP of a table, schema, type or column' },
];

/** Statements that would destroy data, and `update`s that touch every row unasked. */
export function destructiveSqlProblems(text = '') {
  const problems = [];
  const lines = String(text).split('\n');

  lines.forEach((line, i) => {
    for (const { id, label, re } of DESTRUCTIVE_SQL) {
      if (re.test(line)) problems.push({ line: i + 1, id, why: label });
    }
  });

  lines.forEach((line, i) => {
    if (!/^\s*update\s/i.test(line)) return;
    let j = i;
    let statement = '';
    while (j < lines.length) {
      statement += `${lines[j]}\n`;
      if (lines[j].includes(';')) break;
      j += 1;
    }
    if (/\bwhere\b/i.test(statement)) return;
    const context = lines.slice(Math.max(0, i - 4), i).join('\n');
    if (/--\s*unconditional-update:\s*\S/.test(context)) return;
    problems.push({ line: i + 1, id: 'update-all-rows', why: 'UPDATE with no WHERE and no `-- unconditional-update:` reason' });
  });

  return problems;
}

/** A tracked file that should have been in .gitignore. */
export function envFileTracked(files) {
  return files.filter((f) => /(^|\/)\.env($|\.)/.test(f) && !f.endsWith('.env.example'));
}

/**
 * Listeners and timers left running (CONTRIBUTING §2, Resource management).
 * Counting per file is crude but it catches the common leak: an effect that adds a
 * listener and forgets the cleanup, which is exactly what the guidelines name.
 */
export function unbalancedListeners(file, text) {
  if (!/\.(jsx?|mjs)$/.test(file) || /node_modules|\/dist\//.test(file)) return null;
  const count = (re) => (text.match(re) ?? []).length;
  const added = count(/addEventListener\s*\(/g) + count(/setInterval\s*\(/g);
  const removed = count(/removeEventListener\s*\(/g) + count(/clearInterval\s*\(/g);
  if (added === 0 || removed >= added) return null;
  return { file, added, removed };
}

/** Raw HTML injection is an XSS boundary; React escapes for us unless we opt out. */
export function unsafeHtml(file, text) {
  if (!/\.(jsx?|tsx?|mjs)$/.test(file)) return null;
  const pattern = /dangerouslySetInnerHTML|\.innerHTML\s*=|outerHTML\s*=|insertAdjacentHTML/;
  return pattern.test(text) ? file : null;
}

/** Files that are deliberately not named after one component. */
export const NAMING_EXEMPT = ['src/components/ui.jsx'];

/** Component and page files are PascalCase; library modules are not. */
export function namingProblems(files) {
  const problems = [];
  for (const file of files) {
    if (!/^src\/(components|pages)\//.test(file)) continue;
    if (NAMING_EXEMPT.includes(file)) continue;
    const base = file.split('/').pop();
    if (!/^[A-Z][A-Za-z0-9]*\.jsx$/.test(base)) problems.push({ file, rule: 'PascalCase.jsx in src/components and src/pages' });
  }
  for (const file of files) {
    if (!/^src\/lib\//.test(file)) continue;
    const base = file.split('/').pop();
    if (/[A-Z]/.test(base)) problems.push({ file, rule: 'lower-case file names in src/lib' });
  }
  return problems;
}

/** Minimal YAML frontmatter reader — enough for `name:` and `description:`. */
export function parseFrontmatter(markdown) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (!match) return null;
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z_-]+):\s*(.*)$/.exec(line.trim());
    if (pair) meta[pair[1]] = pair[2].replace(/^['"]|['"]$/g, '');
  }
  return meta;
}

/** The version three files have to agree on. */
export function versionAgreement({ pkg, versionFile, changelog }) {
  const fromPackage = pkg?.version;
  const appVersion = /APP_VERSION\s*=\s*'([^']+)'/.exec(versionFile ?? '')?.[1];
  const schemaVersion = Number(/SCHEMA_VERSION\s*=\s*(\d+)/.exec(versionFile ?? '')?.[1]);
  const changelogHead = /^##\s*\[?(\d+\.\d+\.\d+)\]?/m.exec(changelog ?? '')?.[1];
  return { fromPackage, appVersion, schemaVersion, changelogHead };
}

/* ----------------------------------------------------------------------- checks */

const PASS = 'pass';
const FAIL = 'fail';
const WARN = 'warn';

function readFile(path) {
  try { return readFileSync(path, 'utf8'); } catch { return ''; }
}

/**
 * Run every check. Returns `{ results, failures, warnings }`.
 * `only` narrows to a subset of ids, `online` adds registry-backed checks.
 */
export function runChecks({ cwd = process.cwd(), online = false, only = null } = {}) {
  const want = (id) => !only || only.includes(id);
  const results = [];
  const add = (id, status, title, detail) => results.push({ id, status, title, detail });

  const files = (() => {
    try { return trackedFiles({ cwd }); } catch { return []; }
  })();

  const at = (path) => readFile(`${cwd}/${path}`);
  const read = (file) => { try { return readFileSync(`${cwd}/${file}`, 'utf8'); } catch { return ''; } };

  /* --- §1 security ------------------------------------------------------- */

  if (want('secrets')) {
    const leaks = [];
    for (const file of files.filter(isScannable)) {
      try {
        if (statSync(`${cwd}/${file}`).size > 2 * 1024 * 1024) continue;
        leaks.push(...findSecrets(file, read(file)));
      } catch { /* deleted between ls-files and read */ }
    }
    add('secrets', leaks.length ? FAIL : PASS,
      'no hardcoded credentials in tracked files',
      leaks.length
        ? leaks.slice(0, 8).map((h) => `${h.file}:${h.line} ${h.label}`).join('; ') + (leaks.length > 8 ? ` (+${leaks.length - 8} more)` : '')
        : `${files.filter(isScannable).length} files scanned, 0 hits`);

    const envFiles = envFileTracked(files);
    add('env-files', envFiles.length ? FAIL : PASS,
      '.env files are ignored, only .env.example is tracked',
      envFiles.length ? `tracked: ${envFiles.join(', ')}` : 'clean');

    const gitignore = at('.gitignore');
    const ignoresEnv = /(^|\n)\.env($|\n|\.)/.test(gitignore);
    add('gitignore-env', ignoresEnv ? PASS : FAIL,
      '.gitignore covers .env and .env.local',
      ignoresEnv ? 'covered' : '.gitignore does not ignore .env');

    const unsafe = files.filter((f) => f.startsWith('src/')).map((f) => unsafeHtml(f, read(f))).filter(Boolean);
    add('xss', unsafe.length ? FAIL : PASS,
      'no raw HTML injection (dangerouslySetInnerHTML, innerHTML)',
      unsafe.length ? unsafe.join(', ') : 'React escaping, no opt-outs');

    // The word `service_role` appears in this codebase as a *guard* — health.mjs and
    // supabase.js refuse such a key. What must never appear is the key itself, so the
    // rule looks for the word next to something that could be one.
    const serviceRole = files
      .filter((f) => f.startsWith('src/'))
      .filter((f) => read(f).split('\n').some((line) => /service_role/i.test(line) && /[A-Za-z0-9_-]{40,}/.test(line)));
    add('service-role', serviceRole.length ? FAIL : PASS,
      'no service-role key in the client (the word, as a guard, is fine)',
      serviceRole.length ? serviceRole.join(', ') : 'guards only, no credential');
  }

  if (want('deps')) {
    const pkg = JSON.parse(at('package.json') || '{}');
    const installed = Object.keys(pkg.dependencies ?? {});
    const unexpected = installed.filter((name) => !ALLOWED_DEPENDENCIES.includes(name));
    add('deps-allowlist', unexpected.length ? FAIL : PASS,
      'runtime dependencies are on the safe-list',
      unexpected.length
        ? `not on the list: ${unexpected.join(', ')} — add it here, in THIRD_PARTY_NOTICES.md and in the PR`
        : `${installed.length} packages, all reviewed`);

    const devInstalled = Object.keys(pkg.devDependencies ?? {});
    const unexpectedDev = devInstalled.filter((name) => !ALLOWED_DEV_DEPENDENCIES.includes(name));
    add('devdeps-allowlist', unexpectedDev.length ? WARN : PASS,
      'dev dependencies are on the safe-list',
      unexpectedDev.length ? `not on the list: ${unexpectedDev.join(', ')}` : `${devInstalled.length} packages`);

    const notices = at('THIRD_PARTY_NOTICES.md');
    const flat = notices.toLowerCase().replace(/[^a-z0-9]/g, '');
    // "React Router" and react-router are the same dependency to a reader.
    const unlisted = installed.filter((name) => !flat.includes(name.toLowerCase().replace(/[^a-z0-9]/g, '')));
    add('notices', unlisted.length ? FAIL : PASS,
      'every dependency has a licence row in THIRD_PARTY_NOTICES.md',
      unlisted.length ? `missing: ${unlisted.join(', ')}` : 'all listed');

    add('lockfile', existsSync(`${cwd}/package-lock.json`) ? PASS : FAIL,
      'package-lock.json is committed', existsSync(`${cwd}/package-lock.json`) ? 'present' : 'missing');

    if (online) {
      try {
        // `npm` is npm.cmd on Windows: without a shell the spawn fails outright and
        // this rule reported "audit failed" for a check that never ran.
        execFileSync('npm', ['audit', '--audit-level=high', '--omit=dev'], {
          cwd, stdio: 'pipe', ...shellOptions(),
        });
        add('npm-audit', PASS, 'npm audit (production, high+)', 'no high or critical advisories');
      } catch (error) {
        const out = String(error.stdout ?? '') + String(error.stderr ?? '');
        const summary = (/found \d+ vulnerabilit[^\n]*/i.exec(out) ?? ['audit failed'])[0];
        add('npm-audit', FAIL, 'npm audit (production, high+)', summary);
      }
    }
  }

  if (want('perf')) {
    const leaks = files.filter((f) => f.startsWith('src/')).map((f) => unbalancedListeners(f, read(f))).filter(Boolean);
    add('listeners', leaks.length ? FAIL : PASS,
      'every listener and interval has a cleanup',
      leaks.length ? leaks.map((l) => `${l.file} (+${l.added - l.removed})`).join(', ') : 'balanced');

    const blocking = files
      .filter((f) => f.startsWith('src/'))
      .filter((f) => /\b(execSync|readFileSync|writeFileSync)\s*\(/.test(read(f)));
    add('no-sync', blocking.length ? FAIL : PASS,
      'no blocking filesystem or process calls in the browser bundle',
      blocking.length ? blocking.join(', ') : 'none');

    const eager = files.filter((f) => /^src\/pages\//.test(f)).length;
    const lazy = /lazy\(\(\)\s*=>\s*import\(/.test(at('src/App.jsx'));
    add('lazy-routes', lazy ? PASS : WARN,
      'page routes are lazy-loaded',
      lazy ? `${eager} pages behind Suspense` : 'src/App.jsx does not use lazy()');
  }

  if (want('style')) {
    const naming = namingProblems(files);
    add('naming', naming.length ? FAIL : PASS,
      'file naming follows the conventions',
      naming.length ? naming.map((n) => `${n.file} (${n.rule})`).join(', ') : 'PascalCase for components and pages, lower-case for lib');

    const stray = files.filter((f) => /^src\//.test(f)).filter((f) => /console\.log\(/.test(read(f)));
    add('console', stray.length ? WARN : PASS,
      'no console.log left in the app',
      stray.length ? stray.join(', ') : 'clean');

    const hasLintConfig = existsSync(`${cwd}/.markdownlint.json`);
    add('lint-config', hasLintConfig ? PASS : WARN,
      'a linter configuration is committed',
      hasLintConfig ? '.markdownlint.json (markdown); tests are the JS gate' : 'no lint config found');
  }

  if (want('tests')) {
    const testFiles = files.filter((f) => /^tests\/.+\.test\.mjs$/.test(f));
    add('test-suite', testFiles.length >= 10 ? PASS : FAIL,
      'the suites are present', `${testFiles.length} test files under tests/`);

    const libs = files.filter((f) => /^src\/lib\/.+\.mjs$/.test(f));
    const testText = testFiles.map(read).join('\n');
    const untested = libs.filter((f) => {
      const base = f.split('/').pop();
      return !testText.includes(base) && !testText.includes(base.replace(/\.mjs$/, ''));
    });
    add('lib-coverage', untested.length ? WARN : PASS,
      'every pure module is exercised by a test',
      untested.length ? `no test imports: ${untested.join(', ')}` : `${libs.length} modules covered`);

    // `npm test` must reach node's test runner. It does not have to spell
    // `node --test` in package.json: the runner builds the file list itself, because
    // a directory argument or a shell glob is not portable to Windows. So follow
    // the pointer — the test script, and then whatever it invokes.
    const script = JSON.parse(at('package.json') || '{}').scripts?.test ?? '';
    const target = /node\s+(\S+)/.exec(script)?.[1] ?? '';
    const targetText = target.endsWith('.mjs') ? (at(target.replace(/^\.\//, '')) ?? '') : '';
    const reachesRunner = script.includes('node --test')
      || (targetText.includes("'--test'") || targetText.includes('"--test"'));
    add('test-script', reachesRunner ? PASS : FAIL,
      'npm test runs the node test runner',
      reachesRunner ? script : `${script || 'missing'} — no node --test`);

    // `node --test tests/` is a Windows trap: node's runner does not classify the
    // directory argument there, so it loads `tests` as a module and the suite dies
    // with MODULE_NOT_FOUND before the first test — green here, red on the machine
    // that matters. The runner script exists precisely to keep the file list out of
    // the shell's hands, so refuse the shape that broke.
    const bareDir = /^node\s+--test\s+(?:--\S+\s+)*[\w./-]+\/?\s*$/.test(script.trim())
      && !/\.[cm]?js\b/.test(script);
    add('test-script-portable', bareDir ? FAIL : PASS,
      'npm test does not hand node a bare directory',
      bareDir ? `${script} — build the file list in node instead (see scripts/run-tests.mjs)` : script);
  }

  if (want('docs')) {
    const versions = versionAgreement({
      pkg: JSON.parse(at('package.json') || '{}'),
      versionFile: at('src/lib/version.js'),
      changelog: at('CHANGELOG.md'),
    });
    const aligned = versions.fromPackage === versions.appVersion
      && versions.changelogHead === versions.fromPackage;
    const schemaProblems = destructiveSqlProblems(at('supabase/schema.sql') ?? '');
    add('schema-apply-safety', schemaProblems.length ? FAIL : PASS,
      'schema.sql deletes nothing and drops no tables, columns or schemas',
      schemaProblems.length
        ? schemaProblems.slice(0, 3).map((p) => `line ${p.line}: ${p.why}`).join(' · ')
        : 'no DELETE, TRUNCATE or object DROP; every UPDATE is row-scoped or says why');

    add('version', aligned ? PASS : FAIL,
      'package.json, APP_VERSION and CHANGELOG agree',
      `${versions.fromPackage} / ${versions.appVersion} / ${versions.changelogHead ?? '—'} · schema ${versions.schemaVersion}`);

    // Three lists describe the same history, and they drifted: schema.sql's header
    // stopped at 16 while the file itself applied 18, and the setup guide's table
    // stopped at 8. Someone asking "which schema is this?" from the file got a
    // wrong answer, so all three are now compared against SCHEMA_VERSION.
    const schemaSql = at('supabase/schema.sql') ?? '';
    const schemaNum = Number(/SCHEMA_VERSION\s*=\s*(\d+)/.exec(at('src/lib/version.js') ?? '')?.[1] ?? 0);
    const highest = (list) => (list.length ? Math.max(...list) : 0);
    const listedHeader = highest([...schemaSql.matchAll(/^--\s+(\d+)\s{2,}\S[^\n]*v\d+\.\d+\.\d+/gm)].map((m) => Number(m[1])));
    const appliedBlocks = highest([...schemaSql.matchAll(/set schema_version = (\d+)/g)].map((m) => Number(m[1])));
    const listedGuide = highest([...(at('docs/SUPABASE-SETUP.md') ?? '').matchAll(/^\|\s*(\d+)\s*\|/gm)].map((m) => Number(m[1])));
    const drift = [];
    if (schemaNum && listedHeader !== schemaNum) drift.push(`schema.sql header lists ${listedHeader}`);
    if (schemaNum && appliedBlocks !== schemaNum) drift.push(`schema.sql applies ${appliedBlocks}`);
    if (schemaNum && listedGuide !== schemaNum) drift.push(`SUPABASE-SETUP.md lists ${listedGuide}`);
    add('schema-version-lists', drift.length ? FAIL : PASS,
      'every released-version list reaches SCHEMA_VERSION',
      drift.length
        ? `${drift.join(' · ')} — SCHEMA_VERSION is ${schemaNum}`
        : `header, migration and setup guide all at ${schemaNum}`);

    const missing = ['README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CHANGELOG.md', 'THIRD_PARTY_NOTICES.md']
      .filter((f) => !existsSync(`${cwd}/${f}`));
    add('doc-set', missing.length ? FAIL : PASS,
      'the project documents are present', missing.length ? `missing: ${missing.join(', ')}` : 'all present');

    const contributing = at('CONTRIBUTING.md');
    const required = ['Security & privacy', 'Performance', 'Coding & style', 'Pull request'];
    const absent = required.filter((heading) => !new RegExp(heading, 'i').test(contributing));
    add('contributing-sections', absent.length ? FAIL : PASS,
      'CONTRIBUTING.md still carries every standard',
      absent.length ? `heading missing: ${absent.join(', ')}` : 'security, performance, style, PR process');
  }

  if (want('skill')) {
    const dir = `${cwd}/.claude/skills/security-audit`;
    const skill = readFile(`${dir}/SKILL.md`);
    const meta = parseFrontmatter(skill);
    add('skill-present', skill ? PASS : FAIL,
      'the Cloudflare security-audit skill is vendored',
      skill ? 'found at .claude/skills/security-audit/SKILL.md' : 'missing — see CONTRIBUTING.md §1');

    add('skill-frontmatter', meta?.name === 'security-audit' && (meta?.description?.length ?? 0) > 40 ? PASS : FAIL,
      'SKILL.md frontmatter is loadable',
      meta?.name === 'security-audit' ? `name=${meta.name}, description ${meta.description.length} chars` : 'name/description missing');

    const shipped = ['report-schema.json', 'validate-findings.cjs', 'validate-coverage-ledger.cjs']
      .filter((f) => !existsSync(`${dir}/${f}`));
    add('skill-files', shipped.length ? FAIL : PASS,
      'the schema and both validators ship with the skill',
      shipped.length ? `missing: ${shipped.join(', ')}` : 'schema + 2 validators');

    const vendored = readFile(`${dir}/VENDORED.md`);
    const pinned = /Pinned commit \| `([0-9a-f]{40})`/.exec(vendored)?.[1];
    add('skill-pinned', pinned ? PASS : WARN,
      'the vendored copy records its upstream commit',
      pinned ? pinned : 'VENDORED.md has no pinned commit');
  }

  const failures = results.filter((r) => r.status === FAIL);
  const warnings = results.filter((r) => r.status === WARN);
  return { results, failures, warnings };
}

/* --------------------------------------------------------------------- reports */

export function formatReport({ results, failures, warnings }, { strict = false } = {}) {
  const width = Math.max(...results.map((r) => r.title.length));
  const lines = ['', 'myClinic — CONTRIBUTING.md checks', ''];
  for (const r of results) {
    const mark = r.status === PASS ? '✓' : r.status === FAIL ? '✗' : '!';
    lines.push(`  ${mark} ${r.title.padEnd(width)}  ${r.detail}`);
  }
  const total = results.length;
  lines.push('');
  lines.push(`  ${total - failures.length - warnings.length}/${total} pass · ${failures.length} fail · ${warnings.length} warn`);
  if (failures.length) lines.push(`\n  Fix the ${failures.length} failure${failures.length === 1 ? '' : 's'} above — CI stops on these.\n`);
  else if (warnings.length && !strict) lines.push('\n  Warnings do not fail the build; `--strict` makes them.\n');
  return lines.join('\n');
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const args = process.argv.slice(2);
  const only = args.includes('--only')
    ? (args[args.indexOf('--only') + 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    : null;
  const outcome = runChecks({ online: args.includes('--online'), only });
  const strict = args.includes('--strict');
  if (args.includes('--json')) {
    console.log(JSON.stringify({ ...outcome, ok: outcome.failures.length === 0 && (!strict || outcome.warnings.length === 0) }, null, 2));
  } else {
    console.log(formatReport(outcome, { strict }));
  }
  const failed = outcome.failures.length > 0 || (strict && outcome.warnings.length > 0);
  process.exit(failed ? 1 : 0);
}
