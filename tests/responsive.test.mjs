import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FOOTER_GROUPS, LAYOUTS, PHONE_MAX, TABLET_MAX, footerLinks, isCompact, layoutFor, usesMenu,
} from '../src/lib/responsive.mjs';

test('layoutFor picks the phone bucket up to 640px', () => {
  assert.equal(layoutFor(320), 'phone');
  assert.equal(layoutFor(390), 'phone');
  assert.equal(layoutFor(PHONE_MAX), 'phone');
});

test('layoutFor is a tablet from 641 to 900', () => {
  assert.equal(layoutFor(PHONE_MAX + 1), 'tablet');
  assert.equal(layoutFor(768), 'tablet');
  assert.equal(layoutFor(TABLET_MAX), 'tablet');
});

test('layoutFor is desktop above 900', () => {
  assert.equal(layoutFor(TABLET_MAX + 1), 'desktop');
  assert.equal(layoutFor(1024), 'desktop');
  assert.equal(layoutFor(2560), 'desktop');
});

test('a missing or nonsense width falls back to desktop', () => {
  assert.equal(layoutFor(undefined), 'desktop');
  assert.equal(layoutFor(null), 'desktop');
  assert.equal(layoutFor(0), 'desktop');
  assert.equal(layoutFor(-400), 'desktop');
  assert.equal(layoutFor(NaN), 'desktop');
  assert.equal(layoutFor('wide'), 'desktop');
});

test('only the phone layout collapses content', () => {
  assert.equal(isCompact('phone'), true);
  assert.equal(isCompact('tablet'), false);
  assert.equal(isCompact('desktop'), false);
});

test('the nav links only fold away below desktop', () => {
  assert.equal(usesMenu('phone'), true);
  assert.equal(usesMenu('tablet'), true);
  assert.equal(usesMenu('desktop'), false);
});

test('every width lands in a known bucket', () => {
  for (let w = 280; w <= 1600; w += 37) assert.ok(LAYOUTS.includes(layoutFor(w)), `${w}px`);
});

test('the footer keeps three titled groups', () => {
  assert.equal(FOOTER_GROUPS.length, 3);
  for (const group of FOOTER_GROUPS) {
    assert.equal(typeof group.title, 'string');
    assert.ok(group.title.length > 0);
    assert.ok(group.links.length >= 2, `${group.title} needs at least two links`);
  }
});

test('no two footer links share a label', () => {
  const labels = footerLinks().map((l) => l.label);
  assert.equal(new Set(labels).size, labels.length);
});

test('each footer link is either an in-page anchor or an app route, never both', () => {
  for (const link of footerLinks()) {
    const has = (k) => typeof link[k] === 'string' && link[k].length > 0;
    assert.ok(has('href') !== has('to'), `${link.label} must have exactly one target`);
    if (has('href')) assert.match(link.href, /^#[a-z-]+$/);
    if (has('to')) assert.match(link.to, /^\/[a-z/-]*$/);
  }
});

test('footer routes point at screens that exist', () => {
  const known = new Set([
    '/login', '/signup', '/setup', '/app/dashboard', '/book/sunrise-multispecialty',
  ]);
  for (const link of footerLinks()) {
    if (link.to) assert.ok(known.has(link.to), `${link.label} → ${link.to} is not a known route`);
  }
});

test('footer anchors match sections on the landing page', () => {
  const sections = new Set(['#features', '#workflow', '#pricing', '#security']);
  for (const link of footerLinks()) {
    if (link.href) assert.ok(sections.has(link.href), `${link.label} → ${link.href}`);
  }
});

test('footerLinks flattens without losing anything', () => {
  const flat = footerLinks();
  const total = FOOTER_GROUPS.reduce((n, g) => n + g.links.length, 0);
  assert.equal(flat.length, total);
  assert.ok(flat.every((l) => typeof l.group === 'string' && l.group.length > 0));
});

test('the same data can be re-grouped for another layout', () => {
  const custom = [{ title: 'Only', links: [{ label: 'Pricing', href: '#pricing' }] }];
  assert.deepEqual(footerLinks(custom), [{ label: 'Pricing', href: '#pricing', group: 'Only' }]);
});
