const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'https://health-test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'health-test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'health-test-service-role-key';
process.env.CUSTOMER_LOOKUP_RATE_SECRET = 'health-test-rate-limit-secret-with-more-than-32-characters';

const app = require('../index');

test('GET /health returns a cache-disabled liveness response', async () => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(body).sort(), ['status', 'timestamp']);
    assert.equal(body.status, 'ok');
    assert.equal(Number.isNaN(Date.parse(body.timestamp)), false);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(
      response.headers.get('referrer-policy'),
      'strict-origin-when-cross-origin'
    );
    assert.equal(response.headers.get('x-powered-by'), null);
    assert.equal(response.headers.get('content-security-policy'), null);
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
});

test('production API errors do not return stack traces or database internals', async () => {
  const previousEnvironment = app.get('env');
  app.set('env', 'production');
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"invalid":'
    });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.success, false);
    assert.equal(body.data, null);
    assert.equal(typeof body.message, 'string');
    assert.equal(JSON.stringify(body).includes('SyntaxError'), false);
    assert.equal(JSON.stringify(body).includes('stack'), false);
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
    app.set('env', previousEnvironment);
  }
});
