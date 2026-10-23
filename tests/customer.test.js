const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const createCustomerRouter = require('../routes/customer');

const RATE_SECRET = '0123456789abcdef0123456789abcdef';
const ORDER_UUID = 'e1da0bac-9021-4e87-920b-2f5bf5381f32';
const SESSION_SECRET = 'customer-session-signing-secret-0123456789';
const PHONE = '85212345678';

async function withServer(router, run) {
  const app = express();
  app.use(express.json());
  app.use('/api/customer', router);
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

async function request(baseUrl, body) {
  const response = await fetch(`${baseUrl}/api/customer/orders/lookup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return {
    status: response.status,
    retryAfter: response.headers.get('retry-after'),
    body: await response.json()
  };
}

function createRouter(supabase, options = {}) {
  return createCustomerRouter(supabase, {
    rateLimitSecret: RATE_SECRET,
    readEnabled: true,
    ...options
  });
}

function createLookupSupabase(orders, state = { calls: 0, rpcCalls: 0 }) {
  return {
    async rpc(name, args) {
      state.rpcCalls += 1;
      assert.equal(name, 'lookup_customer_orders');
      const order = orders.find(row => String(row.order_id) === String(args.p_order_id));
      return {
        data: {
          rate_limited: false,
          orders: order ? [{ order_id: order.order_id, items: [] }] : []
        },
        error: null
      };
    },
    from(table) {
      const filters = [];
      const query = {
        select() {
          return this;
        },
        in(field, values) {
          filters.push(row => values.includes(row[field]));
          return this;
        },
        eq(field, value) {
          filters.push(row => String(row[field]) === String(value));
          return this;
        },
        async maybeSingle() {
          state.calls += 1;
          const rows = table === 'orders' ? orders : [];
          return {
            data: rows.find(row => filters.every(filter => filter(row))) || null,
            error: null
          };
        },
        then(resolve, reject) {
          state.calls += 1;
          const rows = table === 'orders' ? orders : [];
          return Promise.resolve({
            data: rows.filter(row => filters.every(filter => filter(row))),
            error: null
          }).then(resolve, reject);
        }
      };
      return query;
    }
  };
}

test('guest single-order lookup requires both matching phone and official order number', async () => {
  const state = { calls: 0, rpcCalls: 0 };
  const order = {
    order_id: ORDER_UUID,
    order_number: 'LP-20261022-A1B2C3D4',
    customer_phone: '85212345678',
    order_date: '2026-10-22T00:00:00.000Z',
    total_amount: 10,
    shipping_status: '已出貨',
    shipping_method: '順豐',
    shipping_carrier: 'SF Express',
    tracking_number: 'SF-123456',
    payment_proof_url: 'private/path/proof.png',
    payment_proof_status: 'pending'
  };

  await withServer(createRouter(createLookupSupabase([order], state)), async baseUrl => {
    const match = await request(baseUrl, {
      customer_phone: '+85212345678',
      order_number: order.order_number.toLowerCase()
    });
    assert.equal(match.status, 200);
    assert.equal(match.body.success, true);
    assert.equal(match.body.data.length, 1);
    assert.equal(match.body.data[0].order_number, order.order_number);
    assert.equal(match.body.data[0].shipping_carrier, 'SF Express');
    assert.equal(match.body.data[0].tracking_number, 'SF-123456');
    assert.equal(match.body.data[0].payment_proof_submitted, true);
    assert.equal(match.body.data[0].payment_proof_status, 'pending');
    assert.equal(match.body.data[0].payment_proof_url, undefined);

    const wrongPhone = await request(baseUrl, {
      customer_phone: '85200000000',
      order_number: order.order_number
    });
    assert.equal(wrongPhone.status, 200);
    assert.deepEqual(wrongPhone.body.data, []);

    const wrongOrderNumber = await request(baseUrl, {
      customer_phone: '85212345678',
      order_number: 'LP-20261022-00000000'
    });
    assert.equal(wrongOrderNumber.status, 200);
    assert.deepEqual(wrongOrderNumber.body.data, []);
  });

  assert.equal(state.calls, 3);
  assert.equal(state.rpcCalls, 1);
});

test('guest lookup rejects either missing credential and UUID-only lookups', async () => {
  const state = { calls: 0, rpcCalls: 0 };
  await withServer(createRouter(createLookupSupabase([], state)), async baseUrl => {
    for (const body of [
      {},
      { customer_phone: PHONE },
      { order_number: 'LP-20261022-A1B2C3D4' },
      { order_id: ORDER_UUID },
      { customer_phone: PHONE, order_id: ORDER_UUID },
      { customer_phone: 'invalid', order_number: 'LP-20261022-A1B2C3D4' }
    ]) {
      const response = await request(baseUrl, body);
      assert.equal(response.status, 400);
      assert.equal(response.body.success, false);
      assert.equal(response.body.data, null);
    }
  });
  assert.equal(state.calls, 0);
  assert.equal(state.rpcCalls, 0);
});

test('guest lookup service remains disabled when read access is unavailable', async () => {
  await withServer(createRouter(createLookupSupabase([]), { readEnabled: false }), async baseUrl => {
    const response = await request(baseUrl, {
      customer_phone: PHONE,
      order_number: 'LP-20261022-A1B2C3D4'
    });
    assert.equal(response.status, 503);
  });
});

  function createMemberSupabase() {
    const orders = [
      {
        order_id: ORDER_UUID,
        customer_phone: PHONE,
        order_date: '2026-10-03T01:00:00.000Z',
        total_amount: 49.5,
        status: 'pending',
        payment_status: '未付款',
        shipping_status: '待到貨'
      },
      {
        order_id: 'e1da0bac-9021-4e87-920b-2f5bf5381f33',
        customer_phone: PHONE,
        order_date: '2026-10-02T01:00:00.000Z',
        total_amount: 25,
        status: 'completed',
        payment_status: '已付清',
        shipping_status: '已出貨'
      },
      {
        order_id: 'e1da0bac-9021-4e87-920b-2f5bf5381f34',
        customer_phone: '85200000000',
        order_date: '2026-10-01T01:00:00.000Z',
        total_amount: 999,
        status: 'pending',
        payment_status: '未付款',
        shipping_status: '待到貨'
      }
    ];
    const items = [
      { order_id: ORDER_UUID, product_id: 7, quantity: 3, unit_price: 16.5 },
      { order_id: 'e1da0bac-9021-4e87-920b-2f5bf5381f33', product_id: 8, quantity: 1, unit_price: 25 }
    ];
    const products = [
      { id: 7, name: '星球貼紙' },
      { id: 8, product_name: '月球筆記本' }
    ];

    class Query {
      constructor(table) {
        this.table = table;
        this.filters = [];
        this.rangeStart = 0;
        this.rangeEnd = Infinity;
      }

      select(_fields, options) {
        this.countRequested = options && options.count === 'exact';
        return this;
      }

      eq(field, value) {
        this.filters.push(row => String(row[field]) === String(value));
        return this;
      }

      or(expression) {
        const values = [...expression.matchAll(/customer_phone\.eq\.([+0-9]+)/g)].map(match => match[1]);
        this.filters.push(row => values.includes(row.customer_phone));
        return this;
      }

      in(field, values) {
        const set = new Set(values.map(String));
        this.filters.push(row => set.has(String(row[field])));
        return this;
      }

      order() {
        return this;
      }

      range(start, end) {
        this.rangeStart = start;
        this.rangeEnd = end;
        return this;
      }

      limit(maximum) {
        this.maximum = maximum;
        return this;
      }

      async maybeSingle() {
        const result = await this.execute();
        return { data: result.data[0] || null, error: null };
      }

      async execute() {
        const source = this.table === 'orders'
          ? orders
          : this.table === 'order_items'
            ? items
            : products;
        const matching = source.filter(row => this.filters.every(filter => filter(row)));
        const selected = matching.slice(this.rangeStart, this.rangeEnd + 1);
        return {
          data: this.maximum === undefined ? selected : selected.slice(0, this.maximum),
          count: this.countRequested ? matching.length : null,
          error: null
        };
      }

      then(resolve, reject) {
        return this.execute().then(resolve, reject);
      }
    }

    return { from: table => new Query(table) };
  }

  function createMemberRouter(supabase, options = {}) {
    return createCustomerRouter(supabase, {
      rateLimitSecret: RATE_SECRET,
      sessionSecret: SESSION_SECRET,
      readEnabled: true,
      ...options
    });
  }

  test('member session requires phone and matching existing order proof; history remains private and paginated', async () => {
    await withServer(createMemberRouter(createMemberSupabase()), async baseUrl => {
      const noOrigin = await fetch(`${baseUrl}/api/customer/member/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_phone: PHONE, order_id: ORDER_UUID })
      });
      assert.equal(noOrigin.status, 403);

      const invalidProof = await fetch(`${baseUrl}/api/customer/member/session`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ customer_phone: '85200000000', order_id: ORDER_UUID })
      });
      assert.equal(invalidProof.status, 401);
      assert.equal(invalidProof.headers.get('set-cookie'), null);

      const historyBeforeLogin = await fetch(`${baseUrl}/api/customer/orders`);
      assert.equal(historyBeforeLogin.status, 401);

      const login = await fetch(`${baseUrl}/api/customer/member/session`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ customer_phone: `+${PHONE}`, order_id: ORDER_UUID })
      });
      const loginBody = await login.json();
      const setCookie = login.headers.get('set-cookie');
      assert.equal(login.status, 200);
      assert.equal(loginBody.success, true);
      assert.equal(loginBody.data.authenticated, true);
      assert.match(setCookie, /HttpOnly/i);
      assert.match(setCookie, /SameSite=Strict/i);
      assert.doesNotMatch(setCookie, new RegExp(PHONE));
      const cookie = setCookie.split(';', 1)[0];

      const session = await fetch(`${baseUrl}/api/customer/member/session`, {
        headers: { Cookie: cookie }
      });
      const sessionBody = await session.json();
      assert.equal(sessionBody.data.authenticated, true);
      assert.equal(sessionBody.data.phone, '••••5678');

      const history = await fetch(`${baseUrl}/api/customer/orders?limit=1&offset=0`, {
        headers: { Cookie: cookie }
      });
      const historyBody = await history.json();
      assert.equal(history.status, 200);
      assert.equal(historyBody.success, true);
      assert.equal(historyBody.data.total_count, 2);
      assert.equal(historyBody.data.orders.length, 1);
      assert.equal(historyBody.data.orders[0].order_id, ORDER_UUID);
      assert.equal(historyBody.data.orders[0].items[0].product_name, '星球貼紙');
      assert.equal(historyBody.data.orders[0].items[0].quantity, 3);

      const secondPage = await fetch(`${baseUrl}/api/customer/orders?limit=1&offset=1`, {
        headers: { Cookie: cookie }
      });
      const secondBody = await secondPage.json();
      assert.equal(secondBody.data.orders[0].status, 'completed');
      assert.equal(secondBody.data.orders[0].order_id, 'e1da0bac-9021-4e87-920b-2f5bf5381f33');

      const logout = await fetch(`${baseUrl}/api/customer/member/logout`, {
        method: 'POST',
        headers: { Origin: baseUrl, Cookie: cookie }
      });
      assert.equal(logout.status, 200);
      assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
      const afterLogout = await fetch(`${baseUrl}/api/customer/orders`);
      assert.equal(afterLogout.status, 401);
    });
  });

  test('member cookies reject tampering and member session configuration is required', async () => {
    await withServer(createMemberRouter(createMemberSupabase()), async baseUrl => {
      const login = await fetch(`${baseUrl}/api/customer/member/session`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ customer_phone: PHONE, order_id: ORDER_UUID })
      });
      const cookie = login.headers.get('set-cookie').split(';', 1)[0];
      const cookieName = cookie.slice(0, cookie.indexOf('='));
      const cookieValue = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1));
      const signatureSeparator = cookieValue.lastIndexOf('.');
      const signature = cookieValue.slice(signatureSeparator + 1);
      const changedSignature = `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
      const tamperedCookie = `${cookieName}=${encodeURIComponent(
        `${cookieValue.slice(0, signatureSeparator + 1)}${changedSignature}`
      )}`;
      const response = await fetch(`${baseUrl}/api/customer/orders`, {
        headers: { Cookie: tamperedCookie }
      });
      assert.equal(response.status, 401);
    });

    await withServer(createCustomerRouter(createMemberSupabase(), {
      readEnabled: true,
      rateLimitSecret: RATE_SECRET
    }), async baseUrl => {
      const response = await fetch(`${baseUrl}/api/customer/member/session`);
      const body = await response.json();
      assert.equal(response.status, 503);
      assert.equal(body.success, false);
      assert.match(body.message, /CUSTOMER_SESSION_SECRET/);
    });
  });
