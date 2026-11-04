import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { FOOTER_GROUPS, footerLinks } from '../src/lib/responsive.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const LANDING = read('src/pages/Landing.jsx');

/* ------------------------------------------------------------- the demo door */

test('the marketing page has exactly one demo entry, and it is the footer button', () => {
  // Every other button on the page is the product: plans, sign up, the guide.
  const buttons = LANDING.match(/onClick=\{enterDemo\}[^>]*>([^<]*)</g) ?? [];
  assert.equal(buttons.length, 1, 'one button opens the demo workspace');
  assert.match(buttons[0], />Open Demo</);

  // …and it sits inside the footer's brand block, not the hero, pricing or the
  // closing band.
  const footerStart = LANDING.indexOf('<footer className="mk-footer">');
  assert.ok(footerStart > 0);
  assert.ok(LANDING.indexOf('onClick={enterDemo}') > footerStart, 'the demo button is inside <footer>');
});

test('no other copy on the marketing page offers the demo', () => {
  for (const phrase of ['Explore the live demo', 'Explore the demo', 'Sample patients', 'Open demo', 'See it with sample patients']) {
    assert.ok(!LANDING.includes(phrase), `"${phrase}" is a second way into the demo`);
  }
});

test('nothing on the marketing page links straight into the app', () => {
  // `/app/dashboard` may appear only inside enterDemo(), which the footer button
  // calls; a stray navigate('/app/dashboard') would be a second entrance.
  const appLinks = new Set((LANDING.match(/['"]\/app\/[a-z/]+['"]/g) ?? []));
  assert.deepEqual([...appLinks], ["'/app/dashboard'"], 'only the enterDemo helper may reach the app');

  // and every mention of it is on that helper's line, not in a click handler
  const helperLine = LANDING.split('\n').find((l) => l.includes('const enterDemo'));
  const mentions = LANDING.split('\n').filter((l) => l.includes("'/app/dashboard'"));
  assert.equal(mentions.length, 1, 'the app route appears on the helper line only');
  assert.equal(mentions[0], helperLine);

  const startFree = LANDING.match(/const startFree = \(\) => navigate\(([^)]*)\)/)?.[1] ?? '';
  assert.match(startFree, /configured \? '\/signup' : '\/pricing'/);

  // Pricing, the closing band and the hero all resolve to sign up or pricing.
  assert.ok(!LANDING.includes("navigate(configured ? '/signup' : '/app/dashboard')"));
});

test('the footer link list carries no demo route', () => {
  assert.ok(!footerLinks().some((l) => l.to === '/app/dashboard'), 'the button is the only way in');
  for (const link of footerLinks()) {
    if (link.to) assert.doesNotMatch(link.to, /^\/app\//, `${link.label} points into the app`);
  }
});

test('the footer keeps three groups and every group still has links', () => {
  assert.equal(FOOTER_GROUPS.length, 3);
  for (const group of FOOTER_GROUPS) assert.ok(group.links.length >= 2, group.title);
});

/* -------------------------------------------------- no borrowed-brand references */

test('the repository never names the reference project it grew out of', () => {
  const SKIP = new Set(['node_modules', 'dist', '.git', '.cache', 'coverage', 'build', 'out']);
  const TEXT = /\.(md|js|jsx|mjs|json|sql|html|css|txt|yml|yaml)$/i;
  // spelled in halves so this guard is not its own offender
  const NEEDLE = new RegExp(['my', 'car'].join(''), 'i');
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { walk(rel); continue; }
      if (!TEXT.test(entry.name)) continue;
      if (NEEDLE.test(read(rel))) offenders.push(rel);
    }
  };
  walk('');
  assert.deepEqual(offenders, [], 'no file may name the reference project');
});

test('the third-party notices credit dependencies, not another product', () => {
  const notices = read('THIRD_PARTY_NOTICES.md');
  assert.match(notices, /React/);
  assert.match(notices, /MIT/);
  assert.doesNotMatch(notices, new RegExp(['my', 'car', '|vehicle|reference project'].join(''), 'i'));
});
