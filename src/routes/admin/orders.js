'use strict';

const express = require('express');
const normalizePhone = require('../../utils/normalize-phone');
const { notifyShippedOrder } = require('../../utils/whatsapp-notify');
const {
  ORDER_STATUSES,
  respondToStatusTransition,
  transitionAdminOrderStatus,
} = require('../../utils/admin-order-status');

const ORDER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHONE_VARIANT_PREFIX = '852';
const MAX_PAGE_SIZE = 100;
const MAX_ORDER_ITEMS = 5000;
const PAYMENT_PROOF_BUCKET = 'payment-proofs';
const MISSING_SCHEMA_CODES = new Set(['42P01', '42703', '42883', 'PGRST202', 'PGRST204']);

function sendError(res, status, message) {
  return res.status(status).json({
    success: false,
    data: null,
    message,
  });
}

function parseInteger(value, fallback) {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseHongKongDateBoundary(value, exclusiveEnd = false) {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  if (exclusiveEnd) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  date.setUTCHours(date.getUTCHours() - 8);
  return date.toISOString();
}

function normalizePhoneVariants(value) {
  const normalized = normalizePhone(value);
  if (!normalized) {
    return null;
  }
  const localPhone = normalized.startsWith(PHONE_VARIANT_PREFIX)
    ? normalized.slice(PHONE_VARIANT_PREFIX.length)
    : normalized;
  return [
    ...new Set([
      normalized,
      localPhone,
      `${PHONE_VARIANT_PREFIX}${localPhone}`,
      `+${normalized}`,
      `+${PHONE_VARIANT_PREFIX}${localPhone}`,
    ]),
  ];
}

function roundMoney(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const amount = Number(value);
  return Number.isFinite(amount)
    ? Math.round((amount + Number.EPSILON) * 100) / 100
    : null;
}

function createAdminOrdersRouter(supabase, options = {}) {
  const router = express.Router();

  function authorize(req, res) {
    if (
      typeof options.isSessionAuthorized !== 'function' ||
      !options.isSessionAuthorized(req, 'orders')
    ) {
      sendError(res, 401, '請先以具備訂單管理權限的管理員 Session 登入。');
      return false;
    }
    if (!supabase || options.serviceRoleAvailable === false) {
      sendError(res, 503, '訂單管理服務尚未設定資料庫服務權限。');
      return false;
    }
    return true;
  }

  function logDatabaseError(req, event, error) {
    req.log.error(
      { event, code: error && typeof error.code === 'string' ? error.code : 'UNKNOWN' },
      'Admin order database operation failed'
    );
  }

  router.get('/', async (req, res) => {
    if (!authorize(req, res)) {
      return;
    }
    res.set('Cache-Control', 'no-store');

    const limit = parseInteger(req.query.limit, 50);
    const offset = parseInteger(req.query.offset, 0);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE ||
        !Number.isSafeInteger(offset)) {
      return sendError(res, 400, `limit 必須是 1 至 ${MAX_PAGE_SIZE} 的整數，offset 必須是非負整數。`);
    }

    let phoneVariants = null;
    if (req.query.phone !== undefined) {
      phoneVariants = normalizePhoneVariants(req.query.phone);
      if (!phoneVariants) {
        return sendError(res, 400, 'phone 必須是 8 至 15 位數字。');
      }
    }

    const status = req.query.status;
    if (status !== undefined && !ORDER_STATUSES.has(status)) {
      return sendError(res, 400, 'status 無效。');
    }
    const from = parseHongKongDateBoundary(req.query.from);
    const to = parseHongKongDateBoundary(req.query.to, true);
    if ((req.query.from !== undefined && !from) || (req.query.to !== undefined && !to)) {
      return sendError(res, 400, 'from/to 必須是有效的 YYYY-MM-DD 日期。');
    }
    if (from && to && from >= to) {
      return sendError(res, 400, 'from 不可晚於 to。');
    }

    try {
      let ordersQuery = supabase
        .from('orders')
        .select(
          'order_id,order_number,customer_phone,customer_name,shipping_address,shipping_fee,pickup_location_id,pickup_slot,total_amount,order_date,status,payment_status,payment_proof_url,payment_proof_status,shipping_status,shipping_method,shipping_carrier,tracking_number',
          { count: 'exact' }
        );
      if (phoneVariants) {
        ordersQuery = ordersQuery.in('customer_phone', phoneVariants);
      }
      if (status) {
        ordersQuery = ordersQuery.eq('status', status);
      }
      if (from) {
        ordersQuery = ordersQuery.gte('order_date', from);
      }
      if (to) {
        ordersQuery = ordersQuery.lt('order_date', to);
      }
      const {
        data: orders,
        error,
        count,
      } = await ordersQuery
        .order('order_date', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        logDatabaseError(req, 'admin_orders_list', error);
        return sendError(
          res,
          MISSING_SCHEMA_CODES.has(error.code) ? 503 : 500,
          MISSING_SCHEMA_CODES.has(error.code)
            ? '訂單狀態或利潤資料庫 migration 尚未執行。'
            : '讀取訂單列表失敗，請稍後再試。'
        );
      }
      if (!Array.isArray(orders)) {
        req.log.error({ event: 'admin_orders_list_invalid_result' }, 'Invalid admin order list result');
        return sendError(res, 500, '訂單列表回傳格式無效。');
      }

      const shippingDetailsByOrder = new Map();
      let shippingDetailsAvailable = true;
      if (orders.length > 0) {
        const { data: shippingDetails, error: shippingDetailsError } = await supabase
          .from('orders')
          .select('order_id,shipping_fee,pickup_location_id')
          .in('order_id', orders.map(order => order.order_id));
        if (shippingDetailsError && MISSING_SCHEMA_CODES.has(shippingDetailsError.code)) {
          shippingDetailsAvailable = false;
          req.log.warn(
            {
              event: 'admin_order_shipping_fields_unavailable',
              code: shippingDetailsError.code,
            },
            'Optional shipping details are not available in this database schema'
          );
        } else if (shippingDetailsError) {
          logDatabaseError(req, 'admin_order_shipping_details', shippingDetailsError);
          return sendError(res, 500, '讀取訂單運費資料失敗，請稍後再試。');
        } else if (!Array.isArray(shippingDetails)) {
          req.log.error(
            { event: 'admin_order_shipping_details_invalid_result' },
            'Invalid optional shipping details result'
          );
          return sendError(res, 500, '訂單運費資料回傳格式無效。');
        } else {
          for (const details of shippingDetails) {
            shippingDetailsByOrder.set(String(details.order_id), details);
          }
        }
      }

      const orderIds = orders.map((order) => order.order_id);
      let items = [];
      let profitRows = [];
      if (orderIds.length > 0) {
        const [itemsResult, profitResult] = await Promise.all([
          supabase
            .from('order_items')
            .select('item_id,order_id,product_id,quantity,unit_price')
            .in('order_id', orderIds)
            .limit(MAX_ORDER_ITEMS + 1),
          supabase
            .from('order_profit')
            .select('order_id,items_count,profit_total')
            .in('order_id', orderIds),
        ]);
        if (itemsResult.error) {
          logDatabaseError(req, 'admin_order_items_list', itemsResult.error);
          return sendError(res, 500, '讀取訂單商品明細失敗，請稍後再試。');
        }
        if (!Array.isArray(itemsResult.data) || itemsResult.data.length > MAX_ORDER_ITEMS) {
          req.log.error({ event: 'admin_order_items_invalid_result' }, 'Invalid admin order items result');
          return sendError(res, 413, '本頁訂單明細超過安全讀取上限，請縮小每頁筆數。');
        }
        if (profitResult.error) {
          logDatabaseError(req, 'admin_order_profit_list', profitResult.error);
          return sendError(
            res,
            MISSING_SCHEMA_CODES.has(profitResult.error.code) ? 503 : 500,
            MISSING_SCHEMA_CODES.has(profitResult.error.code)
              ? '訂單利潤資料庫 migration 尚未執行。'
              : '讀取訂單利潤失敗，請稍後再試。'
          );
        }
        if (!Array.isArray(profitResult.data)) {
          req.log.error({ event: 'admin_order_profit_invalid_result' }, 'Invalid admin order profit result');
          return sendError(res, 500, '訂單利潤資料格式無效。');
        }
        items = itemsResult.data;
        profitRows = profitResult.data;
      }

      const productIds = [...new Set(items.map((item) => item.product_id))];
      let products = [];
      if (productIds.length > 0) {
        const { data, error: productsError } = await supabase
          .from('products')
          .select('*')
          .in('id', productIds);
        if (productsError) {
          logDatabaseError(req, 'admin_order_products_list', productsError);
          return sendError(res, 500, '讀取商品資訊失敗，請稍後再試。');
        }
        if (!Array.isArray(data)) {
          req.log.error({ event: 'admin_order_products_invalid_result' }, 'Invalid admin order products result');
          return sendError(res, 500, '商品資訊資料回傳格式無效。');
        }
        products = data;
      }

      const productsById = new Map(products.map((product) => [String(product.id), product]));
      const itemsByOrder = new Map();
      for (const item of items) {
        const orderKey = String(item.order_id);
        const orderItems = itemsByOrder.get(orderKey) || [];
        const product = productsById.get(String(item.product_id)) || {};
        orderItems.push({
          product_id: item.product_id,
          product_name: product.product_name || product.name || '未命名商品',
          description: product.description || '',
          product_code: product.product_code || '',
          image_url: product.image_url || product.image || '',
          quantity: item.quantity,
          unit_price: item.unit_price,
        });
        itemsByOrder.set(orderKey, orderItems);
      }

      const profitByOrder = new Map(
        profitRows.map((row) => [String(row.order_id), row])
      );
      const proofPaths = [
        ...new Set(
          orders
            .map((order) => order.payment_proof_url)
            .filter((path) => typeof path === 'string' && path.length > 0)
        ),
      ];
      const signedProofsByPath = new Map();
      if (proofPaths.length > 0) {
        if (!supabase.storage) {
          req.log.error({ event: 'admin_order_proof_storage_missing' }, 'Payment proof storage is unavailable');
          return sendError(res, 503, '付款憑證儲存服務尚未設定。');
        }
        const { data, error: signedProofError } = await supabase.storage
          .from(PAYMENT_PROOF_BUCKET)
          .createSignedUrls(proofPaths, 300);
        if (signedProofError || !Array.isArray(data)) {
          logDatabaseError(req, 'admin_order_proof_signing', signedProofError);
          return sendError(res, 500, '讀取付款憑證失敗，請稍後再試。');
        }
        for (const proof of data) {
          if (proof && typeof proof.path === 'string' && typeof proof.signedUrl === 'string') {
            signedProofsByPath.set(proof.path, proof.signedUrl);
          }
        }
        if (proofPaths.some((path) => !signedProofsByPath.has(path))) {
          req.log.error({ event: 'admin_order_proof_signing_incomplete' }, 'Some payment proof links were not signed');
          return sendError(res, 500, '付款憑證預覽暫時無法使用，請稍後再試。');
        }
      }

      req.log.info(
        {
          phone_suffix: phoneVariants ? phoneVariants[0].slice(-4) : null,
          status: status || null,
          count: orders.length,
        },
        'Admin orders listed'
      );
      return res.json({
        success: true,
        data: {
          orders: orders.map((order) => {
            const { payment_proof_url: proofPath, ...orderData } = order;
            const profit = profitByOrder.get(String(order.order_id));
            const parsedItemsCount = Number(profit && profit.items_count);
            const shippingDetails = shippingDetailsByOrder.get(String(order.order_id));
            return {
              ...orderData,
              shipping_fee: shippingDetailsAvailable && shippingDetails
                ? shippingDetails.shipping_fee
                : null,
              pickup_location_id: shippingDetailsAvailable && shippingDetails
                ? shippingDetails.pickup_location_id
                : null,
              shipping_details_message: shippingDetailsAvailable && shippingDetails
                ? null
                : '資料不足',
              payment_proof_signed_url: proofPath
                ? signedProofsByPath.get(proofPath) || null
                : null,
              items: itemsByOrder.get(String(order.order_id)) || [],
              items_count: Number.isSafeInteger(parsedItemsCount) ? parsedItemsCount : 0,
              profit_total: roundMoney(profit && profit.profit_total),
            };
          }),
          total_count: Number.isSafeInteger(count) ? count : orders.length,
          limit,
          offset,
        },
        message: '訂單列表載入完成。',
      });
    } catch (error) {
      logDatabaseError(req, 'admin_orders_list_unexpected', error);
      return sendError(res, 500, '讀取訂單列表時發生錯誤，請稍後再試。');
    }
  });

  router.patch('/:order_id/status', async (req, res) => {
    if (!authorize(req, res)) {
      return;
    }
    res.set('Cache-Control', 'no-store');
    const orderId = req.params.order_id;
    if (!ORDER_ID_PATTERN.test(orderId)) {
      return sendError(res, 400, 'order_id 必須是有效的 UUID。');
    }
    if (!req.body || typeof req.body.status !== 'string') {
      return sendError(res, 400, 'status 無效。');
    }
    if (!ORDER_STATUSES.has(req.body.status)) {
      return sendError(res, 400, 'status 無效。');
    }

    try {
      const { data, error } = await transitionAdminOrderStatus(
        supabase,
        orderId,
        req.body.status
      );
      if (error) {
        logDatabaseError(req, 'admin_order_status_update', error);
        const response = respondToStatusTransition(res, data, error);
        if (response) {
          return response;
        }
        if (MISSING_SCHEMA_CODES.has(error.code)) {
          return sendError(res, 503, '訂單狀態資料庫 migration 尚未執行。');
        }
        return sendError(res, 500, '更新訂單狀態失敗，請稍後再試。');
      }
      const result = respondToStatusTransition(res, data, null);
      if (result.statusCode < 400) {
        req.log.info(
          { order_id: orderId, status: data.status },
          'Admin order status updated'
        );
        if (data.status === 'shipped') {
          await notifyShippedOrder({
            supabase,
            orderId,
            logger: req.log,
            sender: options.whatsappSender,
            serviceRoleAvailable: options.serviceRoleAvailable === true,
            notifier: options.sendWhatsAppNotification,
            env: options.env || process.env,
          });
        }
      }
      return result;
    } catch (error) {
      logDatabaseError(req, 'admin_order_status_update_unexpected', error);
      return sendError(res, 500, '更新訂單狀態失敗，請稍後再試。');
    }
  });

  return router;
}

module.exports = createAdminOrdersRouter;
