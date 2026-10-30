'use strict';

const {
  PROJECT_ROOT,
  getHongKongDate,
  markdownTable,
  readCatalog,
  writeReport,
} = require('./f-catalog-utils');

const PRODUCT_ID_MIN = 4268n;
const PRODUCT_ID_MAX = 4294n;
const MAX_STOCK = 2147483647;
const MAX_PRICE = 99999999.99;
const REQUIRED_HEADERS = ['id', 'name', 'price', 'stock'];
const DATABASE_STATUSES = new Set(['預購中', '旅購中', '已到貨', '已下架']);

function parseMoney(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed <= MAX_PRICE ? parsed : null;
}

function parseTierPrices(value, basePrice) {
  if (value === undefined || value.trim() === '') {
    return { tiers: undefined };
  }

  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { error: 'tier_prices 必須是有效 JSON。' };
  }
  if (!Array.isArray(parsed) || parsed.length > 20) {
    return { error: 'tier_prices 必須是最多 20 項的 JSON 陣列。' };
  }

  const seenQuantities = new Set();
  const tiers = [];
  for (const tier of parsed) {
    const price = tier && parseMoney(String(tier.price));
    if (
      !tier ||
      typeof tier !== 'object' ||
      Array.isArray(tier) ||
      !Number.isSafeInteger(tier.min_qty) ||
      tier.min_qty < 2 ||
      tier.min_qty > 1000 ||
      seenQuantities.has(tier.min_qty) ||
      price === null ||
      price > basePrice
    ) {
      return { error: '階梯價須符合資料庫 min_qty 與單價規則。' };
    }
    seenQuantities.add(tier.min_qty);
    tiers.push({ min_qty: tier.min_qty, price });
  }
  tiers.sort((left, right) => left.min_qty - right.min_qty);
  let previousPrice = basePrice;
  for (const tier of tiers) {
    if (tier.price > previousPrice) {
      return { error: '購買門檻提高時，階梯單價不可增加。' };
    }
    previousPrice = tier.price;
  }
  return { tiers };
}

