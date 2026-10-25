const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const createInboundRouter = require('../src/routes/inbound');

const ADMIN_TOKEN = '0123456789abcdef0123456789abcdef';

async function withServer(router, run) {
  const app = express();
  app.use(express.json());
  app.use('/api/inbound', router);
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
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    ...(options.body ? { 'Content-Type': 'application/json' } : {})
  };
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  return { status: response.status, body: await response.json() };
}

function createRouter(supabase, options = {}) {
  return createInboundRouter(supabase, {
    adminToken: ADMIN_TOKEN,
    writeEnabled: true,
    ...options
  });
}

function getHongKongDate(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86400000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function createBatchUpdateSupabase(batches, options = {}) {
  const updates = [];
  return {
    updates,
    from(table) {
      assert.equal(table, 'product_stock_batches');
      let patch = null;
      let batchId = null;
      let columns = null;
      const query = {
        update(values) {
          patch = values;
          return query;
        },
        eq(column, value) {
          assert.equal(column, 'batch_id');
          batchId = String(value);
          return query;
        },
        select(value) {
          columns = value;
          return query;
        },
        async maybeSingle() {
          updates.push({ batch_id: batchId, patch, columns });
          if (options.throwOnUpdate) {
            throw new Error('Simulated batch update exception.');
          }
          if (options.error) {
            return { data: null, error: options.error };
          }
          const batch = batches.find(item => String(item.batch_id) === batchId);
          if (!batch) return { data: null, error: null };
          Object.assign(batch, patch);
          return { data: { ...batch }, error: null };
        }
      };
      return query;
    }
  };
}

function createBatchRecord(batchId, overrides = {}) {
  return {
    batch_id: batchId,
    product_id: 51,
    quantity_received: 5,
    quantity_remaining: 5,
    best_before_date: '2027-04-30',
    received_at: '2026-10-01T00:00:00Z',
    is_legacy_stock: false,
    ...overrides
  };
}

test('inbound receipt requires authorized inbound scope and service-role writes', async () => {
  const scopeCalls = [];
  const router = createRouter({ rpc: async () => ({ data: null, error: null }) }, {
    isSessionAuthorized: (req, token, scope) => {
      scopeCalls.push({ token, scope });
      return false;
    }
  });

  await withServer(router, async baseUrl => {
    const response = await request(baseUrl, '/api/inbound/receipt', {
      method: 'POST',
      body: { product_id: 51, quantity: 2 }
    });
    assert.equal(response.status, 401);
    assert.equal(response.body.success, false);
  });
  assert.deepEqual(scopeCalls, [{ token: ADMIN_TOKEN, scope: 'inbound' }]);

  const noServiceRole = createRouter({ rpc: async () => ({ data: null, error: null }) }, {
    writeEnabled: false
  });
  await withServer(noServiceRole, async baseUrl => {
    const response = await request(baseUrl, '/api/inbound/receipt', {
      method: 'POST',
      token: ADMIN_TOKEN,
      body: { product_id: 51, quantity: 2 }
    });
    assert.equal(response.status, 503);
  });
});

test('a valid inbound session records a receipt with a bigint-range product ID', async () => {
  const scopeCalls = [];
  const rpcCalls = [];
  const productId = 3000000000;
  const router = createRouter({
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      return { data: { success: true, product_id: args.p_product_id, stock: 4 }, error: null };
    }
  }, {
    isSessionAuthorized: (req, token, scope) => {
      scopeCalls.push({ token, scope });
      return true;
    }
  });

  await withServer(router, async baseUrl => {
    const response = await request(baseUrl, '/api/inbound/receipt', {
      method: 'POST',
      body: { product_id: productId, quantity: 2 }
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
  });

  assert.deepEqual(scopeCalls, [{ token: ADMIN_TOKEN, scope: 'inbound' }]);
  assert.deepEqual(rpcCalls, [{
    name: 'record_product_receipt',
    args: { p_product_id: productId, p_quantity: 2, p_best_before_date: null }
  }]);
});

test('receipt validates quantities and date-only best-before values before calling the RPC', async () => {
  let rpcCalls = 0;
  const router = createRouter({
    rpc: async () => {
      rpcCalls += 1;
      return { data: { success: true }, error: null };
    }
  });

  await withServer(router, async baseUrl => {
    for (const body of [
      { product_id: 51, quantity: 0 },
      { product_id: 51, quantity: 1, best_before_date: '0000-01-01' },
      { product_id: 51, quantity: 1, best_before_date: '2026-02-30' },
      { product_id: 51, quantity: 1, best_before_date: getHongKongDate(-1) }
    ]) {
      const response = await request(baseUrl, '/api/inbound/receipt', {
        method: 'POST',
        token: ADMIN_TOKEN,
        body
      });
      assert.equal(response.status, 400);
      assert.equal(response.body.success, false);
    }
  });
  assert.equal(rpcCalls, 0);
});

test('receipt sends the optional date to the atomic receipt RPC and handles database failures', async () => {
  const calls = [];
  const router = createRouter({
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (calls.length === 1) {
        return {
          data: {
            success: true,
            product_id: 51,
            stock: 8,
            batch: { batch_id: 1, quantity_received: 3, quantity_remaining: 3 }
          },
          error: null
        };
      }
      return { data: null, error: { code: 'XX000', message: 'transaction failed' } };
    }
  });

  await withServer(router, async baseUrl => {
    const dated = await request(baseUrl, '/api/inbound/receipt', {
      method: 'POST',
      token: ADMIN_TOKEN,
      body: { product_id: 51, quantity: 3, best_before_date: getHongKongDate(1) }
    });
    assert.equal(dated.status, 200);
    assert.equal(dated.body.data.batch.quantity_remaining, 3);

    const noDate = await request(baseUrl, '/api/inbound/receipt', {
      method: 'POST',
      token: ADMIN_TOKEN,
      body: { product_id: 51, quantity: 2, best_before_date: '' }
    });
    assert.equal(noDate.status, 500);
    assert.match(noDate.body.message, /交易已回滾/);
  });

  assert.deepEqual(calls, [
    {
      name: 'record_product_receipt',
      args: {
        p_product_id: 51,
        p_quantity: 3,
        p_best_before_date: getHongKongDate(1)
      }
    },
    {
      name: 'record_product_receipt',
      args: { p_product_id: 51, p_quantity: 2, p_best_before_date: null }
    }
  ]);
});

test('batch list returns date-only batch data and reports Supabase errors', async () => {
  const product = { id: 51, stock: 8 };
  const batches = [{
    batch_id: 1,
    product_id: 51,
    quantity_received: 3,
    quantity_remaining: 3,
    best_before_date: '2027-04-30',
    received_at: '2027-01-01T02:00:00Z',
    is_legacy_stock: false
  }];
  const supabase = {
    from(table) {
      const filters = [];
      const query = {
        select() {
          return query;
        },
        eq(column, value) {
          filters.push(row => String(row[column]) === String(value));
          return query;
        },
        order() {
          return query;
        },
        maybeSingle() {
          return Promise.resolve({
            data: table === 'products'
              ? product
              : null,
            error: table === 'products' ? null : { code: 'XX000' }
          });
        },
        then(resolve, reject) {
          const result = table === 'product_stock_batches'
            ? { data: batches.filter(row => filters.every(filter => filter(row))), error: null }
            : { data: null, error: null };
          return Promise.resolve(result).then(resolve, reject);
        }
      };
      return query;
    },
    rpc: async () => ({ data: null, error: null })
  };

  await withServer(createRouter(supabase), async baseUrl => {
    const response = await request(baseUrl, '/api/inbound/batches?product_id=51', {
      token: ADMIN_TOKEN
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.current_stock, 8);
    assert.equal(response.body.data.batches[0].best_before_date, '2027-04-30');

    const invalid = await request(baseUrl, '/api/inbound/batches?product_id=bad', {
      token: ADMIN_TOKEN
    });
    assert.equal(invalid.status, 400);
  });

  const failedQuery = {
    from() {
      const query = {
        select() { return query; },
        eq() { return query; },
        maybeSingle() { return Promise.resolve({ data: product, error: null }); },
        order() { return query; },
        then(resolve, reject) {
          return Promise.resolve({ data: null, error: { code: '42P01' } }).then(resolve, reject);
        }
      };
      return query;
    }
  };
  await withServer(createRouter(failedQuery), async baseUrl => {
    const response = await request(baseUrl, '/api/inbound/batches?product_id=51', {
      token: ADMIN_TOKEN
    });
    assert.equal(response.status, 503);
    assert.equal(response.body.success, false);
  });
});

test('batch date update changes only the selected batch date and supports clearing it', async () => {
  const batches = [
    createBatchRecord('9007199254740993'),
    createBatchRecord(12, {
      product_id: 52,
      quantity_received: 9,
      quantity_remaining: 7,
      best_before_date: '2028-01-01'
    })
  ];
  const originalSecondBatch = { ...batches[1] };
  const supabase = createBatchUpdateSupabase(batches);
  const router = createRouter(supabase);

  await withServer(router, async baseUrl => {
    const changedDate = await request(baseUrl, '/api/inbound/batches/9007199254740993', {
      method: 'PATCH',
      token: ADMIN_TOKEN,
      body: { best_before_date: '2027-12-31' }
    });
    assert.equal(changedDate.status, 200);
    assert.equal(changedDate.body.success, true);
    assert.equal(changedDate.body.data.best_before_date, '2027-12-31');
    assert.equal(changedDate.body.data.quantity_received, 5);
    assert.equal(changedDate.body.data.quantity_remaining, 5);

    const clearedDate = await request(baseUrl, '/api/inbound/batches/9007199254740993', {
      method: 'PATCH',
      token: ADMIN_TOKEN,
      body: { best_before_date: null }
    });
    assert.equal(clearedDate.status, 200);
    assert.equal(clearedDate.body.data.best_before_date, null);
    assert.match(clearedDate.body.message, /已清除/);
  });

  assert.deepEqual(supabase.updates, [
    {
      batch_id: '9007199254740993',
      patch: { best_before_date: '2027-12-31' },
      columns: 'batch_id, product_id, quantity_received, quantity_remaining, best_before_date, received_at, is_legacy_stock'
    },
    {
      batch_id: '9007199254740993',
      patch: { best_before_date: null },
      columns: 'batch_id, product_id, quantity_received, quantity_remaining, best_before_date, received_at, is_legacy_stock'
    }
  ]);
  assert.equal(batches[0].quantity_received, 5);
  assert.equal(batches[0].quantity_remaining, 5);
  assert.deepEqual(batches[1], originalSecondBatch);
});

test('batch date update rejects unauthorized, invalid, past, and non-date-only updates before writing', async () => {
  const supabase = createBatchUpdateSupabase([createBatchRecord(11)]);
  const scopes = [];
  const router = createRouter(supabase, {
    isSessionAuthorized: (req, token, scope) => {
      scopes.push({ token, scope });
      return false;
    }
  });

  await withServer(router, async baseUrl => {
    const unauthorized = await request(baseUrl, '/api/inbound/batches/11', {
      method: 'PATCH',
      body: { best_before_date: '2027-12-31' }
    });
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.body.success, false);
  });
  assert.deepEqual(scopes, [{ token: ADMIN_TOKEN, scope: 'inbound' }]);
  assert.deepEqual(supabase.updates, []);

  const authorizedRouter = createRouter(supabase);
  await withServer(authorizedRouter, async baseUrl => {
    const invalidBatchId = await request(baseUrl, '/api/inbound/batches/01', {
      method: 'PATCH',
      token: ADMIN_TOKEN,
      body: { best_before_date: '2027-12-31' }
    });
    assert.equal(invalidBatchId.status, 400);
    const oversizedBatchId = await request(
      baseUrl,
      '/api/inbound/batches/9223372036854775808',
      {
        method: 'PATCH',
        token: ADMIN_TOKEN,
        body: { best_before_date: '2027-12-31' }
      }
    );
    assert.equal(oversizedBatchId.status, 400);

    for (const body of [
      { best_before_date: '2027-02-30' },
      { best_before_date: getHongKongDate(-1) },
      { best_before_date: '2027-12-31', quantity_received: 999 },
      {}
    ]) {
      const response = await request(baseUrl, '/api/inbound/batches/11', {
        method: 'PATCH',
        token: ADMIN_TOKEN,
        body
      });
      assert.equal(response.status, 400);
      assert.equal(response.body.success, false);
    }
  });
  assert.deepEqual(supabase.updates, []);
});

test('batch date update returns not-found and structured database failures without partial changes', async () => {
  const missingSupabase = createBatchUpdateSupabase([]);
  await withServer(createRouter(missingSupabase), async baseUrl => {
    const missing = await request(baseUrl, '/api/inbound/batches/999', {
      method: 'PATCH',
      token: ADMIN_TOKEN,
      body: { best_before_date: '2027-12-31' }
    });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.success, false);
  });

  const original = createBatchRecord(11);
  const dbError = createBatchUpdateSupabase([{ ...original }], {
    error: { code: 'XX000', message: 'database unavailable' }
  });
  await withServer(createRouter(dbError), async baseUrl => {
    const failed = await request(baseUrl, '/api/inbound/batches/11', {
      method: 'PATCH',
      token: ADMIN_TOKEN,
      body: { best_before_date: '2027-12-31' }
    });
    assert.equal(failed.status, 500);
    assert.equal(failed.body.success, false);
  });

  const exception = createBatchUpdateSupabase([{ ...original }], {
    throwOnUpdate: true
  });
  await withServer(createRouter(exception), async baseUrl => {
    const failed = await request(baseUrl, '/api/inbound/batches/11', {
      method: 'PATCH',
      token: ADMIN_TOKEN,
      body: { best_before_date: '2027-12-31' }
    });
    assert.equal(failed.status, 500);
    assert.equal(failed.body.success, false);
  });
});
