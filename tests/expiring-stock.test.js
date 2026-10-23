'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const createInboundRouter = require('../routes/inbound');

const ADMIN_TOKEN = '0123456789abcdef0123456789abcdef';
const TODAY = '2026-10-22';

async function withServer(supabase, run, options = {}) {
  const app = express();
  app.use('/api/inbound', createInboundRouter(supabase, {
    adminToken: ADMIN_TOKEN,
    writeEnabled: true,
    now: () => new Date('2026-10-22T04:00:00.000Z'),
    isSessionAuthorized: (req, token, scope) => (
      token === ADMIN_TOKEN &&
      scope === 'inbound' &&
      req.get('x-admin-session') === 'valid'
    ),
    ...options
  }));
  app.use((error, req, res, next) => {
    res.status(error.status || 500).json({
      success: false,
      data: null,
      message: '請求處理失敗。'
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

function createSupabase(batches, products, options = {}) {
  return {
    from(table) {
      let filters = [];
      let selectedTable = table;
      const query = {
        select() {
          return query;
        },
        gt(field, value) {
          filters.push(row => row[field] > value);
          return query;
        },
        not(field, operator, value) {
          assert.equal(operator, 'is');
          assert.equal(value, null);
          filters.push(row => row[field] !== null && row[field] !== undefined);
          return query;
        },
        lte(field, value) {
          filters.push(row => row[field] <= value);
          return query;
        },
        order() {
          return query;
        },
        limit() {
          return query;
        },
        in(field, values) {
          filters.push(row => values.includes(row[field]));
          return query;
        },
        async maybeSingle() {
          return { data: null, error: options.error || null };
        },
        then(resolve, reject) {
          if (options.error) {
            return Promise.resolve({ data: null, error: options.error }).then(resolve, reject);
          }
          const rows = selectedTable === 'product_stock_batches' ? batches : products;
          return Promise.resolve({
            data: rows.filter(row => filters.every(filter => filter(row))),
            error: null
          }).then(resolve, reject);
        }
      };
      return query;
    }
  };
}

test('expiring stock alerts include all expired and next-30-day batches with remaining stock', async () => {
  const supabase = createSupabase([
    { batch_id: 1, product_id: 9, quantity_remaining: 3, best_before_date: '2026-10-01' },
    { batch_id: 2, product_id: 9, quantity_remaining: 2, best_before_date: '2026-11-10' },
    { batch_id: 3, product_id: 10, quantity_remaining: 1, best_before_date: '2026-11-22' },
    { batch_id: 4, product_id: 10, quantity_remaining: 0, best_before_date: '2026-10-30' },
    { batch_id: 5, product_id: 10, quantity_remaining: 4, best_before_date: null }
  ], [
    { id: 9, name: '小行星曲奇' },
    { id: 10, product_name: '星球軟糖' }
  ]);
  await withServer(supabase, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/inbound/expiring`, {
      headers: { 'x-admin-session': 'valid' }
    });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.success, true);
    assert.equal(result.data.today, TODAY);
    assert.equal(result.data.through_date, '2026-11-21');
    assert.deepEqual(result.data.alerts.map(alert => alert.batch_id), [1, 2]);
    assert.equal(result.data.alerts[0].is_expired, true);
    assert.equal(result.data.alerts[0].product_name, '小行星曲奇');
    assert.equal(result.data.alerts[1].is_expired, false);
  });
});

test('expiring stock alerts require inbound authorization and report database errors', async () => {
  const supabase = createSupabase([], [], { error: { message: 'private database detail' } });
  await withServer(supabase, async baseUrl => {
    const denied = await fetch(`${baseUrl}/api/inbound/expiring`);
    assert.equal(denied.status, 401);

    const failed = await fetch(`${baseUrl}/api/inbound/expiring`, {
      headers: { 'x-admin-session': 'valid' }
    });
    const result = await failed.json();
    assert.equal(failed.status, 500);
    assert.equal(result.success, false);
    assert.doesNotMatch(result.message, /private database detail/);
  });
});
