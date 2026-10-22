'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const createAdminSessions = require('../middleware/admin-sessions');
const createProductsRouter = require('../routes/products');

const SHIPPING_TOKEN = 'shipping-session-test-token-0123456789abcdef';
const ANALYTICS_TOKEN = 'analytics-session-test-token-0123456789abcdef';
const SESSION_SECRET = 'independent-admin-session-signing-secret-012345';

async function withServer(app, run) {
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

function createTestApp(options = {}) {
  const sessions = createAdminSessions({
    sessionSecret: SESSION_SECRET,
    credentials: [
      { token: SHIPPING_TOKEN, scopes: ['shipping', 'products'] },
      { token: ANALYTICS_TOKEN, scopes: ['analytics'] }
    ],
    ...options
  });
  const app = express();
  app.use(express.json());
  app.use('/api/admin-auth', sessions.router);
  app.get('/api/shipping/report', (req, res) => {
    const authorized = sessions.isAuthorized(req, SHIPPING_TOKEN, 'shipping');
    return authorized
      ? res.json({ success: true, data: { authorized }, message: 'ok' })
      : res.status(401).json({ success: false, data: null, message: 'Unauthorized.' });
  });
  app.post('/api/shipping/update', (req, res) => {
    const authorized = sessions.isAuthorized(req, SHIPPING_TOKEN, 'shipping');
    return authorized
      ? res.json({ success: true, data: { authorized }, message: 'ok' })
      : res.status(403).json({ success: false, data: null, message: 'Unauthorized or invalid origin.' });
  });
  return app;
}

test('product management endpoints accept the products scope without a browser bearer token', async () => {
  let stock = 7;
  const sessions = createAdminSessions({
    sessionSecret: SESSION_SECRET,
    credentials: [{ token: SHIPPING_TOKEN, scopes: ['products'] }]
  });
  const app = express();
  app.use(express.json());
  app.use('/api/admin-auth', sessions.router);
  app.use('/api/products', createProductsRouter({
    from() {
      return {
        insert(values) {
          return {
            select() {
              return {
                single: async () => ({
                  data: {
                    id: '5',
                    name: values.name,
                    price: values.price,
                    stock: values.stock
                  },
                  error: null
                })
              };
            }
          };
        },
        update(values) {
          return {
            eq(column, value) {
              assert.equal(column, 'id');
              assert.equal(value, '5');
              return {
                select() {
                  return {
                    maybeSingle: async () => ({
                      data: {
                        id: 5,
                        name: 'Cookie 管理商品',
                        price: 12.5,
                        category: 'stationery',
                        stock: (stock = values.stock)
                      },
                      error: null
                    })
                  };
                }
              };
            }
          };
        }
      };
    }
  }, {
    adminToken: SHIPPING_TOKEN,
    stockWriteEnabled: true,
    isSessionAuthorized: sessions.isAuthorized
  }));

  await withServer(app, async baseUrl => {
    const login = await fetch(`${baseUrl}/api/admin-auth/login`, {
      method: 'POST',
      headers: {
        Origin: baseUrl,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ token: SHIPPING_TOKEN })
    });
    const cookie = login.headers.get('set-cookie').split(';', 1)[0];
    const created = await fetch(`${baseUrl}/api/products`, {
      method: 'POST',
      headers: {
        Origin: baseUrl,
        Cookie: cookie,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name: 'Cookie 管理商品', price: 12.5 })
    });
    const body = await created.json();
    assert.equal(created.status, 201);
    assert.equal(body.success, true);
    assert.equal(body.data.name, 'Cookie 管理商品');

    const stockUpdate = await fetch(`${baseUrl}/api/products/5/stock`, {
      method: 'PATCH',
      headers: {
        Origin: baseUrl,
        Cookie: cookie,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ stock: 12 })
    });
    const stockBody = await stockUpdate.json();
    assert.equal(stockUpdate.status, 200);
    assert.equal(stockBody.success, true);
    assert.equal(stockBody.data.stock, 12);
    assert.equal(stock, 12);
  });
});

