'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const createAdminSessions = require('../middleware/admin-sessions');
const { createCustomerSession } = require('../middleware/customer-session');
const createReviewsRouter = require('../routes/reviews');

const SESSION_SECRET = 'customer-session-signing-secret-0123456789';
const PHONE = '85212345678';
const ORDER_ID = 'e1da0bac-9021-4e87-920b-2f5bf5381f32';
const REVIEW_ID = '877a9a58-350f-4679-9256-30126e6fbb57';
const PRODUCT_ID = '17';

async function withServer(supabase, run, options = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api', createReviewsRouter(supabase, {
    customerSessionSecret: SESSION_SECRET,
    readEnabled: true,
    writeEnabled: true,
    isSessionAuthorized: (req, scope) => (
      scope === 'reviews' && req.get('x-reviews-session') === 'valid'
    ),
    ...options
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

function createSupabase(options = {}) {
  const tables = {
    orders: [{
      order_id: ORDER_ID,
      order_number: 'LP-20261004-A1B2C3D4',
      customer_phone: PHONE,
      order_date: '2026-10-04T00:00:00Z'
    }],
    order_items: [{ item_id: 1, order_id: ORDER_ID, product_id: Number(PRODUCT_ID) }],
    product_reviews: [{
      review_id: REVIEW_ID,
      product_id: Number(PRODUCT_ID),
      customer_phone: PHONE,
      rating: 5,
      comment: '很喜歡！',
      created_at: '2026-10-04T01:00:00Z'
    }]
  };

  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.operation = 'select';
      this.insertValues = null;
      this.updateValues = null;
    }

    select(fields, selectionOptions) {
      this.fields = fields;
      this.countRequested = selectionOptions && selectionOptions.count === 'exact';
      return this;
    }

    order() { return this; }

    range(from, to) {
      this.rangeStart = from;
      this.rangeEnd = to;
      return this;
    }

    limit(value) {
      this.limitValue = value;
      return this;
    }

    in(field, values) {
      this.filters.push(row => values.map(String).includes(String(row[field])));
      return this;
    }

    eq(field, value) {
      this.filters.push(row => String(row[field]) === String(value));
      return this;
    }

    insert(value) {
      this.operation = 'insert';
      this.insertValues = value;
      return this;
    }

    update(value) {
      this.operation = 'update';
      this.updateValues = value;
      return this;
    }

    delete() {
      this.operation = 'delete';
      return this;
    }

    async single() {
      const result = await this.execute();
      return { data: result.data[0] || null, error: result.error };
    }

    async maybeSingle() {
      const result = await this.execute();
      return { data: result.data[0] || null, error: result.error };
    }

    then(resolve, reject) {
      return this.execute().then(resolve, reject);
    }

    async execute() {
      if (options.tableError && options.tableError.table === this.table) {
        return { data: null, count: null, error: options.tableError.error };
      }
      const rows = tables[this.table];
      if (this.operation === 'insert') {
        const inserted = {
          review_id: REVIEW_ID,
          created_at: new Date().toISOString(),
          ...this.insertValues
        };
        rows.push(inserted);
        return { data: [inserted], count: null, error: null };
      }
      const matched = rows.filter(row => this.filters.every(filter => filter(row)));
      if (this.operation === 'update') {
        matched.forEach(row => Object.assign(row, this.updateValues));
        return { data: matched, count: null, error: null };
      }
      if (this.operation === 'delete') {
        tables[this.table] = rows.filter(row => !matched.includes(row));
      }
      const start = this.rangeStart || 0;
      const sliced = matched.slice(start, this.rangeEnd === undefined
        ? this.limitValue
        : this.rangeEnd + 1);
      return {
        data: this.operation === 'delete' ? matched : sliced,
        count: this.countRequested ? matched.length : null,
        error: null
      };
    }
  }

  return {
    tables,
    rpc: async (name, args) => {
      if (name === 'has_customer_purchased_product') {
        return { data: options.purchased !== false, error: options.purchaseError || null };
      }
      if (options.rpcError) return { data: null, error: options.rpcError };
      if (name === 'get_product_review_summaries') {
        return {
          data: [{
            product_id: args.p_product_ids[0],
            average_rating: 4.5,
            review_count: 2
          }],
          error: null
        };
      }
      assert.equal(name, 'get_product_reviews');
      assert.equal(args.p_product_id, PRODUCT_ID);
      return {
        data: {
          average_rating: 5,
          review_count: 1,
          reviews: [{
            review_id: REVIEW_ID,
            product_id: PRODUCT_ID,
            rating: 5,
            comment: '很喜歡！',
            created_at: '2026-10-04T01:00:00Z'
          }]
        },
        error: null
      };
    },
    from(table) {
      return new Query(table);
    }
  };
}

function customerCookie() {
  return `littleplanet_customer_session=${encodeURIComponent(
    createCustomerSession(PHONE, SESSION_SECRET)
  )}`;
}

test('public product review endpoint returns rating summary without customer phone numbers', async () => {
  await withServer(createSupabase(), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/products/${PRODUCT_ID}/reviews`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.average_rating, 5);
    assert.equal(body.data.review_count, 1);
    assert.equal(body.data.reviews[0].comment, '很喜歡！');
    assert.equal(Object.hasOwn(body.data.reviews[0], 'customer_phone'), false);
  });
});

test('public rating summary endpoint validates IDs and returns grouped approved-review data', async () => {
  await withServer(createSupabase(), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/reviews/summary?product_ids=17`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body.data.summaries['17'], {
      average_rating: 4.5,
      review_count: 2
    });
    const invalid = await fetch(`${baseUrl}/api/reviews/summary?product_ids=bad`);
    assert.equal(invalid.status, 400);
  });
});

