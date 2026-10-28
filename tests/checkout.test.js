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
  const browser = {
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
  assert.deepEqual(JSON.parse(calls[0].options.body), payload);
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
