import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

/**
 * Settings: one panel per tab.
 *
 * v1.30.0 moved the eight tab panels out of `src/pages/Settings.jsx` into
 * `src/components/settings/<Tab>Tab.jsx`. The markup was moved verbatim and the
 * state, the save handlers and the slug derivation stayed on the page, so the
 * split is invisible to a clinic. These tests guard the three ways it could stop
 * being invisible: a tab losing its panel, the page quietly changing which tab it
 * opens on (or in which order), and the page growing back into a monolith.
 */
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const page = read('../src/pages/Settings.jsx');
const tabsDir = new URL('../src/components/settings/', import.meta.url);

const TABS = [
  ['clinic', 'ClinicTab'],
  ['branding', 'BrandingTab'],
  ['billing', 'BillingTab'],
  ['account', 'AccountTab'],
  ['appearance', 'AppearanceTab'],
  ['sync', 'SyncTab'],
  ['about', 'AboutTab'],
  ['plan', 'PlanDataTab'],
];

const component = (name) => read(`../src/components/settings/${name}.jsx`);
const lines = (text) => text.replace(/\n$/, '').split('\n').length;
/** Comments are documentation, not UI — hidden strings may appear in a rationale. */
const uiOnly = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

test('every tab id the page can show has a panel of its own', () => {
  for (const [id, name] of TABS) {
    assert.ok(existsSync(new URL(`${name}.jsx`, tabsDir)), `${name}.jsx is missing`);
    // the panel is selected by tab id, exactly as before the split
    assert.match(page, new RegExp(`^    ${id}: <${name} `, 'm'), `panels[${id}] no longer builds <${name}>`);
    // and the tab is still offered to somebody: owner-only tabs are inside canEdit
    assert.match(page, new RegExp(`value: '${id}'`), `no tab entry offers ${id}`);
  }
  // nothing else is rendered by id — a stray panel with no tab would be dead markup
  const panels = [...page.matchAll(/^    (\w+): </gm)].map((m) => m[1]).sort();
  assert.deepEqual(panels, TABS.map(([id]) => id).sort());
});

test('the tab list, its order and the tab it opens on are unchanged', () => {
  assert.match(page, /useState\('clinic'\)/, 'Settings must still open on the clinic tab');
  const order = [...page.matchAll(/value: '(\w+)'/g)].map((m) => m[1]);
  assert.deepEqual(order, ['clinic', 'branding', 'billing', 'account', 'appearance', 'sync', 'about', 'plan']);
  // a front-desk seat gets my account, appearance, sync and about — nothing else
  const ownerOnly = [...page.matchAll(/\.\.\.\(canEdit \? \[([\s\S]*?)\] : \[\]\)/g)]
    .flatMap((m) => [...m[1].matchAll(/value: '(\w+)'/g)].map((x) => x[1]));
  assert.deepEqual(ownerOnly, ['clinic', 'branding', 'billing', 'plan'],
    'clinic, branding, billing and plan must stay inside canEdit');
});

