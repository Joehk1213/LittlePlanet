'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const createOrdersRouter = require('../src/routes/orders');
const createAdminOrdersRouter = require('../src/routes/admin/orders');
const normalizePhone = require('../src/utils/normalize-phone');
const normalizeProductId = require('../src/utils/normalize-product-id');
const { parseWhatsAppOrderMessage } = require('../src/utils/whatsapp-order-parser');
const {
  buildPaidReminderMessage,
  buildShippedMessage,
  buildUnpaidReminderMessage,
  notifyShippedOrder,
  sendWhatsAppNotification,
} = require('../src/utils/whatsapp-notify');
const {
  assertRealModeAllowed,
  classifyReminderCandidates,
  formatReminderReport,
  run: runReminder,
} = require('../scripts/h-whatsapp-reminder');

const ORDER_ID = 'e1da0bac-9021-4e87-920b-2f5bf5381f32';
const ORDER_NUMBER = 'LP-20261030-A1B2C3D4';
const FULL_PHONE = '+85212345678';
const NOW = new Date('2026-10-30T12:00:00.000Z');

function createLogger() {
  const entries = [];
  const logger = Object.fromEntries(['error', 'info', 'warn'].map(level => [
    level,
    (...args) => entries.push({ level, args }),
  ]));
  return { logger, entries };
}

function createStatusSupabase(options = {}) {
  const order = {
    order_id: ORDER_ID,
    order_number: ORDER_NUMBER,
    customer_phone: '85212345678',
    shipping_method: '順豐',
    shipping_fee: 30,
    pickup_location_id: null,
    tracking_number: 'TRACK-123',
    status: 'paid',
    payment_status: '已付清',
    shipping_status: '已出貨',
    ...options.order,
  };
  const calls = [];
  return {
    order,
    calls,
    async rpc(name, args) {
      calls.push({ type: 'rpc', name, args });
      if (options.rpcError) {
        return { data: null, error: options.rpcError };
      }
      order.status = args.p_status;
      return {
        data: { order_id: ORDER_ID, status: args.p_status },
        error: null,
      };
    },
    from(table) {
      assert.equal(table, 'orders');
      const query = {
        fields: '',
        selectedOrderId: null,
        select(fields) {
          query.fields = fields;
          return query;
        },
        eq(field, value) {
          assert.equal(field, 'order_id');
          query.selectedOrderId = value;
          return query;
        },
        async maybeSingle() {
          calls.push({ type: 'select', fields: query.fields });
          if (options.lookupError && query.fields.includes('shipping_fee')) {
            return { data: null, error: options.lookupError };
          }
          if (query.selectedOrderId !== order.order_id) {
            return { data: null, error: null };
          }
          if (options.missingOptionalColumns && query.fields.includes('shipping_fee')) {
            return { data: null, error: { code: '42703' } };
          }
          return { data: order, error: null };
        },
      };
      return query;
    },
  };
}

