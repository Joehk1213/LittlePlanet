'use strict';

const express = require('express');
const { getCustomerSession } = require('../middleware/customer-session');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRODUCT_ID_PATTERN =
  /^(?:[1-9]\d{0,18}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const MAX_REVIEW_PAGE_SIZE = 100;
const MAX_COMMENT_LENGTH = 1000;
const MISSING_SCHEMA_CODES = new Set(['42P01', '42703', 'PGRST202', 'PGRST204']);

function sendError(res, status, message) {
  return res.status(status).json({ success: false, data: null, message });
}

function parseInteger(value, minimum, maximum, defaultValue) {
  if (value === undefined) return defaultValue;
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : null;
}

function isSameOriginRequest(req) {
  const origin = req.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).origin === `${req.protocol}://${req.get('host')}`;
  } catch (error) {
    return false;
  }
}

function createReviewsRouter(supabase, options = {}) {
  const router = express.Router();
  const readEnabled = options.readEnabled === true;
  const writeEnabled = options.writeEnabled === true;
  const customerSessionSecret = options.customerSessionSecret || '';

  function checkService(res, enabled, description) {
    if (!enabled || !supabase) {
      sendError(res, 503, `${description}尚未設定 Supabase 服務權限。`);
      return false;
    }
    return true;
  }

  function authorizeReviewAdmin(req, res) {
    if (
      typeof options.isSessionAuthorized !== 'function' ||
      !options.isSessionAuthorized(req, 'reviews')
    ) {
      sendError(res, 401, '沒有評價管理權限，請使用具評價管理權限的管理員 Session 登入。');
      return false;
    }
    return true;
  }

  router.get('/products/:productId/reviews', async (req, res) => {
    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=30');
    if (!checkService(res, readEnabled, '商品評價服務')) return;
    const productId = req.params.productId;
    const limit = parseInteger(req.query.limit, 1, MAX_REVIEW_PAGE_SIZE, 20);
    const offset = parseInteger(req.query.offset, 0, 2147483647, 0);
    if (!PRODUCT_ID_PATTERN.test(productId) || limit === null || offset === null) {
      return sendError(
        res,
        400,
        `商品 ID 無效；limit 必須是 1 至 ${MAX_REVIEW_PAGE_SIZE} 的整數，offset 必須是非負整數。`
      );
    }

    try {
      const { data, error } = await supabase.rpc('get_product_reviews', {
        p_product_id: productId,
        p_limit: limit,
        p_offset: offset,
      });
      if (error) {
        console.error('讀取商品評價失敗：', error);
        if (MISSING_SCHEMA_CODES.has(error.code)) {
          return sendError(res, 503, '商品評價資料庫 migration 尚未完成。');
        }
        return sendError(res, 500, '讀取商品評價失敗，請稍後再試。');
      }
      if (
        !data ||
        typeof data !== 'object' ||
        Array.isArray(data) ||
        !Array.isArray(data.reviews) ||
        !Number.isSafeInteger(data.review_count) ||
        typeof data.average_rating !== 'number'
      ) {
        console.error('商品評價 RPC 回傳格式無效：', data);
        return sendError(res, 500, '商品評價資料格式無效。');
      }
      return res.json({
        success: true,
        data: {
          product_id: productId,
          average_rating: data.average_rating,
          review_count: data.review_count,
          reviews: data.reviews,
          limit,
          offset,
        },
        message: '商品評價載入完成。',
      });
    } catch (error) {
      console.error('處理商品評價查詢時發生未預期錯誤：', error);
      return sendError(res, 500, '讀取商品評價時發生錯誤，請稍後再試。');
    }
  });

  router.get('/reviews/summary', async (req, res) => {
    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=30');
    if (!checkService(res, readEnabled, '商品評價服務')) return;
    const productIds =
      typeof req.query.product_ids === 'string'
        ? [...new Set(req.query.product_ids.split(',').map((value) => value.trim()))]
        : [];
    if (
      productIds.length < 1 ||
      productIds.length > MAX_REVIEW_PAGE_SIZE ||
      productIds.some((productId) => !PRODUCT_ID_PATTERN.test(productId))
    ) {
      return sendError(res, 400, '商品評價摘要的商品 ID 清單無效。');
    }
    try {
      const { data, error } = await supabase.rpc('get_product_review_summaries', {
        p_product_ids: productIds,
      });
      if (error) {
        console.error('讀取商品評價摘要失敗：', error);
        if (MISSING_SCHEMA_CODES.has(error.code)) {
          return sendError(res, 503, '商品評價資料庫 migration 尚未完成。');
        }
        return sendError(res, 500, '讀取商品評價摘要失敗，請稍後再試。');
      }
      if (
        !Array.isArray(data) ||
        data.some(
          (item) =>
            !item ||
            typeof item.product_id !== 'string' ||
            typeof item.average_rating !== 'number' ||
            !Number.isSafeInteger(Number(item.review_count))
        )
      ) {
        console.error('商品評價摘要 RPC 回傳格式無效：', data);
        return sendError(res, 500, '商品評價摘要資料格式無效。');
      }
      const summaries = Object.fromEntries(
        data.map((item) => [
          item.product_id,
          {
            average_rating: item.average_rating,
            review_count: Number(item.review_count),
          },
        ])
      );
      return res.json({
        success: true,
        data: { summaries },
        message: '商品評價摘要載入完成。',
      });
    } catch (error) {
      console.error('處理商品評價摘要時發生未預期錯誤：', error);
      return sendError(res, 500, '讀取商品評價摘要時發生錯誤，請稍後再試。');
    }
  });

  router.post('/reviews', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!checkService(res, writeEnabled, '提交商品評價')) return;
    if (!isSameOriginRequest(req)) {
      return sendError(res, 403, '提交評價要求必須來自同一網站。');
    }
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return sendError(res, 400, '評價資料格式無效。');
    }
    const productId =
      typeof body.product_id === 'string' || typeof body.product_id === 'number'
        ? String(body.product_id).trim()
        : '';
    const phone =
      typeof body.customer_phone === 'string' ? body.customer_phone.trim().replace(/^\+/, '') : '';
    const orderNumber =
      typeof body.order_number === 'string' ? body.order_number.trim().toUpperCase() : '';
    const customerName = typeof body.customer_name === 'string' ? body.customer_name.trim() : '';
    if (
      !PRODUCT_ID_PATTERN.test(productId) ||
      !/^[0-9]{8,15}$/.test(phone) ||
      !orderNumber ||
      orderNumber.length > 50 ||
      UUID_PATTERN.test(orderNumber) ||
      !Number.isInteger(body.rating) ||
      body.rating < 1 ||
      body.rating > 5 ||
      typeof body.comment !== 'string' ||
      body.comment.trim().length < 1 ||
      body.comment.trim().length > MAX_COMMENT_LENGTH ||
      customerName.length > 50 ||
      /[\u0000-\u001f\u007f]/.test(customerName)
    ) {
      return sendError(res, 400, '請提供有效訂單、商品、1 至 5 分評分及不超過 1000 字的評價。');
    }

    const phoneVariants = [
      ...new Set([
        phone,
        `+${phone}`,
        phone.startsWith('852') ? phone.slice(3) : `852${phone}`,
        phone.startsWith('852') ? `+${phone.slice(3)}` : `+852${phone}`,
      ]),
    ];
    try {
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('order_id')
        .in('customer_phone', phoneVariants)
        .eq('order_number', orderNumber)
        .maybeSingle();
      if (orderError) {
        console.error('驗證評價訂單失敗：', orderError);
        if (MISSING_SCHEMA_CODES.has(orderError.code)) {
          return sendError(res, 503, '訂單評價資料庫 migration 尚未完成。');
        }
        return sendError(res, 500, '無法確認訂單資料，請稍後再試。');
      }
      if (!order) {
        return sendError(res, 404, '找不到符合的訂單，請確認電話號碼與正式訂單編號。');
      }

      const { data: purchasedItems, error: itemError } = await supabase
        .from('order_items')
        .select('item_id')
        .eq('order_id', order.order_id)
        .eq('product_id', productId)
        .limit(1);
      if (itemError) {
        console.error('驗證評價商品購買紀錄失敗：', itemError);
        return sendError(res, 500, '無法確認訂單商品，請稍後再試。');
      }
      if (!Array.isArray(purchasedItems) || purchasedItems.length === 0) {
        return sendError(res, 403, '只能評價此訂單中已購買的商品。');
      }

      const { data: review, error: insertError } = await supabase
        .from('product_reviews')
        .insert({
          product_id: productId,
          order_id: order.order_id,
          customer_phone: phone,
          customer_name: customerName || '已驗證買家',
          rating: body.rating,
          comment: body.comment.trim(),
          status: 'pending',
        })
        .select('review_id,product_id,order_id,rating,comment,customer_name,status,created_at')
        .single();
      if (insertError) {
        if (insertError.code === '23505') {
          return sendError(res, 409, '你已提交過此商品的評價，每件商品只可評價一次。');
        }
        console.error('儲存商品評價失敗：', insertError);
        if (MISSING_SCHEMA_CODES.has(insertError.code)) {
          return sendError(res, 503, '商品評價資料庫 migration 尚未完成。');
        }
        return sendError(res, 500, '儲存商品評價失敗，請稍後再試。');
      }
      if (!review || typeof review.review_id !== 'string') {
        console.error('新增商品評價未回傳有效資料：', review);
        return sendError(res, 500, '商品評價儲存結果無效。');
      }
      return res.status(201).json({
        success: true,
        data: { review },
        message: '評價已提交，管理員審核後會公開顯示。',
      });
    } catch (error) {
      console.error('處理訂單評價提交時發生未預期錯誤：', error);
      return sendError(res, 500, '提交評價時發生錯誤，請稍後再試。');
    }
  });

  router.post('/products/:productId/reviews', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!checkService(res, writeEnabled, '提交商品評價')) return;
    if (!isSameOriginRequest(req)) {
      return sendError(res, 403, '提交評價要求必須來自同一網站。');
    }
    const productId = req.params.productId;
    if (!PRODUCT_ID_PATTERN.test(productId)) {
      return sendError(res, 400, '商品 ID 格式無效。');
    }
    const session = getCustomerSession(req, customerSessionSecret);
    if (!session) {
      return sendError(res, 401, '會員工作階段已失效，請先驗證會員身份。');
    }
    const body = req.body;
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      !Number.isInteger(body.rating) ||
      body.rating < 1 ||
      body.rating > 5 ||
      typeof body.comment !== 'string' ||
      body.comment.trim().length < 1 ||
      body.comment.trim().length > MAX_COMMENT_LENGTH
    ) {
      return sendError(
        res,
        400,
        `評分必須是 1 至 5 的整數，評價內容必須為 1 至 ${MAX_COMMENT_LENGTH} 個字元。`
      );
    }

    try {
      const { data: purchased, error: purchaseError } = await supabase.rpc(
        'has_customer_purchased_product',
        {
          p_customer_phone: session.phone,
          p_product_id: productId,
        }
      );
      if (purchaseError) {
        console.error('驗證評價商品購買紀錄失敗：', purchaseError);
        if (MISSING_SCHEMA_CODES.has(purchaseError.code)) {
          return sendError(res, 503, '評價購買驗證資料庫 migration 尚未完成。');
        }
        return sendError(res, 500, '無法確認商品購買紀錄，請稍後再試。');
      }
      if (purchased !== true) {
        return sendError(res, 403, '只有購買過此商品的會員可以提交評價。');
      }

      const { data: review, error: insertError } = await supabase
        .from('product_reviews')
        .insert({
          product_id: productId,
          customer_phone: session.phone,
          customer_name: '已驗證買家',
          rating: body.rating,
          comment: body.comment.trim(),
          status: 'pending',
        })
        .select('review_id,product_id,rating,comment,created_at')
        .single();
      if (insertError) {
        if (insertError.code === '23505') {
          return sendError(res, 409, '你已提交過此商品的評價，每位會員每件商品只可評價一次。');
        }
        console.error('儲存商品評價失敗：', insertError);
        if (MISSING_SCHEMA_CODES.has(insertError.code)) {
          return sendError(res, 503, '商品評價資料庫 migration 尚未完成。');
        }
        return sendError(res, 500, '儲存商品評價失敗，請稍後再試。');
      }
      if (!review || typeof review.review_id !== 'string') {
        console.error('新增商品評價未回傳有效資料：', review);
        return sendError(res, 500, '商品評價儲存結果無效。');
      }
      return res.status(201).json({
        success: true,
        data: { review },
        message: '商品評價已成功提交。',
      });
    } catch (error) {
      console.error('處理商品評價提交時發生未預期錯誤：', error);
      return sendError(res, 500, '提交商品評價時發生錯誤，請稍後再試。');
    }
  });

  router.get('/admin/reviews', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!checkService(res, readEnabled, '評價管理')) return;
    if (!authorizeReviewAdmin(req, res)) return;
    const limit = parseInteger(req.query.limit, 1, MAX_REVIEW_PAGE_SIZE, 50);
    const offset = parseInteger(req.query.offset, 0, 2147483647, 0);
    if (limit === null || offset === null) {
      return sendError(
        res,
        400,
        `limit 必須是 1 至 ${MAX_REVIEW_PAGE_SIZE} 的整數，offset 必須是非負整數。`
      );
    }
    try {
      const { data, error, count } = await supabase
        .from('product_reviews')
        .select(
          'review_id,product_id,order_id,customer_phone,customer_name,rating,comment,status,created_at',
          { count: 'exact' }
        )
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) {
        req.log.error({ event: 'admin_review_list_failure', code: error.code }, '讀取管理員評價清單失敗');
        if (MISSING_SCHEMA_CODES.has(error.code)) {
          return sendError(res, 503, '商品評價資料庫 migration 尚未完成。');
        }
        return sendError(res, 500, '讀取評價清單失敗，請稍後再試。');
      }
      if (!Array.isArray(data)) {
        req.log.error({ event: 'invalid_admin_review_list' }, '管理員評價清單格式無效');
        return sendError(res, 500, '評價清單資料格式無效。');
      }
      return res.json({
        success: true,
        data: {
          reviews: data,
          total_count: Number.isSafeInteger(count) ? count : data.length,
          limit,
          offset,
        },
        message: '評價清單載入完成。',
      });
    } catch (error) {
      req.log.error({ event: 'admin_review_list_unexpected_failure' }, '處理管理員評價清單時發生未預期錯誤');
      return sendError(res, 500, '讀取評價清單時發生錯誤，請稍後再試。');
    }
  });

  router.patch('/admin/reviews/:reviewId/status', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!checkService(res, writeEnabled, '評價管理')) return;
    if (!authorizeReviewAdmin(req, res)) return;
    if (!UUID_PATTERN.test(req.params.reviewId)) {
      return sendError(res, 400, '評價 ID 格式無效。');
    }
    const status = req.body && req.body.status;
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return sendError(res, 400, '評價狀態只可為待審核、公開或拒絕。');
    }
    try {
      const { data, error } = await supabase
        .from('product_reviews')
        .update({ status })
        .eq('review_id', req.params.reviewId)
        .select('review_id,status')
        .maybeSingle();
      if (error) {
        req.log.error({ event: 'admin_review_status_update_failure', code: error.code }, '更新評價審核狀態失敗');
        if (MISSING_SCHEMA_CODES.has(error.code)) {
          return sendError(res, 503, '商品評價審核資料庫 migration 尚未完成。');
        }
        return sendError(res, 500, '更新評價審核狀態失敗，請稍後再試。');
      }
      if (!data) return sendError(res, 404, '找不到要更新的商品評價。');
      return res.json({
        success: true,
        data,
        message:
          status === 'approved'
            ? '評價已公開。'
            : status === 'rejected'
              ? '評價已拒絕。'
              : '評價已設為待審核。',
      });
    } catch (error) {
      req.log.error({ event: 'admin_review_status_update_unexpected_failure' }, '處理評價審核狀態時發生未預期錯誤');
      return sendError(res, 500, '更新評價審核狀態時發生錯誤，請稍後再試。');
    }
  });

  router.delete('/admin/reviews/:reviewId', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!checkService(res, writeEnabled, '評價管理')) return;
    if (!authorizeReviewAdmin(req, res)) return;
    if (!UUID_PATTERN.test(req.params.reviewId)) {
      return sendError(res, 400, '評價 ID 格式無效。');
    }
    try {
      const { data, error } = await supabase
        .from('product_reviews')
        .delete()
        .eq('review_id', req.params.reviewId)
        .select('review_id')
        .maybeSingle();
      if (error) {
        req.log.error({ event: 'admin_review_delete_failure', code: error.code }, '刪除商品評價失敗');
        if (MISSING_SCHEMA_CODES.has(error.code)) {
          return sendError(res, 503, '商品評價資料庫 migration 尚未完成。');
        }
        return sendError(res, 500, '刪除商品評價失敗，請稍後再試。');
      }
      if (!data) return sendError(res, 404, '找不到要刪除的商品評價。');
      return res.json({
        success: true,
        data: { review_id: data.review_id },
        message: '商品評價已刪除。',
      });
    } catch (error) {
      req.log.error({ event: 'admin_review_delete_unexpected_failure' }, '處理商品評價刪除時發生未預期錯誤');
      return sendError(res, 500, '刪除商品評價時發生錯誤，請稍後再試。');
    }
  });

  return router;
}

module.exports = createReviewsRouter;
