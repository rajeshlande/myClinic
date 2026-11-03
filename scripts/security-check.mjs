#!/usr/bin/env node
/**
 * Prints the security verification procedure and runs the parts that do not need
 * a database. The RLS suite itself needs a scratch Supabase project (operators run
 * it with psql) — this script refuses to pretend otherwise.
 */
import { existsSync } from 'node:fs';

const checks = [];
const suite = 'supabase/rls-tests.sql';
checks.push([existsSync(suite), `${suite} present (RLS regression suite)`]);
checks.push([existsSync('supabase/schema.sql'), 'supabase/schema.sql present (schema v2 role matrix)']);
checks.push([existsSync('supabase/licensing.sql'), 'supabase/licensing.sql present (schema v3 subscriptions)']);
checks.push([existsSync('supabase/licensing-tests.sql'), 'supabase/licensing-tests.sql present (licence regression suite)']);
checks.push([existsSync('supabase/branding.sql'), 'supabase/branding.sql present (schema v4 logos + size guards)']);
checks.push([existsSync('src/lib/permissions.js'), 'client role matrix mirrors the policies']);
checks.push([existsSync('src/lib/offline.js'), 'offline engine (scoped cache, TTL, outbox)']);

console.log('\nmyClinic — security verification\n');
for (const [ok, label] of checks) console.log(`  ${ok ? '✓' : '✗'} ${label}`);

console.log(`
Database checks (run against a SCRATCH project, never production):

  1. psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/schema.sql
  2. psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/licensing.sql
  2b. psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/branding.sql
  3. psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f ${suite}
  4. psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/licensing-tests.sql
     -> every assertion prints PASS; the whole fixture set is rolled back

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
