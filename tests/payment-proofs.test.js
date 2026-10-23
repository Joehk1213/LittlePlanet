'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const createPaymentProofRouter = require('../routes/payment-proofs');

const ORDER_ID = 'e1da0bac-9021-4e87-920b-2f5bf5381f32';
const ORDER_NUMBER = 'LP-20261022-A1B2C3D4';
const PHONE = '85212345678';
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

async function withServer(supabase, run, options = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/orders', createPaymentProofRouter(supabase, {
    serviceRoleAvailable: true,
    isSessionAuthorized: (req, scope) => (
      scope === 'orders' && req.get('x-admin-session') === 'valid'
    ),
    enableAdmin: false,
    ...options
  }));
  app.use('/api/admin/orders', createPaymentProofRouter(supabase, {
    serviceRoleAvailable: true,
    isSessionAuthorized: (req, scope) => (
      scope === 'orders' && req.get('x-admin-session') === 'valid'
    ),
    enableUpload: false,
    ...options
  }));
  app.use((error, req, res, next) => {
    res.status(error.status || 500).json({
      success: false,
      data: null,
      message: error.status === 413
        ? '付款憑證檔案超出大小限制。'
        : '請求處理失敗。'
    });
  });
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
  const orders = [{
    order_id: ORDER_ID,
    order_number: ORDER_NUMBER,
    customer_phone: PHONE,
    payment_status: '未付款',
    payment_proof_url: null,
    payment_proof_status: 'pending'
  }];
  const storageCalls = [];

  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.operation = 'select';
      this.values = null;
      this.columns = '';
    }

    select(columns) {
      this.columns = columns;
      return this;
    }

    in(field, values) {
      this.filters.push(row => values.includes(row[field]));
      return this;
    }

    eq(field, value) {
      this.filters.push(row => String(row[field]) === String(value));
      return this;
    }

    update(values) {
      this.operation = 'update';
      this.values = values;
      return this;
    }

    async maybeSingle() {
      if (options.databaseError) {
        return { data: null, error: options.databaseError };
      }
      const rows = this.table === 'orders' ? orders : [];
      const match = rows.find(row => this.filters.every(filter => filter(row)));
      if (!match) {
        return { data: null, error: null };
      }
      if (this.operation === 'update') {
        Object.assign(match, this.values);
      }
      const selected = this.columns
        ? Object.fromEntries(this.columns.split(',').map(column => [
          column.trim(),
          match[column.trim()]
        ]))
        : { ...match };
      return { data: selected, error: null };
    }
  }

  return {
    orders,
    storageCalls,
    from(table) {
      assert.equal(table, 'orders');
      return new Query(table);
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, 'payment-proofs');
        return {
          async upload(path, file, fileOptions) {
            storageCalls.push({ method: 'upload', path, fileOptions });
            assert.ok(Buffer.isBuffer(file));
            if (options.storageError) {
              return { data: null, error: options.storageError };
            }
            return { data: { path }, error: null };
          },
          async remove(paths) {
            storageCalls.push({ method: 'remove', paths });
            return { data: paths, error: null };
          }
        };
      }
    }
  };
}

async function upload(baseUrl, body = PNG, overrides = {}) {
  const response = await fetch(
    `${baseUrl}/api/orders/${encodeURIComponent(overrides.orderNumber || ORDER_NUMBER)}/payment-proof`,
    {
      method: 'POST',
      headers: {
        'Content-Type': overrides.contentType || 'image/png',
        'X-Customer-Phone': overrides.phone || PHONE
      },
      body
    }
  );
  return { status: response.status, body: await response.json() };
}

