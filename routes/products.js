const express = require('express');
const crypto = require('crypto');

const PRODUCT_STATUSES = new Set(['預購中', '旅購中', '已到貨', '已下架', '上架', '暫停供應', '正常上架']);
const MISSING_COLUMN_ERROR_CODES = new Set(['42703', 'PGRST204']);
const MISSING_CATEGORY_TABLE_ERROR_CODES = new Set(['42P01', 'PGRST205']);
const MISSING_STOCK_BATCH_TABLE_ERROR_CODES = new Set(['42P01', 'PGRST205']);
const MAX_STOCK = 2147483647;
const MAX_PRICE = 99999999.99;
const MAX_IMAGE_URL_LENGTH = 2048;
const MAX_CATEGORY_NAME_LENGTH = 100;
const MAX_PRODUCTS_PAGE_SIZE = 100;
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

    if (typeof options.isSessionAuthorized === 'function' &&
        (options.isSessionAuthorized(req, 'products') ||
         options.isSessionAuthorized(req, adminToken, 'products'))) {
      return true;
    }

    const authorization = req.get('authorization') || '';
    const suppliedToken = authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';
    const expectedBuffer = Buffer.from(adminToken);
    const suppliedBuffer = Buffer.from(suppliedToken);
    if (expectedBuffer.length === suppliedBuffer.length &&
        crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)) {
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

      if (search !== undefined) {
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
            const publicProduct = filterPublicProductFields(product);
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

      if (!isValidProductId(req.params.productId)) {
        return res.status(400).json({
          success: false,
          data: null,
          message: '產品編號格式無效。'
        });
      }

      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return res.status(400).json({
          success: false,
          data: null,
          message: '庫存更新資料格式無效。'
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

      const { data, error } = await supabase
        .from('products')
        .update({ stock })
        .eq('id', req.params.productId)
        .select('*')
        .maybeSingle();

      if (error) {
        console.error('更新產品庫存時發生 Supabase 錯誤：', error);
        if (MISSING_COLUMN_ERROR_CODES.has(error.code)) {
          return res.status(503).json({
            success: false,
            data: null,
            message: '產品庫存欄位尚未建立，請先套用產品庫存 migration。'
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
        if (!data) {
          return res.status(404).json({
            success: false,
            data: null,
            message: '找不到指定產品。'
          });
        }
        console.error('產品庫存更新回傳格式無效：', data);
        return res.status(500).json({
          success: false,
          data: null,
          message: '資料庫未回傳預期的庫存更新結果。'
        });
      }

      return res.json({
        success: true,
        data: filterPublicProductFields(data),
        message: '產品庫存更新成功。'
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
        data: filterPublicProductFields(data),
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
        data: filterPublicProductFields(data),
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