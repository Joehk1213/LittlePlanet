'use strict';

const path = require('node:path');
const {
  PROJECT_ROOT,
  markdownTable,
  readCatalog,
  writeReport,
} = require('./f-catalog-utils');

const REQUIRED_HEADERS = [
  'id',
  'name',
  'price',
  'cost_price',
  'stock',
  'tier_prices',
  'preorder_deadline',
  'image_url',
];
const PRODUCT_ID_MIN = 4268n;
const PRODUCT_ID_MAX = 4294n;

function parseMoney(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTiers(value, basePrice) {
  let tiers;
  try {
    tiers = JSON.parse(value || '[]');
  } catch {
    return { error: 'tier_prices 不是有效 JSON。' };
  }
  if (!Array.isArray(tiers) || tiers.length > 20) {
    return { error: 'tier_prices 必須是最多 20 項的 JSON 陣列。' };
  }

  const seenQuantities = new Set();
  const normalized = [];
  for (const tier of tiers) {
    const quantity = tier && (tier.min_qty ?? tier.qty);
    const price = tier && parseMoney(String(tier.price));
    if (
      !tier ||
      typeof tier !== 'object' ||
      Array.isArray(tier) ||
      !Number.isSafeInteger(quantity) ||
      quantity < 2 ||
      quantity > 1000 ||
      seenQuantities.has(quantity) ||
      price === null ||
      price > basePrice
    ) {
      return {
        error: '每個 tier 須有不重複的 min_qty/qty（2 至 1000）及不高於原價的兩位小數 price。',
      };
    }
    seenQuantities.add(quantity);
    normalized.push({ min_qty: quantity, price });
  }
  normalized.sort((left, right) => left.min_qty - right.min_qty);
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index].price > normalized[index - 1].price) {
      return { error: '購買門檻提高時，階梯單價不可增加。' };
    }
  }
  return { tiers: normalized };
}

function isValidImageUrl(value) {
  if (!value) {
    return true;
  }
  if (value.startsWith('/') && !value.startsWith('//')) {
    return !value.split('/').includes('..');
  }
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function isValidIsoDateTime(value) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) {
    return false;
  }
  const date = new Date(`${match[1]}T00:00:00.000Z`);
  const datePartIsValid = date.toISOString().slice(0, 10) === match[1];
  const timeIsValid = Number(match[2]) < 24 &&
    Number(match[3]) < 60 &&
    Number(match[4]) < 60;
  const offsetIsValid = match[6] === undefined ||
    (Number(match[6]) <= 14 &&
      Number(match[7]) < 60 &&
      (Number(match[6]) < 14 || Number(match[7]) === 0));
  return datePartIsValid && timeIsValid && offsetIsValid;
}

function validateRecord(record) {
  const errors = [];
  const id = record.id || '';
  let numericId = null;
  if (!/^\d+$/.test(id)) {
    errors.push('id 必須是十進位 bigint。');
  } else {
    numericId = BigInt(id);
    if (numericId < PRODUCT_ID_MIN || numericId > PRODUCT_ID_MAX) {
      errors.push('id 必須介乎 4268 至 4294。');
    }
  }

  const name = record.name || record.product_name || '';
  if (!name.trim()) {
    errors.push('name 不可留空。');
  }
  const price = parseMoney(record.price || '');
  if (price === null) {
    errors.push('price 必須是最多兩位小數的非負金額。');
  }
  const costPrice = record.cost_price === '' ? null : parseMoney(record.cost_price);
  if (costPrice === null) {
    errors.push('cost_price 必須提供有效的非負金額。');
  }
  const stockIsInteger = /^-?\d+$/.test(record.stock || '');
  const stock = stockIsInteger && Number.isSafeInteger(Number(record.stock))
    ? Number(record.stock)
    : null;
  if (stock === null || stock < 0) {
    errors.push('stock 必須是非負整數。');
  }

  const tierResult = price === null
    ? { error: '無法在 price 無效時驗證階梯價。' }
    : parseTiers(record.tier_prices, price);
  if (tierResult.error) {
    errors.push(tierResult.error);
  }

  const deadline = record.preorder_deadline || '';
  if (deadline && !isValidIsoDateTime(deadline)) {
    errors.push('preorder_deadline 必須是含時區的 ISO 8601 日期時間或留空。');
  }
  if (!isValidImageUrl(record.image_url || '')) {
    errors.push('image_url 必須是網站內絕對路徑或 HTTP(S) URL。');
  }
  if (
    record.status &&
    !['預購中', '旅購中', '已到貨', '已下架'].includes(record.status)
  ) {
    errors.push('status 不符合現行商品狀態列舉。');
  }
  if (record.__extraColumns) {
    errors.push('此列欄位數多於標題列。');
  }

  return {
    id: numericId === null ? id : numericId.toString(),
    name,
    price,
    costPrice,
    stock,
    tiers: tierResult.tiers || [],
    deadline,
    imageUrl: record.image_url || '',
    errors,
  };
}

