'use strict';

const crypto = require('node:crypto');
const express = require('express');

const MISSING_SCHEMA_CODES = new Set(['42P01', '42703', '42883', 'PGRST202', 'PGRST204']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORDER_STATUSES = new Set(['pending', 'shipping', 'completed']);
const SHIPPING_METHODS = new Set(['面交', '自取', '順豐', '京東']);
const MAX_ADMIN_PAGE_SIZE = 100;
const MAX_ORDER_ITEMS = 5000;

function sendError(res, status, message, code) {
  return res.status(status).json({
    success: false,
    data: null,
    message,
    ...(code ? { code } : {})
  });
}

function parseQueryInteger(value, fallback) {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function createOrdersRouter(supabase, options = {}) {
  const router = express.Router();

  function authorizeOrderManagement(req, res) {
    if (
      typeof options.isSessionAuthorized !== 'function' ||
      !options.isSessionAuthorized(req, 'orders')
    ) {
      sendError(res, 401, '請先以具備訂單管理權限的管理員 Session 登入。');
      return false;
    }
    if (!supabase || options.serviceRoleAvailable === false) {
      sendError(res, 53, '訂單管理服務尚未設定資料庫服務權限。');
      return false;
    }
    return true;
  }

  router.get('/admin/orders', async (req, res) => {
    if (!authorizeOrderManagement(req, res)) {
      return;
    }
    res.set('Cache-Control', 'no-store');
    const limit = parseQueryInteger(req.query.limit, 50);
    const offset = parseQueryInteger(req.query.offset, 0);
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > MAX_ADMIN_PAGE_SIZE ||
      !Number.isSafeInteger(offset) ||
      offset < 0
    ) {
      return sendError(res, 400, `limit 必須是 1 至 ${MAX_ADMIN_PAGE_SIZE} 的整數，offset 必須是非負整數。`);
    }

    try {
      const { data: orders, error, count } = await supabase
        .from('orders')
        .select('order_id,customer_phone,total_amount,order_date,status,order_number', { count: 'exact' })
        .order('order_date', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        console.error('管理員訂單列表查詢失敗：', error);
        if (MISSING_SCHEMA_CODES.has(error.code)) {
          return sendError(res, 503, '訂單狀態資料庫 migration 尚未執行。');
        }
        return sendError(res, 500, '讀取訂單列表失敗，請稍後再試。');
      }
      if (!Array.isArray(orders)) {
        console.error('管理員訂單列表查詢回傳格式無效：', orders);
        return sendError(res, 500, '訂單列表回傳格式無效。');
      }

      const orderIds = orders.map(order => order.order_id);
      let items = [];
      if (orderIds.length > 0) {
        const { data, error: itemsError } = await supabase
          .from('order_items')
          .select('item_id,order_id,product_id,quantity,unit_price')
          .in('order_id', orderIds)
          .limit(MAX_ORDER_ITEMS + 1);
        if (itemsError) {
          console.error('管理員訂單明細查詢失敗：', itemsError);
          return sendError(res, 500, '讀取訂單商品明細失敗，請稍後再試。');
        }
        if (!Array.isArray(data) || data.length > MAX_ORDER_ITEMS) {
          console.error('管理員訂單明細超出安全讀取上限或格式無效。');
          return sendError(res, 413, '本頁訂單明細超過安全讀取上限，請縮小每頁筆數。');
        }
        items = data;
      }

      const productIds = [...new Set(items.map(item => item.product_id))];
      let products = [];
      if (productIds.length > 0) {
        const { data, error: productsError } = await supabase
          .from('products')
          .select('*')
          .in('id', productIds);
        if (productsError) {
          console.error('管理員訂單商品資訊查詢失敗：', productsError);
          return sendError(res, 500, '讀取商品資訊失敗，請稍後再試。');
        }
        if (!Array.isArray(data)) {
          console.error('管理員訂單商品資訊查詢回傳格式無效：', data);
          return sendError(res, 500, '商品資訊資料回傳格式無效。');
        }
        products = data;
      }

      const productsMap = new Map(products.map(product => [
        String(product.id),
        product
      ]));
      const itemsByOrder = new Map();
      for (const item of items) {
        const key = String(item.order_id);
        const orderItems = itemsByOrder.get(key) || [];
        const prod = productsMap.get(String(item.product_id)) || {};
        orderItems.push({
          product_id: item.product_id,
          product_name: prod.product_name || prod.name || '未命名商品',
          description: prod.description || '',
          product_code: prod.product_code || '',
          image_url: prod.image_url || prod.image || '',
          quantity: item.quantity,
          unit_price: item.unit_price
        });
        itemsByOrder.set(key, orderItems);
      }

      return res.json({
        success: true,
        data: {
          orders: orders.map(order => ({
            ...order,
            items: itemsByOrder.get(String(order.order_id)) || []
          })),
          total_count: Number.isSafeInteger(count) ? count : orders.length,
          limit,
          offset
        },
        message: '訂單列表載入完成。'
      });
    } catch (error) {
      console.error('讀取管理員訂單時發生未預期錯誤：', error);
      return sendError(res, 500, '讀取訂單列表時發生錯誤，請稍後再試。');
    }
  });

  router.patch('/admin/orders/:orderId/status', async (req, res) => {
    if (!authorizeOrderManagement(req, res)) {
      return;
    }
    res.set('Cache-Control', 'no-store');
    const { orderId } = req.params;
    if (!UUID_PATTERN.test(orderId)) {
      return sendError(res, 400, 'orderId 必須是有效的 UUID。');
    }
    const status = req.body && req.body.status;
    if (typeof status !== 'string' || !ORDER_STATUSES.has(status)) {
      return sendError(res, 400, 'status 必須是 pending、shipping 或 completed。');
    }

    try {
      const { data, error } = await supabase
        .from('orders')
        .update({ status })
        .eq('order_id', orderId)
        .select('order_id,status')
        .maybeSingle();
      if (error) {
        console.error('更新訂單狀態失敗：', error);
        if (MISSING_SCHEMA_CODES.has(error.code)) {
          return sendError(res, 503, '訂單狀態資料庫 migration 尚未執行。');
        }
        return sendError(res, 500, '更新訂單狀態失敗，請稍後再試。');
      }
      if (!data) {
        return sendError(res, 404, '找不到指定訂單。');
      }
      return res.json({
        success: true,
        data,
        message: '訂單狀態已更新。'
      });
    } catch (error) {
      console.error('處理訂單狀態更新時發生未預期錯誤：', error);
      return sendError(res, 500, '更新訂單狀態時發生錯誤，請稍後再試。');
    }
  });

  router.post('/', async (req, res) => {
    if (options.serviceRoleAvailable === false || !supabase) {
      return sendError(
        res,
        503,
        '落單服務尚未設定 SUPABASE_SERVICE_ROLE_KEY，請管理員完成伺服器設定後再試。',
        'CHECKOUT_NOT_CONFIGURED'
      );
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const customerPhone = typeof body.customer_phone === 'string'
      ? body.customer_phone.trim().replace(/^\+/, '')
      : '';
    const rawItems = Array.isArray(body.items) ? body.items : null;

    if (!/^[0-9]{8,15}$/.test(customerPhone)) {
      return sendError(res, 400, '請提供有效的聯絡電話。');
    }
    if (!rawItems || rawItems.length < 1 || rawItems.length > 100) {
      return sendError(res, 400, '訂單必須包含 1 至 100 項商品。');
    }

    const normalizedItems = new Map();
    for (const item of rawItems) {
      if (!item || typeof item !== 'object') {
        return sendError(res, 400, '訂單商品資料格式無效。');
      }
      const productId = typeof item.product_id === 'string' || typeof item.product_id === 'number'
        ? String(item.product_id).trim()
        : '';
      const normalizedProductId = UUID_PATTERN.test(productId) ? productId.toLowerCase() : productId;
      const quantity = item.quantity;
      if (!/^(?:[1-9]\d*|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(normalizedProductId)
          || typeof quantity !== 'number'
          || !Number.isSafeInteger(quantity)
          || quantity < 1
          || quantity > 1000) {
        return sendError(res, 400, '商品編號或數量無效。');
      }
      const combinedQuantity = (normalizedItems.get(normalizedProductId) || 0) + quantity;
      if (combinedQuantity > 1000) {
        return sendError(res, 400, '同一商品訂購數量不可超過 1000。');
      }
      normalizedItems.set(normalizedProductId, combinedQuantity);
    }

    const rpcItems = Array.from(normalizedItems, ([product_id, quantity]) => ({
      product_id,
      quantity
    }));

    try {
      const { data, error } = await supabase.rpc('create_customer_order', {
        p_customer_phone: customerPhone,
        p_items: rpcItems
      });

      if (error) {
        console.error('建立訂單 RPC 失敗：', error);
        if (MISSING_SCHEMA_CODES.has(error.code)) {
          return sendError(res, 503, '訂單資料庫尚未完成結帳庫存 migration。', 'CHECKOUT_MIGRATION_REQUIRED');
        }
        if (error.message === 'STOCK_UNAVAILABLE') {
          let stockDetails = null;
          try {
            stockDetails = error.details ? JSON.parse(error.details) : null;
          } catch (parseError) {
            console.error('庫存不足 RPC 詳情格式無效：', parseError);
          }
          return res.status(409).json({
            success: false,
            data: stockDetails,
            message: '部分商品庫存不足，請更新購物車後重試。',
            code: 'STOCK_UNAVAILABLE'
          });
        }
        if (error.message === 'PRODUCT_UNAVAILABLE') {
          return sendError(res, 409, '部分商品已下架或不存在，請重新整理商品列表。', 'PRODUCT_UNAVAILABLE');
        }
        return sendError(res, 500, '建立訂單失敗，請稍後再試。');
      }

      const result = Array.isArray(data) ? data[0] : data;
      if (!result || typeof result !== 'object' || !UUID_PATTERN.test(String(result.order_id || ''))) {
        console.error('結帳 RPC 回傳無效結果：', data);
        return sendError(res, 500, '訂單建立結果無效，請聯絡管理員。');
      }

      const internalOrderId = result.order_id;
      let orderNumber = result.order_number || result.order_no || null;
      if (typeof orderNumber === 'string') {
        orderNumber = orderNumber.trim() || null;
      }
      if (orderNumber && UUID_PATTERN.test(String(orderNumber))) {
        orderNumber = null;
      }
      if (!orderNumber) {
        const { data: orderRecord, error: orderLookupError } = await supabase
          .from('orders')
          .select('order_number')
          .eq('order_id', internalOrderId)
          .maybeSingle();

        if (orderLookupError) {
          console.error('讀取正式訂單編號失敗：', orderLookupError);
          return sendError(res, 500, '訂單已建立，但讀取正式訂單編號失敗，請聯絡管理員。');
        }
        orderNumber = orderRecord && orderRecord.order_number;
        if (typeof orderNumber === 'string') {
          orderNumber = orderNumber.trim() || null;
        }
        if (orderNumber && UUID_PATTERN.test(String(orderNumber))) {
          orderNumber = null;
        }
      }

      if (!orderNumber) {
        const date = new Date();
        const datePart = [
          date.getUTCFullYear(),
          String(date.getUTCMonth() + 1).padStart(2, '0'),
          String(date.getUTCDate()).padStart(2, '0')
        ].join('');
        const generatedOrderNumber = `LP-${datePart}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        const { data: updatedOrder, error: orderUpdateError } = await supabase
          .from('orders')
          .update({ order_number: generatedOrderNumber })
          .eq('order_id', internalOrderId)
          .is('order_number', null)
          .select('order_number')
          .maybeSingle();

        if (orderUpdateError) {
          console.error('儲存正式訂單編號失敗：', orderUpdateError);
          return sendError(res, 500, '訂單已建立，但儲存正式訂單編號失敗，請聯絡管理員。');
        }

        orderNumber = updatedOrder && updatedOrder.order_number;
        if (!orderNumber) {
          const { data: latestOrder, error: latestOrderError } = await supabase
            .from('orders')
            .select('order_number')
            .eq('order_id', internalOrderId)
            .maybeSingle();

          if (latestOrderError || !latestOrder || !latestOrder.order_number) {
            console.error('確認正式訂單編號失敗：', latestOrderError || latestOrder);
            return sendError(res, 500, '訂單已建立，但無法確認正式訂單編號，請聯絡管理員。');
          }
          orderNumber = latestOrder.order_number;
        }
      }

      if (UUID_PATTERN.test(String(orderNumber))) {
        console.error('正式訂單編號不可使用內部 UUID：', internalOrderId);
        return sendError(res, 500, '訂單正式編號無效，請聯絡管理員。');
      }

      const { order_id: _internalOrderId, ...publicOrderData } = result;
      return res.status(201).json({
        success: true,
        data: {
          ...publicOrderData,
          order_number: String(orderNumber),
          orderNo: String(orderNumber)
        },
        message: '訂單建立成功'
      });
    } catch (error) {
      console.error('處理訂單結帳時發生未預期錯誤：', error);
      return sendError(res, 500, '處理訂單時發生錯誤，請稍後再試。');
    }
  });

  router.post('/query-order', async (req, res) => {
    try {
      const { phone, orderNo } = req.body || {};
      const trimmedPhone = typeof phone === 'string' ? phone.trim().replace(/^\+/, '') : '';
      const trimmedOrderNo = typeof orderNo === 'string' ? orderNo.trim() : '';

      if (!/^[0-9]{8,15}$/.test(trimmedPhone) || !trimmedOrderNo) {
        return sendError(res, 400, '為保障個人隱私，查詢訂單必須同時輸入「手提電話號碼」與「訂單編號」。');
      }

      const rawPhone = trimmedPhone.replace(/^852/, '');
      const phoneVariants = [...new Set([
        trimmedPhone,
        rawPhone,
        `852${rawPhone}`,
        `+${trimmedPhone}`,
        `+852${rawPhone}`
      ])];
      const { data: order, error } = await supabase
        .from('orders')
        .select('order_id, order_number, customer_phone, total_amount, order_date, status, payment_status, shipping_status, shipping_method, tracking_number')
        .in('customer_phone', phoneVariants)
        .eq('order_number', trimmedOrderNo.toUpperCase())
        .maybeSingle();

      if (error) {
        console.error('單筆訂單查詢失敗：', error);
        return sendError(res, 500, '查詢訂單時發生錯誤，請稍後再試。');
      }

      if (!order) {
        return sendError(res, 404, '找不到符合的訂單，請確認輸入的電話號碼與訂單編號是否完全正確。');
      }

      const { data: rawItems, error: itemsError } = await supabase
        .from('order_items')
        .select('*')
        .eq('order_id', order.order_id);

      if (itemsError) {
        console.error('查詢訂單明細失敗：', itemsError);
      }

      const items = Array.isArray(rawItems) ? rawItems : [];

      const productIds = [...new Set(items.map(item => String(item.product_id)).filter(Boolean))];
      let products = [];
      if (productIds.length > 0) {
        const { data: prodData } = await supabase
          .from('products')
          .select('*')
          .in('id', productIds);
        if (Array.isArray(prodData)) products = prodData;
      }

      const productsMap = new Map(products.map(p => [String(p.id), p]));

      const formattedItems = items.map(item => {
        const prod = productsMap.get(String(item.product_id)) || {};
        return {
          ...item,
          product_name: prod.product_name || prod.name || item.product_name || '精選商品',
          description: prod.description || item.description || '',
          product_code: prod.product_code || item.product_code || '',
          image_url: prod.image_url || prod.image || item.image_url || ''
        };
      });

      return res.json({
        success: true,
        data: {
          ...order,
          items: formattedItems
        },
        message: '成功找到訂單記錄。'
      });
    } catch (error) {
      console.error('處理單筆訂單查詢時發生未預期錯誤：', error);
      return sendError(res, 500, '查詢訂單時發生錯誤，請稍後再試。');
    }
  });

  router.patch('/update-info', async (req, res) => {
    try {
      const { phone, orderNo, customer_phone, shipping_method } = req.body || {};
      const trimmedPhone = typeof phone === 'string' ? phone.trim() : '';
      const trimmedOrderNo = typeof orderNo === 'string' ? orderNo.trim() : '';

      if (!trimmedPhone || !trimmedOrderNo) {
        return sendError(res, 400, '驗證失敗：必須提供原本的手提電話與訂單編號。');
      }

      const updateFields = {};
      if (typeof customer_phone === 'string' && /^[0-9]{8,15}$/.test(customer_phone.trim())) {
        updateFields.customer_phone = customer_phone.trim();
      }
      if (typeof shipping_method === 'string' && SHIPPING_METHODS.has(shipping_method.trim())) {
        updateFields.shipping_method = shipping_method.trim();
      }

      if (Object.keys(updateFields).length === 0) {
        return sendError(res, 400, '沒有提供需要修改的有效資料，或出貨方式選項不正確。');
      }

      const { data, error } = await supabase
        .from('orders')
        .update(updateFields)
        .eq('customer_phone', trimmedPhone)
        .eq('order_number', trimmedOrderNo)
        .select('order_id, order_number, customer_phone, total_amount, status, payment_status, shipping_status, shipping_method, tracking_number')
        .maybeSingle();

      if (error) {
        console.error('更新訂單資料失敗：', error);
        return sendError(res, 500, '更新訂單資料時發生錯誤，請稍後再試。');
      }

      if (!data) {
        return sendError(res, 404, '找不到對應的訂單，或驗證資料不符。');
      }

      return res.json({
        success: true,
        data,
        message: '訂單資料已成功更新。'
      });
    } catch (error) {
      console.error('處理更新訂單時發生未預期錯誤：', error);
      return sendError(res, 500, '更新訂單時發生系統錯誤。');
    }
  });

  router.get('/admin/orders', async (req, res) => {
    if (!authorizeOrderManagement(req, res)) {
      return;
    }
    res.set('Cache-Control', 'no-store');
    const limit = parseQueryInteger(req.query.limit, 50);
    const offset = parseQueryInteger(req.query.offset, 0);
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > MAX_ADMIN_PAGE_SIZE ||
      !Number.isSafeInteger(offset) ||
      offset < 0
    ) {
      return sendError(res, 400, `limit 必須是 1 至 ${MAX_ADMIN_PAGE_SIZE} 的整數，offset 必須是非負整數。`);
    }

    try {
      const { data: orders, error, count } = await supabase
        .from('orders')
        .select('order_id,customer_phone,total_amount,order_date,status,order_number', { count: 'exact' })
        .order('order_date', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        console.error('管理員訂單列表查詢失敗：', error);
        if (MISSING_SCHEMA_CODES.has(error.code)) {
          return sendError(res, 503, '訂單狀態資料庫 migration 尚未執行。');
        }
        return sendError(res, 500, '讀取訂單列表失敗，請稍後再試。');
      }
      if (!Array.isArray(orders)) {
        console.error('管理員訂單列表查詢回傳格式無效：', orders);
        return sendError(res, 500, '訂單列表回傳格式無效。');
      }

      const orderIds = orders.map(order => order.order_id);
      let items = [];
      if (orderIds.length > 0) {
        const { data, error: itemsError } = await supabase
          .from('order_items')
          .select('item_id,order_id,product_id,quantity,unit_price')
          .in('order_id', orderIds)
          .limit(MAX_ORDER_ITEMS + 1);
        if (itemsError) {
          console.error('管理員訂單明細查詢失敗：', itemsError);
          return sendError(res, 500, '讀取訂單商品明細失敗，請稍後再試。');
        }
        if (!Array.isArray(data) || data.length > MAX_ORDER_ITEMS) {
          console.error('管理員訂單明細超出安全讀取上限或格式無效。');
          return sendError(res, 413, '本頁訂單明細超過安全讀取上限，請縮小每頁筆數。');
        }
        items = data;
      }

      const productIds = [...new Set(items.map(item => item.product_id))];
      let products = [];
      if (productIds.length > 0) {
        const { data, error: productsError } = await supabase
          .from('products')
          .select('*')
          .in('id', productIds);
        if (productsError) {
          console.error('管理員訂單商品資訊查詢失敗：', productsError);
          return sendError(res, 500, '讀取商品資訊失敗，請稍後再試。');
        }
        if (!Array.isArray(data)) {
          console.error('管理員訂單商品資訊查詢回傳格式無效：', data);
          return sendError(res, 500, '商品資訊資料回傳格式無效。');
        }
        products = data;
      }

      const productsMap = new Map(products.map(p => [String(p.id), p]));
      const itemsByOrder = new Map();
      for (const item of items) {
        const key = String(item.order_id);
        const orderItems = itemsByOrder.get(key) || [];
        const prod = productsMap.get(String(item.product_id)) || {};
        orderItems.push({
          product_id: item.product_id,
          product_name: prod.product_name || prod.name || '未命名商品',
          description: prod.description || '',
          product_code: prod.product_code || '',
          image_url: prod.image_url || prod.image || '',
          quantity: item.quantity,
          unit_price: item.unit_price
        });
        itemsByOrder.set(key, orderItems);
      }

      return res.json({
        success: true,
        data: {
          orders: orders.map(order => ({
            ...order,
            items: itemsByOrder.get(String(order.order_id)) || []
          })),
          total_count: Number.isSafeInteger(count) ? count : orders.length,
          limit,
          offset
        },
        message: '訂單列表載入完成。'
      });
    } catch (error) {
      console.error('讀取管理員訂單時發生未預期錯誤：', error);
      return sendError(res, 500, '讀取訂單列表時發生錯誤，請稍後再試。');
    }
  });

  return router;
}

module.exports = createOrdersRouter;