import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWED_DEPENDENCIES, SECRET_SCAN_SKIP, findSecrets, envFileTracked, isScannable,
  unbalancedListeners, unsafeHtml, namingProblems, parseFrontmatter, versionAgreement,
  runChecks, formatReport,
} from '../scripts/check-contributing.mjs';

/* --------------------------------------------------- §1 secrets at the boundary */

/*
 * Every credential-shaped string in this file is assembled from pieces at run
 * time. Written out whole, each one is a fetchable string in a public repository,
 * and a secret scanner — GitHub's, or anyone's — cannot tell a fixture from a
 * leak: it raises the same alert, notifies the provider, and teaches everyone to
 * ignore the next alert. So the shapes live here only once they have been joined,
 * and `SECRET_SCAN_SKIP` no longer excludes tests/ — if this discipline lapses,
 * `npm run check:contributing` fails before a scanner ever sees it.
 */
const fake = (...parts) => parts.join('');

test('a credential shape is found, and the line is named but never echoed', () => {
  const jwt = ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', 'eyJyb2xlIjoiYW5vbiJ9', 'c2lnbmF0dXJlLWhlcmU'].join('.');
  const found = findSecrets('src/lib/x.js', `const key = '${jwt}';\nconst other = 1;\n`);
  assert.equal(found.length, 1);
  assert.equal(found[0].id, 'jwt');
  assert.equal(found[0].line, 1);
  assert.equal(found[0].file, 'src/lib/x.js');
  assert.ok(!JSON.stringify(found).includes(jwt), 'the report must not repeat the secret');
});

test('the shapes that matter are caught: private keys, tokens, service keys', () => {
  const cases = [
    [fake('-----BEGIN RSA', ' PRIVATE KEY-----'), 'private-key'],
    [fake('const k = "sb', '_secret_', 'abcdefghijklmnopqrst"'), 'supabase-secret'],
    [fake('AKIA', 'IOSFODNN7EXAMPLE'), 'aws'],
    [fake('ghp', '_aB3dE5gH7jK9mN1pQ2sT4vW6yZ8bC0dE1fG3'), 'github-token'],
    [fake('xoxb', '-1234567890abcdef'), 'slack'],
    [fake('AIza', 'SyA1234567890abcdefghijklmnopqrstuv'), 'google-api'],
  ];
  for (const [line, id] of cases) {
    assert.equal(findSecrets('f.js', line)[0]?.id, id, `${id} should be detected`);
  }
});

test('prose about secrets is not a secret', () => {
  // The words appear in this codebase as guards and documentation. Flagging them
  // would teach contributors to ignore the check.
  assert.deepEqual(findSecrets('src/lib/supabase.js', "! /service_role|sb_secret/i.test(key)"), []);
  assert.deepEqual(findSecrets('CONTRIBUTING.md', 'Never put a service_role key in a VITE_ variable.'), []);
  assert.deepEqual(findSecrets('a.js', 'const password = "hunter2";'), [], 'a generic password literal is a test fixture, not a credential shape');
});

test('tests are scanned like any other file, so fixtures cannot hide a shape', () => {
  // The GitHub alert that prompted this: a Google-key-shaped fixture in this very
  // file. `tests/` was exempt from our own scan, which is why it was green while
  // a scanner with no allowlist told the world otherwise.
  assert.ok(!SECRET_SCAN_SKIP.includes('tests/'), 'tests/ must not be exempt');
  assert.equal(isScannable('tests/contributing.test.mjs'), true);
  assert.deepEqual(findSecrets('tests/x.test.mjs', fake('AIza', 'SyA1234567890abcdefghijklmnopqrstuv')), [
    { file: 'tests/x.test.mjs', line: 1, id: 'google-api', label: 'Google API key' },
  ]);
});

test('a tracked .env is a failure; .env.example is not', () => {
  assert.deepEqual(envFileTracked(['src/a.js', '.env', '.env.local', '.env.example']), ['.env', '.env.local']);
  assert.deepEqual(envFileTracked(['a.js', '.env.example']), []);
});

test('raw HTML injection is refused', () => {
  assert.equal(unsafeHtml('src/a.jsx', '<div dangerouslySetInnerHTML={{ __html: x }} />'), 'src/a.jsx');
  assert.equal(unsafeHtml('src/a.jsx', 'el.innerHTML = html;'), 'src/a.jsx');
  assert.equal(unsafeHtml('src/a.jsx', '<div>{x}</div>'), null);
  assert.equal(unsafeHtml('src/a.css', 'innerHTML'), null, 'only source files are scanned');
});

/* ------------------------------------------------------ §2 resource management */

