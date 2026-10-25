const crypto = require('crypto');
const express = require('express');
const XLSX = require('xlsx');

const MISSING_RPC_CODES = new Set(['42883', 'PGRST202']);
const SHIPPING_METHODS = new Set(['面交', '自取', '順豐', '京東']);
const MAX_PICK_LIST_ORDERS = 5000;
const MAX_PICK_LIST_ITEMS = 20000;
const MAX_BULK_TRACKING_FILE_BYTES = 2 * 1024 * 1024;
const MAX_BULK_TRACKING_ROWS = 100;

function normalizeTrackingHeader(value) {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s_-]+/g, '');
}

function parseBulkTrackingFile(buffer, fileName, defaultShippingMethod) {
  const extension = fileName.toLocaleLowerCase().split('.').pop();
  if (!['csv', 'xlsx', 'xls'].includes(extension)) {
    return { error: '只接受 CSV、XLSX 或 XLS 格式的物流檔案。' };
  }
  if (!SHIPPING_METHODS.has(defaultShippingMethod)) {
    return { error: '請選擇有效的運送方式。' };
  }

  let workbook;
  try {
    workbook = XLSX.read(buffer, {
      type: 'buffer',
      cellDates: false,
      sheetRows: MAX_BULK_TRACKING_ROWS + 2
    });
  } catch (error) {
    console.error('解析批量物流檔案失敗：', error);
    return { error: '物流檔案內容無法讀取，請確認檔案格式正確。' };
  }
  const firstSheetName = workbook.SheetNames[0];
  const sheet = firstSheetName && workbook.Sheets[firstSheetName];
  if (!sheet) {
    return { error: '物流檔案內沒有可讀取的工作表。' };
  }

  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false
  });
  if (!Array.isArray(rows) || rows.length < 2 || rows.length > MAX_BULK_TRACKING_ROWS + 1) {
    return { error: `物流檔案必須包含標題列及 1 至 ${MAX_BULK_TRACKING_ROWS} 筆資料。` };
  }

  const headers = rows[0].map(normalizeTrackingHeader);
  const orderNumberIndex = headers.findIndex(header =>
    ['ordernumber', 'orderno.', '訂單編號', '訂單號碼'].includes(header)
  );
  const trackingNumberIndex = headers.findIndex(header =>
    ['trackingnumber', '運單號', '物流單號', '快遞單號'].includes(header)
  );
  const shippingMethodIndex = headers.findIndex(header =>
    ['shippingmethod', '出貨方式', '物流方式', '運送方式'].includes(header)
  );
  if (orderNumberIndex < 0 || trackingNumberIndex < 0) {
    return { error: '標題列必須包含 order_number / 訂單編號及 tracking_number / 運單號欄位。' };
  }

  const shipments = [];
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    const orderNumber = String(row[orderNumberIndex] ?? '').trim();
    const trackingNumber = String(row[trackingNumberIndex] ?? '').trim();
    const shippingMethod = shippingMethodIndex >= 0 && String(row[shippingMethodIndex] ?? '').trim()
      ? String(row[shippingMethodIndex]).trim()
      : defaultShippingMethod;
    if (
      !orderNumber ||
      orderNumber.length > 100 ||
      !trackingNumber ||
      trackingNumber.length > 100 ||
      !SHIPPING_METHODS.has(shippingMethod)
    ) {
      return { error: `第 ${index + 1} 列的訂單編號、運單號或出貨方式無效。` };
    }
    shipments.push({
      order_number: orderNumber,
      tracking_number: trackingNumber,
      shipping_method: shippingMethod
    });
  }
  if (new Set(shipments.map(row => row.order_number.toLocaleUpperCase())).size !== shipments.length) {
    return { error: '物流檔案包含重複訂單編號，請先整理後再匯入。' };
  }
  return { shipments };
}

function sendError(res, status, message, data = null) {
  return res.status(status).json({
    success: false,
    data,
    message
  });
}

function parseOrderId(value) {
  if (typeof value !== 'string') {
    return null;
  }
  if (/^[1-9]\d*$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? String(parsed) : null;
  }
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase()
    : null;
}

function normalizePhone(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().replace(/^\+/, '');
  return /^\d{8,15}$/.test(normalized) ? normalized : null;
}

