'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  parseCsv,
  validateProductsCsv,
} = require('../scripts/validate-products-csv');

test('products CSV parser handles quoted commas, escaped quotes, and embedded newlines', () => {
  const csv = [
    'id,name,cost_price,stock,tier_prices,preorder_deadline',
    '4268,"Product ""A"", first line',
    'second line",12.5,4,"[{""min_qty"":2,""price"":10}]",2026-10-29',
  ].join('\r\n');
  const parsed = parseCsv(csv);

  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].name, 'Product "A", first line\r\nsecond line');
  assert.deepEqual(JSON.parse(parsed.rows[0].tier_prices), [{ min_qty: 2, price: 10 }]);
  assert.deepEqual(validateProductsCsv(parsed), []);
});

test('products CSV validation rejects out-of-range ids, duplicates, negative values, bad JSON, and invalid dates', () => {
  const csv = [
    'id,name,cost_price,stock,tier_prices,preorder_deadline',
    '4268,Product A,-1,-1,not-json,2026-02-31',
    '4268,Product B,2,1,[],2026-10-29T25:00:00Z',
    '4295,Product C,0,0,[],',
  ].join('\n');
  const errors = validateProductsCsv(parseCsv(csv));

  assert.ok(errors.some(error => error.includes('cost_price must be a non-negative number')));
  assert.ok(errors.some(error => error.includes('stock must be a non-negative PostgreSQL integer')));
  assert.ok(errors.some(error => error.includes('tier_prices must contain valid JSON')));
  assert.ok(errors.some(error => error.includes('preorder_deadline must be an ISO date')));
  assert.ok(errors.some(error => error.includes('duplicate id 4268')));
  assert.ok(errors.some(error => error.includes('id must be between 4268 and 4294')));
});

test('products CSV validation reports missing cost column instead of inferring it', () => {
  const csv = [
    'id,name,price,stock,tier_prices,preorder_deadline',
    '4268,Product A,10,1,[],',
  ].join('\n');
  const errors = validateProductsCsv(parseCsv(csv));

  assert.deepEqual(errors, ['Missing required column: cost_price']);
});

test('margin dry-run ranks base and tier prices without database access', () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'littleplanet-margin-dryrun-'));
  const csvPath = path.join(tempDirectory, 'products.csv');
  const reportPath = path.join(tempDirectory, 'margin.md');
  const scriptPath = path.join(__dirname, '..', 'scripts', 'import-products-dryrun.js');
  const fixture = [
    'id,name,cost_price,stock,tier_prices,preorder_deadline,price',
    '4268,Product A,10,1,"[{""min_qty"":2,""price"":15}]",,20',
  ].join('\n');

  try {
    fs.writeFileSync(csvPath, fixture, 'utf8');
    const result = spawnSync(process.execPath, [scriptPath, csvPath, reportPath], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const report = fs.readFileSync(reportPath, 'utf8');
    assert.match(report, /Product A/);
    assert.match(report, /100\.00%/);
    assert.match(report, /50\.00%/);
    assert.match(report, /Database access\/writes: none/);
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});
