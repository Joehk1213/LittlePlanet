'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  parseNonNegativeNumber,
  readProductsCsv,
} = require('./validate-products-csv');

const csvPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(process.cwd(), 'source', 'products.csv');
const reportPath = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(process.cwd(), 'PRODUCT_MARGIN_TOP20.md');

function markdownCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ').trim();
}

function getPriceRows(product) {
  const basePrice = parseNonNegativeNumber(product.price);
  if (basePrice === null) {
    return [];
  }

  const prices = [{ minQty: 1, price: basePrice, label: 'Base price' }];
  if (!product.tier_prices) {
    return prices;
  }

  const tiers = JSON.parse(product.tier_prices);
  if (!Array.isArray(tiers)) {
    throw new Error(`Product ${product.id}: tier_prices must be a JSON array.`);
  }
  for (const tier of tiers) {
    if (
      !tier ||
      !Number.isSafeInteger(tier.min_qty) ||
      tier.min_qty < 1 ||
      typeof tier.price !== 'number' ||
      !Number.isFinite(tier.price) ||
      tier.price < 0
    ) {
      throw new Error(`Product ${product.id}: tier_prices has an unsupported entry.`);
    }
    prices.push({
      minQty: tier.min_qty,
      price: tier.price,
      label: `From ${tier.min_qty}`,
    });
  }
  return prices;
}

function main() {
  const { headers, rows } = readProductsCsv(csvPath);
  const hasCostPrice = headers.includes('cost_price');
  const candidates = [];
  const issues = [];

  if (hasCostPrice) {
    rows.forEach((product, index) => {
      const cost = parseNonNegativeNumber(product.cost_price);
      if (cost === null) {
        issues.push(`Record ${index + 2}: invalid cost_price.`);
        return;
      }
      if (cost === 0) {
        issues.push(`Record ${index + 2}: cost_price is zero; margin is undefined.`);
        return;
      }
      let prices;
      try {
        prices = getPriceRows(product);
      } catch (error) {
        issues.push(error.message);
        return;
      }
      for (const price of prices) {
        candidates.push({
          id: product.id,
          name: product.name,
          tier: price.label,
          minQty: price.minQty,
          price: price.price,
          cost,
          margin: (price.price - cost) / cost,
        });
      }
    });
  }

  candidates.sort((left, right) =>
    right.margin - left.margin ||
    String(left.id).localeCompare(String(right.id)) ||
    left.minQty - right.minQty
  );
  const topRows = candidates.slice(0, 20);
  const lines = [
    '# Product Margin Top 20 (Dry Run)',
    '',
    `- Source: \`${path.relative(process.cwd(), csvPath)}\``,
    `- Product records: ${rows.length}`,
    '- Database access/writes: none',
    '- Formula: `(selling price - cost_price) / cost_price`',
    '- `retail_price` is not treated as `cost_price`.',
    '',
    '## Data availability',
    '',
  ];

  if (!hasCostPrice) {
    lines.push(
      'No margins can be calculated: the CSV does not contain a `cost_price` column. No other column was substituted.'
    );
  } else if (topRows.length === 0) {
    lines.push('No valid non-zero cost and selling-price combinations were available.');
  } else {
    lines.push(`Calculated ${candidates.length} base/tier price combinations from ${rows.length} products.`);
  }

  if (issues.length > 0) {
    lines.push('', `Skipped combinations/records: ${issues.length}.`);
  }

  if (topRows.length > 0) {
    lines.push(
      '',
      '## Top 20',
      '',
      '| Rank | Product ID | Product | Price tier | Min qty | Selling price | Cost price | Margin |',
      '|---:|---:|---|---|---:|---:|---:|---:|'
    );
    topRows.forEach((row, index) => {
      lines.push(
        `| ${index + 1} | ${markdownCell(row.id)} | ${markdownCell(row.name)} | ${markdownCell(row.tier)} | ${row.minQty} | ${row.price.toFixed(2)} | ${row.cost.toFixed(2)} | ${(row.margin * 100).toFixed(2)}% |`
      );
    });
  }

  fs.writeFileSync(reportPath, `${lines.join('\n')}\n`, 'utf8');
  console.log(`Dry-run report written: ${path.relative(process.cwd(), reportPath)}`);
  console.log(`Products: ${rows.length}; ranked price combinations: ${topRows.length}.`);
  if (issues.length > 0) {
    console.log(`Skipped: ${issues.length} record(s)/combination(s).`);
  }
}

try {
  main();
} catch (error) {
  console.error(`Dry run failed: ${error.message}`);
  process.exitCode = 1;
}
