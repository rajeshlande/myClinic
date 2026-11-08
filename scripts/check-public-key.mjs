#!/usr/bin/env node
/**
 * myClinic · is this licence public key usable?
 *
 * The clinic's Edge Function verifies the authority's RS256 token with
 * `LICENSE_PUBLIC_KEY`; the browser verifies the same token with
 * `VITE_LICENSE_PUBLIC_KEY`. Both must be **the same public key**, in SPKI PEM
 * form. Copying it is where this goes wrong, because the authority's key
 * generator prints it inside a `.env` line:
 *
 *     LICENSE_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\nMIIBIjAN…\n-----END PUBLIC KEY-----"
 *
 * Paste that line into a secret and you have pasted `LICENSE_PUBLIC_KEY=`, two
 * quotes and a literal backslash-n along with the key. Every one of those used to
 * present as `token-key` — a signature failure naming nothing useful.
 *
 *   npm run check:key -- keys/license_public_spki.pem
 *   npm run check:key -- '-----BEGIN PUBLIC KEY-----\nMIIBIjAN…\n-----END PUBLIC KEY-----'
 *   npm run check:key -- a.pem b.pem        # are these the same key?
 *   cat key.pem | npm run check:key
 */
import { createHash, createPublicKey } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const WHY = {
  empty: 'There is no value here.',
  'private-key':
    'That is a PRIVATE key. It belongs to the authority and must never leave it — paste the public half. If this private key has been in a bundle, a secret or a chat window, roll the pair.',
  'not-a-public-key':
    'No -----BEGIN PUBLIC KEY----- line. Paste the whole PEM, or the .env value that contains it.',
  truncated: 'The -----END PUBLIC KEY----- line is missing: the value was cut short.',
  'not-rsa': 'That key is not RSA. The authority signs RS256, so an EC or Ed25519 key cannot verify it.',
  unusable: 'The PEM cannot be parsed as a key at all — the base64 body is damaged or was copied incompletely.',
};

/**
 * The same clean-up the Edge Function applies, kept here so the diagnostic tells
 * you what the function will actually do with the string you give it.
 */
export function normalisePem(raw) {
  let value = String(raw ?? '').trim();
  if (!value) return { pem: '', defect: 'empty' };
  if (/PRIVATE KEY/.test(value)) return { pem: '', defect: 'private-key' };
  value = value.replace(/^[A-Z0-9_]+\s*=\s*/, '');
  value = value.replace(/^["'`]+|["'`]+$/g, '').trim();
  value = value.replace(/\\n/g, '\n');
  // Two legitimate envelopes: SPKI (`BEGIN PUBLIC KEY`) and PKCS#1
  // (`BEGIN RSA PUBLIC KEY`). Both verify; the app and the Edge Function wrap the
  // second one into the first, because WebCrypto has no 'pkcs1' format.
  if (/BEGIN RSA PUBLIC KEY/.test(value)) {
    return /END RSA PUBLIC KEY/.test(value)
      ? { pem: value, format: 'pkcs1' }
      : { pem: '', defect: 'truncated' };
  }
  if (/BEGIN PUBLIC KEY/.test(value)) {
    return /END PUBLIC KEY/.test(value) ? { pem: value, format: 'spki' } : { pem: '', defect: 'truncated' };
  }
  return { pem: '', defect: 'not-a-public-key' };
}

/**
 * @returns {{ok: boolean, defect: string, reason: string, fingerprint: string,
 *   bits: number, type: string, pem: string}}
 */
export function inspectPublicKey(raw) {
  const { pem, format = 'spki', defect } = normalisePem(raw);
  if (defect) {
    return { ok: false, defect, reason: WHY[defect], fingerprint: '', bits: 0, type: '', format: '', pem: '' };
  }

  let key;
  try {
    key = createPublicKey(pem);
  } catch (error) {
    return {
      ok: false,
      defect: 'unusable',
      reason: `${WHY.unusable} (${error instanceof Error ? error.message : 'unknown error'})`,
      fingerprint: '', bits: 0, type: '', format: '', pem: '',
    };
  }

  if (key.asymmetricKeyType !== 'rsa') {
    return { ok: false, defect: 'not-rsa', reason: `${WHY['not-rsa']} (${key.asymmetricKeyType})`, fingerprint: '', bits: 0, type: key.asymmetricKeyType ?? '', format: '', pem: '' };
  }

  const der = key.export({ type: 'spki', format: 'der' });
  const fingerprint = createHash('sha256').update(der).digest('base64url');
  return {
    ok: true,
    defect: '',
    reason: '',
    fingerprint,
    bits: key.asymmetricKeyDetails?.modulusLength ?? 0,
    type: 'rsa',
    format,
    pem,
  };
}

/** A short, stable identity for a key: the same string for the same key, always. */
export const shortFingerprint = (fingerprint) => `sha256:${String(fingerprint).slice(0, 22)}`;

function readInput(arg) {
  if (!arg) return readFileSync(0, 'utf8'); // stdin
  if (!arg.includes('BEGIN') && existsSync(arg)) return readFileSync(arg, 'utf8');
  return arg;
}

function main() {
  const [first, second] = process.argv.slice(2);

  const one = inspectPublicKey(readInput(first));
  if (!one.ok) {
    console.error(`✗ ${one.defect}`);
    console.error(`  ${one.reason}`);
    process.exit(1);
  }

  console.log(`✓ usable RSA-${one.bits || '?'} public key (${one.format.toUpperCase()} PEM)`);
  console.log(`  fingerprint  ${shortFingerprint(one.fingerprint)}`);

  if (!second) {
    console.log('');
    console.log('  Put the same key in both places:');
    console.log('    • Edge Function secret  LICENSE_PUBLIC_KEY   (the function verifies with it)');
    console.log('    • build variable        VITE_LICENSE_PUBLIC_KEY (the browser verifies with it)');
    console.log('  The value, not the line: no NAME=, no quotes. `npm run check:key -- other.pem` compares two.');
    return;
  }

  const other = inspectPublicKey(readInput(second));
  if (!other.ok) {
    console.error(`✗ the second key: ${other.defect} — ${other.reason}`);
    process.exit(1);
  }
  console.log(`  compared with ${shortFingerprint(other.fingerprint)}`);
  if (one.fingerprint === other.fingerprint) {
    console.log('✓ same key');
  } else {
    console.log('✗ different keys — a token signed by one will never verify with the other');
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
