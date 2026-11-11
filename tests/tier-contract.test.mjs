import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CENTRAL_PROBE_SCHEMA_VERSION } from '../src/lib/central-sync.mjs';

/*
 * Central publishes one immutable JSON file as the cross-repo wire vocabulary.
 * The checksum below is the reviewed bump: a different hash means the vendor
 * copy changed, and the tier/refusal mirrors on both sides must be revisited.
 */

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const contractPath = join(root, 'contract', 'tier-contract.json');
const raw = readFileSync(contractPath);
const contract = JSON.parse(raw.toString('utf8'));

test('the vendored Central tier contract is byte-identical to contract v1', () => {
  assert.equal(
    createHash('sha256').update(raw).digest('hex'),
    '36c6af2bfe0ba7b82d9f9d240ef3aff1330539e82b1538169a0b66d1b2a96ea1',
  );
  assert.equal(raw.at(-1), 0x0a, 'the vendored file keeps its trailing newline');
});

test('the contract identity pins the Central schema the readiness probe defaults to', () => {
  assert.equal(contract.contract, 'myclinic.central.tier-contract');
  assert.equal(contract.contract_version, 1);
  assert.equal(contract.central_schema_version, 3);
  assert.equal(CENTRAL_PROBE_SCHEMA_VERSION, contract.central_schema_version);
});

test('the JSON import attribute lives only in the non-obfuscated plan module', () => {
  const plans = readFileSync(join(root, 'src/lib/plans.mjs'), 'utf8');
  const sync = readFileSync(join(root, 'src/lib/central-sync.mjs'), 'utf8');
  assert.match(
    plans,
    /import raw from '\.\.\/\.\.\/contract\/tier-contract\.json' with \{ type: 'json' \};/,
  );
  assert.doesNotMatch(
    sync,
    /contract\/tier-contract\.json/,
    'the scoped build obfuscator parses central-sync.mjs and rejects import attributes',
  );
});

test('the release note names the reviewed contract digest and the consumer work', () => {
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  assert.match(
    changelog,
    /consume Central tier-contract v1 \(sha256 36c6af2b…\): derive CENTRAL_TIER_TO_PLAN; decode \+ explain SUBSCRIPTION_INACTIVE; cross-repo drift tests/,
  );
  assert.match(changelog, /36c6af2bfe0ba7b82d9f9d240ef3aff1330539e82b1538169a0b66d1b2a96ea1/);
});
