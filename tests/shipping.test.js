const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const XLSX = require('xlsx');
const createShippingRouter = require('../src/routes/shipping');
const createOrdersRouter = require('../src/routes/orders');

const ADMIN_TOKEN = '0123456789abcdef0123456789abcdef';

async function withServer(router, run, mountPath = '/api/shipping') {
  const app = express();
  app.use(express.json());
  app.use(mountPath, router);
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

async function request(baseUrl, path, options = {}) {
  const headers = {
    Authorization: `Bearer ${ADMIN_TOKEN}`,
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {})
  };
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  return { status: response.status, body: await response.json() };
}

function createRouter(supabase, options = {}) {
  return createShippingRouter(supabase, {
    adminToken: ADMIN_TOKEN,
    writeEnabled: true,
    ...options
  });
}

function createTableClient(tables) {
  return {
    from(tableName) {
      const state = {
        rows: tables[tableName] || [],
        filters: []
      };
      const query = {
        select() {
          return query;
        },
        eq(column, value) {
          state.filters.push(row => row[column] === value);
          return query;
        },
        in(column, values) {
          const selected = new Set(values.map(String));
          state.filters.push(row => selected.has(String(row[column])));
          return query;
        },
        order() {
          return query;
        },
        limit() {
          return query;
        },
        then(resolve, reject) {
          return Promise.resolve({
            data: state.rows.filter(row => state.filters.every(filter => filter(row))),
            error: null
          }).then(resolve, reject);
        }
      };
      return query;
    }
  };
}

test('read-only table fallback returns order and product pick lists but blocks shipment writes', async () => {
  const router = createRouter(createTableClient({
    orders: [{
      order_id: 'f6d0d17c-60a4-4434-a704-7f68456c0bf2',
      order_date: '2026-09-20T10:00:00+08:00',
      customer_phone: '85212345678',
      shipping_method: '順豐',
      tracking_number: null,
      shipping_status: '可出貨'
    }],
    order_items: [{
      item_id: '56a3da12-3340-4b24-8373-b2bf59f49f5b',
      order_id: 'f6d0d17c-60a4-4434-a704-7f68456c0bf2',
      product_id: 'a56c1af6-82a4-4cdf-9176-08fb268aca43',
      quantity: 2,
      item_status: '已到貨倉'
    }],
    products: [{
      id: 'a56c1af6-82a4-4cdf-9176-08fb268aca43',
      name: '星球筆記本'
    }]
  }), { readEnabled: true, writeEnabled: false });

  await withServer(router, async baseUrl => {
    const byOrder = await request(baseUrl, '/api/shipping/pick-list?group_by=order');
    assert.equal(byOrder.status, 200);
    assert.equal(byOrder.body.data[0].order_id, 'f6d0d17c-60a4-4434-a704-7f68456c0bf2');
    assert.equal(byOrder.body.data[0].items[0].product_name, '星球筆記本');

    const byProduct = await request(baseUrl, '/api/shipping/pick-list?group_by=product');
    assert.equal(byProduct.status, 200);
    assert.equal(byProduct.body.data[0].total_quantity, 2);
    assert.equal(byProduct.body.data[0].orders[0].order_id, 'f6d0d17c-60a4-4434-a704-7f68456c0bf2');

    const blockedWrite = await request(baseUrl, '/api/shipping/anything/ship', {
      method: 'POST',
      body: { shipping_method: '順豐', tracking_number: 'SF12345678' }
    });
    assert.equal(blockedWrite.status, 503);
  });
});

test('pick list supports order and product grouping and validates group_by', async () => {
  const calls = [];
  const router = createRouter({
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: [{ order_id: 15 }], error: null };
    }
  });

  await withServer(router, async baseUrl => {
    const byOrder = await request(baseUrl, '/api/shipping/pick-list?group_by=order');
    assert.equal(byOrder.status, 200);
    assert.equal(byOrder.body.success, true);
    const byProduct = await request(baseUrl, '/api/shipping/pick-list?group_by=product');
    assert.equal(byProduct.status, 200);
    const invalid = await request(baseUrl, '/api/shipping/pick-list?group_by=customer');
    assert.equal(invalid.status, 400);
  });

  assert.deepEqual(calls, [
    { name: 'get_shipping_pick_list', args: { p_group_by: 'order' } },
    { name: 'get_shipping_pick_list', args: { p_group_by: 'product' } }
  ]);
});

