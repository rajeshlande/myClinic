#!/usr/bin/env node
/**
 * Prints the security verification procedure and runs the parts that do not need
 * a database. The RLS suite itself needs a scratch Supabase project (operators run
 * it with psql) — this script refuses to pretend otherwise.
 */
import { existsSync } from 'node:fs';

const checks = [];
const suite = 'supabase/schema-tests.sql';
checks.push([existsSync('supabase/schema.sql'), 'supabase/schema.sql present (single source of truth, schema v1-v4)']);
checks.push([existsSync(suite), `${suite} present (role matrix + licensing regression suites)`]);
checks.push([existsSync('src/lib/permissions.js'), 'client role matrix mirrors the policies']);
checks.push([existsSync('src/lib/offline.js'), 'offline engine (scoped cache, TTL, outbox)']);

console.log('\nmyClinic — security verification\n');
for (const [ok, label] of checks) console.log(`  ${ok ? '✓' : '✗'} ${label}`);

console.log(`
Database checks (run against a SCRATCH project, never production):

  1. psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/schema.sql
     -> one file. Idempotent: re-running it upgrades any older database in place,
        straight to schema v4 (see public.app_schema_version()).
  2. psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/schema-tests.sql
     -> every assertion prints PASS, ending in
        "ALL RLS CHECKS COMPLETED" and "ALL LICENSING CHECKS COMPLETED";
        the whole fixture set is rolled back, so a run leaves no trace.

What the suites prove:
  · a new clinic starts on a 14-day Growth trial and cannot restart it
  · seat limits (5 doctors / 3 front desk / 1 branch on Growth) are enforced by trigger
  · a downgrade below current seat usage is refused
  · an overdue subscription drops to grace, then read-only, and writes are blocked
  · reads and exports keep working when the subscription has lapsed
  · only the clinic owner can change the plan; other clinics cannot even read it
  · a front-desk user cannot enrol themselves in another clinic
  · a member cannot promote themselves to owner (policy + staff_guard trigger)
  · clinic A cannot read clinic B's patients or invoices
  · front desk cannot author a consultation
  · issue_token() refuses a patient from another clinic
  · a paid invoice cannot be voided or amended by a non-owner
  · only an owner can create an invitation

Client checks:
  npm test    — role matrix, sync merge policy, replay idempotency, retries
`);

if (checks.some(([ok]) => !ok)) process.exit(1);