test('payment proof upload requires both matching order number and phone and stores a private object reference', async () => {
  const supabase = createSupabase();
  await withServer(supabase, async baseUrl => {
    const denied = await upload(baseUrl, PNG, { phone: '85287654321' });
    assert.equal(denied.status, 404);
    assert.equal(denied.body.success, false);
    assert.equal(supabase.storageCalls.length, 0);

    const response = await upload(baseUrl);
    assert.equal(response.status, 201);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.payment_proof_status, 'pending');
    assert.equal(response.body.data.payment_proof_url, undefined);
    assert.match(supabase.orders[0].payment_proof_url, new RegExp(`^${ORDER_ID}/[0-9a-f-]+\\.png$`));
    assert.equal(supabase.orders[0].payment_proof_status, 'pending');
    assert.equal(supabase.storageCalls[0].method, 'upload');
    assert.equal(supabase.storageCalls[0].fileOptions.contentType, 'image/png');
  });
});

test('payment proof upload validates image bytes, MIME, size and protects verified proofs', async () => {
  const supabase = createSupabase();
  await withServer(supabase, async baseUrl => {
    const invalidImage = await upload(baseUrl, Buffer.from('not an image'));
    assert.equal(invalidImage.status, 400);

    const mismatchedMime = await upload(baseUrl, PNG, { contentType: 'image/jpeg' });
    assert.equal(mismatchedMime.status, 400);

    const oversized = await upload(baseUrl, Buffer.alloc(5 * 1024 * 1024 + 1));
    assert.equal(oversized.status, 413);

    supabase.orders[0].payment_proof_status = 'verified';
    const verified = await upload(baseUrl);
    assert.equal(verified.status, 409);
    assert.equal(supabase.storageCalls.length, 0);

    const uuidLookup = await upload(baseUrl, PNG, { orderNumber: ORDER_ID });
    assert.equal(uuidLookup.status, 400);
  });
});

test('payment proof upload reports storage failures without updating the order', async () => {
  const supabase = createSupabase({ storageError: { message: 'private details' } });
  await withServer(supabase, async baseUrl => {
    const response = await upload(baseUrl);
    assert.equal(response.status, 500);
    assert.equal(response.body.success, false);
    assert.equal(supabase.orders[0].payment_proof_url, null);
  });
});

test('admin payment proof review requires orders scope and only accepts verified or rejected', async () => {
  const supabase = createSupabase();
  supabase.orders[0].payment_status = '未付款';
  await withServer(supabase, async baseUrl => {
    const unauthorized = await fetch(
      `${baseUrl}/api/admin/orders/${ORDER_ID}/payment-status`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_proof_status: 'verified' })
      }
    );
    assert.equal(unauthorized.status, 401);

    const invalid = await fetch(
      `${baseUrl}/api/admin/orders/${ORDER_ID}/payment-status`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-session': 'valid'
        },
        body: JSON.stringify({ payment_proof_status: 'pending' })
      }
    );
    assert.equal(invalid.status, 400);

    const noProof = await fetch(
      `${baseUrl}/api/admin/orders/${ORDER_ID}/payment-status`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-session': 'valid'
        },
        body: JSON.stringify({ payment_proof_status: 'verified' })
      }
    );
    assert.equal(noProof.status, 409);

    supabase.orders[0].payment_proof_url = `${ORDER_ID}/proof.png`;
    const rejected = await fetch(
      `${baseUrl}/api/admin/orders/${ORDER_ID}/payment-status`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-session': 'valid'
        },
        body: JSON.stringify({ payment_proof_status: 'rejected' })
      }
    );
    const rejectedResult = await rejected.json();
    assert.equal(rejected.status, 200);
    assert.equal(rejectedResult.data.payment_proof_status, 'rejected');
    assert.equal(supabase.orders[0].payment_status, '未付款');

    const response = await fetch(
      `${baseUrl}/api/admin/orders/${ORDER_ID}/payment-status`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-session': 'valid'
        },
        body: JSON.stringify({ payment_proof_status: 'verified' })
      }
    );
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.success, true);
    assert.equal(result.data.payment_proof_status, 'verified');
    assert.equal(result.data.payment_status, '已付清');
    assert.equal(supabase.orders[0].payment_proof_status, 'verified');
    assert.equal(supabase.orders[0].payment_status, '已付清');
  });
});
