const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const createAnalyticsRouter = require('../routes/analytics');

const ADMIN_TOKEN = 'fedcba9876543210fedcba9876543210';

async function withServer(router, run) {
  const app = express();
  app.use(express.json());
  app.use('/api/analytics', router);
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

async function request(baseUrl, path, token = ADMIN_TOKEN) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return {
    status: response.status,
    body: await response.json(),
    cacheStatus: response.headers.get('x-analytics-cache')
  };
}

function createRouter(supabase, options = {}) {
  return createAnalyticsRouter(supabase, {
    adminToken: ADMIN_TOKEN,
    readEnabled: true,
    ...options
  });
}

function createTableClient(tables, options = {}) {
  return {
    from(tableName) {
      const state = {
        rows: tables[tableName] || [],
        filters: [],
        start: 0,
        end: Infinity,
        columns: null
      };
      const query = {
        select(columns, selectOptions) {
          state.columns = columns.split(',').map(column => column.trim());
          state.countRequested = Boolean(selectOptions && selectOptions.count === 'exact');
          return query;
        },
        gte(column, value) {
          state.filters.push(row => new Date(row[column]).getTime() >= new Date(value).getTime());
          return query;
        },
        lt(column, value) {
          state.filters.push(row => new Date(row[column]).getTime() < new Date(value).getTime());
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
        limit(limit) {
          state.end = Math.min(state.end, limit - 1);
          return query;
        },
        range(start, end) {
          state.start = start;
          state.end = end;
          return query;
        },
        then(resolve, reject) {
          const availableColumns = options.schemas && options.schemas[tableName];
          const missingColumn = availableColumns && state.columns
            ? state.columns.find(column => !availableColumns.includes(column))
            : null;
          const matchingRows = state.rows.filter(row => state.filters.every(filter => filter(row)));
          const result = {
            data: missingColumn ? null : matchingRows.slice(state.start, state.end + 1),
            error: missingColumn
              ? {
                code: '42703',
                message: `column ${tableName}.${missingColumn} does not exist`
              }
              : null,
            count: state.countRequested ? matchingRows.length : null
          };
          return Promise.resolve(result).then(resolve, reject);
        }
      };
      return query;
    }
  };
}

test('analytics summary selects product names from the existing products.name column', async () => {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
  const supabase = createTableClient({
    orders: [{ order_id: 'schema-summary-1', order_date: `${today}T03:00:00+08:00`, total_amount: 20 }],
    order_items: [{
      order_id: 'schema-summary-1',
      product_id: 'product-a',
      quantity: 2,
      unit_price: 10
    }],
    products: [{ id: 'product-a', name: '星球手帳' }]
  }, {
    schemas: {
      products: ['id', 'name']
    }
  });
  const router = createRouter(supabase, {
    requireSession: true,
    isSessionAuthorized: (_req, scope) => scope === 'analytics'
  });

  await withServer(router, async baseUrl => {
    const response = await request(baseUrl, '/api/analytics/summary');

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.top_products[0].product_name, '星球手帳');
  });
});

test('table fallback reports live orders and UUID-keyed product totals', async () => {
  const router = createRouter(createTableClient({
    orders: [
      {
        order_id: 'a123',
        order_date: '2026-09-20T10:00:00+08:00',
        total_amount: 150,
        payment_status: '未付款',
        shipping_status: '待到貨'
      },
      {
        order_id: 'b456',
        order_date: '2026-09-21T10:00:00+08:00',
        total_amount: 300,
        payment_status: '未付款',
        shipping_status: '待到貨'
      }
    ],
    order_items: [
      {
        item_id: 'i001',
        order_id: 'a123',
        product_id: 'p001',
        quantity: 1,
        unit_price: 150,
        item_status: '待進貨'
      },
      {
        item_id: 'i002',
        order_id: 'b456',
        product_id: 'p001',
        quantity: 2,
        unit_price: 150,
        item_status: '待進貨'
      }
    ],
    products: [{ id: 'p001', name: 'LittlePlanet 星球筆記本' }]
  }), { useTableFallback: true });

  await withServer(router, async baseUrl => {
    const overview = await request(
      baseUrl,
      '/api/analytics/overview?start_date=2026-09-01&end_date=2026-09-27'
    );
    assert.equal(overview.status, 200);
    assert.equal(overview.body.data.total_revenue, 450);
    assert.equal(overview.body.data.total_orders, 2);
    assert.equal(overview.body.data.paid_order_percentage, 0);
    assert.equal(overview.body.data.shipped_order_percentage, 0);

    const ranking = await request(
      baseUrl,
      '/api/analytics/top-products?start_date=2026-09-01&end_date=2026-09-27'
    );
    assert.equal(ranking.status, 200);
    assert.equal(ranking.body.data[0].product_id, 'p001');
    assert.equal(ranking.body.data[0].quantity_sold, 3);
    assert.equal(ranking.body.data[0].sales_amount, 450);

    const reconciliation = await request(
      baseUrl,
      '/api/analytics/reconciliation?start_date=2026-09-01&end_date=2026-09-27'
    );
    assert.equal(reconciliation.status, 200);
    assert.equal(reconciliation.body.data.total_count, 2);
    assert.equal(reconciliation.body.data.rows[0].order_id, 'a123');
  });
});