function parseIsoDate(value) {
  if (!value) {
    return { value: undefined };
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return { error: '日期欄位必須是有效 ISO 日期或日期時間。' };
  }
  return { value: new Date(timestamp).toISOString() };
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

function validateProductRecord(record, headers) {
  const errors = [];
  const warnings = [];
  const payload = {};
  const rawId = record.id || '';
  let id = null;
  if (!/^\d+$/.test(rawId)) {
    errors.push('id 必須是十進位 bigint。');
  } else {
    const bigintId = BigInt(rawId);
    if (bigintId < PRODUCT_ID_MIN || bigintId > PRODUCT_ID_MAX) {
      errors.push('id 必須介乎 4268 至 4294。');
    } else {
      id = bigintId.toString();
      payload.id = id;
    }
  }

  const name = (record.name || '').trim();
  if (!name || name.length > 255) {
    errors.push('name 必須是 1 至 255 個字元。');
  } else {
    payload.name = name;
  }

  const price = parseMoney(record.price || '');
  if (price === null || price <= 0) {
    errors.push('price 必須是大於 0 的有效金額。');
  } else {
    payload.price = price;
  }

  const stockText = record.stock || '';
  const stock = /^(0|[1-9]\d*)$/.test(stockText) ? Number(stockText) : NaN;
  if (!Number.isSafeInteger(stock) || stock < 0 || stock > MAX_STOCK) {
    errors.push(`stock 必須是 0 至 ${MAX_STOCK} 的整數。`);
  } else {
    payload.stock = stock;
  }

  const hasCostColumn = headers.includes('cost_price');
  const rawCost = (record.cost_price || '').trim();
  let costPrice = null;
  let loss = false;
  if (!hasCostColumn || !rawCost) {
    warnings.push('cost_price 缺失，不能計算真 margin。');
  } else {
    costPrice = parseMoney(rawCost);
    if (costPrice === null) {
      errors.push('cost_price 必須是非負有效金額。');
    } else if (price !== null && costPrice > price) {
      loss = true;
      errors.push('cost_price 高於 price，已標記為虧損。');
    } else {
      payload.cost_price = costPrice;
    }
  }

  if (headers.includes('tier_prices')) {
    const tierResult = parseTierPrices(record.tier_prices || '', price);
    if (tierResult.error) {
      errors.push(tierResult.error);
    } else if (tierResult.tiers !== undefined) {
      payload.tier_prices = tierResult.tiers;
    }
  }

  for (const field of ['preorder_deadline', 'cutoff_datetime']) {
    if (!headers.includes(field) || !(record[field] || '').trim()) {
      continue;
    }
    const parsedDate = parseIsoDate(record[field].trim());
    if (parsedDate.error) {
      errors.push(`${field} ${parsedDate.error}`);
    } else {
      payload[field] = parsedDate.value;
    }
  }

  const imageUrl = (record.image_url || '').trim();
  if (imageUrl && !isValidImageUrl(imageUrl)) {
    errors.push('image_url 必須是網站內絕對路徑或 HTTP(S) URL。');
  } else if (headers.includes('image_url') && imageUrl) {
    payload.image_url = imageUrl;
  }

  if (headers.includes('is_active') && (record.is_active || '').trim()) {
    const normalized = record.is_active.trim().toLowerCase();
    if (normalized !== 'true' && normalized !== 'false') {
      errors.push('is_active 必須是 true 或 false。');
    } else {
      payload.is_active = normalized === 'true';
    }
  }

  const description = (record.description || '').trim();
  if (description) {
    if (description.length > 2000) {
      errors.push('description 不可超過 2000 個字元。');
    } else {
      payload.description = description;
    }
  }

  if (headers.includes('retail_price') && (record.retail_price || '').trim()) {
    const retailPrice = parseMoney(record.retail_price.trim());
    if (retailPrice === null) {
      errors.push('retail_price 必須是有效金額。');
    } else {
      payload.retail_price = retailPrice;
    }
  }

  const category = (record.category || '').trim();
  if (category) {
    if (category.length > 100) {
      errors.push('category 不可超過 100 個字元。');
    } else {
      payload.category = category;
    }
  }

  const productCode = (record.product_code || '').trim();
  if (productCode) {
    payload.product_code = productCode;
  }

  const status = (record.status || '').trim();
  if (status) {
    if (DATABASE_STATUSES.has(status)) {
      payload.status = status;
    } else {
      warnings.push('status 不符合現行資料庫狀態值，為避免猜測已略過此欄。');
    }
  }

  if (record.discount_rule && record.discount_rule.trim()) {
    warnings.push('discount_rule 未匯入；需先核實其 JSON/schema 格式。');
  }
  if (record.__extraColumns || record.__missingColumns) {
    errors.push('此列欄位數與 CSV 標題列不一致。');
  }

  const margin = costPrice === null || price === null
    ? null
    : ((price - costPrice) / price) * 100;
  if (margin !== null && margin < 0) {
    loss = true;
  }

  return {
    id: id || rawId,
    name,
    price,
    costPrice,
    stock: Number.isSafeInteger(stock) ? stock : null,
    margin,
    loss,
    payload,
    errors,
    warnings,
  };
}

function validateCatalog(root = PROJECT_ROOT) {
  const catalog = readCatalog(root);
  const headerErrors = [];
  if (catalog.missing) {
    headerErrors.push('source/products.csv 不存在。');
  }
  for (const header of REQUIRED_HEADERS) {
    if (!catalog.headers.includes(header)) {
      headerErrors.push(`缺少必要欄位：${header}。`);
    }
  }

  const results = catalog.records.map((record) => ({
    record,
    result: validateProductRecord(record, catalog.headers),
  }));
  const idCounts = new Map();
  for (const { result } of results) {
    if (result.id && /^\d+$/.test(result.id)) {
      idCounts.set(result.id, (idCounts.get(result.id) || 0) + 1);
    }
  }
  for (const { result } of results) {
    if (idCounts.get(result.id) > 1) {
      result.errors.push('id 重複。');
    }
    result.errors.push(...headerErrors);
  }

  const validRows = results.filter(({ result }) => result.errors.length === 0);
  const invalidRows = results.filter(({ result }) => result.errors.length > 0);
  const missingCostRows = results.filter(({ result }) => result.costPrice === null);
  const marginRows = results
    .filter(({ result }) => result.margin !== null)
    .map(({ result }) => result);
  return {
    catalog,
    results,
    validRows,
    invalidRows,
    missingCostRows,
    marginRows,
    headerErrors,
    lossRows: marginRows.filter((result) => result.margin < 0),
  };
}

function createMarginReport(validation) {
  const { catalog, missingCostRows, marginRows } = validation;
  const hasCostHeader = catalog.headers.includes('cost_price');
  const date = getHongKongDate();
  if (!hasCostHeader || marginRows.length === 0) {
    const reason = !hasCostHeader
      ? 'cost_price 欄位缺失，無法計算真 margin，資料不足。'
      : 'cost_price 沒有任何有效數值，無法計算真 margin，資料不足。';
    return `# F 商品毛利資料檢查\n\n- 日期：${date}\n- CSV：${catalog.missing ? 'source/products.csv 不存在' : 'source/products.csv'}\n- CSV 商品列：${catalog.records.length}\n- 成本資料：${reason}\n- 本報告不以 retail_price 或其他欄位推測成本或毛利。\n\n## 待補成本商品\n\n${markdownTable(['商品 ID', '商品名稱', '售價', '狀態'], missingCostRows.map(({ result }) => [
      result.id,
      result.name,
      result.price === null ? '無效售價' : result.price.toFixed(2),
      '待提供權威 cost_price',
    ]))}\n\n資料庫的 nullable cost_price 欄位已由既有 migration 建立；目前欠缺的是 CSV 成本資料，不應重複建立 migration。\n`;
  }

  const topRows = [...marginRows]
    .sort((left, right) => right.margin - left.margin)
    .slice(0, 20);
  const missingTable = missingCostRows.length
    ? `\n## 缺少成本的商品\n\n${markdownTable(['商品 ID', '商品名稱'], missingCostRows.map(({ result }) => [
        result.id,
        result.name,
      ]))}\n`
    : '';
  return `# 商品毛利率 Top 20\n\n- 日期：${date}\n- CSV 商品列：${catalog.records.length}\n- 毛利公式：\`(price - cost_price) / price × 100%\`\n- 僅列出可由 CSV 實際計算的商品；負毛利列會標記為虧損。\n\n${markdownTable(['商品 ID', '商品名稱', '售價', '成本', '毛利率', '標記'], topRows.map((result) => [
    result.id,
    result.name,
    result.price.toFixed(2),
    result.costPrice.toFixed(2),
    `${result.margin.toFixed(2)}%`,
    result.loss ? '虧損' : '正常',
  ]))}\n${missingTable}`;
}

function run(options = {}) {
  const root = options.root || PROJECT_ROOT;
  const validation = validateCatalog(root);
  const filename = validation.catalog.headers.includes('cost_price')
    ? 'PRODUCT_MARGIN_TOP20.md'
    : 'F_PRODUCT_MARGIN_REPORT_DT.md';
  const reportPath = writeReport(root, filename, createMarginReport(validation));
  return {
    totalRows: validation.catalog.records.length,
    validRows: validation.validRows.length,
    invalidRows: validation.invalidRows.length,
    missingCostRows: validation.missingCostRows.length,
    lossRows: validation.lossRows.length,
    reportPath,
    validation,
  };
}

if (require.main === module) {
  try {
    const { validation, ...summary } = run();
    console.log(JSON.stringify({
      ...summary,
      headerErrors: validation.headerErrors,
    }, null, 2));
    if (validation.invalidRows.length > 0 || validation.catalog.missing) {
      process.exitCode = 1;
    }
  } catch {
    console.error('CSV validation failed; details omitted.');
    process.exitCode = 1;
  }
}

module.exports = {
  DATABASE_STATUSES,
  MAX_PRICE,
  MAX_STOCK,
  PRODUCT_ID_MAX,
  PRODUCT_ID_MIN,
  createMarginReport,
  parseMoney,
  parseTierPrices,
  run,
  validateCatalog,
  validateProductRecord,
};
