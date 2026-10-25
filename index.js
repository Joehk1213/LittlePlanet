const express = require('express');
const crypto = require('node:crypto');
require('express-async-errors');
const { apiNotFound, errorHandler } = require('./middleware/error-handler');
const createAdminSessions = require('./middleware/admin-sessions');
const { createClient } = require('@supabase/supabase-js');
const createProductsRouter = require('./routes/products');
const createOrdersRouter = require('./routes/orders');
const createCustomersRouter = require('./routes/customers');
const createReminderRouter = require('./routes/reminders');
const createInboundRouter = require('./routes/inbound');
const createShippingRouter = require('./routes/shipping');
const createCustomerRouter = require('./routes/customer');
const createReviewsRouter = require('./routes/reviews');
const createAnalyticsRouter = require('./routes/analytics');
const createWebhookRouter = require('./routes/webhook');
const createWhatsAppSender = require('./utils/whatsapp-cloud-api');
const createPaymentProofRouter = require('./routes/payment-proofs');
const createApiProtection = require('./middleware/api-protection');
const createSensitiveRateLimiters = require('./middleware/sensitive-rate-limits');
const helmet = require('helmet');
require('dotenv').config();

// Custom fetch with retry/backoff for handling clock skew and transient errors
function createRetryFetch(maxAttempts = 3, backoffMs = 500) {
  return async function retryFetch(url, opts = {}) {
    let attempt = 0;
    while (true) {
      try {
        const response = await fetch(url, opts);
        if (response.ok) {
          return response;
        }
        let errorBody = null;
        try {
          errorBody = await response.clone().json();
        } catch (_) {}
        if (errorBody && errorBody.code === 'PGRST303') {
          if (attempt >= maxAttempts - 1) {
            throw new Error(`JWT issued at future after ${maxAttempts} attempts: ${errorBody.message}`);
          }
          await new Promise(res => setTimeout(res, 5000 * 2 ** attempt));
        } else {
          if (attempt >= maxAttempts - 1) {
            throw new Error(`Fetch failed after ${maxAttempts} attempts: ${response.status} ${response.statusText}`);
          }
          await new Promise(res => setTimeout(res, backoffMs * 2 ** attempt));
        }
      } catch (err) {
        if (attempt >= maxAttempts - 1) {
          throw err;
        }
        await new Promise(res => setTimeout(res, backoffMs * 2 ** attempt));
      }
      attempt++;
    }
  };
}

const app = express();

// 💡 內置 Cookie 解析器（零依賴，不需要 npm install，保證順利運行並解決失效問題）
app.use((req, res, next) => {
  req.cookies = {};
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    cookieHeader.split(';').forEach(cookie => {
      const parts = cookie.split('=');
      if (parts.length >= 2) {
        const name = parts[0].trim();
        const value = decodeURIComponent(parts.slice(1).join('=')).trim();
        req.cookies[name] = value;
      }
    });
  }
  next();
});

app.disable('x-powered-by');
app.set('env', process.env.NODE_ENV || 'development');

const trustProxyHops = process.env.TRUST_PROXY_HOPS === undefined
  ? 1
  : Number(process.env.TRUST_PROXY_HOPS);
if (!Number.isSafeInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 5) {
  throw new Error('TRUST_PROXY_HOPS 必須是 0 至 5 的整數。');
}
app.set('trust proxy', trustProxyHops);

const corsAllowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean)
  .map(origin => {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch (error) {
      throw new Error('CORS_ALLOWED_ORIGINS 必須只包含有效的 origin URL。');
    }
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.origin !== origin) {
      throw new Error('CORS_ALLOWED_ORIGINS 必須使用不含路徑的 HTTP(S) origin。');
    }
    return parsed.origin;
  });

const apiRateLimitWindowMs = process.env.API_RATE_LIMIT_WINDOW_MS === undefined
  ? 900000
  : Number(process.env.API_RATE_LIMIT_WINDOW_MS);
const apiRateLimitMax = process.env.API_RATE_LIMIT_MAX === undefined
  ? 120
  : Number(process.env.API_RATE_LIMIT_MAX);
if (
  !Number.isSafeInteger(apiRateLimitWindowMs) ||
  apiRateLimitWindowMs < 1000 ||
  !Number.isSafeInteger(apiRateLimitMax) ||
  apiRateLimitMax < 1
) {
  throw new Error('API_RATE_LIMIT_WINDOW_MS 或 API_RATE_LIMIT_MAX 設定無效。');
}

app.use(helmet({
  contentSecurityPolicy: false,
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  ...(app.get('env') === 'production' ? {} : { strictTransportSecurity: false })
}));
app.use('/api', createApiProtection({
  allowedOrigins: corsAllowedOrigins,
  windowMs: apiRateLimitWindowMs,
  maxRequests: apiRateLimitMax
}));

