'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const createAdminSessions = require('../middleware/admin-sessions');
const createCustomersRouter = require('../routes/customers');

const CUSTOMER_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const ADMIN_TOKEN = 'customer-crm-admin-token-for-tests-0123456789';
const SESSION_SECRET = 'customer-crm-session-signing-secret-0123456789';

async function withServer(router, run) {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/customers', router);
  await withApplication(app, run);
}

async function withApplication(app, run) {
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

function createRouter(supabase, options = {}) {
  return createCustomersRouter(supabase, {
    isSessionAuthorized: req => req.get('x-customer-admin') === 'valid',
    serviceRoleAvailable: true,
    ...options
  });
}

async function getCustomers(baseUrl, path = '', authorized = true) {
  const response = await fetch(`${baseUrl}/api/admin/customers${path}`, {
    headers: authorized ? { 'x-customer-admin': 'valid' } : {}
  });
  return { status: response.status, body: await response.json() };
}

async function updateCreditStatus(baseUrl, id, body, authorized = true) {
  const response = await fetch(`${baseUrl}/api/admin/customers/${id}/credit-status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(authorized ? { 'x-customer-admin': 'valid' } : {})
    },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

test('customer list requires admin scope and returns search plus order aggregates', async () => {
  let rpcCall;
  const customer = {
    id: CUSTOMER_ID,
    customer_phone: '85212345678',
    customer_name: '小行星熟客',
    credit_status: 'normal',
    default_shipping_method: '順豐',
    notes: null,
    created_at: '2026-10-01T00:00:00.000Z',
    total_orders: 3,
    total_spent: 199.5,
    tags: ['#喜歡星球手帳']
  };
  const router = createRouter({
    rpc: async (name, args) => {
      rpcCall = { name, args };
      return { data: [customer], error: null };
    }
  });

  await withServer(router, async baseUrl => {
    const denied = await getCustomers(baseUrl, '?search=熟客', false);
    assert.equal(denied.status, 401);
    assert.equal(denied.body.success, false);

    const result = await getCustomers(baseUrl, '?search=%E7%86%9F%E5%AE%A2&limit=10&offset=20');
    assert.equal(result.status, 200);
    assert.equal(result.body.success, true);
    assert.deepEqual(result.body.data.customers, [customer]);
    assert.equal(result.body.data.limit, 10);
    assert.equal(result.body.data.offset, 20);
  });

  assert.equal(rpcCall.name, 'list_admin_customers');
  assert.deepEqual(rpcCall.args, {
    p_search: '熟客',
    p_limit: 10,
    p_offset: 20
  });
});

test('customer list validates pagination and reports Supabase failures', async () => {
  let calls = 0;
  const router = createRouter({
    rpc: async () => {
      calls += 1;
      return { data: null, error: { code: 'XX000', message: 'database unavailable' } };
    }
  });

  await withServer(router, async baseUrl => {
    const invalid = await getCustomers(baseUrl, '?limit=101');
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.success, false);
    assert.equal(invalid.body.data, null);
    assert.equal(calls, 0);

    const failure = await getCustomers(baseUrl);
    assert.equal(failure.status, 500);
    assert.equal(failure.body.success, false);
    assert.equal(failure.body.data, null);
    assert.equal(failure.body.message.length > 0, true);
    assert.equal(calls, 1);
  });
});

test('credit status update validates input, persists allowed values, and handles missing customers', async () => {
  const customer = {
    id: CUSTOMER_ID,
    customer_phone: '85212345678',
    customer_name: '小行星熟客',
    credit_status: 'normal'
  };
  let updatedValues;
  let filteredId;
  const router = createRouter({
    from(table) {
      assert.equal(table, 'customers');
      return {
        update(values) {
          updatedValues = values;
          return this;
        },
        eq(field, value) {
          assert.equal(field, 'id');
          filteredId = value;
          return this;
        },
        select(fields) {
          assert.equal(fields, 'id, customer_phone, customer_name, credit_status');
          return this;
        },
        async maybeSingle() {
          if (filteredId !== customer.id) {
            return { data: null, error: null };
          }
          Object.assign(customer, updatedValues);
          return { data: { ...customer }, error: null };
        }
      };
    }
  });

  await withServer(router, async baseUrl => {
    const invalidId = await updateCreditStatus(baseUrl, 'not-a-uuid', {
      credit_status: 'blacklisted'
    });
    assert.equal(invalidId.status, 400);

    const invalidStatus = await updateCreditStatus(baseUrl, CUSTOMER_ID, {
      credit_status: 'trusted'
    });
    assert.equal(invalidStatus.status, 400);

    const unauthorized = await updateCreditStatus(baseUrl, CUSTOMER_ID, {
      credit_status: 'require_deposit'
    }, false);
    assert.equal(unauthorized.status, 401);

    const updated = await updateCreditStatus(baseUrl, CUSTOMER_ID, {
      credit_status: 'require_deposit'
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.success, true);
    assert.equal(updated.body.data.credit_status, 'require_deposit');
    assert.deepEqual(updatedValues, { credit_status: 'require_deposit' });

    const missing = await updateCreditStatus(baseUrl, '3fa85f64-5717-4562-b3fc-2c963f66afa7', {
      credit_status: 'blacklisted'
    });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.success, false);
  });
});

test('credit status update returns a structured error for database failures', async () => {
  const router = createRouter({
    from() {
      return {
        update() {
          return this;
        },
        eq() {
          return this;
        },
        select() {
          return this;
        },
        async maybeSingle() {
          return { data: null, error: { code: 'XX000', message: 'database unavailable' } };
        }
      };
    }
  });

  await withServer(router, async baseUrl => {
    const response = await updateCreditStatus(baseUrl, CUSTOMER_ID, {
      credit_status: 'blacklisted'
    });
    assert.equal(response.status, 500);
    assert.deepEqual(
      Object.keys(response.body).sort(),
      ['data', 'message', 'success']
    );
    assert.equal(response.body.success, false);
    assert.equal(response.body.data, null);
  });
});

test('customer CRM routes accept an authenticated customers admin session', async () => {
  const sessions = createAdminSessions({
    sessionSecret: SESSION_SECRET,
    credentials: [{ token: ADMIN_TOKEN, scopes: ['customers'] }]
  });
  const app = express();
  app.use(express.json());
  app.use('/api/admin-auth', sessions.router);
  app.use('/api/admin/customers', createCustomersRouter({
    rpc: async () => ({ data: [], error: null })
  }, {
    serviceRoleAvailable: true,
    isSessionAuthorized: sessions.isSessionAuthorized
  }));

  await withApplication(app, async baseUrl => {
    const login = await fetch(`${baseUrl}/api/admin-auth/login`, {
      method: 'POST',
      headers: {
        Origin: baseUrl,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ token: ADMIN_TOKEN })
    });
    const loginBody = await login.json();
    const cookie = login.headers.get('set-cookie').split(';', 1)[0];
    assert.equal(login.status, 200);
    assert.ok(loginBody.data.scopes.includes('customers'));

    const response = await fetch(`${baseUrl}/api/admin/customers`, {
      headers: { Cookie: cookie }
    });
    const responseBody = await response.json();
    assert.equal(response.status, 200);
    assert.equal(responseBody.success, true);
    assert.deepEqual(responseBody.data.customers, []);
  });
});
