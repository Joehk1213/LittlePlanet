'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const {
  calculateShippingFee,
  normalizeProductId,
  validateShippingData,
} = require('../src/utils/calculate-shipping');
const { parseCsv } = require('../src/utils/product-csv');
const createOrdersRouter = require('../src/routes/orders');
const {
  formatReport,
  inspectExpiredPreorders,
  run: runAutoClose,
} = require('../scripts/g-preorder-auto-close');

const SHIPPING_MIGRATION = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20261031000200_shipping_fee_pickup.sql'),
  'utf8'
);
const AUTOCLOSE_MIGRATION = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20261031000100_preorder_auto_close.sql'),
  'utf8'
);

function catalogWithWeight(weight) {
  return {
    headers: ['id', 'weight'],
    missing: false,
    records: [{ id: '4268', weight: String(weight) }],
  };
}

async function withCheckoutServer(router, run) {
  const app = express();
  const logs = [];
  app.use((req, res, next) => {
    req.log = Object.fromEntries(['error', 'info', 'warn'].map(level => [
      level,
      (...args) => logs.push({ level, args }),
    ]));
    next();
  });
  app.use(express.json());
  app.use('/api/orders', router);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`, logs);
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
}

async function postCheckout(url, body) {
  const response = await fetch(`${url}/api/orders/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idempotency_key: '2a0d4f4c-9d99-4c93-8a74-28ecff9d67a1',
      customer: { phone: '+85212345678', name: '測試顧客' },
      items: [{ product_id: '4268', qty: 1 }],
      ...body,
    }),
  });
  return { status: response.status, body: await response.json() };
}

test('shipping fee is zero for a selected pickup location even without weight data', () => {
  assert.equal(calculateShippingFee(
    [{ product_id: '4268', quantity: 1 }],
    'branch-1',
    { missing: true },
  ), 0);
});

test('shipping fee applies the up-to-5kg tier', () => {
  assert.equal(calculateShippingFee(
    [{ product_id: '4268', quantity: 1 }],
    null,
    catalogWithWeight(5),
  ), 30);
});

test('shipping fee applies the over-5kg tier', () => {
  assert.equal(calculateShippingFee(
    [{ product_id: '4268', quantity: 1 }],
    null,
    catalogWithWeight(5.01),
  ), 50);
});

test('shipping fee applies the up-to-10kg tier to combined item weight', () => {
  assert.equal(calculateShippingFee(
    [{ product_id: '4268', quantity: 2 }],
    null,
    catalogWithWeight(5),
  ), 50);
});

test('shipping fee applies the over-10kg tier', () => {
  assert.equal(calculateShippingFee(
    [{ product_id: '4268', quantity: 3 }],
    null,
    catalogWithWeight(3.34),
  ), 80);
});

test('shipping calculator reports insufficient data when the weight column is missing', () => {
  const warnings = [];
  const fee = calculateShippingFee(
    [{ product_id: '4268', quantity: 1 }],
    null,
    { headers: ['id', 'price'], records: [], missing: false },
    { warn: (...args) => warnings.push(args) },
  );
  assert.equal(fee, null);
  assert.equal(warnings[0][0].reason, 'weight_column_missing');
  assert.equal(warnings[0][1], '資料不足');
});

test('shipping calculator reports insufficient data when the catalog is unavailable', () => {
  assert.equal(calculateShippingFee(
    [{ product_id: '4268', quantity: 1 }],
    null,
    { missing: true, headers: [], records: [] },
  ), null);
});

test('shipping calculator rejects a product without a valid weight instead of inventing one', () => {
  assert.equal(calculateShippingFee(
    [{ product_id: '4268', quantity: 1 }],
    null,
    { headers: ['id', 'weight'], records: [{ id: '4268', weight: '' }] },
  ), null);
});

test('shipping calculator rejects product IDs outside the verified bigint catalog range', () => {
  assert.equal(normalizeProductId('4268'), '4268');
  assert.equal(normalizeProductId('4294'), '4294');
  assert.equal(normalizeProductId('4267'), null);
  assert.equal(normalizeProductId('4295'), null);
});

test('shipping input accepts an optional pickup location and valid nonnegative fee', () => {
  assert.deepEqual(validateShippingData({
    pickup_location_id: 'branch-1',
    shipping_fee: 0,
  }).values, {
    pickup_location_id: 'branch-1',
    pickup_slot: null,
    shipping_fee: 0,
  });
});

test('shipping input normalizes a timezone-aware pickup slot', () => {
  const result = validateShippingData({
    pickup_location_id: 'branch-1',
    pickup_slot: '2026-10-30T12:00:00+08:00',
  });
  assert.equal(result.values.pickup_slot, '2026-10-30T04:00:00.000Z');
});

test('shipping input rejects a negative fee', () => {
  assert.match(validateShippingData({ shipping_fee: -1 }).error, /shipping_fee/);
});

test('shipping input rejects nonnumeric fees and invalid pickup locations', () => {
  assert.ok(validateShippingData({ shipping_fee: '30' }).error);
  assert.ok(validateShippingData({ pickup_location_id: { id: 'branch-1' } }).error);
});