test('a listener without a cleanup is flagged, one with a cleanup is not', () => {
  const leaky = "window.addEventListener('online', check);";
  assert.deepEqual(unbalancedListeners('src/lib/x.js', leaky), { file: 'src/lib/x.js', added: 1, removed: 0 });

  const tidy = "window.addEventListener('online', check);\nreturn () => window.removeEventListener('online', check);";
  assert.equal(unbalancedListeners('src/lib/x.js', tidy), null);

  const timers = 'setInterval(tick, 1000);\nclearInterval(id);';
  assert.equal(unbalancedListeners('src/lib/x.js', timers), null, 'a cleared interval balances');

  assert.equal(unbalancedListeners('README.md', "addEventListener('x')"), null, 'only JavaScript is parsed');
});

test('the service worker effect is balanced — the regression this check exists for', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync('src/lib/pwa.jsx', 'utf8');
  assert.equal(unbalancedListeners('src/lib/pwa.jsx', source), null);
});

/* ---------------------------------------------------------- §3 style conventions */

test('components and pages are PascalCase, and the shared kit is exempt', () => {
  assert.deepEqual(namingProblems(['src/pages/PrescriptionView.jsx', 'src/components/Branding.jsx']), []);
  assert.deepEqual(namingProblems(['src/components/ui.jsx']), [], 'the primitive kit is a deliberate exception');
  const problems = namingProblems(['src/components/consultationForm.jsx']);
  assert.equal(problems.length, 1);
  assert.match(problems[0].rule, /PascalCase/);
  assert.equal(namingProblems(['src/lib/RxLanguage.js']).length, 1, 'lib modules are lower-case');
});

test('version, package and changelog agree — or the check says which one is out', () => {
  const ok = versionAgreement({
    pkg: { version: '1.18.0' },
    versionFile: "export const APP_VERSION = '1.18.0';\nexport const SCHEMA_VERSION = 16;",
    changelog: '# Changelog\n\n## [1.18.0] — 2026-11-06 · schema 16\n',
  });
  assert.deepEqual(ok, { fromPackage: '1.18.0', appVersion: '1.18.0', schemaVersion: 16, changelogHead: '1.18.0' });

  const drifted = versionAgreement({
    pkg: { version: '1.19.0' }, versionFile: "APP_VERSION = '1.18.0'", changelog: '## [1.18.0]',
  });
  assert.notEqual(drifted.fromPackage, drifted.appVersion);
});

test('frontmatter is read the way an agent reads it', () => {
  const meta = parseFrontmatter('---\nname: security-audit\ndescription: Audit a codebase.\n---\n\n# Body\n');
  assert.deepEqual(meta, { name: 'security-audit', description: 'Audit a codebase.' });
  assert.equal(parseFrontmatter('# no frontmatter'), null);
});

/* -------------------------------------------------- the vendored audit skill */

test('the vendored Cloudflare skill is present and loadable', async () => {
  const { readFileSync } = await import('node:fs');
  const skill = readFileSync('.claude/skills/security-audit/SKILL.md', 'utf8');
  const meta = parseFrontmatter(skill);
  assert.equal(meta.name, 'security-audit');
  assert.ok(meta.description.length > 100, 'the description is how the agent decides to load it');
  assert.match(readFileSync('.claude/skills/security-audit/VENDORED.md', 'utf8'), /Pinned commit \| `[0-9a-f]{40}`/);
});

/* ------------------------------------------------------------- the report itself */

test('this repository passes its own contributing checks', () => {
  const outcome = runChecks({});
  assert.equal(outcome.failures.length, 0, formatReport(outcome));
  assert.ok(outcome.results.length >= 20, 'every standard is represented by at least one check');
  const ids = outcome.results.map((r) => r.id);
  for (const required of ['secrets', 'env-files', 'deps-allowlist', 'listeners', 'naming', 'version', 'skill-present']) {
    assert.ok(ids.includes(required), `${required} is checked`);
  }
});

test('the report says what failed and exits non-zero on it', () => {
  const report = formatReport({
    results: [
      { id: 'a', status: 'pass', title: 'a passing rule', detail: 'fine' },
      { id: 'b', status: 'fail', title: 'a broken rule', detail: 'because' },
    ],
    failures: [{ id: 'b' }], warnings: [],
  });
  assert.match(report, /✓ a passing rule/);
  assert.match(report, /✗ a broken rule/);
  assert.match(report, /1 fail/);
  assert.match(report, /CI stops on these/);
});

test('the safe-list is the documented one', () => {
  assert.ok(ALLOWED_DEPENDENCIES.includes('react'));
  assert.ok(ALLOWED_DEPENDENCIES.includes('@supabase/supabase-js'));
  assert.ok(!ALLOWED_DEPENDENCIES.some((n) => /analytics|sentry|segment|mixpanel|gtag/i.test(n)),
    'no analytics or telemetry package may enter the list by accident');
});