async function withRouter(router, run, prefix = '/api/admin/orders') {
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
  app.use(prefix, router);
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

async function patchStatus(url, status, prefix = '/api/admin/orders') {
  const response = await fetch(`${url}${prefix}/${ORDER_ID}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-session': 'valid',
    },
    body: JSON.stringify({ status }),
  });
  return { status: response.status, body: await response.json() };
}

function orderFixture(overrides = {}) {
  return {
    order_number: ORDER_NUMBER,
    customer_phone: FULL_PHONE,
    order_date: new Date(NOW.getTime() - 25 * 60 * 60 * 1000).toISOString(),
    payment_status: '未付款',
    shipping_status: '待到貨',
    status: 'pending',
    ...overrides,
  };
}

test('notification phone normalization reuses the shared normalize-phone utility', () => {
  assert.equal(normalizePhone(FULL_PHONE), '85212345678');
});

test('shared phone normalization rejects unsupported punctuation', () => {
  assert.equal(normalizePhone('852-12345678'), null);
});

test('existing product ID utility preserves PostgreSQL bigint validation', () => {
  assert.equal(normalizeProductId('4268'), '4268');
  assert.equal(normalizeProductId('9223372036854775807'), '9223372036854775807');
  assert.equal(normalizeProductId('9223372036854775808'), null);
});

test('shipped message contains official order number, fee, pickup and tracking details', () => {
  const message = buildShippedMessage({
    order_number: ORDER_NUMBER,
    shipping_fee: 30,
    pickup_location_id: 'branch-1',
    tracking_number: 'TRACK-123',
  });
  assert.match(message, new RegExp(ORDER_NUMBER));
  assert.match(message, /HK\$30\.00/);
  assert.match(message, /branch-1/);
  assert.match(message, /TRACK-123/);
});

test('shipped message uses delivery label when no pickup location is set', () => {
  assert.match(buildShippedMessage({ order_number: ORDER_NUMBER }), /自取／送貨：送貨/);
});

test('shipped message does not invent a shipping fee when the field is unavailable', () => {
  assert.match(buildShippedMessage({ order_number: ORDER_NUMBER }), /運費：HK\$資料不足/);
});

test('shipped message formats the database numeric fee when serialized as text', () => {
  assert.match(
    buildShippedMessage({ order_number: ORDER_NUMBER, shipping_fee: '30.00' }),
    /運費：HK\$30\.00/
  );
});

test('shipped message identifies pickup method without an unsupported location', () => {
  assert.match(
    buildShippedMessage({ order_number: ORDER_NUMBER, shipping_method: '自取' }),
    /自取（地點資料不足）/
  );
});

test('shipped message never includes the customer phone', () => {
  const message = buildShippedMessage({
    order_number: ORDER_NUMBER,
    customer_phone: FULL_PHONE,
    shipping_fee: 30,
  });
  assert.equal(message.includes(FULL_PHONE), false);
  assert.equal(message.includes('85212345678'), false);
});

test('shipped message does not fall back to internal UUID as a public order number', () => {
  const message = buildShippedMessage({ order_id: ORDER_ID, customer_phone: FULL_PHONE });
  assert.equal(message.includes(ORDER_ID), false);
  assert.match(message, /訂單 資料不足/);
});

test('paid reminder confirms paid state while avoiding an unsupported ready-to-ship claim', () => {
  const message = buildPaidReminderMessage({ order_number: ORDER_NUMBER });
  assert.match(message, /已付清/);
  assert.match(message, /取貨安排/);
  assert.match(message, /等候通知/);
});

test('paid reminder excludes customer phone and internal order UUID', () => {
  const message = buildPaidReminderMessage({
    order_number: ORDER_NUMBER,
    order_id: ORDER_ID,
    customer_phone: FULL_PHONE,
  });
  assert.equal(message.includes(FULL_PHONE), false);
  assert.equal(message.includes(ORDER_ID), false);
});

test('unpaid reminder preserves arrival-first payment and pre-shipment settlement policy', () => {
  const message = buildUnpaidReminderMessage({ order_number: ORDER_NUMBER });
  assert.match(message, /貨到後可安排付款/);
  assert.match(message, /出貨前需確認付清/);
});

test('unpaid reminder excludes full phone and internal UUID', () => {
  const message = buildUnpaidReminderMessage({
    order_number: ORDER_NUMBER,
    order_id: ORDER_ID,
    customer_phone: FULL_PHONE,
  });
  assert.equal(message.includes(FULL_PHONE), false);
  assert.equal(message.includes(ORDER_ID), false);
});

test('dry-run send returns only phone suffix and redacted preview', async () => {
  const { logger } = createLogger();
  const result = await sendWhatsAppNotification({
    phone: FULL_PHONE,
    message: `Order ${ORDER_NUMBER}; ${FULL_PHONE}`,
    dryRun: true,
    logger,
    env: { NODE_ENV: 'development', WHATSAPP_TOKEN: 'not-logged' },
  });
  assert.deepEqual(result, {
    ok: true,
    dryRun: true,
    phoneSuffix: '5678',
    messagePreview: `Order ${ORDER_NUMBER}; [電話已隱藏]`,
  });
});

test('dry-run never invokes an injected sender', async () => {
  let senderCalls = 0;
  const { logger } = createLogger();
  await sendWhatsAppNotification({
    phone: FULL_PHONE,
    message: '測試訊息',
    dryRun: true,
    sender: async () => { senderCalls += 1; },
    logger,
    env: { NODE_ENV: 'development', WHATSAPP_TOKEN: 'fake-token' },
  });
  assert.equal(senderCalls, 0);
});

test('missing WhatsApp token keeps notifications in mocked dry-run mode', async () => {
  let senderCalls = 0;
  const { logger } = createLogger();
  const result = await sendWhatsAppNotification({
    phone: FULL_PHONE,
    message: '未配置 API',
    sender: async () => { senderCalls += 1; },
    logger,
    env: { NODE_ENV: 'production' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(senderCalls, 0);
});

test('NODE_ENV test always prevents external WhatsApp calls', async () => {
  let senderCalls = 0;
  const { logger } = createLogger();
  const result = await sendWhatsAppNotification({
    phone: FULL_PHONE,
    message: '測試環境',
    dryRun: false,
    sender: async () => { senderCalls += 1; },
    serviceRoleAvailable: true,
    logger,
    env: {
      NODE_ENV: 'test',
      WHATSAPP_ENABLED: 'true',
      WHATSAPP_TOKEN: 'fake-token',
    },
  });
  assert.equal(result.dryRun, true);
  assert.equal(senderCalls, 0);
});

test('notification logs contain phone suffix but not full phone or message', async () => {
  const { logger, entries } = createLogger();
  await sendWhatsAppNotification({
    phone: FULL_PHONE,
    message: '敏感訊息內容',
    dryRun: true,
    logger,
    env: { NODE_ENV: 'development' },
  });
  const serialized = JSON.stringify(entries);
  assert.match(serialized, /5678/);
  assert.equal(serialized.includes(FULL_PHONE), false);
  assert.equal(serialized.includes('敏感訊息內容'), false);
});

test('invalid phone is rejected without calling the sender', async () => {
  let senderCalls = 0;
  const { logger } = createLogger();
  const result = await sendWhatsAppNotification({
    phone: '852-12345678',
    message: '測試',
    sender: async () => { senderCalls += 1; },
    logger,
  });
  assert.equal(result.ok, false);
  assert.equal(result.phoneSuffix, null);
  assert.equal(senderCalls, 0);
});

test('empty notification messages are rejected explicitly', async () => {
  const { logger } = createLogger();
  const result = await sendWhatsAppNotification({
    phone: FULL_PHONE,
    message: ' ',
    logger,
  });
  assert.equal(result.ok, false);
});

test('oversized notification messages are rejected explicitly', async () => {
  const { logger } = createLogger();
  const result = await sendWhatsAppNotification({
    phone: FULL_PHONE,
    message: 'x'.repeat(4097),
    logger,
  });
  assert.equal(result.ok, false);
});

test('real sender is invoked only with production flags and an injected mock sender', async () => {
  let request;
  const { logger } = createLogger();
  const result = await sendWhatsAppNotification({
    phone: FULL_PHONE,
    message: '可控 mock',
    dryRun: false,
    sender: async value => { request = value; },
    serviceRoleAvailable: true,
    logger,
    env: {
      NODE_ENV: 'production',
      WHATSAPP_ENABLED: 'true',
      WHATSAPP_TOKEN: 'fake-token',
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, false);
  assert.deepEqual(request, { to: '85212345678', text: '可控 mock' });
});

test('real send is blocked in Development even when credentials are present', async () => {
  const { logger } = createLogger();
  await assert.rejects(sendWhatsAppNotification({
    phone: FULL_PHONE,
    message: '不得發送',
    dryRun: false,
    sender: async () => assert.fail('sender must not be called'),
    serviceRoleAvailable: true,
    logger,
    env: {
      NODE_ENV: 'development',
      WHATSAPP_ENABLED: 'true',
      WHATSAPP_TOKEN: 'fake-token',
    },
  }), /WhatsApp real send disabled in Development/);
});

test('real send requires explicit WhatsApp enablement', async () => {
  const { logger } = createLogger();
  await assert.rejects(sendWhatsAppNotification({
    phone: FULL_PHONE,
    message: '開關未設定',
    dryRun: false,
    sender: async () => assert.fail('sender must not be called'),
    serviceRoleAvailable: true,
    logger,
    env: { NODE_ENV: 'production', WHATSAPP_TOKEN: 'fake-token' },
  }), /WhatsApp real send disabled in Development/);
});

test('real send requires service-role availability', async () => {
  const { logger } = createLogger();
  await assert.rejects(sendWhatsAppNotification({
    phone: FULL_PHONE,
    message: '權限未設定',
    dryRun: false,
    sender: async () => assert.fail('sender must not be called'),
    serviceRoleAvailable: false,
    logger,
    env: {
      NODE_ENV: 'production',
      WHATSAPP_ENABLED: 'true',
      WHATSAPP_TOKEN: 'fake-token',
    },
  }), /WhatsApp real send disabled in Development/);
});

test('real send refuses an unconfigured sender', async () => {
  const { logger } = createLogger();
  await assert.rejects(sendWhatsAppNotification({
    phone: FULL_PHONE,
    message: '缺少 sender',
    dryRun: false,
    serviceRoleAvailable: true,
    logger,
    env: {
      NODE_ENV: 'production',
      WHATSAPP_ENABLED: 'true',
      WHATSAPP_TOKEN: 'fake-token',
    },
  }), /sender is not configured/);
});

test('sender failures are sanitized and logged without message or phone', async () => {
  const { logger, entries } = createLogger();
  await assert.rejects(sendWhatsAppNotification({
    phone: FULL_PHONE,
    message: 'PRIVATE MESSAGE',
    dryRun: false,
    sender: async () => { throw Object.assign(new Error('private response body'), { code: 'EFAIL' }); },
    serviceRoleAvailable: true,
    logger,
    env: {
      NODE_ENV: 'production',
      WHATSAPP_ENABLED: 'true',
      WHATSAPP_TOKEN: 'fake-token',
    },
  }), /^Error: WhatsApp notification failed\.$/);
  const serialized = JSON.stringify(entries);
  assert.match(serialized, /EFAIL/);
  assert.equal(serialized.includes(FULL_PHONE), false);
  assert.equal(serialized.includes('PRIVATE MESSAGE'), false);
  assert.equal(serialized.includes('private response body'), false);
});

test('shipped order lookup calls injected notifier with safe message and phone', async () => {
  const { logger } = createLogger();
  const supabase = createStatusSupabase();
  let notification;
  const result = await notifyShippedOrder({
    supabase,
    orderId: ORDER_ID,
    logger,
    env: { NODE_ENV: 'test' },
    notifier: async value => {
      notification = value;
      return { ok: true, dryRun: true, phoneSuffix: '5678', messagePreview: '' };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(notification.phone, '85212345678');
  assert.match(notification.message, new RegExp(ORDER_NUMBER));
  assert.equal(notification.message.includes(FULL_PHONE), false);
});

test('shipped notification retries lookup without optional G shipping fields', async () => {
  const { logger, entries } = createLogger();
  const supabase = createStatusSupabase({ missingOptionalColumns: true });
  let message;
  await notifyShippedOrder({
    supabase,
    orderId: ORDER_ID,
    logger,
    env: { NODE_ENV: 'test' },
    notifier: async value => {
      message = value.message;
      return { ok: true };
    },
  });
  assert.match(message, /運費：HK\$資料不足/);
  assert.ok(entries.some(entry => entry.level === 'warn'));
});

test('order lookup database errors are sanitized and do not throw', async () => {
  const { logger, entries } = createLogger();
  const result = await notifyShippedOrder({
    supabase: createStatusSupabase({
      lookupError: { code: 'XX000', message: 'private database details' },
    }),
    orderId: ORDER_ID,
    logger,
    env: { NODE_ENV: 'test' },
  });
  assert.equal(result.ok, false);
  const serialized = JSON.stringify(entries);
  assert.match(serialized, /XX000/);
  assert.equal(serialized.includes('private database details'), false);
  assert.equal(serialized.includes(FULL_PHONE), false);
});

test('missing order lookup skips notification safely', async () => {
  const { logger } = createLogger();
  const supabase = createStatusSupabase();
  let called = false;
  const result = await notifyShippedOrder({
    supabase,
    orderId: '00000000-0000-4000-8000-000000000000',
    logger,
    notifier: async () => { called = true; },
    env: { NODE_ENV: 'test' },
  });
  assert.equal(result.ok, false);
  assert.equal(called, false);
});

test('reminder report marks absent order data as insufficient', () => {
  const result = classifyReminderCandidates(undefined, NOW);
  assert.equal(result.dataInsufficient, true);
  assert.equal(result.unpaid.length + result.paid.length + result.shipped.length, 0);
  assert.match(formatReminderReport(result), /資料不足/);
});

test('an explicit empty mock order list is a valid zero-candidate dataset', () => {
  const result = classifyReminderCandidates([], NOW);
  assert.equal(result.dataInsufficient, false);
  assert.equal(result.invalid, 0);
});

test('unpaid reminder candidate requires strictly more than 24 hours', () => {
  const exactly24Hours = orderFixture({
    order_date: new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString(),
  });
  assert.equal(classifyReminderCandidates([exactly24Hours], NOW).unpaid.length, 0);
});

test('unpaid reminder candidate includes an order older than 24 hours', () => {
  const result = classifyReminderCandidates([orderFixture()], NOW);
  assert.equal(result.unpaid.length, 1);
  assert.equal(result.unpaid[0].phone_suffix, '5678');
});

test('unpaid reminder does not select paid orders', () => {
  const result = classifyReminderCandidates([orderFixture({
    status: 'paid',
    payment_status: '已付清',
  })], NOW);
  assert.equal(result.unpaid.length, 0);
});

test('paid reminder candidate requires strictly more than 48 hours', () => {
  const order = orderFixture({
    status: 'paid',
    payment_status: '已付清',
    order_date: new Date(NOW.getTime() - 48 * 60 * 60 * 1000).toISOString(),
  });
  assert.equal(classifyReminderCandidates([order], NOW).paid.length, 0);
});

test('paid reminder candidate includes orders unpaid neither by payment nor shipment', () => {
  const result = classifyReminderCandidates([orderFixture({
    status: 'paid',
    payment_status: '已付清',
    order_date: new Date(NOW.getTime() - 49 * 60 * 60 * 1000).toISOString(),
  })], NOW);
  assert.equal(result.paid.length, 1);
});

test('paid reminder excludes orders without verified full payment', () => {
  const result = classifyReminderCandidates([orderFixture({
    status: 'paid',
    payment_status: '已付訂金',
    order_date: new Date(NOW.getTime() - 60 * 60 * 60 * 1000).toISOString(),
  })], NOW);
  assert.equal(result.paid.length, 0);
});

test('shipped reminder candidate requires strictly more than 72 hours after shipped_at', () => {
  const order = orderFixture({
    status: 'shipped',
    shipping_status: '已出貨',
    shipped_at: new Date(NOW.getTime() - 72 * 60 * 60 * 1000).toISOString(),
  });
  assert.equal(classifyReminderCandidates([order], NOW).shipped.length, 0);
});

test('shipped reminder candidate includes orders older than 72 hours', () => {
  const order = orderFixture({
    status: 'shipped',
    shipping_status: '已出貨',
    shipped_at: new Date(NOW.getTime() - 73 * 60 * 60 * 1000).toISOString(),
  });
  const result = classifyReminderCandidates([order], NOW);
  assert.equal(result.shipped.length, 1);
  assert.equal(result.shipped[0].phone_suffix, '5678');
});

test('shipped reminder reports insufficient data when shipped_at is unavailable', () => {
  const result = classifyReminderCandidates([orderFixture({
    status: 'shipped',
    shipping_status: '已出貨',
  })], NOW);
  assert.equal(result.shipped.length, 0);
  assert.equal(result.insufficient, 1);
  assert.equal(result.dataInsufficient, true);
});

test('future order timestamps are rejected as insufficient instead of producing reminders', () => {
  const result = classifyReminderCandidates([orderFixture({
    order_date: new Date(NOW.getTime() + 1000).toISOString(),
  })], NOW);
  assert.equal(result.unpaid.length, 0);
  assert.equal(result.insufficient, 1);
});

test('reminder list rejects invalid phone and missing official order number', () => {
  const result = classifyReminderCandidates([
    orderFixture({ customer_phone: 'bad' }),
    orderFixture({ order_number: '' }),
  ], NOW);
  assert.equal(result.invalid, 2);
  assert.equal(result.unpaid.length, 0);
});

test('reminder output contains phone suffix and never the full phone', () => {
  const result = classifyReminderCandidates([orderFixture()], NOW);
  const report = formatReminderReport(result);
  assert.match(report, /電話尾碼 5678/);
  assert.equal(report.includes(FULL_PHONE), false);
  assert.equal(report.includes('85212345678'), false);
});

test('reminder report clearly states no candidates in each category', () => {
  const report = formatReminderReport(classifyReminderCandidates([], NOW));
  assert.equal((report.match(/沒有符合條件的訂單/g) || []).length, 3);
});

test('reminder script writes a dry-run report from injected orders', async t => {
  const reportPath = path.join(os.tmpdir(), `h-reminders-${process.pid}-${Date.now()}.md`);
  t.after(() => {
    if (fs.existsSync(reportPath)) {
      fs.unlinkSync(reportPath);
    }
  });
  const result = await runReminder({
    orders: [orderFixture()],
    now: NOW,
    reportPath,
    logger: createLogger().logger,
  });
  assert.equal(result.unpaid.length, 1);
  assert.match(fs.readFileSync(reportPath, 'utf8'), /電話尾碼 5678/);
  assert.equal(fs.readFileSync(reportPath, 'utf8').includes(FULL_PHONE), false);
});

test('real reminder mode is disabled in Development', async () => {
  await assert.rejects(runReminder({
    mode: 'real',
    orders: [],
    serviceRoleAvailable: true,
    env: { NODE_ENV: 'development', WHATSAPP_ENABLED: 'true' },
    logger: createLogger().logger,
  }), /WhatsApp real send disabled in Development/);
});

test('real mode gate requires explicit enablement and service-role availability', () => {
  assert.throws(
    () => assertRealModeAllowed({ NODE_ENV: 'production', WHATSAPP_ENABLED: 'true' }, false),
    /WhatsApp real send disabled in Development/
  );
  assert.throws(
    () => assertRealModeAllowed({ NODE_ENV: 'production' }, true),
    /WhatsApp real send disabled in Development/
  );
  assert.doesNotThrow(
    () => assertRealModeAllowed({ NODE_ENV: 'production', WHATSAPP_ENABLED: 'true' }, true)
  );
});

test('existing WhatsApp parser is reused for uniquely matched product codes', () => {
  const parsed = parseWhatsAppOrderMessage('Ｂ款 x 2', [
    { product_code: 'B款', id: 4268, status: '旅購中' },
  ]);
  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.data.items, [{ product_code: 'B款', quantity: 2 }]);
});

test('existing parser rejects unknown and ambiguous WhatsApp product codes', () => {
  const unknown = parseWhatsAppOrderMessage('Z x 1', [{ product_code: 'B款' }]);
  const ambiguous = parseWhatsAppOrderMessage('B x 1', [
    { product_code: 'B' },
    { product_code: 'ｂ' },
  ]);
  assert.equal(unknown.error.code, 'PRODUCT_NOT_FOUND');
  assert.equal(ambiguous.error.code, 'AMBIGUOUS_PRODUCT_CODE');
});

test('legacy orders status endpoint sends a dry-run notification after shipped transition', async () => {
  const supabase = createStatusSupabase();
  let notificationCount = 0;
  await withRouter(createOrdersRouter(supabase, {
    serviceRoleAvailable: true,
    isSessionAuthorized: () => true,
    env: { NODE_ENV: 'test' },
    sendWhatsAppNotification: async payload => {
      notificationCount += 1;
      assert.equal(payload.phone, '85212345678');
      assert.match(payload.message, new RegExp(ORDER_NUMBER));
      return { ok: true, dryRun: true };
    },
  }), async (url, logs) => {
    const response = await patchStatus(url, 'shipped', '/api/orders/admin/orders');
    assert.equal(response.status, 200);
    assert.equal(response.body.data.status, 'shipped');
    assert.equal(JSON.stringify(logs).includes(FULL_PHONE), false);
  }, '/api/orders');
  assert.equal(notificationCount, 1);
  assert.equal(supabase.order.status, 'shipped');
});

test('legacy status transition remains successful when WhatsApp notification fails', async () => {
  const supabase = createStatusSupabase();
  await withRouter(createOrdersRouter(supabase, {
    serviceRoleAvailable: true,
    isSessionAuthorized: () => true,
    sendWhatsAppNotification: async () => { throw new Error('private provider details'); },
  }), async url => {
    const response = await patchStatus(url, 'shipped', '/api/orders/admin/orders');
    assert.equal(response.status, 200);
    assert.equal(response.body.data.status, 'shipped');
  }, '/api/orders');
  assert.equal(supabase.order.status, 'shipped');
});

test('admin orders status endpoint sends a notification after shipped transition', async () => {
  const supabase = createStatusSupabase();
  let notificationCount = 0;
  await withRouter(createAdminOrdersRouter(supabase, {
    serviceRoleAvailable: true,
    isSessionAuthorized: () => true,
    env: { NODE_ENV: 'test' },
    sendWhatsAppNotification: async payload => {
      notificationCount += 1;
      assert.equal(payload.phone, '85212345678');
      assert.match(payload.message, /運費：HK\$30\.00/);
      return { ok: true, dryRun: true };
    },
  }), async url => {
    const response = await patchStatus(url, 'shipped');
    assert.equal(response.status, 200);
    assert.equal(response.body.data.status, 'shipped');
  });
  assert.equal(notificationCount, 1);
});

test('admin status success is not blocked by a failed notification', async () => {
  const supabase = createStatusSupabase();
  await withRouter(createAdminOrdersRouter(supabase, {
    serviceRoleAvailable: true,
    isSessionAuthorized: () => true,
    sendWhatsAppNotification: async () => { throw new Error('private provider details'); },
  }), async url => {
    const response = await patchStatus(url, 'shipped');
    assert.equal(response.status, 200);
  });
  assert.equal(supabase.order.status, 'shipped');
});

test('admin transition to paid does not send a shipped notification', async () => {
  const supabase = createStatusSupabase();
  let notificationCount = 0;
  await withRouter(createAdminOrdersRouter(supabase, {
    serviceRoleAvailable: true,
    isSessionAuthorized: () => true,
    sendWhatsAppNotification: async () => { notificationCount += 1; },
  }), async url => {
    const response = await patchStatus(url, 'paid');
    assert.equal(response.status, 200);
  });
  assert.equal(notificationCount, 0);
});

test('failed status transition does not send a notification', async () => {
  const supabase = createStatusSupabase({
    rpcError: { code: 'P0001', message: 'private transition detail' },
  });
  let notificationCount = 0;
  await withRouter(createAdminOrdersRouter(supabase, {
    serviceRoleAvailable: true,
    isSessionAuthorized: () => true,
    sendWhatsAppNotification: async () => { notificationCount += 1; },
  }), async url => {
    const response = await patchStatus(url, 'shipped');
    assert.equal(response.status, 409);
  });
  assert.equal(notificationCount, 0);
});

test('status route lookup failure does not alter successful transition response', async () => {
  const supabase = createStatusSupabase({
    lookupError: { code: 'XX000', message: 'private database response' },
  });
  await withRouter(createAdminOrdersRouter(supabase, {
    serviceRoleAvailable: true,
    isSessionAuthorized: () => true,
  }), async url => {
    const response = await patchStatus(url, 'shipped');
    assert.equal(response.status, 200);
  });
  assert.equal(supabase.order.status, 'shipped');
});

test('admin order list returns explicit insufficient-data values when shipping columns are absent', async () => {
  const order = {
    order_id: ORDER_ID,
    order_number: ORDER_NUMBER,
    customer_phone: '85212345678',
    customer_name: '測試顧客',
    shipping_address: null,
    total_amount: 25,
    order_date: NOW.toISOString(),
    status: 'pending',
    payment_status: '未付款',
    payment_proof_url: null,
    payment_proof_status: 'pending',
    shipping_status: '待到貨',
    shipping_method: null,
    shipping_carrier: null,
    tracking_number: null,
  };
  const supabase = {
    from(table) {
      let fields = '';
      const query = {
        select(value) {
          fields = value;
          return query;
        },
        order() { return query; },
        range() { return query; },
        in() { return query; },
        limit() { return query; },
        then(resolve, reject) {
          let result;
          if (table === 'orders' && fields.includes('shipping_fee')) {
            result = { data: null, error: { code: '42703', message: 'schema details' } };
          } else if (table === 'orders') {
            result = { data: [order], error: null, count: 1 };
          } else {
            result = { data: [], error: null };
          }
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return query;
    },
    rpc: async () => ({ data: null, error: null }),
  };

  await withRouter(createAdminOrdersRouter(supabase, {
    serviceRoleAvailable: true,
    isSessionAuthorized: () => true,
  }), async url => {
    const response = await fetch(`${url}/api/admin/orders`, {
      headers: { 'x-admin-session': 'valid' },
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.data.orders[0].shipping_fee, null);
    assert.equal(body.data.orders[0].pickup_location_id, null);
    assert.equal(body.data.orders[0].shipping_details_message, '資料不足');
  });
});
