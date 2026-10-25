'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  MAX_ORDER_QUANTITY,
  parseWhatsAppOrderMessage
} = require('../src/utils/whatsapp-order-parser');

const PRODUCTS = [
  { product_code: 'B款', name: 'B 款商品' },
  { product_code: 'A', name: 'A 商品' },
  { product_code: 'C', name: 'C 商品' },
  { product_code: 'D', name: 'D 商品' }
];

test('parses a product code with Chinese variant text and compact quantity', () => {
  const result = parseWhatsAppOrderMessage('B款 x3', PRODUCTS);

  assert.deepEqual(result, {
    success: true,
    data: { items: [{ product_code: 'B款', quantity: 3 }] },
    message: '落單內容已驗證，尚未建立訂單。'
  });
});

test('normalizes case, whitespace, full-width characters and multiple items', () => {
  const result = parseWhatsAppOrderMessage('Ｂ款　Ｘ　３， ａ x 1，Ｃ × 1；D＊３', PRODUCTS);

  assert.equal(result.success, true);
  assert.deepEqual(result.data.items, [
    { product_code: 'B款', quantity: 3 },
    { product_code: 'A', quantity: 1 },
    { product_code: 'C', quantity: 1 },
    { product_code: 'D', quantity: 3 }
  ]);
});

test('rejects an unknown product code without producing order items', () => {
  const result = parseWhatsAppOrderMessage('Z x 1', PRODUCTS);

  assert.equal(result.success, false);
  assert.equal(result.data, null);
  assert.equal(result.error.code, 'PRODUCT_NOT_FOUND');
  assert.match(result.message, /找不到商品代號「Z」/);
});

test('rejects malformed entries and non-positive quantities', async t => {
  await t.test('malformed syntax', () => {
    const result = parseWhatsAppOrderMessage('B款 三件', PRODUCTS);
    assert.equal(result.success, false);
    assert.equal(result.error.code, 'INVALID_ITEM_FORMAT');
  });

  await t.test('zero quantity', () => {
    const result = parseWhatsAppOrderMessage('A x 0', PRODUCTS);
    assert.equal(result.success, false);
    assert.equal(result.error.code, 'INVALID_QUANTITY');
  });

  await t.test('quantity above the checkout limit', () => {
    const result = parseWhatsAppOrderMessage(`A x ${MAX_ORDER_QUANTITY + 1}`, PRODUCTS);
    assert.equal(result.success, false);
    assert.equal(result.error.code, 'QUANTITY_EXCEEDED');
  });
});

test('rejects repeated or ambiguous product codes', async t => {
  await t.test('duplicate item in a message', () => {
    const result = parseWhatsAppOrderMessage('A x 1, a x 2', PRODUCTS);
    assert.equal(result.success, false);
    assert.equal(result.error.code, 'DUPLICATE_ITEM');
  });

  await t.test('duplicate product code in the catalog', () => {
    const result = parseWhatsAppOrderMessage('A x 1', [
      { product_code: 'A' },
      { product_code: 'ａ' }
    ]);
    assert.equal(result.success, false);
    assert.equal(result.error.code, 'AMBIGUOUS_PRODUCT_CODE');
  });
});

test('rejects unavailable products and invalid parser inputs explicitly', () => {
  const unavailable = parseWhatsAppOrderMessage('A x 1', [
    { product_code: 'A', status: '已下架' }
  ]);
  assert.equal(unavailable.success, false);
  assert.equal(unavailable.error.code, 'PRODUCT_UNAVAILABLE');

  const emptyMessage = parseWhatsAppOrderMessage('　 ', PRODUCTS);
  assert.equal(emptyMessage.success, false);
  assert.equal(emptyMessage.error.code, 'EMPTY_MESSAGE');

  const invalidCatalog = parseWhatsAppOrderMessage('A x 1', null);
  assert.equal(invalidCatalog.success, false);
  assert.equal(invalidCatalog.error.code, 'INVALID_CATALOG');
});
