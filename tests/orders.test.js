const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const createOrdersRouter = require('../src/routes/orders');

const ORDER_UUID = 'e1da0bac-9021-4e87-920b-2f5bf5381f32';
const DEFAULT_IDEMPOTENCY_KEY = '2a0d4f4c-9d99-4c93-8a74-28ecff9d67a1';

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

async function postCheckout(baseUrl, body, includeDefaultIdempotencyKey = true) {
  const requestBody = Object.hasOwn(body, 'idempotency_key') || !includeDefaultIdempotencyKey
    ? body
    : { ...body, idempotency_key: DEFAULT_IDEMPOTENCY_KEY };
  const response = await fetch(`${baseUrl}/api/orders/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });
  return { status: response.status, body: await response.json() };
}

function createShippingDetailsSupabase(options = {}) {
  const order = {
    order_id: ORDER_UUID,
    order_number: 'LP-20261022-A1B2C3D4',
    customer_phone: '85212345678',
    customer_name: '測試顧客',
    shipping_address: '順豐站：852AL',
    shipping_fee: 0,
    pickup_location_id: null,
    pickup_slot: null,
    shipping_details_initialized: false,
    total_amount: 25,
    order_date: '2026-10-22T00:00:00.000Z',
    status: 'pending',
    payment_status: '未付款',
    payment_proof_url: null,
    payment_proof_status: 'pending',
    shipping_status: '待到貨',
    shipping_method: '順豐',
    shipping_carrier: null,
    tracking_number: null,
    ...options.order
  };

  return {
    from(table) {
      let fields = '';
      const query = {
        select(value) {
          fields = value;
          return query;
        },
        in() {
          return query;
        },
        eq() {
          return query;
        },
        order() {
          return query;
        },
        range() {
          return query;
        },
        limit() {
          return query;
        },
        async maybeSingle() {
          if (
            table === 'orders' &&
            options.shippingColumnsMissing &&
            fields.includes('shipping_fee')
          ) {
            return { data: null, error: { code: '42703' } };
          }
          return { data: table === 'orders' ? order : null, error: null };
        },
        then(resolve, reject) {
          let result;
          if (
            table === 'orders' &&
            options.shippingColumnsMissing &&
            fields.includes('shipping_fee')
          ) {
            result = { data: null, error: { code: '42703' }, count: null };
          } else if (table === 'orders' && fields.includes('shipping_fee')) {
            result = { data: [order], error: null, count: 1 };
          } else if (table === 'orders') {
            result = { data: [order], error: null, count: 1 };
          } else {
            result = { data: [], error: null };
          }
          return Promise.resolve(result).then(resolve, reject);
        }
      };
      return query;
    }
  };
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
  assert.equal(rpcCall.args.p_idempotency_key, DEFAULT_IDEMPOTENCY_KEY);
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

test('phone checkout uses the RPC tier price instead of a client-supplied price', async () => {
  let rpcCall;
  await withServer(createOrdersRouter({
    rpc: async (name, args) => {
      rpcCall = { name, args };
      return {
        data: {
          order_id: ORDER_UUID,
          order_number: 'LP-20261028-A1B2C3D4',
          total_amount: 270,
          items: [{
            product_id: 51,
            product_name: '團購商品',
            quantity: 3,
            unit_price: 90
          }]
        },
        error: null
      };
    }
  }), async baseUrl => {
    const response = await postCheckout(baseUrl, {
      customer: { phone: '+85212345678' },
      items: [{ product_id: '51', qty: 3, unit_price: 0, total: 0 }]
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.data.total_amount, 270);
    assert.equal(response.body.data.items[0].unit_price, 90);
  });

  assert.equal(rpcCall.name, 'create_customer_order');
  assert.deepEqual(rpcCall.args.p_items, [
    { product_id: '51', quantity: 3 }
  ]);
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

test('admin and customer order views never present an uninitialized shipping fee as zero', async () => {
  await withServer(createOrdersRouter(createShippingDetailsSupabase(), {
    serviceRoleAvailable: true,
    isSessionAuthorized: () => true
  }), async baseUrl => {
    const adminResponse = await fetch(`${baseUrl}/api/orders/admin/orders`, {
      headers: { 'x-admin-session': 'valid' }
    });
    const adminBody = await adminResponse.json();
    assert.equal(adminResponse.status, 200);
    assert.equal(adminBody.data.orders[0].shipping_fee, null);
    assert.equal(adminBody.data.orders[0].shipping_details_message, '資料不足');

    const customerResponse = await fetch(`${baseUrl}/api/orders/query-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '85212345678', orderNo: 'LP-20261022-A1B2C3D4' })
    });
    const customerBody = await customerResponse.json();
    assert.equal(customerResponse.status, 200);
    assert.equal(customerBody.data.shipping_details_initialized, false);
    assert.equal(customerBody.data.shipping_fee, null);
    assert.equal(customerBody.data.shipping_details_message, '資料不足');
  });
});

