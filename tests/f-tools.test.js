'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { parseCsv } = require('../scripts/f-catalog-utils');
const { run: validateProducts, validateRecord } = require('../scripts/f-validate-products');
const { run: reconcileImages } = require('../scripts/f-reconcile-images');
const { run: previewPreorders } = require('../scripts/f-preorder-auto-close');
const { run: generateTestOrders } = require('../scripts/f-generate-test-orders');

function createRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'littleplanet-f-tools-'));
  fs.mkdirSync(path.join(root, 'source'), { recursive: true });
  fs.mkdirSync(path.join(root, 'supabase', 'migrations'), { recursive: true });
  return root;
}

function withRoot(run) {
  const root = createRoot();
  try {
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const headers = 'id,name,price,cost_price,stock,tier_prices,preorder_deadline,image_url,status';

test('CSV parser preserves quoted commas, escaped quotes and multiline fields', () => {
  const parsed = parseCsv('id,name,notes\r\n1,"A, ""quoted"" item","two\nlines"\r\n');
  assert.deepEqual(parsed.records, [{
    __row: 2,
    id: '1',
    name: 'A, "quoted" item',
    notes: 'two\nlines',
  }]);
});

test('product validation enforces schema-compatible tiers and nonnegative stock', () => {
  const result = validateRecord({
    id: '4268',
    name: 'Sticker',
    price: '10.00',
    cost_price: '5.00',
    stock: '-1',
    tier_prices: '[{"min_qty":2,"price":9.00}]',
    preorder_deadline: '',
    image_url: '/images/sticker.jpg',
  });
  assert.ok(result.errors.some((error) => error.includes('stock')));
  assert.equal(result.tiers[0].min_qty, 2);

  const invalidDate = validateRecord({
    id: '4268',
    name: 'Sticker',
    price: '10.00',
    cost_price: '5.00',
    stock: '1',
    tier_prices: '[]',
    preorder_deadline: '2026-02-31T12:00:00Z',
    image_url: '/images/sticker.jpg',
    status: 'preorder',
  });
  assert.ok(invalidDate.errors.some((error) => error.includes('ISO 8601')));
  assert.ok(invalidDate.errors.some((error) => error.includes('現行商品狀態')));
});

test('CSV validator reports duplicates, invalid rows, losses and missing images', () => {
  withRoot((root) => {
    fs.writeFileSync(path.join(root, 'source', 'products.csv'), [
      headers,
      '4268,Loss product,8.00,10.00,0,"[{""min_qty"":2,""price"":7.00}]",,',
      '4269,Duplicate product,12.00,5.00,-2,[],,',
      '4269,Duplicate product copy,12.00,5.00,3,[],,',
    ].join('\n'));

    const result = validateProducts({ root });
    assert.equal(result.totalRows, 3);
    assert.equal(result.validRows, 1);
    assert.equal(result.invalidRows, 2);
    assert.equal(result.duplicateIds.length, 1);
    assert.equal(result.negativeStock, 1);
    assert.equal(result.lossProductCount, 1);
    assert.equal(result.missingImages, 3);
    assert.match(fs.readFileSync(path.join(root, 'F_CSV_VALIDATION_REPORT.md'), 'utf8'), /LOSS/);
  });
});

test('image reconciliation separates missing local files, remote URLs and Docker image metadata', () => {
  withRoot((root) => {
    fs.mkdirSync(path.join(root, 'public', 'images'), { recursive: true });
    fs.writeFileSync(path.join(root, 'public', 'images', 'present.jpg'), 'fixture');
    fs.writeFileSync(path.join(root, 'source', 'products.csv'), [
      headers,
      '4268,Present,10.00,5.00,1,[],,/images/present.jpg,預購中',
      '4269,Missing,10.00,5.00,1,[],,/images/missing.jpg,預購中',
      '4270,Remote,10.00,5.00,1,[],,https://example.invalid/remote.jpg,預購中',
    ].join('\n'));
    const manifestPath = path.join(root, 'docker_images.txt');
    fs.writeFileSync(manifestPath, 'AVAILABLE littleplanet-app:latest\n');

    const result = reconcileImages({
      root,
      archivePath: path.join(root, 'images.tar'),
      dockerManifestPath: manifestPath,
    });
    assert.equal(result.localImageCount, 1);
    assert.equal(result.missingImageCount, 1);
    assert.equal(result.remoteUnverifiedCount, 1);
    assert.equal(result.dockerImageReferenceCount, 1);
    assert.match(fs.readFileSync(path.join(root, 'F_IMAGE_RECONCILE_REPORT.md'), 'utf8'), /不是商品圖片檔清單/);
  });
});

test('preorder preview uses current Chinese status values and writes a comment-only draft', () => {
  withRoot((root) => {
    fs.writeFileSync(path.join(root, 'source', 'products.csv'), [
      headers,
      '4268,Expired,10.00,5.00,1,[],2026-10-28T00:00:00Z,/images/a.jpg,預購中',
      '4269,Travel,10.00,5.00,1,[],2026-10-28T00:00:00Z,/images/b.jpg,旅購中',
      '4270,Future,10.00,5.00,1,[],2026-10-30T00:00:00Z,/images/c.jpg,預購中',
    ].join('\n'));

    const result = previewPreorders({
      root,
      now: new Date('2026-10-29T00:00:00Z'),
    });
    assert.equal(result.candidateCount, 1);
    assert.equal(result.skippedStatusCount, 1);
    const draft = fs.readFileSync(result.draftPath, 'utf8');
    assert.match(draft, /DRAFT ONLY/);
    assert.match(draft, /status = '已下架'/);
    assert.equal(draft.split('\n').some((line) => /^\s*UPDATE\b/.test(line)), false);
  });
});

test('test data factory produces 100 isolated orders with normalized fake phones and reconciled totals', () => {
  withRoot((root) => {
    fs.copyFileSync(
      path.join(__dirname, '..', 'source', 'products.csv.example'),
      path.join(root, 'source', 'products.csv.example')
    );
    const result = generateTestOrders({ root });
    const output = JSON.parse(fs.readFileSync(path.join(root, 'F_TEST_ORDERS_100.json'), 'utf8'));
    assert.equal(result.orderCount, 100);
    assert.equal(output.orders.length, 100);
    assert.ok(Number.isFinite(Date.parse(output.generated_at)));
    assert.equal(new Set(output.orders.map((order) => order.customer_phone)).size, 100);
    assert.equal(new Set(output.orders.map((order) => order.idempotency_key)).size, 100);
    for (const order of output.orders) {
      assert.match(order.customer_phone, /^8525550\d{4}$/);
      assert.equal(order.is_test_data, true);
      assert.ok(order.items.length >= 1 && order.items.length <= 3);
      if (order.status_history.length === 2) {
        const [from, to] = order.status_history;
        const allowed = {
          pending: ['paid', 'cancelled'],
          paid: ['shipped', 'picked_up', 'cancelled'],
          shipped: ['completed'],
          picked_up: ['completed'],
        };
        assert.ok(allowed[from].includes(to), `${from} -> ${to}`);
      }
      assert.equal(
        Number(order.items.reduce((sum, item) => sum + item.profit, 0).toFixed(2)),
        order.profit_total
      );
    }
    assert.match(
      fs.readFileSync(path.join(root, 'F_TEST_ORDERS_SUMMARY.md'), 'utf8'),
      /禁止用於 WhatsApp／SMS 通知/
    );
  });
});
