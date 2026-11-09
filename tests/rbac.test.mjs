import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ROLES, ROLE_MATRIX, capabilitiesFor, can, roleMatrixFor, ROUTE_CAPABILITY,
} from '../src/lib/permissions.js';

/**
 * The role table the product publishes:
 *
 *   Clinic owner  Billing, plans, staff and every clinical record.
 *                 Dashboard & reports ✓   Patient charts ✓
 *                 Consultations & prescriptions ✓   Billing & payments ✓
 *                 Clinic settings & plan ✓   Invite or remove staff ✓
 *
 *   Doctor        Own appointments, consultations and prescriptions.
 *                 Dashboard & reports ✓   Patient charts ✓
 *                 Consultations & prescriptions ✓   Billing & payments —
 *                 Clinic settings & plan —   Invite or remove staff —
 *
 *   Front desk    Appointments, patient registration, payments.
 *                 Dashboard & reports ✓   Patient charts ✓
 *                 Consultations & prescriptions —   Billing & payments ✓
 *                 Clinic settings & plan —   Invite or remove staff —
 *
 * It used to be printed by hand in Team.jsx, where one row was a tautology
 * (`role.id !== 'frontdesk' || true`), and the app disagreed with it in three
 * places: front desk could not open Reports, could open Consultations, and a
 * doctor could open Billing and raise invoices. These tests pin the table, the
 * capability map, the routes and the SQL policies to that one promise.
 */
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const schema = read('../supabase/schema.sql');
const team = read('../src/pages/Team.jsx');
const app = read('../src/App.jsx');
const layout = read('../src/components/AppLayout.jsx');
const consultationForm = read('../src/components/ConsultationForm.jsx');

const PUBLISHED = {
  owner: {
    'Dashboard & reports': true,
    'Patient charts': true,
    'Consultations & prescriptions': true,
    'Billing & payments': true,
    'Clinic settings & plan': true,
    'Invite or remove staff': true,
  },
  doctor: {
    'Dashboard & reports': true,
    'Patient charts': true,
    'Consultations & prescriptions': true,
    'Billing & payments': false,
    'Clinic settings & plan': false,
    'Invite or remove staff': false,
  },
  frontdesk: {
    'Dashboard & reports': true,
    'Patient charts': true,
    'Consultations & prescriptions': false,
    'Billing & payments': true,
    'Clinic settings & plan': false,
    'Invite or remove staff': false,
  },
};

test('every role renders exactly the published table', () => {
  // The order is the order the Team page prints.
  const labels = ROLE_MATRIX.map((row) => row.label);
  assert.deepEqual(labels, [
    'Dashboard & reports', 'Patient charts', 'Consultations & prescriptions',
    'Billing & payments', 'Clinic settings & plan', 'Invite or remove staff',
  ]);
  for (const role of ROLES) {
    const printed = Object.fromEntries(roleMatrixFor(role).map((row) => [row.label, row.allowed]));
    assert.deepEqual(printed, PUBLISHED[role], `the ${role} row does not match the published table`);
  }
});

test('the three disagreements that started this are gone', () => {
  // front desk: reports yes, consultations no
  assert.equal(can('frontdesk', 'clinic:reports'), true);
  assert.equal(can('frontdesk', 'consultation:read'), false);
  assert.equal(can('frontdesk', 'consultation:write'), false);
  // doctor: chart yes, money no
  assert.equal(can('doctor', 'consultation:read'), true);
  assert.equal(can('doctor', 'invoice:read'), false);
  assert.equal(can('doctor', 'invoice:create'), false);
  assert.equal(can('doctor', 'invoice:collect'), false);
  // owner: both halves
  for (const cap of ['consultation:read', 'invoice:read', 'clinic:settings', 'team:write']) {
    assert.equal(can('owner', cap), true, cap);
  }
  // nobody but the owner sets up the clinic
  for (const role of ['doctor', 'frontdesk']) {
    assert.equal(can(role, 'clinic:settings'), false, role);
    assert.equal(can(role, 'team:write'), false, role);
  }
});

test('an unknown capability fails closed', () => {
  for (const role of ROLES) assert.equal(can(role, 'invoice:teleport'), false);
});

test('every guarded route and nav item names a capability that exists', () => {
  for (const [path, capability] of Object.entries(ROUTE_CAPABILITY)) {
    if (capability === null) continue;
    const known = ROLES.some((role) => can(role, capability));
    assert.ok(known, `${path} guards on unknown capability ${capability}`);
  }
  const caps = [...layout.matchAll(/capability: '([^']+)'/g)].map((m) => m[1]).concat(
    [...app.matchAll(/capability="([^"]+)"/g)].map((m) => m[1]),
  );
  assert.ok(caps.length >= 7, 'expected the nav and routes to carry capabilities');
  for (const capability of caps) {
    assert.ok(ROLES.some((role) => can(role, capability)), `unknown capability ${capability}`);
  }
  // the screens each role reaches
  assert.equal(can('frontdesk', 'clinic:reports'), true, 'front desk can open Reports');
  assert.equal(can('doctor', 'invoice:read'), false, 'a doctor cannot open Billing');
  assert.equal(can('frontdesk', 'consultation:read'), false, 'front desk cannot open Consultations');
});