test('every panel is a default-exported component that takes props, not the store', () => {
  for (const [, name] of TABS) {
    const body = component(name);
    assert.match(body, new RegExp(`export default function ${name}\\(\\{`), `${name} must default-export a component`);
    // the panel reads the store through the hook, never through a module-level singleton
    assert.doesNotMatch(body, /^const store = /m, `${name} must not capture the store at module level`);
    assert.match(body, /^import .*from '\.\.\/\.\.\/lib\//m, `${name} must import from src/lib through ../../lib/`);
    assert.doesNotMatch(body, /from '\.\.\/lib\//, `${name} still has a one-level-up import (path from src/pages)`);
  }
});

test('no panel imports the page back, and the page imports every panel once', () => {
  for (const [, name] of TABS) {
    assert.doesNotMatch(component(name), /pages\/Settings/, `${name} must not import the page`);
    assert.equal(page.split(`from '../components/settings/${name}.jsx'`).length, 2, `the page imports ${name} more than once`);
  }
});

test('the shared stat tile lives in one file', () => {
  const sources = [page, ...TABS.map(([, n]) => component(n))].join('\n');
  const definitions = [...sources.matchAll(/function MiniStat\(/g)].length;
  assert.equal(definitions, 0, 'MiniStat must be defined in components/settings/MiniStat.jsx only');
  const tile = read('../src/components/settings/MiniStat.jsx');
  assert.match(tile, /export default function MiniStat/);
  for (const [, name] of TABS) {
    if (/<MiniStat/.test(component(name))) {
      assert.match(component(name), /import MiniStat from '\.\/MiniStat\.jsx'/);
    }
  }
});

test('the page is a shell: state and handlers stay, panels do not', () => {
  // the ratchet: 969 lines before the split, and it may not creep back up
  assert.ok(lines(page) < 300, `Settings.jsx is ${lines(page)} lines — the split has been undone`);
  for (const [, name] of TABS) {
    assert.ok(lines(component(name)) < 200, `${name} is ${lines(component(name))} lines — split it further`);
  }
  // the save handlers and the slug derivation are still on the page: a panel that
  // owned them would mean the tab could save without the page knowing
  for (const kept of ['async function saveClinic(', 'async function saveProfile(', 'const savedSlug =',
    'const typedSlug =', 'const followUpError =', 'const nextClosedLine =']) {
    assert.ok(page.includes(kept), `Settings.jsx lost ${kept}`);
  }
});

test('no panel was given a copy of the save logic', () => {
  for (const [, name] of TABS) {
    const body = component(name);
    // saveClinic / saveProfile stay on the page: a panel that saved on its own
    // would bypass the slug write, the validation and the error explanations
    assert.doesNotMatch(body, /store\.(updateNow|create)\(/, `${name} writes to the database directly`);
    assert.doesNotMatch(body, /setSaving\(/, `${name} owns the saving flag`);
    assert.doesNotMatch(body, /saveBookingSlug\(/, `${name} writes the booking slug itself`);
    // the one write a panel may make is the plan switch it always made, in place
    const writes = [...body.matchAll(/store\.update\(([\s\S]{0,80})/g)].map((m) => m[1]);
    for (const call of writes) {
      assert.match(call, /^'clinic', store\.clinic\.id, \{ plan: plan\.id \}\)/, `${name} writes something other than the plan`);
    }
    if (writes.length) assert.equal(name, 'PlanDataTab', `${name} is not allowed to write at all`);
  }
});

test('the tab folder holds only the panels the page renders', () => {
  const files = readdirSync(tabsDir).filter((f) => f.endsWith('.jsx')).sort();
  assert.deepEqual(files, [...TABS.map(([, n]) => `${n}.jsx`), 'MiniStat.jsx'].sort());
});


test('About & version shows only the app version', () => {
  const about = uiOnly(component('AboutTab'));
  assert.match(about, /<MiniStat label="App version" value=\{`v\$\{APP_VERSION\}`\} tone="brand" \/>/);
  assert.equal((about.match(/<MiniStat/g) ?? []).length, 1, 'exactly one stat tile');
  assert.match(about, /import \{ APP_VERSION \} from '\.\.\/\.\.\/lib\/version\.js'/);
  for (const hidden of [
    'Schema', 'Build', 'Recent problems', "What's new", 'Release notes for this workspace',
    'Your access', 'You are up to date', 'Reload this build', 'CHANGELOG', 'BUILD_LABEL',
    'SCHEMA_VERSION', 'copyDiagnostics', 'problems', 'useStore', 'ROLE_BLURB', 'ROLE_LABEL',
  ]) {
    assert.ok(!about.includes(hidden), `AboutTab still mentions ${hidden}`);
  }
});

test('Plan & data no longer prints the workspace census line', () => {
  const plan = uiOnly(component('PlanDataTab'));
  for (const hidden of [
    'myClinic v1.0', 'connected', 'demo mode', 'consultations', 'Monitor',
  ]) {
    assert.ok(!plan.includes(hidden), `PlanDataTab still mentions ${hidden}`);
  }
  // the cards that matter are still there
  for (const kept of ['Your plan', 'Your data', 'Change plan', 'Export patients (CSV)']) {
    assert.ok(plan.includes(kept), `PlanDataTab lost ${kept}`);
  }
});

test('the Settings page dropped the dead diagnostics state', () => {
  for (const gone of [
    'recentErrors', 'diagnosticsText', 'BUILD_LABEL', 'copyDiagnostics',
    'setProblems', '[problems, setProblems]',
  ]) {
    assert.ok(!page.includes(gone), `Settings.jsx still has ${gone}`);
  }
  assert.match(page, /about: <AboutTab \/>/, 'the About panel takes no props now');
});
