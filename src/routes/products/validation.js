'use strict';

const crypto = require('crypto');

const PRODUCT_STATUSES = new Set([
  '預購中',
  '旅購中',
  '已到貨',
  '已下架',
  '上架',
  '暫停供應',
  '正常上架',
]);
const MISSING_COLUMN_ERROR_CODES = new Set(['42703', 'PGRST204']);
const MISSING_TABLE_ERROR_CODES = new Set(['42P01', 'PGRST205']);
const MISSING_STOCK_BATCH_TABLE_ERROR_CODES = new Set(['42P01', 'PGRST205']);
const MISSING_SCHEMA_ERROR_CODES = new Set([
  ...MISSING_COLUMN_ERROR_CODES,
  ...MISSING_TABLE_ERROR_CODES,
]);
const MAX_STOCK = 2147483647;
const MAX_PRICE = 99999999.99;
const MAX_IMAGE_URL_LENGTH = 2048;
const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;
const PRODUCT_IMAGE_BUCKET = 'product-images';
const INVENTORY_ADJUSTMENT_REASONS = new Set(['損毀', '員工自用', '實體盤點差異', '其他']);
const PRODUCT_IMAGE_TYPES = new Map([
  [
    'image/jpeg',
    {
      extension: 'jpg',
      signature: (buffer) =>
        buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
    },
  ],
  [
    'image/png',
    {
      extension: 'png',
      signature: (buffer) =>
        buffer.length >= 8 &&
        buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    },
  ],
  [
    'image/webp',
    {
      extension: 'webp',
      signature: (buffer) =>
        buffer.length >= 12 &&
        buffer.toString('ascii', 0, 4) === 'RIFF' &&
        buffer.toString('ascii', 8, 12) === 'WEBP',
    },
  ],
]);
const MAX_CATEGORY_NAME_LENGTH = 100;
const MAX_PRODUCTS_PAGE_SIZE = 100;
const MAX_PUBLIC_PRODUCT_IDS = 100;
const MAX_PRODUCT_SEARCH_LENGTH = 100;
const PRODUCT_SORTS = new Map([
  ['default', ['created_at', false]],
  ['newest', ['created_at', false]],
  ['price-asc', ['price', true]],
  ['price-desc', ['price', false]],
]);
const PUBLIC_PRODUCT_FIELDS = new Set([
  'id',
  'product_id',
  'product_code',
  'name',
  'description',
  'price',
  'retail_price',
  'stock',
  'image_url',
  'category',
  'is_active',
  'status',
  'discount_rule',
  'cutoff_datetime',
  'tier_prices',
  'preorder_deadline',
  'created_at',
]);