test('analytics summary requires an analytics session and aggregates bounded dashboard data', async () => {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
  const orderDate = `${today}T03:00:00+08:00`;
  const supabase = createTableClient({
    orders: [
      { order_id: 'summary-1', order_date: orderDate, total_amount: 125 },
      { order_id: 'summary-2', order_date: orderDate, total_amount: 75 }
    ],
    order_items: [
      { order_id: 'summary-1', product_id: 'product-a', quantity: 2, unit_price: 50 },
      { order_id: 'summary-2', product_id: 'product-a', quantity: 1, unit_price: 50 },
      { order_id: 'summary-2', product_id: 'product-b', quantity: 1, unit_price: 25 }
    ],
    products: [
      { id: 'product-a', name: '星球手帳' },
      { id: 'product-b', name: '月球貼紙' }
    ]
  });
  await withServer(createRouter(supabase), async baseUrl => {
    const legacyMount = await request(baseUrl, '/api/analytics/summary');
    assert.equal(legacyMount.status, 401);
    assert.equal(legacyMount.body.success, false);
  });

  let sessionAuthorized = false;
  const router = createRouter(supabase, {
    requireSession: true,
    isSessionAuthorized: (_req, scope) => sessionAuthorized && scope === 'analytics'
  });
  const app = express();
  app.use('/api/admin/analytics', router);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/admin/analytics/summary`;
    const unauthorized = await fetch(url);
    assert.equal(unauthorized.status, 401);
    const bearer = await fetch(url, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` }
    });
    assert.equal(bearer.status, 401);

    sessionAuthorized = true;
    const response = await fetch(url);
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.success, true);
    assert.equal(result.data.total_revenue, 200);
    assert.equal(result.data.total_orders, 2);
    assert.equal(result.data.top_products[0].product_id, 'product-a');
    assert.equal(result.data.top_products[0].quantity_sold, 3);
    assert.equal(result.data.top_products[0].product_name, '星球手帳');
    assert.equal(result.data.order_trend.length, 7);
    assert.equal(result.data.order_trend.at(-1).order_count, 2);
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
});

test('analytics summary returns structured Supabase errors without leaking details', async () => {
  const supabase = {
    from() {
      const query = {
        select() { return query; },
        order() { return query; },
        range: async () => ({ data: null, error: { code: 'XX000', message: 'private detail' } })
      };
      return query;
    }
  };
  const router = createRouter(supabase, {
    requireSession: true,
    isSessionAuthorized: (_req, scope) => scope === 'analytics'
  });
  await withServer(router, async baseUrl => {
    const response = await request(baseUrl, '/api/analytics/summary');
    assert.equal(response.status, 500);
    assert.equal(response.body.success, false);
    assert.equal(response.body.data, null);
    assert.match(response.body.message, /營運分析摘要失敗/);
    assert.doesNotMatch(response.body.message, /private detail/);
  });
});