function createShippingRouter(supabase, options = {}) {
  const router = express.Router();
  const adminToken = options.adminToken || '';
  const writeEnabled = options.writeEnabled === true;
  const readEnabled = options.readEnabled === true;
  const sendWhatsApp = options.sendWhatsApp;

  router.use((req, res, next) => {
    if (adminToken.length < 32 || adminToken.startsWith('replace-with-')) {
      return sendError(res, 503, '出貨服務尚未設定 SHIPPING_ADMIN_TOKEN。');
    }

    const authorized = typeof options.isSessionAuthorized === 'function'
      ? options.isSessionAuthorized(req, adminToken, 'shipping')
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
      return sendError(res, 401, '沒有權限使用出貨服務。');
    }

    if (req.method !== 'GET' && !writeEnabled) {
      return sendError(res, 503, '出貨服務需要設定 SUPABASE_SERVICE_ROLE_KEY 才可安全運作。');
    }

    if (req.method === 'GET' && !readEnabled && !writeEnabled) {
      return sendError(res, 503, '執貨清單讀取服務尚未設定 Supabase 資料庫連線。');
    }

    return next();
  });

  function handleRpcError(res, error, operation) {
    console.error(`${operation} Supabase RPC 失敗：`, error);

    if (error && MISSING_RPC_CODES.has(error.code)) {
      return sendError(res, 503, '出貨資料庫遷移尚未執行，請先套用出貨管理 migration。');
    }
    if (error && error.code === 'P0002') {
      return sendError(res, 404, '找不到指定訂單。');
    }
    if (error && error.code === '55000') {
      return sendError(res, 409, error.message || '訂單目前不可出貨。');
    }
    if (error && (error.code === '22023' || error.code === '23514')) {
      return sendError(res, 400, error.message || '出貨資料不符合資料庫規則。');
    }

    return sendError(res, 500, `${operation}失敗，資料庫交易已回滾，請稍後再試。`);
  }

  async function getTablePickList(groupBy) {
    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select('order_id,order_date,customer_phone,shipping_method,tracking_number,shipping_status')
      .eq('shipping_status', '可出貨')
      .order('order_date', { ascending: true })
      .limit(MAX_PICK_LIST_ORDERS + 1);

    if (ordersError) {
      throw ordersError;
    }
    if (!Array.isArray(orders)) {
      throw new Error('Supabase 執貨清單訂單查詢回傳格式無效。');
    }
    if (orders.length > MAX_PICK_LIST_ORDERS) {
      const error = new Error('可出貨訂單超過清單讀取上限，請縮短查詢範圍。');
      error.statusCode = 413;
      throw error;
    }
    if (orders.length === 0) {
      return [];
    }

    const orderIds = orders.map(order => order.order_id);
    const { data: items, error: itemsError } = await supabase
      .from('order_items')
      .select('item_id,order_id,product_id,quantity,item_status')
      .in('order_id', orderIds)
      .eq('item_status', '已到貨倉')
      .limit(MAX_PICK_LIST_ITEMS + 1);

    if (itemsError) {
      throw itemsError;
    }
    if (!Array.isArray(items)) {
      throw new Error('Supabase 執貨清單明細查詢回傳格式無效。');
    }
    if (items.length > MAX_PICK_LIST_ITEMS) {
      const error = new Error('執貨清單明細超過讀取上限，請縮短查詢範圍。');
      error.statusCode = 413;
      throw error;
    }

    const readyOrders = orders.filter(order => (
      items.some(item => String(item.order_id) === String(order.order_id))
    ));
    if (items.length === 0) {
      return [];
    }

    const productIds = [...new Set(items.map(item => item.product_id))];
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('id,name,product_name')
      .in('id', productIds);

    if (productsError) {
      throw productsError;
    }
    if (!Array.isArray(products)) {
      throw new Error('Supabase 執貨清單商品查詢回傳格式無效。');
    }

    const ordersById = new Map(readyOrders.map(order => [String(order.order_id), order]));
    const productsById = new Map(products.map(product => [
      String(product.id),
      String(product.product_name || product.name || '未命名商品')
    ]));
    const rows = items.map(item => {
      const order = ordersById.get(String(item.order_id));
      if (!order) {
        return null;
      }
      return {
        order_id: order.order_id,
        order_date: order.order_date,
        customer_phone: order.customer_phone,
        shipping_method: order.shipping_method,
        tracking_number: order.tracking_number,
        shipping_status: order.shipping_status,
        item_id: item.item_id,
        product_id: item.product_id,
        product_name: productsById.get(String(item.product_id)) || '未命名商品',
        quantity: item.quantity
      };
    }).filter(Boolean);

    if (groupBy === 'product') {
      const productsGrouped = new Map();
      for (const row of rows) {
        const key = String(row.product_id);
        const group = productsGrouped.get(key) || {
          product_id: row.product_id,
          product_name: row.product_name,
          total_quantity: 0,
          orders: []
        };
        group.total_quantity += Number(row.quantity);
        group.orders.push({
          order_id: row.order_id,
          item_id: row.item_id,
          quantity: row.quantity
        });
        productsGrouped.set(key, group);
      }
      return [...productsGrouped.values()];
    }

    const ordersGrouped = new Map();
    for (const row of rows) {
      const key = String(row.order_id);
      const group = ordersGrouped.get(key) || {
        order_id: row.order_id,
        order_date: row.order_date,
        customer_phone: row.customer_phone,
        shipping_method: row.shipping_method,
        tracking_number: row.tracking_number,
        shipping_status: row.shipping_status,
        items: []
      };
      group.items.push({
        item_id: row.item_id,
        product_id: row.product_id,
        product_name: row.product_name,
        quantity: row.quantity,
        item_status: '已到貨倉'
      });
      ordersGrouped.set(key, group);
    }
    return [...ordersGrouped.values()];
  }

  async function sendShipmentNotification(orderId) {
    let notification;
    try {
      const result = await supabase.rpc(
        'claim_shipping_notification',
        { p_order_id: orderId }
      );
      notification = result.data;

      if (result.error) {
        console.error('取得出貨通知工作失敗：', { orderId, error: result.error });
        return {
          success: false,
          status: 'pending',
          message: '出貨已完成，但無法取得通知工作；請稍後重試通知。'
        };
      }
    } catch (error) {
      console.error('呼叫出貨通知 claim RPC 時發生錯誤：', { orderId, error });
      return {
        success: false,
        status: 'pending',
        message: '出貨已完成，但無法取得通知工作；請稍後重試通知。'
      };
    }

    if (!notification || typeof notification !== 'object') {
      console.error('出貨通知 claim RPC 回傳格式無效：', notification);
      return {
        success: false,
        status: 'unknown',
        message: '出貨已完成，但通知工作狀態無效；請檢查資料庫通知佇列。'
      };
    }

    if (notification.claimed !== true) {
      if (!['pending', 'sending', 'sent', 'failed'].includes(notification.status)) {
        console.error('出貨通知 claim RPC 回傳未知狀態：', notification);
        return {
          success: false,
          status: 'unknown',
          message: '出貨已完成，但通知工作狀態無效；請檢查資料庫通知佇列。'
        };
      }

      return {
        success: notification.status === 'sent',
        status: notification.status,
        message: '通知已由其他工作程序處理或目前仍在處理中。'
      };
    }

    let failureMessage = '';
    try {
      if (
        typeof notification.customer_phone !== 'string' ||
        normalizePhone(notification.customer_phone) === null ||
        typeof notification.shipping_method !== 'string' ||
        typeof notification.tracking_number !== 'string'
      ) {
        throw new Error('出貨通知資料格式無效。');
      }
      if (typeof sendWhatsApp !== 'function') {
        throw new Error('WhatsApp Cloud API 尚未設定。');
      }

      const text = [
        `LittlePlanet 出貨通知：訂單 #${orderId} 已出貨。`,
        `快遞公司／方式：${notification.shipping_method}`,
        `運單號碼：${notification.tracking_number}`
      ].join('\n');

      await sendWhatsApp({
        to: notification.customer_phone,
        text
      });
    } catch (error) {
      failureMessage = error instanceof Error ? error.message : 'WhatsApp 訊息發送失敗。';
      console.error('WhatsApp 出貨通知發送失敗：', { orderId, error });
    }

    let result;
    try {
      const finishResult = await supabase.rpc(
        'finish_shipping_notification',
        {
          p_order_id: orderId,
          p_success: failureMessage.length === 0,
          p_error_message: failureMessage ? failureMessage.slice(0, 500) : null
        }
      );
      result = finishResult.data;
      if (finishResult.error) {
        console.error('更新出貨通知結果失敗：', { orderId, error: finishResult.error });
        return {
          success: false,
          status: 'sending',
          message: '出貨已完成，但通知發送結果未能記錄；請檢查 WhatsApp 及通知狀態。'
        };
      }
    } catch (error) {
      console.error('呼叫出貨通知 finish RPC 時發生錯誤：', { orderId, error });
      return {
        success: false,
        status: 'sending',
        message: '出貨已完成，但通知發送結果未能記錄；請檢查 WhatsApp 及通知狀態。'
      };
    }

    const expectedStatus = failureMessage ? 'failed' : 'sent';
    if (!result || result.status !== expectedStatus) {
      console.error('更新出貨通知 RPC 回傳格式無效：', { orderId, result });
      return {
        success: false,
        status: 'unknown',
        message: '出貨已完成，但通知結果未能確認；請檢查通知佇列。'
      };
    }

    if (failureMessage) {
      return {
        success: false,
        status: result.status,
        message: '出貨已完成，但 WhatsApp 通知發送失敗；可呼叫通知重試 API。',
        error: failureMessage
      };
    }

    return {
      success: true,
      status: result.status,
      message: 'WhatsApp 出貨通知已發送。'
    };
  }

  router.get('/pick-list', async (req, res) => {
    try {
      const groupBy = req.query.group_by || 'order';
      if (!['order', 'product'].includes(groupBy)) {
        return sendError(res, 400, 'group_by 只接受 order 或 product。');
      }

      let data;
      if (readEnabled && !writeEnabled) {
        data = await getTablePickList(groupBy);
      } else {
        const { data: rpcData, error } = await supabase.rpc('get_shipping_pick_list', {
          p_group_by: groupBy
        });
        if (error) {
          return handleRpcError(res, error, '取得執貨清單');
        }
        data = rpcData;
      }
      if (!Array.isArray(data)) {
        console.error('執貨清單 RPC 回傳格式無效：', data);
        return sendError(res, 500, '執貨清單格式無效，請檢查資料庫 RPC。');
      }

      return res.json({
        success: true,
        data,
        message: `已產生按${groupBy === 'order' ? '訂單' : '貨品'}分組的執貨清單。`
      });
    } catch (error) {
      console.error('取得執貨清單時發生未預期錯誤：', error);
      if (error && error.statusCode === 413) {
        return sendError(res, 413, error.message);
      }
      if (error && (error.code === '42703' || error.code === 'PGRST204')) {
        return sendError(res, 503, '資料庫出貨／明細欄位尚未同步，請先執行相關 migrations。');
      }
      return sendError(res, 500, '取得執貨清單時發生錯誤，請稍後再試。');
    }
  });

  router.post(
    '/bulk-tracking',
    express.raw({
      type: [
        'text/csv',
        'application/csv',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
        'application/octet-stream'
      ],
      limit: MAX_BULK_TRACKING_FILE_BYTES
    }),
    async (req, res) => {
      try {
        const fileNameHeader = req.get('x-upload-filename') || '';
        let fileName;
        try {
          fileName = decodeURIComponent(fileNameHeader);
        } catch (error) {
          return sendError(res, 400, '物流檔案名稱格式無效。');
        }
        if (
          !fileName ||
          fileName.length > 255 ||
          /[\\/\u0000-\u001f\u007f]/.test(fileName)
        ) {
          return sendError(res, 400, '請提供有效的 CSV 或 Excel 物流檔案名稱。');
        }
        let defaultShippingMethod;
        try {
          defaultShippingMethod = decodeURIComponent(req.get('x-shipping-method') || '');
        } catch (error) {
          return sendError(res, 400, '預設運送方式格式無效。');
        }
        const file = req.body;
        if (
          !Buffer.isBuffer(file) ||
          file.length < 1 ||
          file.length > MAX_BULK_TRACKING_FILE_BYTES
        ) {
          return sendError(res, 400, '物流檔案不可為空，且大小不可超過 2MB。');
        }

        const parsed = parseBulkTrackingFile(file, fileName, defaultShippingMethod);
        if (parsed.error) {
          return sendError(res, 400, parsed.error);
        }
        const { data, error } = await supabase.rpc('bulk_ship_orders', {
          p_shipments: parsed.shipments
        });
        if (error) {
          return handleRpcError(res, error, '批量匯入物流單號');
        }
        if (
          !data ||
          typeof data !== 'object' ||
          !Array.isArray(data.shipments) ||
          !Array.isArray(data.order_ids) ||
          data.shipments.length !== parsed.shipments.length ||
          data.order_ids.length !== parsed.shipments.length
        ) {
          console.error('批量出貨 RPC 回傳格式無效：', data);
          return sendError(res, 500, '批量出貨結果格式無效，請檢查資料庫 RPC。');
        }

        const results = [];
        for (let index = 0; index < data.order_ids.length; index += 1) {
          const orderId = String(data.order_ids[index]);
          let notification;
          try {
            notification = await sendShipmentNotification(orderId);
          } catch (error) {
            console.error('批量出貨後發送 WhatsApp 通知時發生錯誤：', { orderId, error });
            notification = {
              success: false,
              message: '出貨成功，但 WhatsApp 通知未能確認，可稍後重試。'
            };
          }
          results.push({
            order_number: data.shipments[index].order_number,
            tracking_number: parsed.shipments[index].tracking_number,
            notification
          });
        }

        const failedNotifications = results.filter(result => !result.notification.success).length;
        return res.json({
          success: true,
          data: {
            imported_count: results.length,
            failed_notifications: failedNotifications,
            results
          },
          message: failedNotifications === 0
            ? `已成功匯入 ${results.length} 筆物流單號並發送通知。`
            : `已成功匯入 ${results.length} 筆物流單號；${failedNotifications} 筆 WhatsApp 通知未能確認，可稍後重試。`
        });
      } catch (error) {
        console.error('批量匯入物流單號時發生未預期錯誤：', error);
        if (error && error.statusCode === 413) {
          return sendError(res, 413, '物流檔案大小不可超過 2MB。');
        }
        return sendError(res, 500, '批量匯入物流單號時發生錯誤，資料庫交易未確認，請稍後再試。');
      }
    }
  );

  router.post('/:orderId/ship', async (req, res) => {
    try {
      const orderId = parseOrderId(req.params.orderId);
      if (orderId === null) {
        return sendError(res, 400, '訂單編號格式無效。');
      }

      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return sendError(res, 400, '出貨資料格式無效。');
      }

      const shippingMethod = typeof body.shipping_method === 'string'
        ? body.shipping_method.trim()
        : '';
      if (!SHIPPING_METHODS.has(shippingMethod)) {
        return sendError(res, 400, 'shipping_method 必須是面交、自取、順豐或京東。');
      }

      const trackingNumber = typeof body.tracking_number === 'string'
        ? body.tracking_number.trim()
        : '';
      if (!trackingNumber || trackingNumber.length > 100) {
        return sendError(res, 400, 'tracking_number 必須是 1 至 100 個字元。');
      }

      let customerPhone = null;
      if (body.customer_phone !== undefined && body.customer_phone !== null) {
        customerPhone = normalizePhone(body.customer_phone);
        if (customerPhone === null) {
          return sendError(res, 400, 'customer_phone 必須是 8 至 15 位數字，可選擇以 + 開頭。');
        }
      }

      const { data, error } = await supabase.rpc('ship_order', {
        p_order_id: orderId,
        p_shipping_method: shippingMethod,
        p_tracking_number: trackingNumber,
        p_customer_phone: customerPhone
      });

      if (error) {
        return handleRpcError(res, error, '更新出貨資料');
      }
      if (!data || typeof data !== 'object' || data.success !== true) {
        console.error('出貨 RPC 回傳格式無效：', data);
        return sendError(res, 500, '出貨結果格式無效，請檢查資料庫 RPC。');
      }

      const notification = await sendShipmentNotification(orderId);
      return res.json({
        success: true,
        data: {
          ...data,
          notification
        },
        message: notification.success
          ? '訂單已標記為已出貨，WhatsApp 通知已發送。'
          : '訂單已標記為已出貨；WhatsApp 通知未能確認送達，可稍後重試。'
      });
    } catch (error) {
      console.error('更新出貨資料時發生未預期錯誤：', error);
      return sendError(res, 500, '更新出貨資料時發生錯誤，請檢查訂單及通知狀態。');
    }
  });

  router.post('/:orderId/notification/retry', async (req, res) => {
    try {
      const orderId = parseOrderId(req.params.orderId);
      if (orderId === null) {
        return sendError(res, 400, '訂單編號格式無效。');
      }

      const notification = await sendShipmentNotification(orderId);
      if (!notification.success) {
        return res.status(502).json({
          success: false,
          data: { order_id: orderId, notification },
          message: notification.message
        });
      }

      return res.json({
        success: true,
        data: { order_id: orderId, notification },
        message: notification.message
      });
    } catch (error) {
      console.error('重試 WhatsApp 出貨通知時發生未預期錯誤：', error);
      return sendError(res, 500, '重試出貨通知時發生錯誤，請稍後再試。');
    }
  });

  return router;
}

module.exports = createShippingRouter;