test('order tracking review requires matching phone, official order number and purchased product', async () => {
  const supabase = createSupabase();
  await withServer(supabase, async baseUrl => {
    const headers = { Origin: baseUrl, 'Content-Type': 'application/json' };
    const response = await fetch(`${baseUrl}/api/reviews`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        product_id: PRODUCT_ID,
        customer_phone: PHONE,
        order_number: 'LP-20261004-A1B2C3D4',
        customer_name: 'Joe',
        rating: 5,
        comment: '非常喜歡'
      })
    });
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.data.review.status, 'pending');
    assert.equal(body.data.review.customer_name, 'Joe');
    assert.equal(supabase.tables.product_reviews.at(-1).order_id, ORDER_ID);
    assert.equal(supabase.tables.product_reviews.at(-1).customer_phone, PHONE);

    for (const invalidBody of [
      { product_id: PRODUCT_ID, customer_phone: '85200000000', order_number: 'LP-20261004-A1B2C3D4', rating: 5, comment: '好用' },
      { product_id: PRODUCT_ID, customer_phone: PHONE, order_number: 'LP-WRONG', rating: 5, comment: '好用' }
    ]) {
      const invalid = await fetch(`${baseUrl}/api/reviews`, {
        method: 'POST',
        headers,
        body: JSON.stringify(invalidBody)
      });
      assert.equal(invalid.status, 404);
    }
  });
});

test('member can review a purchased product with a valid session and same-origin request', async () => {
  const supabase = createSupabase();
  await withServer(supabase, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/products/${PRODUCT_ID}/reviews`, {
      method: 'POST',
      headers: {
        Origin: baseUrl,
        Cookie: customerCookie(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ rating: 4, comment: '質感很好' })
    });
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.success, true);
    assert.equal(body.data.review.rating, 4);
    assert.equal(supabase.tables.product_reviews.at(-1).customer_phone, PHONE);
  });
});

test('review submission rejects missing member session and malformed ratings', async () => {
  const supabase = createSupabase();
  await withServer(supabase, async baseUrl => {
    const unauthenticated = await fetch(`${baseUrl}/api/products/${PRODUCT_ID}/reviews`, {
      method: 'POST',
      headers: { Origin: baseUrl, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: 5, comment: '評價' })
    });
    assert.equal(unauthenticated.status, 401);
    const invalid = await fetch(`${baseUrl}/api/products/${PRODUCT_ID}/reviews`, {
      method: 'POST',
      headers: {
        Origin: baseUrl,
        Cookie: customerCookie(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ rating: '5', comment: '評價' })
    });
    assert.equal(invalid.status, 400);
    assert.equal(supabase.tables.product_reviews.length, 1);
  });
});

test('review submission requires proof the member purchased that product', async () => {
  const supabase = createSupabase({ purchased: false });
  await withServer(supabase, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/products/${PRODUCT_ID}/reviews`, {
      method: 'POST',
      headers: {
        Origin: baseUrl,
        Cookie: customerCookie(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ rating: 5, comment: '評價' })
    });
    const body = await response.json();
    assert.equal(response.status, 403);
    assert.equal(body.success, false);
    assert.equal(body.data, null);
  });
});

test('admin review list and delete require reviews scope authorization', async () => {
  const supabase = createSupabase();
  await withServer(supabase, async baseUrl => {
    const unauthorized = await fetch(`${baseUrl}/api/admin/reviews`);
    assert.equal(unauthorized.status, 401);

    const listed = await fetch(`${baseUrl}/api/admin/reviews`, {
      headers: { 'x-reviews-session': 'valid' }
    });
    const listBody = await listed.json();
    assert.equal(listed.status, 200);
    assert.equal(listBody.data.reviews.length, 1);
    assert.equal(listBody.data.reviews[0].customer_phone, PHONE);

    const moderated = await fetch(`${baseUrl}/api/admin/reviews/${REVIEW_ID}/status`, {
      method: 'PATCH',
      headers: {
        Origin: baseUrl,
        'x-reviews-session': 'valid',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'approved' })
    });
    assert.equal(moderated.status, 200);
    assert.equal((await moderated.json()).data.status, 'approved');
    assert.equal(supabase.tables.product_reviews[0].status, 'approved');

    const deleted = await fetch(`${baseUrl}/api/admin/reviews/${REVIEW_ID}`, {
      method: 'DELETE',
      headers: {
        Origin: baseUrl,
        'x-reviews-session': 'valid'
      }
    });
    assert.equal(deleted.status, 200);
    assert.equal((await deleted.json()).success, true);
  });
});

test('real admin sessions grant review moderation only to the reviews scope', async () => {
  const token = 'unique-reviews-admin-token-0123456789abcdef';
  const sessions = createAdminSessions({
    sessionSecret: 'admin-session-signing-secret-for-tests-0123456789',
    credentials: [{ token, scopes: ['reviews'] }]
  });
  const app = express();
  app.use(express.json());
  app.use('/api/admin-auth', sessions.router);
  app.use('/api', createReviewsRouter(createSupabase(), {
    readEnabled: true,
    writeEnabled: true,
    isSessionAuthorized: sessions.isSessionAuthorized
  }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const login = await fetch(`${baseUrl}/api/admin-auth/login`, {
      method: 'POST',
      headers: { Origin: baseUrl, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';', 1)[0];
    const response = await fetch(`${baseUrl}/api/admin/reviews`, {
      headers: { Cookie: cookie }
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data.reviews.length, 1);
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
});

test('database RPC errors use the standard structured error response', async () => {
  await withServer(createSupabase({ rpcError: { code: 'XX000', message: 'failure' } }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/products/${PRODUCT_ID}/reviews`);
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.equal(body.success, false);
    assert.equal(body.data, null);
    assert.equal(typeof body.message, 'string');
  });
});
