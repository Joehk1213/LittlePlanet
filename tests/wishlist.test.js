'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const createCustomerRouter = require('../src/routes/customer');
const { createCustomerSession } = require('../src/middleware/customer-session');

const PHONE = '85212345678';
const SECRET = 'wishlist-customer-session-secret-0123456789';
const PRODUCT_ID = '7';
const WISHLIST_ID = 'e1da0bac-9021-4e87-920b-2f5bf5381f32';

async function withServer(supabase, run, options = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/customer', createCustomerRouter(supabase, {
    sessionSecret: SECRET,
    readEnabled: true,
    ...options
  }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
}

function memberCookie(phone = PHONE) {
  return `littleplanet_customer_session=${encodeURIComponent(
    createCustomerSession(phone, SECRET)
  )}`;
}

function createSupabase(options = {}) {
  const tables = {
    customer_wishlists: [{
      id: WISHLIST_ID,
      customer_phone: PHONE,
      product_id: 7,
      created_at: '2026-10-03T00:00:00.000Z'
    }],
    products: [
      {
        id: 7,
        name: '小行星貼紙',
        price: 28.5,
        stock: 5,
        image_url: 'https://example.com/item.png',
        secret_column: 'must-not-leak'
      },
      { id: 8, name: '月球筆記本', price: 45, stock: 2 }
    ]
  };

  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.operation = 'select';
    }

    select(fields, selectionOptions) {
      this.fields = fields;
      this.countRequested = selectionOptions && selectionOptions.count === 'exact';
      return this;
    }

    eq(field, value) {
      this.filters.push(row => String(row[field]) === String(value));
      return this;
    }

    in(field, values) {
      const accepted = new Set(values.map(String));
      this.filters.push(row => accepted.has(String(row[field])));
      return this;
    }

    order() { return this; }

    range(start, end) {
      this.start = start;
      this.end = end;
      return this;
    }

    insert(value) {
      this.operation = 'insert';
      this.value = value;
      return this;
    }

    delete() {
      this.operation = 'delete';
      return this;
    }

    async single() {
      const result = await this.execute();
      return { data: result.data && result.data[0] || null, error: result.error };
    }

    async maybeSingle() {
      const result = await this.execute();
      return { data: result.data && result.data[0] || null, error: result.error };
    }

    then(resolve, reject) {
      return this.execute().then(resolve, reject);
    }

    async execute() {
      if (options.error && options.error.table === this.table &&
          options.error.operation === this.operation) {
        return { data: null, count: null, error: options.error.value };
      }
      const rows = tables[this.table];
      if (this.operation === 'insert') {
        if (rows.some(row =>
          row.customer_phone === this.value.customer_phone &&
          String(row.product_id) === String(this.value.product_id)
        )) {
          return { data: null, count: null, error: { code: '23505' } };
        }
        const row = {
          id: '99a420aa-07ac-4c83-8ee9-b76f3613fb0d',
          created_at: new Date().toISOString(),
          ...this.value
        };
        rows.push(row);
        return { data: [row], count: null, error: null };
      }
      const matching = rows.filter(row => this.filters.every(filter => filter(row)));
      if (this.operation === 'delete') {
        tables[this.table] = rows.filter(row => !matching.includes(row));
      }
      const offset = this.start || 0;
      const result = this.operation === 'delete'
        ? matching
        : matching.slice(offset, this.end === undefined ? undefined : this.end + 1);
      return {
        data: result,
        count: this.countRequested ? matching.length : null,
        error: null
      };
    }
  }

  return { tables, from: table => new Query(table) };
}

test('wishlist endpoints require a member session and return only the current member data', async () => {
  const supabase = createSupabase();
  await withServer(supabase, async baseUrl => {
    const unauthenticated = await fetch(`${baseUrl}/api/customer/wishlist`);
    assert.equal(unauthenticated.status, 401);
    assert.deepEqual(await unauthenticated.json(), {
      success: false,
      data: null,
      message: '會員工作階段已失效，請重新驗證。'
    });

    const response = await fetch(`${baseUrl}/api/customer/wishlist`, {
      headers: { Cookie: memberCookie() }
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.total_count, 1);
    assert.equal(body.data.wishlist[0].product.name, '小行星貼紙');
    assert.equal(Object.hasOwn(body.data.wishlist[0].product, 'secret_column'), false);
  });
});

test('wishlist creation validates same-origin requests and product identifiers', async () => {
  const supabase = createSupabase();
  await withServer(supabase, async baseUrl => {
    const noOrigin = await fetch(`${baseUrl}/api/customer/wishlist`, {
      method: 'POST',
      headers: {
        Cookie: memberCookie(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ product_id: PRODUCT_ID })
    });
    assert.equal(noOrigin.status, 403);

    const invalid = await fetch(`${baseUrl}/api/customer/wishlist`, {
      method: 'POST',
      headers: {
        Origin: baseUrl,
        Cookie: memberCookie(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ product_id: '../orders' })
    });
    assert.equal(invalid.status, 400);
    assert.equal(supabase.tables.customer_wishlists.length, 1);
  });
});

test('member adds and removes a wishlist item without affecting another member', async () => {
  const supabase = createSupabase();
  supabase.tables.customer_wishlists = [];
  await withServer(supabase, async baseUrl => {
    const added = await fetch(`${baseUrl}/api/customer/wishlist`, {
      method: 'POST',
      headers: {
        Origin: baseUrl,
        Cookie: memberCookie(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ product_id: PRODUCT_ID })
    });
    const addedBody = await added.json();
    assert.equal(added.status, 201);
    assert.equal(addedBody.data.product_id, PRODUCT_ID);

    const duplicate = await fetch(`${baseUrl}/api/customer/wishlist`, {
      method: 'POST',
      headers: {
        Origin: baseUrl,
        Cookie: memberCookie(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ product_id: PRODUCT_ID })
    });
    assert.equal(duplicate.status, 409);

    const removed = await fetch(`${baseUrl}/api/customer/wishlist/${PRODUCT_ID}`, {
      method: 'DELETE',
      headers: { Origin: baseUrl, Cookie: memberCookie() }
    });
    assert.equal(removed.status, 200);
    assert.equal(supabase.tables.customer_wishlists.length, 0);

    const wrongMember = await fetch(`${baseUrl}/api/customer/wishlist/${PRODUCT_ID}`, {
      method: 'DELETE',
      headers: { Origin: baseUrl, Cookie: memberCookie('85287654321') }
    });
    assert.equal(wrongMember.status, 404);
  });
});

test('wishlist database failures return a structured error response', async () => {
  const supabase = createSupabase({
    error: {
      table: 'customer_wishlists',
      operation: 'select',
      value: { code: 'XX000', message: 'database unavailable' }
    }
  });
  await withServer(supabase, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/customer/wishlist`, {
      headers: { Cookie: memberCookie() }
    });
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.equal(body.success, false);
    assert.equal(body.data, null);
    assert.equal(typeof body.message, 'string');
  });
});
