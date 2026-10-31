'use strict';

const crypto = require('node:crypto');
const express = require('express');
const normalizePhone = require('../utils/normalize-phone');
const normalizeProductId = require('../utils/normalize-product-id');
const { calculateShippingFee, validateShippingData } = require('../utils/calculate-shipping');
const { readProductCatalog } = require('../utils/product-csv');
const {
  normalizeAdminOrderStatus,
  respondToStatusTransition,
  transitionAdminOrderStatus,
} = require('../utils/admin-order-status');

const MISSING_SCHEMA_CODES = new Set(['42P01', '42703', '42883', 'PGRST202', 'PGRST204']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHIPPING_METHODS = new Set(['面交', '自取', '順豐', '京東']);
const PAYMENT_PROOF_BUCKET = 'payment-proofs';
const MAX_ADMIN_PAGE_SIZE = 100;
const MAX_ORDER_ITEMS = 5000;

function normalizeOfficialOrderNumber(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const orderNumber = value.trim();
  if (
    !orderNumber ||
    orderNumber.length > 100 ||
    UUID_PATTERN.test(orderNumber) ||
    /[\u0000-\u001f\u007f]/.test(orderNumber)
  ) {
    return null;
  }
  return orderNumber;
}

function getHongKongDatePart(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}`;
}

function sendError(res, status, message, code) {
  return res.status(status).json({
    success: false,
    data: null,
    message,
    ...(code ? { code } : {}),
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
      return sendError(
        res,
        400,
        `limit 必須是 1 至 ${MAX_ADMIN_PAGE_SIZE} 的整數，offset 必須是非負整數。`
      );
    }

    try {
      const {
        data: orders,
        error,
        count,
      } = await supabase
        .from('orders')
        .select(
          'order_id,customer_phone,customer_name,shipping_address,shipping_fee,pickup_location_id,pickup_slot,total_amount,order_date,status,order_number,payment_status,payment_proof_url,payment_proof_status,shipping_status,shipping_method,shipping_carrier,tracking_number',
          { count: 'exact' }
        )
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

      const orderIds = orders.map((order) => order.order_id);
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

      const productIds = [...new Set(items.map((item) => item.product_id))];
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

      const productsMap = new Map(products.map((product) => [String(product.id), product]));
      const proofPaths = [
        ...new Set(
          orders
            .map((order) => order.payment_proof_url)
            .filter((path) => typeof path === 'string' && path.length > 0)
        ),
      ];
      const proofUrlsByPath = new Map();
      if (proofPaths.length > 0) {
        if (!supabase.storage) {
          console.error('付款憑證 Storage 尚未設定。');
          return sendError(res, 503, '付款憑證儲存服務尚未設定。');
        }
        const { data: signedProofs, error: signedProofError } = await supabase.storage
          .from(PAYMENT_PROOF_BUCKET)
          .createSignedUrls(proofPaths, 300);
        if (signedProofError) {
          console.error('建立付款憑證限時連結失敗：', signedProofError);
          return sendError(res, 500, '讀取付款憑證失敗，請稍後再試。');
        }
        if (!Array.isArray(signedProofs)) {
          console.error('付款憑證簽署連結回傳格式無效：', signedProofs);
          return sendError(res, 500, '付款憑證資料格式無效。');
        }
        signedProofs.forEach((proof) => {
          if (proof && typeof proof.path === 'string' && typeof proof.signedUrl === 'string') {
            proofUrlsByPath.set(proof.path, proof.signedUrl);
          }
        });
        if (proofPaths.some((path) => !proofUrlsByPath.has(path))) {
          console.error('付款憑證 Storage 未能為所有物件建立限時連結。');
          return sendError(res, 500, '付款憑證預覽暫時無法使用，請稍後再試。');
        }
      }
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
          unit_price: item.unit_price,
        });
        itemsByOrder.set(key, orderItems);
      }

      return res.json({
        success: true,
        data: {
          orders: orders.map((order) => {
            const { payment_proof_url: proofPath, ...orderData } = order;
            return {
              ...orderData,
              payment_proof_signed_url: proofPath ? proofUrlsByPath.get(proofPath) || null : null,
              items: itemsByOrder.get(String(order.order_id)) || [],
            };
          }),
          total_count: Number.isSafeInteger(count) ? count : orders.length,
          limit,
          offset,
        },
        message: '訂單列表載入完成。',
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
    const normalizedStatus = normalizeAdminOrderStatus(status);
    if (!normalizedStatus) {
      return sendError(res, 400, 'status 無效。');
    }

    try {
      const { data, error } = await transitionAdminOrderStatus(
        supabase,
        orderId,
        normalizedStatus
      );
      if (error) {
        req.log.error(
          {
            event: 'admin_order_status_update',
            code: typeof error.code === 'string' ? error.code : 'UNKNOWN',
          },
          'Admin order status update failed'
        );
        const transitionResponse = respondToStatusTransition(res, data, error);
        if (transitionResponse) {
          return transitionResponse;
        }
        if (MISSING_SCHEMA_CODES.has(error.code)) {
          return sendError(res, 503, '訂單狀態資料庫 migration 尚未執行。');
        }
        return sendError(res, 500, '更新訂單狀態失敗，請稍後再試。');
      }
      const transitionResponse = respondToStatusTransition(res, data, null);
      if (transitionResponse.statusCode < 400) {
        req.log.info(
          { order_id: orderId, status: data.status },
          'Admin order status updated'
        );
      }
      return transitionResponse;
    } catch (error) {
      req.log.error(
        {
          event: 'admin_order_status_update_unexpected',
          code: typeof error.code === 'string' ? error.code : 'UNKNOWN',
        },
        'Admin order status update failed unexpectedly'
      );
      return sendError(res, 500, '更新訂單狀態時發生錯誤，請稍後再試。');
    }
  });

  async function checkout(req, res) {
    if (options.serviceRoleAvailable === false || !supabase) {
      return sendError(
        res,
        503,
        '落單服務尚未設定 SUPABASE_SERVICE_ROLE_KEY，請管理員完成伺服器設定後再試。',
        'CHECKOUT_NOT_CONFIGURED'
      );
    }

    let body = req.body && typeof req.body === 'object' ? req.body : {};
    const isCheckoutRoute = req.path === '/checkout';
    const hasIdempotencyKey = Object.hasOwn(body, 'idempotency_key');
    const rawIdempotencyKey = body.idempotency_key;
    const rawPickupLocationId = body.pickup_location_id;
    const rawPickupSlot = body.pickup_slot;
    const rawShippingFee = body.shipping_fee;
    if (isCheckoutRoute) {
      const customer = body.customer;
      if (!customer || typeof customer !== 'object' || Array.isArray(customer)) {
        return sendError(res, 400, '顧客聯絡資料格式無效。');
      }
      if (!hasIdempotencyKey) {
        return sendError(res, 400, '請提供有效的結帳請求識別碼。', 'INVALID_IDEMPOTENCY_KEY');
      }
      if (Object.hasOwn(customer, 'email')) {
        req.log.warn({ field: 'customer.email' }, 'Ignoring unsupported checkout field');
      }
      if (
        (body.pickup !== undefined && body.pickup !== null && typeof body.pickup !== 'string') ||
        (customer.name !== undefined &&
          customer.name !== null &&
          typeof customer.name !== 'string') ||
        !Array.isArray(body.items)
      ) {
        return sendError(res, 400, '結帳資料格式無效。');
      }
      const checkoutItems = [];
      for (const item of body.items) {
        if (
          !item ||
          typeof item !== 'object' ||
          typeof item.product_id !== 'string' ||
          typeof item.qty !== 'number' ||
          !Number.isSafeInteger(item.qty) ||
          item.qty < 1 ||
          item.qty > 1000
        ) {
          return sendError(res, 400, '商品編號或數量無效。');
        }
        checkoutItems.push({ product_id: item.product_id, quantity: item.qty });
      }
      body = {
        customer_phone: customer.phone,
        customer_name: customer.name,
        shipping_method: body.pickup,
        shipping_address: body.shipping_address,
        pickup_location_id: rawPickupLocationId,
        pickup_slot: rawPickupSlot,
        shipping_fee: rawShippingFee,
        items: checkoutItems,
        idempotency_key: rawIdempotencyKey,
      };
    }

    if (
      hasIdempotencyKey &&
      (typeof rawIdempotencyKey !== 'string' || !UUID_V4_PATTERN.test(rawIdempotencyKey))
    ) {
      return sendError(res, 400, '請提供有效的結帳請求識別碼。', 'INVALID_IDEMPOTENCY_KEY');
    }
    const idempotencyKey = hasIdempotencyKey ? rawIdempotencyKey.toLowerCase() : null;

    const validatedShippingData = validateShippingData({
      pickup_location_id: body.pickup_location_id,
      pickup_slot: body.pickup_slot,
      shipping_fee: body.shipping_fee,
    });
    if (validatedShippingData.error) {
      return sendError(res, 400, validatedShippingData.error, 'INVALID_SHIPPING_DETAILS');
    }
    if (validatedShippingData.values.shipping_fee !== undefined) {
      req.log.warn({ field: 'shipping_fee' }, 'Ignoring client-supplied shipping fee');
    }

    if (
      (body.customer_name !== undefined &&
        body.customer_name !== null &&
        typeof body.customer_name !== 'string') ||
      (body.shipping_method !== undefined &&
        body.shipping_method !== null &&
        typeof body.shipping_method !== 'string') ||
      (body.shipping_address !== undefined &&
        body.shipping_address !== null &&
        typeof body.shipping_address !== 'string')
    ) {
      return sendError(res, 400, '收件人及取貨資料格式無效。');
    }
    const customerPhone = normalizePhone(body.customer_phone) || '';
    const customerName = typeof body.customer_name === 'string' ? body.customer_name.trim() : '';
    const submittedShippingMethod =
      typeof body.shipping_method === 'string' ? body.shipping_method.trim() : '';
    const submittedShippingAddress =
      typeof body.shipping_address === 'string' ? body.shipping_address.trim() : '';
    const rawItems = Array.isArray(body.items) ? body.items : null;

    if (!/^[0-9]{8,15}$/.test(customerPhone)) {
      return sendError(res, 400, '請提供有效的聯絡電話。');
    }
    if (customerName.length > 100 || /[\u0000-\u001f\u007f]/.test(customerName)) {
      return sendError(res, 400, '收件人姓名不可超過 100 字或包含控制字元。');
    }
    const pickupMethods = new Map([
      ['sf_station', { method: '順豐', label: '順豐站' }],
      ['sf_locker', { method: '順豐', label: '順豐智能櫃' }],
      ['順豐站', { method: '順豐', label: '順豐站' }],
      ['順豐智能櫃', { method: '順豐', label: '順豐智能櫃' }],
    ]);
    const pickupSelection = pickupMethods.get(submittedShippingMethod);
    const shippingMethod = pickupSelection
      ? pickupSelection.method
      : submittedShippingMethod || null;
    const allowedShippingMethods = new Set(['順豐', '自取', '面交', '京東']);
    if (shippingMethod !== null && !allowedShippingMethods.has(shippingMethod)) {
      return sendError(res, 400, '請選擇有效的取貨方式。');
    }
    if (
      submittedShippingAddress.length > (pickupSelection ? 190 : 200) ||
      /[\u0000-\u001f\u007f]/.test(submittedShippingAddress)
    ) {
      return sendError(res, 400, '取貨地點或地址長度超出限制，或包含控制字元。');
    }
    if (pickupSelection && !submittedShippingAddress) {
      return sendError(res, 400, '請輸入或選擇順豐站／智能櫃編號或地區。');
    }
    const shippingAddress = pickupSelection
      ? `${pickupSelection.label}：${submittedShippingAddress}`
      : submittedShippingAddress || null;
    if (!rawItems || rawItems.length < 1 || rawItems.length > 100) {
      return sendError(res, 400, '訂單必須包含 1 至 100 項商品。');
    }

    const normalizedItems = new Map();
    for (const item of rawItems) {
      if (!item || typeof item !== 'object') {
        return sendError(res, 400, '訂單商品資料格式無效。');
      }
      const normalizedProductId = normalizeProductId(item.product_id);
      const quantity = item.quantity;
      if (
        normalizedProductId === null ||
        typeof quantity !== 'number' ||
        !Number.isSafeInteger(quantity) ||
        quantity < 1 ||
        quantity > 1000
      ) {
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
      quantity,
    }));

    let csvCatalog;
    try {
      csvCatalog = typeof options.shippingCatalog === 'function'
        ? options.shippingCatalog()
        : options.shippingCatalog || readProductCatalog();
    } catch {
      req.log.error({ event: 'shipping_catalog_read_failed' }, 'Shipping data unavailable');
    }
    const calculatedShippingFee = calculateShippingFee(
      rpcItems,
      validatedShippingData.values.pickup_location_id,
      csvCatalog,
      req.log
    );
    const shippingFee = calculatedShippingFee === null ? 0 : calculatedShippingFee;

    req.log.info({
      phone_suffix: customerPhone.slice(-4),
      idem_key: idempotencyKey,
      items_count: rpcItems.length,
      shipping_fee: shippingFee,
      pickup_location_id: validatedShippingData.values.pickup_location_id,
    }, 'Checkout request received');

    try {
      const { data, error } = await supabase.rpc('create_customer_order', {
        p_customer_phone: customerPhone,
        p_items: rpcItems,
        p_customer_name: customerName || null,
        p_shipping_method: shippingMethod,
        p_shipping_address: shippingAddress,
        p_idempotency_key: idempotencyKey,
        p_pickup_location_id: validatedShippingData.values.pickup_location_id,
        p_pickup_slot: validatedShippingData.values.pickup_slot,
        p_shipping_fee: shippingFee,
      });

      if (error) {
        req.log.error({ event: 'checkout_rpc_failure' }, 'Checkout RPC failed');
        if (MISSING_SCHEMA_CODES.has(error.code)) {
          return sendError(
            res,
            503,
            '訂單資料庫尚未完成結帳庫存 migration。',
            'CHECKOUT_MIGRATION_REQUIRED'
          );
        }
        if (error.message === 'STOCK_UNAVAILABLE') {
          let stockDetails = null;
          try {
            stockDetails = error.details ? JSON.parse(error.details) : null;
          } catch {
            req.log.warn({ event: 'invalid_stock_error_details' }, 'Checkout returned invalid stock details');
          }
          return res.status(409).json({
            success: false,
            data: stockDetails,
            message: '部分商品庫存不足，請更新購物車後重試。',
            code: 'STOCK_UNAVAILABLE',
          });
        }
        if (error.message === 'PREORDER_DEADLINE_PASSED') {
          return sendError(res, 409, '預購已截止，請移除相關商品後再試。', 'PREORDER_DEADLINE_PASSED');
        }
        if (error.message === 'DUPLICATE_REQUEST' || error.code === '23505') {
          return sendError(res, 409, '重複請求，請稍後再試。', 'DUPLICATE_REQUEST');
        }
        if (error.message === 'PRODUCT_UNAVAILABLE') {
          return sendError(
            res,
            409,
            '部分商品已下架或不存在，請重新整理商品列表。',
            'PRODUCT_UNAVAILABLE'
          );
        }
        return sendError(res, 500, '建立訂單失敗，請稍後再試。');
      }

      const result = Array.isArray(data) ? data[0] : data;
      if (
        !result ||
        typeof result !== 'object' ||
        !UUID_PATTERN.test(String(result.order_id || ''))
      ) {
        req.log.error({ event: 'invalid_checkout_rpc_result' }, 'Checkout RPC returned an invalid result');
        return sendError(res, 500, '訂單建立結果無效，請聯絡管理員。');
      }

      const internalOrderId = result.order_id;
      let orderNumber =
        normalizeOfficialOrderNumber(result.order_number) ||
        normalizeOfficialOrderNumber(result.order_no);
      let invalidStoredOrderNumber = null;
      if (
        (typeof result.order_number === 'string' &&
          UUID_PATTERN.test(result.order_number.trim())) ||
        (typeof result.order_no === 'string' && UUID_PATTERN.test(result.order_no.trim()))
      ) {
        invalidStoredOrderNumber = result.order_number || result.order_no;
      }
      if (!orderNumber) {
        const { data: orderRecord, error: orderLookupError } = await supabase
          .from('orders')
          .select('order_number')
          .eq('order_id', internalOrderId)
          .maybeSingle();

        if (orderLookupError) {
          req.log.error({ event: 'checkout_order_number_lookup_failure' }, 'Checkout order number lookup failed');
          return sendError(res, 500, '訂單已建立，但讀取正式訂單編號失敗，請聯絡管理員。');
        }
        const storedOrderNumber = orderRecord && orderRecord.order_number;
        orderNumber = normalizeOfficialOrderNumber(storedOrderNumber);
        if (
          !orderNumber &&
          typeof storedOrderNumber === 'string' &&
          UUID_PATTERN.test(storedOrderNumber.trim())
        ) {
          invalidStoredOrderNumber = storedOrderNumber;
        }
      }

      if (!orderNumber) {
        const generatedOrderNumber = `LP-${getHongKongDatePart()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        let updateOrderQuery = supabase
          .from('orders')
          .update({ order_number: generatedOrderNumber })
          .eq('order_id', internalOrderId);
        updateOrderQuery = invalidStoredOrderNumber
          ? updateOrderQuery.eq('order_number', invalidStoredOrderNumber)
          : updateOrderQuery.is('order_number', null);
        const { data: updatedOrder, error: orderUpdateError } = await updateOrderQuery
          .select('order_number')
          .maybeSingle();

        if (orderUpdateError) {
          req.log.error({ event: 'checkout_order_number_update_failure' }, 'Checkout order number update failed');
          return sendError(res, 500, '訂單已建立，但儲存正式訂單編號失敗，請聯絡管理員。');
        }

        orderNumber = normalizeOfficialOrderNumber(updatedOrder && updatedOrder.order_number);
        if (!orderNumber) {
          const { data: latestOrder, error: latestOrderError } = await supabase
            .from('orders')
            .select('order_number')
            .eq('order_id', internalOrderId)
            .maybeSingle();

          orderNumber = normalizeOfficialOrderNumber(latestOrder && latestOrder.order_number);
          if (latestOrderError || !orderNumber) {
            req.log.error({ event: 'checkout_order_number_confirmation_failure' }, 'Checkout order number confirmation failed');
            return sendError(res, 500, '訂單已建立，但無法確認正式訂單編號，請聯絡管理員。');
          }
        }
      }

      orderNumber = normalizeOfficialOrderNumber(orderNumber);
      if (!orderNumber) {
        req.log.error({ event: 'invalid_public_order_number' }, 'Checkout returned an invalid public order number');
        return sendError(res, 500, '訂單正式編號無效，請聯絡管理員。');
      }

      const { order_id: _internalOrderId, ...publicOrderData } = result;
      req.log.info({
        event: 'checkout_created',
        phone_suffix: customerPhone.slice(-4),
        shipping_fee: typeof result.shipping_fee === 'number' ? result.shipping_fee : shippingFee,
        pickup_location_id:
          result.pickup_location_id ?? validatedShippingData.values.pickup_location_id,
      }, 'Checkout completed');
      return res.status(201).json({
        success: true,
        data: {
          ...publicOrderData,
          shipping_fee: typeof result.shipping_fee === 'number' ? result.shipping_fee : shippingFee,
          pickup_location_id:
            result.pickup_location_id ?? validatedShippingData.values.pickup_location_id,
          pickup_slot: result.pickup_slot ?? validatedShippingData.values.pickup_slot,
          order_number: String(orderNumber),
          orderNo: String(orderNumber),
          ...(isCheckoutRoute
            ? {
                order_id: String(orderNumber),
                items: Array.isArray(result.items) ? result.items : [],
              }
            : {}),
        },
        message: '訂單建立成功',
      });
    } catch (error) {
      req.log.error({ event: 'checkout_unexpected_failure' }, 'Checkout failed unexpectedly');
      return sendError(res, 500, '處理訂單時發生錯誤，請稍後再試。');
    }
  }

  router.post('/', checkout);
  router.post('/checkout', checkout);

  router.post('/query-order', async (req, res) => {
    try {
      const { phone, orderNo } = req.body || {};
      const trimmedPhone = typeof phone === 'string' ? phone.trim().replace(/^\+/, '') : '';
      const trimmedOrderNo = typeof orderNo === 'string' ? orderNo.trim() : '';

      if (!/^[0-9]{8,15}$/.test(trimmedPhone) || !trimmedOrderNo) {
        return sendError(
          res,
          400,
          '為保障個人隱私，查詢訂單必須同時輸入「手提電話號碼」與「訂單編號」。'
        );
      }

      const rawPhone = trimmedPhone.replace(/^852/, '');
      const phoneVariants = [
        ...new Set([
          trimmedPhone,
          rawPhone,
          `852${rawPhone}`,
          `+${trimmedPhone}`,
          `+852${rawPhone}`,
        ]),
      ];
      const { data: order, error } = await supabase
        .from('orders')
        .select(
          'order_id, order_number, customer_phone, customer_name, shipping_address, shipping_fee, pickup_location_id, pickup_slot, total_amount, order_date, status, payment_status, payment_proof_url, payment_proof_status, shipping_status, shipping_method, shipping_carrier, tracking_number'
        )
        .in('customer_phone', phoneVariants)
        .eq('order_number', trimmedOrderNo.toUpperCase())
        .maybeSingle();

      if (error) {
        console.error('單筆訂單查詢失敗：', error);
        return sendError(res, 500, '查詢訂單時發生錯誤，請稍後再試。');
      }

      if (!order) {
        return sendError(
          res,
          404,
          '找不到符合的訂單，請確認輸入的電話號碼與訂單編號是否完全正確。'
        );
      }

      const { data: rawItems, error: itemsError } = await supabase
        .from('order_items')
        .select('*')
        .eq('order_id', order.order_id);

      if (itemsError) {
        console.error('查詢訂單明細失敗：', itemsError);
      }

      const items = Array.isArray(rawItems) ? rawItems : [];

      const productIds = [...new Set(items.map((item) => String(item.product_id)).filter(Boolean))];
      let products = [];
      if (productIds.length > 0) {
        const { data: prodData } = await supabase.from('products').select('*').in('id', productIds);
        if (Array.isArray(prodData)) products = prodData;
      }

      const productsMap = new Map(products.map((p) => [String(p.id), p]));

      const formattedItems = items.map((item) => {
        const prod = productsMap.get(String(item.product_id)) || {};
        return {
          ...item,
          product_name: prod.product_name || prod.name || item.product_name || '精選商品',
          description: prod.description || item.description || '',
          product_code: prod.product_code || item.product_code || '',
          image_url: prod.image_url || prod.image || item.image_url || '',
        };
      });

      const { payment_proof_url: proofPath, ...publicOrder } = order;
      return res.json({
        success: true,
        data: {
          ...publicOrder,
          payment_proof_submitted: Boolean(proofPath),
          items: formattedItems,
        },
        message: '成功找到訂單記錄。',
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
        .select(
          'order_id, order_number, customer_phone, shipping_fee, pickup_location_id, pickup_slot, total_amount, status, payment_status, payment_proof_status, shipping_status, shipping_method, shipping_carrier, tracking_number'
        )
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
        message: '訂單資料已成功更新。',
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
      return sendError(
        res,
        400,
        `limit 必須是 1 至 ${MAX_ADMIN_PAGE_SIZE} 的整數，offset 必須是非負整數。`
      );
    }

    try {
      const {
        data: orders,
        error,
        count,
      } = await supabase
        .from('orders')
        .select(
          'order_id,customer_phone,customer_name,shipping_address,total_amount,order_date,status,order_number',
          { count: 'exact' }
        )
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

      const orderIds = orders.map((order) => order.order_id);
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

      const productIds = [...new Set(items.map((item) => item.product_id))];
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

      const productsMap = new Map(products.map((p) => [String(p.id), p]));
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
          unit_price: item.unit_price,
        });
        itemsByOrder.set(key, orderItems);
      }

      return res.json({
        success: true,
        data: {
          orders: orders.map((order) => ({
            ...order,
            items: itemsByOrder.get(String(order.order_id)) || [],
          })),
          total_count: Number.isSafeInteger(count) ? count : orders.length,
          limit,
          offset,
        },
        message: '訂單列表載入完成。',
      });
    } catch (error) {
      console.error('讀取管理員訂單時發生未預期錯誤：', error);
      return sendError(res, 500, '讀取訂單列表時發生錯誤，請稍後再試。');
    }
  });

  return router;
}

module.exports = createOrdersRouter;
