import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  BOOKING_SLUG_FALLBACK, BOOKING_SLUG_MAX, bookingSlugFor, bookingUrl, clinicSlug,
} from '../src/lib/public-booking.mjs';

/**
 * The booking link, end to end on the JavaScript side.
 *
 * The bug this guards was not a crash: a clinic was provisioned without a slug,
 * Settings filled the gap with the *demo* clinic's address, and the link it handed
 * out opened a page saying no clinic was published there. So these tests are about
 * one property — the address Settings shows is the address the database answers
 * on — and about the two ways it used to drift: a second slug rule in the page,
 * and a fallback to `sunrise-opd`.
 */
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const settings = read('../src/pages/Settings.jsx');
// Since v1.30.0 the clinic tab's markup lives in its own component while the
// savedSlug / publicLink derivation stayed on the page; the test reads both.
const clinicTab = read('../src/components/settings/ClinicTab.jsx');
const app = read('../src/App.jsx');
const publicBooking = read('../src/pages/PublicBooking.jsx');
const store = read('../src/lib/store.jsx');
const schema = read('../supabase/schema.sql');
const schemaTests = read('../supabase/schema-tests.sql');

const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/* ------------------------------------------------------- the one slug rule */

test('clinicSlug matches public.clinic_slug() in schema.sql', () => {
  // The same cases run against Postgres in supabase/schema-tests.sql (suite D).
  // If either rule moves, these two disagree and a link that looks right 404s.
  assert.equal(clinicSlug('Sunrise Multispecialty OPD'), 'sunrise-multispecialty-opd');
  assert.equal(clinicSlug('  Sunrise Multispecialty OPD!  '), 'sunrise-multispecialty-opd');
  assert.equal(clinicSlug('--Sharma   Clinic--'), 'sharma-clinic');
  assert.equal(clinicSlug('Dr. Mehta Family Clinic'), 'dr-mehta-family-clinic');
  assert.equal(clinicSlug('  Dr. Mehta ENT!  '), 'dr-mehta-ent');
  // what an owner types into the field is normalised as they type
  assert.equal(clinicSlug('Dr Sharma ENT'), 'dr-sharma-ent');
  assert.equal(clinicSlug('A/B'), clinicSlug('A B'));
});

test('clinicSlug never returns the demo clinic and never overruns the column', () => {
  assert.equal(clinicSlug(''), '');
  assert.equal(clinicSlug(null), '');
  assert.equal(clinicSlug(undefined), '');
  assert.equal(clinicSlug('   '), '');
  assert.notEqual(clinicSlug(''), BOOKING_SLUG_FALLBACK);

  // a name with no ASCII letters still becomes an address — the database will
  // mint 'clinic' for it, and the page should predict that rather than show ''
  assert.equal(clinicSlug('डॉ. क्लिनिक'), 'clinic');
  assert.equal(clinicSlug('---'), 'clinic');

  const long = clinicSlug('a'.repeat(80));
  assert.equal(long.length, BOOKING_SLUG_MAX);
  // `clinics_slug_format` allows 1..40 lowercase letters, digits and inner hyphens
  for (const sample of ['Sunrise OPD', 'डॉ. क्लिनिक', 'x'.repeat(60), '  A  B  ']) {
    const slug = clinicSlug(sample);
    assert.match(slug, /^[a-z0-9][a-z0-9-]*$/, `"${sample}" produced "${slug}"`);
    assert.ok(slug.length <= BOOKING_SLUG_MAX);
    assert.ok(!slug.endsWith('-'), `"${sample}" left a trailing hyphen`);
  }
});

test('the SQL and JS rules are held to the same examples', () => {
  // Cheap drift alarm: the suite that runs these against a real Postgres must
  // still be exercising the same names this file just asserted.
  for (const example of ['sunrise-multispecialty-opd', 'sharma-clinic', 'dr-mehta-ent']) {
    assert.ok(schemaTests.includes(example), `schema-tests.sql no longer checks ${example}`);
  }
});

/* --------------------------------------------------------- what to offer */

test('bookingSlugFor prefers the saved slug and never invents the demo one', () => {
  assert.equal(bookingSlugFor({ slug: 'dr-mehta-family-clinic', name: 'Dr Mehta' }), 'dr-mehta-family-clinic');
  assert.equal(bookingSlugFor({ slug: null, name: 'Dr Mehta Family Clinic' }), 'dr-mehta-family-clinic');
  assert.equal(bookingSlugFor({ slug: '', name: '' }), '');
  assert.equal(bookingSlugFor({}), '');
  assert.notEqual(bookingSlugFor({ name: 'Dr Mehta' }), BOOKING_SLUG_FALLBACK);
  // a slug saved with capitals (schema 8 allowed it, the lookup lowercases) still
  // gives the link that works
  assert.equal(bookingSlugFor({ slug: 'Dr-Sharma-ENT' }), 'dr-sharma-ent');
});

test('bookingUrl keeps the hash route and drops nothing', () => {
  assert.equal(bookingUrl('sunrise-opd'), '#/book/sunrise-opd');
  // an empty slug must not produce a link that renders some other clinic
  assert.equal(bookingUrl(''), '#/book/');
});