test('customer order lookup falls back safely when optional shipping columns are missing', async () => {
  await withServer(createOrdersRouter(createShippingDetailsSupabase({
    shippingColumnsMissing: true,
    order: {
      shipping_fee: undefined,
      shipping_details_initialized: undefined
    }
  }), {
    serviceRoleAvailable: true,
    isSessionAuthorized: () => true
  }), async baseUrl => {
    const adminResponse = await fetch(`${baseUrl}/api/orders/admin/orders`, {
      headers: { 'x-admin-session': 'valid' }
    });
    const adminBody = await adminResponse.json();
    assert.equal(adminResponse.status, 200);
    assert.equal(adminBody.data.orders[0].shipping_fee, null);
    assert.equal(adminBody.data.orders[0].shipping_details_message, '資料不足');

    const response = await fetch(`${baseUrl}/api/orders/query-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '85212345678', orderNo: 'LP-20261022-A1B2C3D4' })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.shipping_fee, null);
    assert.equal(body.data.shipping_details_message, '資料不足');
  });
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

test('checkout replays the same order for one phone and key, but creates a new order for a new key', async () => {
  const ordersByIdempotencyKey = new Map();
  const rpcCalls = [];
  let nextOrder = 0;
  const keys = [
    DEFAULT_IDEMPOTENCY_KEY,
    '64e58e7a-5316-4d4d-8a49-005cfe2eac21'
  ];

  await withServer(createOrdersRouter({
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      const compositeKey = `${args.p_customer_phone}:${args.p_idempotency_key}`;
      let order = ordersByIdempotencyKey.get(compositeKey);
      if (!order) {
        nextOrder += 1;
        const suffix = String(nextOrder).padStart(8, '0');
        order = {
          order_id: `b9e5d550-1e4a-4f4d-8a74-0000${suffix}`,
          order_number: `LP-20261029-${suffix}`,
          total_amount: 25,
          items: [{ product_id: '4268', quantity: 1, unit_price: 25 }]
        };
        ordersByIdempotencyKey.set(compositeKey, order);
      }
      return { data: order, error: null };
    }
  }), async (baseUrl, requestLogs) => {
    const request = key => postCheckout(baseUrl, {
      customer: { phone: '+85212345678' },
      items: [{ product_id: '4268', qty: 1 }],
      idempotency_key: key
    });

    const first = await request(keys[0]);
    const retry = await request(keys[0]);
    const secondOrder = await request(keys[1]);
    const differentPhone = await postCheckout(baseUrl, {
      customer: { phone: '+85287654321' },
      items: [{ product_id: '4268', qty: 1 }],
      idempotency_key: keys[0]
    });

    assert.equal(first.status, 201);
    assert.equal(retry.status, 201);
    assert.equal(first.body.data.order_id, retry.body.data.order_id);
    assert.notEqual(first.body.data.order_id, secondOrder.body.data.order_id);
    assert.notEqual(first.body.data.order_id, differentPhone.body.data.order_id);
    assert.equal(first.body.data.order_id, first.body.data.order_number);
    assert.equal(rpcCalls.length, 4);
    assert.deepEqual(rpcCalls.map(call => call.args.p_idempotency_key), [
      keys[0],
      keys[0],
      keys[1],
      keys[0]
    ]);
    assert.equal(rpcCalls[0].args.p_customer_phone, '85212345678');

    const checkoutLogs = requestLogs.filter(log =>
      log.level === 'info' && log.args[1] === 'Checkout request received'
    );
    assert.equal(checkoutLogs.length, 4);
    assert.equal(checkoutLogs[0].args[0].phone_suffix, '5678');
    assert.equal(checkoutLogs[3].args[0].phone_suffix, '4321');
    assert.equal(JSON.stringify(checkoutLogs).includes('85212345678'), false);
  });
});

test('checkout requires a UUID v4 key and sanitizes deadline and duplicate errors', async () => {
  let rpcCalls = 0;
  await withServer(createOrdersRouter({
    rpc: async (_name, args) => {
      rpcCalls += 1;
      if (args.p_idempotency_key === DEFAULT_IDEMPOTENCY_KEY) {
        return {
          data: null,
          error: { code: 'P0001', message: 'PREORDER_DEADLINE_PASSED', details: 'database internals' }
        };
      }
      return { data: null, error: { code: '23505', message: 'private constraint name' } };
    }
  }), async baseUrl => {
    const baseBody = {
      customer: { phone: '+85212345678' },
      items: [{ product_id: '4268', qty: 1 }]
    };
    const missingKey = await postCheckout(baseUrl, baseBody, false);
    const invalidKey = await postCheckout(baseUrl, {
      ...baseBody,
      idempotency_key: 'not-a-uuid'
    });
    assert.equal(missingKey.status, 400);
    assert.equal(invalidKey.status, 400);

    const deadline = await postCheckout(baseUrl, {
      ...baseBody,
      idempotency_key: DEFAULT_IDEMPOTENCY_KEY
    });
    assert.equal(deadline.status, 409);
    assert.equal(deadline.body.code, 'PREORDER_DEADLINE_PASSED');
    assert.equal(deadline.body.message, '預購已截止，請移除相關商品後再試。');
    assert.equal(JSON.stringify(deadline.body).includes('database internals'), false);

    const duplicate = await postCheckout(baseUrl, {
      ...baseBody,
      idempotency_key: '64e58e7a-5316-4d4d-8a49-005cfe2eac21'
    });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.code, 'DUPLICATE_REQUEST');
    assert.equal(JSON.stringify(duplicate.body).includes('private constraint name'), false);
  });
  assert.equal(rpcCalls, 2);
});
