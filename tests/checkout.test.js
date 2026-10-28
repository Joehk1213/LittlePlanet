'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
require('dotenv').config();
const normalizePhone = require('../src/utils/normalize-phone');
const normalizeProductId = require('../src/utils/normalize-product-id');

const supabaseUrl =
  process.env.CHECKOUT_RLS_TEST_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseAnonKey =
  process.env.CHECKOUT_RLS_TEST_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const IDEMPOTENCY_KEY = '2a0d4f4c-9d99-4c93-8a74-28ecff9d67a1';

function isLocalSupabaseUrl(value) {
  if (!value) {
    return false;
  }
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}

test('checkout client sends phone-based bigint items to the backend without Supabase access', async () => {
  assert.equal(normalizePhone(' +85212345678 '), '85212345678');
  assert.equal(normalizePhone('852-12345678'), null);
  assert.equal(normalizePhone('1234567'), null);
  assert.equal(normalizeProductId('4268'), '4268');
  assert.equal(normalizeProductId('9223372036854775807'), '9223372036854775807');
  assert.equal(normalizeProductId('9223372036854775808'), null);
  assert.equal(normalizeProductId(Number.MAX_SAFE_INTEGER + 1), null);

  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'checkout.js'),
    'utf8'
  );
  assert.equal(/createClient|SUPABASE_SERVICE_ROLE_KEY/.test(source), false);
  const calls = [];
  const values = new Map();
  const browser = {
    crypto: { randomUUID: () => IDEMPOTENCY_KEY },
    localStorage: {
      getItem(key) {
        return values.has(key) ? values.get(key) : null;
      },
      setItem(key, value) {
        values.set(key, value);
      },
      removeItem(key) {
        values.delete(key);
      }
    },
    async fetch(url, options) {
      calls.push({ url, options });
      return {
        ok: true,
        status: 201,
        async json() {
          return {
            success: true,
            data: { order_id: 'LP-20261028-A1B2C3D4', items: [] }
          };
        }
      };
    }
  };
  vm.runInNewContext(source, { window: browser });

  const payload = {
    customer: { phone: '+85212345678', name: '測試客人' },
    pickup: '自取',
    items: [{ product_id: '4268', qty: 2 }]
  };
  const { response, result } = await browser.LittlePlanetCheckout.submit(payload);

  assert.equal(response.status, 201);
  assert.equal(result.success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/orders/checkout');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(
    calls[0].options.headers['Content-Type'],
    'application/json'
  );
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    ...payload,
    idempotency_key: IDEMPOTENCY_KEY
  });
  assert.equal(values.has('lp_last_idem_key'), false);
});

test('checkout contact memory restores saved details only for the matching phone', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'checkout.js'),
    'utf8'
  );
  const browser = {};
  const values = new Map();
  const storage = {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    }
  };
  vm.runInNewContext(source, { window: browser });

  browser.LittlePlanetCheckout.rememberContactProfile({
    phone: '+852 1234-5678',
    customer_name: '小行星客人',
    shipping_method: '自取',
    shipping_address: '荃灣店'
  }, storage);

  const profile = browser.LittlePlanetCheckout.getContactProfile('85212345678', storage);
  assert.equal(profile.customer_name, '小行星客人');
  assert.equal(profile.shipping_method, '自取');
  assert.equal(profile.shipping_address, '荃灣店');
  assert.equal(browser.LittlePlanetCheckout.getContactProfile('85287654321', storage), null);
});

test('checkout reuses a saved idempotency key for retries and rotates after success', async () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'checkout.js'),
    'utf8'
  );
  const values = new Map();
  const calls = [];
  let generated = 0;
  const keys = [
    IDEMPOTENCY_KEY,
    '64e58e7a-5316-4d4d-8a49-005cfe2eac21'
  ];
  const responses = [
    {
      ok: false,
      status: 500,
      async json() {
        return { success: false, message: 'temporary failure' };
      }
    },
    {
      ok: true,
      status: 201,
      async json() {
        return { success: true, data: { order_id: 'LP-20261029-AAAA0001' } };
      }
    },
    {
      ok: true,
      status: 201,
      async json() {
        return { success: true, data: { order_id: 'LP-20261029-BBBB0002' } };
      }
    }
  ];
  const storage = {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    }
  };
  const browser = {
    crypto: {
      randomUUID() {
        return keys[generated++];
      }
    },
    localStorage: storage,
    async fetch(url, options) {
      calls.push(JSON.parse(options.body));
      return responses.shift();
    }
  };
  vm.runInNewContext(source, { window: browser });

  const payload = {
    customer: { phone: '+852 1234-5678' },
    items: [{ product_id: '4268', qty: 1 }]
  };
  await browser.LittlePlanetCheckout.submit(payload);
  const saved = JSON.parse(values.get('lp_last_idem_key'));
  assert.equal(saved.phone, '85212345678');
  assert.equal(saved.key, IDEMPOTENCY_KEY);

  await browser.LittlePlanetCheckout.submit(payload);
  assert.equal(calls[0].idempotency_key, IDEMPOTENCY_KEY);
  assert.equal(calls[1].idempotency_key, IDEMPOTENCY_KEY);
  assert.equal(values.has('lp_last_idem_key'), false);

  await browser.LittlePlanetCheckout.submit(payload);
  assert.equal(calls[2].idempotency_key, keys[1]);
  assert.equal(generated, 2);
});

test('checkout fallback idempotency key remains UUID v4 compatible', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'checkout.js'),
    'utf8'
  );
  const browser = {};
  vm.runInNewContext(source, { window: browser });

  assert.match(
    browser.LittlePlanetCheckout.generateIdempotencyKey(),
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  );
});

test(
  'local anon Supabase cannot select orders or order_items',
  { skip: !supabaseUrl || !supabaseAnonKey || !isLocalSupabaseUrl(supabaseUrl) },
  async () => {
    const { createClient } = require('@supabase/supabase-js');
    const anonClient = createClient(supabaseUrl, supabaseAnonKey);

    for (const table of ['orders', 'order_items']) {
      const { count, error } = await anonClient
        .from(table)
        .select('*', { count: 'exact', head: true });

      if (error) {
        assert.equal(error.code, '42501', `${table} should be blocked by database privileges`);
      } else {
        assert.equal(count, 0, `${table} should be hidden by RLS`);
      }
    }
  }
);
