import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

function worker() {
  const listeners = new Map();
  const origin = 'https://clinic.example';
  // A cache miss is intentional: protected traffic must not even reach caches.
  const calls = { cache: 0, network: 0 };
  const response = { ok: true, clone() { return this; } };
  vm.runInNewContext(source, {
    URL,
    self: {
      registration: { scope: `${origin}/myclinic/` },
      location: { origin },
      addEventListener(name, handler) { listeners.set(name, handler); },
    },
    caches: {
      async match() { calls.cache += 1; return undefined; },
      async open() {
        calls.cache += 1;
        return { async put() { calls.cache += 1; } };
      },
    },
    async fetch() { calls.network += 1; return response; },
    Response: { error() { return { error: true }; } },
  });
  return {
    calls,
    async request(path, { method = 'GET', mode = 'cors' } = {}) {
      let intercepted = false;
      let result;
      listeners.get('fetch')({
        request: { url: new URL(path, origin).href, method, mode },
        respondWith(value) { intercepted = true; result = value; },
      });
      if (intercepted) await result;
      return intercepted;
    },
  };
}

for (const path of [
  '/rest/v1/patients?select=*',
  '/auth/v1/token',
  '/functions/v1/mint-tenant-token',
  '/functions/v1/oidc/.well-known/openid-configuration',
  '/functions/v1/oidc/jwks.json',
  '/myclinic/functions/v1/oidc',
  '/functions/v1',
  '/auth/v1',
  '/rest/v1',
]) {
  test(`service worker does not intercept or cache ${path}`, async () => {
    const sw = worker();
    assert.equal(await sw.request(path), false);
    assert.deepEqual(sw.calls, { cache: 0, network: 0 });
  });
}

test('protected navigation cannot fall back to the clinical app shell', async () => {
  const sw = worker();
  assert.equal(await sw.request('/functions/v1/oidc', { mode: 'navigate' }), false);
  assert.deepEqual(sw.calls, { cache: 0, network: 0 });
});

test('external Supabase traffic is not intercepted', async () => {
  const sw = worker();
  assert.equal(await sw.request('https://project.supabase.co/functions/v1/oidc'), false);
  assert.deepEqual(sw.calls, { cache: 0, network: 0 });
});

test('POST requests remain outside the offline cache', async () => {
  const sw = worker();
  assert.equal(await sw.request('/functions/v1/mint-tenant-token', { method: 'POST' }), false);
  assert.deepEqual(sw.calls, { cache: 0, network: 0 });
});

test('hashed static assets still use the offline cache', async () => {
  const sw = worker();
  assert.equal(await sw.request('/myclinic/assets/index-abc123.js'), true);
  assert.ok(sw.calls.cache > 0);
  assert.equal(sw.calls.network, 1);
});

test('ordinary app navigation still uses the network-first shell path', async () => {
  const sw = worker();
  assert.equal(await sw.request('/myclinic/', { mode: 'navigate' }), true);
  assert.ok(sw.calls.cache > 0);
  assert.equal(sw.calls.network, 1);
});

test('similarly named static paths are not incorrectly excluded', async () => {
  const sw = worker();
  assert.equal(await sw.request('/myclinic/assets/functions/v10-reference.js'), true);
  assert.equal(sw.calls.network, 1);
});
