const crypto = require('crypto');
const express = require('express');
const NodeCache = require('node-cache');

const MISSING_RPC_CODES = new Set(['42883', 'PGRST202']);
const PAYMENT_STATUSES = new Set(['未付款', '已付訂金', '已付清']);
const SHIPPING_STATUSES = new Set(['待到貨', '部分到貨', '可出貨', '已出貨']);
const MAX_DATE_RANGE_DAYS = 3660;
const MAX_PAGE_SIZE = 100;
const MAX_TOP_PRODUCTS = 50;
const MAX_FALLBACK_ORDERS = 5000;
const MAX_FALLBACK_ITEMS = 20000;

function sendError(res, status, message) {
  return res.status(status).json({
    success: false,
    data: null,
    message
  });
}

function parseDate(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value.startsWith('0000-')
  ) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return null;
  }

  return date;
}

function parseInteger(value, minimum, maximum, defaultValue) {
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

function validateDateRange(query) {
  const startDate = parseDate(query.start_date);
  const endDate = parseDate(query.end_date);
  if (!startDate || !endDate || startDate > endDate) {
    return null;
  }

  const days = (endDate.getTime() - startDate.getTime()) / 86400000 + 1;
  if (days > MAX_DATE_RANGE_DAYS) {
    return null;
  }

  return {
    startDate: query.start_date,
    endDate: query.end_date,
    startAt: `${query.start_date}T00:00:00+08:00`,
    endAt: `${new Date(endDate.getTime() + 86400000).toISOString().slice(0, 10)}T00:00:00+08:00`
  };
}

function calculateOverview(orders, dateRange) {
  const totalOrders = orders.length;
  const totalRevenue = orders.reduce(
    (sum, order) => sum + Number(order.total_amount || 0),
    0
  );
  const paidOrders = orders.filter(order => (
    order.payment_status === '已付訂金' || order.payment_status === '已付清'
  )).length;
  const unpaidOrders = orders.filter(order => order.payment_status === '未付款').length;
  const shippedOrders = orders.filter(order => order.shipping_status === '已出貨').length;
  const unshippedOrders = orders.filter(order => order.shipping_status !== '已出貨').length;

  return {
    start_date: dateRange.startDate,
    end_date: dateRange.endDate,
    total_revenue: Math.round((totalRevenue + Number.EPSILON) * 100) / 100,
    total_orders: totalOrders,
    paid_orders: paidOrders,
    unpaid_orders: unpaidOrders,
    paid_order_percentage: totalOrders ? Math.round(paidOrders * 10000 / totalOrders) / 100 : 0,
    unpaid_order_percentage: totalOrders ? Math.round(unpaidOrders * 10000 / totalOrders) / 100 : 0,
    shipped_orders: shippedOrders,
    unshipped_orders: unshippedOrders,
    shipped_order_percentage: totalOrders ? Math.round(shippedOrders * 10000 / totalOrders) / 100 : 0,
    unshipped_order_percentage: totalOrders ? Math.round(unshippedOrders * 10000 / totalOrders) / 100 : 0
  };
}

function hongKongDate(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(value));
  const dateParts = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
}

function createDailySalesTrend(orders, dateRange) {
  const start = parseDate(dateRange.startDate);
  const end = parseDate(dateRange.endDate);
  const dailyTotals = new Map();
  for (
    let day = start.getTime();
    day <= end.getTime();
    day += 86400000
  ) {
    const date = new Date(day).toISOString().slice(0, 10);
    dailyTotals.set(date, { revenue: 0, order_count: 0 });
  }

  for (const order of orders) {
    const date = hongKongDate(order.order_date);
    const total = dailyTotals.get(date);
    if (!total) {
      continue;
    }
    total.revenue += Number(order.total_amount || 0);
    total.order_count += 1;
  }

  const labels = [...dailyTotals.keys()];
  const revenue = labels.map(date => (
    Math.round((dailyTotals.get(date).revenue + Number.EPSILON) * 100) / 100
  ));
  const orderCount = labels.map(date => dailyTotals.get(date).order_count);

  return {
    start_date: dateRange.startDate,
    end_date: dateRange.endDate,
    labels,
    revenue,
    order_count: orderCount,
    total_revenue: Math.round(
      (revenue.reduce((sum, value) => sum + value, 0) + Number.EPSILON) * 100
    ) / 100,
    total_orders: orderCount.reduce((sum, value) => sum + value, 0)
  };
}

