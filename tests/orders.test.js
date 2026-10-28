const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const createOrdersRouter = require('../src/routes/orders');

const ORDER_UUID = 'e1da0bac-9021-4e87-920b-2f5bf5381f32';

async function withServer(router, run) {
  const app = express();
  const requestLogs = [];
  app.use((req, res, next) => {
    req.log = {
      error: (...args) => requestLogs.push({ level: 'error', args }),
      info: (...args) => requestLogs.push({ level: 'info', args }),
      warn: (...args) => requestLogs.push({ level: 'warn', args })
    };
    next();
  });
  app.use(express.json());
  app.use('/api/orders', router);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await run(`http://127.0.0.1:${port}`, requestLogs);
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
}

async function postOrder(baseUrl, body) {
  const response = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

async function postCheckout(baseUrl, body) {
  const response = await fetch(`${baseUrl}/api/orders/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

const validOrder = {
  customer_phone: '+85212345678',
  items: [
    { product_id: 51, quantity: 1 },
    { product_id: '51', quantity: 2 }
  ]
};

test('checkout merges duplicate products and returns the official order number, not its UUID', async () => {
  let rpcCall;
  await withServer(createOrdersRouter({
    rpc: async (name, args) => {
      rpcCall = { name, args };
      return {
        data: {
          order_id: ORDER_UUID,
          order_number: 'LP-20261022-A1B2C3D4',
          total_amount: 75,
          items: [{ product_id: 51, quantity: 3, unit_price: 25 }]
        },
        error: null
      };
    }
  }), async (baseUrl, requestLogs) => {
    const response = await postOrder(baseUrl, {
      ...validOrder,
      customer_name: '小行星客人',
      shipping_method: 'sf_station',
      shipping_address: '852AL',
      totalAmount: 0
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.order_number, 'LP-20261022-A1B2C3D4');
    assert.equal(response.body.data.orderNo, 'LP-20261022-A1B2C3D4');
    assert.equal(Object.hasOwn(response.body.data, 'order_id'), false);
    assert.equal(response.body.data.total_amount, 75);

    const checkout = await postCheckout(baseUrl, {
      customer: {
        phone: '+85212345678',
        name: '小行星客人',
        email: 'ignored@example.invalid'
      },
      pickup: 'sf_station',
      shipping_address: '852AL',
      items: [{ product_id: '51', qty: 3 }]
    });
    assert.equal(checkout.status, 201);
    assert.equal(checkout.body.data.order_id, 'LP-20261022-A1B2C3D4');
    assert.equal(checkout.body.data.order_number, checkout.body.data.order_id);
    assert.notEqual(checkout.body.data.order_id, ORDER_UUID);
    assert.deepEqual(checkout.body.data.items, [
      { product_id: 51, quantity: 3, unit_price: 25 }
    ]);
    const ignoredEmailLogs = requestLogs.filter(log =>
      log.level === 'warn' && log.args[0].field === 'customer.email'
    );
    assert.equal(ignoredEmailLogs.length, 1);
    assert.equal(JSON.stringify(ignoredEmailLogs).includes('ignored@example.invalid'), false);
  });

  assert.equal(rpcCall.name, 'create_customer_order');
  assert.equal(rpcCall.args.p_customer_phone, '85212345678');
  assert.deepEqual(rpcCall.args.p_items, [{ product_id: '51', quantity: 3 }]);
  assert.equal(rpcCall.args.p_customer_name, '小行星客人');
  assert.equal(rpcCall.args.p_shipping_method, '順豐');
  assert.equal(rpcCall.args.p_shipping_address, '順豐站：852AL');
});

test('checkout stores a human-readable order number when the RPC does not return one', async () => {
  const order = { order_id: ORDER_UUID, order_number: null };
  const supabase = {
    rpc: async () => ({
      data: { order_id: ORDER_UUID, total_amount: 25, items: [] },
      error: null
    }),
    from(table) {
      assert.equal(table, 'orders');
      let operation = 'select';
      let payload;
      return {
        select() {
          return this;
        },
        update(values) {
          operation = 'update';
          payload = values;
          return this;
        },
        eq(field, value) {
          assert.equal(field, 'order_id');
          assert.equal(value, ORDER_UUID);
          return this;
        },
        is(field, value) {
          assert.equal(field, 'order_number');
          assert.equal(value, null);
          return this;
        },
        async maybeSingle() {
          if (operation === 'update') {
            order.order_number = payload.order_number;
            return { data: { order_number: order.order_number }, error: null };
          }
          return { data: { order_number: order.order_number }, error: null };
        }
      };
    }
  };

  await withServer(createOrdersRouter(supabase), async baseUrl => {
    const response = await postOrder(baseUrl, validOrder);
    assert.equal(response.status, 201);
    assert.match(response.body.data.order_number, /^LP-\d{8}-[A-F0-9]{8}$/);
    assert.equal(response.body.data.order_number, order.order_number);
    assert.equal(Object.hasOwn(response.body.data, 'order_id'), false);
  });
});

test('checkout validates pickup selection and passes self-pickup details to the migration RPC', async () => {
  const rpcCalls = [];
  await withServer(createOrdersRouter({
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      return {
        data: {
          order_id: ORDER_UUID,
          order_number: 'LP-20261022-A1B2C3D4',
          total_amount: 25,
          items: [{ product_id: 4268, quantity: 1, unit_price: 25 }]
        },
        error: null
      };
    }
  }), async baseUrl => {
    const response = await postCheckout(baseUrl, {
      customer: { phone: '+85212345678', name: '小行星客人' },
      pickup: '自取',
      shipping_address: '荃灣店',
      items: [{ product_id: '4268', qty: 1 }]
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.data.order_id, 'LP-20261022-A1B2C3D4');

    for (const invalidBody of [
      {
        customer: { phone: '+85212345678' },
        pickup: 'delivery',
        items: [{ product_id: '4268', qty: 1 }]
      },
      {
        customer: { phone: '+85212345678' },
        pickup: 'sf_station',
        items: [{ product_id: '4268', qty: 1 }]
      },
      {
        customer: { phone: '+85212345678' },
        pickup: 'sf_station',
        shipping_address: 'x'.repeat(191),
        items: [{ product_id: '4268', qty: 1 }]
      }
    ]) {
      const invalid = await postCheckout(baseUrl, invalidBody);
      assert.equal(invalid.status, 400);
      assert.equal(invalid.body.success, false);
    }
  });

  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, 'create_customer_order');
  assert.equal(rpcCalls[0].args.p_customer_phone, '85212345678');
  assert.equal(rpcCalls[0].args.p_customer_name, '小行星客人');
  assert.equal(rpcCalls[0].args.p_shipping_method, '自取');
  assert.equal(rpcCalls[0].args.p_shipping_address, '荃灣店');
});

test('checkout replaces a UUID mistakenly stored as order_number before responding', async () => {
  const order = { order_id: ORDER_UUID, order_number: ORDER_UUID };
  const updates = [];
  const supabase = {
    rpc: async () => ({
      data: {
        order_id: ORDER_UUID,
        order_number: ORDER_UUID,
        total_amount: 25,
        items: []
      },
      error: null
    }),
    from(table) {
      assert.equal(table, 'orders');
      let operation = 'select';
      let filters = {};
      let payload;
      const query = {
        select() {
          return query;
        },
        update(values) {
          operation = 'update';
          payload = values;
          updates.push(values);
          return query;
        },
        eq(field, value) {
          filters[field] = value;
          return query;
        },
        is(field, value) {
          filters[field] = value;
          return query;
        },
        async maybeSingle() {
          if (filters.order_id !== ORDER_UUID) {
            return { data: null, error: null };
          }
          if (operation === 'update') {
            assert.equal(filters.order_number, ORDER_UUID);
            order.order_number = payload.order_number;
          }
          return { data: { order_number: order.order_number }, error: null };
        }
      };
      return query;
    }
  };

  await withServer(createOrdersRouter(supabase), async baseUrl => {
    const response = await postOrder(baseUrl, validOrder);
    assert.equal(response.status, 201);
    assert.match(response.body.data.order_number, /^LP-\d{8}-[A-F0-9]{8}$/);
    assert.equal(response.body.data.orderNo, response.body.data.order_number);
    assert.notEqual(response.body.data.order_number, ORDER_UUID);
    assert.equal(Object.hasOwn(response.body.data, 'order_id'), false);
  });
  assert.equal(order.order_number, updates[0].order_number);
});

test('stock conflict is surfaced without a success-shaped fallback', async () => {
  await withServer(createOrdersRouter({
    rpc: async () => ({
      data: null,
      error: {
        code: 'P0001',
        message: 'STOCK_UNAVAILABLE',
        details: JSON.stringify({ product_id: '51', requested: 3, available: 1 })
      }
    })
  }), async baseUrl => {
    const response = await postOrder(baseUrl, validOrder);
    assert.equal(response.status, 409);
    assert.equal(response.body.success, false);
    assert.equal(response.body.code, 'STOCK_UNAVAILABLE');
    assert.deepEqual(response.body.data, { product_id: '51', requested: 3, available: 1 });
  });
});

test('invalid checkout data and missing service role never call the RPC', async () => {
  let calls = 0;
  const supabase = {
    rpc: async () => {
      calls += 1;
      return { data: null, error: null };
    }
  };

  await withServer(createOrdersRouter(supabase), async baseUrl => {
    for (const body of [
      { ...validOrder, customer_phone: 'bad' },
      { ...validOrder, items: [{ product_id: 51, quantity: 0 }] },
      { ...validOrder, items: [{ product_id: 'not-an-id', quantity: 1 }] },
      { ...validOrder, items: [{ product_id: '9223372036854775808', quantity: 1 }] },
      { ...validOrder, items: [{ product_id: ORDER_UUID, quantity: 1 }] },
      { ...validOrder, items: [{ product_id: Number.MAX_SAFE_INTEGER + 1, quantity: 1 }] },
      { ...validOrder, items: [{ product_id: 51, quantity: '1' }] },
      { ...validOrder, items: [{ product_id: 51, quantity: true }] },
      { ...validOrder, shipping_method: 'sf_station' },
      { ...validOrder, shipping_method: 'sf_station', shipping_address: 'x'.repeat(191) },
      { ...validOrder, customer_name: 42 },
      { ...validOrder, shipping_address: 'x'.repeat(201) }
    ]) {
      const response = await postOrder(baseUrl, body);
      assert.equal(response.status, 400);
      assert.equal(response.body.success, false);
    }

    for (const body of [
      { customer: { phone: 'bad' }, items: [{ product_id: '51', qty: 1 }] },
      { customer: { phone: '+85212345678' }, items: [{ product_id: 51, qty: 1 }] },
      {
        customer: { phone: '+85212345678' },
        items: [{ product_id: '9223372036854775808', qty: 1 }]
      },
      { customer: { phone: '+85212345678' }, items: [{ product_id: '51', qty: 0 }] },
      { customer: { phone: '+85212345678' }, items: [{ product_id: '51', qty: 1.5 }] },
      { customer: { email: 'guest@example.invalid' }, items: [{ product_id: '51', qty: 1 }] }
    ]) {
      const response = await postCheckout(baseUrl, body);
      assert.equal(response.status, 400);
      assert.equal(response.body.success, false);
    }
  });
  assert.equal(calls, 0);

  await withServer(createOrdersRouter(supabase, { serviceRoleAvailable: false }), async baseUrl => {
    const response = await postOrder(baseUrl, validOrder);
    assert.equal(response.status, 503);
    assert.equal(response.body.success, false);
    assert.equal(response.body.code, 'CHECKOUT_NOT_CONFIGURED');
    assert.match(response.body.message, /SUPABASE_SERVICE_ROLE_KEY/);
  });
  assert.equal(calls, 0);
});