test('shipping updates atomically and sends a WhatsApp notification', async () => {
  const calls = [];
  const sent = [];
  const supabase = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === 'ship_order') {
        return { data: { success: true, shipment: { order_id: 29 } }, error: null };
      }
      if (name === 'claim_shipping_notification') {
        return {
          data: {
            claimed: true,
            status: 'sending',
            customer_phone: '85212345678',
            shipping_method: '順豐',
            tracking_number: 'SF1000'
          },
          error: null
        };
      }
      return { data: { status: 'sent' }, error: null };
    }
  };
  const router = createRouter(supabase, {
    sendWhatsApp: async message => sent.push(message)
  });

  test('bulk tracking imports CSV using order numbers and processes notification status', async () => {
    const calls = [];
    const orderId = 'f6d0d17c-60a4-4434-a704-7f68456c0bf2';
    const router = createRouter({
      rpc: async (name, args) => {
        calls.push({ name, args });
        if (name === 'bulk_ship_orders') {
          return {
            data: {
              shipments: [{
                order_number: 'LP-20261022-001',
                shipment: { shipping_status: '已出貨' }
              }],
              order_ids: [orderId]
            },
            error: null
          };
        }
        if (name === 'claim_shipping_notification') {
          return {
            data: { claimed: false, status: 'sent' },
            error: null
          };
        }
        throw new Error(`Unexpected RPC ${name}`);
      }
    });

    await withServer(router, async baseUrl => {
      const csv = Buffer.from(
        'order_number,tracking_number\nLP-20261022-001,SF12345678\n',
        'utf8'
      );
      const response = await fetch(`${baseUrl}/api/shipping/bulk-tracking`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ADMIN_TOKEN}`,
          'Content-Type': 'text/csv',
          'X-Upload-Filename': 'tracking.csv',
          'X-Shipping-Method': encodeURIComponent('順豐')
        },
        body: csv
      });
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.success, true);
      assert.equal(body.data.imported_count, 1);
      assert.equal(body.data.results[0].notification.success, true);
      assert.deepEqual(calls, [
        {
          name: 'bulk_ship_orders',
          args: {
            p_shipments: [{
              order_number: 'LP-20261022-001',
              tracking_number: 'SF12345678',
              shipping_method: '順豐'
            }]
          }
        },
        {
          name: 'claim_shipping_notification',
          args: { p_order_id: orderId }
        }
      ]);
    });
  });

  test('bulk tracking rejects duplicate rows and invalid headers before database access', async () => {
    let calls = 0;
    const router = createRouter({
      rpc: async () => {
        calls += 1;
        return { data: null, error: null };
      }
    });

    await withServer(router, async baseUrl => {
      for (const contents of [
        'order_number,tracking_number\nLP-1,SF1\nLP-1,SF2\n',
        'wrong_header,tracking_number\nLP-1,SF1\n'
      ]) {
        const response = await fetch(`${baseUrl}/api/shipping/bulk-tracking`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${ADMIN_TOKEN}`,
            'Content-Type': 'text/csv',
            'X-Upload-Filename': 'tracking.csv',
            'X-Shipping-Method': encodeURIComponent('順豐')
          },
          body: Buffer.from(contents, 'utf8')
        });
        const body = await response.json();
        assert.equal(response.status, 400);
        assert.equal(body.success, false);
        assert.equal(body.data, null);
      }
    });
    assert.equal(calls, 0);
  });

  await withServer(router, async baseUrl => {
    const response = await request(baseUrl, '/api/shipping/29/ship', {
      method: 'POST',
      body: {
        shipping_method: '順豐',
        tracking_number: 'SF1000'
      }
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.notification.status, 'sent');
  });

  assert.deepEqual(calls, [
    {
      name: 'ship_order',
      args: {
        p_order_id: '29',
        p_shipping_method: '順豐',
        p_tracking_number: 'SF1000',
        p_customer_phone: null
      }
    },
    { name: 'claim_shipping_notification', args: { p_order_id: '29' } },
    {
      name: 'finish_shipping_notification',
      args: {
        p_order_id: '29',
        p_success: true,
        p_error_message: null
      }
    }
  ]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, '85212345678');
  assert.match(sent[0].text, /SF1000/);
});