function createAnalyticsRouter(supabase, options = {}) {
  const router = express.Router();
  const adminToken = options.adminToken || '';
  const readEnabled = options.readEnabled === true;
  const useTableFallback = options.useTableFallback === true;
  const cacheTtlSeconds = Number.isSafeInteger(options.cacheTtlSeconds) &&
      options.cacheTtlSeconds > 0
    ? options.cacheTtlSeconds
    : 60;
  const reportCache = options.cache || new NodeCache({
    stdTTL: cacheTtlSeconds,
    checkperiod: cacheTtlSeconds * 2,
    maxKeys: 1000,
    useClones: false
  });

  function createCacheKey(report, parameters) {
    return `analytics:${report}:${JSON.stringify(parameters)}`;
  }

  function sendCachedResponse(res, cacheKey, message) {
    const data = reportCache.get(cacheKey);
    if (data === undefined) {
      res.set('X-Analytics-Cache', 'MISS');
      return null;
    }

    res.set('X-Analytics-Cache', 'HIT');
    return res.json({
      success: true,
      data,
      message
    });
  }

  function storeCachedResponse(cacheKey, data) {
    try {
      reportCache.set(cacheKey, data, cacheTtlSeconds);
    } catch (error) {
      console.error('儲存 Analytics 快取時發生錯誤：', error);
    }
  }

  router.use((req, res, next) => {
    if (adminToken.length < 32 || adminToken.startsWith('replace-with-')) {
      return sendError(res, 503, '報表服務尚未設定 ANALYTICS_ADMIN_TOKEN。');
    }

    const authorized = options.requireSession === true
      ? (
        typeof options.isSessionAuthorized === 'function' &&
        options.isSessionAuthorized(req, 'analytics')
      )
      : typeof options.isSessionAuthorized === 'function'
        ? options.isSessionAuthorized(req, adminToken, 'analytics')
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
      return sendError(res, 401, '沒有權限使用管理報表。');
    }

    if (!readEnabled) {
      return sendError(res, 503, '報表服務需要設定 SUPABASE_SERVICE_ROLE_KEY 才可查詢。');
    }

    return next();
  });

  function handleRpcError(res, error, operation) {
    console.error(`${operation} Supabase RPC 失敗：`, error);
    if (error && MISSING_RPC_CODES.has(error.code)) {
      return sendError(res, 503, '報表資料庫 migration 尚未執行。');
    }
    if (error && error.code === '22023') {
      return sendError(res, 400, error.message || '報表查詢條件無效。');
    }
    return sendError(res, 500, `${operation}失敗，請稍後再試。`);
  }

  async function fetchOrdersInRange(dateRange, columns) {
    const { data, error } = await supabase
      .from('orders')
      .select(columns)
      .gte('order_date', dateRange.startAt)
      .lt('order_date', dateRange.endAt)
      .order('order_date', { ascending: false })
      .limit(MAX_FALLBACK_ORDERS + 1);

    if (error) {
      throw error;
    }
    if (!Array.isArray(data)) {
      throw new Error('Supabase 訂單報表查詢回傳格式無效。');
    }
    if (data.length > MAX_FALLBACK_ORDERS) {
      const error = new Error('查詢範圍內訂單超過報表讀取上限，請縮短日期區間。');
      error.statusCode = 413;
      throw error;
    }
    return data;
  }

  async function fetchItemsForOrders(orderIds) {
    if (orderIds.length === 0) {
      return [];
    }

    const { data, error } = await supabase
      .from('order_items')
      .select('item_id, order_id, product_id, quantity, unit_price, item_status')
      .in('order_id', orderIds)
      .limit(MAX_FALLBACK_ITEMS + 1);

    if (error) {
      throw error;
    }
    if (!Array.isArray(data)) {
      throw new Error('Supabase 訂單明細報表查詢回傳格式無效。');
    }
    if (data.length > MAX_FALLBACK_ITEMS) {
      const error = new Error('查詢範圍內訂單明細超過報表讀取上限，請縮短日期區間。');
      error.statusCode = 413;
      throw error;
    }
    return data;
  }

  async function fetchProductNames(productIds) {
    if (productIds.length === 0) {
      return new Map();
    }

    const { data, error } = await supabase
      .from('products')
      .select('id, name')
      .in('id', productIds);

    if (error) {
      throw error;
    }
    if (!Array.isArray(data)) {
      throw new Error('Supabase 商品報表查詢回傳格式無效。');
    }
    return new Map(data.map(product => [
      String(product.id),
      String(product.product_name || product.name || '未命名商品')
    ]));
  }

  function handleFallbackError(res, error, operation) {
    console.error(`${operation} Supabase 查詢失敗：`, error);
    if (error && error.statusCode === 413) {
      return sendError(res, 413, error.message);
    }
    if (error && (error.code === '42703' || error.code === 'PGRST204')) {
      return sendError(res, 503, '資料庫報表欄位尚未同步，請確認相關資料表的 schema。');
    }
    return sendError(res, 500, `${operation}失敗，請稍後再試。`);
  }

  async function fetchSummaryRows(createQuery, maximumRows, operation) {
    const pageSize = 500;
    const rows = [];
    for (let offset = 0; offset <= maximumRows; offset += pageSize) {
      const { data, error } = await createQuery()
        .range(offset, offset + pageSize - 1);
      if (error) {
        throw error;
      }
      if (!Array.isArray(data)) {
        throw new Error(`Supabase ${operation}回傳格式無效。`);
      }
      rows.push(...data);
      if (rows.length > maximumRows) {
        const error = new Error(`${operation}超過安全讀取上限。`);
        error.statusCode = 413;
        throw error;
      }
      if (data.length < pageSize) {
        return rows;
      }
    }
    return rows;
  }

  router.get('/summary', async (req, res) => {
    if (
      options.requireSession !== true ||
      typeof options.isSessionAuthorized !== 'function' ||
      !options.isSessionAuthorized(req, 'analytics')
    ) {
      return sendError(res, 401, '營運分析摘要只允許具備 Analytics 權限的管理員 Session 存取。');
    }
    const cacheKey = createCacheKey('summary', {});
    const cachedResponse = sendCachedResponse(res, cacheKey, '營運分析摘要查詢完成。');
    if (cachedResponse) {
      return cachedResponse;
    }

    try {
      const orders = await fetchSummaryRows(
        () => supabase
          .from('orders')
          .select('order_id,order_date,total_amount')
          .order('order_date', { ascending: false }),
        MAX_FALLBACK_ORDERS,
        '營運摘要訂單查詢'
      );
      const orderIds = orders.map(order => order.order_id);
      const orderIdSet = new Set(orderIds.map(String));
      const items = orderIds.length === 0
        ? []
        : await fetchSummaryRows(
          () => supabase
            .from('order_items')
            .select('order_id,product_id,quantity,unit_price')
            .in('order_id', orderIds),
          MAX_FALLBACK_ITEMS,
          '營運摘要訂單商品查詢'
        );

      if (items.some(item => !orderIdSet.has(String(item.order_id)))) {
        console.error('營運摘要訂單商品查詢回傳未要求的訂單明細。');
        return sendError(res, 500, '訂單商品資料回傳格式無效。');
      }

      const totalsByProduct = new Map();
      for (const item of items) {
        const key = String(item.product_id);
        const quantity = Number(item.quantity);
        const unitPrice = Number(item.unit_price);
        if (
          !Number.isSafeInteger(quantity) ||
          quantity < 0 ||
          !Number.isFinite(unitPrice) ||
          unitPrice < 0
        ) {
          console.error('營運摘要遇到無效訂單商品數量或單價。');
          return sendError(res, 500, '訂單商品資料格式無效。');
        }
        const total = totalsByProduct.get(key) || {
          product_id: item.product_id,
          quantity_sold: 0,
          sales_amount: 0
        };
        total.quantity_sold += quantity;
        total.sales_amount += quantity * unitPrice;
        totalsByProduct.set(key, total);
      }

      const rankedProducts = [...totalsByProduct.values()]
        .sort((left, right) => (
          right.quantity_sold - left.quantity_sold ||
          right.sales_amount - left.sales_amount ||
          String(left.product_id).localeCompare(String(right.product_id))
        ))
        .slice(0, 10);
      const productNames = rankedProducts.length === 0
        ? new Map()
        : await fetchProductNames(rankedProducts.map(product => product.product_id));

      const today = hongKongDate(new Date());
      const todayDate = parseDate(today);
      const startDate = new Date(todayDate.getTime() - 6 * 86400000)
        .toISOString()
        .slice(0, 10);
      const trendDates = Array.from({ length: 7 }, (_, index) => (
        new Date(Date.parse(`${startDate}T00:00:00.000Z`) + index * 86400000)
          .toISOString()
          .slice(0, 10)
      ));
      const trend = new Map(trendDates.map(date => [date, {
        date,
        order_count: 0,
        revenue: 0
      }]));
      let totalRevenue = 0;
      for (const order of orders) {
        const amount = Number(order.total_amount || 0);
        if (!Number.isFinite(amount) || amount < 0) {
          console.error('營運摘要遇到無效訂單金額。');
          return sendError(res, 500, '訂單金額資料格式無效。');
        }
        totalRevenue += amount;
        const daily = trend.get(hongKongDate(order.order_date));
        if (daily) {
          daily.order_count += 1;
          daily.revenue += amount;
        }
      }
      const data = {
        generated_at: new Date().toISOString(),
        total_revenue: Math.round((totalRevenue + Number.EPSILON) * 100) / 100,
        total_orders: orders.length,
        top_products: rankedProducts.map((product, index) => ({
          ...product,
          product_name: productNames.get(String(product.product_id)) || '未命名商品',
          rank: index + 1,
          sales_amount: Math.round((product.sales_amount + Number.EPSILON) * 100) / 100
        })),
        order_trend: trendDates.map(date => {
          const daily = trend.get(date);
          return {
            ...daily,
            revenue: Math.round((daily.revenue + Number.EPSILON) * 100) / 100
          };
        })
      };
      storeCachedResponse(cacheKey, data);
      return res.json({
        success: true,
        data,
        message: '營運分析摘要查詢完成。'
      });
    } catch (error) {
      return handleFallbackError(res, error, '取得營運分析摘要');
    }
  });

  router.get('/profit', async (req, res) => {
    try {
      const dateRange = validateDateRange(req.query);
      if (!dateRange) {
        return sendError(
          res,
          400,
          `start_date 和 end_date 必須是有效 YYYY-MM-DD 日期，且區間不可超過 ${MAX_DATE_RANGE_DAYS} 日。`
        );
      }
      const limit = parseInteger(req.query.limit, 1, MAX_TOP_PRODUCTS, 10);
      if (limit === null) {
        return sendError(res, 400, `limit 必須是 1 至 ${MAX_TOP_PRODUCTS} 的整數。`);
      }

      const cacheKey = createCacheKey('profit', {
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        limit
      });
      const cachedResponse = sendCachedResponse(res, cacheKey, '商品成本與利潤分析查詢完成。');
      if (cachedResponse) {
        return cachedResponse;
      }

      const orders = await fetchOrdersInRange(
        dateRange,
        'order_id,total_amount'
      );
      const items = await fetchItemsForOrders(orders.map(order => order.order_id));
      const productIds = [...new Set(items.map(item => String(item.product_id)))];
      const productInfo = new Map();
      for (let offset = 0; offset < productIds.length; offset += 100) {
        const ids = productIds.slice(offset, offset + 100);
        const products = await fetchSummaryRows(
          () => supabase
            .from('products')
            .select('id,name,cost_price')
            .in('id', ids),
          100,
          '商品成本報表查詢'
        );
        for (const product of products) {
          if (
            !product ||
            (typeof product.id !== 'string' && typeof product.id !== 'number') ||
            typeof product.name !== 'string' ||
            product.cost_price !== null &&
              product.cost_price !== undefined &&
              (typeof product.cost_price !== 'number' &&
                typeof product.cost_price !== 'string' ||
                !Number.isFinite(Number(product.cost_price)) ||
                Number(product.cost_price) < 0)
          ) {
            console.error('商品成本報表遇到無效商品資料。');
            return sendError(res, 500, '商品成本資料格式無效。');
          }
          productInfo.set(String(product.id), {
            product_name: product.name,
            cost_price: product.cost_price === null || product.cost_price === undefined
              ? null
              : Number(product.cost_price)
          });
        }
      }

      const totalsByProduct = new Map();
      let totalRevenue = 0;
      let totalCost = 0;
      let unitsSold = 0;
      let unitsWithKnownCost = 0;
      let unknownCostItems = 0;
      for (const order of orders) {
        const amount = Number(order.total_amount);
        if (!Number.isFinite(amount) || amount < 0) {
          console.error('商品利潤報表遇到無效訂單金額。');
          return sendError(res, 500, '訂單金額資料格式無效。');
        }
        totalRevenue += amount;
      }

      for (const item of items) {
        const quantity = Number(item.quantity);
        const unitPrice = Number(item.unit_price);
        const key = String(item.product_id);
        const product = productInfo.get(key);
        if (
          !Number.isSafeInteger(quantity) ||
          quantity < 0 ||
          !Number.isFinite(unitPrice) ||
          unitPrice < 0
        ) {
          console.error('商品利潤報表遇到無效訂單商品資料。');
          return sendError(res, 500, '訂單商品資料格式無效。');
        }
        const salesAmount = quantity * unitPrice;
        const knownCost = product && product.cost_price !== null;
        const costAmount = knownCost ? quantity * product.cost_price : null;
        const total = totalsByProduct.get(key) || {
          product_id: item.product_id,
          product_name: product ? product.product_name : '商品資料已不存在',
          quantity_sold: 0,
          sales_amount: 0,
          cost_amount: 0,
          net_profit: 0,
          cost_known: true
        };
        total.quantity_sold += quantity;
        total.sales_amount += salesAmount;
        if (knownCost) {
          total.cost_amount += costAmount;
          total.net_profit += salesAmount - costAmount;
          unitsWithKnownCost += quantity;
          totalCost += costAmount;
        } else {
          total.cost_known = false;
          unknownCostItems += 1;
        }
        unitsSold += quantity;
        totalsByProduct.set(key, total);
      }

      const completeCostCoverage = unknownCostItems === 0;
      const rankedProducts = [...totalsByProduct.values()]
        .sort((left, right) => (
          (right.cost_known ? right.net_profit : Number.NEGATIVE_INFINITY) -
            (left.cost_known ? left.net_profit : Number.NEGATIVE_INFINITY) ||
          right.sales_amount - left.sales_amount ||
          String(left.product_id).localeCompare(String(right.product_id))
        ))
        .slice(0, limit)
        .map((product, index) => ({
          product_id: product.product_id,
          product_name: product.product_name,
          quantity_sold: product.quantity_sold,
          sales_amount: Math.round((product.sales_amount + Number.EPSILON) * 100) / 100,
          cost_amount: product.cost_known
            ? Math.round((product.cost_amount + Number.EPSILON) * 100) / 100
            : null,
          net_profit: product.cost_known
            ? Math.round((product.net_profit + Number.EPSILON) * 100) / 100
            : null,
          rank: index + 1
        }));
      const roundedRevenue = Math.round((totalRevenue + Number.EPSILON) * 100) / 100;
      const roundedCost = Math.round((totalCost + Number.EPSILON) * 100) / 100;
      const grossProfit = completeCostCoverage ? roundedRevenue - roundedCost : null;
      const data = {
        start_date: dateRange.startDate,
        end_date: dateRange.endDate,
        total_revenue: roundedRevenue,
        total_cost: roundedCost,
        gross_profit: grossProfit === null
          ? null
          : Math.round((grossProfit + Number.EPSILON) * 100) / 100,
        gross_margin_percentage: completeCostCoverage && roundedRevenue > 0
          ? Math.round((grossProfit / roundedRevenue) * 10000) / 100
          : null,
        cost_coverage_percentage: unitsSold > 0
          ? Math.round((unitsWithKnownCost / unitsSold) * 10000) / 100
          : 100,
        cost_data_complete: completeCostCoverage,
        unknown_cost_items: unknownCostItems,
        top_products: rankedProducts
      };
      storeCachedResponse(cacheKey, data);
      return res.json({
        success: true,
        data,
        message: '商品成本與利潤分析查詢完成。'
      });
    } catch (error) {
      return handleFallbackError(res, error, '取得商品成本與利潤分析');
    }
  });

  router.get('/overview', async (req, res) => {
    try {
      const dateRange = validateDateRange(req.query);
      if (!dateRange) {
        return sendError(
          res,
          400,
          `start_date 和 end_date 必須是有效 YYYY-MM-DD 日期，且區間不可超過 ${MAX_DATE_RANGE_DAYS} 日。`
        );
      }

      const cacheKey = createCacheKey('overview', {
        startDate: dateRange.startDate,
        endDate: dateRange.endDate
      });
      const cachedResponse = sendCachedResponse(res, cacheKey, '營收總覽查詢完成。');
      if (cachedResponse) {
        return cachedResponse;
      }

      let data;
      if (useTableFallback) {
        data = calculateOverview(
          await fetchOrdersInRange(
            dateRange,
            'order_id,total_amount,payment_status,shipping_status,order_date'
          ),
          dateRange
        );
      } else {
        const result = await supabase.rpc('get_revenue_overview', {
          p_start_date: dateRange.startDate,
          p_end_date: dateRange.endDate
        });
        data = result.data;
        if (result.error) {
          return handleRpcError(res, result.error, '取得營收總覽');
        }
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        console.error('營收總覽 RPC 回傳格式無效：', data);
        return sendError(res, 500, '營收總覽回傳格式無效。');
      }

      storeCachedResponse(cacheKey, data);
      return res.json({
        success: true,
        data,
        message: '營收總覽查詢完成。'
      });
    } catch (error) {
      if (useTableFallback) {
        return handleFallbackError(res, error, '取得營收總覽');
      }
      console.error('取得營收總覽時發生未預期錯誤：', error);
      return sendError(res, 500, '取得營收總覽時發生錯誤，請稍後再試。');
    }
  });

  router.get('/sales-trend', async (req, res) => {
    try {
      const dateRange = validateDateRange(req.query);
      if (!dateRange) {
        return sendError(
          res,
          400,
          `start_date 和 end_date 必須是有效 YYYY-MM-DD 日期，且區間不可超過 ${MAX_DATE_RANGE_DAYS} 日。`
        );
      }

      const cacheKey = createCacheKey('sales-trend', {
        startDate: dateRange.startDate,
        endDate: dateRange.endDate
      });
      const cachedResponse = sendCachedResponse(res, cacheKey, '每日銷售趨勢查詢完成。');
      if (cachedResponse) {
        return cachedResponse;
      }

      const orders = await fetchOrdersInRange(
        dateRange,
        'order_id,total_amount,order_date'
      );
      const data = createDailySalesTrend(orders, dateRange);
      storeCachedResponse(cacheKey, data);
      return res.json({
        success: true,
        data,
        message: '每日銷售趨勢查詢完成。'
      });
    } catch (error) {
      return handleFallbackError(res, error, '取得每日銷售趨勢');
    }
  });

  router.get('/top-products', async (req, res) => {
    try {
      const dateRange = validateDateRange(req.query);
      if (!dateRange) {
        return sendError(
          res,
          400,
          `start_date 和 end_date 必須是有效 YYYY-MM-DD 日期，且區間不可超過 ${MAX_DATE_RANGE_DAYS} 日。`
        );
      }

      const limit = parseInteger(req.query.limit, 1, MAX_TOP_PRODUCTS, 10);
      if (limit === null) {
        return sendError(res, 400, `limit 必須是 1 至 ${MAX_TOP_PRODUCTS} 的整數。`);
      }

      const cacheKey = createCacheKey('top-products', {
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        limit
      });
      const cachedResponse = sendCachedResponse(res, cacheKey, '熱銷商品排行榜查詢完成。');
      if (cachedResponse) {
        return cachedResponse;
      }

      let data;
      if (useTableFallback) {
        const orders = await fetchOrdersInRange(dateRange, 'order_id');
        const items = await fetchItemsForOrders(orders.map(order => order.order_id));
        const productIds = [...new Set(items.map(item => item.product_id))];
        const productNames = await fetchProductNames(productIds);
        const totals = new Map();

        for (const item of items) {
          const key = String(item.product_id);
          const current = totals.get(key) || {
            product_id: item.product_id,
            product_name: productNames.get(key) || '未命名商品',
            quantity_sold: 0,
            sales_amount: 0
          };
          current.quantity_sold += Number(item.quantity || 0);
          current.sales_amount += Number(item.quantity || 0) * Number(item.unit_price || 0);
          totals.set(key, current);
        }

        data = [...totals.values()]
          .sort((left, right) => (
            right.quantity_sold - left.quantity_sold ||
            right.sales_amount - left.sales_amount ||
            String(left.product_id).localeCompare(String(right.product_id))
          ))
          .slice(0, limit)
          .map((product, index) => ({
            ...product,
            rank: index + 1,
            sales_amount: Math.round((product.sales_amount + Number.EPSILON) * 100) / 100
          }));
      } else {
        const result = await supabase.rpc('get_top_selling_products', {
          p_start_date: dateRange.startDate,
          p_end_date: dateRange.endDate,
          p_limit: limit
        });
        data = result.data;
        if (result.error) {
          return handleRpcError(res, result.error, '取得熱銷商品排行榜');
        }
      }
      if (!Array.isArray(data)) {
        console.error('熱銷商品 RPC 回傳格式無效：', data);
        return sendError(res, 500, '熱銷商品排行榜回傳格式無效。');
      }

      storeCachedResponse(cacheKey, data);
      return res.json({
        success: true,
        data,
        message: '熱銷商品排行榜查詢完成。'
      });
    } catch (error) {
      if (useTableFallback) {
        return handleFallbackError(res, error, '取得熱銷商品排行榜');
      }
      console.error('取得熱銷商品排行榜時發生未預期錯誤：', error);
      return sendError(res, 500, '取得熱銷商品排行榜時發生錯誤，請稍後再試。');
    }
  });

  router.get('/reconciliation', async (req, res) => {
    try {
      const dateRange = validateDateRange(req.query);
      if (!dateRange) {
        return sendError(
          res,
          400,
          `start_date 和 end_date 必須是有效 YYYY-MM-DD 日期，且區間不可超過 ${MAX_DATE_RANGE_DAYS} 日。`
        );
      }

      const paymentStatus = req.query.payment_status || null;
      if (paymentStatus !== null && !PAYMENT_STATUSES.has(paymentStatus)) {
        return sendError(res, 400, 'payment_status 必須是未付款、已付訂金或已付清。');
      }

      const shippingStatus = req.query.shipping_status || null;
      if (shippingStatus !== null && !SHIPPING_STATUSES.has(shippingStatus)) {
        return sendError(res, 400, 'shipping_status 必須是待到貨、部分到貨、可出貨或已出貨。');
      }

      const limit = parseInteger(req.query.limit, 1, MAX_PAGE_SIZE, 50);
      const offset = parseInteger(req.query.offset, 0, 2147483647, 0);
      if (limit === null || offset === null) {
        return sendError(res, 400, `limit 必須是 1 至 ${MAX_PAGE_SIZE} 的整數，offset 必須是 0 至 2147483647 的整數。`);
      }

      const cacheKey = createCacheKey('reconciliation', {
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        paymentStatus,
        shippingStatus,
        limit,
        offset
      });
      const cachedResponse = sendCachedResponse(res, cacheKey, '財務對賬明細查詢完成。');
      if (cachedResponse) {
        return cachedResponse;
      }

      let data;
      if (useTableFallback) {
        let query = supabase
          .from('orders')
          .select(
            'order_id,order_date,total_amount,payment_status,shipping_status,shipping_method,tracking_number',
            { count: 'exact' }
          )
          .gte('order_date', dateRange.startAt)
          .lt('order_date', dateRange.endAt)
          .order('order_date', { ascending: false });
        if (paymentStatus !== null) {
          query = query.eq('payment_status', paymentStatus);
        }
        if (shippingStatus !== null) {
          query = query.eq('shipping_status', shippingStatus);
        }
        const { data: orders, error, count } = await query.range(offset, offset + limit - 1);
        if (error) {
          throw error;
        }
        if (!Array.isArray(orders)) {
          throw new Error('Supabase 財務對賬訂單查詢回傳格式無效。');
        }

        const items = await fetchItemsForOrders(orders.map(order => order.order_id));
        const productIds = [...new Set(items.map(item => item.product_id))];
        const productNames = await fetchProductNames(productIds);
        const itemsByOrderId = new Map();
        for (const item of items) {
          const key = String(item.order_id);
          const orderItems = itemsByOrderId.get(key) || [];
          orderItems.push({
            ...item,
            product_name: productNames.get(String(item.product_id)) || '未命名商品',
            line_total: Number(item.quantity || 0) * Number(item.unit_price || 0),
            received_quantity: item.item_status === '已到貨倉' || item.item_status === '已出貨'
              ? Number(item.quantity || 0)
              : 0
          });
          itemsByOrderId.set(key, orderItems);
        }
        data = {
          total_count: count === null ? orders.length : count,
          rows: orders.map(order => ({
            ...order,
            items: itemsByOrderId.get(String(order.order_id)) || []
          }))
        };
      } else {
        const result = await supabase.rpc('get_financial_reconciliation', {
          p_start_date: dateRange.startDate,
          p_end_date: dateRange.endDate,
          p_payment_status: paymentStatus,
          p_shipping_status: shippingStatus,
          p_limit: limit,
          p_offset: offset
        });
        data = result.data;
        if (result.error) {
          return handleRpcError(res, result.error, '查詢財務對賬明細');
        }
      }
      if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.rows)) {
        console.error('財務對賬 RPC 回傳格式無效：', data);
        return sendError(res, 500, '財務對賬明細回傳格式無效。');
      }

      storeCachedResponse(cacheKey, data);
      return res.json({
        success: true,
        data,
        message: '財務對賬明細查詢完成。'
      });
    } catch (error) {
      if (useTableFallback) {
        return handleFallbackError(res, error, '查詢財務對賬明細');
      }
      console.error('查詢財務對賬明細時發生未預期錯誤：', error);
      return sendError(res, 500, '查詢財務對賬明細時發生錯誤，請稍後再試。');
    }
  });

  return router;
}

module.exports = createAnalyticsRouter;
