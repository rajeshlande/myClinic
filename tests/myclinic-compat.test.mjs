import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CENTRAL_TIER_TO_PLAN, PLAN_LIMITS, TIER_SEAT_LIMITS } from '../src/lib/plans.mjs';
import { CENTRAL_CODES, CENTRAL_CODE_NOTES } from '../src/lib/central-sync.mjs';

/*
 * The myClinic side of the cross-repo lockstep. Central reads the same JSON and
 * derives its entitlement / refusal maps; this suite holds the client mirrors
 * against the vendored bytes. A tier or refusal code added on either side but
 * not the other fails here, and a contract-only addition fails the checksum pin.
 */

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const contractPath = join(root, 'contract', 'tier-contract.json');
const contract = JSON.parse(readFileSync(contractPath, 'utf8'));

const EXPECTED_TIER_TO_PLAN = Object.freeze({
  solo: 'solo',
  standard: 'growth',
  growth: 'growth',
  chain: 'chain',
  enterprise: 'chain',
});

const EXPECTED_REFUSAL_CODES = Object.freeze([
  'SUBSCRIPTION_NOT_FOUND',
  'ORIGIN_MISMATCH',
  'INVALID_ORIGIN',
  'INVALID_EMAIL',
  'MISSING_IDENTITY',
  'RATE_LIMITED',
  'SEAT_LIMIT_REACHED',
  'SUBSCRIPTION_PAUSED',
  'SUBSCRIPTION_EXPIRED',
  'SUBSCRIPTION_INACTIVE',
]);

/** Client-only vocabulary: a success verdict and a build-without-fetch fault. */
const CLIENT_ONLY_CODES = Object.freeze(['ACTIVE', 'FETCH_UNAVAILABLE']);

const sorted = (values) => [...values].sort();
const seatFields = (spec) => ({
  doctors: spec.doctors,
  frontdesk: spec.frontdesk,
  branches: spec.branches,
});

test('CENTRAL_TIER_TO_PLAN is the contract tier-to-plan view, key sets included', () => {
  assert.ok(Object.isFrozen(CENTRAL_TIER_TO_PLAN), 'importers still get the frozen shape');
  assert.deepEqual({ ...CENTRAL_TIER_TO_PLAN }, EXPECTED_TIER_TO_PLAN);
  assert.deepEqual(
    sorted(Object.keys(CENTRAL_TIER_TO_PLAN)),
    sorted(Object.keys(contract.tiers)),
  );
  assert.deepEqual(
    { ...CENTRAL_TIER_TO_PLAN },
    Object.fromEntries(Object.entries(contract.tiers).map(([tier, spec]) => [tier, spec.plan])),
  );
});

test('every contract refusal code is decoded and explained on the client', () => {
  const contractCodes = sorted(Object.keys(contract.refusal_codes));
  assert.deepEqual(contractCodes, sorted(EXPECTED_REFUSAL_CODES));

  for (const code of contractCodes) {
    assert.ok(code in CENTRAL_CODES, `${code} is published but cannot be decoded`);
    assert.ok(code in CENTRAL_CODE_NOTES, `${code} is published but has no card note`);
    assert.ok(CENTRAL_CODE_NOTES[code].length > 20, `${code} needs an actionable sentence`);
  }
  assert.equal(CENTRAL_CODES.SUBSCRIPTION_INACTIVE, 'inactive');
  assert.match(CENTRAL_CODE_NOTES.SUBSCRIPTION_INACTIVE, /set the row back to active on Central/);

  assert.deepEqual(
    sorted(Object.keys(CENTRAL_CODES).filter((code) => !CLIENT_ONLY_CODES.includes(code))),
    contractCodes,
  );
  assert.deepEqual(
    sorted(Object.keys(CENTRAL_CODE_NOTES).filter((code) => code !== 'FETCH_UNAVAILABLE')),
    contractCodes,
  );
});

test('tier seat limits and the displayed plan caps come from the contract', () => {
  for (const [tier, spec] of Object.entries(contract.tiers)) {
    assert.deepEqual(seatFields(TIER_SEAT_LIMITS[tier]), seatFields(spec), `${tier} seats`);
    assert.ok(Object.isFrozen(TIER_SEAT_LIMITS[tier]), `${tier} seat view is frozen`);
  }
  assert.deepEqual(PLAN_LIMITS.solo, seatFields(contract.tiers.solo));
  assert.deepEqual(PLAN_LIMITS.growth, seatFields(contract.tiers.growth));
  assert.deepEqual(PLAN_LIMITS.chain, seatFields(contract.tiers.chain));
  assert.deepEqual(PLAN_LIMITS.solo, { doctors: 1, frontdesk: 1, branches: 1 });
  assert.deepEqual(PLAN_LIMITS.growth, { doctors: 5, frontdesk: 3, branches: 1 });
  assert.deepEqual(PLAN_LIMITS.chain, { doctors: null, frontdesk: null, branches: null });
});

test('no new tier-seat or tier-plan literals live outside the contract and tests', () => {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root })
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  const scanned = tracked.filter((file) => {
    if (file.startsWith('contract/') || file.startsWith('tests/')) return false;
    if (file.startsWith('dist/') || file.startsWith('node_modules/')) return false;
    return /\.(mjs|js|jsx)$/.test(file);
  });
  const banned = [
    /\b(?:doctors|frontdesk|branches)\s*:\s*(?:null|\d+)\b/g,
    /\bplan\s*:\s*['"](?:solo|growth|chain)['"]/g,
  ];
  const offenders = [];
  for (const file of scanned) {
    const text = readFileSync(join(root, file), 'utf8');
    for (const pattern of banned) {
      for (const match of text.matchAll(pattern)) {
        const line = text.slice(0, match.index).split('\n').length;
        offenders.push(`${file}:${line} → ${match[0]}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'tier seat/plan literals belong in contract/tier-contract.json, not a second source file',
  );
});
