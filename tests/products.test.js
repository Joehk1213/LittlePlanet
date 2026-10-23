const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const createProductsRouter = require('../routes/products');

const ADMIN_TOKEN = 'product-stock-admin-token-for-tests-000000';

async function withServer(router, run) {
  const app = express();
  app.use(express.json());
  app.use('/api/products', router);
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
  return createProductsRouter(supabase, {
    adminToken: ADMIN_TOKEN,
    stockWriteEnabled: true,
    ...options
  });
}

function createProductsQuery(rows) {
  const filters = [];
  const sorts = [];
  let offset = 0;
  let limit = 24;
  let countRequested = false;
  const query = {
    select(_fields, options) {
      countRequested = Boolean(options && options.count === 'exact');
      return query;
    },
    eq(column, value) {
      filters.push(row => row[column] === value);
      return query;
    },
    in(column, values) {
      filters.push(row => values.map(String).includes(String(row[column])));
      return query;
    },
    or(expression) {
      const match = expression.match(/^name\.ilike\.\*(.*)\*,description\.ilike\.\*(.*)\*$/);
      assert.ok(match);
      const needle = match[1].toLocaleLowerCase();
      filters.push(row => String(row.name || '').toLocaleLowerCase().includes(needle) ||
        String(row.description || '').toLocaleLowerCase().includes(needle));
      return query;
    },
    order(column, options) {
      sorts.push({ column, ascending: options.ascending });
      return query;
    },
    range(start, end) {
      offset = start;
      limit = end - start + 1;
      return query;
    },
    then(resolve, reject) {
      let filtered = rows.filter(row => filters.every(filter => filter(row)));
      for (const sort of sorts.slice().reverse()) {
        filtered = filtered.slice().sort((left, right) => {
          const leftValue = left[sort.column];
          const rightValue = right[sort.column];
          const comparison = typeof leftValue === 'number' && typeof rightValue === 'number'
            ? leftValue - rightValue
            : String(leftValue || '').localeCompare(String(rightValue || ''));
          return sort.ascending ? comparison : -comparison;
        });
      }
      const count = filtered.length;
      return Promise.resolve({
        data: filtered.slice(offset, offset + limit),
        count: countRequested ? count : null,
        error: null
      }).then(resolve, reject);
    }
  };
  return query;
}

test('products endpoint reads stock and retains category and status filtering', async () => {
  const rows = [
    { id: '4c260c94-2cb3-4de4-a71e-5b0f5cf53d87', name: '星球筆記本', category: '文具', status: '已到貨', stock: 12, cost_price: 8.5, created_at: '2026-06-01T00:00:00.000Z' },
    { id: '4c260c94-2cb3-4de4-a71e-5b0f5cf53d88', name: '星球公仔', category: '公仔', status: '已到貨', stock: 4 }
  ];
  const router = createRouter({
    from(table) {
      assert.equal(table, 'products');
      return createProductsQuery(rows);
    }
  });

  await withServer(router, async baseUrl => {
    const all = await request(baseUrl, '/api/products');
    assert.equal(all.status, 200);
    assert.equal(all.body.data.products[0].stock, 12);
    assert.equal(Object.hasOwn(all.body.data.products[0], 'cost_price'), false);
    assert.equal(all.body.data.products[0].created_at, '2026-06-01T00:00:00.000Z');
    assert.equal(all.body.data.total_count, 2);

    const filtered = await request(baseUrl, '/api/products?category=%E6%96%87%E5%85%B7&status=%E5%B7%B2%E5%88%B0%E8%B2%A8');
    assert.equal(filtered.status, 200);
    assert.equal(filtered.body.data.products.length, 1);
    assert.equal(filtered.body.data.products[0].stock, 12);

    const adminList = await request(baseUrl, '/api/products', { token: ADMIN_TOKEN });
    assert.equal(adminList.status, 200);
    assert.equal(adminList.body.data.products[0].cost_price, 8.5);
  });
});

test('products endpoint returns requested product IDs and public tier pricing fields', async () => {
  const rows = [
    {
      id: 51,
      name: '團購商品',
      price: 90,
      stock: 20,
      tier_prices: [{ min_qty: 3, price: 78 }],
      preorder_deadline: '2026-11-01T12:00:00.000Z'
    },
    { id: 52, name: '其他商品', price: 20, stock: 3 }
  ];
  const router = createRouter({
    from: () => createProductsQuery(rows)
  });
  await withServer(router, async baseUrl => {
    const response = await request(baseUrl, '/api/products?ids=51');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data.products, [rows[0]]);
    const invalid = await request(baseUrl, '/api/products?ids=51,999&search=invalid');
    assert.equal(invalid.status, 400);
  });
});

