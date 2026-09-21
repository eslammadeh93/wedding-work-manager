import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../src/pwa/service-worker.js', import.meta.url), 'utf8');
function worker() {
  const handlers = {};
  const stored = new Map();
  const requests = [];
  const cache = {
    match: async (request) => stored.get(typeof request === 'string' ? request : request.url)?.clone(),
    put: async (request, response) => { stored.set(typeof request === 'string' ? request : request.url, response); },
    addAll: async () => {},
  };
  vm.runInNewContext(source, {
    importScripts() {},
    firebase: { initializeApp() {}, messaging: () => ({ onBackgroundMessage() {} }) },
    self: { location: { origin: 'https://app.test' }, addEventListener: (name, handler) => { handlers[name] = handler; } },
    caches: { open: async () => cache }, URL,
    fetch: async (request) => { requests.push(request.url); return new Response('network'); },
  });
  const request = (path, mode = 'cors', method = 'GET') => {
    let response;
    handlers.fetch({ request: { url: `https://app.test${path}`, method, mode }, respondWith(value) { response = value; } });
    return response;
  };
  return { request, stored, requests };
}

test('installed navigation starts from its cached build without waiting for the network', async () => {
  const app = worker();
  app.stored.set('/index.html', new Response('installed build'));
  assert.equal(await (await app.request('/orders', 'navigate')).text(), 'installed build');
  assert.deepEqual(app.requests, []);
});

test('a missing shell falls back to network', async () => {
  const app = worker();
  assert.equal(await (await app.request('/', 'navigate')).text(), 'network');
  assert.equal(app.requests.length, 1);
});

test('hashed bundles are downloaded once and reused on later opens', async () => {
  const app = worker();
  assert.equal(await (await app.request('/assets/orders-abc.js')).text(), 'network');
  assert.equal(await (await app.request('/assets/orders-abc.js')).text(), 'network');
  assert.equal(app.requests.length, 1);
});

test('API data, writes and external resources are not intercepted by the static cache', () => {
  const app = worker();
  assert.equal(app.request('/api/company'), undefined);
  assert.equal(app.request('/assets/orders-abc.js', 'cors', 'POST'), undefined);
  assert.deepEqual(app.requests, []);
});
