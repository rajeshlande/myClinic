import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The sidebar, on a short screen.
 *
 * `.sidebar` was a `100dvh` flex column with no `overflow`, and its last children
 * were the plan card and the account row. On a 1280×720 laptop the links plus that
 * card were taller than the viewport, so the last links and the account row fell off
 * the bottom with no way to reach them: a flex child only scrolls if something tells
 * it that it may shrink.
 *
 * v1.33.0 made the *links* the scroll region and pinned the rest, and put sign-out
 * where people actually work — the desktop sidebar, which had no way out at all
 * (only Settings → My account and the mobile drawer had one).
 */

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const CSS = read('../src/styles.css');
const LAYOUT = read('../src/components/AppLayout.jsx');

const rule = (selector) => {
  const at = CSS.indexOf(`\n${selector} {`);
  assert.ok(at !== -1, `${selector} is missing from styles.css`);
  return CSS.slice(at, CSS.indexOf('}', at));
};

test('the sidebar itself does not scroll — the links do', () => {
  const sidebar = rule('.sidebar');
  // the column stays a fixed 100dvh frame…
  assert.match(sidebar, /height: 100dvh/);
  // …and refuses to leak its children past the bottom edge
  assert.match(sidebar, /overflow: hidden/);
  assert.match(sidebar, /min-height: 0/);

  const scroll = rule('.sidebar-scroll');
  assert.match(scroll, /overflow-y: auto/, 'the links need their own scroller');
  // without min-height: 0 a flex child will not shrink below its content, which is
  // exactly how the links escaped the viewport instead of scrolling
  assert.match(scroll, /min-height: 0/);
  assert.match(scroll, /flex: 1 1 auto/);
  // scrolling the nav must not scroll the page behind it
  assert.match(scroll, /overscroll-behavior: contain/);
  // and the scrollbar appearing must not shift the labels
  assert.match(scroll, /scrollbar-gutter: stable/);
});

test('the plan card and the account row are pinned, not scrolled away', () => {
  const at = rule('.sidebar-foot');
  assert.match(at, /margin-top: auto/);
  assert.match(at, /flex: 0 0 auto/, 'the foot must not shrink when the links do');

  // structure: the scroll region opens before the nav groups and closes before the foot
  const scrollOpen = LAYOUT.indexOf('<div className="sidebar-scroll">');
  const foot = LAYOUT.indexOf('<div className="sidebar-foot">');
  const scrollClose = LAYOUT.lastIndexOf('</div>', foot);
  assert.ok(scrollOpen !== -1, 'the link region is not marked as the scroll container');
  assert.ok(foot > scrollOpen, 'the foot must come after the scroll region');
  assert.ok(scrollClose > scrollOpen && scrollClose < foot, 'the foot is inside the scroller');
});

test('every nav item is inside the scroll region — the wrapper did not drop links', () => {
  const scrollOpen = LAYOUT.indexOf('<div className="sidebar-scroll">');
  const foot = LAYOUT.indexOf('<div className="sidebar-foot">');
  const region = LAYOUT.slice(scrollOpen, foot);
  assert.match(region, /NAV\.map/, 'the groups must be rendered inside the scroller');
  assert.match(region, /<NavLink/, 'the links must be inside the scroller');
  // the NAV table itself still holds the three groups and twelve destinations
  // (5 clinic · 4 records & money · 3 clinic setup)
  const navTable = LAYOUT.slice(LAYOUT.indexOf('const NAV = ['), LAYOUT.indexOf('];', LAYOUT.indexOf('const NAV = [')));
  assert.equal((navTable.match(/\{ group:/g) ?? []).length, 3);
  assert.equal((navTable.match(/to: '\/app\//g) ?? []).length, 12);
  // each one is rendered as a link inside the scroller
  assert.equal((region.match(/<NavLink/g) ?? []).length, 1, 'links are rendered once, from the table');
});

test('signing out is one implementation with two doors', () => {
  // one handler, one call to the auth method
  assert.equal((LAYOUT.match(/async function handleSignOut\(/g) ?? []).length, 1);
  assert.equal((LAYOUT.match(/await signOut\(\)/g) ?? []).length, 1, 'sign-out is implemented twice');
  // double-click guard: a second click must not sign out twice
  assert.match(LAYOUT, /if \(signingOut\) return;/);
  assert.match(LAYOUT, /setSigningOut\(true\)/);
  assert.match(LAYOUT, /navigate\('\/'\)/, 'signing out must leave the app');
  // both the sidebar and the mobile drawer use it
  assert.ok((LAYOUT.match(/onClick=\{handleSignOut\}/g) ?? []).length >= 2);
});

test('the sidebar has a sign-out control, and only when there is a session', () => {
  const foot = LAYOUT.slice(LAYOUT.indexOf('<div className="sidebar-foot">'));
  assert.match(foot, /<IconButton/, 'the desktop sidebar still has no sign-out control');
  assert.match(foot, /label="Sign out"/, 'the control needs an accessible name');
  assert.match(foot, /icon=\{LogOut\}/);
  assert.match(foot, /disabled=\{signingOut\}/, 'the button must show it is working');
  // gated: a demo workspace has no session to end, so the control is absent, not dead
  assert.match(foot, /\{configured \? \(/, 'sign-out must be gated on a configured session');
  // the account row still opens Settings, and the two share a line
  const account = foot.slice(foot.indexOf('sidebar-account'), foot.indexOf('sidebar-account') + 1200);
  assert.match(account, /className="user-chip"[\s\S]{0,120}navigate\('\/app\/settings'\)/);
  assert.match(rule('.sidebar-account .user-chip'), /flex: 1 1 auto/);
});

test('the drawer keeps its own sign-out and its own scrolling', () => {
  assert.match(LAYOUT, /Mobile drawer/);
  // the drawer is still the mobile route to the same actions
  assert.match(LAYOUT, /Issue token<\/Button>/);
  // and it renders the same nav fragment, so it inherits the scroll region
  assert.match(LAYOUT, /\{nav\}/);
});
