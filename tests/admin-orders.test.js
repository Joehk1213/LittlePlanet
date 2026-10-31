'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const express = require('express');
const createAdminOrdersRouter = require('../src/routes/admin/orders');

const ORDER_ID = 'e1da0bac-9021-4e87-920b-2f5bf5381f32';

async function withServer(supabase, run, options = {}) {
  const app = express();
  const logs = [];
  app.use((req, res, next) => {
    req.log = {
      error: (...args) => logs.push({ level: 'error', args }),
      info: (...args) => logs.push({ level: 'info', args }),
      warn: (...args) => logs.push({ level: 'warn', args })
    };
    next();
  });
  app.use(express.json());
  app.use('/api/admin/orders', createAdminOrdersRouter(supabase, {
    serviceRoleAvailable: true,
    isSessionAuthorized: req => req.get('x-admin-session') === 'valid',
    ...options
  }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  try {
    await run(`http://127.0.0.1:${server.address().port}`, logs);
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
}

function createSupabase(options = {}) {
  const orders = options.orders || [{
    order_id: ORDER_ID,
    order_number: 'LP-20261030-A1B2C3D4',
    customer_phone: '85212345678',
    customer_name: '測試客人',
    total_amount: 49.5,
    order_date: '2026-10-29T16:30:00.000Z',
    status: 'pending',
    payment_status: '已付清',
    payment_proof_url: null,
    shipping_status: '待到貨',
    shipping_method: '順豐'
  }];
  const tables = {
    orders,
    order_items: options.items || [{
      item_id: 1,
      order_id: ORDER_ID,
      product_id: 9,
      quantity: 3,
      unit_price: 16.5
    }],
    products: options.products || [{
      id: 9,
      name: '小行星貼紙',
      cost_price: 10
    }],
    order_profit: options.profitRows || [{
      order_id: ORDER_ID,
      items_count: 3,
      profit_total: '19.50'
    }]
  };
  const calls = [];

  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
    }

    select(fields, selectOptions) {
      this.fields = fields;
      this.countRequested = selectOptions && selectOptions.count === 'exact';
      return this;
    }

    in(field, values) {
      calls.push({ table: this.table, method: 'in', field, values });
      this.filters.push(row => values.map(String).includes(String(row[field])));
      return this;
    }

    eq(field, value) {
      calls.push({ table: this.table, method: 'eq', field, value });
      this.filters.push(row => row[field] === value);
      return this;
    }

    gte(field, value) {
      calls.push({ table: this.table, method: 'gte', field, value });
      this.filters.push(row => row[field] >= value);
      return this;
    }

    lt(field, value) {
      calls.push({ table: this.table, method: 'lt', field, value });
      this.filters.push(row => row[field] < value);
      return this;
    }

    order() {
      return this;
    }

    range(from, to) {
      this.fromIndex = from;
      this.toIndex = to;
      return this;
    }

    limit(limit) {
      this.rowLimit = limit;
      return this;
    }

    async maybeSingle() {
      const result = await this.execute();
      return { data: result.data[0] || null, error: null };
    }

    async execute() {
      calls.push({ table: this.table, method: 'select' });
      if (
        this.table === 'orders' &&
        this.fields.includes('shipping_fee') &&
        options.shippingDetailsError
      ) {
        return { data: null, error: options.shippingDetailsError };
      }
      const rows = tables[this.table] || [];
      const filtered = rows.filter(row => this.filters.every(filter => filter(row)));
      const selected = this.fromIndex === undefined
        ? filtered
        : filtered.slice(this.fromIndex, this.toIndex + 1);
      return {
        data: this.rowLimit === undefined ? selected : selected.slice(0, this.rowLimit),
        count: this.countRequested ? filtered.length : null,
        error: null
      };
    }

    then(resolve, reject) {
      return this.execute().then(resolve, reject);
    }
  }

  return {
    calls,
    orders,
    from(table) {
      return new Query(table);
    },
    async rpc(name, args) {
      calls.push({ method: 'rpc', name, args });
      if (options.rpcError) {
        return { data: null, error: options.rpcError };
      }
      if (Object.hasOwn(options, 'rpcData')) {
        return { data: options.rpcData, error: null };
      }
      const order = orders.find(item => item.order_id === args.p_order_id);
      if (order) {
        order.status = args.p_status;
      }
      return {
        data: order ? { order_id: order.order_id, status: args.p_status } : null,
        error: null
      };
    }
  };
}

test('admin order list normalizes phone, applies filters and returns profit and item count', async () => {
  const supabase = createSupabase();
  await withServer(supabase, async (baseUrl, logs) => {
    const response = await fetch(
      `${baseUrl}/api/admin/orders?phone=%2B85212345678&status=pending&from=2026-10-30&to=2026-10-30`,
      { headers: { 'x-admin-session': 'valid' } }
    );
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.data.orders.length, 1);
    assert.equal(result.data.orders[0].customer_phone, '85212345678');
    assert.equal(result.data.orders[0].items_count, 3);
    assert.equal(result.data.orders[0].profit_total, 19.5);
    assert.equal(result.data.orders[0].items[0].product_name, '小行星貼紙');
    assert.equal(result.data.orders[0].payment_proof_url, undefined);
    assert.ok(supabase.calls.some(call =>
      call.table === 'orders' &&
      call.method === 'in' &&
      call.field === 'customer_phone' &&
      call.values.includes('85212345678')
    ));
    assert.ok(supabase.calls.some(call =>
      call.table === 'orders' && call.method === 'eq' && call.field === 'status'
    ));
    const infoLog = logs.find(log => log.level === 'info');
    assert.ok(infoLog);
    assert.equal(infoLog.args[0].phone_suffix, '5678');
    assert.equal(JSON.stringify(infoLog).includes('85212345678'), false);
  });
});

