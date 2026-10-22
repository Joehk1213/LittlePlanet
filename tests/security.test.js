const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const createApiProtection = require('../middleware/api-protection');

async function withServer(middleware, run) {
  const app = express();
  app.set('trust proxy', false);
  app.use('/api', middleware);
  app.get('/api/ping', (req, res) => res.json({ success: true }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
}

test('API protection rate limits requests and returns retry metadata', async () => {
  const middleware = createApiProtection({ windowMs: 60000, maxRequests: 2 });
  await withServer(middleware, async baseUrl => {
    const first = await fetch(`${baseUrl}/api/ping`);
    const second = await fetch(`${baseUrl}/api/ping`);
    const limited = await fetch(`${baseUrl}/api/ping`);
    const body = await limited.json();

    assert.equal(first.status, 200);
    assert.equal(first.headers.get('ratelimit-limit'), '2');
    assert.equal(second.status, 200);
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after') !== null, true);
    assert.equal(body.success, false);
    assert.equal(body.data, null);
  });
});

test('API CORS allows same-origin and configured origins, rejects others', async () => {
  const middleware = createApiProtection({
    allowedOrigins: ['https://shop.example.com']
  });
  await withServer(middleware, async baseUrl => {
    const sameOrigin = await fetch(`${baseUrl}/api/ping`, {
      headers: { Origin: baseUrl }
    });
    assert.equal(sameOrigin.status, 200);
    assert.equal(sameOrigin.headers.get('access-control-allow-origin'), baseUrl);

    const configured = await fetch(`${baseUrl}/api/ping`, {
      headers: { Origin: 'https://shop.example.com' }
    });
    assert.equal(configured.status, 200);
    assert.equal(configured.headers.get('access-control-allow-origin'), 'https://shop.example.com');

    const blocked = await fetch(`${baseUrl}/api/ping`, {
      headers: { Origin: 'https://attacker.example' }
    });
    assert.equal(blocked.status, 403);
    assert.equal((await blocked.json()).success, false);

    const preflight = await fetch(`${baseUrl}/api/ping`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://shop.example.com',
        'Access-Control-Request-Method': 'POST'
      }
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-methods'), 'GET, POST, PATCH, OPTIONS');
  });
});