test('product administration rejects invalid cost prices', async () => {
  const router = createRouter({
    from() {
      assert.fail('invalid cost input must be rejected before accessing Supabase');
    }
  });
  await withServer(router, async baseUrl => {
    for (const costPrice of [-0.01, 10.123, '10.00']) {
      const response = await request(baseUrl, '/api/products', {
        method: 'POST',
        token: ADMIN_TOKEN,
        body: {
          name: '成本驗證商品',
          price: 20,
          cost_price: costPrice
        }
      });
      assert.equal(response.status, 400);
      assert.equal(response.body.success, false);
      assert.match(response.body.message, /成本價/);
    }
  });
});

test('product image upload requires admin access and validates bytes before Storage upload', async () => {
  const uploads = [];
  const supabase = {
    storage: {
      from(bucket) {
        assert.equal(bucket, 'product-images');
        return {
          async upload(path, bytes, options) {
            uploads.push({ path, bytes, options });
            return { error: null };
          },
          getPublicUrl(path) {
            return { data: { publicUrl: `https://storage.example/product-images/${path}` } };
          }
        };
      }
    }
  };
  const router = createRouter(supabase);
  await withServer(router, async baseUrl => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x00
    ]);
    const unauthorized = await fetch(`${baseUrl}/api/products/images`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: png
    });
    assert.equal(unauthorized.status, 401);

    const invalid = await fetch(`${baseUrl}/api/products/images`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
        'Content-Type': 'image/png'
      },
      body: Buffer.from('not a png')
    });
    assert.equal(invalid.status, 400);
    assert.equal(uploads.length, 0);

    const uploaded = await fetch(`${baseUrl}/api/products/images`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
        'Content-Type': 'image/png'
      },
      body: png
    });
    const result = await uploaded.json();
    assert.equal(uploaded.status, 201);
    assert.equal(result.success, true);
    assert.match(result.data.image_url, /^https:\/\/storage\.example\/product-images\//);
    assert.equal(uploads.length, 1);
    assert.match(uploads[0].path, /^[0-9a-f-]+\.png$/);
    assert.equal(uploads[0].options.contentType, 'image/png');
  });
});

