'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { parseCsv } = require('../scripts/f-catalog-utils');
const { run: runValidation, validateCatalog } = require('../scripts/f-validate-products');
const {
  createServiceRoleClient,
  parseMode,
  runImport,
} = require('../scripts/f-import-products');
const { reconcileProductImages } = require('../scripts/f-reconcile-product-images');

const HEADERS = [
  'id',
  'name',
  'price',
  'cost_price',
  'stock',
  'image_url',
  'is_active',
  'tier_prices',
  'preorder_deadline',
  'cutoff_datetime',
  'status',
  'retail_price',
  'created_at',
];

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function makeRow(overrides = {}) {
  return {
    id: '4268',
    name: 'Test Product',
    price: '100.00',
    cost_price: '25.00',
    stock: '3',
    image_url: '',
    is_active: 'true',
    tier_prices: '[{"min_qty":2,"price":90}]',
    preorder_deadline: '',
    cutoff_datetime: '',
    status: '預購中',
    retail_price: '120.00',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeCsv(rows, headers = HEADERS) {
  return [
    headers.map(csvEscape).join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')),
  ].join('\n');
}

function makeRoot(csvText) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'littleplanet-f2-'));
  fs.mkdirSync(path.join(root, 'source'), { recursive: true });
  if (csvText !== undefined) {
    fs.writeFileSync(path.join(root, 'source', 'products.csv'), csvText, 'utf8');
  }
  return root;
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

function silentLogger() {
  return { info() {} };
}

test('CSV parser handles BOM, escaped quotes, commas and multiline fields', () => {
  const parsed = parseCsv('\uFEFFid,name,description\r\n4268,"Product, A","line 1\nline ""2"""');
  assert.deepEqual(parsed.headers, ['id', 'name', 'description']);
  assert.equal(parsed.records[0].name, 'Product, A');
  assert.equal(parsed.records[0].description, 'line 1\nline "2"');
});

test('CSV parser rejects malformed quotes and duplicate headers', () => {
  assert.throws(() => parseCsv('id,name\n4268,"unfinished'), /unterminated quoted field/);
  assert.throws(() => parseCsv('id,id\n4268,4269'), /duplicate column names/);
});

test('validator accepts bigint boundary IDs and keeps IDs as strings', () => {
  const root = makeRoot(makeCsv([
    makeRow({ id: '4268' }),
    makeRow({ id: '4294', name: 'Boundary Product' }),
  ]));
  try {
    const result = validateCatalog(root);
    assert.equal(result.validRows.length, 2);
    assert.equal(result.validRows[1].result.payload.id, '4294');
  } finally {
    cleanup(root);
  }
});

test('validator rejects malformed and out-of-range bigint product IDs', () => {
  const root = makeRoot(makeCsv([
    makeRow({ id: '4267' }),
    makeRow({ id: '4295' }),
    makeRow({ id: '999999999999999999999999999' }),
  ]));
  try {
    const result = validateCatalog(root);
    assert.equal(result.invalidRows.length, 3);
    assert.ok(result.invalidRows.every(({ result: row }) => row.errors.some((error) => error.includes('id'))));
  } finally {
    cleanup(root);
  }
});

test('validator rejects negative, fractional and overflowing stock values', () => {
  const root = makeRoot(makeCsv([
    makeRow({ stock: '-1' }),
    makeRow({ id: '4269', stock: '1.5' }),
    makeRow({ id: '4270', stock: '2147483648' }),
  ]));
  try {
    assert.equal(validateCatalog(root).invalidRows.length, 3);
  } finally {
    cleanup(root);
  }
});

test('validator requires a strictly positive valid price', () => {
  const root = makeRoot(makeCsv([
    makeRow({ price: '0' }),
    makeRow({ id: '4269', price: 'not-money' }),
  ]));
  try {
    assert.equal(validateCatalog(root).invalidRows.length, 2);
  } finally {
    cleanup(root);
  }
});

