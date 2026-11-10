#!/usr/bin/env node
/**
 * Prints the security verification procedure and runs the parts that do not need
 * a database. The RLS suite itself needs a scratch Supabase project (operators run
 * it with psql) — this script refuses to pretend otherwise.
 */
import { existsSync } from 'node:fs';

const checks = [];
const suite = 'supabase/schema-tests.sql';
checks.push([existsSync('supabase/schema.sql'), 'supabase/schema.sql present (single source of truth, schema 1-21)']);
checks.push([existsSync(suite), `${suite} present (role matrix + licensing regression suites)`]);
checks.push([existsSync('src/lib/permissions.js'), 'client role matrix mirrors the policies']);
checks.push([existsSync('src/lib/offline.js'), 'offline engine (scoped cache, TTL, outbox)']);

console.log('\nmyClinic — security verification\n');
for (const [ok, label] of checks) console.log(`  ${ok ? '✓' : '✗'} ${label}`);

console.log(`
Database checks (run against a SCRATCH project, never production):

  1. psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/schema.sql
     -> one file. Idempotent: re-running it upgrades any older database in place,
        straight to schema 21 (see public.app_schema_version()).
  2. set role anon;   -- the public booking surface, seen from outside
     select public.public_clinic_profile('sunrise-opd');       -- profile and doctors only
     select public.public_booking_busy('sunrise-opd',
            (select id from public.staff limit 1));            -- times, never patients
     select count(*) from public.patients;                     -- permission denied
     select count(*) from public.appointments;                 -- permission denied
     reset role;
     -> the five booking RPCs answer; every table still refuses anon.

  3. psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/schema-tests.sql
     -> every assertion prints PASS, ending in
        "ALL RLS CHECKS COMPLETED", "ALL LICENSING CHECKS COMPLETED",
        "ALL BRANCH CONFIGURATION CHECKS COMPLETED",
        "ALL BRANCH VIEWS CHECKS COMPLETED" and "ALL SQL OK"; the whole fixture set is
        rolled back, so a run leaves no trace.

What the suites prove:
  · a new clinic starts on a 14-day Growth trial and cannot restart it
  · seat limits (5 doctors / 3 front desk / 1 branch on Growth) are enforced by trigger
  · a downgrade below current seat usage is refused
  · an overdue subscription drops to grace, then read-only, and writes are blocked
  · reads and exports keep working when the subscription has lapsed
  · only the clinic owner can change the plan; other clinics cannot even read it
  · one parent clinic can hold many child branches; owners hold several assignments
  · doctors and front-desk seats hold exactly one branch each
  · patients stay shared; a front-desk seat cannot read another branch's visits or invoices
  · a second application of schema.sql leaves the hardened rules at schema 21
  · day close is scoped to one cash-drawer branch even when an owner views all branches
  · a branch invitation starts a front-desk seat on that branch, not implicit Main
  · set_branch_scope('all') is refused for a doctor or front-desk seat
  · a front-desk user cannot enrol themselves in another clinic
  · a member cannot promote themselves to owner (policy + staff_guard trigger)
  · clinic A cannot read clinic B's patients or invoices
  · front desk cannot author a consultation
  · issue_token() refuses a patient from another clinic
  · a paid invoice cannot be voided or amended by a non-owner
  · only an owner can create an invitation
  · anon can call the five booking RPCs and read no table at all
  · a public booking cannot take a slot that is already held, twice over:
    the client's availableSlots and the unique index on live appointments agree
  · a cancelled booking releases its slot; the row and its reference stay

Client checks:
  npm test    — role matrix, sync merge policy, replay idempotency, retries
`);

if (checks.some(([ok]) => !ok)) process.exit(1);