test('analytics report responses are cached by endpoint and query parameters', async () => {
  let rpcCalls = 0;
  const router = createRouter({
    rpc: async (_functionName, parameters) => {
      rpcCalls += 1;
      return {
        data: {
          start_date: parameters.p_start_date,
          end_date: parameters.p_end_date,
          total_revenue: rpcCalls,
          total_orders: rpcCalls,
          paid_orders: 0,
          unpaid_orders: rpcCalls,
          paid_order_percentage: 0,
          unpaid_order_percentage: 100,
          shipped_orders: 0,
          unshipped_orders: rpcCalls,
          shipped_order_percentage: 0,
          unshipped_order_percentage: 100
        },
        error: null
      };
    }
  });

  await withServer(router, async baseUrl => {
    const path = '/api/analytics/overview?start_date=2026-09-01&end_date=2026-09-26';
    const first = await request(baseUrl, path);
    const cached = await request(baseUrl, path);
    const differentRange = await request(
      baseUrl,
      '/api/analytics/overview?start_date=2026-09-02&end_date=2026-09-26'
    );

    assert.equal(first.status, 200);
    assert.equal(first.body.data.total_revenue, 1);
    assert.equal(first.body.success, true);
    assert.equal(cached.body.data.total_revenue, 1);
    assert.equal(first.cacheStatus, 'MISS');
    assert.equal(cached.cacheStatus, 'HIT');
    assert.equal(differentRange.body.data.total_revenue, 2);
    assert.equal(rpcCalls, 2);
  });
});

test('sales trend returns daily Hong Kong totals and fills dates without orders', async () => {
  const router = createRouter(createTableClient({
    orders: [
      {
        order_id: 'trend-1',
        order_date: '2026-09-20T23:30:00-07:00',
        total_amount: 150
      },
      {
        order_id: 'trend-2',
        order_date: '2026-09-22T12:00:00+08:00',
        total_amount: 300
      }
    ]
  }));

  await withServer(router, async baseUrl => {
    const response = await request(
      baseUrl,
      '/api/analytics/sales-trend?start_date=2026-09-21&end_date=2026-09-22'
    );
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data.labels, ['2026-09-21', '2026-09-22']);
    assert.deepEqual(response.body.data.revenue, [150, 300]);
    assert.deepEqual(response.body.data.order_count, [1, 1]);
    assert.equal(response.body.data.total_revenue, 450);
    assert.equal(response.body.data.total_orders, 2);
  });
});

test('sales trend validates dates, requires admin auth and surfaces database errors', async () => {
  await withServer(createRouter({
    from() {
      return {
        select() {
          return this;
        },
        gte() {
          return this;
        },
        lt() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return Promise.resolve({
            data: null,
            error: { code: 'XX000' }
          });
        }
      };
    }
  }), async baseUrl => {
    const invalid = await request(
      baseUrl,
      '/api/analytics/sales-trend?start_date=2026-02-30&end_date=2026-03-01'
    );
    assert.equal(invalid.status, 400);

    const dbError = await request(
      baseUrl,
      '/api/analytics/sales-trend?start_date=2026-09-01&end_date=2026-09-02'
    );
    assert.equal(dbError.status, 500);
    assert.equal(dbError.body.success, false);

    const unauthorized = await request(
      baseUrl,
      '/api/analytics/sales-trend?start_date=2026-09-01&end_date=2026-09-02',
      'wrong'
    );
    assert.equal(unauthorized.status, 401);
  });
});

test('revenue overview validates date range and returns RPC report', async () => {
  let call;
  const router = createRouter({
    rpc: async (name, args) => {
      call = { name, args };
      return {
        data: {
          total_revenue: 150,
          total_orders: 3,
          paid_orders: 2,
          unpaid_orders: 1,
          paid_order_percentage: 66.67,
          unshipped_order_percentage: 33.33
        },
        error: null
      };
    }
  });

  await withServer(router, async baseUrl => {
    const response = await request(
      baseUrl,
      '/api/analytics/overview?start_date=2026-01-01&end_date=2026-01-31'
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.data.total_revenue, 150);

    for (const query of [
      '',
      '?start_date=2026-02-30&end_date=2026-03-01',
      '?start_date=0000-01-01&end_date=0000-01-02',
      '?start_date=2026-02-02&end_date=2026-02-01',
      '?start_date=2010-01-01&end_date=2026-01-01'
    ]) {
      const invalid = await request(baseUrl, `/api/analytics/overview${query}`);
      assert.equal(invalid.status, 400);
    }
  });

  assert.deepEqual(call, {
    name: 'get_revenue_overview',
    args: {
      p_start_date: '2026-01-01',
      p_end_date: '2026-01-31'
    }
  });
});

