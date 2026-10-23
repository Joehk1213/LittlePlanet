const express = require('express');
const crypto = require('crypto');

const PRODUCT_STATUSES = new Set(['預購中', '旅購中', '已到貨', '已下架', '上架', '暫停供應', '正常上架']);
const MISSING_COLUMN_ERROR_CODES = new Set(['42703', 'PGRST204']);
const MISSING_CATEGORY_TABLE_ERROR_CODES = new Set(['42P01', 'PGRST205']);
const MISSING_STOCK_BATCH_TABLE_ERROR_CODES = new Set(['42P01', 'PGRST205']);
const MAX_STOCK = 2147483647;
const MAX_PRICE = 99999999.99;
const MAX_IMAGE_URL_LENGTH = 2048;
const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;
const PRODUCT_IMAGE_BUCKET = 'product-images';
const INVENTORY_ADJUSTMENT_REASONS = new Set([
  '損毀',
  '員工自用',
  '實體盤點差異',
  '其他'
]);
const PRODUCT_IMAGE_TYPES = new Map([
  ['image/jpeg', { extension: 'jpg', signature: buffer =>
    buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff }],
  ['image/png', { extension: 'png', signature: buffer =>
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) }],
  ['image/webp', { extension: 'webp', signature: buffer =>
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP' }]
]);
const MAX_CATEGORY_NAME_LENGTH = 100;
const MAX_PRODUCTS_PAGE_SIZE = 100;
const MAX_PUBLIC_PRODUCT_IDS = 100;
const MAX_PRODUCT_SEARCH_LENGTH = 100;
const PRODUCT_SORTS = new Map([
  ['default', ['created_at', false]],
  ['newest', ['created_at', false]],
  ['price-asc', ['price', true]],
  ['price-desc', ['price', false]]
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
  'created_at'
]);

function parseQueryInteger(value, minimum, maximum, defaultValue) {
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null;
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
  return expectedBuffer.length === suppliedBuffer.length &&
    expectedBuffer.length > 0 &&
    crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
}

function filterAdminProductFields(product) {
  return {
    ...filterPublicProductFields(product),
    ...(Object.hasOwn(product, 'cost_price') ? { cost_price: product.cost_price } : {})
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
  return typeof value === 'string' &&
    value.length <= 100 &&
    (/^[1-9]\d*$/.test(value) || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

function isValidProductRecordId(value) {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value);
}

function validateProductFields(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: '商品資料格式無效。' };
  }
  if (typeof body.name !== 'string' || body.name.trim().length < 1 ||
      body.name.trim().length > 255) {
    return { error: '商品名稱必須是 1 至 255 個字元。' };
  }
  const price = body.price;
  if (typeof price !== 'number' || !Number.isFinite(price) || price < 0 || price > MAX_PRICE ||
      Math.abs(price * 100 - Math.round(price * 100)) > 1e-8) {
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
    ...(stock !== undefined ? { stock } : {})
  };

  if (Object.hasOwn(body, 'status')) {
    if (typeof body.status !== 'string' || !PRODUCT_STATUSES.has(body.status.trim())) {
      return { error: '商品狀態格式無效。' };
    }
    values.status = body.status.trim();
  }

  if (Object.hasOwn(body, 'category')) {
    if (typeof body.category !== 'string' ||
        body.category.trim().length < 1 ||
        body.category.trim().length > MAX_CATEGORY_NAME_LENGTH) {
      return { error: `商品分類必須是 1 至 ${MAX_CATEGORY_NAME_LENGTH} 個字元。` };
    }
    values.category = body.category.trim();
  }

  if (suppliedImageUrl !== undefined && suppliedImageUrl !== null && suppliedImageUrl !== '') {
    if (typeof suppliedImageUrl !== 'string' || suppliedImageUrl.trim().length > MAX_IMAGE_URL_LENGTH) {
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

function createProductsRouter(supabase, options = {}) {
  const router = express.Router();
  const adminToken = options.adminToken || '';
  const stockWriteEnabled = options.stockWriteEnabled === true;

  function requireAdmin(req, res) {
    if (!adminToken || adminToken.length < 32 || adminToken.startsWith('replace-with-')) {
      res.status(503).json({
        success: false,
        data: null,
        message: '商品管理服務尚未設定有效的管理員 Token。'
      });
      return false;
    }

    if (hasAdminAccess(req, options, adminToken)) {
      return true;
    }

    res.status(401).json({
      success: false,
      data: null,
      message: '沒有權限管理商品。'
    });
    return false;
  }

  function sendMissingCategoriesError(res) {
    return res.status(503).json({
      success: false,
      data: null,
      message: '產品分類資料表尚未建立，請先執行產品分類 migration。'
    });
  }

  router.post(
    '/images',
    express.raw({
      type: [...PRODUCT_IMAGE_TYPES.keys()],
      limit: MAX_PRODUCT_IMAGE_BYTES
    }),
    async (req, res) => {
      try {
        if (!requireAdmin(req, res)) {
          return;
        }
        if (!stockWriteEnabled) {
          return res.status(503).json({
            success: false,
            data: null,
            message: '商品圖片上傳需要設定 SUPABASE_SERVICE_ROLE_KEY。'
          });
        }

        const contentType = (req.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
        const imageType = PRODUCT_IMAGE_TYPES.get(contentType);
        const imageBuffer = req.body;
        if (
          !imageType ||
          !Buffer.isBuffer(imageBuffer) ||
          imageBuffer.length < 1 ||
          imageBuffer.length > MAX_PRODUCT_IMAGE_BYTES ||
          !imageType.signature(imageBuffer)
        ) {
          return res.status(400).json({
            success: false,
            data: null,
            message: '圖片格式或內容無效，請上傳 JPG、PNG 或 WebP（最大 5MB）。'
          });
        }

        const objectPath = `${crypto.randomUUID()}.${imageType.extension}`;
        const { error } = await supabase.storage
          .from(PRODUCT_IMAGE_BUCKET)
          .upload(objectPath, imageBuffer, {
            cacheControl: '31536000',
            contentType,
            upsert: false
          });
        if (error) {
          console.error('上傳商品圖片至 Supabase Storage 失敗：', error);
          return res.status(
            error.statusCode === '404' || error.statusCode === 404 ? 503 : 500
          ).json({
            success: false,
            data: null,
            message: error.statusCode === '404' || error.statusCode === 404
              ? '商品圖片 Storage bucket 尚未建立，請先套用圖片 Storage migration。'
              : '商品圖片上傳失敗，請稍後再試。'
          });
        }

        const { data } = supabase.storage
          .from(PRODUCT_IMAGE_BUCKET)
          .getPublicUrl(objectPath);
        if (!data || typeof data.publicUrl !== 'string' || !data.publicUrl) {
          console.error('Supabase Storage 未回傳商品圖片公開網址。');
          return res.status(500).json({
            success: false,
            data: null,
            message: '商品圖片網址建立失敗。'
          });
        }

        return res.status(201).json({
          success: true,
          data: { image_url: data.publicUrl },
          message: '商品圖片上傳成功。'
        });
      } catch (error) {
        console.error('處理商品圖片上傳時發生未預期錯誤：', error);
        return res.status(500).json({
          success: false,
          data: null,
          message: '商品圖片上傳時發生錯誤，請稍後再試。'
        });
      }
    }
  );

  async function validateCategoryExists(category, res, existingProductId) {
    const { data, error } = await supabase
      .from('product_categories')
      .select('name')
      .eq('name', category)
      .maybeSingle();
    if (error) {
      console.error('確認產品分類時發生 Supabase 錯誤：', error);
      if (MISSING_CATEGORY_TABLE_ERROR_CODES.has(error.code)) {
        sendMissingCategoriesError(res);
      } else {
        res.status(500).json({
          success: false,
          data: null,
          message: '確認產品分類失敗，請稍後再試。'
        });
      }
      return false;
    }
    if (!data) {
      if (existingProductId) {
        const { data: product, error: productError } = await supabase
          .from('products')
          .select('category')
          .eq('id', existingProductId)
          .maybeSingle();
        if (productError) {
          console.error('確認產品既有分類時發生 Supabase 錯誤：', productError);
          res.status(500).json({
            success: false,
            data: null,
            message: '確認產品既有分類失敗，請稍後再試。'
          });
          return false;
        }
        if (!product) {
          res.status(404).json({
            success: false,
            data: null,
            message: '找不到指定產品。'
          });
          return false;
        }
        if (product.category === category) {
          return true;
        }
      }
      res.status(400).json({
        success: false,
        data: null,
        message: '請選擇已存在的產品分類。'
      });
      return false;
    }
    return true;
  }

  router.get('/categories', async (req, res) => {
    try {
      if (!requireAdmin(req, res)) {
        return;
      }
      if (!stockWriteEnabled) {
        return res.status(503).json({
          success: false,
          data: null,
          message: '產品分類讀取需要設定 SUPABASE_SERVICE_ROLE_KEY。'
        });
      }
      const { data, error } = await supabase
        .from('product_categories')
        .select('name, label')
        .order('name', { ascending: true });
      if (error) {
        console.error('讀取產品分類時發生 Supabase 錯誤：', error);
        if (MISSING_CATEGORY_TABLE_ERROR_CODES.has(error.code)) {
          return sendMissingCategoriesError(res);
        }
        return res.status(500).json({
          success: false,
          data: null,
          message: '讀取產品分類失敗，請稍後再試。'
        });
      }
      return res.json({
        success: true,
        data: { categories: data },
        message: '產品分類讀取成功。'
      });
    } catch (error) {
      console.error('讀取產品分類時發生未預期錯誤：', error);
      return res.status(500).json({
        success: false,
        data: null,
        message: '讀取產品分類時發生錯誤，請稍後再試。'
      });
    }
  });

  router.post('/categories', async (req, res) => {
    try {
      if (!requireAdmin(req, res)) {
        return;
      }
      if (!stockWriteEnabled) {
        return res.status(503).json({
          success: false,
          data: null,
          message: '新增產品分類需要設定 SUPABASE_SERVICE_ROLE_KEY。'
        });
      }
      const name = req.body && typeof req.body.name === 'string'
        ? req.body.name.trim()
        : '';
      if (name.length < 1 || name.length > MAX_CATEGORY_NAME_LENGTH) {
        return res.status(400).json({
          success: false,
          data: null,
          message: `分類名稱必須是 1 至 ${MAX_CATEGORY_NAME_LENGTH} 個字元。`
        });
      }

      const { data: existingCategories, error: listError } = await supabase
        .from('product_categories')
        .select('name, label');
      if (listError) {
        console.error('檢查產品分類時發生 Supabase 錯誤：', listError);
        if (MISSING_CATEGORY_TABLE_ERROR_CODES.has(listError.code)) {
          return sendMissingCategoriesError(res);
        }
        return res.status(500).json({
          success: false,
          data: null,
          message: '檢查產品分類失敗，請稍後再試。'
        });
      }

      const normalizedName = name.toLocaleLowerCase();
      const existing = existingCategories.find(category =>
        category.name.trim().toLocaleLowerCase() === normalizedName
      );
      if (existing) {
        return res.json({
          success: true,
          data: { category: existing },
          message: '此分類已存在，已選用現有分類。'
        });
      }

      const { data, error } = await supabase
        .from('product_categories')
        .insert({ name, label: name })
        .select('name, label')
        .single();
      if (error) {
        console.error('新增產品分類時發生 Supabase 錯誤：', error);
        if (MISSING_CATEGORY_TABLE_ERROR_CODES.has(error.code)) {
          return sendMissingCategoriesError(res);
        }
        if (error.code === '23505') {
          const { data: categoriesAfterConflict, error: reloadError } = await supabase
            .from('product_categories')
            .select('name, label');
          if (reloadError) {
            console.error('重新讀取重複產品分類時發生 Supabase 錯誤：', reloadError);
          } else {
            const duplicate = categoriesAfterConflict.find(category =>
              category.name.trim().toLocaleLowerCase() === normalizedName
            );
            if (duplicate) {
              return res.json({
                success: true,
                data: { category: duplicate },
                message: '此分類已存在，已選用現有分類。'
              });
            }
          }
        }
        return res.status(500).json({
          success: false,
          data: null,
          message: '新增產品分類失敗，請稍後再試。'
        });
      }
      return res.status(201).json({
        success: true,
        data: { category: data },
        message: '產品分類新增成功。'
      });
    } catch (error) {
      console.error('新增產品分類時發生未預期錯誤：', error);
      return res.status(500).json({
        success: false,
        data: null,
        message: '新增產品分類時發生錯誤，請稍後再試。'
      });
    }
  });

  router.get('/', async (req, res) => {
    const parsedLimit = parseQueryInteger(
      req.query.limit,
      1,
      MAX_PRODUCTS_PAGE_SIZE,
      50
    );
    const parsedOffset = parseQueryInteger(req.query.offset, 0, 2147483647, 0);
    const sort = req.query.sort === undefined ? 'default' : req.query.sort;
    const search = req.query.search === undefined
      ? undefined
      : typeof req.query.search === 'string'
        ? req.query.search.trim()
        : req.query.search;
    const category = req.query.category;
    const status = req.query.status;
    const includeBestBeforeDates = req.query.include_best_before_dates === 'true';
    const requestedIds = req.query.ids === undefined
      ? null
      : typeof req.query.ids === 'string'
        ? req.query.ids.split(',').map(id => id.trim())
        : null;
    if (
      parsedLimit === null ||
      parsedOffset === null ||
      parsedOffset + parsedLimit > 2147483647 ||
      typeof sort !== 'string' ||
      !PRODUCT_SORTS.has(sort) ||
      (req.query.search !== undefined && (
        typeof req.query.search !== 'string' ||
        search.length < 1 ||
        search.length > MAX_PRODUCT_SEARCH_LENGTH ||
        /[,%_*\\()]/.test(search)
      )) ||
      (category !== undefined && typeof category !== 'string') ||
      (status !== undefined && typeof status !== 'string') ||
      (req.query.ids !== undefined && (
        requestedIds === null ||
        requestedIds.length < 1 ||
        requestedIds.length > MAX_PUBLIC_PRODUCT_IDS ||
        requestedIds.some(id => !isValidProductId(id)) ||
        new Set(requestedIds).size !== requestedIds.length ||
        search !== undefined ||
        category !== undefined ||
        status !== undefined
      )) ||
      (req.query.include_best_before_dates !== undefined &&
        !['true', 'false'].includes(req.query.include_best_before_dates))
    ) {
      return res.status(400).json({
        success: false,
        data: null,
        message: '商品搜尋、排序或分頁參數無效。'
      });
    }

    try {
      let query = supabase
        .from('products')
        .select('*', { count: 'exact' });

      if (requestedIds) {
        query = query.in('id', requestedIds);
      } else if (search !== undefined) {
        query = query.or(`name.ilike.*${search}*,description.ilike.*${search}*`);
      }
      if (category) {
        query = query.eq('category', category.trim());
      }
      if (status) {
        query = query.eq('status', status.trim());
      }

      if (req.query.sort !== undefined) {
        const [sortColumn, ascending] = PRODUCT_SORTS.get(sort);
        query = query.order(sortColumn, { ascending });
      }

      const { data, count, error } = await query.range(
        parsedOffset,
        parsedOffset + parsedLimit - 1
      );
      if (error) throw error;

      let batchSummaries = new Map();
      if (includeBestBeforeDates && data.length > 0) {
        const productIds = data.map(product => String(product.id));
        const { data: batches, error: batchError } = await supabase
          .from('product_stock_batches')
          .select('product_id, best_before_date, is_legacy_stock')
          .in('product_id', productIds);

        if (batchError) {
          console.error('讀取公開商品批次效期摘要時發生 Supabase 錯誤：', batchError);
          return res.status(
            MISSING_STOCK_BATCH_TABLE_ERROR_CODES.has(batchError.code) ? 503 : 500
          ).json({
            success: false,
            data: null,
            message: MISSING_STOCK_BATCH_TABLE_ERROR_CODES.has(batchError.code)
              ? '商品批次資料尚未就緒，請確認效期批次 migration 已部署。'
              : '無法讀取商品批次效期摘要。'
          });
        }
        if (!Array.isArray(batches)) {
          console.error('商品批次效期摘要回傳格式無效：', batches);
          return res.status(500).json({
            success: false,
            data: null,
            message: '商品批次效期摘要格式無效。'
          });
        }

        batchSummaries = new Map(productIds.map(id => [id, {
          best_before_dates: new Set(),
          has_undated_batch: false,
          has_legacy_unknown_date: false
        }]));
        for (const batch of batches) {
          if (
            !batch ||
            typeof batch.product_id !== 'string' && typeof batch.product_id !== 'number' ||
            typeof batch.is_legacy_stock !== 'boolean' ||
            batch.best_before_date !== null &&
              (typeof batch.best_before_date !== 'string' ||
                !/^\d{4}-\d{2}-\d{2}$/.test(batch.best_before_date))
          ) {
            console.error('商品批次效期摘要資料列格式無效：', batch);
            return res.status(500).json({
              success: false,
              data: null,
              message: '商品批次效期摘要資料格式無效。'
            });
          }
          const summary = batchSummaries.get(String(batch.product_id));
          if (!summary) continue;
          if (batch.is_legacy_stock) {
            summary.has_legacy_unknown_date = true;
          } else if (batch.best_before_date === null) {
            summary.has_undated_batch = true;
          } else {
            summary.best_before_dates.add(batch.best_before_date);
          }
        }
      }

      return res.json({
        success: true,
        data: {
          products: data.map(product => {
            const publicProduct = hasAdminAccess(req, options, adminToken)
              ? filterAdminProductFields(product)
              : filterPublicProductFields(product);
            if (includeBestBeforeDates) {
              const summary = batchSummaries.get(String(product.id));
              publicProduct.best_before_summary = {
                best_before_dates: summary
                  ? [...summary.best_before_dates].sort()
                  : [],
                has_undated_batch: summary ? summary.has_undated_batch : false,
                has_legacy_unknown_date: summary
                  ? summary.has_legacy_unknown_date
                  : false
              };
            }
            return publicProduct;
          }),
          total_count: count !== null ? count : data.length,
          limit: parsedLimit,
          offset: parsedOffset
        },
        message: '產品列表讀取成功'
      });
    } catch (error) {
      console.error('讀取產品列表時發生 Supabase 錯誤：', error);
      return res.status(500).json({
        success: false,
        data: null,
        message: '無法讀取產品列表'
      });
    }
  });

  router.get('/inventory-alerts', async (req, res) => {
    try {
      if (!requireAdmin(req, res)) {
        return;
      }
      if (!stockWriteEnabled) {
        return res.status(503).json({
          success: false,
          data: null,
          message: '庫存警示需要設定 SUPABASE_SERVICE_ROLE_KEY。'
        });
      }

      const safetyStock = parseQueryInteger(req.query.safety_stock, 0, 100000, 3);
      const targetStock = parseQueryInteger(req.query.target_stock, 1, 100000, 10);
      const slowDays = parseQueryInteger(req.query.slow_days, 1, 3650, 30);
      if (
        safetyStock === null ||
        targetStock === null ||
        targetStock < safetyStock ||
        slowDays === null
      ) {
        return res.status(400).json({
          success: false,
          data: null,
          message: '庫存安全線、目標庫存或滯銷天數參數無效。'
        });
      }

      const { data, error } = await supabase.rpc('get_product_inventory_alerts', {
        p_safety_stock: safetyStock,
        p_target_stock: targetStock,
        p_slow_days: slowDays
      });
      if (error) {
        console.error('讀取商品庫存警示時發生 Supabase RPC 錯誤：', error);
        if (
          error.code === '42883' ||
          error.code === 'PGRST202' ||
          MISSING_COLUMN_ERROR_CODES.has(error.code)
        ) {
          return res.status(503).json({
            success: false,
            data: null,
            message: '庫存警示資料庫 migration 尚未執行。'
          });
        }
        return res.status(500).json({
          success: false,
          data: null,
          message: '讀取商品庫存警示失敗，請稍後再試。'
        });
      }
      if (!Array.isArray(data)) {
        console.error('商品庫存警示 RPC 回傳格式無效：', data);
        return res.status(500).json({
          success: false,
          data: null,
          message: '商品庫存警示回傳格式無效。'
        });
      }
      return res.json({
        success: true,
        data: {
          alerts: data,
          safety_stock: safetyStock,
          target_stock: targetStock,
          slow_days: slowDays
        },
        message: '商品補貨與滯銷警示已載入。'
      });
    } catch (error) {
      console.error('讀取商品庫存警示時發生未預期錯誤：', error);
      return res.status(500).json({
        success: false,
        data: null,
        message: '讀取商品庫存警示時發生錯誤，請稍後再試。'
      });
    }
  });

  router.get('/adjustments', async (req, res) => {
    try {
      if (!requireAdmin(req, res)) {
        return;
      }
      if (!stockWriteEnabled) {
        return res.status(503).json({
          success: false,
          data: null,
          message: '庫存調整記錄需要設定 SUPABASE_SERVICE_ROLE_KEY。'
        });
      }

      const limit = parseQueryInteger(req.query.limit, 1, 100, 50);
      if (limit === null) {
        return res.status(400).json({
          success: false,
          data: null,
          message: '庫存調整記錄 limit 必須是 1 至 100 的整數。'
        });
      }

      const { data: adjustments, error } = await supabase
        .from('inventory_adjustments')
        .select('adjustment_id,product_id,quantity_before,quantity_delta,quantity_after,reason,note,actor,created_at')
        .order('created_at', { ascending: false })
        .order('adjustment_id', { ascending: false })
        .limit(limit);
      if (error) {
        console.error('讀取庫存調整記錄時發生 Supabase 錯誤：', error);
        if (MISSING_COLUMN_ERROR_CODES.has(error.code) ||
            error.code === '42P01' || error.code === 'PGRST205') {
          return res.status(503).json({
            success: false,
            data: null,
            message: '庫存調整資料庫 migration 尚未執行。'
          });
        }
        return res.status(500).json({
          success: false,
          data: null,
          message: '讀取庫存調整記錄失敗，請稍後再試。'
        });
      }
      if (!Array.isArray(adjustments)) {
        console.error('庫存調整記錄查詢回傳格式無效：', adjustments);
        return res.status(500).json({
          success: false,
          data: null,
          message: '庫存調整記錄回傳格式無效。'
        });
      }

      const productIds = [...new Set(adjustments.map(row => String(row.product_id)))];
      let productNames = new Map();
      if (productIds.length > 0) {
        const { data: products, error: productsError } = await supabase
          .from('products')
          .select('id,name,product_name')
          .in('id', productIds);
        if (productsError) {
          console.error('讀取庫存調整商品名稱時發生 Supabase 錯誤：', productsError);
          return res.status(500).json({
            success: false,
            data: null,
            message: '讀取庫存調整商品名稱失敗，請稍後再試。'
          });
        }
        if (!Array.isArray(products)) {
          console.error('庫存調整商品名稱查詢回傳格式無效：', products);
          return res.status(500).json({
            success: false,
            data: null,
            message: '庫存調整商品名稱回傳格式無效。'
          });
        }
        productNames = new Map(products.map(product => [
          String(product.id),
          product.product_name || product.name || `商品 #${product.id}`
        ]));
      }

      return res.json({
        success: true,
        data: {
          adjustments: adjustments.map(adjustment => ({
            ...adjustment,
            product_name: productNames.get(String(adjustment.product_id)) ||
              `商品 #${adjustment.product_id}`
          }))
        },
        message: '庫存調整記錄已載入。'
      });
    } catch (error) {
      console.error('讀取庫存調整記錄時發生未預期錯誤：', error);
      return res.status(500).json({
        success: false,
        data: null,
        message: '讀取庫存調整記錄時發生錯誤，請稍後再試。'
      });
    }
  });

  router.post('/:productId/adjustments', async (req, res) => {
    try {
      if (!requireAdmin(req, res)) {
        return;
      }
      if (!stockWriteEnabled) {
        return res.status(503).json({
          success: false,
          data: null,
          message: '庫存調整需要設定 SUPABASE_SERVICE_ROLE_KEY 才可安全寫入。'
        });
      }
      if (
        !isValidProductRecordId(req.params.productId) ||
        !Number.isSafeInteger(Number(req.params.productId))
      ) {
        return res.status(400).json({
          success: false,
          data: null,
          message: '產品編號格式無效。'
        });
      }

      const body = req.body;
      const allowedFields = new Set(['quantity_delta', 'reason', 'note']);
      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        Object.keys(body).some(key => !allowedFields.has(key))
      ) {
        return res.status(400).json({
          success: false,
          data: null,
          message: '庫存調整資料格式無效。'
        });
      }
      if (
        !Number.isSafeInteger(body.quantity_delta) ||
        body.quantity_delta === 0 ||
        Math.abs(body.quantity_delta) > 100000
      ) {
        return res.status(400).json({
          success: false,
          data: null,
          message: 'quantity_delta 必須是 -100000 至 100000 之間且不等於零的整數。'
        });
      }
      if (typeof body.reason !== 'string' || !INVENTORY_ADJUSTMENT_REASONS.has(body.reason)) {
        return res.status(400).json({
          success: false,
          data: null,
          message: '請選擇有效的庫存調整原因。'
        });
      }
      const note = body.note === undefined || body.note === null ? null : body.note;
      if (
        note !== null &&
        (typeof note !== 'string' || note.trim().length > 500 || /[\u0000-\u001f\u007f]/.test(note))
      ) {
        return res.status(400).json({
          success: false,
          data: null,
          message: '庫存調整備註不可超過 500 個字元或包含控制字元。'
        });
      }

      const { data, error } = await supabase.rpc('adjust_product_inventory', {
        p_product_id: Number(req.params.productId),
        p_quantity_delta: body.quantity_delta,
        p_reason: body.reason,
        p_note: note ? note.trim() : null,
        p_actor: 'admin'
      });
      if (error) {
        console.error('調整產品庫存時發生 Supabase RPC 錯誤：', error);
        if (error.code === '42883' || error.code === 'PGRST202') {
          return res.status(503).json({
            success: false,
            data: null,
            message: '庫存調整資料庫 migration 尚未執行。'
          });
        }
        if (error.code === 'P0002') {
          return res.status(404).json({
            success: false,
            data: null,
            message: '找不到指定商品。'
          });
        }
        if (error.code === '22023' || error.code === '23514') {
          return res.status(400).json({
            success: false,
            data: null,
            message: error.message || '庫存調整資料不符合資料庫規則。'
          });
        }
        return res.status(500).json({
          success: false,
          data: null,
          message: '調整產品庫存失敗，請稍後再試。'
        });
      }
      if (!data || typeof data !== 'object' || !Number.isSafeInteger(data.adjustment_id)) {
        console.error('庫存調整 RPC 回傳格式無效：', data);
        return res.status(500).json({
          success: false,
          data: null,
          message: '庫存調整結果格式無效。'
        });
      }
      return res.json({
        success: true,
        data,
        message: '庫存調整已記錄。'
      });
    } catch (error) {
      console.error('調整產品庫存時發生未預期錯誤：', error);
      return res.status(500).json({
        success: false,
        data: null,
        message: '調整產品庫存時發生錯誤，請稍後再試。'
      });
    }
  });

  router.patch('/:productId/stock', async (req, res) => {
    try {
      if (!requireAdmin(req, res)) {
        return;
      }

      if (!stockWriteEnabled) {
        return res.status(503).json({
          success: false,
          data: null,
          message: '庫存更新需要設定 SUPABASE_SERVICE_ROLE_KEY 才可安全寫入。'
        });
      }

      if (
        !isValidProductRecordId(req.params.productId) ||
        !Number.isSafeInteger(Number(req.params.productId))
      ) {
        return res.status(400).json({
          success: false,
          data: null,
          message: '產品編號格式無效。'
        });
      }

      const body = req.body;
      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        Object.keys(body).some(key => !['stock', 'reason', 'note'].includes(key))
      ) {
        return res.status(400).json({
          success: false,
          data: null,
          message: '庫存更新需提交 stock、reason 及可選 note 欄位。'
        });
      }

      const stock = parseStock(body.stock);
      if (stock === null) {
        return res.status(400).json({
          success: false,
          data: null,
          message: `stock 必須是 0 至 ${MAX_STOCK} 的整數。`
        });
      }
      if (typeof body.reason !== 'string' || !INVENTORY_ADJUSTMENT_REASONS.has(body.reason)) {
        return res.status(400).json({
          success: false,
          data: null,
          message: '請選擇有效的庫存調整原因。'
        });
      }
      const note = body.note === undefined || body.note === null ? null : body.note;
      if (
        note !== null &&
        (typeof note !== 'string' || note.trim().length > 500 || /[\u0000-\u001f\u007f]/.test(note))
      ) {
        return res.status(400).json({
          success: false,
          data: null,
          message: '庫存調整備註不可超過 500 個字元或包含控制字元。'
        });
      }

      const { data, error } = await supabase.rpc('set_product_inventory', {
        p_product_id: Number(req.params.productId),
        p_stock: stock,
        p_reason: body.reason,
        p_note: note ? note.trim() : null,
        p_actor: 'admin'
      });

      if (error) {
        console.error('更新產品庫存時發生 Supabase RPC 錯誤：', error);
        if (
          error.code === '42883' ||
          error.code === 'PGRST202' ||
          MISSING_COLUMN_ERROR_CODES.has(error.code)
        ) {
          return res.status(503).json({
            success: false,
            data: null,
            message: '庫存調整資料庫 migration 尚未執行。'
          });
        }
        if (error.code === 'P0002') {
          return res.status(404).json({
            success: false,
            data: null,
            message: '找不到指定產品。'
          });
        }
        if (error.code === '22023' || error.code === '23514') {
          return res.status(400).json({
            success: false,
            data: null,
            message: error.message || '庫存數量不符合資料庫規則。'
          });
        }
        return res.status(500).json({
          success: false,
          data: null,
          message: '更新產品庫存失敗，請稍後再試。'
        });
      }

      if (!data || typeof data !== 'object' || data.stock !== stock) {
        console.error('產品庫存更新回傳格式無效：', data);
        return res.status(500).json({
          success: false,
          data: null,
          message: '資料庫未回傳預期的庫存更新結果。'
        });
      }

      return res.json({
        success: true,
        data: { ...data, id: req.params.productId },
        message: data.quantity_delta === 0
          ? '庫存數量沒有變更，未新增調整記錄。'
          : '產品庫存更新成功並已記錄調整原因。'
      });
    } catch (error) {
      console.error('更新產品庫存時發生未預期錯誤：', error);
      return res.status(500).json({
        success: false,
        data: null,
        message: '更新產品庫存時發生錯誤，請稍後再試。'
      });
    }
  });

  router.post('/', async (req, res) => {
    try {
      if (!requireAdmin(req, res)) {
        return;
      }
      if (!stockWriteEnabled) {
        return res.status(503).json({
          success: false,
          data: null,
          message: '商品新增需要設定 SUPABASE_SERVICE_ROLE_KEY 才可安全寫入。'
        });
      }
      const validated = validateProductFields(req.body);
      if (validated.error) {
        return res.status(400).json({
          success: false,
          data: null,
          message: validated.error
        });
      }
      if (validated.values.category &&
          !(await validateCategoryExists(validated.values.category, res))) {
        return;
      }

      const bestBeforeDate = validated.values.best_before_date;
      delete validated.values.best_before_date;

      const { data, error } = await supabase
        .from('products')
        .insert({
          status: '預購中',
          stock: 0,
          ...validated.values
        })
        .select('*')
        .single();

      if (error) {
        console.error('新增產品時發生 Supabase 錯誤：', error);
        if (MISSING_COLUMN_ERROR_CODES.has(error.code)) {
          return res.status(503).json({
            success: false,
            data: null,
            message: '商品資料庫欄位尚未完成 migration。'
          });
        }
        return res.status(500).json({
          success: false,
          data: null,
          message: '新增產品失敗，請稍後再試。'
        });
      }

      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        console.error('新增產品 Supabase 回傳格式無效。');
        return res.status(500).json({
          success: false,
          data: null,
          message: '新增產品結果格式無效。'
        });
      }

      // 儲存批次效期
      if (bestBeforeDate && data.id) {
        await supabase.from('product_stock_batches').insert({
          product_id: data.id,
          best_before_date: bestBeforeDate,
          is_legacy_stock: false
        });
      }

      return res.status(201).json({
        success: true,
        data: filterAdminProductFields(data),
        message: '產品新增成功。'
      });
    } catch (error) {
      console.error('新增產品時發生未預期錯誤：', error);
      return res.status(500).json({
        success: false,
        data: null,
        message: '新增產品時發生錯誤。'
      });
    }
  });

  router.patch('/:productId', async (req, res) => {
    console.log('接收到前端傳來的 PATCH 原始 Body:', req.body);
    try {
      if (!requireAdmin(req, res)) {
        return;
      }
      if (!stockWriteEnabled) {
        return res.status(503).json({
          success: false,
          data: null,
          message: '商品更新需要設定 SUPABASE_SERVICE_ROLE_KEY 才可安全寫入。'
        });
      }
      if (!isValidProductRecordId(req.params.productId)) {
        return res.status(400).json({
          success: false,
          data: null,
          message: '產品編號格式無效。'
        });
      }
      const validated = validateProductFields(req.body);
      if (validated.error) {
        return res.status(400).json({
          success: false,
          data: null,
          message: validated.error
        });
      }
      if (validated.values.category &&
          !(await validateCategoryExists(validated.values.category, res, req.params.productId))) {
        return;
      }

      const bestBeforeDate = validated.values.best_before_date;
      const hasBestBeforeProvided = Object.hasOwn(validated.values, 'best_before_date');
      delete validated.values.best_before_date;

      const { data, error } = await supabase
        .from('products')
        .update(validated.values)
        .eq('id', req.params.productId)
        .select('*')
        .maybeSingle();

      if (error) {
        console.error('更新產品時發生 Supabase 錯誤：', error);
        if (MISSING_COLUMN_ERROR_CODES.has(error.code)) {
          return res.status(503).json({
            success: false,
            data: null,
            message: '商品資料庫欄位尚未完成 migration。'
          });
        }
        return res.status(500).json({
          success: false,
          data: null,
          message: '更新產品失敗，請稍後再試。'
        });
      }
      if (!data) {
        return res.status(404).json({
          success: false,
          data: null,
          message: '找不到指定產品。'
        });
      }

      if (hasBestBeforeProvided) {
        const { error: batchDeleteError } = await supabase
          .from('product_stock_batches')
          .delete()
          .eq('product_id', req.params.productId);
        if (batchDeleteError) {
          console.error('刪除產品舊批次效期時發生 Supabase 錯誤：', batchDeleteError);
          return res.status(500).json({
            success: false,
            data: null,
            message: '更新產品效期失敗，請稍後再試。'
          });
        }

        if (bestBeforeDate) {
          const { error: batchInsertError } = await supabase.from('product_stock_batches').insert({
            product_id: Number(req.params.productId),
            best_before_date: bestBeforeDate,
            is_legacy_stock: false,
            quantity_received: data.stock ?? 0,
            quantity_remaining: data.stock ?? 0
          });
          if (batchInsertError) {
            console.error('新增產品批次效期時發生 Supabase 錯誤：', batchInsertError);
            return res.status(500).json({
              success: false,
              data: null,
              message: '更新產品效期失敗，請稍後再試。'
            });
          }
        }
      }

      return res.json({
        success: true,
        data: filterAdminProductFields(data),
        message: '產品更新成功。'
      });
    } catch (error) {
      console.error('更新產品時發生未預期錯誤：', error);
      return res.status(500).json({
        success: false,
        data: null,
        message: '更新產品時發生錯誤，請稍後再試。'
      });
    }
  });

  router.delete('/:productId', async (req, res) => {
    try {
      if (!requireAdmin(req, res)) {
        return;
      }
      if (!stockWriteEnabled) {
        return res.status(503).json({
          success: false,
          data: null,
          message: '商品刪除需要設定 SUPABASE_SERVICE_ROLE_KEY 才可安全寫入。'
        });
      }
      if (!isValidProductRecordId(req.params.productId)) {
        return res.status(400).json({
          success: false,
          data: null,
          message: '產品編號格式無效。'
        });
      }
      const { data, error } = await supabase
        .from('products')
        .delete()
        .eq('id', req.params.productId)
        .select('id')
        .maybeSingle();
      if (error) {
        console.error('刪除產品時發生 Supabase 錯誤：', error);
        if (error.code === '23503') {
          return res.status(409).json({
            success: false,
            data: null,
            message: '產品已被訂單或其他資料引用，無法刪除。'
          });
        }
        return res.status(500).json({
          success: false,
          data: null,
          message: '刪除產品失敗，請稍後再試。'
        });
      }
      if (!data) {
        return res.status(404).json({
          success: false,
          data: null,
          message: '找不到指定產品。'
        });
      }
      return res.json({
        success: true,
        data: { id: data.id },
        message: '產品刪除成功。'
      });
    } catch (codeError) {
      console.error('刪除產品時發生未預期錯誤：', codeError);
      return res.status(500).json({
        success: false,
        data: null,
        message: '刪除產品時發生錯誤，請稍後再試。'
      });
    }
  });

  return router;
}

module.exports = createProductsRouter;