/* ------------------------------------------------- Settings: one link */

test('Settings shows the saved link, not a guessed one', () => {
  const body = code(settings);
  const tab = code(clinicTab);
  assert.doesNotMatch(body, /sunrise-opd/, 'Settings must never fall back to the demo clinic');
  assert.doesNotMatch(tab, /sunrise-opd/, 'the clinic tab must never fall back to the demo clinic');
  assert.match(body, /const savedSlug = clinicSlug\(store\.clinic\?\.slug/);
  assert.match(body, /const publicLink = savedSlug \? bookingUrl\(savedSlug\) : ''/);
  // Copy and Open follow the saved slug, and are unavailable until there is one
  assert.match(tab, /writeText\(bookingUrl\(savedSlug\)\)/);
  assert.match(tab, /disabled=\{!savedSlug\}[\s\S]{0,200}navigate\(`\/book\/\$\{savedSlug\}`\)/);
  assert.match(tab, /navigate\(`\/book\/\$\{savedSlug\}`\)/);
  // and the page has to hand the tab the slug it derived — a prop that goes
  // missing would silently fall back to a guessed link again
  assert.match(body, /<ClinicTab[\s\S]{0,400}savedSlug=\{savedSlug\}/);
});

test('saving the clinic no longer writes a made-up slug into the row', () => {
  const body = code(settings);
  // `slug: … || 'clinic'` on the update patch is what silently made the field and
  // the database disagree; the address is written by store.saveBookingSlug() alone.
  assert.doesNotMatch(body, /slug: clinicState\.slug \|\|/);
  assert.match(body, /store\.saveBookingSlug\(/);
  assert.match(body, /setClinic\(\(c\) => \(\{ \.\.\.c, slug: live \}\)\)/);
});

test('saveBookingSlug writes through set_clinic_slug and survives an older database', () => {
  const body = code(store);
  assert.match(body, /rpc\('set_clinic_slug', \{ p_clinic: clinic\.id, p_slug: wanted \}\)/);
  // schema 8 projects have no such function: the plain row write is the fallback,
  // and every other error (not the owner, clinic gone) is re-thrown
  assert.match(body, /missingFunction\(e\)/);
  assert.match(body, /update\('clinic', clinic\.id, \{ slug: wanted \}\)/);
  assert.match(body, /PGRST202/);
});

/* ------------------------------------------------- the public page itself */

test('a truncated link is not answered with the demo clinic', () => {
  const body = code(publicBooking);
  assert.doesNotMatch(body, /useParams\(\);\s*const \{ slug = BOOKING_SLUG_FALLBACK \}/);
  assert.match(body, /const \{ slug: routeSlug \} = useParams\(\)/);
  // the fallback is only reached when there is no Supabase client (demo build)
  assert.match(body, /routeSlug \|\| \(\(await bookingApi\.mode\(\)\) === 'demo' \? BOOKING_SLUG_FALLBACK : ''\)/);
  assert.match(body, /setLoadError\('This link is missing the clinic/);
});

test('the booking page does not wait for the staff workspace', () => {
  const body = code(app);
  // the three patient routes are rendered by PublicScreen, which has no store
  assert.match(body, /function PublicScreen\(\)/);
  assert.match(body, /const PUBLIC_SCREEN = /);
  assert.match(body, /if \(PUBLIC_SCREEN\.test\(pathname\)\) return <PublicScreen \/>/);

  const publicScreen = body.slice(body.indexOf('function PublicScreen()'), body.indexOf('const PUBLIC_SCREEN'));
  assert.doesNotMatch(publicScreen, /StoreProvider|DataGate|useStore/);
  // and they are not also mounted inside the app shell
  const clinicApp = body.slice(body.indexOf('function ClinicApp()'));
  assert.doesNotMatch(clinicApp, /path="\/book/);
  assert.doesNotMatch(clinicApp, /path="\/booking/);
});

/* ------------------------------------------------------------ the database */

test('schema.sql mints an address when a clinic is created', () => {
  // The *last* definition wins, and schema 8 shipped two of them — the bug was
  // that both left `slug` out.
  const last = schema.lastIndexOf('create or replace function public.create_clinic(');
  assert.ok(last > 0);
  const body = schema.slice(last, schema.indexOf('$$;', last));
  assert.match(body, /insert into public\.clinics \(name, slug,/);
  assert.match(body, /public\.next_clinic_slug\(clinic_name\)/);
});

test('schema.sql has one owner-writable way to change the address', () => {
  assert.match(schema, /create or replace function public\.set_clinic_slug\(p_clinic uuid, p_slug text\)/);
  assert.match(schema, /revoke all on function public\.set_clinic_slug\(uuid, text\) from public;/);
  assert.match(schema, /grant execute on function public\.set_clinic_slug\(uuid, text\) to authenticated;/);
  assert.match(schema, /create or replace function public\.next_clinic_slug\(p_name text/);
  // migration 9 is registered and the version it writes matches the app's
  assert.match(schema, /values \(9, 'clinic-slug', '1\.11\.5'/);
  assert.match(schema, /set schema_version = 9/);
  assert.match(schema, /clinics_slug_format/);
});
