import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * v1.35.5 — the black area below a scrolled mobile page.
 *
 * `html, body, #root { height: 100% }` plus `background-attachment: fixed` on
 * `body` means the body box is only one viewport tall on a phone. Once the page
 * scrolls past it, the browser paints its own canvas — black in dark mode, and
 * reported black in light mode too on the affected device. The fix lets the
 * document grow, paints `html`, and lets the tint scroll.
 */

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const CSS = read('../src/styles.css');

test('the desktop base rule is still a full-height frame', () => {
  assert.match(CSS, /^html, body, #root \{ height: 100%; \}/m);
  assert.match(CSS, /^body \{[\s\S]*?background-attachment: fixed;/m);
});

test('mobile scrolling keeps a painted background in both themes', () => {
  assert.ok(CSS.includes('v1.35.5 — a mobile page taller than the viewport'),
    'the rationale for the fix must stay with the CSS');
  assert.match(CSS, /html, body, #root \{ height: auto; min-height: 100%; \}/);
  assert.match(CSS, /html \{ background: var\(--bg\); \}/);
  assert.match(CSS, /body \{ background-attachment: scroll; \}/);
});

test('the mobile fix is inside the 1080px media query, not a global override', () => {
  const at = CSS.indexOf('@media (max-width: 1080px) {');
  assert.ok(at !== -1, 'the mobile media query is missing');
  const block = CSS.slice(at, CSS.indexOf('\n}', at));
  assert.match(block, /html, body, #root \{ height: auto; min-height: 100%; \}/);
  assert.match(block, /html \{ background: var\(--bg\); \}/);
  assert.match(block, /body \{ background-attachment: scroll; \}/);
  // the print rule is a different concern and must not be confused with it
  assert.match(CSS, /@media print \{[\s\S]*?html, body, #root \{ height: auto !important; min-height: 0 !important; \}/);
});