test('admin order list reports unknown product costs as unknown profit', async () => {
  const supabase = createSupabase({
    profitRows: [{ order_id: ORDER_ID, items_count: 3, profit_total: null }]
  });
  await withServer(supabase, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/admin/orders`, {
      headers: { 'x-admin-session': 'valid' }
    });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.data.orders[0].profit_total, null);
  });
});

test('admin order list remains available when optional shipping fields are not migrated', async () => {
  const supabase = createSupabase({
    shippingDetailsError: { code: '42703' }
  });
  await withServer(supabase, async (baseUrl, logs) => {
    const response = await fetch(`${baseUrl}/api/admin/orders`, {
      headers: { 'x-admin-session': 'valid' }
    });
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.data.orders[0].shipping_fee, null);
    assert.equal(result.data.orders[0].pickup_location_id, null);
    assert.equal(result.data.orders[0].pickup_slot, null);
    assert.equal(result.data.orders[0].shipping_details_message, '資料不足');
    assert.ok(logs.some(log => log.level === 'warn' &&
      log.args[0].event === 'admin_order_shipping_fields_unavailable'));
  });
});

test('admin order status transition uses service-role RPC and validates order UUID', async () => {
  const supabase = createSupabase();
  await withServer(supabase, async baseUrl => {
    const invalidId = await fetch(`${baseUrl}/api/admin/orders/98765432101234567890/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-admin-session': 'valid' },
      body: JSON.stringify({ status: 'paid' })
    });
    assert.equal(invalidId.status, 400);

    const response = await fetch(`${baseUrl}/api/admin/orders/${ORDER_ID}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-admin-session': 'valid' },
      body: JSON.stringify({ status: 'paid' })
    });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.data.status, 'paid');
    assert.equal(supabase.orders[0].payment_status, '已付清');
    assert.deepEqual(supabase.calls.find(call => call.method === 'rpc'), {
      method: 'rpc',
      name: 'transition_admin_order_status',
      args: { p_order_id: ORDER_ID, p_status: 'paid' }
    });
  });
});

test('admin order status rejects illegal transitions with 409', async () => {
  const supabase = createSupabase({ rpcError: { code: 'P0001', message: 'internal detail' } });
  await withServer(supabase, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/admin/orders/${ORDER_ID}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-admin-session': 'valid' },
      body: JSON.stringify({ status: 'completed' })
    });
    const result = await response.json();
    assert.equal(response.status, 409);
    assert.equal(result.message, '狀態跳轉不合法。');
    assert.equal(JSON.stringify(result).includes('internal detail'), false);
  });
});

test('admin order status payment guard is returned as conflict without changing payment fields', async () => {
  const supabase = createSupabase({ rpcError: { code: '55000', message: 'payment details' } });
  await withServer(supabase, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/admin/orders/${ORDER_ID}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-admin-session': 'valid' },
      body: JSON.stringify({ status: 'paid' })
    });
    const result = await response.json();
    assert.equal(response.status, 409);
    assert.equal(supabase.orders[0].payment_status, '已付清');
    assert.equal(JSON.stringify(result).includes('payment details'), false);
  });
});

test('admin order status update requires an authorized session', async () => {
  const supabase = createSupabase();
  await withServer(supabase, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/admin/orders/${ORDER_ID}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'paid' })
    });
    assert.equal(response.status, 401);
    assert.equal(supabase.calls.some(call => call.method === 'rpc'), false);
  });
});

test('admin order status rejects unsupported status values before database access', async () => {
  const supabase = createSupabase();
  await withServer(supabase, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/admin/orders/${ORDER_ID}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-admin-session': 'valid' },
      body: JSON.stringify({ status: 'refunded' })
    });
    assert.equal(response.status, 400);
    assert.equal(supabase.calls.some(call => call.method === 'rpc'), false);
  });
});

test('admin order status reports missing orders as not found', async () => {
  const supabase = createSupabase({ rpcError: { code: 'P0002', message: 'private details' } });
  await withServer(supabase, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/admin/orders/${ORDER_ID}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-admin-session': 'valid' },
      body: JSON.stringify({ status: 'paid' })
    });
    const result = await response.json();
    assert.equal(response.status, 404);
    assert.equal(JSON.stringify(result).includes('private details'), false);
  });
});

test('admin order status reports an unapplied RPC migration as unavailable', async () => {
  const supabase = createSupabase({ rpcError: { code: 'PGRST202', message: 'schema details' } });
  await withServer(supabase, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/admin/orders/${ORDER_ID}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-admin-session': 'valid' },
      body: JSON.stringify({ status: 'paid' })
    });
    const result = await response.json();
    assert.equal(response.status, 503);
    assert.equal(JSON.stringify(result).includes('schema details'), false);
  });
});

test('admin order status rejects malformed RPC results', async () => {
  const supabase = createSupabase({ rpcData: { unexpected: true } });
  await withServer(supabase, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/admin/orders/${ORDER_ID}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-admin-session': 'valid' },
      body: JSON.stringify({ status: 'paid' })
    });
    assert.equal(response.status, 500);
  });
});

test('admin orders APIs require an orders admin session and service-role availability', async () => {
  await withServer(createSupabase(), async baseUrl => {
    const unauthorized = await fetch(`${baseUrl}/api/admin/orders`);
    assert.equal(unauthorized.status, 401);
  });
  await withServer(createSupabase(), async baseUrl => {
    const unavailable = await fetch(`${baseUrl}/api/admin/orders`, {
      headers: { 'x-admin-session': 'valid' }
    });
    assert.equal(unavailable.status, 503);
  }, { serviceRoleAvailable: false });
});

test('admin order filters reject malformed phone, status, date and page size', async () => {
  await withServer(createSupabase(), async baseUrl => {
    for (const query of [
      '?phone=not-a-phone',
      '?status=unknown',
      '?from=2026-02-30',
      '?limit=1000'
    ]) {
      const response = await fetch(`${baseUrl}/api/admin/orders${query}`, {
        headers: { 'x-admin-session': 'valid' }
      });
      assert.equal(response.status, 400, query);
    }
  });
});

test('admin order frontend service uses fetch-only API calls', async () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'adminOrders.js'),
    'utf8'
  );
  assert.equal(/createClient|SUPABASE_SERVICE_ROLE_KEY|\.from\(/.test(source), false);
  const calls = [];
  const browser = {
    async fetch(url, options) {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        async json() {
          return { success: true, data: { orders: [] } };
        }
      };
    }
  };
  vm.runInNewContext(source, { window: browser, URLSearchParams });

  await browser.LittlePlanetAdminOrders.listOrders({
    phone: '+85212345678',
    status: 'paid',
    limit: 50
  });
  await browser.LittlePlanetAdminOrders.updateOrderStatus(ORDER_ID, 'shipped');

  assert.equal(calls[0].url, '/api/admin/orders?phone=%2B85212345678&status=paid&limit=50');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[1].url, `/api/admin/orders/${ORDER_ID}/status`);
  assert.equal(calls[1].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[1].options.body), { status: 'shipped' });
});

test('admin order status migration extends statuses, calculates profit and locks transitions', () => {
  const migration = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '20261030000100_admin_order_status_profit.sql'),
    'utf8'
  );
  assert.match(migration, /CHECK \(status IN \('pending', 'paid', 'shipped', 'picked_up', 'completed', 'cancelled'\)\)/);
  assert.match(migration, /SET status = 'shipped'\s+WHERE status = 'shipping'/);
  assert.match(migration, /orders\.status contains unsupported values/);
  assert.match(migration, /CREATE OR REPLACE VIEW public\.order_profit/);
  assert.match(migration, /COALESCE\(SUM\(order_item\.quantity\), 0\)::integer AS items_count/);
  assert.match(migration, /product\.cost_price/);
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /ALTER COLUMN customer_phone SET NOT NULL/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.transition_admin_order_status\(uuid, text\)/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.transition_admin_order_status\(uuid, text\)\s+TO service_role/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.order_profit FROM PUBLIC, anon, authenticated/);
});