const sensitiveRateLimiters = createSensitiveRateLimiters();
app.post('/api/orders', sensitiveRateLimiters.checkout);
app.post('/api/products', sensitiveRateLimiters.adminWrite);
app.post('/api/products/images', sensitiveRateLimiters.adminWrite);
app.patch('/api/products/:productId', sensitiveRateLimiters.adminWrite);
app.patch('/api/products/:productId/stock', sensitiveRateLimiters.inventory);
app.get('/api/products/inventory-alerts', sensitiveRateLimiters.adminWrite);
app.get('/api/products/adjustments', sensitiveRateLimiters.adminWrite);
app.post('/api/products/:productId/adjustments', sensitiveRateLimiters.adminWrite);
app.post('/api/customer/orders/lookup', sensitiveRateLimiters.customerLookup);
app.post('/api/customer/orders/forgot', sensitiveRateLimiters.customerLookup);
app.post('/api/orders/:id/payment-proof', sensitiveRateLimiters.paymentProofUpload);
app.post('/api/admin-auth/login', sensitiveRateLimiters.adminLogin);
app.post('/api/customer/member/session', sensitiveRateLimiters.customerAuth);
app.get('/api/customer/orders', sensitiveRateLimiters.customerOrders);
app.get('/api/customer/wishlist', sensitiveRateLimiters.customerWishlistRead);
app.post('/api/customer/wishlist', sensitiveRateLimiters.customerWishlistWrite);
app.delete('/api/customer/wishlist/:productId', sensitiveRateLimiters.customerWishlistWrite);
app.post('/api/products/:productId/reviews', sensitiveRateLimiters.customerReview);
app.post('/api/reviews', sensitiveRateLimiters.customerReview);
app.delete('/api/admin/reviews/:reviewId', sensitiveRateLimiters.reviewAdmin);
app.get('/api/admin/reviews', sensitiveRateLimiters.reviewAdmin);
app.patch('/api/admin/reviews/:reviewId/status', sensitiveRateLimiters.reviewAdmin);
app.get('/api/admin/customers', sensitiveRateLimiters.reviewAdmin);
app.patch('/api/admin/customers/:id/credit-status', sensitiveRateLimiters.adminWrite);
app.patch('/api/orders/admin/orders/:orderId/status', sensitiveRateLimiters.adminWrite);
app.patch('/api/admin/orders/:orderId/payment-status', sensitiveRateLimiters.adminWrite);
app.post('/api/shipping/:orderId/ship', sensitiveRateLimiters.adminWrite);
app.post('/api/shipping/bulk-tracking', sensitiveRateLimiters.adminWrite);
app.post('/api/shipping/:orderId/notification/retry', sensitiveRateLimiters.adminWrite);
app.post('/api/inbound/receipt', sensitiveRateLimiters.adminWrite);
app.get('/api/inbound/batches', sensitiveRateLimiters.adminWrite);
app.patch('/api/inbound/batches/:batchId', sensitiveRateLimiters.adminWrite);
app.post('/api/inbound/reconcile', sensitiveRateLimiters.adminWrite);

// 關鍵：必須要有 express.json() 解析 JSON Body 傳過嚟嘅資料
app.use(express.json({
  limit: '50kb',
  verify(req, res, buffer) {
    if (req.originalUrl.startsWith('/api/webhook/whatsapp')) {
      req.rawBody = Buffer.from(buffer);
    }
  }
}));

// 讓 Express 自動託管 public 資料夾內的靜態檔案
app.use(express.static('public'));

// 初始化 Supabase 連線
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('啟動服務前必須設定 SUPABASE_URL 及 SUPABASE_ANON_KEY。');
}

const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  fetch: createRetryFetch()
});
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const adminSupabase = supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      fetch: createRetryFetch()
    })
  : supabase;

const shippingAdminToken = process.env.SHIPPING_ADMIN_TOKEN || '';
const productAdminToken = process.env.PRODUCT_ADMIN_TOKEN || shippingAdminToken;
const analyticsAdminToken = process.env.ANALYTICS_ADMIN_TOKEN || shippingAdminToken;
const inboundAdminToken = process.env.INBOUND_ADMIN_TOKEN || '';
const reviewsAdminToken = process.env.REVIEWS_ADMIN_TOKEN || '';
const paymentProofReceiptRecipients = (process.env.WHATSAPP_PAYMENT_RECEIPT_RECIPIENTS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);
if (paymentProofReceiptRecipients.some(phone => !/^[0-9]{8,15}$/.test(phone))) {
  throw new Error('WHATSAPP_PAYMENT_RECEIPT_RECIPIENTS 必須是逗號分隔的 8 至 15 位電話號碼。');
}
const whatsappSender = createWhatsAppSender({
  apiVersion: process.env.WHATSAPP_GRAPH_API_VERSION,
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
  accessToken: process.env.WHATSAPP_API_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN
});
const adminSessionSecret = process.env.ADMIN_SESSION_SECRET || (
  app.get('env') === 'production'
    ? ''
    : crypto.randomBytes(32)
);