test('top product ranking validates its limit and returns ordered rows', async () => {
  let args;
  const router = createRouter({
    rpc: async (name, parameters) => {
      assert.equal(name, 'get_top_selling_products');
      args = parameters;
      return {
        data: [{
          rank: 1,
          product_id: 5,
          product_name: '星星公仔',
          quantity_sold: 8,
          sales_amount: 240
        }],
        error: null
      };
    }
  });

  await withServer(router, async baseUrl => {
    const result = await request(
      baseUrl,
      '/api/analytics/top-products?start_date=2026-09-01&end_date=2026-09-26&limit=5'
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.data[0].quantity_sold, 8);

    for (const limit of ['0', '51', '1.5', '-1']) {
      const invalid = await request(
        baseUrl,
        `/api/analytics/top-products?start_date=2026-09-01&end_date=2026-09-26&limit=${limit}`
      );
      assert.equal(invalid.status, 400);
    }
  });

  assert.deepEqual(args, {
    p_start_date: '2026-09-01',
    p_end_date: '2026-09-26',
    p_limit: 5
  });
});

test('financial reconciliation validates filters and pagination', async () => {
  let args;
  const router = createRouter({
    rpc: async (name, parameters) => {
      assert.equal(name, 'get_financial_reconciliation');
      args = parameters;
      return {
        data: {
          total_count: 1,
          rows: [{
            order_id: 1,
            payment_status: '已付清',
            shipping_status: '已出貨',
            items: []
          }]
        },
        error: null
      };
    }
  });

  await withServer(router, async baseUrl => {
    const response = await request(
      baseUrl,
      '/api/analytics/reconciliation?start_date=2026-09-01&end_date=2026-09-26&payment_status=%E5%B7%B2%E4%BB%98%E6%B8%85&shipping_status=%E5%B7%B2%E5%87%BA%E8%B2%A8&limit=20&offset=40'
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.data.total_count, 1);

    for (const query of [
      '&payment_status=unknown',
      '&shipping_status=unknown',
      '&limit=101',
      '&offset=-1',
      '&offset=1.5',
      '&offset=2147483648'
    ]) {
      const invalid = await request(
        baseUrl,
        `/api/analytics/reconciliation?start_date=2026-09-01&end_date=2026-09-26${query}`
      );
      assert.equal(invalid.status, 400);
    }
  });

  assert.deepEqual(args, {
    p_start_date: '2026-09-01',
    p_end_date: '2026-09-26',
    p_payment_status: '已付清',
    p_shipping_status: '已出貨',
    p_limit: 20,
    p_offset: 40
  });
});

test('admin token and service role are enforced before report queries', async () => {
  let rpcCalls = 0;
  const router = createRouter({
    rpc: async () => {
      rpcCalls += 1;
      return { data: [], error: null };
    }
  });

  await withServer(router, async baseUrl => {
    const unauthorized = await request(
      baseUrl,
      '/api/analytics/top-products?start_date=2026-09-01&end_date=2026-09-26',
      'incorrect'
    );
    assert.equal(unauthorized.status, 401);

    const unavailable = createAnalyticsRouter({ rpc: async () => ({ data: [], error: null }) }, {
      adminToken: ADMIN_TOKEN,
      readEnabled: false
    });
    await withServer(unavailable, async unavailableUrl => {
      const response = await request(
        unavailableUrl,
        '/api/analytics/top-products?start_date=2026-09-01&end_date=2026-09-26'
      );
      assert.equal(response.status, 503);
    });
  });

  assert.equal(rpcCalls, 0);
});

test('Supabase errors and malformed RPC responses are explicit', async () => {
  await withServer(createRouter({
    rpc: async () => ({ data: null, error: { code: 'PGRST202' } })
  }), async baseUrl => {
    const response = await request(
      baseUrl,
      '/api/analytics/overview?start_date=2026-09-01&end_date=2026-09-26'
    );
    assert.equal(response.status, 503);
    assert.equal(response.body.success, false);
  });

  await withServer(createRouter({
    rpc: async () => ({ data: null, error: { code: 'XX000' } })
  }), async baseUrl => {
    const response = await request(
      baseUrl,
      '/api/analytics/overview?start_date=2026-09-01&end_date=2026-09-26'
    );
    assert.equal(response.status, 500);
    assert.equal(response.body.success, false);
  });

  await withServer(createRouter({
    rpc: async () => ({ data: [], error: null })
  }), async baseUrl => {
    const response = await request(
      baseUrl,
      '/api/analytics/overview?start_date=2026-09-01&end_date=2026-09-26'
    );
    assert.equal(response.status, 500);
    assert.equal(response.body.success, false);
  });
});
