import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { inspectPublicKey, normalisePem, shortFingerprint } from '../scripts/check-public-key.mjs';

/*
 * The clinic's licence check failed with `token-key` — the crypto step, not the
 * token — because the secret held a copy-pasted `.env` line. These are the states
 * that string can be in, and the answer each one now gets.
 */

const { publicKey: rsaPublic, privateKey: rsaPrivate } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const RSA_PEM = rsaPublic.export({ type: 'spki', format: 'pem' });
const EC_PEM = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ type: 'spki', format: 'pem' });
const envLine = (pem) => `LICENSE_PUBLIC_KEY="${pem.replace(/\n/g, '\\n')}"`;

test('the value wrapped in a .env line is understood, not rejected', () => {
  for (const input of [RSA_PEM, envLine(RSA_PEM), `"${RSA_PEM}"`, `  ${RSA_PEM}  `]) {
    const result = inspectPublicKey(input);
    assert.equal(result.ok, true, JSON.stringify(input.slice(0, 40)));
    assert.equal(result.bits, 2048);
    assert.match(result.pem, /^-----BEGIN PUBLIC KEY-----/);
  }
});

test('the copy-paste mistakes are named, one by one', () => {
  const priv = rsaPrivate.export({ type: 'pkcs8', format: 'pem' });
  const cases = [
    [priv, 'private-key'],
    [`LICENSE_PUBLIC_KEY="${priv.replace(/\n/g, '\\n')}"`, 'private-key'],
    ['MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A', 'not-a-public-key'],
    ['-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEF', 'truncated'],
    [EC_PEM, 'not-rsa'],
    ['-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtA==\n-----END PUBLIC KEY-----', 'unusable'],
    ['', 'empty'],
  ];
  for (const [input, defect] of cases) {
    const result = inspectPublicKey(input);
    assert.equal(result.ok, false, defect);
    assert.equal(result.defect, defect);
    assert.ok(result.reason.length > 20, `${defect} must explain itself`);
    assert.equal(result.fingerprint, '', 'a rejected key has no identity to report');
  }
});

test('a private key is never echoed back, only named', () => {
  const priv = rsaPrivate.export({ type: 'pkcs8', format: 'pem' });
  const result = inspectPublicKey(priv);
  assert.equal(result.pem, '');
  assert.ok(!JSON.stringify(result).includes(priv.split('\n')[2]), 'the body must not travel');
});

test('the fingerprint identifies the key, and only the key', () => {
  const a = inspectPublicKey(RSA_PEM);
  const b = inspectPublicKey(envLine(RSA_PEM));
  assert.equal(a.fingerprint, b.fingerprint, 'the same key in a .env line is the same key');

  const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' });
  assert.notEqual(a.fingerprint, inspectPublicKey(other).fingerprint);
  assert.match(shortFingerprint(a.fingerprint), /^sha256:[A-Za-z0-9_-]{22}$/);
});

test('normalisePem keeps its two promises: strip the wrapper, keep the PEM', () => {
  assert.equal(normalisePem(envLine(RSA_PEM)).pem.trim(), RSA_PEM.trim());
  assert.equal(normalisePem(RSA_PEM).defect, undefined);
});
