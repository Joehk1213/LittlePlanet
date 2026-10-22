const crypto = require('crypto');
const express = require('express');

const MAX_INBOUND_QUANTITY = 100000;
const MISSING_RPC_CODES = new Set(['42883', 'PGRST202']);
const BATCH_SELECT_COLUMNS =
  'batch_id, product_id, quantity_received, quantity_remaining, best_before_date, received_at, is_legacy_stock';

function sendError(res, status, message) {
  return res.status(status).json({
    success: false,
    data: null,
    message
  });
}

function parsePositiveInteger(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseBatchId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    return null;
  }
  try {
    const batchId = BigInt(value);
    return batchId <= 9223372036854775807n ? value : null;
  } catch (error) {
    return null;
  }
}

function parseOrderUuid(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
    ? normalized
    : null;
}

function getHongKongDate() {
  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const parts = Object.fromEntries(dateParts.map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function parseBestBeforeDate(value) {
  if (value === undefined || value === null || value === '') {
    return { value: null };
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { error: 'best_before_date 必須是有效的 YYYY-MM-DD 日期，或留空表示無最佳使用期限。' };
  }
  if (Number(value.slice(0, 4)) < 1) {
    return { error: 'best_before_date 必須是有效的 YYYY-MM-DD 日期，或留空表示無最佳使用期限。' };
  }
  const parsedDate = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== value
  ) {
    return { error: 'best_before_date 必須是有效的 YYYY-MM-DD 日期，或留空表示無最佳使用期限。' };
  }
  if (value < getHongKongDate()) {
    return { error: '最佳使用日期不可早於香港收貨日期。' };
  }
  return { value };
}

function createInboundRouter(supabase, options = {}) {
  const router = express.Router();
  const adminToken = options.adminToken || '';
  const writeEnabled = options.writeEnabled === true;

  router.use((req, res, next) => {
    if (adminToken.length < 32 || adminToken === 'replace-with-a-long-random-secret') {
      return sendError(res, 503, '入庫服務尚未設定 INBOUND_ADMIN_TOKEN。');
    }

    const authorized = typeof options.isSessionAuthorized === 'function'
      ? options.isSessionAuthorized(req, adminToken, 'inbound')
      : (() => {
        const authorization = req.get('authorization') || '';
        const suppliedToken = authorization.startsWith('Bearer ')
          ? authorization.slice('Bearer '.length)
          : '';
        const expectedBuffer = Buffer.from(adminToken);
        const suppliedBuffer = Buffer.from(suppliedToken);
        return expectedBuffer.length === suppliedBuffer.length &&
          crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
      })();

    if (!authorized) {
      return sendError(res, 401, '沒有權限使用入庫服務。');
    }

    if (!writeEnabled) {
      return sendError(res, 503, '入庫服務需要設定 SUPABASE_SERVICE_ROLE_KEY 才可安全寫入。');
    }

    return next();
  });

  function handleRpcError(res, error, operation) {
    console.error(`${operation} Supabase RPC 失敗：`, error);

    if (error && MISSING_RPC_CODES.has(error.code)) {
      return sendError(res, 503, '入庫資料庫遷移尚未執行，請先套用入庫對賬及商品效期批次 migration。');
    }

    if (error && error.code === 'P0002') {
      return sendError(res, 404, '找不到指定商品或訂單。');
    }

    if (error && (error.code === '22023' || error.code === '23514')) {
      return sendError(res, 400, error.message || '入庫資料不符合資料庫規則。');
    }

    return sendError(res, 500, `${operation}失敗，資料庫交易已回滾，請稍後再試。`);
  }

  router.post('/receipt', async (req, res) => {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return sendError(res, 400, '入庫資料格式無效。');
      }

      const productId = parsePositiveInteger(body.product_id);
      const quantity = parsePositiveInteger(body.quantity);

      if (productId === null) {
        return sendError(res, 400, 'product_id 必須是正整數。');
      }
      if (quantity === null || quantity > MAX_INBOUND_QUANTITY) {
        return sendError(res, 400, `quantity 必須是 1 至 ${MAX_INBOUND_QUANTITY} 的整數。`);
      }

      const bestBeforeDate = parseBestBeforeDate(body.best_before_date);
      if (bestBeforeDate.error) {
        return sendError(res, 400, bestBeforeDate.error);
      }

      const { data, error } = await supabase.rpc('record_product_receipt', {
        p_product_id: productId,
        p_quantity: quantity,
        p_best_before_date: bestBeforeDate.value
      });

      if (error) {
        return handleRpcError(res, error, '記錄入庫');
      }

      if (!data || typeof data !== 'object' || data.success !== true) {
        console.error('入庫 RPC 回傳格式無效：', data);
        return sendError(res, 500, '入庫結果格式無效，請檢查資料庫 RPC。');
      }

      return res.status(200).json({
        success: true,
        data,
        message: '入庫已記錄，庫存及相關訂單明細已在資料庫交易中更新。'
      });
    } catch (error) {
      console.error('處理入庫時發生未預期錯誤：', error);
      return sendError(res, 500, '處理入庫時發生錯誤，資料庫交易未確認，請稍後再試。');
    }
  });

  router.get('/batches', async (req, res) => {
    try {
      const productId = parsePositiveInteger(req.query.product_id);
      if (productId === null) {
        return sendError(res, 400, 'product_id 必須是正整數。');
      }

      const { data: product, error: productError } = await supabase
        .from('products')
        .select('id, stock')
        .eq('id', productId)
        .maybeSingle();
      if (productError) {
        console.error('讀取批次商品時發生 Supabase 錯誤：', productError);
        return sendError(res, 500, '讀取商品庫存失敗，請稍後再試。');
      }
      if (!product) {
        return sendError(res, 404, '找不到指定商品。');
      }

      const { data: batches, error: batchError } = await supabase
        .from('product_stock_batches')
        .select(BATCH_SELECT_COLUMNS)
        .eq('product_id', productId)
        .order('is_legacy_stock', { ascending: false })
        .order('received_at', { ascending: false, nullsFirst: false })
        .order('batch_id', { ascending: false });
      if (batchError) {
        console.error('讀取商品收貨批次時發生 Supabase 錯誤：', batchError);
        if (batchError.code === '42P01' || batchError.code === 'PGRST205') {
          return sendError(res, 503, '批次資料庫 migration 尚未執行，請先套用商品效期批次 migration。');
        }
        return sendError(res, 500, '讀取商品收貨批次失敗，請稍後再試。');
      }
      if (!Array.isArray(batches)) {
        console.error('商品收貨批次查詢回傳格式無效：', batches);
        return sendError(res, 500, '商品收貨批次結果格式無效。');
      }

      return res.json({
        success: true,
        data: {
          product_id: product.id,
          current_stock: Number.isSafeInteger(product.stock) ? product.stock : 0,
          batches
        },
        message: '商品收貨批次讀取成功。'
      });
    } catch (error) {
      console.error('讀取商品收貨批次時發生未預期錯誤：', error);
      return sendError(res, 500, '讀取商品收貨批次時發生錯誤，請稍後再試。');
    }
  });

  router.patch('/batches/:batchId', async (req, res) => {
    try {
      const batchId = parseBatchId(req.params.batchId);
      if (batchId === null) {
        return sendError(res, 400, '批次編號必須是有效的正整數。');
      }

      const body = req.body;
      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        !Object.hasOwn(body, 'best_before_date') ||
        Object.keys(body).some(key => key !== 'best_before_date')
      ) {
        return sendError(res, 400, '只可提交 best_before_date 日期欄位；留空或傳入 null 可清除日期。');
      }

      const bestBeforeDate = parseBestBeforeDate(body.best_before_date);
      if (bestBeforeDate.error) {
        return sendError(res, 400, bestBeforeDate.error);
      }

      const { data, error } = await supabase
        .from('product_stock_batches')
        .update({ best_before_date: bestBeforeDate.value })
        .eq('batch_id', batchId)
        .select(BATCH_SELECT_COLUMNS)
        .maybeSingle();

      if (error) {
        console.error('更新商品批次最佳使用日期時發生 Supabase 錯誤：', error);
        if (error.code === '42P01' || error.code === 'PGRST205') {
          return sendError(res, 503, '批次資料庫 migration 尚未執行，無法更新最佳使用日期。');
        }
        if (error.code === '22023' || error.code === '23514' || error.code === '22007') {
          return sendError(res, 400, error.message || '最佳使用日期格式無效。');
        }
        return sendError(res, 500, '更新批次最佳使用日期失敗，請稍後再試。');
      }
      if (!data) {
        return sendError(res, 404, '找不到指定收貨批次。');
      }
      if (
        String(data.batch_id) !== batchId ||
        data.best_before_date !== bestBeforeDate.value
      ) {
        console.error('更新批次最佳使用日期後回傳資料不符：', data);
        return sendError(res, 500, '資料庫未回傳預期的批次日期更新結果。');
      }

      return res.json({
        success: true,
        data,
        message: bestBeforeDate.value === null
          ? '批次最佳使用日期已清除，現標示為無最佳使用日期。'
          : '批次最佳使用日期更新成功。'
      });
    } catch (error) {
      console.error('更新批次最佳使用日期時發生未預期錯誤：', error);
      return sendError(res, 500, '更新批次最佳使用日期時發生錯誤，請稍後再試。');
    }
  });

  router.post('/reconcile', async (req, res) => {
    try {
      const body = req.body === undefined ? {} : req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return sendError(res, 400, '對賬資料格式無效。');
      }

      let orderId = null;
      if (body.order_id !== undefined && body.order_id !== null) {
        orderId = parseOrderUuid(body.order_id);
        if (orderId === null) {
          return sendError(res, 400, 'order_id 必須是有效的 UUID 訂單編號。');
        }
      }

      const { data, error } = await supabase.rpc('reconcile_inbound_orders', {
        p_order_id: orderId
      });

      if (error) {
        return handleRpcError(res, error, '執行齊貨對賬');
      }

      if (!Array.isArray(data)) {
        console.error('對賬 RPC 回傳格式無效：', data);
        return sendError(res, 500, '對賬結果格式無效，請檢查資料庫 RPC。');
      }

      return res.json({
        success: true,
        data,
        message: `齊貨對賬完成，共檢查 ${data.length} 張訂單。`
      });
    } catch (error) {
      console.error('執行齊貨對賬時發生未預期錯誤：', error);
      return sendError(res, 500, '執行齊貨對賬時發生錯誤，資料庫交易未確認，請稍後再試。');
    }
  });

  return router;
}

module.exports = createInboundRouter;
