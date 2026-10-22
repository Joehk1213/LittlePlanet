'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const createOrdersRouter = require('../routes/orders');

const ORDER_ID = 'e1da0bac-9021-4e87-920b-2f5bf5381f32';

async function withServer(supabase, run) {
  const app = express();
  app.use(express.json());
  app.use('/api/orders', createOrdersRouter(supabase, {
    serviceRoleAvailable: true,
    isSessionAuthorized: (req, scope) => (
      scope === 'orders' &&
      req.get('x-admin-session') === 'valid'
    )
  }));
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

function createSupabase() {
  const orders = [{
    order_id: ORDER_ID,
    customer_phone: '85212345678',
    total_amount: 49.5,
    order_date: '2026-10-03T01:00:00.000Z',
    status: 'pending'
  }];
  const items = [{
    item_id: 1,
    order_id: ORDER_ID,
    product_id: 9,
    quantity: 3,
    unit_price: 16.5
  }];
  const products = [{ id: 9, name: '小行星貼紙' }];
  let productSelectFields = null;

  class Query {
    constructor(table) {
      this.table = table;
      this.operation = 'select';
      this.filters = [];
      this.values = null;
    }

    select(fields, options) {
      this.fields = fields;
      if (this.table === 'products') {
        productSelectFields = fields;
      }
      this.countRequested = options && options.count === 'exact';
      return this;
    }

    order() {
      return this;
    }

    range(from, to) {
      this.rangeStart = from;
      this.rangeEnd = to;
      return this;
    }

    limit(limit) {
      this.maxRows = limit;
      return this;
    }

    in(field, values) {
      this.filters.push(row => values.includes(row[field]));
      return this;
    }

    eq(field, value) {
      this.filters.push(row => row[field] === value);
      return this;
    }

    update(values) {
      this.operation = 'update';
      this.values = values;
      return this;
    }

    async maybeSingle() {
      const result = await this.execute();
      return { data: result.data[0] || null, error: result.error };
    }

    async execute() {
      const source = this.table === 'orders'
        ? orders
        : this.table === 'order_items'
          ? items
          : products;
      const matching = source.filter(row => this.filters.every(filter => filter(row)));
      if (this.operation === 'update') {
        matching.forEach(row => Object.assign(row, this.values));
        return {
          data: matching.map(row => ({ ...row })),
          error: null
        };
      }
      const ranged = this.rangeStart === undefined
        ? matching
        : matching.slice(this.rangeStart, this.rangeEnd + 1);
      return {
        data: this.maxRows === undefined ? ranged : ranged.slice(0, this.maxRows),
        count: this.countRequested ? matching.length : null,
        error: null
      };
    }

    then(resolve, reject) {
      return this.execute().then(resolve, reject);
    }
  }

  return {
    orders,
    get productSelectFields() {
      return productSelectFields;
    },
    from(table) {
      return new Query(table);
    }
  };
}

test('admin order APIs require an authorized orders session', async () => {
  await withServer(createSupabase(), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/orders/admin/orders`);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      success: false,
      data: null,
      message: '請先以具備訂單管理權限的管理員 Session 登入。'
    });
  });
});

test('admin order list returns bounded pages with phone, items, price, date and status', async () => {
  const supabase = createSupabase();
  await withServer(supabase, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/orders/admin/orders?limit=20&offset=0`, {
      headers: { 'x-admin-session': 'valid' }
    });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.success, true);
    assert.equal(result.data.total_count, 1);
    assert.equal(result.data.orders[0].customer_phone, '85212345678');
    assert.equal(result.data.orders[0].status, 'pending');
    assert.equal(result.data.orders[0].items[0].product_name, '小行星貼紙');
    assert.equal(result.data.orders[0].items[0].quantity, 3);
    assert.equal(supabase.productSelectFields, '*');

    const invalidPage = await fetch(`${baseUrl}/api/orders/admin/orders?limit=500`);
    assert.equal(invalidPage.status, 401);
    const authorizedInvalidPage = await fetch(`${baseUrl}/api/orders/admin/orders?limit=500`, {
      headers: { 'x-admin-session': 'valid' }
    });
    assert.equal(authorizedInvalidPage.status, 400);
  });
});

test('admin order status update validates status and persists the allowed value', async () => {
  const supabase = createSupabase();
  await withServer(supabase, async baseUrl => {
    const invalid = await fetch(`${baseUrl}/api/orders/admin/orders/${ORDER_ID}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-admin-session': 'valid' },
      body: JSON.stringify({ status: 'cancelled' })
    });
    assert.equal(invalid.status, 400);

    const updated = await fetch(`${baseUrl}/api/orders/admin/orders/${ORDER_ID}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-admin-session': 'valid' },
      body: JSON.stringify({ status: 'shipping' })
    });
    const result = await updated.json();
    assert.equal(updated.status, 200);
    assert.equal(result.success, true);
    assert.equal(result.data.status, 'shipping');
    assert.equal(supabase.orders[0].status, 'shipping');

    const invalidId = await fetch(`${baseUrl}/api/orders/admin/orders/not-a-uuid/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-admin-session': 'valid' },
      body: JSON.stringify({ status: 'completed' })
    });
    assert.equal(invalidId.status, 400);
  });
});