test('pickup slot requires a location and must include a valid timezone', () => {
  assert.ok(validateShippingData({ pickup_slot: '2026-10-30T12:00:00' }).error);
  assert.ok(validateShippingData({
    pickup_location_id: 'branch-1',
    pickup_slot: 'not-a-date+08:00',
  }).error);
  assert.ok(validateShippingData({ pickup_slot: '2026-10-30T12:00:00Z' }).error);
});

test('CSV parser preserves commas and escaped quotes in product names', () => {
  const parsed = parseCsv('id,name,weight\r\n4268,"商品, ""特別版""",2.5\r\n');
  assert.equal(parsed.records[0].name, '商品, "特別版"');
  assert.equal(parsed.records[0].weight, '2.5');
});

test('CSV parser preserves newlines inside quoted product descriptions', () => {
  const parsed = parseCsv('id,description\n4268,"第一行\n第二行"\n');
  assert.equal(parsed.records[0].description, '第一行\n第二行');
});

test('auto-close dry-run identifies expired preorders using only the existing status', () => {
  const result = inspectExpiredPreorders({
    missing: false,
    headers: ['id', 'name', 'preorder_deadline', 'status'],
    records: [{
      id: '4268',
      name: '預購商品',
      preorder_deadline: '2026-10-29T00:00:00Z',
      status: '預購中',
    }],
  }, new Date('2026-10-30T00:00:00Z'));
  assert.equal(result.expired.length, 1);
  assert.equal(result.expired[0].nextStatus, '已下架');
  assert.equal(result.dataInsufficient, false);
});

test('auto-close dry-run excludes future and unsupported-status products', () => {
  const result = inspectExpiredPreorders({
    missing: false,
    headers: ['id', 'preorder_deadline', 'status'],
    records: [
      { id: '4268', preorder_deadline: '2026-11-01T00:00:00Z', status: '預購中' },
      { id: '4269', preorder_deadline: '2026-10-29T00:00:00Z', status: 'preorder' },
    ],
  }, new Date('2026-10-30T00:00:00Z'));
  assert.equal(result.expired.length, 0);
  assert.equal(result.unsupportedStatus, 1);
});

test('auto-close dry-run reports missing cutoff dates as insufficient data', () => {
  const result = inspectExpiredPreorders({
    missing: false,
    headers: ['id', 'preorder_deadline', 'status'],
    records: [{ id: '4268', preorder_deadline: '', status: '預購中' }],
  }, new Date('2026-10-30T00:00:00Z'));
  assert.equal(result.expired.length, 0);
  assert.equal(result.dataInsufficient, true);
});

test('auto-close report explains when there are no eligible products', () => {
  const report = formatReport(
    { missing: false, headers: ['id', 'preorder_deadline'], records: [] },
    { expired: [], missingDeadline: 0, invalidRows: 0, unsupportedStatus: 0, dataInsufficient: true },
    'dry-run',
  );
  assert.match(report, /資料不足/);
  assert.match(report, /沒有符合條件的商品/);
});

test('auto-close real mode requires an explicitly injected mock client', async () => {
  await assert.rejects(runAutoClose({ mode: 'real' }), /mock Supabase client/);
});

test('auto-close real mode invokes only the mocked RPC and writes a report', async t => {
  const reportPath = path.join(os.tmpdir(), `g-autoclose-${process.pid}-${Date.now()}.md`);
  t.after(() => {
    if (fs.existsSync(reportPath)) {
      fs.unlinkSync(reportPath);
    }
  });
  let rpcCalls = 0;
  const result = await runAutoClose({
    mode: 'real',
    catalog: {
      missing: false,
      headers: ['id', 'preorder_deadline', 'status'],
      records: [],
    },
    mockedSupabaseClient: {
      async rpc(name) {
        assert.equal(name, 'close_expired_preorders');
        rpcCalls += 1;
        return { data: null, error: null };
      },
    },
    reportPath,
    logger: { info() {} },
  });
  assert.equal(rpcCalls, 1);
  assert.equal(fs.existsSync(result.reportPath), true);
  assert.match(fs.readFileSync(reportPath, 'utf8'), /mock RPC/);
});

test('checkout computes server-side weight fee and ignores a valid client fee', async () => {
  let rpcArgs;
  await withCheckoutServer(createOrdersRouter({
    async rpc(_name, args) {
      rpcArgs = args;
      return {
        data: {
          order_id: 'e1da0bac-9021-4e87-920b-2f5bf5381f32',
          order_number: 'LP-20261030-A1B2C3D4',
          total_amount: 55,
          shipping_fee: 30,
          items: [{ product_id: 4268, quantity: 1, unit_price: 25 }],
        },
        error: null,
      };
    },
  }, { shippingCatalog: catalogWithWeight(2) }), async (url, logs) => {
    const response = await postCheckout(url, { shipping_fee: 999 });
    assert.equal(response.status, 201);
    assert.equal(response.body.data.shipping_fee, 30);
    const logText = JSON.stringify(logs);
    assert.equal(logText.includes('+85212345678'), false);
    assert.ok(logs.some(log => log.level === 'warn' && log.args[0].field === 'shipping_fee'));
    assert.ok(logs.some(log => log.args[0].phone_suffix === '5678'));
  });
  assert.equal(rpcArgs.p_shipping_fee, 30);
  assert.equal(rpcArgs.p_pickup_location_id, null);
  assert.equal(rpcArgs.p_pickup_slot, null);
});