const adminSessions = createAdminSessions({
  sessionSecret: adminSessionSecret,
  secureCookie: app.get('env') === 'production',
  credentials: [
    { token: shippingAdminToken, scopes: ['shipping', 'orders', 'customers'] },
    { token: productAdminToken, scopes: ['products'] },
    { token: analyticsAdminToken, scopes: ['analytics'] },
    { token: inboundAdminToken, scopes: ['inbound'] },
    { token: reviewsAdminToken, scopes: ['reviews'] }
  ]
});

app.use('/api/admin-auth', adminSessions.router);

app.use('/api/products', createProductsRouter(adminSupabase, {
  adminToken: productAdminToken,
  isSessionAuthorized: adminSessions.isAuthorized,
  stockWriteEnabled: supabaseServiceRoleKey.length > 0
}));

app.use('/api', createReviewsRouter(adminSupabase, {
  customerSessionSecret: process.env.CUSTOMER_SESSION_SECRET || 'temp-secret',
  isSessionAuthorized: adminSessions.isSessionAuthorized,
  readEnabled: Boolean(supabaseServiceRoleKey),
  writeEnabled: Boolean(supabaseServiceRoleKey)
}));
app.use('/api/orders', createOrdersRouter(adminSupabase, {
  serviceRoleAvailable: supabaseServiceRoleKey.length > 0,
  isSessionAuthorized: adminSessions.isSessionAuthorized
}));
app.use('/api/orders', createPaymentProofRouter(adminSupabase, {
  serviceRoleAvailable: supabaseServiceRoleKey.length > 0,
  isSessionAuthorized: adminSessions.isSessionAuthorized,
  enableAdmin: false
}));
app.use('/api/admin/orders', createPaymentProofRouter(adminSupabase, {
  serviceRoleAvailable: supabaseServiceRoleKey.length > 0,
  isSessionAuthorized: adminSessions.isSessionAuthorized,
  enableUpload: false
}));
app.use('/api/admin/customers', createCustomersRouter(adminSupabase, {
  serviceRoleAvailable: supabaseServiceRoleKey.length > 0,
  isSessionAuthorized: adminSessions.isSessionAuthorized
}));
app.use('/api/customer', createCustomerRouter(adminSupabase, {
  rateLimitSecret: process.env.CUSTOMER_LOOKUP_RATE_SECRET,
  sessionSecret: process.env.CUSTOMER_SESSION_SECRET || 'temp-secret',
  secureCookie: app.get('env') === 'production',
  readEnabled: supabaseServiceRoleKey.length > 0
}));
app.use('/api/admin/analytics', createAnalyticsRouter(adminSupabase, {
  adminToken: analyticsAdminToken,
  isSessionAuthorized: adminSessions.isSessionAuthorized,
  requireSession: true,
  readEnabled: Boolean(supabaseAnonKey),
  profitDetailsEnabled: process.env.ANALYTICS_PROFIT_DETAILS_ENABLED === 'true'
}));
app.use('/api/analytics', createAnalyticsRouter(adminSupabase, {
  adminToken: analyticsAdminToken,
  isSessionAuthorized: adminSessions.isAuthorized,
  readEnabled: Boolean(supabaseAnonKey),
  useTableFallback: !supabaseServiceRoleKey,
  profitDetailsEnabled: process.env.ANALYTICS_PROFIT_DETAILS_ENABLED === 'true'
}));
app.use('/api/inbound', createInboundRouter(adminSupabase, {
  adminToken: inboundAdminToken,
  isSessionAuthorized: adminSessions.isAuthorized,
  writeEnabled: supabaseServiceRoleKey.length > 0
}));

app.use('/api/webhook', createWebhookRouter(adminSupabase, {
  verifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
  appSecret: process.env.WHATSAPP_APP_SECRET,
  writeEnabled: supabaseServiceRoleKey.length > 0,
  sendWhatsApp: whatsappSender,
  receiptRecipients: paymentProofReceiptRecipients
}));

app.use('/api/shipping', createShippingRouter(adminSupabase, {
  adminToken: shippingAdminToken,
  isSessionAuthorized: adminSessions.isAuthorized,
  writeEnabled: supabaseServiceRoleKey.length > 0,
  readEnabled: Boolean(supabaseAnonKey),
  sendWhatsApp: null
}));

app.use('/api/reminders', createReminderRouter(supabase, {
  cronToken: process.env.REMINDER_CRON_TOKEN,
  recipients: [],
  sendWhatsApp: null
}));

app.get('/health', (req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

app.use('/api', apiNotFound);
app.use(errorHandler);

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`伺服器正在運行中，Port 網址為：http://localhost:${PORT}`);
  });
}

module.exports = app;