test('the routes themselves are guarded, not just the menu', () => {
  assert.match(app, /path="consultations" element=\{<RequireCapability capability="consultation:read">/);
  assert.match(app, /path="follow-ups" element=\{<RequireCapability capability="consultation:read">/);
  assert.match(app, /path="billing" element=\{<RequireCapability capability="invoice:read">/);
  assert.match(app, /path="day-close" element=\{<RequireCapability capability="day:close">/);
  assert.match(app, /path="reports" element=\{<RequireCapability capability="clinic:reports">/);
  assert.match(app, /path="subscription" element=\{<RequireCapability capability="clinic:settings">/);
});

test('the Team page prints the table from capabilities, not from a hard-coded list', () => {
  assert.match(team, /roleMatrixFor\(role\.id\)/);
  assert.doesNotMatch(team, /\['Dashboard & reports', true\]/);
  assert.doesNotMatch(team, /\|\| true/, 'a tautology in the role table is how it started');
  assert.doesNotMatch(team, /\['Billing & payments', role\.id !== 'doctor'\]/);
});

test('no screen offers a doctor a bill', () => {
  // The consultation form is the only place a doctor could have raised one.
  assert.match(consultationForm, /const canBill = can\(store\.role \?\? 'owner', 'invoice:create'\)/);
  assert.match(consultationForm, /if \(createInvoice && canBill\)/);
  assert.match(consultationForm, /\{canBill \? \(/);
});

test('schema 10 draws the same line as the capability map', () => {
  const migration = schema.slice(schema.indexOf("schema 10 (role split)"));
  // consultations: owner + doctor, never front desk
  assert.match(migration, /create policy consultations_read on public\.consultations for select to authenticated\s*\n\s*using \(public\.has_role\(clinic_id, array\['owner','doctor'\]\)\)/);
  // invoices: owner + front desk, never doctor
  assert.match(migration, /create policy invoices_read on public\.invoices for select to authenticated\s*\n\s*using \(public\.has_role\(clinic_id, array\['owner','frontdesk'\]\)\)/);
  assert.match(migration, /create policy invoices_write on public\.invoices for insert to authenticated\s*\n\s*with check \(public\.has_role\(clinic_id, array\['owner','frontdesk'\]\)\)/);
  // update carries both halves: `using` picks the rows, `with check` the new ones
  assert.match(migration, /create policy invoices_update on public\.invoices for update to authenticated\s*\n\s*using \(public\.has_role\(clinic_id, array\['owner','frontdesk'\]\)\)\s*\n\s*with check \(public\.has_role\(clinic_id, array\['owner','frontdesk'\]\)\)/);
  assert.match(schema, /values \(10, 'role-split', '1\.11\.6'/);
  assert.match(schema, /set schema_version = 10/);
});

test('the capability map and the SQL policies cannot drift apart', () => {
  // Read the role lists out of the two policy bodies and compare them with the
  // capability table, so adding a role to one place and not the other fails here
  // rather than in a clinic.
  const rolesIn = (policyName) => {
    const at = schema.indexOf(`create policy ${policyName}`);
    const body = schema.slice(at, schema.indexOf(';', at));
    return (body.match(/'([a-z]+)'/g) ?? []).map((r) => r.replace(/'/g, '')).sort();
  };
  const expected = (capability) => ROLES.filter((role) => can(role, capability)).sort();
  assert.deepEqual(rolesIn('consultations_read'), expected('consultation:read'));
  assert.deepEqual(rolesIn('invoices_read'), expected('invoice:read'));
  assert.deepEqual(rolesIn('invoices_write'), expected('invoice:create'));
});

test('a role with half the clinic still gets the numbers it can see', () => {
  // The App must not read "no consultation rows" as "no patients came in".
  const logic = read('../src/lib/logic.mjs');
  const daybook = read('../src/lib/daybook.mjs');
  assert.match(logic, /canSeeConsultations = true/);
  assert.match(daybook, /canSeeConsultations = true/);
  for (const page of ['../src/pages/Dashboard.jsx', '../src/pages/Reports.jsx', '../src/pages/DayClose.jsx']) {
    assert.match(read(page), /canSeeConsultations: canReadConsults/, `${page} does not pass the flag`);
  }
  // capabilities of each role are what the store exposes as `role`
  assert.deepEqual([...capabilitiesFor('frontdesk')].filter((c) => c.startsWith('consultation')), []);
});

test('the shortcuts follow the same line as the screens', () => {
  const dashboard = read('../src/pages/Dashboard.jsx');
  // "Day close" is deliberately *not* a shortcut in the greeting band any more
  // (v1.26.0): reconciliation stopped competing with "Issue token" on the home
  // screen. It keeps its sidebar entry and its route guard, so the till is still
  // reachable by exactly the roles that hold day:close.
  assert.doesNotMatch(dashboard, /Day close/);
  assert.match(layout, /to: '\/app\/day-close', label: 'Day close', icon: Sunset, capability: 'day:close'/);
  assert.match(app, /path="day-close" element=\{<RequireCapability capability="day:close">/);
  // and the invoice count in the greeting belongs to the role that can see invoices
  assert.match(dashboard, /canSeeMoney && duesCount \?/);
  // the quick-register card offered a doctor a bill
  assert.match(dashboard, /\{canSeeMoney \? <Button size="sm" variant="ghost" icon=\{CreditCard\}/);
  // the command palette drops what the role cannot open, and stops searching invoices
  assert.match(layout, /const canReadInvoices = can\(role, 'invoice:read'\)/);
  assert.match(layout, /if \(!q\.trim\(\) \|\| !canReadInvoices\) return \[\]/);
  assert.match(layout, /capability: 'invoice:create'/);
  assert.match(layout, /\.filter\(\(a\) => !a\.capability \|\| can\(role, a\.capability\)\)/);
});

test('the printable views are guarded like the pages that link to them', () => {
  assert.match(app, /path="\/invoice\/:id" element=\{<RequireCapability capability="invoice:read">/);
  assert.match(app, /path="\/prescription\/:id" element=\{<RequireCapability capability="consultation:read">/);
});

test('the front desk does not get the owner\'s back-office screens', () => {
  // Reported from the clinic: a front-desk seat could open Doctors & staff, Day
  // close and the subscription panel. Taking money is theirs; reconciling the
  // drawer, the roster and the plan are not.
  assert.equal(can('frontdesk', 'day:close'), false);
  assert.equal(can('frontdesk', 'team:read'), false);
  assert.equal(can('frontdesk', 'clinic:settings'), false);
  assert.equal(can('frontdesk', 'invoice:collect'), true, 'collecting at the counter stays theirs');

  // …and the seats that do own them still have them.
  assert.equal(can('owner', 'day:close'), true);
  assert.equal(can('owner', 'team:read'), true);
  assert.equal(can('doctor', 'team:read'), true, 'a doctor can see the roster');
  assert.equal(can('doctor', 'day:close'), false, 'a doctor does not close the till');

  // the nav and the routes agree with the matrix
  assert.match(layout, /to: '\/app\/day-close', label: 'Day close', icon: Sunset, capability: 'day:close'/);
  assert.match(layout, /to: '\/app\/team', label: 'Doctors & staff', icon: ClipboardList, capability: 'team:read'/);
  assert.equal(ROUTE_CAPABILITY['/app/day-close'], 'day:close');
  assert.equal(ROUTE_CAPABILITY['/app/team'], 'team:read');

  const dayClose = read('../src/pages/DayClose.jsx');
  assert.match(dayClose, /const canClose = can\(store\.role \?\? 'owner', 'day:close'\)/);
});

test('the settings page shows a seat only what it can act on', () => {
  const settings = read('../src/pages/Settings.jsx');
  // tabs are derived; the clinic's identity, GST and plan need clinic:settings
  assert.match(settings, /const visibleTabs = \[/);
  assert.match(settings, /const activeTab = visibleTabs\.some\(\(t\) => t\.value === tab\) \? tab : visibleTabs\[0\]\.value/);
  assert.match(settings, /\.\.\.\(canEdit \? \[/);
  assert.match(settings, /{ value: 'account', label: 'My account' }/);
  assert.match(settings, /{ value: 'appearance', label: 'Appearance & colours' }/);
  assert.match(settings, /{ value: 'sync', label: 'Offline & sync' }/);
  // no section is still keyed off the raw tab value
  assert.doesNotMatch(settings, /\{tab === '/);

  // what a front-desk seat keeps, and what it loses
  for (const owner_tab of ["'clinic'", "'branding'", "'billing'", "'plan'"]) {
    const line = settings.split('\n').find((l) => l.includes(`{ value: ${owner_tab}`));
    assert.ok(line, `${owner_tab} tab exists`);
  }
  assert.match(settings, /const canEdit = can\(role, 'clinic:settings'\)/);
});

test('the sidebar plan panel is absent for a seat that cannot open the plan', () => {
  assert.match(layout, /\{can\(role, 'clinic:settings'\) \? \(\s*<div className="plan-card">/);
  assert.doesNotMatch(layout, /clinic owner manages the plan\./);
});