function marginPercent(price, cost) {
  return cost === 0 ? null : ((price - cost) / cost) * 100;
}

function formatMargin(value) {
  return value === null ? 'N/A（成本為 0）' : `${value.toFixed(2)}%`;
}

function run(options = {}) {
  const root = options.root || PROJECT_ROOT;
  const catalog = readCatalog(root);
  const headerErrors = REQUIRED_HEADERS.filter((header) => !catalog.headers.includes(header));
  const validated = catalog.records.map((record) => ({
    record,
    result: validateRecord(record),
  }));
  if (headerErrors.length > 0) {
    for (const entry of validated) {
      entry.result.errors.push(`缺少必要標題：${headerErrors.join(', ')}。`);
    }
  }
  const idCounts = new Map();
  for (const { result } of validated) {
    if (result.id) {
      idCounts.set(result.id, (idCounts.get(result.id) || 0) + 1);
    }
  }
  for (const entry of validated) {
    if (idCounts.get(entry.result.id) > 1) {
      entry.result.errors.push(`id ${entry.result.id} 重複。`);
    }
  }

  const invalidRows = validated.filter(({ result }) => result.errors.length > 0);
  const validRows = validated.filter(({ result }) => result.errors.length === 0);
  const negativeStockRows = validated.filter(({ record }) => /^-\d+$/.test(record.stock || ''));
  const missingCostRows = validated.filter(({ record }) => !record.cost_price);
  const missingImageRows = validated.filter(({ result }) => !result.imageUrl);
  const duplicateIds = [...idCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id, count]) => ({ id, count }));
  const pricedTiers = validRows.flatMap(({ result }) => {
    if (result.costPrice === null) {
      return [];
    }
    const prices = [
      { quantity: 1, price: result.price },
      ...result.tiers.map((tier) => ({ quantity: tier.min_qty, price: tier.price })),
    ];
    return prices.map(({ quantity, price }) => ({
      id: result.id,
      name: result.name,
      quantity,
      price,
      cost: result.costPrice,
      margin: marginPercent(price, result.costPrice),
    }));
  });
  const topMargins = [...pricedTiers]
    .filter((tier) => tier.margin !== null)
    .sort((left, right) => right.margin - left.margin)
    .slice(0, 20);
  const lossRows = [...pricedTiers]
    .filter((tier) => tier.price < tier.cost)
    .sort((left, right) => marginPercent(left.price, left.cost) -
      marginPercent(right.price, right.cost))
    .slice(0, 10);
  const lossProductCount = new Set(
    pricedTiers.filter((tier) => tier.price < tier.cost).map((tier) => tier.id)
  ).size;
  const marginLabel = (tier) => (
    tier.margin === null
      ? 'N/A（成本為 0）'
      : tier.margin < 0
        ? 'LOSS'
        : tier.margin < 10
          ? 'LOW'
          : 'OK'
  );

  const label = catalog.isExample
    ? '注意：source/products.csv 不存在；以下列出的列與金額只來自合成範例，不代表真實商品資料。'
    : '以下結果來自 source/products.csv 的唯讀 dry-run；沒有匯入資料庫。';
  const rowErrors = invalidRows.map(({ record, result }) => [
    record.__row,
    result.id || '未知',
    result.errors.join('；'),
  ]);
  const csvReport = `# F 商品 CSV 驗證報告

${label}

## 摘要

- 輸入檔：\`${path.relative(root, catalog.path)}\`
- 真實 source/products.csv：${catalog.isExample ? '不存在' : '存在'}
- 真實 source/products.csv 列數：${catalog.isExample ? 0 : catalog.records.length}
- 列數：${catalog.records.length}
- 有效列：${validRows.length}
- 無效列：${invalidRows.length}
- 重複 ID：${duplicateIds.length}
- 負庫存列：${negativeStockRows.length}
- 缺少成本價：${missingCostRows.length}
- 任一價格低於成本的商品數：${lossProductCount}
- 缺少 image_url：${missingImageRows.length}
- 缺少必要標題：${headerErrors.length ? headerErrors.join(', ') : '無'}
- 安全匯入：否（本工具只讀取並輸出報告）

## 無效列

${markdownTable(['CSV 列', '商品 ID', '原因'], rowErrors)}

## 重複商品 ID

${markdownTable(['商品 ID', '出現次數'], duplicateIds.map(({ id, count }) => [id, count]))}

## 負庫存

${markdownTable(['CSV 列', '商品 ID', '庫存'], negativeStockRows.map(({ record, result }) => [
    record.__row,
    result.id,
    record.stock,
  ]))}

## 各層價格及毛利率標記（LOSS < 0%；LOW < 10%；成本為 0 則 N/A）

${markdownTable(['商品 ID', '名稱', '門檻數量', '單價', '成本', '毛利率', '標記'], pricedTiers
    .map((tier) => [
      tier.id,
      tier.name,
      tier.quantity,
      tier.price.toFixed(2),
      tier.cost.toFixed(2),
      formatMargin(tier.margin),
      marginLabel(tier),
    ]))}

## 缺少圖片 URL

${markdownTable(['CSV 列', '商品 ID', '名稱'], missingImageRows.map(({ record, result }) => [
    record.__row,
    result.id,
    result.name,
  ]))}
`;

  const topReport = `# F 商品利潤率真相（Top 20 / Bottom 10）

${label}

計算方式：\`(tier price - cost_price) / cost_price × 100%\`。基礎售價視為購買 1 件的價格；階梯價門檻採資料列的 \`min_qty\`（亦接受匯入 CSV 使用 \`qty\`，資料庫欄位仍為 \`min_qty\`）。成本為 0 時毛利率標示 N/A，避免除零；負值標記 LOSS，0 至不足 10% 標記 LOW。

有效商品數：${validRows.length}；價格低於成本的商品數：${lossProductCount}。

## 毛利率 Top 20

${markdownTable(['商品 ID', '名稱', '門檻數量', '成本', '單價', '毛利率', '標記'], topMargins.map((tier) => [
    tier.id,
    tier.name,
    tier.quantity,
    tier.cost.toFixed(2),
    tier.price.toFixed(2),
    formatMargin(tier.margin),
    marginLabel(tier),
  ]))}

## 虧損價 Bottom 10

${markdownTable(['商品 ID', '名稱', '門檻數量', '成本', '單價', '毛利率', '標記'], lossRows.map((tier) => [
    tier.id,
    tier.name,
    tier.quantity,
    tier.cost.toFixed(2),
    tier.price.toFixed(2),
    formatMargin(tier.margin),
    marginLabel(tier),
  ]))}
`;

  writeReport(root, 'F_CSV_VALIDATION_REPORT.md', csvReport);
  writeReport(root, 'F_PROFIT_TRUTH_TOP20.md', topReport);

  return {
    totalRows: catalog.records.length,
    validRows: validRows.length,
    invalidRows: invalidRows.length,
    duplicateIds,
    negativeStock: negativeStockRows.length,
    lossProductCount,
    missingImages: missingImageRows.length,
    missingCost: missingCostRows.length,
    isExample: catalog.isExample,
    topMargins,
    lossRows,
  };
}

if (require.main === module) {
  try {
    const result = run();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`CSV validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  marginPercent,
  isValidIsoDateTime,
  parseMoney,
  parseTiers,
  run,
  validateRecord,
};