test('products endpoint returns only a date-only public summary for multiple batches when requested', async () => {
  const productRows = [
    { id: 51, name: '有日期商品', stock: 3 },
    { id: 52, name: '無日期商品', stock: 2 },
    { id: 53, name: '沒有批次商品', stock: 0 }
  ];
  const batchRows = [
    {
      product_id: 51,
      best_before_date: '2027-08-15',
      is_legacy_stock: false,
      quantity_received: 4,
      quantity_remaining: 2,
      batch_id: 9001
    },
    {
      product_id: 51,
      best_before_date: '2027-02-01',
      is_legacy_stock: false,
      quantity_received: 6,
      quantity_remaining: 3,
      batch_id: 9002
    },
    {
      product_id: 51,
      best_before_date: null,
      is_legacy_stock: false,
      quantity_received: 1,
      quantity_remaining: 1,
      batch_id: 9003
    },
    {
      product_id: 51,
      best_before_date: null,
      is_legacy_stock: true,
      quantity_received: 2,
      quantity_remaining: 2,
      batch_id: 9004
    },
    {
      product_id: 52,
      best_before_date: null,
      is_legacy_stock: false,
      quantity_received: 2,
      quantity_remaining: 2,
      batch_id: 9005
    }
  ];
  const selectedTables = [];
  const supabase = {
    from(table) {
      selectedTables.push(table);
      if (table === 'products') return createProductsQuery(productRows);
      assert.equal(table, 'product_stock_batches');
      let selectedIds = [];
      const query = {
        select(columns) {
          assert.equal(columns, 'product_id, best_before_date, is_legacy_stock');
          return query;
        },
        in(column, ids) {
          assert.equal(column, 'product_id');
          selectedIds = ids.map(String);
          return query;
        },
        then(resolve, reject) {
          return Promise.resolve({
            data: batchRows.filter(row => selectedIds.includes(String(row.product_id))),
            error: null
          }).then(resolve, reject);
        }
      };
      return query;
    }
  };

  const router = createRouter(supabase);
  await withServer(router, async baseUrl => {
    const response = await request(
      baseUrl,
      '/api/products?include_best_before_dates=true'
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    const [dated, undated, noBatches] = response.body.data.products;
    assert.deepEqual(dated.best_before_summary, {
      best_before_dates: ['2027-02-01', '2027-08-15'],
      has_undated_batch: true,
      has_legacy_unknown_date: true
    });
    assert.deepEqual(undated.best_before_summary, {
      best_before_dates: [],
      has_undated_batch: true,
      has_legacy_unknown_date: false
    });
    assert.deepEqual(noBatches.best_before_summary, {
      best_before_dates: [],
      has_undated_batch: false,
      has_legacy_unknown_date: false
    });
    assert.equal(Object.hasOwn(dated.best_before_summary, 'quantity_remaining'), false);
    assert.equal(Object.hasOwn(dated.best_before_summary, 'batch_id'), false);
    assert.deepEqual(selectedTables, ['products', 'product_stock_batches']);
  });
});

test('products endpoint reports errors when the public batch-date summary cannot be read', async () => {
  for (const error of [
    { code: 'PGRST205', message: 'table unavailable' },
    { code: 'XX000', message: 'database unavailable' }
  ]) {
    const supabase = {
      from(table) {
        if (table === 'products') return createProductsQuery([{ id: 51, name: '商品' }]);
        const query = {
          select() { return query; },
          in() { return query; },
          then(resolve, reject) {
            return Promise.resolve({ data: null, error }).then(resolve, reject);
          }
        };
        return query;
      }
    };
    const router = createRouter(supabase);
    await withServer(router, async baseUrl => {
      const response = await request(
        baseUrl,
        '/api/products?include_best_before_dates=true'
      );
      assert.equal(response.status, error.code === 'PGRST205' ? 503 : 500);
      assert.equal(response.body.success, false);
      assert.equal(response.body.data, null);
    });
  }
});

test('products endpoint rejects an invalid best-before summary option before database access', async () => {
  let calls = 0;
  const router = createRouter({
    from() {
      calls += 1;
      throw new Error('invalid summary option must not query the database');
    }
  });
  await withServer(router, async baseUrl => {
    const response = await request(
      baseUrl,
      '/api/products?include_best_before_dates=yes'
    );
    assert.equal(response.status, 400);
    assert.equal(response.body.success, false);
  });
  assert.equal(calls, 0);
});

test('products endpoint searches, sorts and paginates validated query parameters', async () => {
  const rows = [
    { id: 1, name: '星球筆記本', description: '輕便文具', category: '文具', price: 80, created_at: '2026-01-01' },
    { id: 2, name: '月球貼紙', description: '筆記本裝飾', category: '文具', price: 20, created_at: '2026-02-01' },
    { id: 3, name: '火星公仔', description: '擺設', category: '公仔', price: 50, created_at: '2026-03-01' }
  ];
  const router = createRouter({
    from: () => createProductsQuery(rows)
  });

  await withServer(router, async baseUrl => {
    const searched = await request(baseUrl, '/api/products?search=%E7%AD%86%E8%A8%98%E6%9C%AC&category=%E6%96%87%E5%85%B7&sort=price-asc&limit=1&offset=0');
    assert.equal(searched.status, 200);
    assert.equal(searched.body.data.total_count, 2);
    assert.equal(searched.body.data.limit, 1);
    assert.equal(searched.body.data.offset, 0);
    assert.equal(searched.body.data.products.length, 1);
    assert.equal(searched.body.data.products[0].id, 2);

    const secondPage = await request(baseUrl, '/api/products?category=%E6%96%87%E5%85%B7&sort=price-desc&limit=1&offset=1');
    assert.equal(secondPage.body.data.products[0].id, 2);
    assert.equal(secondPage.body.data.total_count, 2);

    const defaultSort = await request(baseUrl, '/api/products?sort=default');
    assert.equal(defaultSort.status, 200);
    assert.equal(defaultSort.body.data.products[0].id, 3);
  });
});

test('products endpoint rejects invalid search, sort, and pagination parameters before database access', async () => {
  let calls = 0;
  const router = createRouter({
    from() {
      calls += 1;
      throw new Error('invalid query parameters must not call Supabase');
    }
  });
  await withServer(router, async baseUrl => {
    for (const query of [
      'search=',
      'search=a%2Cb',
      'search=%25',
      'sort=unknown',
      'limit=0',
      'limit=101',
      'offset=-1',
      'offset=1.5'
    ]) {
      const response = await request(baseUrl, `/api/products?${query}`);
      assert.equal(response.status, 400, query);
      assert.equal(response.body.success, false);
      assert.equal(response.body.data, null);
    }
  });
  assert.equal(calls, 0);
});

test('inventory alerts require admin access and use validated restock thresholds', async () => {
  const calls = [];
  const router = createRouter({
    rpc: async (name, args) => {
      calls.push({ name, args });
      return {
        data: [{
          product_id: '12',
          product_name: '星球手帳',
          stock: 2,
          safety_stock: 3,
          suggested_restock_quantity: 8,
          last_order_date: null,
          days_since_last_order: 45,
          is_restock_needed: true,
          is_slow_moving: true
        }],
        error: null
      };
    }
  });

  await withServer(router, async baseUrl => {
    const denied = await request(baseUrl, '/api/products/inventory-alerts');
    assert.equal(denied.status, 401);

    const invalid = await request(baseUrl, '/api/products/inventory-alerts?safety_stock=4&target_stock=3', {
      token: ADMIN_TOKEN
    });
    assert.equal(invalid.status, 400);

    const response = await request(baseUrl, '/api/products/inventory-alerts', {
      token: ADMIN_TOKEN
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.alerts[0].suggested_restock_quantity, 8);
    assert.deepEqual(calls, [{
      name: 'get_product_inventory_alerts',
      args: {
        p_safety_stock: 3,
        p_target_stock: 10,
        p_slow_days: 30
      }
    }]);
  });
});

test('inventory adjustments validate reasons and persist a transactional audit RPC', async () => {
  const calls = [];
  const router = createRouter({
    rpc: async (name, args) => {
      calls.push({ name, args });
      return {
        data: {
          adjustment_id: 42,
          product_id: 12,
          quantity_before: 4,
          quantity_delta: -1,
          quantity_after: 3,
          reason: '損毀',
          note: '包裝破損',
          created_at: '2026-10-22T10:00:00.000Z'
        },
        error: null
      };
    }
  });

  await withServer(router, async baseUrl => {
    const unauthorized = await request(baseUrl, '/api/products/12/adjustments', {
      method: 'POST',
      body: { quantity_delta: -1, reason: '損毀' }
    });
    assert.equal(unauthorized.status, 401);

    const invalid = await request(baseUrl, '/api/products/12/adjustments', {
      method: 'POST',
      token: ADMIN_TOKEN,
      body: { quantity_delta: -1, reason: '原因不明' }
    });
    assert.equal(invalid.status, 400);

    const saved = await request(baseUrl, '/api/products/12/adjustments', {
      method: 'POST',
      token: ADMIN_TOKEN,
      body: { quantity_delta: -1, reason: '損毀', note: '包裝破損' }
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.success, true);
    assert.equal(saved.body.data.quantity_after, 3);
    assert.deepEqual(calls, [{
      name: 'adjust_product_inventory',
      args: {
        p_product_id: 12,
        p_quantity_delta: -1,
        p_reason: '損毀',
        p_note: '包裝破損',
        p_actor: 'admin'
      }
    }]);
  });
});

test('product create and edit endpoints require admin access and persist validated fields', async () => {
  const operations = [];
  const savedProduct = {
    id: '7',
    name: '星球筆記本',
    price: 89.5,
    stock: 0,
    status: '預購中'
  };
  const supabase = {
    from(table) {
      assert.equal(table, 'products');
      return {
        insert(values) {
          operations.push({ operation: 'insert', values });
          return {
            select() {
              return {
                single: async () => ({ data: savedProduct, error: null })
              };
            }
          };
        },
        update(values) {
          operations.push({ operation: 'update', values });
          return {
            eq(column, value) {
              operations[operations.length - 1].filter = { column, value };
              return {
                select() {
                  return {
                    maybeSingle: async () => ({ data: savedProduct, error: null })
                  };
                }
              };
            }
          };
        }
      };
    }
  };
  const router = createRouter(supabase);

  await withServer(router, async baseUrl => {
    const unauthorized = await request(baseUrl, '/api/products', {
      method: 'POST',
      body: { name: '未授權商品', price: 20 }
    });
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.body.success, false);

    const created = await request(baseUrl, '/api/products', {
      method: 'POST',
      token: ADMIN_TOKEN,
      body: {
        name: '星球筆記本',
        price: 89.5,
        tier_prices: [{ min_qty: 6, price: 82 }, { min_qty: 3, price: 85 }],
        preorder_deadline: '2026-11-01T12:00:00.000Z'
      }
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.success, true);
    assert.equal(created.body.data.stock, 0);
    assert.deepEqual(operations[0].values.tier_prices, [
      { min_qty: 3, price: 85 },
      { min_qty: 6, price: 82 }
    ]);
    assert.equal(operations[0].values.preorder_deadline, '2026-11-01T12:00:00.000Z');

    const updated = await request(baseUrl, `/api/products/${savedProduct.id}`, {
      method: 'PATCH',
      token: ADMIN_TOKEN,
      body: {
        name: '星球筆記本（新版）',
        price: 99,
        tier_prices: [{ min_qty: 3, price: 88 }],
        preorder_deadline: null
      }
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.success, true);
    assert.equal(updated.body.data.name, savedProduct.name);
  });

  assert.deepEqual(operations, [
    {
      operation: 'insert',
      values: {
        name: '星球筆記本',
        price: 89.5,
        tier_prices: [
          { min_qty: 3, price: 85 },
          { min_qty: 6, price: 82 }
        ],
        preorder_deadline: '2026-11-01T12:00:00.000Z',
        stock: 0,
        status: '預購中'
      }
    },
    {
      operation: 'update',
      values: {
        name: '星球筆記本（新版）',
        price: 99,
        tier_prices: [{ min_qty: 3, price: 88 }],
        preorder_deadline: null
      },
      filter: { column: 'id', value: savedProduct.id }
    }
  ]);
});

test('product create and edit validate input and report database errors', async () => {
  let calls = 0;
  const invalidRouter = createRouter({
    from() {
      calls += 1;
      throw new Error('invalid product data must not call Supabase');
    }
  });
  await withServer(invalidRouter, async baseUrl => {
    for (const body of [
      { name: '', price: 1 },
      { name: 'Bad price', price: -1 },
      { name: 'Fractional price', price: 1.234 },
      { name: 'String price', price: '10' },
      { name: 'Boolean price', price: true },
      { name: 'Tier above base price', price: 10, tier_prices: [{ min_qty: 3, price: 11 }] },
      { name: 'Duplicate tier quantity', price: 10, tier_prices: [{ min_qty: 3, price: 9 }, { min_qty: 3, price: 8 }] },
      { name: 'Higher tier price rises', price: 10, tier_prices: [{ min_qty: 3, price: 8 }, { min_qty: 6, price: 9 }] },
      { name: 'Malformed deadline', price: 10, preorder_deadline: 'not a date' }
    ]) {
      const response = await request(baseUrl, '/api/products', {
        method: 'POST',
        token: ADMIN_TOKEN,
        body
      });
      assert.equal(response.status, 400);
      assert.equal(response.body.success, false);
    }
  });
  assert.equal(calls, 0);

  const errorRouter = createRouter({
    from() {
      return {
        insert() {
          return {
            select() {
              return {
                single: async () => ({ data: null, error: { code: 'XX000' } })
              };
            }
          };
        }
      };
    }
  });
  await withServer(errorRouter, async baseUrl => {
    const response = await request(baseUrl, '/api/products', {
      method: 'POST',
      token: ADMIN_TOKEN,
      body: { name: '資料庫錯誤商品', price: 10 }
    });
    assert.equal(response.status, 500);
    assert.equal(response.body.success, false);
    assert.equal(response.body.data, null);
    assert.equal(typeof response.body.message, 'string');
  });
});

test('product deletion requires admin authorization and returns the deleted product ID', async () => {
  const operations = [];
  const router = createRouter({
    from(table) {
      assert.equal(table, 'products');
      return {
        delete() {
          operations.push({ operation: 'delete' });
          return {
            eq(column, value) {
              operations.at(-1).filter = { column, value };
              return {
                select(fields) {
                  operations.at(-1).fields = fields;
                  return {
                    maybeSingle: async () => ({
                      data: { id: '7' },
                      error: null
                    })
                  };
                }
              };
            }
          };
        }
      };
    }
  });

  await withServer(router, async baseUrl => {
    const unauthorized = await request(baseUrl, '/api/products/7', {
      method: 'DELETE'
    });
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.body.success, false);
    assert.equal(operations.length, 0);

    const deleted = await request(baseUrl, '/api/products/7', {
      method: 'DELETE',
      token: ADMIN_TOKEN
    });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.success, true);
    assert.deepEqual(deleted.body.data, { id: '7' });
  });

  assert.deepEqual(operations, [{
    operation: 'delete',
    filter: { column: 'id', value: '7' },
    fields: 'id'
  }]);
});

test('stock update requires admin authorization and service role, then returns persisted stock', async () => {
  const operations = [];
  const router = createRouter({
    rpc: async (name, args) => {
      operations.push({ name, args });
      return {
        data: {
          adjustment_id: 1,
          quantity_before: 12,
          quantity_delta: 8,
          quantity_after: 20,
          stock: 20,
          reason: '實體盤點差異'
        },
        error: null
      };
    }
  });

  await withServer(router, async baseUrl => {
    const path = '/api/products/7/stock';
    const unauthorized = await request(baseUrl, path, {
      method: 'PATCH',
      body: { stock: 20, reason: '實體盤點差異' }
    });
    assert.equal(unauthorized.status, 401);

    const updated = await request(baseUrl, path, {
      method: 'PATCH',
      token: ADMIN_TOKEN,
      body: { stock: 20, reason: '實體盤點差異' }
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.stock, 20);
    assert.equal(updated.body.data.adjustment_id, 1);
  });

  assert.deepEqual(operations, [{
    name: 'set_product_inventory',
    args: {
      p_product_id: 7,
      p_stock: 20,
      p_reason: '實體盤點差異',
      p_note: null,
      p_actor: 'admin'
    }
  }]);
});

test('stock update validates product ID and stock without calling Supabase', async () => {
  let writes = 0;
  const router = createRouter({
    rpc() {
      writes += 1;
      throw new Error('Invalid stock input must not write to Supabase.');
    }
  });

  await withServer(router, async baseUrl => {
    for (const [path, stock] of [
      ['/api/products/not-a-product-id/stock', 5],
      ['/api/products/9007199254740992/stock', 5],
      ['/api/products/7/stock', -1],
      ['/api/products/7/stock', 1.5],
      ['/api/products/7/stock', '01'],
      ['/api/products/7/stock', '5'],
      ['/api/products/7/stock', true]
    ]) {
      const invalid = await request(baseUrl, path, {
        method: 'PATCH',
        token: ADMIN_TOKEN,
        body: { stock, reason: '損毀' }
      });
      assert.equal(invalid.status, 400);
    }
    const missingReason = await request(baseUrl, '/api/products/7/stock', {
      method: 'PATCH',
      token: ADMIN_TOKEN,
      body: { stock: 5 }
    });
    assert.equal(missingReason.status, 400);
  });

  assert.equal(writes, 0);
});

test('stock update surfaces missing migration, missing product and unexpected Supabase errors', async () => {
  for (const [error, expectedStatus] of [
    [{ code: 'PGRST204' }, 503],
    [{ code: 'XX000' }, 500]
  ]) {
    const router = createRouter({
      rpc: async () => ({ data: null, error })
    });
    await withServer(router, async baseUrl => {
      const response = await request(
        baseUrl,
        '/api/products/7/stock',
        { method: 'PATCH', token: ADMIN_TOKEN, body: { stock: 3, reason: '損毀' } }
      );
      assert.equal(response.status, expectedStatus);
      assert.equal(response.body.success, false);
    });
  }

  const missingProductRouter = createRouter({
    rpc: async () => ({ data: null, error: { code: 'P0002', message: 'missing' } })
  });
  await withServer(missingProductRouter, async baseUrl => {
    const response = await request(baseUrl, '/api/products/7/stock', {
      method: 'PATCH',
      token: ADMIN_TOKEN,
      body: { stock: 3, reason: '損毀' }
    });
    assert.equal(response.status, 404);
  });
});

test('stock update fails closed if service role or admin token is unavailable', async () => {
  const supabase = {
    rpc: () => {
      throw new Error('Supabase must not be called while writes are disabled.');
    }
  };
  const router = createRouter(supabase, {
    adminToken: '',
    stockWriteEnabled: false
  });

  await withServer(router, async baseUrl => {
    const response = await request(baseUrl, '/api/products/7/stock', {
      method: 'PATCH',
      body: { stock: 3, reason: '損毀' }
    });
    assert.equal(response.status, 503);
  });
});

test('product category endpoints trim names, reuse case-insensitive duplicates, and report database failures', async () => {
  const categories = [
    { name: 'stationery', label: '📝 文具' }
  ];
  const router = createRouter({
    from(table) {
      assert.equal(table, 'product_categories');
      const query = {
        select() {
          return query;
        },
        order() {
          return Promise.resolve({ data: categories, error: null });
        },
        insert(values) {
          const existing = categories.find(category =>
            category.name.toLocaleLowerCase() === values.name.toLocaleLowerCase()
          );
          if (existing) {
            return query;
          }
          categories.push(values);
          return {
            select() {
              return {
                single: async () => ({ data: values, error: null })
              };
            }
          };
        },
        then(resolve, reject) {
          return Promise.resolve({ data: categories, error: null }).then(resolve, reject);
        }
      };
      return query;
    }
  });

  await withServer(router, async baseUrl => {
    const unauthorized = await request(baseUrl, '/api/products/categories', {
      method: 'POST',
      body: { name: '自訂分類' }
    });
    assert.equal(unauthorized.status, 401);

    const blank = await request(baseUrl, '/api/products/categories', {
      method: 'POST',
      token: ADMIN_TOKEN,
      body: { name: '   ' }
    });
    assert.equal(blank.status, 400);

    const created = await request(baseUrl, '/api/products/categories', {
      method: 'POST',
      token: ADMIN_TOKEN,
      body: { name: '  天文模型  ' }
    });
    assert.equal(created.status, 201);
    assert.deepEqual(created.body.data.category, { name: '天文模型', label: '天文模型' });

    const duplicate = await request(baseUrl, '/api/products/categories', {
      method: 'POST',
      token: ADMIN_TOKEN,
      body: { name: ' 天文模型 ' }
    });
    assert.equal(duplicate.status, 200);
    assert.match(duplicate.body.message, /已存在/);

    const listed = await request(baseUrl, '/api/products/categories', { token: ADMIN_TOKEN });
    assert.equal(listed.status, 200);
    assert.ok(listed.body.data.categories.some(category => category.name === '天文模型'));
  });
});

test('product create and edit persist only registered, trimmed category names', async () => {
  const operations = [];
  const router = createRouter({
    from(table) {
      if (table === 'product_categories') {
        return {
          select() {
            return this;
          },
          eq(column, value) {
            assert.equal(column, 'name');
            assert.equal(value, '天文模型');
            return this;
          },
          maybeSingle: async () => ({ data: { name: '天文模型' }, error: null })
        };
      }
      assert.equal(table, 'products');
      return {
        insert(values) {
          operations.push({ method: 'insert', values });
          return {
            select() {
              return {
                single: async () => ({ data: { id: 8, ...values }, error: null })
              };
            }
          };
        },
        update(values) {
          operations.push({ method: 'update', values });
          return {
            eq(column, value) {
              return {
                select() {
                  return {
                    maybeSingle: async () => ({
                      data: { id: Number(value), name: '星球公仔', price: 20, ...values },
                      error: null
                    })
                  };
                }
              };
            }
          };
        }
      };
    }
  });

  await withServer(router, async baseUrl => {
    const created = await request(baseUrl, '/api/products', {
      method: 'POST',
      token: ADMIN_TOKEN,
      body: { name: '星球公仔', price: 20, category: ' 天文模型 ' }
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.data.category, '天文模型');

    const updated = await request(baseUrl, '/api/products/8', {
      method: 'PATCH',
      token: ADMIN_TOKEN,
      body: { name: '星球公仔', price: 22, category: ' 天文模型 ' }
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.category, '天文模型');
  });

  assert.deepEqual(operations, [
    {
      method: 'insert',
      values: { name: '星球公仔', price: 20, category: '天文模型', stock: 0, status: '預購中' }
    },
    {
      method: 'update',
      values: { name: '星球公仔', price: 22, category: '天文模型' }
    }
  ]);
});