function parseQueryInteger(value, minimum, maximum, defaultValue) {
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function filterPublicProductFields(product) {
  return Object.fromEntries(
    Object.entries(product).filter(([field]) => PUBLIC_PRODUCT_FIELDS.has(field))
  );
}

function hasAdminAccess(req, options, adminToken) {
  if (
    typeof options.isSessionAuthorized === 'function' &&
    (options.isSessionAuthorized(req, 'products') ||
      options.isSessionAuthorized(req, adminToken, 'products'))
  ) {
    return true;
  }

  const authorization = req.get('authorization') || '';
  const suppliedToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : '';
  const expectedBuffer = Buffer.from(adminToken);
  const suppliedBuffer = Buffer.from(suppliedToken);
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    expectedBuffer.length > 0 &&
    crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

function filterAdminProductFields(product) {
  return {
    ...filterPublicProductFields(product),
    ...(Object.hasOwn(product, 'cost_price') ? { cost_price: product.cost_price } : {}),
  };
}

function parseStock(value) {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_STOCK
    ? value
    : null;
}

function isValidProductId(value) {
  return (
    typeof value === 'string' &&
    value.length <= 100 &&
    (/^[1-9]\d*$/.test(value) ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
  );
}

function isValidProductRecordId(value) {
  return (
    typeof value === 'string' &&
    ((/^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))) ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
  );
}

function isMissingSchemaError(error) {
  return Boolean(error && MISSING_SCHEMA_ERROR_CODES.has(error.code));
}

function validateProductFields(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: '商品資料格式無效。' };
  }
  if (
    typeof body.name !== 'string' ||
    body.name.trim().length < 1 ||
    body.name.trim().length > 255
  ) {
    return { error: '商品名稱必須是 1 至 255 個字元。' };
  }
  const price = body.price;
  if (
    typeof price !== 'number' ||
    !Number.isFinite(price) ||
    price < 0 ||
    price > MAX_PRICE ||
    Math.abs(price * 100 - Math.round(price * 100)) > 1e-8
  ) {
    return { error: '商品價格必須是最多兩位小數的非負數。' };
  }

  if (Object.hasOwn(body, 'cost_price')) {
    const costPrice = body.cost_price;
    if (
      costPrice !== null &&
      (typeof costPrice !== 'number' ||
        !Number.isFinite(costPrice) ||
        costPrice < 0 ||
        costPrice > MAX_PRICE ||
        Math.abs(costPrice * 100 - Math.round(costPrice * 100)) > 1e-8)
    ) {
      return { error: '成本價必須是留空或最多兩位小數的非負數。' };
    }
  }

  let stock = undefined;
  if (Object.hasOwn(body, 'stock')) {
    stock = parseStock(body.stock);
    if (stock === null) {
      return { error: `存貨數量必須是 0 至 ${MAX_STOCK} 的整數。` };
    }
  }

  const suppliedImageUrl = body.image_url ?? body.image;
  const values = {
    name: body.name.trim(),
    price,
    ...(Object.hasOwn(body, 'cost_price') ? { cost_price: body.cost_price } : {}),
    ...(stock !== undefined ? { stock } : {}),
  };

  if (Object.hasOwn(body, 'status')) {
    if (typeof body.status !== 'string' || !PRODUCT_STATUSES.has(body.status.trim())) {
      return { error: '商品狀態格式無效。' };
    }
    values.status = body.status.trim();
  }

  if (Object.hasOwn(body, 'category')) {
    if (
      typeof body.category !== 'string' ||
      body.category.trim().length < 1 ||
      body.category.trim().length > MAX_CATEGORY_NAME_LENGTH
    ) {
      return { error: `商品分類必須是 1 至 ${MAX_CATEGORY_NAME_LENGTH} 個字元。` };
    }
    values.category = body.category.trim();
  }

  if (suppliedImageUrl !== undefined && suppliedImageUrl !== null && suppliedImageUrl !== '') {
    if (
      typeof suppliedImageUrl !== 'string' ||
      suppliedImageUrl.trim().length > MAX_IMAGE_URL_LENGTH
    ) {
      return { error: '圖片網址格式無效。' };
    }
    const imageUrl = suppliedImageUrl.trim();
    if (!(imageUrl.startsWith('/') && !imageUrl.startsWith('//'))) {
      try {
        const parsed = new URL(imageUrl);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          return { error: '圖片網址必須是 HTTP(S) 網址或網站內的絕對路徑。' };
        }
      } catch (error) {
        return { error: '圖片網址必須是 HTTP(S) 網址或網站內的絕對路徑。' };
      }
    }
    values.image_url = imageUrl;
  } else if (Object.hasOwn(body, 'image_url') || Object.hasOwn(body, 'image')) {
    values.image_url = null;
  }

  if (Object.hasOwn(body, 'description')) {
    if (body.description !== null && body.description !== undefined) {
      if (typeof body.description !== 'string' || body.description.trim().length > 2000) {
        return { error: '商品描述不能超過 2000 個字元。' };
      }
      values.description = body.description.trim();
    } else {
      values.description = null;
    }
  }

  if (Object.hasOwn(body, 'tier_prices')) {
    let tierPrices = body.tier_prices;
    if (typeof tierPrices === 'string') {
      try {
        tierPrices = JSON.parse(tierPrices);
      } catch (error) {
        return { error: '階梯價必須是有效 JSON 陣列。' };
      }
    }
    if (!Array.isArray(tierPrices) || tierPrices.length > 20) {
      return { error: '階梯價必須是最多 20 項的陣列。' };
    }
    const normalizedTiers = [];
    const minimumQuantities = new Set();
    for (const tier of tierPrices) {
      if (
        !tier ||
        typeof tier !== 'object' ||
        Array.isArray(tier) ||
        !Number.isSafeInteger(tier.min_qty) ||
        tier.min_qty < 2 ||
        tier.min_qty > 1000 ||
        minimumQuantities.has(tier.min_qty) ||
        typeof tier.price !== 'number' ||
        !Number.isFinite(tier.price) ||
        tier.price < 0 ||
        tier.price > price ||
        Math.abs(tier.price * 100 - Math.round(tier.price * 100)) > 1e-8
      ) {
        return { error: '每個階梯價須有不重複的 2 至 1000 件門檻，以及不高於原價的兩位小數單價。' };
      }
      minimumQuantities.add(tier.min_qty);
      normalizedTiers.push({ min_qty: tier.min_qty, price: tier.price });
    }
    normalizedTiers.sort((left, right) => left.min_qty - right.min_qty);
    let previousTierPrice = price;
    for (const tier of normalizedTiers) {
      if (tier.price > previousTierPrice) {
        return { error: '購買門檻提高時，階梯單價不可高於較低門檻的單價。' };
      }
      previousTierPrice = tier.price;
    }
    values.tier_prices = normalizedTiers;
  }

  if (Object.hasOwn(body, 'preorder_deadline')) {
    const rawDeadline = body.preorder_deadline;
    if (rawDeadline === null || rawDeadline === '') {
      values.preorder_deadline = null;
    } else if (typeof rawDeadline !== 'string' || !Number.isFinite(Date.parse(rawDeadline))) {
      return { error: '預購截單時間格式無效。' };
    } else {
      values.preorder_deadline = new Date(rawDeadline).toISOString();
    }
  }

  if (Object.hasOwn(body, 'best_before_date')) {
    let rawDate = body.best_before_date ? String(body.best_before_date).trim() : null;
    if (rawDate) {
      // 如果前端傳來的是 DD/MM/YYYY 或是帶斜線的格式，自動轉為 YYYY-MM-DD
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(rawDate)) {
        const parts = rawDate.split('/');
        rawDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
      }
      // 驗證是否符合 YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
        values.best_before_date = rawDate;
      } else {
        values.best_before_date = null;
      }
    } else {
      values.best_before_date = null;
    }
  }

  return { values };
}

module.exports = {
  PRODUCT_STATUSES,
  MISSING_COLUMN_ERROR_CODES,
  MISSING_TABLE_ERROR_CODES,
  MISSING_STOCK_BATCH_TABLE_ERROR_CODES,
  MISSING_SCHEMA_ERROR_CODES,
  MAX_STOCK,
  MAX_PRICE,
  MAX_IMAGE_URL_LENGTH,
  MAX_PRODUCT_IMAGE_BYTES,
  PRODUCT_IMAGE_BUCKET,
  INVENTORY_ADJUSTMENT_REASONS,
  PRODUCT_IMAGE_TYPES,
  MAX_CATEGORY_NAME_LENGTH,
  MAX_PRODUCTS_PAGE_SIZE,
  MAX_PUBLIC_PRODUCT_IDS,
  MAX_PRODUCT_SEARCH_LENGTH,
  PRODUCT_SORTS,
  PUBLIC_PRODUCT_FIELDS,
  parseQueryInteger,
  filterPublicProductFields,
  hasAdminAccess,
  filterAdminProductFields,
  parseStock,
  isValidProductId,
  isValidProductRecordId,
  isMissingSchemaError,
  validateProductFields
};