test('missing cost_price is a warning and report explicitly says data is insufficient', () => {
  const headers = HEADERS.filter((header) => header !== 'cost_price');
  const root = makeRoot(makeCsv([makeRow()], headers));
  try {
    const result = runValidation({ root });
    assert.equal(result.validRows, 1);
    assert.equal(result.missingCostRows, 1);
    const report = fs.readFileSync(path.join(root, 'F_PRODUCT_MARGIN_REPORT_DT.md'), 'utf8');
    assert.match(report, /cost_price 欄位缺失，無法計算真 margin，資料不足/);
    assert.match(report, /4268/);
    assert.doesNotMatch(report, /毛利率\s*\|\s*100/);
  } finally {
    cleanup(root);
  }
});

test('margin uses selling price as denominator and writes real values when cost exists', () => {
  const root = makeRoot(makeCsv([makeRow({ price: '100', cost_price: '25' })]));
  try {
    const result = runValidation({ root });
    assert.equal(result.invalidRows, 0);
    const report = fs.readFileSync(path.join(root, 'PRODUCT_MARGIN_TOP20.md'), 'utf8');
    assert.match(report, /75\.00%/);
    assert.match(report, /\(price - cost_price\) \/ price/);
  } finally {
    cleanup(root);
  }
});

test('cost above price is marked as a loss and excluded from import', () => {
  const root = makeRoot(makeCsv([makeRow({ price: '100', cost_price: '120' })]));
  try {
    const result = validateCatalog(root);
    assert.equal(result.invalidRows.length, 1);
    assert.equal(result.lossRows.length, 1);
    assert.equal(result.lossRows[0].margin, -20);
  } finally {
    cleanup(root);
  }
});

test('duplicate product IDs invalidate every duplicate row', () => {
  const root = makeRoot(makeCsv([
    makeRow(),
    makeRow({ name: 'Duplicate Product' }),
  ]));
  try {
    assert.equal(validateCatalog(root).invalidRows.length, 2);
  } finally {
    cleanup(root);
  }
});

test('tier price JSON is checked against the database tier rules', () => {
  const root = makeRoot(makeCsv([
    makeRow({ tier_prices: 'not-json' }),
    makeRow({ id: '4269', tier_prices: '[{"min_qty":2,"price":110}]' }),
  ]));
  try {
    assert.equal(validateCatalog(root).invalidRows.length, 2);
  } finally {
    cleanup(root);
  }
});

test('unsupported legacy status is warned and omitted rather than guessed', () => {
  const root = makeRoot(makeCsv([makeRow({ status: 'preorder' })]));
  try {
    const result = validateCatalog(root).validRows[0].result;
    assert.ok(result.warnings.some((warning) => warning.includes('status 不符合')));
    assert.equal(Object.hasOwn(result.payload, 'status'), false);
  } finally {
    cleanup(root);
  }
});

test('dry-run reports simulated row locks and never calls the supplied database client', async () => {
  const root = makeRoot(makeCsv([makeRow()]));
  let databaseCalls = 0;
  const client = {
    from() {
      databaseCalls += 1;
      throw new Error('dry-run must not access the database');
    },
  };
  try {
    const result = await runImport({
      args: [],
      root,
      client,
      logger: silentLogger(),
    });
    assert.equal(result.mode, 'dry-run');
    assert.equal(databaseCalls, 0);
    const report = fs.readFileSync(path.join(root, 'F_IMPORT_DRYRUN_REPORT.md'), 'utf8');
    assert.match(report, /FOR UPDATE/);
    assert.match(report, /沒有連線、寫入或改動資料庫/);
  } finally {
    cleanup(root);
  }
});