test('bulk tracking accepts an Excel workbook with localized column headings', async () => {
  const calls = [];
  const orderId = 'f6d0d17c-60a4-4434-a704-7f68456c0bf2';
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ['訂單編號', '運單號'],
    ['LP-20261022-002', 'SF87654321']
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, '物流');
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const router = createRouter({
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === 'bulk_ship_orders') {
        return {
          data: {
            shipments: [{
              order_number: 'LP-20261022-002',
              shipment: { shipping_status: '已出貨' }
            }],
            order_ids: [orderId]
          },
          error: null
        };
      }
      if (name === 'claim_shipping_notification') {
        return { data: { claimed: false, status: 'sent' }, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    }
  });

  await withServer(router, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/shipping/bulk-tracking`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'X-Upload-Filename': 'tracking.xlsx',
        'X-Shipping-Method': encodeURIComponent('順豐')
      },
      body: bytes
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.results[0].tracking_number, 'SF87654321');
  });

  assert.equal(calls[0].name, 'bulk_ship_orders');
  assert.deepEqual(calls[0].args.p_shipments, [{
    order_number: 'LP-20261022-002',
    tracking_number: 'SF87654321',
    shipping_method: '順豐'
  }]);
});

test('shipping route accepts UUID order IDs used by the production database', async () => {
  const orderId = 'f6d0d17c-60a4-4434-a704-7f68456c0bf2';
  const calls = [];
  const router = createRouter({
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === 'ship_order') {
        return { data: { success: true, shipment: { order_id: orderId } }, error: null };
      }
      if (name === 'claim_shipping_notification') {
        return { data: { claimed: false, status: 'sent' }, error: null };
      }
      return { data: { status: 'sent' }, error: null };
    }
  });

  await withServer(router, async baseUrl => {
    const response = await request(baseUrl, `/api/shipping/${orderId}/ship`, {
      method: 'POST',
      body: { shipping_method: '順豐', tracking_number: 'SF-UUID-001' }
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
  });

  assert.equal(calls[0].name, 'ship_order');
  assert.equal(calls[0].args.p_order_id, orderId);
  assert.equal(calls[1].name, 'claim_shipping_notification');
  assert.equal(calls[1].args.p_order_id, orderId);
});

test('shipping notification RPC exceptions do not hide a completed shipment', async () => {
  for (const failingRpc of ['claim_shipping_notification', 'finish_shipping_notification']) {
    const router = createRouter({
      rpc: async (name, args) => {
        if (name === 'ship_order') {
          return { data: { success: true, shipment: { order_id: '31' } }, error: null };
        }
        if (name === failingRpc) {
          throw new Error(`${name} unavailable`);
        }
        if (name === 'claim_shipping_notification') {
          return {
            data: {
              claimed: true,
              status: 'sending',
              customer_phone: '85212345678',
              shipping_method: '順豐',
              tracking_number: 'SF-31'
            },
            error: null
          };
        }
        return { data: { status: 'sent' }, error: null };
      }
    }, {
      sendWhatsApp: async () => {}
    });

    await withServer(router, async baseUrl => {
      const response = await request(baseUrl, '/api/shipping/31/ship', {
        method: 'POST',
        body: { shipping_method: '順豐', tracking_number: 'SF-31' }
      });
      assert.equal(response.status, 200);
      assert.equal(response.body.success, true);
      assert.equal(response.body.data.notification.success, false);
      assert.ok(response.body.data.notification.message);
    });
  }
});

test('WhatsApp failure remains explicit and can be retried', async () => {
  let attempt = 0;
  const recorded = [];
  const supabase = {
    rpc: async (name, args) => {
      recorded.push({ name, args });
      if (name === 'ship_order') {
        return { data: { success: true }, error: null };
      }
      if (name === 'claim_shipping_notification') {
        attempt += 1;
        return {
          data: {
            claimed: true,
            status: 'sending',
            customer_phone: '85212345678',
            shipping_method: '京東',
            tracking_number: 'JD007'
          },
          error: null
        };
      }
      return { data: { status: args.p_success ? 'sent' : 'failed' }, error: null };
    }
  };
  const router = createRouter(supabase, {
    sendWhatsApp: async () => {
      if (attempt === 1) {
        throw new Error('WhatsApp unavailable');
      }
    }
  });

  await withServer(router, async baseUrl => {
    const shipped = await request(baseUrl, '/api/shipping/30/ship', {
      method: 'POST',
      body: { shipping_method: '京東', tracking_number: 'JD007' }
    });
    assert.equal(shipped.status, 200);
    assert.equal(shipped.body.success, true);
    assert.equal(shipped.body.data.notification.success, false);

    const retried = await request(baseUrl, '/api/shipping/30/notification/retry', {
      method: 'POST'
    });
    assert.equal(retried.status, 200);
    assert.equal(retried.body.success, true);
  });

  assert.equal(recorded.filter(call => call.name === 'claim_shipping_notification').length, 2);
  const finishCalls = recorded.filter(call => call.name === 'finish_shipping_notification');
  assert.equal(finishCalls[0].args.p_success, false);
  assert.equal(finishCalls[1].args.p_success, true);
});

test('admin token, service role, and shipment input are enforced', async () => {
  let rpcCalls = 0;
  const router = createRouter({
    rpc: async () => {
      rpcCalls += 1;
      return { data: { success: true }, error: null };
    }
  });

  await withServer(router, async baseUrl => {
    const unauthorized = await request(baseUrl, '/api/shipping/pick-list', {
      headers: { Authorization: 'Bearer wrong' }
    });
    assert.equal(unauthorized.status, 401);

    const invalidMethod = await request(baseUrl, '/api/shipping/4/ship', {
      method: 'POST',
      body: { shipping_method: 'Unknown', tracking_number: 'ABC' }
    });
    assert.equal(invalidMethod.status, 400);

    const invalidTracking = await request(baseUrl, '/api/shipping/4/ship', {
      method: 'POST',
      body: { shipping_method: '順豐', tracking_number: '' }
    });
    assert.equal(invalidTracking.status, 400);
  });
  assert.equal(rpcCalls, 0);

  await withServer(createShippingRouter({ rpc: async () => ({ data: [], error: null }) }, {
    adminToken: ADMIN_TOKEN,
    writeEnabled: false
  }), async baseUrl => {
    const response = await request(baseUrl, '/api/shipping/pick-list');
    assert.equal(response.status, 503);
    assert.equal(response.body.success, false);
  });

  await withServer(createShippingRouter({ rpc: async () => ({ data: [], error: null }) }, {
    adminToken: 'replace-with-another-long-random-secret',
    writeEnabled: true
  }), async baseUrl => {
    const response = await request(baseUrl, '/api/shipping/pick-list');
    assert.equal(response.status, 503);
    assert.equal(response.body.success, false);
  });
});

test('RPC errors and unexpected pick-list payloads are not returned as success', async () => {
  await withServer(createRouter({
    rpc: async () => ({ data: null, error: { code: 'PGRST202' } })
  }), async baseUrl => {
    const missingMigration = await request(baseUrl, '/api/shipping/pick-list');
    assert.equal(missingMigration.status, 503);
    assert.equal(missingMigration.body.success, false);
  });

  await withServer(createRouter({
    rpc: async () => ({ data: null, error: { code: 'XX000' } })
  }), async baseUrl => {
    const dbError = await request(baseUrl, '/api/shipping/pick-list');
    assert.equal(dbError.status, 500);
    assert.equal(dbError.body.success, false);
  });

  await withServer(createRouter({
    rpc: async () => ({ data: { not: 'an array' }, error: null })
  }), async baseUrl => {
    const invalidPayload = await request(baseUrl, '/api/shipping/pick-list');
    assert.equal(invalidPayload.status, 500);
    assert.equal(invalidPayload.body.success, false);
  });
});

test('checkout requires a WhatsApp contact number before database operations', async () => {
  let databaseCalls = 0;
  const supabase = {
    from: () => {
      databaseCalls += 1;
      throw new Error('Database should not be called for invalid phone input.');
    }
  };

  await withServer(createOrdersRouter(supabase), async baseUrl => {
    const missingPhone = await request(baseUrl, '/api/orders', {
      method: 'POST',
      body: {
        totalAmount: 5,
        items: [{ product_id: 1, quantity: 1 }]
      }
    });
    assert.equal(missingPhone.status, 400);
    assert.equal(missingPhone.body.success, false);

    const invalidPhone = await request(baseUrl, '/api/orders', {
      method: 'POST',
      body: {
        customer_phone: 'abc',
        totalAmount: 5,
        items: [{ product_id: 1, quantity: 1 }]
      }
    });
    assert.equal(invalidPhone.status, 400);
    assert.equal(invalidPhone.body.success, false);
  }, '/api/orders');

  assert.equal(databaseCalls, 0);
});