test('session-only authorization checks the orders scope and rejects a bearer token', async () => {
  const sessions = createAdminSessions({
    sessionSecret: SESSION_SECRET,
    credentials: [{ token: SHIPPING_TOKEN, scopes: ['orders'] }]
  });
  const app = express();
  app.use(express.json());
  app.use('/api/admin-auth', sessions.router);
  app.get('/api/admin-orders', (req, res) => res.status(
    sessions.isSessionAuthorized(req, 'orders') ? 200 : 401
  ).json({ success: true, data: null, message: 'ok' }));

  await withServer(app, async baseUrl => {
    const bearerResponse = await fetch(`${baseUrl}/api/admin-orders`, {
      headers: { Authorization: `Bearer ${SHIPPING_TOKEN}` }
    });
    assert.equal(bearerResponse.status, 401);

    const login = await fetch(`${baseUrl}/api/admin-auth/login`, {
      method: 'POST',
      headers: {
        Origin: baseUrl,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ token: SHIPPING_TOKEN })
    });
    const cookie = login.headers.get('set-cookie').split(';', 1)[0];
    const sessionResponse = await fetch(`${baseUrl}/api/admin-orders`, {
      headers: { Cookie: cookie }
    });
    assert.equal(sessionResponse.status, 200);
  });
});

test('admin login issues an HttpOnly scoped cookie and session authorizes same-origin writes', async () => {
  const app = createTestApp({ secureCookie: true });
  await withServer(app, async baseUrl => {
    const origin = baseUrl;
    const loginResponse = await fetch(`${baseUrl}/api/admin-auth/login`, {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ token: SHIPPING_TOKEN })
    });
    const loginBody = await loginResponse.json();
    const setCookie = loginResponse.headers.get('set-cookie');
    assert.equal(loginResponse.status, 200);
    assert.equal(loginBody.success, true);
    assert.deepEqual(loginBody.data.scopes, ['shipping', 'products']);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    assert.match(setCookie, /Secure/i);
    assert.match(setCookie, /Path=\/api/i);
    assert.doesNotMatch(setCookie, new RegExp(SHIPPING_TOKEN));

    const cookie = setCookie.split(';', 1)[0];
    const sessionResponse = await fetch(`${baseUrl}/api/admin-auth/session`, {
      headers: { Cookie: cookie }
    });
    const sessionBody = await sessionResponse.json();
    assert.equal(sessionBody.data.authenticated, true);

    const readResponse = await fetch(`${baseUrl}/api/shipping/report`, {
      headers: { Cookie: cookie }
    });
    assert.equal(readResponse.status, 200);

    const writeResponse = await fetch(`${baseUrl}/api/shipping/update`, {
      method: 'POST',
      headers: {
        Origin: origin,
        Cookie: cookie
      }
    });
    assert.equal(writeResponse.status, 200);

    const crossOriginWrite = await fetch(`${baseUrl}/api/shipping/update`, {
      method: 'POST',
      headers: {
        Origin: 'http://attacker.example',
        Cookie: cookie
      }
    });
    assert.equal(crossOriginWrite.status, 403);
    assert.equal((await crossOriginWrite.json()).success, false);
  });
});

test('admin login rejects bad credentials and cross-origin login requests', async () => {
  await withServer(createTestApp(), async baseUrl => {
    const invalidToken = await fetch(`${baseUrl}/api/admin-auth/login`, {
      method: 'POST',
      headers: {
        Origin: baseUrl,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ token: 'incorrect-secret' })
    });
    assert.equal(invalidToken.status, 401);
    assert.equal((await invalidToken.json()).success, false);
    assert.equal(invalidToken.headers.get('set-cookie'), null);

    const invalidOrigin = await fetch(`${baseUrl}/api/admin-auth/login`, {
      method: 'POST',
      headers: {
        Origin: 'http://attacker.example',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ token: SHIPPING_TOKEN })
    });
    assert.equal(invalidOrigin.status, 403);
    assert.equal((await invalidOrigin.json()).success, false);
    assert.equal(invalidOrigin.headers.get('set-cookie'), null);
  });
});

test('session cookies reject tampering and do not grant other credentials scopes', async () => {
  await withServer(createTestApp(), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/admin-auth/login`, {
      method: 'POST',
      headers: {
        Origin: baseUrl,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ token: ANALYTICS_TOKEN })
    });
    const cookie = response.headers.get('set-cookie').split(';', 1)[0];
    const analyticsOnly = await fetch(`${baseUrl}/api/shipping/report`, {
      headers: { Cookie: cookie }
    });
    assert.equal(analyticsOnly.status, 401);

    const [name, value] = cookie.split('=');
    const tampered = `${name}=x${value.slice(1)}`;
    const invalidSession = await fetch(`${baseUrl}/api/admin-auth/session`, {
      headers: { Cookie: tampered }
    });
    assert.equal((await invalidSession.json()).data.authenticated, false);
  });
});

test('logout expires the HttpOnly session cookie', async () => {
  await withServer(createTestApp(), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/admin-auth/logout`, {
      method: 'POST',
      headers: { Origin: baseUrl }
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.match(response.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/i);
    assert.match(response.headers.get('set-cookie'), /HttpOnly/i);
  });
});