test('checkout forwards pickup location and slot and forces the fee to zero', async () => {
  let rpcArgs;
  await withCheckoutServer(createOrdersRouter({
    async rpc(_name, args) {
      rpcArgs = args;
      return {
        data: {
          order_id: 'e1da0bac-9021-4e87-920b-2f5bf5381f32',
          order_number: 'LP-20261030-A1B2C3D4',
          total_amount: 25,
          shipping_fee: 0,
          pickup_location_id: 'branch-1',
          pickup_slot: '2026-10-30T04:00:00.000Z',
          items: [],
        },
        error: null,
      };
    },
  }, { shippingCatalog: { missing: true } }), async url => {
    const response = await postCheckout(url, {
      pickup: '自取',
      pickup_location_id: 'branch-1',
      pickup_slot: '2026-10-30T12:00:00+08:00',
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.data.shipping_fee, 0);
    assert.equal(response.body.data.pickup_location_id, 'branch-1');
  });
  assert.equal(rpcArgs.p_shipping_fee, 0);
  assert.equal(rpcArgs.p_pickup_location_id, 'branch-1');
  assert.equal(rpcArgs.p_pickup_slot, '2026-10-30T04:00:00.000Z');
});

test('checkout rejects malformed shipping details before calling the RPC', async () => {
  let rpcCalls = 0;
  await withCheckoutServer(createOrdersRouter({
    async rpc() {
      rpcCalls += 1;
      return { data: null, error: null };
    },
  }, { shippingCatalog: catalogWithWeight(1) }), async url => {
    for (const invalid of [
      { shipping_fee: -1 },
      { pickup_location_id: 'branch-1', pickup_slot: 'not-a-date+08:00' },
      { pickup_slot: '2026-10-30T12:00:00Z' },
      { pickup_location_id: 5 },
    ]) {
      const response = await postCheckout(url, invalid);
      assert.equal(response.status, 400);
      assert.equal(response.body.success, false);
    }
  });
  assert.equal(rpcCalls, 0);
});

test('shipping migration persists fee and pickup data without changing payment or shipping state', () => {
  assert.match(SHIPPING_MIGRATION, /ADD COLUMN IF NOT EXISTS shipping_fee numeric\(10, 2\)/i);
  assert.match(SHIPPING_MIGRATION, /ADD COLUMN IF NOT EXISTS pickup_location_id text/i);
  assert.match(SHIPPING_MIGRATION, /ADD COLUMN IF NOT EXISTS pickup_slot timestamptz/i);
  assert.match(SHIPPING_MIGRATION, /total_amount = total_amount \+ v_shipping_fee/i);
  assert.match(SHIPPING_MIGRATION, /shipping_details_initialized/);
  assert.doesNotMatch(SHIPPING_MIGRATION, /SET\s+(?:payment_status|shipping_status)\s*=/i);
});

test('shipping checkout RPC remains service-role-only and retry-safe', () => {
  assert.match(SHIPPING_MIGRATION, /pg_advisory_xact_lock/);
  assert.match(SHIPPING_MIGRATION, /SHIPPING_IDEMPOTENCY_MISMATCH/);
  assert.match(
    SHIPPING_MIGRATION,
    /REVOKE ALL ON FUNCTION public\.create_customer_order\([\s\S]*?FROM PUBLIC, anon, authenticated/i,
  );
  assert.match(
    SHIPPING_MIGRATION,
    /GRANT EXECUTE ON FUNCTION public\.create_customer_order\([\s\S]*?TO service_role/i,
  );
});

test('preorder migration uses existing statuses and does not change order payment or shipping state', () => {
  assert.match(AUTOCLOSE_MIGRATION, /preorder_deadline < now\(\)/i);
  assert.match(AUTOCLOSE_MIGRATION, /status = '預購中'/);
  assert.match(AUTOCLOSE_MIGRATION, /SET status = '已下架'/);
  assert.doesNotMatch(AUTOCLOSE_MIGRATION, /'closed'|'preorder'/i);
  assert.doesNotMatch(AUTOCLOSE_MIGRATION, /UPDATE public\.orders/i);
  assert.match(
    AUTOCLOSE_MIGRATION,
    /REVOKE ALL ON FUNCTION public\.close_expired_preorders\(\)[\s\S]*?FROM PUBLIC, anon, authenticated/i,
  );
  assert.match(
    AUTOCLOSE_MIGRATION,
    /GRANT EXECUTE ON FUNCTION public\.close_expired_preorders\(\)[\s\S]*?TO service_role/i,
  );
});