test('real mode upserts only validated fields through a mocked service-role client', async () => {
  const root = makeRoot(makeCsv([makeRow({
    cost_price: '',
    status: 'preorder',
  })]));
  const calls = [];
  const client = {
    from(table) {
      calls.push({ table });
      return {
        async upsert(rows, options) {
          calls.push({ rows, options });
          return { error: null };
        },
      };
    },
  };
  try {
    const result = await runImport({
      args: ['--real'],
      root,
      client,
      logger: silentLogger(),
    });
    assert.equal(result.importedRows, 1);
    assert.equal(calls[0].table, 'products');
    assert.deepEqual(calls[1].options, { onConflict: 'id' });
    assert.equal(calls[1].rows[0].id, '4268');
    assert.equal(Object.hasOwn(calls[1].rows[0], 'cost_price'), false);
    assert.equal(Object.hasOwn(calls[1].rows[0], 'status'), false);
    assert.equal(Object.hasOwn(calls[1].rows[0], 'created_at'), false);
  } finally {
    cleanup(root);
  }
});

test('service-role client reads .env.docker values without printing them', () => {
  const root = makeRoot();
  fs.writeFileSync(
    path.join(root, '.env.docker'),
    'SUPABASE_URL=https://test.example\nSUPABASE_SERVICE_ROLE_KEY=unit-test-secret\n',
    'utf8'
  );
  let args;
  try {
    const client = createServiceRoleClient(root, (...values) => {
      args = values;
      return { mocked: true };
    });
    assert.deepEqual(client, { mocked: true });
    assert.equal(args[0], 'https://test.example');
    assert.equal(args[1], 'unit-test-secret');
    assert.deepEqual(args[2], {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  } finally {
    cleanup(root);
  }
});

test('service-role client refuses missing configuration without exposing values', () => {
  const root = makeRoot();
  fs.writeFileSync(path.join(root, '.env.docker'), 'SUPABASE_URL=https://test.example\n', 'utf8');
  try {
    assert.throws(
      () => createServiceRoleClient(root, () => assert.fail('client must not be created')),
      /SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/
    );
  } finally {
    cleanup(root);
  }
});

test('real upsert errors are sanitized instead of returning provider details', async () => {
  const root = makeRoot(makeCsv([makeRow()]));
  const client = {
    from() {
      return {
        async upsert() {
          return { error: { message: 'private database host and secret details' } };
        },
      };
    },
  };
  try {
    await assert.rejects(
      runImport({ args: ['--real'], root, client, logger: silentLogger() }),
      (error) => {
        assert.match(error.message, /database details were omitted/);
        assert.doesNotMatch(error.message, /private database host/);
        return true;
      }
    );
  } finally {
    cleanup(root);
  }
});

test('image reconciliation separates local files, missing paths and remote URLs', () => {
  const root = makeRoot('');
  const imagesRoot = path.join(root, 'public', 'images');
  fs.mkdirSync(imagesRoot, { recursive: true });
  fs.writeFileSync(path.join(imagesRoot, 'product.jpg'), 'image', 'utf8');
  try {
    const result = reconcileProductImages(root, [
      { id: '4268', image_url: '/images/product.jpg' },
      { id: '4269', image_url: '/images/missing.jpg' },
      { id: '4270', image_url: 'https://storage.example/item.jpg' },
    ]);
    assert.equal(result.localImageCount, 1);
    assert.equal(result.missingLocal.length, 1);
    assert.deepEqual(result.remoteUnverified, ['4270']);
  } finally {
    cleanup(root);
  }
});

test('image reconciliation refuses local path traversal', () => {
  const root = makeRoot('');
  try {
    const result = reconcileProductImages(root, [
      { id: '4268', image_url: '/images/../../outside.jpg' },
    ]);
    assert.equal(result.malformedLocal.length, 1);
    assert.equal(result.missingLocal.length, 0);
  } finally {
    cleanup(root);
  }
});

test('CLI mode parsing rejects unknown and conflicting flags', () => {
  assert.equal(parseMode([]), 'dry-run');
  assert.equal(parseMode(['--dry-run']), 'dry-run');
  assert.equal(parseMode(['--real']), 'real');
  assert.throws(() => parseMode(['--real', '--dry-run']), /either --dry-run or --real/);
  assert.throws(() => parseMode(['--force']), /either --dry-run or --real/);
});
