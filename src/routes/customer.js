const crypto = require('crypto');
const express = require('express');
const {
  SESSION_TTL_SECONDS,
  createCustomerSession,
  getCustomerSession,
  setCustomerCookie,
} = require('../middleware/customer-session');

const MISSING_RPC_CODES = new Set(['42883', 'PGRST202']);
const MISSING_SCHEMA_CODES = new Set(['42P01', '42703', 'PGRST204', 'PGRST205']);
const MAX_CUSTOMER_PAGE_SIZE = 100;
const PRODUCT_ID_PATTERN =
  /^(?:[1-9]\d{0,18}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const WISHLIST_PRODUCT_FIELDS = new Set([
  'id',
  'product_id',
  'product_code',
  'name',
  'product_name',
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
  'created_at',
]);

function sendError(res, status, message) {
  return res.status(status).json({
    success: false,
    data: null,
    message,
  });
}

function normalizePhone(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().replace(/^\+/, '');
  return /^\d{8,15}$/.test(normalized) ? normalized : null;
}

function getPhoneVariants(value) {
  const normalized = normalizePhone(value);
  if (!normalized) {
    return [];
  }
  const rawPhone = normalized.replace(/^852/, '');
  return [
    ...new Set([normalized, rawPhone, `852${rawPhone}`, `+${normalized}`, `+852${rawPhone}`]),
  ];
}

function parseInteger(value, minimum, maximum, defaultValue) {
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function normalizeProductId(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return PRODUCT_ID_PATTERN.test(normalized) ? normalized : null;
}

function filterWishlistProductFields(product) {
  return Object.fromEntries(
    Object.entries(product).filter(([field]) => WISHLIST_PRODUCT_FIELDS.has(field))
  );
}

function getRateLimitKey(remoteAddress, secret) {
  if (typeof remoteAddress !== 'string' || remoteAddress.length === 0) {
    return null;
  }

  return crypto.createHmac('sha256', secret).update(remoteAddress).digest('hex');
}

function isSameOriginRequest(req) {
  const origin = req.get('origin');
  if (!origin) {
    return false;
  }
  try {
    return new URL(origin).origin === `${req.protocol}://${req.get('host')}`;
  } catch (error) {
    return false;
  }
}

function createCustomerRouter(supabase, options = {}) {
  const router = express.Router();
  const rateLimitSecret = options.rateLimitSecret || '';
  const sessionSecret = options.sessionSecret || '';
  const readEnabled = options.readEnabled === true;
  const secureCookie = options.secureCookie === true;

  function validateMemberService(res) {
    if (!readEnabled || !supabase) {
      sendError(res, 503, '會員服務尚未設定資料庫服務權限。');
      return false;
    }
    if (Buffer.byteLength(sessionSecret) < 32 || sessionSecret.startsWith('replace-with-')) {
      sendError(res, 503, '會員服務尚未設定 CUSTOMER_SESSION_SECRET。');
      return false;
    }
    return true;
  }

  function getWishlistMember(req, res) {
    if (!validateMemberService(res)) {
      return null;
    }
    const session = getCustomerSession(req, sessionSecret);
    if (!session) {
      sendError(res, 401, '會員工作階段已失效，請重新驗證。');
      return null;
    }
    return session;
  }

  // ==========================================
  // 0. 提供前端安全的公開配置 API (/config)
  // ==========================================
  router.get('/config', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      data: {
        supabaseUrl: process.env.SUPABASE_URL || 'https://wteditztyndkfvnzkpvn.supabase.co',
        supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
      },
      message: '取得前端配置成功。',
    });
  });

  // ==========================================
  // 1. 收藏清單 API (Wishlist)
  // ==========================================
  router.get('/wishlist', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const session = getWishlistMember(req, res);
    if (!session) return;

    const limit = parseInteger(req.query.limit, 1, MAX_CUSTOMER_PAGE_SIZE, MAX_CUSTOMER_PAGE_SIZE);
    const offset = parseInteger(req.query.offset, 0, 2147483647, 0);
    if (limit === null || offset === null) {
      return sendError(
        res,
        400,
        `limit 必須是 1 至 ${MAX_CUSTOMER_PAGE_SIZE} 的整數，offset 必須是非負整數。`
      );
    }

    try {
      let query = supabase
        .from('customer_wishlists')
        .select('id,product_id,created_at', { count: 'exact' });
      if (session.phone && session.phone.includes('|google|')) {
        const [email] = session.phone.split('|google|');
        query = query.eq('customer_email', email);
      } else {
        query = query.eq('customer_phone', session.phone);
      }

      const {
        data: savedItems,
        error,
        count,
      } = await query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

      if (error) {
        console.error('讀取會員收藏清單失敗：', error);
        if (MISSING_SCHEMA_CODES.has(error.code)) {
          return sendError(res, 503, '會員收藏資料庫 migration 尚未完成。');
        }
        return sendError(res, 500, '讀取會員收藏清單失敗，請稍後再試。');
      }

      const productIds = (savedItems || []).map((item) => String(item.product_id));
      let products = [];
      if (productIds.length > 0) {
        const { data, error: productsError } = await supabase
          .from('products')
          .select('*')
          .in('id', productIds);
        if (!productsError && Array.isArray(data)) {
          products = data;
        }
      }

      const productsById = new Map(
        products.map((p) => [String(p.id ?? p.product_id), filterWishlistProductFields(p)])
      );
      const wishlist = (savedItems || []).map((item) => ({
        id: item.id,
        product_id: String(item.product_id),
        created_at: item.created_at,
        product: productsById.get(String(item.product_id)) || null,
      }));

      return res.json({
        success: true,
        data: {
          wishlist,
          total_count: Number.isSafeInteger(count) ? count : wishlist.length,
          limit,
          offset,
        },
        message: '會員收藏清單載入完成。',
      });
    } catch (error) {
      console.error('處理會員收藏清單時發生未預期錯誤：', error);
      return sendError(res, 500, '讀取會員收藏清單時發生錯誤，請稍後再試。');
    }
  });

  router.post('/wishlist', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!isSameOriginRequest(req)) return sendError(res, 403, '收藏操作要求必須來自同一網站。');
    const session = getWishlistMember(req, res);
    if (!session) return;

    const body = req.body;
    if (!body || typeof body !== 'object') return sendError(res, 400, '收藏資料格式無效。');
    const productId = normalizeProductId(body.product_id);
    if (!productId) return sendError(res, 400, 'product_id 必須是有效的商品 ID。');

    try {
      const { data: product, error: productError } = await supabase
        .from('products')
        .select('id')
        .eq('id', productId)
        .maybeSingle();

      if (productError || !product) {
        return sendError(res, 404, '找不到要收藏的商品。');
      }

      const insertPayload = { product_id: product.id };
      if (session.phone && session.phone.includes('|google|')) {
        const [email] = session.phone.split('|google|');
        insertPayload.customer_email = email;
      } else {
        insertPayload.customer_phone = session.phone;
      }

      const { data: savedItem, error: insertError } = await supabase
        .from('customer_wishlists')
        .insert(insertPayload)
        .select('id,product_id,created_at')
        .single();

      if (insertError) {
        if (insertError.code === '23505') return sendError(res, 409, '此商品已在你的收藏清單中。');
        return sendError(res, 500, '加入收藏失敗，請稍後再試。');
      }

      return res.status(201).json({
        success: true,
        data: {
          id: savedItem.id,
          product_id: String(savedItem.product_id),
          created_at: savedItem.created_at,
        },
        message: '商品已加入收藏。',
      });
    } catch (error) {
      console.error('加入會員收藏失敗：', error);
      return sendError(res, 500, '加入收藏時發生錯誤，請稍後再試。');
    }
  });

  router.delete('/wishlist/:productId', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!isSameOriginRequest(req)) return sendError(res, 403, '收藏操作要求必須來自同一網站。');
    const session = getWishlistMember(req, res);
    if (!session) return;

    const productId = normalizeProductId(req.params.productId);
    if (!productId) return sendError(res, 400, 'product_id 格式無效。');

    try {
      let query = supabase.from('customer_wishlists').delete().eq('product_id', productId);
      if (session.phone && session.phone.includes('|google|')) {
        const [email] = session.phone.split('|google|');
        query = query.eq('customer_email', email);
      } else {
        query = query.eq('customer_phone', session.phone);
      }

      const { data, error } = await query.select('id,product_id').maybeSingle();
      if (error || !data) return sendError(res, 404, '此商品不在你的收藏清單中。');

      return res.json({
        success: true,
        data: { product_id: String(data.product_id) },
        message: '商品已從收藏清單移除。',
      });
    } catch (error) {
      return sendError(res, 500, '移除收藏時發生錯誤，請稍後再試。');
    }
  });

  // ==========================================
  // 2. 會員 Auth & Session 處理 (Google Auth & 認領 & 舊登入)
  // ==========================================

  // 2.1 歷史訂單認領 API (/member/link-phone)
  router.post('/member/link-phone', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!isSameOriginRequest(req)) return sendError(res, 403, '認領要求必須來自同一網站。');
    if (!validateMemberService(res)) return;

    const session = getCustomerSession(req, sessionSecret);
    if (!session || !session.phone || !session.phone.includes('|google|')) {
      return sendError(res, 401, '請先透過 Google 帳號登入會員中心後再進行訂單認領。');
    }

    const [email] = session.phone.split('|google|');
    const body = req.body || {};
    const phone = normalizePhone(body.customer_phone);
    const orderNumber = typeof body.order_number === 'string' ? body.order_number.trim() : '';

    if (!phone || !orderNumber) {
      return sendError(res, 400, '請提供過往訂單登記的手提電話號碼及其中一張訂單編號。');
    }

    try {
      const { data, error } = await supabase.rpc('link_customer_phone_orders', {
        p_google_email: email,
        p_phone: phone,
        p_sample_order_number: orderNumber,
      });

      if (error) {
        console.error('認領歷史訂單 RPC 失敗：', error);
        return sendError(res, 400, '核對失敗，請確認電話號碼與訂單編號是否匹配。');
      }

      const updatedCount = Array.isArray(data) && data[0] ? data[0].updated_count || data[0] : data;

      return res.json({
        success: true,
        data: { updated_count: updatedCount },
        message: `成功核對並認領 ${updatedCount || 0} 筆歷史訂單！過往訂單已永久綁定至您的 Google 帳號。`,
      });
    } catch (error) {
      console.error('認領歷史訂單發生未預期錯誤：', error);
      return sendError(res, 500, '認領訂單時發生系統錯誤，請稍後再試。');
    }
  });

  // Google OAuth 驗證登入
  router.post('/member/google-session', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!isSameOriginRequest(req)) return sendError(res, 403, '會員驗證要求必須來自同一網站。');
    if (!validateMemberService(res)) return;

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return sendError(res, 401, '缺少 Google 授權憑證 Token。');
    }

    const token = authHeader.split(' ')[1];
    try {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser(token);
      if (error || !user || !user.email) {
        return sendError(res, 401, '無效的 Google 身份證明文件或存取權限。');
      }

      const sessionPayload = `${user.email}|google|${user.id}`;
      const customerSession = createCustomerSession(sessionPayload, sessionSecret);
      setCustomerCookie(res, customerSession, {
        maxAge: SESSION_TTL_SECONDS,
        secure: secureCookie && req.protocol === 'https',
      });

      return res.json({
        success: true,
        data: {
          authenticated: true,
          auth_provider: 'google',
          email: user.email,
          user_metadata: user.user_metadata,
          expires_at: new Date(
            (Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS) * 1000
          ).toISOString(),
        },
        message: 'Google 驗證成功，順利登入會員中心。',
      });
    } catch (error) {
      console.error('Google Session 驗證失敗：', error);
      return sendError(res, 500, 'Google 登入驗證時發生錯誤。');
    }
  });

  // 手機 + 訂單號碼登入
  router.post('/member/session', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!isSameOriginRequest(req)) return sendError(res, 403, '會員驗證要求必須來自同一網站。');
    if (!validateMemberService(res)) return;

    const body = req.body;
    if (!body || typeof body !== 'object') return sendError(res, 400, '會員驗證資料格式無效。');

    const phone = normalizePhone(body.customer_phone);
    const orderInput = typeof body.order_id === 'string' ? body.order_id.trim() : '';

    if (!phone || !orderInput) {
      return sendError(res, 400, '請提供有效的手機號碼及訂單編號作身份驗證。');
    }

    try {
      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          orderInput
        );
      let query = supabase.from('orders').select('order_id, order_number, customer_phone');

      if (isUuid) {
        query = query.eq('order_id', orderInput);
      } else {
        query = query.eq('order_number', orderInput.toUpperCase());
      }

      const { data: order, error } = await query.maybeSingle();
      if (error) return sendError(res, 500, '會員身份驗證暫時無法完成，請稍後再試。');

      const storedPhone = order ? normalizePhone(order.customer_phone) : null;
      const isPhoneMatch =
        storedPhone &&
        phone &&
        (storedPhone === phone || storedPhone.slice(-8) === phone.slice(-8));

      if (!order || !isPhoneMatch) {
        return sendError(res, 401, '手機號碼或訂單編號不正確。');
      }

      const customerSession = createCustomerSession(phone, sessionSecret);
      setCustomerCookie(res, customerSession, {
        maxAge: SESSION_TTL_SECONDS,
        secure: secureCookie && req.protocol === 'https',
      });

      return res.json({
        success: true,
        data: {
          authenticated: true,
          expires_at: new Date(
            (Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS) * 1000
          ).toISOString(),
        },
        message: '會員驗證成功。',
      });
    } catch (error) {
      console.error('會員身份驗證錯誤：', error);
      return sendError(res, 500, '會員身份驗證時發生錯誤，請稍後再試。');
    }
  });

  // 取得目前 Session 狀態
  router.get('/member/session', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!validateMemberService(res)) return;

    const session = getCustomerSession(req, sessionSecret);
    if (!session) {
      return res.json({
        success: true,
        data: { authenticated: false },
        message: '尚未驗證會員身份。',
      });
    }

    const isGoogle = session.phone && session.phone.includes('|google|');
    if (isGoogle) {
      const [email] = session.phone.split('|google|');
      return res.json({
        success: true,
        data: {
          authenticated: true,
          auth_provider: 'google',
          email,
          display_info: email,
        },
        message: '會員工作階段有效。',
      });
    }

    return res.json({
      success: true,
      data: {
        authenticated: true,
        auth_provider: 'phone',
        phone: `••••${session.phone.slice(-4)}`,
        display_info: `••••${session.phone.slice(-4)}`,
      },
      message: '會員工作階段有效。',
    });
  });

  // 登出 API
  router.post('/member/logout', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!isSameOriginRequest(req)) return sendError(res, 403, '登出要求必須來自同一網站。');
    setCustomerCookie(res, '', {
      maxAge: 0,
      secure: secureCookie && req.protocol === 'https',
    });
    return res.json({
      success: true,
      data: { authenticated: false },
      message: '已安全登出會員中心。',
    });
  });

  // ==========================================
  // 3. 歷史訂單讀取 API (/orders)
  // ==========================================
  router.get('/orders', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!validateMemberService(res)) return;

    const session = getCustomerSession(req, sessionSecret);
    if (!session) return sendError(res, 401, '會員工作階段已失效，請重新驗證。');

    const limit = parseInteger(req.query.limit, 1, MAX_CUSTOMER_PAGE_SIZE, 50);
    const offset = parseInteger(req.query.offset, 0, 2147483647, 0);

    try {
      let ordersQuery = supabase
        .from('orders')
        .select(
          'order_id, order_number, order_date, total_amount, status, payment_status, shipping_status',
          { count: 'exact' }
        );

      const isGoogle = session.phone && session.phone.includes('|google|');
      let googleEmail = null;
      if (isGoogle) {
        const [email] = session.phone.split('|google|');
        googleEmail = email.toLowerCase();
        ordersQuery = ordersQuery.eq('customer_email', googleEmail);
      } else {
        ordersQuery = ordersQuery.in('customer_phone', getPhoneVariants(session.phone));
      }

      let {
        data: orders,
        error,
        count,
      } = await ordersQuery
        .order('order_date', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        console.error('讀取會員歷史訂單失敗：', error);
        if (MISSING_SCHEMA_CODES.has(error.code)) {
          return sendError(res, 503, '會員訂單資料表或欄位尚未完成設定。');
        }
        return sendError(res, 500, '讀取會員歷史訂單失敗，請稍後再試。');
      }

      if (isGoogle && (!Array.isArray(orders) || orders.length === 0)) {
        const { data: customer, error: customerError } = await supabase
          .from('customers')
          .select('customer_phone')
          .eq('google_email', googleEmail)
          .maybeSingle();

        if (customerError) {
          console.error('透過 Google 電郵尋找會員電話失敗：', customerError);
          if (MISSING_SCHEMA_CODES.has(customerError.code)) {
            return sendError(res, 503, 'Google 帳號綁定資料尚未完成設定。');
          }
          return sendError(res, 500, '讀取 Google 帳號綁定資料失敗，請稍後再試。');
        }

        if (customer && customer.customer_phone) {
          const phoneVariants = getPhoneVariants(customer.customer_phone);
          if (phoneVariants.length === 0) {
            console.error('Google 綁定資料中的客戶電話格式無效。');
            return sendError(res, 500, 'Google 帳號綁定資料格式無效。');
          }

          const phoneOrdersResult = await supabase
            .from('orders')
            .select(
              'order_id, order_number, order_date, total_amount, status, payment_status, shipping_status',
              { count: 'exact' }
            )
            .in('customer_phone', phoneVariants)
            .order('order_date', { ascending: false })
            .range(offset, offset + limit - 1);

          if (phoneOrdersResult.error) {
            console.error('透過 Google 綁定電話讀取會員訂單失敗：', phoneOrdersResult.error);
            if (MISSING_SCHEMA_CODES.has(phoneOrdersResult.error.code)) {
              return sendError(res, 503, '會員訂單資料表或欄位尚未完成設定。');
            }
            return sendError(res, 500, '讀取會員訂單失敗，請稍後再試。');
          }

          orders = phoneOrdersResult.data;
          count = phoneOrdersResult.count;
        }
      }

      const orderIds = (orders || []).map((o) => o.order_id);
      let items = [];
      if (orderIds.length > 0) {
        const { data: itemsData, error: itemsErr } = await supabase
          .from('order_items')
          .select('*')
          .in('order_id', orderIds);

        if (itemsErr) {
          console.error('撈取訂單明細失敗：', itemsErr);
        }
        if (Array.isArray(itemsData)) {
          items = itemsData;
        }
      }

      const productIds = [...new Set(items.map((item) => String(item.product_id)).filter(Boolean))];
      let products = [];
      if (productIds.length > 0) {
        const { data: prodData } = await supabase
          .from('products')
          .select('id, name, product_name')
          .in('id', productIds);
        if (Array.isArray(prodData)) products = prodData;
      }

      const productNames = new Map();
      products.forEach((p) => {
        const pId = String(p.id);
        const pName = p.product_name || p.name || '商品';
        productNames.set(pId, pName);
      });

      const itemsByOrder = new Map();
      for (const item of items) {
        const key = String(item.order_id);
        const orderItems = itemsByOrder.get(key) || [];
        const prodName =
          productNames.get(String(item.product_id)) || item.product_name || '精選商品';
        orderItems.push({
          ...item,
          product_name: prodName,
        });
        itemsByOrder.set(key, orderItems);
      }

      return res.json({
        success: true,
        data: {
          orders: (orders || []).map((order) => ({
            ...order,
            items: itemsByOrder.get(String(order.order_id)) || [],
          })),
          total_count: Number.isSafeInteger(count) ? count : (orders || []).length,
          need_link_phone: isGoogle && (!orders || orders.length === 0),
          limit,
          offset,
        },
        message: '會員歷史訂單載入完成。',
      });
    } catch (error) {
      console.error('處理會員歷史訂單時發生未預期錯誤：', error);
      return sendError(res, 500, '讀取會員歷史訂單時發生錯誤，請稍後再試。');
    }
  });

  router.post('/orders/forgot', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!readEnabled || !supabase) {
      return sendError(res, 503, '訂單查詢服務尚未設定權限。');
    }

    const body = req.body;
    if (!body || typeof body !== 'object') {
      return sendError(res, 400, '查詢資料格式無效。');
    }

    const customerPhone = normalizePhone(body.customer_phone);
    if (!customerPhone || body.order_id !== undefined) {
      return sendError(res, 400, '請提供有效的 customer_phone。');
    }

    const rawPhone = customerPhone.replace(/^852/, '');
    const phoneVariants = [
      ...new Set([
        customerPhone,
        rawPhone,
        `852${rawPhone}`,
        `+${customerPhone}`,
        `+852${rawPhone}`,
      ]),
    ];

    try {
      const { data, error } = await supabase
        .from('orders')
        .select('order_number, order_date, total_amount, payment_status')
        .in('customer_phone', phoneVariants)
        .order('order_date', { ascending: false })
        .limit(10);

      if (error) {
        console.error('找回訂單編號查詢失敗：', error);
        if (MISSING_SCHEMA_CODES.has(error.code)) {
          return sendError(res, 503, '訂單查詢資料庫尚未完成設定。');
        }
        return sendError(res, 500, '找回訂單編號失敗，請稍後再試。');
      }
      if (!Array.isArray(data)) {
        console.error('找回訂單編號查詢回傳格式無效。');
        return sendError(res, 500, '訂單查詢結果格式無效。');
      }

      return res.json({
        success: true,
        data: data.map((order) => ({
          order_number: order.order_number,
          order_date: order.order_date,
          total_amount: order.total_amount,
          payment_status: order.payment_status,
        })),
        message: '最近訂單編號已載入。',
      });
    } catch (error) {
      console.error('找回訂單編號時發生未預期錯誤：', error);
      return sendError(res, 500, '找回訂單編號失敗，請稍後再試。');
    }
  });

  // 4. 訪客單筆訂單查詢必須同時符合電話及正式訂單編號
  router.post('/orders/lookup', async (req, res) => {
    try {
      if (!readEnabled) return sendError(res, 503, '訂單查詢服務尚未設定權限。');
      const body = req.body;
      if (!body || typeof body !== 'object') return sendError(res, 400, '查詢資料格式無效。');

      const customerPhone = normalizePhone(body.customer_phone);
      const orderNumber = typeof body.order_number === 'string' ? body.order_number.trim() : '';
      if (
        !customerPhone ||
        !orderNumber ||
        orderNumber.length > 100 ||
        body.order_id !== undefined
      ) {
        return sendError(
          res,
          400,
          '為保障個人私隱，必須同時提供有效的 customer_phone 及 order_number。'
        );
      }

      const rawPhone = customerPhone.replace(/^852/, '');
      const phoneVariants = [
        ...new Set([
          customerPhone,
          rawPhone,
          `852${rawPhone}`,
          `+${customerPhone}`,
          `+852${rawPhone}`,
        ]),
      ];
      const { data: order, error } = await supabase
        .from('orders')
        .select(
          'order_id, order_number, customer_phone, shipping_status, shipping_method, shipping_carrier, tracking_number, payment_proof_url, payment_proof_status'
        )
        .in('customer_phone', phoneVariants)
        .eq('order_number', orderNumber.toUpperCase())
        .maybeSingle();
      if (error) {
        console.error('查詢訂單失敗：', error);
        return sendError(res, 500, '查詢訂單時發生錯誤。');
      }

      if (!order) {
        return res.json({
          success: true,
          data: [],
          message: '若資料相符，訂單資料將會顯示。',
        });
      }

      if (Buffer.byteLength(rateLimitSecret) < 32 || rateLimitSecret.startsWith('replace-with-')) {
        return sendError(res, 503, '訂單查詢服務尚未設定 CUSTOMER_LOOKUP_RATE_SECRET。');
      }
      const rateLimitKey = getRateLimitKey(
        req.ip || (req.socket && req.socket.remoteAddress),
        rateLimitSecret
      );
      if (!rateLimitKey) return sendError(res, 503, '無法安全驗證請求，請稍後再試。');

      const { data: lookupResult, error: lookupError } = await supabase.rpc(
        'lookup_customer_orders',
        {
          p_customer_phone: null,
          p_order_id: order.order_id,
          p_rate_limit_key: rateLimitKey,
        }
      );
      if (lookupError) {
        console.error('查詢單筆訂單資料失敗：', lookupError);
        if (MISSING_RPC_CODES.has(lookupError.code) || MISSING_SCHEMA_CODES.has(lookupError.code)) {
          return sendError(res, 503, '訂單查詢資料庫 migration 尚未完成。');
        }
        return sendError(res, 500, '查詢訂單時發生錯誤。');
      }
      if (!lookupResult || typeof lookupResult !== 'object') {
        console.error('訂單查詢 RPC 回傳格式無效：', lookupResult);
        return sendError(res, 500, '訂單查詢結果格式無效。');
      }
      if (lookupResult.rate_limited) {
        res.set('Retry-After', '900');
        return sendError(res, 429, '訂單查詢次數過多，請 15 分鐘後再試。');
      }
      if (!Array.isArray(lookupResult.orders)) {
        console.error('訂單查詢 RPC 缺少 orders 清單：', lookupResult);
        return sendError(res, 500, '訂單查詢結果格式無效。');
      }

      const formattedOrders = lookupResult.orders
        .filter((item) => item && String(item.order_id) === String(order.order_id))
        .map((item) => ({
          ...item,
          order_number: order.order_number,
          customer_phone: order.customer_phone,
          shipping_status: order.shipping_status,
          shipping_method: order.shipping_method,
          shipping_carrier: order.shipping_carrier,
          tracking_number: order.tracking_number,
          payment_proof_submitted: Boolean(order.payment_proof_url),
          payment_proof_status: order.payment_proof_status,
        }));

      return res.json({
        success: true,
        data: formattedOrders,
        message: '查詢完成。',
      });
    } catch (error) {
      console.error('查詢訂單未預期錯誤：', error);
      return sendError(res, 500, '查詢訂單時發生未預期錯誤。');
    }
  });

  return router;
}

module.exports = createCustomerRouter;
