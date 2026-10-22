# Project Overview: .

## 目錄結構與檔案內容備份

### File: `.gitignore`

```
.env
.env.*
!.env.example
node_modules/

```

---

### File: `backup-data.js`

```
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('錯誤：請先在 .env 檔案中設定 SUPABASE_URL 及 SUPABASE_SERVICE_ROLE_KEY。');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function backupDatabase() {
    console.log('🔄 開始備份 LittlePlanet 資料庫...');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(__dirname, 'backups');

    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }

    const tables = ['products', 'orders', 'order_items', 'whatsapp_payment_reports'];
    const backupData = {};

    try {
        for (const table of tables) {
            const { data, error } = await supabase.from(table).select('*');
            if (error) {
                console.warn(`⚠️ 警告：讀取資料表 ${table} 失敗（可能尚未建立）: ${error.message}`);
                backupData[table] = [];
            } else {
                backupData[table] = data;
                console.log(`✅ 已備份資料表 [${table}] 共 ${data.length} 筆資料`);
            }
        }

        const backupFilePath = path.join(backupDir, `backup-${timestamp}.json`);
        fs.writeFileSync(backupFilePath, JSON.stringify(backupData, null, 2), 'utf8');
        console.log(`🎉 備份成功完成！檔案已儲存至：\n   ${backupFilePath}`);
    } catch (err) {
        console.error('❌ 備份過程發生錯誤:', err.message);
    }
}

backupDatabase();
```

---

### File: `bundle_to_md.py`

```
import os

# 設定要排除的資料夾
EXCLUDE_DIRS = {'node_modules', '.git', 'dist', 'build', '.next'}
# 設定要排除的副檔名或敏感檔案（保護 .env 不外洩）
EXCLUDE_EXTS = {'.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip'}
EXCLUDE_FILES = {'.env', '.env.example', 'package-lock.json'}


def generate_project_markdown(root_dir, output_file):
  with open(output_file, 'w', encoding='utf-8') as outfile:
    outfile.write(f'# Project Overview: {os.path.basename(root_dir)}\n\n')
    outfile.write('## 目錄結構與檔案內容備份\n\n')

    for dirpath, dirnames, filenames in os.walk(root_dir):
      # 排除特定資料夾
      dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]

      for file in filenames:
        if file in EXCLUDE_FILES:
          continue
        ext = os.path.splitext(file)[1].lower()
        if ext in EXCLUDE_EXTS:
          continue

        file_path = os.path.join(dirpath, file)
        rel_path = os.path.relpath(file_path, root_dir)

        # 寫入檔案標題與內容
        outfile.write(f'### File: `{rel_path}`\n\n')
        outfile.write('```\n')
        try:
          with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            outfile.write(f.read())
        except Exception as e:
          outfile.write(f'[無法讀取檔案內容: {e}]')
        outfile.write('\n```\n\n---\n\n')

  print(f'成功！整個專案已打包至: {output_file}')


if __name__ == '__main__':
  generate_project_markdown('.', 'project_summary.md')
```

---

### File: `DEPLOYMENT.md`

```
# LittlePlanet Production Deployment

## 1. Production checklist

- Use Node.js 22 or later. The installed Supabase client dependency requires a current Node runtime.
- Keep the repository and production service on the same Node version; the service start command is `npm start`.
- Configure all secrets in the cloud provider's environment-variable settings. Never commit `.env`, Supabase service-role keys, Meta tokens, or admin tokens.
- `SUPABASE_SERVICE_ROLE_KEY` is required in production. The server refuses to start without it because checkout, inventory, shipping, and customer lookup require privileged server-side database access.
- Set a unique random secret of at least 32 characters for `CUSTOMER_LOOKUP_RATE_SECRET`, `SHIPPING_ADMIN_TOKEN`, `INBOUND_ADMIN_TOKEN`, `ANALYTICS_ADMIN_TOKEN`, `PRODUCT_ADMIN_TOKEN`, and `REMINDER_CRON_TOKEN`. Do not reuse one secret for multiple features.
- Set `ADMIN_SESSION_SECRET` to a separate random secret of at least 32 bytes. Production startup requires it to sign admin sessions.
- Admin login accepts the configured shipping, product, analytics, and inbound admin tokens, then issues an 8-hour signed session cookie scoped to the matched operations. The cookie is `HttpOnly`, `SameSite=Strict`, and `Secure` in production; state-changing requests using it must carry a same-origin `Origin` header. The browser UI does not store or resend the raw admin token. Existing Bearer-token integrations remain supported.
- The admin session is stateless and signed. Logging out clears the browser cookie; to revoke an already copied cookie immediately, rotate `ADMIN_SESSION_SECRET`. Otherwise the session expires within eight hours.
- Configure Meta WhatsApp variables only when WhatsApp sending/webhook features are enabled.
- Helmet sets baseline security headers. Content Security Policy is not enabled because the current admin page uses inline scripts and styles.
- Express 4 async route rejections are forwarded to a centralized JSON error handler; malformed/oversized JSON and unknown `/api` routes also receive `{ success: false, data: null, message }` responses. Checkout quantities and stock updates require JSON integers, not coercible strings or booleans.
- The API has a global limiter plus stricter per-route limits: checkout and customer lookup allow 10 requests per IP per 15 minutes; inventory updates, shipping writes, and inbound writes allow 30 per IP per 15 minutes. These in-memory limits are per running instance. Keep the customer lookup's database rate limit enabled; use a shared limiter (for example, a managed Redis service) if the app is scaled across multiple instances.
- `/health` is a liveness endpoint; it confirms that the process responds, not that Supabase or WhatsApp is reachable.

## 2. Configure environment variables

Use [.env.example](./.env.example) as the variable checklist. On Render or Railway, enter values in the service's environment-variable dashboard rather than uploading `.env`.

Required core settings:

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | Set to `production`; enables production startup checks and keeps stack traces out of HTTP error responses. |
| `PORT` | HTTP listener port. The platform normally injects this automatically. |
| `SUPABASE_URL` | Project URL, HTTPS in production. |
| `SUPABASE_ANON_KEY` | Server's public/anon key, used for public reads. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only elevated key. Never expose it to browser code. |
| `CUSTOMER_LOOKUP_RATE_SECRET` | Unique HMAC key of at least 32 characters. |
| `SHIPPING_ADMIN_TOKEN` | Authorizes shipping administration endpoints. |
| `INBOUND_ADMIN_TOKEN` | Authorizes inbound/reconciliation endpoints. |
| `ANALYTICS_ADMIN_TOKEN` | Authorizes analytics endpoints. |
| `PRODUCT_ADMIN_TOKEN` | Authorizes stock adjustments; currently falls back to `SHIPPING_ADMIN_TOKEN` if omitted. |
| `REMINDER_CRON_TOKEN` | Authorizes scheduled reminder jobs. |
| `ADMIN_SESSION_SECRET` | Separate random signing key (at least 32 bytes) for admin session cookies; required in production. |

Security and network settings:

- `CORS_ALLOWED_ORIGINS`: exact comma-separated origins such as `https://shop.example.com`, without a path. Leave empty for same-origin traffic only. Do not use `*` for an authenticated/admin API.
- `API_RATE_LIMIT_WINDOW_MS`: global API rate-limit window in milliseconds (default `900000`, 15 minutes).
- `API_RATE_LIMIT_MAX`: requests per client IP per window (default `120`).
- `TRUST_PROXY_HOPS`: trusted reverse proxy hop count (default `1` for a single platform proxy; set to `0` if clients connect directly). Configure this to match the hosting topology, otherwise forwarded IP headers could be misinterpreted.

WhatsApp Cloud API settings, required only when enabling those features:

- `WHATSAPP_GRAPH_API_VERSION`, for example the current `vXX.0` supported by the Meta app.
- `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_API_TOKEN`.
- `WHATSAPP_REMINDER_RECIPIENTS`, comma-separated phone numbers without `+`.
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN` and `WHATSAPP_APP_SECRET`.

The server also accepts `WHATSAPP_ACCESS_TOKEN` as a legacy alias; new deployments should use `WHATSAPP_API_TOKEN`.

## Analytics cache and database indexes

Analytics overview, sales trend, top products, and reconciliation responses are cached in process memory for 60 seconds. Cache keys include all validated date, filter, and pagination parameters; failed database responses are never cached. A successful write can therefore take up to 60 seconds to appear in reports. The cache is per application instance and is cleared on restart; use shared Redis caching if the service is scaled and cross-instance consistency is required.

Run [`supabase/diagnostics/performance_review.sql`](./supabase/diagnostics/performance_review.sql) in Supabase SQL Editor to inspect current index definitions, sizes, scan counts, and table sequential scans. Review the results with realistic traffic before adding indexes; indexes consume storage and slow writes.

The repository already defines `orders_customer_lookup_idx` on `(customer_phone, order_date DESC, order_id DESC)`, `order_items_pending_product_idx` on `(product_id, order_id, item_id)` for pending inbound items, and partial indexes for reminders and pending shipping notifications. Customer lookup normalizes an optional leading `+` on `orders.customer_phone`, so the existing raw-phone index may not accelerate that expression; consider the expression index below if lookup scans are costly. `orders.customer_id` is currently an integer foreign key when that legacy customer table exists; customer order lookup uses the phone number or the UUID `orders.order_id`, not a customer UUID. No SKU index is recommended: product code/SKU is not currently used as a database filter.

If the diagnostics and `EXPLAIN (ANALYZE, BUFFERS)` on production-sized data confirm the following scans are costly and these leading-column indexes do not already exist, consider applying these optional indexes during a low-traffic window:

```sql
CREATE INDEX IF NOT EXISTS orders_analytics_date_idx
  ON public.orders (order_date DESC, order_id DESC);

CREATE INDEX IF NOT EXISTS order_items_order_lookup_idx
  ON public.order_items (order_id, item_id);

CREATE INDEX IF NOT EXISTS orders_ready_to_ship_idx
  ON public.orders (order_date ASC)
  WHERE shipping_status = '可出貨';

CREATE INDEX IF NOT EXISTS order_items_ready_to_ship_idx
  ON public.order_items (order_id, item_id)
  WHERE item_status = '已到貨倉';

CREATE INDEX IF NOT EXISTS orders_customer_phone_normalized_idx
  ON public.orders (
    (regexp_replace(customer_phone, '^\+', '')),
    order_date DESC,
    order_id DESC
  );
```

`orders.order_id` / `products.id` are primary-key lookup columns. Product list filters use `category` and `status`; only consider separate indexes on those columns if the product table is large and query plans show sequential scans are costly. Do not index `customer_id` or product code speculatively; verify actual joins/search predicates and existing primary/foreign-key indexes first.

Generate secrets locally, then paste them into the provider dashboard. For example, in PowerShell:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Generate a different value for each secret. Do not paste production secret values into chat, logs, source control, or deployment documentation.

## 3. Apply Supabase migrations

Back up the production database and review the SQL changes before applying migrations. In the Supabase Dashboard, open the intended project, check its migration history, and use **SQL Editor** to run each migration file's complete contents, one file at a time, in this order:

1. `20260926223000_add_products_status.sql`
2. `20260926225000_align_orders_schema_with_prd.sql`
3. `20260926230000_add_product_reminder_fields.sql`
4. `20260926230200_add_analytics_reporting.sql`
5. `20260926233000_add_inbound_reconciliation.sql`
6. `20260926234000_add_shipping_management.sql`
7. `20260926235000_add_customer_order_lookup.sql`
8. `20260927000100_add_whatsapp_webhook.sql`
9. `20260927000200_add_product_stock_update.sql`
10. `20260927000300_support_uuid_order_shipping.sql`
11. `20260927000500_atomic_customer_checkout.sql`
12. `20260927000600_uuid_customer_lookup.sql`
13. `20260927000700_uuid_inbound_reconciliation.sql`

The WhatsApp webhook/payment-report schema also uses UUID order IDs, matching production orders and the storefront's order references.

Apply only migrations not already recorded as applied. The repository currently contains the migration SQL files but not a Supabase CLI `config.toml`; do not run `supabase db push` until the CLI project configuration and remote migration history have been deliberately initialized and reviewed. If you use the CLI, link the intended project, verify `supabase migration list --linked`, then push outstanding migrations and verify the list again.

If migrations have previously been applied manually or the remote history does not match the repository, stop and reconcile the migration history with a database administrator before running `db push`; do not blindly repair or reset production history. The last three migrations provide atomic checkout/stock deduction, UUID order lookup plus safe WhatsApp notification status, and UUID-based inbound reconciliation.

## 4. Deploy to Render

1. Push this project to a private GitHub repository and create a Render **Web Service** from that repository.
2. Choose the Node runtime, set the build command to `npm ci`, and set the start command to `npm start`.
3. Add the environment variables from section 2 in Render's service settings. Do not add secrets to a checked-in file.
4. Set the health check path to `/health`.
5. Deploy and wait for the service to become healthy.

## 5. Deploy to Railway

1. Create a Railway project from the GitHub repository.
2. In the service settings, use `npm ci` as the build command and `npm start` as the start command (or allow Railway's Node.js detection to select the start script).
3. Add the environment variables from section 2 in the service's Variables panel.
4. Set the health check path to `/health` and deploy.
5. Confirm the service has a public domain and that its configured CORS origins match the public frontend origin when frontend and API use different domains.

Both platforms may change their free-tier limits and availability. Check the provider's current plan before relying on a free instance for production traffic.

## 6. Post-deployment smoke tests

Replace `YOUR_DEPLOYED_URL` with the HTTPS service URL:

```powershell
Invoke-RestMethod -Uri "https://YOUR_DEPLOYED_URL/health"
Invoke-RestMethod -Uri "https://YOUR_DEPLOYED_URL/api/products"
```

Expected health response:

```json
{
  "status": "ok",
  "timestamp": "2026-09-27T00:00:00.000Z"
}
```

Then verify the storefront, create a low-value test order and confirm its stock deduction, look it up at `/track.html`, and test a shipment/notification only after checking that the Supabase migrations and WhatsApp credentials are configured. Remove test orders/data using the project's approved admin process; do not perform ad-hoc destructive SQL in production.

## 7. Local validation

From the project root:

```powershell
npm ci
node --check index.js
node --test tests\*.test.js
npm start
```

The health endpoint can then be checked at `http://localhost:3000/health` (or the configured `PORT`).

```

---

### File: `index.js`

```
const express = require('express');
const crypto = require('node:crypto');
require('express-async-errors');
const { apiNotFound, errorHandler } = require('./middleware/error-handler');
const createAdminSessions = require('./middleware/admin-sessions');
const { createClient } = require('@supabase/supabase-js');
const createProductsRouter = require('./routes/products');
const createOrdersRouter = require('./routes/orders');
const createReminderRouter = require('./routes/reminders');
const createInboundRouter = require('./routes/inbound');
const createShippingRouter = require('./routes/shipping');
const createCustomerRouter = require('./routes/customer');
const createAnalyticsRouter = require('./routes/analytics');
const createWebhookRouter = require('./routes/webhook');
const createApiProtection = require('./middleware/api-protection');
const createSensitiveRateLimiters = require('./middleware/sensitive-rate-limits');
const helmet = require('helmet');
require('dotenv').config(); // 確保能讀取 .env 裡的環境變數

const app = express();
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
app.patch('/api/products/:productId/stock', sensitiveRateLimiters.inventory);
app.post('/api/customer/orders/lookup', sensitiveRateLimiters.customerLookup);
app.post('/api/admin-auth/login', sensitiveRateLimiters.adminLogin);
app.post('/api/shipping/:orderId/ship', sensitiveRateLimiters.adminWrite);
app.post('/api/shipping/:orderId/notification/retry', sensitiveRateLimiters.adminWrite);
app.post('/api/inbound/receipt', sensitiveRateLimiters.adminWrite);
app.post('/api/inbound/reconcile', sensitiveRateLimiters.adminWrite);
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
let parsedSupabaseUrl;
try {
  parsedSupabaseUrl = new URL(supabaseUrl);
} catch (error) {
  throw new Error('SUPABASE_URL 必須是有效的 HTTPS URL。');
}
if (
  parsedSupabaseUrl.protocol !== 'https:' &&
  !(app.get('env') !== 'production' && parsedSupabaseUrl.hostname === 'localhost')
) {
  throw new Error('SUPABASE_URL 生產環境必須使用 HTTPS。');
}
const supabase = createClient(supabaseUrl, supabaseAnonKey);
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (app.get('env') === 'production' && !supabaseServiceRoleKey) {
  throw new Error('生產環境必須設定 SUPABASE_SERVICE_ROLE_KEY 才可安全啟用結帳及管理寫入功能。');
}
if (
  app.get('env') === 'production' &&
  (!process.env.CUSTOMER_LOOKUP_RATE_SECRET ||
    process.env.CUSTOMER_LOOKUP_RATE_SECRET.length < 32 ||
    process.env.CUSTOMER_LOOKUP_RATE_SECRET.startsWith('replace-with-'))
) {
  throw new Error('生產環境必須設定至少 32 字元的 CUSTOMER_LOOKUP_RATE_SECRET。');
}
const adminSupabase = supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey)
  : supabase;

const shippingAdminToken = process.env.SHIPPING_ADMIN_TOKEN || '';
const productAdminToken = process.env.PRODUCT_ADMIN_TOKEN || shippingAdminToken;
const analyticsAdminToken = process.env.ANALYTICS_ADMIN_TOKEN || shippingAdminToken;
const inboundAdminToken = process.env.INBOUND_ADMIN_TOKEN || '';
const adminSessionSecret = process.env.ADMIN_SESSION_SECRET || (
  app.get('env') === 'production'
    ? ''
    : crypto.randomBytes(32)
);
if (
  app.get('env') === 'production' &&
  (
    typeof adminSessionSecret !== 'string' ||
    Buffer.byteLength(adminSessionSecret) < 32 ||
    adminSessionSecret.startsWith('replace-with-') ||
    [
      shippingAdminToken,
      productAdminToken,
      analyticsAdminToken,
      inboundAdminToken
    ].includes(adminSessionSecret)
  )
) {
  throw new Error('生產環境必須設定獨立且至少 32 bytes 的 ADMIN_SESSION_SECRET。');
}
const adminSessions = createAdminSessions({
  sessionSecret: adminSessionSecret,
  secureCookie: app.get('env') === 'production',
  credentials: [
    { token: shippingAdminToken, scopes: ['shipping'] },
    { token: productAdminToken, scopes: ['products'] },
    { token: analyticsAdminToken, scopes: ['analytics'] },
    { token: inboundAdminToken, scopes: ['inbound'] }
  ]
});
app.use('/api/admin-auth', adminSessions.router);

app.use('/api/products', createProductsRouter(adminSupabase, {
  adminToken: productAdminToken,
  isSessionAuthorized: adminSessions.isAuthorized,
  stockWriteEnabled: supabaseServiceRoleKey.length > 0
}));
app.use('/api/orders', createOrdersRouter(adminSupabase, {
  serviceRoleAvailable: supabaseServiceRoleKey.length > 0
}));
app.use('/api/customer', createCustomerRouter(adminSupabase, {
  rateLimitSecret: process.env.CUSTOMER_LOOKUP_RATE_SECRET,
  readEnabled: supabaseServiceRoleKey.length > 0
}));
app.use('/api/analytics', createAnalyticsRouter(adminSupabase, {
  adminToken: analyticsAdminToken,
  isSessionAuthorized: adminSessions.isAuthorized,
  readEnabled: Boolean(supabaseAnonKey),
  useTableFallback: !supabaseServiceRoleKey
}));
app.use('/api/inbound', createInboundRouter(adminSupabase, {
  adminToken: inboundAdminToken,
  isSessionAuthorized: adminSessions.isAuthorized,
  writeEnabled: supabaseServiceRoleKey.length > 0
}));
const reminderRecipients = (process.env.WHATSAPP_REMINDER_RECIPIENTS || '')
  .split(',')
  .map(recipient => recipient.trim().replace(/^\+/, ''))
  .filter(Boolean);
const whatsappApiVersion = process.env.WHATSAPP_GRAPH_API_VERSION || '';
const whatsappPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const whatsappAccessToken = process.env.WHATSAPP_API_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN || '';
const validWhatsAppRecipients = reminderRecipients.every(recipient => /^\d{8,15}$/.test(recipient));
const hasWhatsAppCredentials = (
  /^v\d+\.\d+$/.test(whatsappApiVersion) &&
  /^\d+$/.test(whatsappPhoneNumberId) &&
  whatsappAccessToken.length > 0
);
const hasWhatsAppConfiguration = (
  hasWhatsAppCredentials &&
  validWhatsAppRecipients
);

async function sendWhatsAppMessage({ to, text }) {
  if (!hasWhatsAppCredentials || !/^\d{8,15}$/.test(to)) {
    throw new Error('WhatsApp Cloud API 設定無效，或收件電話格式錯誤。');
  }

  const response = await fetch(
    `https://graph.facebook.com/${whatsappApiVersion}/${whatsappPhoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${whatsappAccessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: {
          preview_url: false,
          body: text
        }
      })
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`WhatsApp Cloud API 回應 HTTP ${response.status}: ${errorBody.slice(0, 500)}`);
  }

  return response.json();
}

async function sendWhatsAppReminder({ to, text }) {
  if (!hasWhatsAppConfiguration) {
    throw new Error('WhatsApp Cloud API 設定無效或不完整。');
  }
  return sendWhatsAppMessage({ to, text });
}

app.use('/api/webhook', createWebhookRouter(adminSupabase, {
  verifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
  appSecret: process.env.WHATSAPP_APP_SECRET,
  writeEnabled: supabaseServiceRoleKey.length > 0,
  sendWhatsApp: hasWhatsAppCredentials ? sendWhatsAppMessage : null
}));

app.use('/api/shipping', createShippingRouter(adminSupabase, {
  adminToken: shippingAdminToken,
  isSessionAuthorized: adminSessions.isAuthorized,
  writeEnabled: supabaseServiceRoleKey.length > 0,
  readEnabled: Boolean(supabaseAnonKey),
  sendWhatsApp: hasWhatsAppCredentials ? sendWhatsAppMessage : null
}));

app.use('/api/reminders', createReminderRouter(supabase, {
  cronToken: process.env.REMINDER_CRON_TOKEN,
  recipients: hasWhatsAppConfiguration ? reminderRecipients : [],
  sendWhatsApp: hasWhatsAppConfiguration ? sendWhatsAppReminder : null
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

```

---

### File: `package.json`

```
{
  "name": "littleplanet",
  "version": "1.0.0",
  "description": "LittlePlanet local backend project with Express and Supabase",
  "main": "index.js",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "start": "node index.js",
    "dev": "nodemon --exec \"node --dns-result-order=ipv4first\" index.js",
    "test": "node --test"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.43.0",
    "chart.js": "^4.5.1",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "express-async-errors": "^3.1.1",
    "express-rate-limit": "^8.7.0",
    "helmet": "^8.3.0",
    "node-cache": "^5.1.2"
  },
  "devDependencies": {
    "nodemon": "^3.1.0"
  }
}

```

---

### File: `project_summary.md`

```
# Project Overview: .

## 目錄結構與檔案內容備份

### File: `.gitignore`

```
.env
.env.*
!.env.example
node_modules/

```

---

### File: `backup-data.js`

```
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('錯誤：請先在 .env 檔案中設定 SUPABASE_URL 及 SUPABASE_SERVICE_ROLE_KEY。');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function backupDatabase() {
    console.log('🔄 開始備份 LittlePlanet 資料庫...');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(__dirname, 'backups');

    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }

    const tables = ['products', 'orders', 'order_items', 'whatsapp_payment_reports'];
    const backupData = {};

    try {
        for (const table of tables) {
            const { data, error } = await supabase.from(table).select('*');
            if (error) {
                console.warn(`⚠️ 警告：讀取資料表 ${table} 失敗（可能尚未建立）: ${error.message}`);
                backupData[table] = [];
            } else {
                backupData[table] = data;
                console.log(`✅ 已備份資料表 [${table}] 共 ${data.length} 筆資料`);
            }
        }

        const backupFilePath = path.join(backupDir, `backup-${timestamp}.json`);
        fs.writeFileSync(backupFilePath, JSON.stringify(backupData, null, 2), 'utf8');
        console.log(`🎉 備份成功完成！檔案已儲存至：\n   ${backupFilePath}`);
    } catch (err) {
        console.error('❌ 備份過程發生錯誤:', err.message);
    }
}

backupDatabase();
```

---

### File: `bundle_to_md.py`

```
import os

# 設定要排除的資料夾
EXCLUDE_DIRS = {'node_modules', '.git', 'dist', 'build', '.next'}
# 設定要排除的副檔名或敏感檔案（保護 .env 不外洩）
EXCLUDE_EXTS = {'.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip'}
EXCLUDE_FILES = {'.env', '.env.example', 'package-lock.json'}


def generate_project_markdown(root_dir, output_file):
  with open(output_file, 'w', encoding='utf-8') as outfile:
    outfile.write(f'# Project Overview: {os.path.basename(root_dir)}\n\n')
    outfile.write('## 目錄結構與檔案內容備份\n\n')

    for dirpath, dirnames, filenames in os.walk(root_dir):
      # 排除特定資料夾
      dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]

      for file in filenames:
        if file in EXCLUDE_FILES:
          continue
        ext = os.path.splitext(file)[1].lower()
        if ext in EXCLUDE_EXTS:
          continue

        file_path = os.path.join(dirpath, file)
        rel_path = os.path.relpath(file_path, root_dir)

        # 寫入檔案標題與內容
        outfile.write(f'### File: `{rel_path}`\n\n')
        outfile.write('```\n')
        try:
          with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            outfile.write(f.read())
        except Exception as e:
          outfile.write(f'[無法讀取檔案內容: {e}]')
        outfile.write('\n```\n\n---\n\n')

  print(f'成功！整個專案已打包至: {output_file}')


if __name__ == '__main__':
  generate_project_markdown('.', 'project_summary.md')
```

---

### File: `DEPLOYMENT.md`

```
# LittlePlanet Production Deployment

## 1. Production checklist

- Use Node.js 22 or later. The installed Supabase client dependency requires a current Node runtime.
- Keep the repository and production service on the same Node version; the service start command is `npm start`.
- Configure all secrets in the cloud provider's environment-variable settings. Never commit `.env`, Supabase service-role keys, Meta tokens, or admin tokens.
- `SUPABASE_SERVICE_ROLE_KEY` is required in production. The server refuses to start without it because checkout, inventory, shipping, and customer lookup require privileged server-side database access.
- Set a unique random secret of at least 32 characters for `CUSTOMER_LOOKUP_RATE_SECRET`, `SHIPPING_ADMIN_TOKEN`, `INBOUND_ADMIN_TOKEN`, `ANALYTICS_ADMIN_TOKEN`, `PRODUCT_ADMIN_TOKEN`, and `REMINDER_CRON_TOKEN`. Do not reuse one secret for multiple features.
- Set `ADMIN_SESSION_SECRET` to a separate random secret of at least 32 bytes. Production startup requires it to sign admin sessions.
- Admin login accepts the configured shipping, product, analytics, and inbound admin tokens, then issues an 8-hour signed session cookie scoped to the matched operations. The cookie is `HttpOnly`, `SameSite=Strict`, and `Secure` in production; state-changing requests using it must carry a same-origin `Origin` header. The browser UI does not store or resend the raw admin token. Existing Bearer-token integrations remain supported.
- The admin session is stateless and signed. Logging out clears the browser cookie; to revoke an already copied cookie immediately, rotate `ADMIN_SESSION_SECRET`. Otherwise the session expires within eight hours.
- Configure Meta WhatsApp variables only when WhatsApp sending/webhook features are enabled.
- Helmet sets baseline security headers. Content Security Policy is not enabled because the current admin page uses inline scripts and styles.
- Express 4 async route rejections are forwarded to a centralized JSON error handler; malformed/oversized JSON and unknown `/api` routes also receive `{ success: false, data: null, message }` responses. Checkout quantities and stock updates require JSON integers, not coercible strings or booleans.
- The API has a global limiter plus stricter per-route limits: checkout and customer lookup allow 10 requests per IP per 15 minutes; inventory updates, shipping writes, and inbound writes allow 30 per IP per 15 minutes. These in-memory limits are per running instance. Keep the customer lookup's database rate limit enabled; use a shared limiter (for example, a managed Redis service) if the app is scaled across multiple instances.
- `/health` is a liveness endpoint; it confirms that the process responds, not that Supabase or WhatsApp is reachable.

## 2. Configure environment variables

Use [.env.example](./.env.example) as the variable checklist. On Render or Railway, enter values in the service's environment-variable dashboard rather than uploading `.env`.

Required core settings:

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | Set to `production`; enables production startup checks and keeps stack traces out of HTTP error responses. |
| `PORT` | HTTP listener port. The platform normally injects this automatically. |
| `SUPABASE_URL` | Project URL, HTTPS in production. |
| `SUPABASE_ANON_KEY` | Server's public/anon key, used for public reads. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only elevated key. Never expose it to browser code. |
| `CUSTOMER_LOOKUP_RATE_SECRET` | Unique HMAC key of at least 32 characters. |
| `SHIPPING_ADMIN_TOKEN` | Authorizes shipping administration endpoints. |
| `INBOUND_ADMIN_TOKEN` | Authorizes inbound/reconciliation endpoints. |
| `ANALYTICS_ADMIN_TOKEN` | Authorizes analytics endpoints. |
| `PRODUCT_ADMIN_TOKEN` | Authorizes stock adjustments; currently falls back to `SHIPPING_ADMIN_TOKEN` if omitted. |
| `REMINDER_CRON_TOKEN` | Authorizes scheduled reminder jobs. |
| `ADMIN_SESSION_SECRET` | Separate random signing key (at least 32 bytes) for admin session cookies; required in production. |

Security and network settings:

- `CORS_ALLOWED_ORIGINS`: exact comma-separated origins such as `https://shop.example.com`, without a path. Leave empty for same-origin traffic only. Do not use `*` for an authenticated/admin API.
- `API_RATE_LIMIT_WINDOW_MS`: global API rate-limit window in milliseconds (default `900000`, 15 minutes).
- `API_RATE_LIMIT_MAX`: requests per client IP per window (default `120`).
- `TRUST_PROXY_HOPS`: trusted reverse proxy hop count (default `1` for a single platform proxy; set to `0` if clients connect directly). Configure this to match the hosting topology, otherwise forwarded IP headers could be misinterpreted.

WhatsApp Cloud API settings, required only when enabling those features:

- `WHATSAPP_GRAPH_API_VERSION`, for example the current `vXX.0` supported by the Meta app.
- `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_API_TOKEN`.
- `WHATSAPP_REMINDER_RECIPIENTS`, comma-separated phone numbers without `+`.
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN` and `WHATSAPP_APP_SECRET`.

The server also accepts `WHATSAPP_ACCESS_TOKEN` as a legacy alias; new deployments should use `WHATSAPP_API_TOKEN`.

## Analytics cache and database indexes

Analytics overview, sales trend, top products, and reconciliation responses are cached in process memory for 60 seconds. Cache keys include all validated date, filter, and pagination parameters; failed database responses are never cached. A successful write can therefore take up to 60 seconds to appear in reports. The cache is per application instance and is cleared on restart; use shared Redis caching if the service is scaled and cross-instance consistency is required.

Run [`supabase/diagnostics/performance_review.sql`](./supabase/diagnostics/performance_review.sql) in Supabase SQL Editor to inspect current index definitions, sizes, scan counts, and table sequential scans. Review the results with realistic traffic before adding indexes; indexes consume storage and slow writes.

The repository already defines `orders_customer_lookup_idx` on `(customer_phone, order_date DESC, order_id DESC)`, `order_items_pending_product_idx` on `(product_id, order_id, item_id)` for pending inbound items, and partial indexes for reminders and pending shipping notifications. Customer lookup normalizes an optional leading `+` on `orders.customer_phone`, so the existing raw-phone index may not accelerate that expression; consider the expression index below if lookup scans are costly. `orders.customer_id` is currently an integer foreign key when that legacy customer table exists; customer order lookup uses the phone number or the UUID `orders.order_id`, not a customer UUID. No SKU index is recommended: product code/SKU is not currently used as a database filter.

If the diagnostics and `EXPLAIN (ANALYZE, BUFFERS)` on production-sized data confirm the following scans are costly and these leading-column indexes do not already exist, consider applying these optional indexes during a low-traffic window:

```sql
CREATE INDEX IF NOT EXISTS orders_analytics_date_idx
  ON public.orders (order_date DESC, order_id DESC);

CREATE INDEX IF NOT EXISTS order_items_order_lookup_idx
  ON public.order_items (order_id, item_id);

CREATE INDEX IF NOT EXISTS orders_ready_to_ship_idx
  ON public.orders (order_date ASC)
  WHERE shipping_status = '可出貨';

CREATE INDEX IF NOT EXISTS order_items_ready_to_ship_idx
  ON public.order_items (order_id, item_id)
  WHERE item_status = '已到貨倉';

CREATE INDEX IF NOT EXISTS orders_customer_phone_normalized_idx
  ON public.orders (
    (regexp_replace(customer_phone, '^\+', '')),
    order_date DESC,
    order_id DESC
  );
```

`orders.order_id` / `products.id` are primary-key lookup columns. Product list filters use `category` and `status`; only consider separate indexes on those columns if the product table is large and query plans show sequential scans are costly. Do not index `customer_id` or product code speculatively; verify actual joins/search predicates and existing primary/foreign-key indexes first.

Generate secrets locally, then paste them into the provider dashboard. For example, in PowerShell:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Generate a different value for each secret. Do not paste production secret values into chat, logs, source control, or deployment documentation.

## 3. Apply Supabase migrations

Back up the production database and review the SQL changes before applying migrations. In the Supabase Dashboard, open the intended project, check its migration history, and use **SQL Editor** to run each migration file's complete contents, one file at a time, in this order:

1. `20260926223000_add_products_status.sql`
2. `20260926225000_align_orders_schema_with_prd.sql`
3. `20260926230000_add_product_reminder_fields.sql`
4. `20260926230200_add_analytics_reporting.sql`
5. `20260926233000_add_inbound_reconciliation.sql`
6. `20260926234000_add_shipping_management.sql`
7. `20260926235000_add_customer_order_lookup.sql`
8. `20260927000100_add_whatsapp_webhook.sql`
9. `20260927000200_add_product_stock_update.sql`
10. `20260927000300_support_uuid_order_shipping.sql`
11. `20260927000500_atomic_customer_checkout.sql`
12. `20260927000600_uuid_customer_lookup.sql`
13. `20260927000700_uuid_inbound_reconciliation.sql`

The WhatsApp webhook/payment-report schema also uses UUID order IDs, matching production orders and the storefront's order references.

Apply only migrations not already recorded as applied. The repository currently contains the migration SQL files but not a Supabase CLI `config.toml`; do not run `supabase db push` until the CLI project configuration and remote migration history have been deliberately initialized and reviewed. If you use the CLI, link the intended project, verify `supabase migration list --linked`, then push outstanding migrations and verify the list again.

If migrations have previously been applied manually or the remote history does not match the repository, stop and reconcile the migration history with a database administrator before running `db push`; do not blindly repair or reset production history. The last three migrations provide atomic checkout/stock deduction, UUID order lookup plus safe WhatsApp notification status, and UUID-based inbound reconciliation.

## 4. Deploy to Render

1. Push this project to a private GitHub repository and create a Render **Web Service** from that repository.
2. Choose the Node runtime, set the build command to `npm ci`, and set the start command to `npm start`.
3. Add the environment variables from section 2 in Render's service settings. Do not add secrets to a checked-in file.
4. Set the health check path to `/health`.
5. Deploy and wait for the service to become healthy.

## 5. Deploy to Railway

1. Create a Railway project from the GitHub repository.
2. In the service settings, use `npm ci` as the build command and `npm start` as the start command (or allow Railway's Node.js detection to select the start script).
3. Add the environment variables from section 2 in the service's Variables panel.
4. Set the health check path to `/health` and deploy.
5. Confirm the service has a public domain and that its configured CORS origins match the public frontend origin when frontend and API use different domains.

Both platforms may change their free-tier limits and availability. Check the provider's current plan before relying on a free instance for production traffic.

## 6. Post-deployment smoke tests

Replace `YOUR_DEPLOYED_URL` with the HTTPS service URL:

```powershell
Invoke-RestMethod -Uri "https://YOUR_DEPLOYED_URL/health"
Invoke-RestMethod -Uri "https://YOUR_DEPLOYED_URL/api/products"
```

Expected health response:

```json
{
  "status": "ok",
  "timestamp": "2026-09-27T00:00:00.000Z"
}
```

Then verify the storefront, create a low-value test order and confirm its stock deduction, look it up at `/track.html`, and test a shipment/notification only after checking that the Supabase migrations and WhatsApp credentials are configured. Remove test orders/data using the project's approved admin process; do not perform ad-hoc destructive SQL in production.

## 7. Local validation

From the project root:

```powershell
npm ci
node --check index.js
node --test tests\*.test.js
npm start
```

The health endpoint can then be checked at `http://localhost:3000/health` (or the configured `PORT`).

```

---

### File: `index.js`

```
const express = require('express');
const crypto = require('node:crypto');
require('express-async-errors');
const { apiNotFound, errorHandler } = require('./middleware/error-handler');
const createAdminSessions = require('./middleware/admin-sessions');
const { createClient } = require('@supabase/supabase-js');
const createProductsRouter = require('./routes/products');
const createOrdersRouter = require('./routes/orders');
const createReminderRouter = require('./routes/reminders');
const createInboundRouter = require('./routes/inbound');
const createShippingRouter = require('./routes/shipping');
const createCustomerRouter = require('./routes/customer');
const createAnalyticsRouter = require('./routes/analytics');
const createWebhookRouter = require('./routes/webhook');
const createApiProtection = require('./middleware/api-protection');
const createSensitiveRateLimiters = require('./middleware/sensitive-rate-limits');
const helmet = require('helmet');
require('dotenv').config(); // 確保能讀取 .env 裡的環境變數

const app = express();
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
app.patch('/api/products/:productId/stock', sensitiveRateLimiters.inventory);
app.post('/api/customer/orders/lookup', sensitiveRateLimiters.customerLookup);
app.post('/api/admin-auth/login', sensitiveRateLimiters.adminLogin);
app.post('/api/shipping/:orderId/ship', sensitiveRateLimiters.adminWrite);
app.post('/api/shipping/:orderId/notification/retry', sensitiveRateLimiters.adminWrite);
app.post('/api/inbound/receipt', sensitiveRateLimiters.adminWrite);
app.post('/api/inbound/reconcile', sensitiveRateLimiters.adminWrite);
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
let parsedSupabaseUrl;
try {
  parsedSupabaseUrl = new URL(supabaseUrl);
} catch (error) {
  throw new Error('SUPABASE_URL 必須是有效的 HTTPS URL。');
}
if (
  parsedSupabaseUrl.protocol !== 'https:' &&
  !(app.get('env') !== 'production' && parsedSupabaseUrl.hostname === 'localhost')
) {
  throw new Error('SUPABASE_URL 生產環境必須使用 HTTPS。');
}
const supabase = createClient(supabaseUrl, supabaseAnonKey);
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (app.get('env') === 'production' && !supabaseServiceRoleKey) {
  throw new Error('生產環境必須設定 SUPABASE_SERVICE_ROLE_KEY 才可安全啟用結帳及管理寫入功能。');
}
if (
  app.get('env') === 'production' &&
  (!process.env.CUSTOMER_LOOKUP_RATE_SECRET ||
    process.env.CUSTOMER_LOOKUP_RATE_SECRET.length < 32 ||
    process.env.CUSTOMER_LOOKUP_RATE_SECRET.startsWith('replace-with-'))
) {
  throw new Error('生產環境必須設定至少 32 字元的 CUSTOMER_LOOKUP_RATE_SECRET。');
}
const adminSupabase = supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey)
  : supabase;

const shippingAdminToken = process.env.SHIPPING_ADMIN_TOKEN || '';
const productAdminToken = process.env.PRODUCT_ADMIN_TOKEN || shippingAdminToken;
const analyticsAdminToken = process.env.ANALYTICS_ADMIN_TOKEN || shippingAdminToken;
const inboundAdminToken = process.env.INBOUND_ADMIN_TOKEN || '';
const adminSessionSecret = process.env.ADMIN_SESSION_SECRET || (
  app.get('env') === 'production'
    ? ''
    : crypto.randomBytes(32)
);
if (
  app.get('env') === 'production' &&
  (
    typeof adminSessionSecret !== 'string' ||
    Buffer.byteLength(adminSessionSecret) < 32 ||
    adminSessionSecret.startsWith('replace-with-') ||
    [
      shippingAdminToken,
      productAdminToken,
      analyticsAdminToken,
      inboundAdminToken
    ].includes(adminSessionSecret)
  )
) {
  throw new Error('生產環境必須設定獨立且至少 32 bytes 的 ADMIN_SESSION_SECRET。');
}
const adminSessions = createAdminSessions({
  sessionSecret: adminSessionSecret,
  secureCookie: app.get('env') === 'production',
  credentials: [
    { token: shippingAdminToken, scopes: ['shipping'] },
    { token: productAdminToken, scopes: ['products'] },
    { token: analyticsAdminToken, scopes: ['analytics'] },
    { token: inboundAdminToken, scopes: ['inbound'] }
  ]
});
app.use('/api/admin-auth', adminSessions.router);

app.use('/api/products', createProductsRouter(adminSupabase, {
  adminToken: productAdminToken,
  isSessionAuthorized: adminSessions.isAuthorized,
  stockWriteEnabled: supabaseServiceRoleKey.length > 0
}));
app.use('/api/orders', createOrdersRouter(adminSupabase, {
  serviceRoleAvailable: supabaseServiceRoleKey.length > 0
}));
app.use('/api/customer', createCustomerRouter(adminSupabase, {
  rateLimitSecret: process.env.CUSTOMER_LOOKUP_RATE_SECRET,
  readEnabled: supabaseServiceRoleKey.length > 0
}));
app.use('/api/analytics', createAnalyticsRouter(adminSupabase, {
  adminToken: analyticsAdminToken,
  isSessionAuthorized: adminSessions.isAuthorized,
  readEnabled: Boolean(supabaseAnonKey),
  useTableFallback: !supabaseServiceRoleKey
}));
app.use('/api/inbound', createInboundRouter(adminSupabase, {
  adminToken: inboundAdminToken,
  isSessionAuthorized: adminSessions.isAuthorized,
  writeEnabled: supabaseServiceRoleKey.length > 0
}));
const reminderRecipients = (process.env.WHATSAPP_REMINDER_RECIPIENTS || '')
  .split(',')
  .map(recipient => recipient.trim().replace(/^\+/, ''))
  .filter(Boolean);
const whatsappApiVersion = process.env.WHATSAPP_GRAPH_API_VERSION || '';
const whatsappPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const whatsappAccessToken = process.env.WHATSAPP_API_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN || '';
const validWhatsAppRecipients = reminderRecipients.every(recipient => /^\d{8,15}$/.test(recipient));
const hasWhatsAppCredentials = (
  /^v\d+\.\d+$/.test(whatsappApiVersion) &&
  /^\d+$/.test(whatsappPhoneNumberId) &&
  whatsappAccessToken.length > 0
);
const hasWhatsAppConfiguration = (
  hasWhatsAppCredentials &&
  validWhatsAppRecipients
);

async function sendWhatsAppMessage({ to, text }) {
  if (!hasWhatsAppCredentials || !/^\d{8,15}$/.test(to)) {
    throw new Error('WhatsApp Cloud API 設定無效，或收件電話格式錯誤。');
  }

  const response = await fetch(
    `https://graph.facebook.com/${whatsappApiVersion}/${whatsappPhoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${whatsappAccessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: {
          preview_url: false,
          body: text
        }
      })
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`WhatsApp Cloud API 回應 HTTP ${response.status}: ${errorBody.slice(0, 500)}`);
  }

  return response.json();
}

async function sendWhatsAppReminder({ to, text }) {
  if (!hasWhatsAppConfiguration) {
    throw new Error('WhatsApp Cloud API 設定無效或不完整。');
  }
  return sendWhatsAppMessage({ to, text });
}

app.use('/api/webhook', createWebhookRouter(adminSupabase, {
  verifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
  appSecret: process.env.WHATSAPP_APP_SECRET,
  writeEnabled: supabaseServiceRoleKey.length > 0,
  sendWhatsApp: hasWhatsAppCredentials ? sendWhatsAppMessage : null
}));

app.use('/api/shipping', createShippingRouter(adminSupabase, {
  adminToken: shippingAdminToken,
  isSessionAuthorized: adminSessions.isAuthorized,
  writeEnabled: supabaseServiceRoleKey.length > 0,
  readEnabled: Boolean(supabaseAnonKey),
  sendWhatsApp: hasWhatsAppCredentials ? sendWhatsAppMessage : null
}));

app.use('/api/reminders', createReminderRouter(supabase, {
  cronToken: process.env.REMINDER_CRON_TOKEN,
  recipients: hasWhatsAppConfiguration ? reminderRecipients : [],
  sendWhatsApp: hasWhatsAppConfiguration ? sendWhatsAppReminder : null
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

```

---

### File: `system-prompt.json`

```
{
  "models": [
    {
      "title": "GPT-6Luna FullStack Master v6",
      "provider": "copilot",
      "model": "gpt-6luna",
      "systemMessage": "你係一位頂尖嘅全端資深工程師，正在協助開發「LittlePlanet 宇宙網店」（技術棧：Node.js + Express + Supabase + 靜態前台）。所有解說同對答必須使用繁體中文（香港習慣），並保持極度精簡。\n\n執行規則（嚴格遵守）：\n1. **明確檔案路徑**：每次輸出代碼前必須列明目標檔案（例如：`public/index.html` 或 `index.js`）。\n2. **100% 完整代碼與安全**：代碼必須結構清晰、合乎語法，絕對嚴禁省略號；涉及資料庫或 API 必須加入完善嘅 `try...catch` 錯誤處理，且機密資料必須透過 `process.env` 讀取。\n3. **統一 API 格式與互動**：後端回應必須保持結構化（如 `{ success, data, message }`）；前端調用 API 時必須加入錯誤捕捉與狀態提示。\n4. **Supabase 查詢防護**：任何 Supabase 資料庫操作（如 `.from().select()`）必須主動檢查並處理回傳嘅 `error` 物件。\n5. **零廢話**：省略不必要嘅客套話，直接輸出乾淨精確嘅代碼區塊。\n6. **Planning 來源**：所有 Planning 內容均存放在 Excel 檔案中，檔名為 `網店_AI_Agent_PRD與DB架構完整版.json`。",
      "options": {
        "temperature": 0.1,
        "top_p": 0.9,
        "top_k": 40,
        "repeat_penalty": 1.1,
        "num_ctx": 8192,
        "num_predict": 2048,
        "num_thread": 4
      }
    }
  ],
  "tabAutocompleteModel": {
    "title": "GPT-6Luna Autocomplete",
    "provider": "copilot",
    "model": "gpt-6luna",
    "options": {
      "temperature": 0.0,
      "num_predict": 64,
      "num_thread": 4
    }
  }
}
```

---

### File: `.continue\config.yaml`

```
models:
  - title: Ollama
    provider: ollama
    model: llama3.1:8b
```

---

### File: `.github\workflows\test.yml`

```
name: Node.js tests

on:
  push:
    branches:
      - main
  pull_request:
    branches:
      - main

permissions:
  contents: read

jobs:
  test:
    name: Run tests
    runs-on: ubuntu-latest
    timeout-minutes: 10
    env:
      NODE_ENV: test
      SUPABASE_URL: https://ci-placeholder.supabase.co
      SUPABASE_ANON_KEY: ci-placeholder-anon-key
      SUPABASE_SERVICE_ROLE_KEY: ci-placeholder-service-role-key
      CUSTOMER_LOOKUP_RATE_SECRET: ci-placeholder-customer-lookup-rate-secret-0123456789abcdef0123456789
    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22.x
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test

```

---

### File: `backups\backup-2026-09-26T19-49-21-320Z.json`

```
{
  "products": [
    {
      "id": 1,
      "name": "LittlePlanet 星球筆記本",
      "description": "超精美的宇宙主題文具，新手上路紀念版！",
      "price": 150,
      "stock": 20,
      "image_url": "https://picsum.photos/200",
      "category": "stationery",
      "is_active": true,
      "created_at": "2026-09-26T03:41:35.279714+00:00"
    }
  ],
  "orders": [],
  "order_items": [],
  "whatsapp_payment_reports": []
}
```

---

### File: `middleware\admin-sessions.js`

```
'use strict';

const crypto = require('node:crypto');
const express = require('express');

const COOKIE_NAME = 'littleplanet_admin_session';
const DEFAULT_SESSION_TTL_SECONDS = 8 * 60 * 60;
const SESSION_SCOPES = new Set(['shipping', 'products', 'analytics', 'inbound']);

function sendError(res, status, message) {
  return res.status(status).json({
    success: false,
    data: null,
    message
  });
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function readCookie(req, cookieName) {
  const header = req.get('cookie');
  if (typeof header !== 'string') {
    return null;
  }

  for (const item of header.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0 || item.slice(0, separator).trim() !== cookieName) {
      continue;
    }
    try {
      return decodeURIComponent(item.slice(separator + 1).trim());
    } catch (error) {
      return null;
    }
  }
  return null;
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

function createAdminSessions(options = {}) {
  const router = express.Router();
  const sessionSecret = options.sessionSecret;
  const secureCookie = options.secureCookie === true;
  const ttlSeconds = Number.isSafeInteger(options.ttlSeconds) && options.ttlSeconds > 0
    ? options.ttlSeconds
    : DEFAULT_SESSION_TTL_SECONDS;
  const credentials = (options.credentials || [])
    .filter(credential => (
      credential &&
      typeof credential.token === 'string' &&
      credential.token.length >= 32 &&
      !credential.token.startsWith('replace-with-') &&
      Array.isArray(credential.scopes)
    ))
    .map(credential => ({
      token: credential.token,
      scopes: [...new Set(credential.scopes.filter(scope => SESSION_SCOPES.has(scope)))]
    }))
    .filter(credential => credential.scopes.length > 0);

  if (
    !Buffer.isBuffer(sessionSecret) &&
    (typeof sessionSecret !== 'string' || Buffer.byteLength(sessionSecret) < 32)
  ) {
    throw new Error('管理員 session signing secret 必須至少 32 bytes。');
  }

  const signingKey = Buffer.isBuffer(sessionSecret)
    ? sessionSecret
    : Buffer.from(sessionSecret);
  if (signingKey.length < 32) {
    throw new Error('管理員 session signing secret 必須至少 32 bytes。');
  }

  function sign(payload) {
    return crypto.createHmac('sha256', signingKey).update(payload).digest('base64url');
  }

  function createCookieValue(scopes) {
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(JSON.stringify({
      version: 1,
      issuedAt: now,
      expiresAt: now + ttlSeconds,
      scopes
    })).toString('base64url');
    return `${payload}.${sign(payload)}`;
  }

  function getSession(req) {
    const value = readCookie(req, COOKIE_NAME);
    if (typeof value !== 'string') {
      return null;
    }
    const separator = value.lastIndexOf('.');
    if (separator <= 0) {
      return null;
    }

    const payload = value.slice(0, separator);
    const suppliedSignature = value.slice(separator + 1);
    if (!safeEqual(sign(payload), suppliedSignature)) {
      return null;
    }

    try {
      const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      const now = Math.floor(Date.now() / 1000);
      if (
        !session ||
        session.version !== 1 ||
        !Number.isSafeInteger(session.issuedAt) ||
        !Number.isSafeInteger(session.expiresAt) ||
        session.issuedAt > now ||
        session.expiresAt <= now ||
        session.expiresAt - session.issuedAt > ttlSeconds ||
        !Array.isArray(session.scopes) ||
        session.scopes.length === 0 ||
        session.scopes.some(scope => !SESSION_SCOPES.has(scope))
      ) {
        return null;
      }
      return session;
    } catch (error) {
      return null;
    }
  }

  function cookieOptions() {
    return {
      httpOnly: true,
      secure: secureCookie,
      sameSite: 'strict',
      path: '/api',
      maxAge: ttlSeconds * 1000
    };
  }

  function clearCookie(res) {
    res.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      secure: secureCookie,
      sameSite: 'strict',
      path: '/api'
    });
  }

  router.post('/login', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!isSameOriginRequest(req)) {
      return sendError(res, 403, '登入要求必須來自同一網站。');
    }
    if (credentials.length === 0) {
      return sendError(res, 503, '管理員登入尚未設定有效的管理 Token。');
    }

    const token = req.body && !Array.isArray(req.body) && typeof req.body.token === 'string'
      ? req.body.token
      : '';
    if (token.length === 0 || token.length > 512) {
      return sendError(res, 400, '請提供有效的管理員密鑰。');
    }

    const scopes = new Set();
    let matched = false;
    for (const credential of credentials) {
      if (safeEqual(token, credential.token)) {
        matched = true;
        credential.scopes.forEach(scope => scopes.add(scope));
      }
    }

    if (!matched) {
      return sendError(res, 401, '管理員密鑰錯誤或無權限。');
    }

    res.cookie(COOKIE_NAME, createCookieValue([...scopes]), cookieOptions());
    res.set('Cache-Control', 'no-store');
    return res.json({
      success: true,
      data: { authenticated: true, scopes: [...scopes] },
      message: '管理員登入成功。'
    });
  });

  router.get('/session', (req, res) => {
    const session = getSession(req);
    res.set('Cache-Control', 'no-store');
    return res.json({
      success: true,
      data: session
        ? { authenticated: true, scopes: session.scopes }
        : { authenticated: false, scopes: [] },
      message: session ? '管理員 session 有效。' : '尚未登入。'
    });
  });

  router.post('/logout', (req, res) => {
    if (!isSameOriginRequest(req)) {
      return sendError(res, 403, '登出要求必須來自同一網站。');
    }
    clearCookie(res);
    res.set('Cache-Control', 'no-store');
    return res.json({
      success: true,
      data: { authenticated: false },
      message: '已安全登出。'
    });
  });

  function isAuthorized(req, expectedToken, scope) {
    const authorization = req.get('authorization') || '';
    if (authorization.startsWith('Bearer ')) {
      return safeEqual(authorization.slice('Bearer '.length), expectedToken);
    }

    const session = getSession(req);
    if (!session || !session.scopes.includes(scope)) {
      return false;
    }

    return ['GET', 'HEAD', 'OPTIONS'].includes(req.method) || isSameOriginRequest(req);
  }

  return {
    router,
    isAuthorized,
    getSession,
    cookieName: COOKIE_NAME
  };
}

module.exports = createAdminSessions;

```

---

### File: `middleware\api-protection.js`

```
'use strict';

function createApiProtection(options = {}) {
  const windowMs = Number.isSafeInteger(options.windowMs) && options.windowMs > 0
    ? options.windowMs
    : 15 * 60 * 1000;
  const maxRequests = Number.isSafeInteger(options.maxRequests) && options.maxRequests > 0
    ? options.maxRequests
    : 120;
  const maxEntries = Number.isSafeInteger(options.maxEntries) && options.maxEntries > 0
    ? options.maxEntries
    : 10000;
  const allowedOrigins = new Set(options.allowedOrigins || []);
  const requests = new Map();

  return function protectApi(req, res, next) {
    const origin = req.get('origin');
    if (origin) {
      let parsedOrigin;
      try {
        parsedOrigin = new URL(origin).origin;
      } catch (error) {
        return res.status(403).json({
          success: false,
          data: null,
          message: '不允許此來源存取 API。'
        });
      }

      const requestOrigin = `${req.protocol}://${req.get('host')}`;
      if (parsedOrigin !== requestOrigin && !allowedOrigins.has(parsedOrigin)) {
        return res.status(403).json({
          success: false,
          data: null,
          message: '不允許此來源存取 API。'
        });
      }

      res.set('Access-Control-Allow-Origin', parsedOrigin);
      res.vary('Origin');
      res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Hub-Signature-256');
      res.set('Access-Control-Max-Age', '600');
    }

    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }

    const now = Date.now();
    const ip = typeof req.ip === 'string' && req.ip.length > 0 ? req.ip : req.socket.remoteAddress;
    let entry = requests.get(ip);

    if (!entry || entry.resetAt <= now) {
      if (!entry && requests.size >= maxEntries) {
        for (const [key, value] of requests) {
          if (value.resetAt <= now) {
            requests.delete(key);
          }
        }
      }

      if (!entry && requests.size >= maxEntries) {
        return res.status(503).json({
          success: false,
          data: null,
          message: 'API 暫時繁忙，請稍後再試。'
        });
      }

      entry = { count: 0, resetAt: now + windowMs };
      requests.set(ip, entry);
    }

    entry.count += 1;
    const remaining = Math.max(0, maxRequests - entry.count);
    const resetSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    res.set('RateLimit-Limit', String(maxRequests));
    res.set('RateLimit-Remaining', String(remaining));
    res.set('RateLimit-Reset', String(resetSeconds));

    if (entry.count > maxRequests) {
      res.set('Retry-After', String(resetSeconds));
      return res.status(429).json({
        success: false,
        data: null,
        message: '請求次數過多，請稍後再試。'
      });
    }

    return next();
  };
}

module.exports = createApiProtection;

```

---

### File: `middleware\error-handler.js`

```
'use strict';

function sendError(res, status, message) {
  return res.status(status).json({
    success: false,
    data: null,
    message
  });
}

function apiNotFound(req, res) {
  return sendError(res, 404, '找不到指定 API 路徑。');
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  const environment = req.app.get('env');
  console.error('處理 HTTP 請求時發生錯誤：', {
    method: req.method,
    path: req.path,
    message: error.message,
    ...(environment === 'production' ? {} : { stack: error.stack })
  });

  if (error.type === 'entity.parse.failed') {
    return sendError(res, 400, '請求 JSON 格式無效。');
  }
  if (error.type === 'entity.too.large') {
    return sendError(res, 413, '請求資料超出大小限制。');
  }

  return sendError(res, 500, '伺服器發生錯誤，請稍後再試。');
}

module.exports = {
  apiNotFound,
  errorHandler
};

```

---

### File: `middleware\sensitive-rate-limits.js`

```
'use strict';

const { rateLimit } = require('express-rate-limit');

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;

function createSensitiveRateLimiters(options = {}) {
  const windowMs = Number.isSafeInteger(options.windowMs) && options.windowMs > 0
    ? options.windowMs
    : DEFAULT_WINDOW_MS;

  function createLimiter(limit, message) {
    return rateLimit({
      windowMs,
      limit,
      standardHeaders: true,
      legacyHeaders: false,
      handler(req, res) {
        return res.status(429).json({
          success: false,
          data: null,
          message
        });
      }
    });
  }

  return {
    checkout: createLimiter(
      options.checkoutMax || 10,
      '落單請求次數過多，請稍後再試。'
    ),
    inventory: createLimiter(
      options.inventoryMax || 30,
      '庫存更新請求次數過多，請稍後再試。'
    ),
    customerLookup: createLimiter(
      options.customerLookupMax || 10,
      '訂單查詢請求次數過多，請稍後再試。'
    ),
    adminLogin: createLimiter(
      options.adminLoginMax || 5,
      '登入嘗試次數過多，請稍後再試。'
    ),
    adminWrite: createLimiter(
      options.adminWriteMax || 30,
      '管理操作請求次數過多，請稍後再試。'
    )
  };
}

module.exports = createSensitiveRateLimiters;

```

---

### File: `public\admin.html`

```
<!DOCTYPE html>
<html lang="zh-HK">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LittlePlanet 小行星 — 營運管理後台</title>
    <style>
        :root { --primary: #2563eb; --bg: #f8fafc; --card: #ffffff; --text: #1e293b; --border: #e2e8f0; }
        body { font-family: system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 20px; }
        .container { max-width: 1200px; margin: 0 auto; }
        header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
        h1 { margin: 0; font-size: 1.5rem; color: var(--primary); }
        .auth-bar { background: var(--card); padding: 12px 16px; border-radius: 8px; border: 1px solid var(--border); display: flex; gap: 10px; align-items: center; margin-bottom: 20px; }
        input, select { padding: 8px 12px; border: 1px solid var(--border); border-radius: 6px; font-size: 0.95rem; }
        button { background: var(--primary); color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 500; }
        button:hover { opacity: 0.9; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-bottom: 24px; }
        .card { background: var(--card); padding: 20px; border-radius: 8px; border: 1px solid var(--border); box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
        .card h3 { margin: 0 0 8px 0; font-size: 0.85rem; color: #64748b; text-transform: uppercase; }
        .card .value { font-size: 1.75rem; font-weight: 700; color: var(--text); }
        .section { background: var(--card); padding: 20px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 24px; }
        table { width: 100%; border-collapse: collapse; margin-top: 12px; }
        th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border); font-size: 0.9rem; }
        th { background: #f1f5f9; font-weight: 600; }
        .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 600; }
        .badge.success { background: #dcfce7; color: #166534; }
        .badge.warning { background: #fef9c3; color: #854d0e; }
        .badge.low-stock { background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca; }
        .badge.stock-ok { background: #dcfce7; color: #166534; }
        .stock-input { width: 100px; }
        .stock-input:focus { outline: 2px solid #93c5fd; outline-offset: 1px; }
        .stock-save:disabled { opacity: 0.6; cursor: wait; }
        .stock-feedback { display: block; min-height: 1.2em; margin-top: 4px; }
        .stock-feedback.error { color: #b91c1c; }
        .stock-feedback.success { color: #166534; }
        .charts-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
        .chart-card { min-width: 0; padding: 16px; border: 1px solid var(--border); border-radius: 8px; }
        .chart-container { position: relative; height: 280px; }
        .chart-status { min-height: 1.4em; color: #64748b; }
        .chart-status.error { color: #b91c1c; }
        @media (max-width: 600px) {
            body { padding: 12px; }
            .chart-container { height: 240px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>🪐 LittlePlanet 後台營運系統</h1>
            <span id="status-badge" class="badge warning">未授權</span>
        </header>

        <form class="auth-bar" id="login-form">
            <label for="admin-password">管理員密鑰：</label>
            <input type="password" id="admin-password" name="password" autocomplete="current-password" required style="flex: 1; max-width: 400px;">
            <button id="login-button" type="submit">登入</button>
            <button id="logout-button" type="button" hidden>登出</button>
            <span id="login-message" role="status" aria-live="polite"></span>
        </form>

        <!-- 營收儀表板 -->
        <div class="grid" id="metrics-grid">
            <div class="card"><h3>總營業額 (Revenue)</h3><div class="value" id="m-revenue">—</div></div>
            <div class="card"><h3>總訂單數 (Orders)</h3><div class="value" id="m-orders">—</div></div>
            <div class="card"><h3>已付款比例</h3><div class="value" id="m-paid">—</div></div>
            <div class="card"><h3>已出貨比例</h3><div class="value" id="m-shipped">—</div></div>
        </div>

        <div class="section">
            <h2>📈 銷售趨勢</h2>
            <p id="sales-chart-status" class="chart-status" role="status" aria-live="polite">登入後載入圖表資料</p>
            <div class="charts-grid">
                <div class="chart-card">
                    <h3>每日營業額</h3>
                    <div class="chart-container"><canvas id="revenue-chart" aria-label="每日營業額趨勢圖"></canvas></div>
                </div>
                <div class="chart-card">
                    <h3>每日訂單數</h3>
                    <div class="chart-container"><canvas id="orders-chart" aria-label="每日訂單數趨勢圖"></canvas></div>
                </div>
            </div>
        </div>

        <div class="section">
            <h2>📦 商品庫存 (Product Stock)</h2>
            <p>庫存更新會設定商品目前庫存數量；實際到貨入庫請使用入庫流程，以同步分配待出貨訂單。</p>
            <div style="overflow-x: auto;">
                <table>
                    <thead>
                        <tr>
                            <th>商品</th>
                            <th>狀態</th>
                            <th>目前庫存</th>
                            <th>更新庫存</th>
                        </tr>
                    </thead>
                    <tbody id="products-tbody">
                        <tr><td colspan="4" style="text-align: center; color: #64748b;">尚未載入商品</td></tr>
                    </tbody>
                </table>
            </div>
        </div>

        <!-- 執貨清單 -->
        <div class="section">
            <h2>📦 待出貨執貨清單 (Pick List)</h2>
            <div style="margin-bottom: 12px;">
                <label>檢視分組：</label>
                <select id="groupby-select" onchange="loadPickList()">
                    <option value="order">按訂單分組</option>
                    <option value="product">按貨品分組</option>
                </select>
            </div>
            <div style="overflow-x: auto;">
                <table>
                    <thead>
                        <tr>
                            <th>訂單 ID / 貨品</th>
                            <th>買家電話</th>
                            <th>出貨方式</th>
                            <th>明細狀態</th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody id="picklist-tbody">
                        <tr><td colspan="5" style="text-align: center; color: #64748b;">尚未載入執貨清單</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>

    <script src="/vendor/chart.umd.min.js"></script>
    <script>
        let revenueChart = null;
        let ordersChart = null;

        function adminFetch(url, options = {}) {
            return fetch(url, {
                ...options,
                credentials: 'same-origin'
            }).then(response => {
                if (response.status === 401 && !url.startsWith('/api/admin-auth/session')) {
                    setAdminAuthenticated(false);
                }
                return response;
            });
        }

        function clearDashboardData() {
            for (const id of ['m-revenue', 'm-orders', 'm-paid', 'm-shipped']) {
                document.getElementById(id).textContent = '—';
            }
            if (revenueChart) {
                revenueChart.destroy();
                revenueChart = null;
            }
            if (ordersChart) {
                ordersChart.destroy();
                ordersChart = null;
            }
            document.getElementById('products-tbody').textContent = '登入後載入商品';
            document.getElementById('picklist-tbody').textContent = '登入後載入執貨清單';
            setSalesChartStatus('登入後載入圖表資料', false);
        }

        function setAdminAuthenticated(authenticated) {
            document.getElementById('admin-password').hidden = authenticated;
            document.querySelector('#login-form label').hidden = authenticated;
            document.getElementById('login-button').hidden = authenticated;
            document.getElementById('logout-button').hidden = !authenticated;
            document.getElementById('login-message').textContent = authenticated
                ? '已使用安全工作階段登入。'
                : '';
            if (!authenticated) {
                clearDashboardData();
                document.getElementById('status-badge').className = 'badge warning';
                document.getElementById('status-badge').textContent = '未授權';
            }
        }

        async function loginAdmin(event) {
            event.preventDefault();
            const input = document.getElementById('admin-password');
            const button = document.getElementById('login-button');
            const message = document.getElementById('login-message');
            const token = input.value;
            if (!token) return;

            button.disabled = true;
            message.textContent = '正在驗證…';
            try {
                const response = await adminFetch('/api/admin-auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token })
                });
                const result = await response.json();
                if (!response.ok || !result || result.success !== true) {
                    throw new Error(result && result.message
                        ? result.message
                        : `登入失敗（HTTP ${response.status}）。`);
                }

                input.value = '';
                setAdminAuthenticated(true);
                await loadDashboard();
            } catch (error) {
                console.error('管理員登入失敗：', error);
                message.textContent = error.message || '登入失敗，請稍後再試。';
                setAdminAuthenticated(false);
            } finally {
                button.disabled = false;
            }
        }

        async function logoutAdmin() {
            const message = document.getElementById('login-message');
            try {
                const response = await adminFetch('/api/admin-auth/logout', { method: 'POST' });
                const result = await response.json();
                if (!response.ok || !result || result.success !== true) {
                    throw new Error(result && result.message
                        ? result.message
                        : `登出失敗（HTTP ${response.status}）。`);
                }
                setAdminAuthenticated(false);
                document.getElementById('status-badge').className = 'badge warning';
                document.getElementById('status-badge').textContent = '未授權';
                message.textContent = result.message;
            } catch (error) {
                console.error('管理員登出失敗：', error);
                message.textContent = error.message || '登出失敗，請稍後再試。';
            }
        }

        async function checkAdminSession() {
            try {
                const response = await adminFetch('/api/admin-auth/session');
                const result = await response.json();
                if (!response.ok || !result || result.success !== true) {
                    throw new Error(result && result.message
                        ? result.message
                        : `登入狀態檢查失敗（HTTP ${response.status}）。`);
                }
                setAdminAuthenticated(result.data.authenticated === true);
                if (result.data.authenticated === true) {
                    await loadDashboard();
                }
            } catch (error) {
                console.error('檢查管理員登入狀態失敗：', error);
                document.getElementById('login-message').textContent =
                    error.message || '無法確認登入狀態。';
            }
        }

        document.getElementById('login-form').addEventListener('submit', loginAdmin);
        document.getElementById('logout-button').addEventListener('click', logoutAdmin);
        document.addEventListener('DOMContentLoaded', checkAdminSession);

        async function loadDashboard() {
            document.getElementById('status-badge').className = 'badge warning';
            document.getElementById('status-badge').textContent = '載入中';
            document.getElementById('m-revenue').textContent = '—';
            document.getElementById('m-orders').textContent = '—';
            document.getElementById('m-paid').textContent = '—';
            document.getElementById('m-shipped').textContent = '—';


            try {
                const dateFormatter = new Intl.DateTimeFormat('en-CA', {
                    timeZone: 'Asia/Hong_Kong',
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                });
                const today = dateFormatter.format(new Date());
                const pastDate = dateFormatter.format(new Date(Date.now() - 30 * 86400000));
                const query = `start_date=${encodeURIComponent(pastDate)}&end_date=${encodeURIComponent(today)}`;
                const resOverview = await adminFetch(`/api/analytics/overview?${query}`);
                const jsonOverview = await resOverview.json();
                if (resOverview.status === 401) {
                    setAdminAuthenticated(false);
                    throw new Error('登入已失效或沒有報表權限，請重新登入。');
                }
                if (!resOverview.ok || !jsonOverview || jsonOverview.success !== true || !jsonOverview.data) {
                    throw new Error(jsonOverview && jsonOverview.message
                        ? jsonOverview.message
                        : `營收報表載入失敗（HTTP ${resOverview.status}）。`);
                }

                const d = jsonOverview.data;
                document.getElementById('m-revenue').textContent = `$${Number(d.total_revenue || 0).toFixed(2)}`;
                document.getElementById('m-orders').textContent = String(d.total_orders || 0);
                document.getElementById('m-paid').textContent = `${Number(d.paid_order_percentage || 0)}%`;
                const shippedPercentage = d.shipped_order_percentage === undefined
                    ? 100 - Number(d.unshipped_order_percentage || 0)
                    : Number(d.shipped_order_percentage || 0);
                document.getElementById('m-shipped').textContent = `${shippedPercentage}%`;

                await loadSalesCharts(query);
                await loadPickList();
                await loadProducts();
                document.getElementById('status-badge').className = 'badge success';
                document.getElementById('status-badge').textContent = '已連線授權';
            } catch (err) {
                console.error(err);
                document.getElementById('status-badge').className = 'badge warning';
                document.getElementById('status-badge').textContent = '載入失敗';
                setSalesChartStatus(`圖表未載入：${err.message || '營收報表讀取失敗。'}`, true);
                alert(err.message || '連接伺服器失敗');
            }
        }

        function setSalesChartStatus(message, isError) {
            const status = document.getElementById('sales-chart-status');
            status.textContent = message;
            status.className = isError ? 'chart-status error' : 'chart-status';
        }

        function renderSalesCharts(data) {
            if (
                !window.Chart ||
                !Array.isArray(data.labels) ||
                !Array.isArray(data.revenue) ||
                !Array.isArray(data.order_count) ||
                data.labels.length !== data.revenue.length ||
                data.labels.length !== data.order_count.length ||
                !data.revenue.every(Number.isFinite) ||
                !data.order_count.every(Number.isFinite)
            ) {
                throw new Error('圖表程式或趨勢資料格式無效。');
            }

            if (revenueChart) revenueChart.destroy();
            if (ordersChart) ordersChart.destroy();

            revenueChart = new Chart(document.getElementById('revenue-chart'), {
                type: 'line',
                data: {
                    labels: data.labels,
                    datasets: [{
                        label: '營業額 ($)',
                        data: data.revenue,
                        borderColor: '#2563eb',
                        backgroundColor: 'rgba(37, 99, 235, 0.14)',
                        fill: true,
                        tension: 0.25
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    scales: {
                        y: { beginAtZero: true, title: { display: true, text: '金額 ($)' } },
                        x: { ticks: { maxTicksLimit: 10 } }
                    }
                }
            });

            ordersChart = new Chart(document.getElementById('orders-chart'), {
                type: 'bar',
                data: {
                    labels: data.labels,
                    datasets: [{
                        label: '訂單數',
                        data: data.order_count,
                        backgroundColor: 'rgba(16, 185, 129, 0.75)',
                        borderColor: '#059669',
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: { beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: '訂單數' } },
                        x: { ticks: { maxTicksLimit: 10 } }
                    }
                }
            });
        }

        async function loadSalesCharts(query) {
            setSalesChartStatus('正在載入最近 30 日銷售趨勢…', false);
            try {
                if (!window.Chart) {
                    throw new Error('Chart.js 未能載入，請檢查本機 vendor 檔案。');
                }

                const response = await adminFetch(`/api/analytics/sales-trend?${query}`);
                const result = await response.json();
                if (!response.ok || !result || result.success !== true || !result.data) {
                    throw new Error(result && result.message
                        ? result.message
                        : `銷售趨勢載入失敗（HTTP ${response.status}）。`);
                }

                renderSalesCharts(result.data);
                setSalesChartStatus(
                    `已載入 ${result.data.start_date} 至 ${result.data.end_date}：$${Number(result.data.total_revenue).toFixed(2)}，${result.data.total_orders} 張訂單。`,
                    false
                );
            } catch (error) {
                console.error('載入銷售趨勢圖表失敗：', error);
                if (revenueChart) {
                    revenueChart.destroy();
                    revenueChart = null;
                }
                if (ordersChart) {
                    ordersChart.destroy();
                    ordersChart = null;
                }
                setSalesChartStatus(error.message || '銷售趨勢載入失敗。', true);
            }
        }

        async function loadProducts() {
            try {
                const response = await adminFetch('/api/products');
                const result = await response.json();
                if (!response.ok || !result || result.success !== true || !Array.isArray(result.data)) {
                    throw new Error(result && result.message
                        ? result.message
                        : `商品列表載入失敗（HTTP ${response.status}）。`);
                }

                const tbody = document.getElementById('products-tbody');
                if (result.data.length === 0) {
                    const row = document.createElement('tr');
                    const cell = document.createElement('td');
                    cell.colSpan = 4;
                    cell.style.textAlign = 'center';
                    cell.textContent = '目前沒有商品';
                    row.appendChild(cell);
                    tbody.replaceChildren(row);
                    return true;
                }

                const rows = result.data.map(product => {
                    const row = document.createElement('tr');
                    const name = document.createElement('td');
                    name.textContent = product.product_name || product.name || `商品 #${product.id}`;
                    const status = document.createElement('td');
                    status.textContent = product.status || '未設定';
                    const stock = document.createElement('td');
                    const hasValidStock = Number.isSafeInteger(product.stock) &&
                        product.stock >= 0 &&
                        product.stock <= 2147483647;
                    if (hasValidStock) {
                        const stockCount = document.createElement('strong');
                        stockCount.textContent = `${product.stock} 件`;
                        const stockBadge = document.createElement('span');
                        stockBadge.className = `badge ${product.stock <= 5 ? 'low-stock' : 'stock-ok'}`;
                        stockBadge.textContent = product.stock <= 5 ? '低庫存' : '庫存正常';
                        stockBadge.setAttribute('aria-label', product.stock <= 5 ? '低庫存警示' : '庫存正常');
                        stock.append(stockCount, document.createElement('br'), stockBadge);
                    } else {
                        stock.textContent = '庫存資料無效，請檢查資料庫';
                    }
                    const update = document.createElement('td');
                    const input = document.createElement('input');
                    input.className = 'stock-input';
                    input.type = 'number';
                    input.min = '0';
                    input.max = '2147483647';
                    input.step = '1';
                    input.inputMode = 'numeric';
                    input.value = hasValidStock ? String(product.stock) : '';
                    input.placeholder = hasValidStock ? '新庫存' : '不可更新';
                    input.disabled = !hasValidStock;
                    input.setAttribute('aria-label', `設定${name.textContent}庫存`);
                    const button = document.createElement('button');
                    button.className = 'stock-save';
                    button.type = 'button';
                    button.textContent = '更新';
                    button.disabled = !hasValidStock;
                    button.addEventListener('click', () => updateProductStock(product.id, input, button, stock, status));
                    const feedback = document.createElement('small');
                    feedback.className = 'stock-feedback';
                    feedback.setAttribute('role', 'status');
                    feedback.setAttribute('aria-live', 'polite');
                    update.append(input, button, feedback);
                    row.append(name, status, stock, update);
                    return row;
                });
                tbody.replaceChildren(...rows);
                return true;
            } catch (error) {
                console.error(error);
                const tbody = document.getElementById('products-tbody');
                const row = document.createElement('tr');
                const cell = document.createElement('td');
                cell.colSpan = 4;
                cell.style.textAlign = 'center';
                cell.style.color = '#b91c1c';
                cell.textContent = error.message || '商品列表載入失敗。';
                row.appendChild(cell);
                tbody.replaceChildren(row);
                throw error;
            }
        }

        async function updateProductStock(productId, input, button, stockCell, statusCell) {
            const stock = input.valueAsNumber;
            const feedback = button.parentElement.querySelector('.stock-feedback');
            if (!Number.isSafeInteger(stock) || stock < 0 || stock > 2147483647) {
                feedback.className = 'stock-feedback error';
                feedback.textContent = '請輸入 0 至 2147483647 的整數庫存。';
                input.focus();
                return;
            }

            button.disabled = true;
            button.textContent = '更新中…';
            feedback.className = 'stock-feedback';
            feedback.textContent = '正在儲存庫存…';
            try {
                const response = await adminFetch(`/api/products/${encodeURIComponent(productId)}/stock`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ stock })
                });
                const result = await response.json();
                if (!response.ok || !result || result.success !== true || !result.data) {
                    throw new Error(result && result.message
                        ? result.message
                        : `庫存更新失敗（HTTP ${response.status}）。`);
                }
                input.value = String(result.data.stock);
                const stockCount = document.createElement('strong');
                stockCount.textContent = `${result.data.stock} 件`;
                const stockBadge = document.createElement('span');
                stockBadge.className = `badge ${result.data.stock <= 5 ? 'low-stock' : 'stock-ok'}`;
                stockBadge.textContent = result.data.stock <= 5 ? '低庫存' : '庫存正常';
                stockBadge.setAttribute('aria-label', result.data.stock <= 5 ? '低庫存警示' : '庫存正常');
                stockCell.replaceChildren(stockCount, document.createElement('br'), stockBadge);
                statusCell.textContent = result.data.status || statusCell.textContent;
                feedback.className = 'stock-feedback success';
                feedback.textContent = `已更新至 ${result.data.stock} 件。`;
            } catch (error) {
                console.error(error);
                feedback.className = 'stock-feedback error';
                feedback.textContent = error.message || '庫存更新失敗，原庫存資料未作變更。';
            } finally {
                button.disabled = false;
                button.textContent = '更新';
            }
        }

        async function loadPickList() {
            const groupBy = document.getElementById('groupby-select').value;

            try {
                const res = await adminFetch(`/api/shipping/pick-list?group_by=${groupBy}`);
                const json = await res.json();
                const tbody = document.getElementById('picklist-tbody');
                if (!res.ok || !json || json.success !== true || !Array.isArray(json.data)) {
                    throw new Error(json && json.message
                        ? json.message
                        : `執貨清單載入失敗（HTTP ${res.status}）。`);
                }

                if (json.data.length === 0) {
                    const row = document.createElement('tr');
                    const cell = document.createElement('td');
                    cell.colSpan = 5;
                    cell.style.textAlign = 'center';
                    cell.style.color = '#64748b';
                    cell.textContent = '目前沒有可出貨的項目';
                    row.appendChild(cell);
                    tbody.replaceChildren(row);
                    return true;
                }

                const rows = json.data.map(item => {
                    const tr = document.createElement('tr');
                    const identity = document.createElement('td');
                    const title = document.createElement('strong');
                    const details = document.createElement('small');
                    if (groupBy === 'product') {
                        title.textContent = `貨品 #${item.product_id}`;
                        details.textContent = `${item.product_name || '未命名商品'} × ${item.total_quantity} 件`;
                    } else {
                        title.textContent = `訂單 #${item.order_id}`;
                        details.textContent = (Array.isArray(item.items) ? item.items : [])
                            .map(orderItem => `${orderItem.product_name || '未命名商品'} × ${orderItem.quantity}`)
                            .join('、');
                    }
                    identity.append(title, document.createElement('br'), details);

                    const phone = document.createElement('td');
                    phone.textContent = groupBy === 'order'
                        ? (item.customer_phone || '無電話')
                        : `${Array.isArray(item.orders) ? item.orders.length : 0} 張訂單`;
                    const shipping = document.createElement('td');
                    shipping.textContent = groupBy === 'order'
                        ? (item.shipping_method || '未安排')
                        : '按訂單分別出貨';

                    const statusCell = document.createElement('td');
                    const badge = document.createElement('span');
                    badge.className = 'badge success';
                    badge.textContent = groupBy === 'order'
                        ? (item.shipping_status || '可出貨')
                        : '已齊貨';
                    statusCell.appendChild(badge);

                    const action = document.createElement('td');
                    const orderIds = groupBy === 'order'
                        ? [item.order_id]
                        : [...new Set((Array.isArray(item.orders) ? item.orders : [])
                            .map(order => order.order_id))];
                    if (orderIds.length === 0) {
                        action.textContent = '無可出貨訂單';
                    } else {
                        for (const orderId of orderIds) {
                            const button = document.createElement('button');
                            button.type = 'button';
                            button.textContent = groupBy === 'order' ? '快速出貨' : `出貨 #${orderId}`;
                            button.addEventListener('click', () => shipOrder(orderId));
                            action.appendChild(button);
                        }
                    }
                    tr.append(identity, phone, shipping, statusCell, action);
                    return tr;
                });
                tbody.replaceChildren(...rows);
                return true;
            } catch (err) {
                console.error(err);
                const tbody = document.getElementById('picklist-tbody');
                const row = document.createElement('tr');
                const cell = document.createElement('td');
                cell.colSpan = 5;
                cell.style.textAlign = 'center';
                cell.style.color = '#b91c1c';
                cell.textContent = err.message || '執貨清單載入失敗。';
                row.appendChild(cell);
                tbody.replaceChildren(row);
                throw err;
            }
        }

        async function shipOrder(orderId) {
            const trackingNumber = prompt('請輸入順豐/京東運單號碼 (Tracking Number):', 'SF' + Date.now().toString().slice(-8));
            if (!trackingNumber) return;

            try {
                const res = await adminFetch(`/api/shipping/${encodeURIComponent(orderId)}/ship`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ shipping_method: '順豐', tracking_number: trackingNumber })
                });
                const json = await res.json();
                if (!res.ok || !json || json.success !== true) {
                    throw new Error(json && json.message
                        ? json.message
                        : `出貨失敗（HTTP ${res.status}）。`);
                }
                const notification = json.data && json.data.notification;
                const notificationStatus = notification && notification.status
                    ? notification.status
                    : 'unknown';
                const notificationMessage = notification && notification.message
                    ? notification.message
                    : '通知狀態未能確認。';
                alert(notification && notification.success
                    ? `出貨成功，WhatsApp 運單通知已發送。\n${notificationMessage}`
                    : `訂單已出貨，但 WhatsApp 通知未成功。\n${notificationMessage}`);
                try {
                    await Promise.all([loadPickList(), loadProducts()]);
                } catch (refreshError) {
                    alert(`訂單已成功出貨，但清單重新讀取失敗：${refreshError.message}`);
                }
                if (
                    notification &&
                    notification.success !== true &&
                    ['failed', 'pending'].includes(notificationStatus) &&
                    confirm('要立即重試 WhatsApp 出貨通知嗎？')
                ) {
                    await retryShipmentNotification(orderId);
                }
            } catch (err) {
                console.error(err);
                alert(err.message || '網路錯誤');
            }
        }

        async function retryShipmentNotification(orderId) {
            try {
                const response = await adminFetch(
                    `/api/shipping/${encodeURIComponent(orderId)}/notification/retry`,
                    {
                        method: 'POST',
                    }
                );
                const result = await response.json();
                if (!response.ok || !result || result.success !== true) {
                    throw new Error(result && result.message
                        ? result.message
                        : `通知重試失敗（HTTP ${response.status}）。`);
                }
                alert(result.message || 'WhatsApp 出貨通知已發送。');
            } catch (error) {
                console.error('重試 WhatsApp 出貨通知失敗：', error);
                alert(error.message || 'WhatsApp 通知重試失敗，請稍後再試。');
            }
        }
    </script>
</body>
</html>
```

---

### File: `public\index.html`

```
<!DOCTYPE html>
<html lang="zh-HK">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LittlePlanet 星球網店</title>
  <style>
    :root {
      --primary: #315bd6;
      --primary-hover: #2448b5;
      --bg-color: #f8fafc;
      --card-bg: #ffffff;
      --text-main: #1e293b;
      --text-muted: #64748b;
      --border-color: #e2e8f0;
      --shadow: 0 10px 30px rgba(30, 41, 59, 0.06);
      --shadow-hover: 0 20px 40px rgba(30, 41, 59, 0.1);
      --success: #10b981;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      padding: 0;
      background: var(--bg-color);
      color: var(--text-main);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.6;
      display: flex;
      flex-direction: column;
      min-height: 100vh;
    }

    /* 頂部公告欄 */
    .announcement-bar {
      background: linear-gradient(135deg, #315bd6, #4f46e5);
      color: #fff;
      text-align: center;
      padding: 8px 16px;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.3px;
    }

    /* 頂部導覽列 */
    header {
      background: #ffffff;
      border-bottom: 1px solid var(--border-color);
      position: sticky;
      top: 0;
      z-index: 100;
      box-shadow: 0 2px 10px rgba(0,0,0,0.02);
    }

    .nav-container {
      max-width: 1150px;
      margin: 0 auto;
      padding: 16px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .brand {
      font-size: 22px;
      font-weight: 800;
      color: var(--primary);
      text-decoration: none;
      display: flex;
      align-items: center;
      gap: 8px;
      letter-spacing: -0.5px;
    }

    .navbar {
      display: flex;
      align-items: center;
      gap: 20px;
    }

    .navbar a {
      color: var(--text-muted);
      font-weight: 600;
      font-size: 14px;
      text-decoration: none;
      transition: color 0.2s;
    }

    .navbar a:hover {
      color: var(--primary);
    }

    .cart-button {
      background: var(--primary);
      color: #fff;
      border: none;
      padding: 10px 20px;
      border-radius: 50px;
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: background 0.2s, transform 0.1s, box-shadow 0.2s;
      box-shadow: 0 4px 14px rgba(49, 91, 214, 0.3);
    }

    .cart-button:hover {
      background: var(--primary-hover);
      box-shadow: 0 6px 18px rgba(49, 91, 214, 0.4);
    }

    .cart-button:active {
      transform: scale(0.97);
    }

    /* 主要內容區 */
    main {
      max-width: 1150px;
      width: 100%;
      margin: 40px auto;
      padding: 0 24px;
      flex: 1;
    }

    .hero-section {
      text-align: center;
      margin-bottom: 28px;
    }

    .hero-section h1 {
      margin: 0 0 10px;
      font-size: 36px;
      font-weight: 800;
      color: var(--text-main);
      letter-spacing: -0.5px;
    }

    .hero-section p {
      margin: 0;
      color: var(--text-muted);
      font-size: 16px;
    }

    /* 信心保證欄 */
    .trust-badges {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
      margin-bottom: 36px;
      background: #ffffff;
      padding: 20px;
      border-radius: 16px;
      border: 1px solid var(--border-color);
      box-shadow: var(--shadow);
    }

    .trust-item {
      display: flex;
      align-items: center;
      gap: 12px;
      justify-content: center;
      text-align: left;
    }

    .trust-icon {
      font-size: 28px;
    }

    .trust-text h3 {
      margin: 0;
      font-size: 14px;
      font-weight: 700;
      color: var(--text-main);
    }

    .trust-text p {
      margin: 2px 0 0;
      font-size: 12px;
      color: var(--text-muted);
    }

    /* 分類標籤 */
    .category-tabs {
      display: flex;
      gap: 10px;
      margin-bottom: 20px;
      overflow-x: auto;
      padding-bottom: 6px;
    }

    .tab-button {
      padding: 9px 18px;
      background: #ffffff;
      border: 1px solid var(--border-color);
      color: var(--text-muted);
      border-radius: 50px;
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.2s;
    }

    .tab-button:hover {
      border-color: var(--primary);
      color: var(--primary);
    }

    .tab-button.active {
      background: var(--primary);
      color: #ffffff;
      border-color: var(--primary);
      box-shadow: 0 4px 12px rgba(49, 91, 214, 0.25);
    }

    /* 搜尋與排序控制列 */
    .store-controls {
      display: flex;
      gap: 12px;
      margin-bottom: 32px;
      flex-wrap: wrap;
    }

    .search-input, .sort-select {
      padding: 12px 18px;
      border: 1px solid var(--border-color);
      border-radius: 14px;
      font: inherit;
      font-size: 14px;
      background: #fff;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }

    .search-input {
      flex: 1;
      min-width: 240px;
    }

    .search-input:focus, .sort-select:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 4px rgba(49, 91, 214, 0.1);
    }

    .sort-select {
      cursor: pointer;
      color: var(--text-main);
    }

    .product-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));
      gap: 28px;
    }

    .product-card {
      background: var(--card-bg);
      border-radius: 20px;
      padding: 20px;
      box-shadow: var(--shadow);
      transition: transform 0.25s ease, box-shadow 0.25s ease;
      display: flex;
      flex-direction: column;
      border: 1px solid var(--border-color);
      position: relative;
      overflow: hidden;
    }

    .product-card:hover {
      transform: translateY(-6px);
      box-shadow: var(--shadow-hover);
    }

    .product-badge {
      position: absolute;
      top: 16px;
      left: 16px;
      background: rgba(49, 91, 214, 0.92);
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      padding: 5px 12px;
      border-radius: 20px;
      backdrop-filter: blur(4px);
      z-index: 2;
    }

    .product-image {
      width: 100%;
      height: 210px;
      margin-bottom: 16px;
      border-radius: 14px;
      background: #f1f5f9;
      display: grid;
      place-items: center;
      font-size: 48px;
      overflow: hidden;
    }

    .product-image img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      transition: transform 0.3s ease;
    }

    .product-card:hover .product-image img {
      transform: scale(1.04);
    }

    .product-card h2 {
      margin: 0 0 8px;
      font-size: 17px;
      font-weight: 700;
      color: var(--text-main);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .price {
      margin: 0 0 6px;
      color: var(--primary);
      font-size: 20px;
      font-weight: 800;
    }

    .stock {
      margin: 0 0 14px;
      color: var(--text-muted);
      font-size: 13px;
    }

    /* 卡片內數量調控與按鈕區 */
    .card-actions-wrapper {
      margin-top: auto;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .card-qty-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #f8fafc;
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 6px 12px;
    }

    .card-qty-label {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-muted);
    }

    .card-qty-controls {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .card-qty-btn {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      border: 1px solid var(--border-color);
      background: #fff;
      color: var(--text-main);
      font-weight: 700;
      font-size: 14px;
      cursor: pointer;
      display: grid;
      place-items: center;
      transition: background 0.2s, border-color 0.2s;
    }

    .card-qty-btn:hover:not(:disabled) {
      background: #f1f5f9;
      border-color: var(--primary);
      color: var(--primary);
    }

    .card-qty-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .card-qty-val {
      font-weight: 700;
      font-size: 14px;
      min-width: 20px;
      text-align: center;
    }

    .product-card button.add-cart-btn {
      width: 100%;
      padding: 12px 16px;
      border: 0;
      border-radius: 12px;
      background: var(--primary);
      color: #fff;
      cursor: pointer;
      font: inherit;
      font-weight: 600;
      font-size: 14px;
      transition: background 0.2s, transform 0.1s;
      box-shadow: 0 4px 12px rgba(49, 91, 214, 0.2);
    }

    .product-card button.add-cart-btn:hover {
      background: var(--primary-hover);
    }

    .product-card button.add-cart-btn:active {
      transform: scale(0.98);
    }

    /* 購物車彈跳視窗 (Dialog) */
    dialog {
      width: min(520px, calc(100% - 32px));
      max-height: 85vh;
      padding: 32px;
      border: 0;
      border-radius: 24px;
      color: var(--text-main);
      box-shadow: 0 25px 60px rgba(30, 41, 59, 0.25);
      background: #fff;
    }

    dialog::backdrop {
      background: rgba(15, 23, 42, 0.6);
      backdrop-filter: blur(4px);
    }

    .cart-dialog-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 20px;
    }

    .cart-dialog-header h2 {
      margin: 0;
      font-size: 24px;
      font-weight: 800;
    }

    .cart-header-actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .cart-clear-button {
      padding: 6px 12px;
      background: #fef2f2;
      color: #dc2626;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }

    .cart-clear-button:hover {
      background: #fee2e2;
    }

    .cart-close-button {
      padding: 6px 14px;
      background: #f1f5f9;
      color: var(--text-main);
      border-radius: 8px;
      border: none;
      cursor: pointer;
      font-weight: 600;
      font-size: 13px;
      transition: background 0.2s;
    }

    .cart-close-button:hover {
      background: #e2e8f0;
    }

    dialog label {
      display: block;
      margin-bottom: 6px;
      font-weight: 700;
      font-size: 14px;
    }

    dialog input[type="tel"], dialog input[type="text"] {
      width: 100%;
      padding: 12px 16px;
      border: 1px solid var(--border-color);
      border-radius: 12px;
      font: inherit;
      font-size: 15px;
      margin-bottom: 16px;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }

    dialog input[type="tel"]:focus, dialog input[type="text"]:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 3px rgba(49, 91, 214, 0.1);
    }

    .promo-row {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
    }

    .promo-row input {
      margin-bottom: 0 !important;
    }

    .promo-btn {
      padding: 0 16px;
      background: #f1f5f9;
      color: var(--text-main);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.2s;
    }

    .promo-btn:hover {
      background: #e2e8f0;
    }

    .promo-message {
      font-size: 13px;
      margin: -10px 0 16px;
      font-weight: 600;
    }

    .promo-message.success {
      color: var(--success);
    }

    .promo-message.error {
      color: #dc2626;
    }

    .cart-items {
      display: grid;
      gap: 16px;
      max-height: 32vh;
      margin: 0 0 16px;
      padding: 0;
      overflow-y: auto;
      list-style: none;
    }

    .cart-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding-bottom: 14px;
      border-bottom: 1px solid var(--border-color);
    }

    .cart-item-details {
      min-width: 0;
      flex: 1;
    }

    .cart-item-name {
      display: block;
      font-weight: 700;
      font-size: 15px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-bottom: 2px;
    }

    .cart-item-price {
      color: var(--text-muted);
      font-size: 13px;
    }

    .cart-item-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }

    .cart-quantity-button {
      min-width: 32px;
      height: 32px;
      padding: 0;
      display: grid;
      place-items: center;
      background: #f1f5f9;
      color: var(--text-main);
      border-radius: 8px;
      border: none;
      font-weight: 700;
      cursor: pointer;
      transition: background 0.2s;
    }

    .cart-quantity-button:hover:not(:disabled) {
      background: #e2e8f0;
    }

    .cart-quantity-button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .cart-remove-button {
      padding: 6px 10px;
      background: #fef2f2;
      color: #dc2626;
      border: none;
      border-radius: 8px;
      font-weight: 600;
      font-size: 12px;
      cursor: pointer;
      transition: background 0.2s;
    }

    .cart-remove-button:hover {
      background: #fee2e2;
    }

    .cart-summary {
      margin: 16px 0;
      border-top: 1px solid var(--border-color);
      padding-top: 12px;
    }

    .cart-summary-row {
      display: flex;
      justify-content: space-between;
      font-size: 14px;
      color: var(--text-muted);
      margin-bottom: 6px;
    }

    .cart-total {
      margin: 0;
      text-align: right;
      font-size: 20px;
      font-weight: 800;
      color: var(--text-main);
    }

    .checkout-button {
      width: 100%;
      padding: 14px;
      border: 0;
      border-radius: 14px;
      background: var(--primary);
      color: #fff;
      cursor: pointer;
      font: inherit;
      font-weight: 700;
      font-size: 16px;
      transition: background 0.2s, transform 0.1s;
      box-shadow: 0 4px 14px rgba(49, 91, 214, 0.3);
    }

    .checkout-button:hover {
      background: var(--primary-hover);
    }

    .checkout-button:disabled {
      cursor: wait;
      opacity: 0.65;
      box-shadow: none;
    }

    .checkout-status {
      margin: 12px 0 0;
      color: var(--primary);
      font-size: 14px;
      text-align: center;
      font-weight: 600;
    }

    /* 浮動提示 Toast */
    .toast {
      position: fixed;
      bottom: 28px;
      right: 28px;
      background: #1e293b;
      color: #fff;
      padding: 14px 22px;
      border-radius: 14px;
      box-shadow: 0 15px 35px rgba(0,0,0,0.25);
      z-index: 1000;
      opacity: 0;
      transform: translateY(12px);
      transition: opacity 0.3s ease, transform 0.3s ease;
      pointer-events: none;
      font-weight: 600;
      font-size: 14px;
    }

    .toast.show {
      opacity: 1;
      transform: translateY(0);
    }

    /* 頁尾 Footer */
    footer {
      background: #ffffff;
      border-top: 1px solid var(--border-color);
      padding: 30px 24px;
      text-align: center;
      color: var(--text-muted);
      font-size: 14px;
      margin-top: 60px;
    }

    footer p {
      margin: 0;
    }
  </style>
</head>
<body>
  <!-- 頂部公告欄 -->
  <div class="announcement-bar">
    🎉 歡迎來到 LittlePlanet 星球網店！輸入優惠碼 <b>PLANET9</b> 享 9 折優惠 🚀
  </div>

  <header>
    <div class="nav-container">
      <a href="/" class="brand">🪐 LittlePlanet</a>
      <nav class="navbar" aria-label="主要導覽">
        <a href="/track.html">查詢訂單</a>
        <button class="cart-button" id="cartButton" type="button">
          🛒 購物車（<span id="cartCount" aria-live="polite">0</span>）
        </button>
      </nav>
    </div>
  </header>

  <main>
    <div class="hero-section">
      <h1>星球精選商品</h1>
      <p>探索我們為你精心挑選的優質好物</p>
    </div>

    <!-- 信心保證欄 -->
    <div class="trust-badges" aria-label="信心保證">
      <div class="trust-item">
        <span class="trust-icon" aria-hidden="true">🚀</span>
        <div class="trust-text">
          <h3>極速出貨</h3>
          <p>訂單確認後快速安排</p>
        </div>
      </div>
      <div class="trust-item">
        <span class="trust-icon" aria-hidden="true">🔒</span>
        <div class="trust-text">
          <h3>安全交易</h3>
          <p>嚴密保護個人私隱</p>
        </div>
      </div>
      <div class="trust-item">
        <span class="trust-icon" aria-hidden="true">💯</span>
        <div class="trust-text">
          <h3>品質保證</h3>
          <p>精選優質嚴格把關</p>
        </div>
      </div>
    </div>

    <!-- 快速分類標籤 -->
    <div class="category-tabs" aria-label="商品分類篩選">
      <button class="tab-button active" data-category="all" type="button">全部商品</button>
      <button class="tab-button" data-category="hot" type="button">🔥 熱賣推介</button>
      <button class="tab-button" data-category="in-stock" type="button">📦 現貨供應</button>
    </div>

    <!-- 搜尋與排序工具列 -->
    <div class="store-controls">
      <input type="text" id="searchInput" class="search-input" placeholder="🔍 搜尋商品名稱..." aria-label="搜尋商品">
      <select id="sortSelect" class="sort-select" aria-label="排序方式">
        <option value="default">預設排序</option>
        <option value="price-asc">價格：由低至高</option>
        <option value="price-desc">價格：由高至低</option>
      </select>
    </div>

    <section class="product-grid" aria-label="商品列表" aria-live="polite">
      <div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 40px 0;">正在載入商品…</div>
    </section>
  </main>

  <footer>
    <p>&copy; 2026 LittlePlanet 星球網店. All rights reserved.</p>
  </footer>

  <dialog id="cartDialog" aria-labelledby="cartDialogTitle">
    <div class="cart-dialog-header">
      <h2 id="cartDialogTitle">購物車</h2>
      <div class="cart-header-actions">
        <button class="cart-clear-button" id="clearCartButton" type="button">清空</button>
        <button class="cart-close-button" id="closeCartButton" type="button">關閉</button>
      </div>
    </div>
    <label for="customerPhone">WhatsApp 聯絡電話（用於出貨通知）</label>
    <input
      id="customerPhone"
      name="customer_phone"
      type="tel"
      inputmode="tel"
      autocomplete="tel"
      pattern="\+?[0-9]{8,15}"
      maxlength="16"
      placeholder="例如：91234567"
      required
    >

    <label for="promoCodeInput">優惠碼</label>
    <div class="promo-row">
      <input id="promoCodeInput" type="text" placeholder="例如：PLANET9" autocomplete="off">
      <button id="applyPromoButton" class="promo-btn" type="button">套用</button>
    </div>
    <div id="promoMessage" class="promo-message" role="status" aria-live="polite"></div>

    <ul class="cart-items" id="cartItems"></ul>

    <div class="cart-summary">
      <div class="cart-summary-row" id="subtotalRow" style="display: none;">
        <span>商品小計：</span>
        <span id="cartSubtotal">$0.00</span>
      </div>
      <div class="cart-summary-row" id="discountRow" style="display: none; color: var(--success);">
        <span>優惠折扣：</span>
        <span id="cartDiscount">-$0.00</span>
      </div>
      <p class="cart-total" id="cartTotal">總金額：$0.00</p>
    </div>

    <button class="checkout-button" id="checkoutButton" type="button">確認結帳</button>
    <p class="checkout-status" id="checkoutStatus" role="status" aria-live="polite"></p>
  </dialog>

  <!-- 提示 Toast -->
  <div class="toast" id="toastNotification" role="status" aria-live="polite">已成功加入購物車</div>

  <script>
    const cart = [];
    let allProducts = [];
    let currentCategory = 'all';
    let discountRate = 0; // 0 表示無折扣，0.1 代表 9 折（折減 10%）
    let appliedPromoCode = '';

    function showToast(message) {
      const toast = document.querySelector('#toastNotification');
      toast.textContent = message;
      toast.classList.add('show');
      setTimeout(() => {
        toast.classList.remove('show');
      }, 2000);
    }

    function updateCartCount() {
      const itemCount = cart.reduce((count, item) => count + item.quantity, 0);
      document.querySelector('#cartCount').textContent = String(itemCount);
    }

    function changeCartQuantity(productId, change) {
      const cartItem = cart.find(item => String(item.product.id) === String(productId));
      if (!cartItem) {
        return;
      }

      const nextQuantity = cartItem.quantity + change;
      if (nextQuantity < 1) {
        return;
      }

      cartItem.quantity = nextQuantity;
      updateCartCount();
      renderCart();
    }

    function removeFromCart(productId) {
      const itemIndex = cart.findIndex(item => String(item.product.id) === String(productId));
      if (itemIndex === -1) {
        return;
      }

      cart.splice(itemIndex, 1);
      updateCartCount();
      renderCart();
    }

    function clearCart() {
      if (cart.length === 0) return;
      if (confirm('確定要清空購物車嗎？')) {
        cart.length = 0;
        discountRate = 0;
        appliedPromoCode = '';
        document.querySelector('#promoCodeInput').value = '';
        document.querySelector('#promoMessage').textContent = '';
        updateCartCount();
        renderCart();
        showToast('已清空購物車');
      }
    }

    function renderCart() {
      const cartItems = document.querySelector('#cartItems');
      const cartTotal = document.querySelector('#cartTotal');
      const cartSubtotal = document.querySelector('#cartSubtotal');
      const cartDiscount = document.querySelector('#cartDiscount');
      const subtotalRow = document.querySelector('#subtotalRow');
      const discountRow = document.querySelector('#discountRow');

      const subtotal = cart.reduce((sum, product) => {
        const price = Number(product.product.price);
        return sum + (Number.isFinite(price) ? price * product.quantity : 0);
      }, 0);

      const discountAmount = subtotal * discountRate;
      const total = Math.max(0, subtotal - discountAmount);

      if (cart.length === 0) {
        const emptyItem = document.createElement('li');
        emptyItem.textContent = '購物車目前沒有商品。';
        emptyItem.style.textAlign = 'center';
        emptyItem.style.color = 'var(--text-muted)';
        emptyItem.style.padding = '20px 0';
        cartItems.replaceChildren(emptyItem);
        subtotalRow.style.display = 'none';
        discountRow.style.display = 'none';
      } else {
        const items = cart.map(cartItem => {
          const product = cartItem.product;
          const item = document.createElement('li');
          item.className = 'cart-item';

          const details = document.createElement('div');
          details.className = 'cart-item-details';

          const name = document.createElement('span');
          name.className = 'cart-item-name';
          name.textContent = String(product.name || '未命名商品');

          const price = document.createElement('span');
          price.className = 'cart-item-price';
          const numericPrice = Number(product.price);
          price.textContent = Number.isFinite(numericPrice)
            ? `$${numericPrice.toFixed(2)} × ${cartItem.quantity}`
            : '價格未提供';

          details.append(name, price);

          const actions = document.createElement('div');
          actions.className = 'cart-item-actions';

          const decreaseButton = document.createElement('button');
          decreaseButton.className = 'cart-quantity-button';
          decreaseButton.type = 'button';
          decreaseButton.textContent = '−';
          decreaseButton.setAttribute('aria-label', `減少${String(product.name || '商品')}數量`);
          decreaseButton.disabled = cartItem.quantity <= 1;
          decreaseButton.addEventListener('click', () => {
            changeCartQuantity(product.id, -1);
          });

          const quantity = document.createElement('span');
          quantity.textContent = String(cartItem.quantity);
          quantity.style.fontWeight = '700';
          quantity.style.minWidth = '24px';
          quantity.style.textAlign = 'center';

          const increaseButton = document.createElement('button');
          increaseButton.className = 'cart-quantity-button';
          increaseButton.type = 'button';
          increaseButton.textContent = '+';
          increaseButton.setAttribute('aria-label', `增加${String(product.name || '商品')}數量`);
          increaseButton.addEventListener('click', () => {
            changeCartQuantity(product.id, 1);
          });

          const removeButton = document.createElement('button');
          removeButton.className = 'cart-remove-button';
          removeButton.type = 'button';
          removeButton.textContent = '刪除';
          removeButton.addEventListener('click', () => {
            removeFromCart(product.id);
          });

          actions.append(decreaseButton, quantity, increaseButton, removeButton);
          item.append(details, actions);
          return item;
        });
        cartItems.replaceChildren(...items);

        if (discountRate > 0) {
          subtotalRow.style.display = 'flex';
          discountRow.style.display = 'flex';
          cartSubtotal.textContent = `$${subtotal.toFixed(2)}`;
          cartDiscount.textContent = `-$${discountAmount.toFixed(2)}`;
        } else {
          subtotalRow.style.display = 'none';
          discountRow.style.display = 'none';
        }
      }

      cartTotal.textContent = `總金額：$${total.toFixed(2)}`;
    }

    function createProductCard(product) {
      const card = document.createElement('article');
      card.className = 'product-card';

      if (product.stock > 0 && product.stock <= 5) {
        const badge = document.createElement('div');
        badge.className = 'product-badge';
        badge.textContent = '火熱搶購';
        card.append(badge);
      }

      const image = document.createElement('div');
      image.className = 'product-image';

      if (typeof product.image_url === 'string' && product.image_url.trim()) {
        try {
          const imageUrl = new URL(product.image_url, window.location.origin);
          if (imageUrl.protocol === 'http:' || imageUrl.protocol === 'https:') {
            const imageElement = document.createElement('img');
            imageElement.src = imageUrl.href;
            imageElement.alt = String(product.name || '商品圖片');
            imageElement.onerror = () => {
              image.textContent = '🪐';
            };
            image.append(imageElement);
          } else {
            image.textContent = '🪐';
          }
        } catch (error) {
          console.error('商品圖片網址無效：', error);
          image.textContent = '🪐';
        }
      } else {
        image.textContent = '🪐';
      }
      image.setAttribute('aria-hidden', 'true');

      const title = document.createElement('h2');
      title.textContent = String(product.name || '未命名商品');

      const price = document.createElement('p');
      const numericPrice = Number(product.price);
      price.className = 'price';
      price.textContent = Number.isFinite(numericPrice)
        ? `$${numericPrice}`
        : '價格未提供';

      const stock = document.createElement('p');
      stock.className = 'stock';
      stock.textContent = product.stock == null
        ? '庫存未提供'
        : `庫存 ${String(product.stock)} 件`;

      const actionsWrapper = document.createElement('div');
      actionsWrapper.className = 'card-actions-wrapper';

      let selectedQty = 1;

      const qtyRow = document.createElement('div');
      qtyRow.className = 'card-qty-row';

      const qtyLabel = document.createElement('span');
      qtyLabel.className = 'card-qty-label';
      qtyLabel.textContent = '購買數量';

      const qtyControls = document.createElement('div');
      qtyControls.className = 'card-qty-controls';

      const decBtn = document.createElement('button');
      decBtn.className = 'card-qty-btn';
      decBtn.type = 'button';
      decBtn.textContent = '−';
      decBtn.disabled = true;

      const qtyVal = document.createElement('span');
      qtyVal.className = 'card-qty-val';
      qtyVal.textContent = '1';

      const incBtn = document.createElement('button');
      incBtn.className = 'card-qty-btn';
      incBtn.type = 'button';
      incBtn.textContent = '+';

      decBtn.addEventListener('click', () => {
        if (selectedQty > 1) {
          selectedQty -= 1;
          qtyVal.textContent = String(selectedQty);
          decBtn.disabled = selectedQty <= 1;
        }
      });

      incBtn.addEventListener('click', () => {
        if (product.stock != null && selectedQty >= product.stock) {
          alert('已達到庫存上限');
          return;
        }
        selectedQty += 1;
        qtyVal.textContent = String(selectedQty);
        decBtn.disabled = selectedQty <= 1;
      });

      qtyControls.append(decBtn, qtyVal, incBtn);
      qtyRow.append(qtyLabel, qtyControls);

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'add-cart-btn';
      button.textContent = '加入購物車';
      button.addEventListener('click', () => {
        if (product.id == null) {
          console.error('商品缺少資料庫 ID，無法加入購物車。', product);
          alert('商品資料不完整，暫時無法加入購物車。');
          return;
        }

        const cartItem = cart.find(item => String(item.product.id) === String(product.id));
        if (cartItem) {
          cartItem.quantity += selectedQty;
        } else {
          cart.push({ product, quantity: selectedQty });
        }
        updateCartCount();
        showToast(`已將 ${selectedQty} 件「${product.name || '商品'}」加入購物車`);

        selectedQty = 1;
        qtyVal.textContent = '1';
        decBtn.disabled = true;
      });

      actionsWrapper.append(qtyRow, button);
      card.append(image, title, price, stock, actionsWrapper);
      return card;
    }

    function filterAndRenderProducts() {
      const productGrid = document.querySelector('.product-grid');
      const searchQuery = document.querySelector('#searchInput').value.trim().toLowerCase();
      const sortValue = document.querySelector('#sortSelect').value;

      let filtered = allProducts.filter(product => {
        const name = String(product.name || '').toLowerCase();
        const matchesSearch = name.includes(searchQuery);

        if (currentCategory === 'hot') {
          return matchesSearch && (product.stock > 0 && product.stock <= 5);
        } else if (currentCategory === 'in-stock') {
          return matchesSearch && (product.stock > 0);
        }
        return matchesSearch;
      });

      if (sortValue === 'price-asc') {
        filtered.sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
      } else if (sortValue === 'price-desc') {
        filtered.sort((a, b) => Number(b.price || 0) - Number(a.price || 0));
      }

      if (filtered.length === 0) {
        productGrid.textContent = '找不到符合條件的商品。';
        productGrid.style.textAlign = 'center';
        productGrid.style.gridColumn = '1 / -1';
        productGrid.style.color = 'var(--text-muted)';
        productGrid.style.padding = '40px 0';
        return;
      }

      productGrid.style.textAlign = '';
      productGrid.style.gridColumn = '';
      productGrid.style.color = '';
      productGrid.style.padding = '';

      const cards = filtered.map(createProductCard);
      productGrid.replaceChildren(...cards);
    }

    document.addEventListener('DOMContentLoaded', async () => {
      const productGrid = document.querySelector('.product-grid');
      const cartDialog = document.querySelector('#cartDialog');
      const searchInput = document.querySelector('#searchInput');
      const sortSelect = document.querySelector('#sortSelect');
      const tabButtons = document.querySelectorAll('.tab-button');
      const applyPromoButton = document.querySelector('#applyPromoButton');
      const promoCodeInput = document.querySelector('#promoCodeInput');
      const promoMessage = document.querySelector('#promoMessage');

      searchInput.addEventListener('input', filterAndRenderProducts);
      sortSelect.addEventListener('change', filterAndRenderProducts);

      tabButtons.forEach(button => {
        button.addEventListener('click', event => {
          tabButtons.forEach(btn => btn.classList.remove('active'));
          event.currentTarget.classList.add('active');
          currentCategory = event.currentTarget.getAttribute('data-category');
          filterAndRenderProducts();
        });
      });

      applyPromoButton.addEventListener('click', () => {
        const code = promoCodeInput.value.trim().toUpperCase();
        if (code === 'PLANET9') {
          discountRate = 0.1;
          appliedPromoCode = code;
          promoMessage.textContent = '🎉 優惠碼套用成功！已享 9 折優惠';
          promoMessage.className = 'promo-message success';
          renderCart();
        } else if (code === '') {
          discountRate = 0;
          appliedPromoCode = '';
          promoMessage.textContent = '';
          renderCart();
        } else {
          discountRate = 0;
          appliedPromoCode = '';
          promoMessage.textContent = '❌ 無效的優惠碼';
          promoMessage.className = 'promo-message error';
          renderCart();
        }
      });

      document.querySelector('#cartButton').addEventListener('click', () => {
        renderCart();
        cartDialog.showModal();
      });

      document.querySelector('#closeCartButton').addEventListener('click', () => {
        cartDialog.close();
      });

      document.querySelector('#clearCartButton').addEventListener('click', clearCart);

      document.querySelector('#checkoutButton').addEventListener('click', async event => {
        if (cart.length === 0) {
          alert('購物車目前沒有商品。');
          return;
        }

        const customerPhoneInput = document.querySelector('#customerPhone');
        const checkoutStatus = document.querySelector('#checkoutStatus');
        const customerPhone = customerPhoneInput.value.trim();
        if (!/^\+?\d{8,15}$/.test(customerPhone)) {
          customerPhoneInput.focus();
          checkoutStatus.textContent = '請輸入有效 WhatsApp 聯絡電話（8 至 15 位數字，可選擇以 + 開頭）。';
          return;
        }

        const checkoutButton = event.currentTarget;
        checkoutButton.disabled = true;
        checkoutButton.textContent = '處理中';
        checkoutStatus.textContent = '正在確認商品庫存並建立訂單…';

        try {
          const response = await fetch('/api/orders', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              customer_phone: customerPhone,
              promo_code: appliedPromoCode || undefined,
              items: cart.map(item => ({
                product_id: item.product.id,
                quantity: item.quantity
              }))
            })
          });

          const result = await response.json();
          if (
            !response.ok ||
            !result ||
            result.success !== true ||
            !result.data ||
            typeof result.data.order_id !== 'string'
          ) {
            throw new Error(result && (result.message || result.error)
              ? (result.message || result.error)
              : `結帳失敗，HTTP 狀態碼：${response.status}`);
          }

          cart.length = 0;
          discountRate = 0;
          appliedPromoCode = '';
          customerPhoneInput.value = '';
          promoCodeInput.value = '';
          promoMessage.textContent = '';
          updateCartCount();
          renderCart();
          cartDialog.close();
          checkoutStatus.textContent = '';
          const trackingUrl = `/track.html?order_id=${encodeURIComponent(result.data.order_id)}`;
          const orderMessage = `訂單建立成功：${result.data.order_id}`;
          alert(orderMessage);
          window.location.assign(trackingUrl);
        } catch (error) {
          console.error('結帳時發生錯誤：', error);
          checkoutStatus.textContent = error.message || '結帳失敗，請稍後再試。';
        } finally {
          checkoutButton.disabled = false;
          checkoutButton.textContent = '確認結帳';
        }
      });

      try {
        const response = await fetch('/api/products');
        if (!response.ok) {
          throw new Error(`商品讀取失敗，HTTP 狀態碼：${response.status}`);
        }

        const result = await response.json();
        if (!result || result.success !== true || !Array.isArray(result.data)) {
          throw new Error('商品 API 回傳格式無效。');
        }

        if (!result.data.every(product => product && typeof product === 'object')) {
          throw new Error('商品 API 包含無效的商品資料。');
        }

        if (result.data.length === 0) {
          productGrid.textContent = '目前沒有商品。';
          return;
        }

        allProducts = result.data;
        filterAndRenderProducts();
      } catch (error) {
        console.error('載入商品時發生錯誤：', error);
        productGrid.textContent = '商品載入失敗，請稍後再試。';
        alert('讀取商品失敗，請稍後再試。');
      }
    });
  </script>
</body>
</html>
```

---

### File: `public\track.html`

```
<!DOCTYPE html>
<html lang="zh-HK">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>查詢訂單 | LittlePlanet</title>
  <style>
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      padding: 40px 20px;
      background: #f5f7fb;
      color: #243047;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    main {
      width: min(760px, 100%);
      margin: 0 auto;
    }

    .panel,
    .order-card {
      margin-top: 20px;
      padding: 24px;
      border-radius: 16px;
      background: #fff;
      box-shadow: 0 8px 24px rgb(36 48 71 / 10%);
    }

    h1 {
      margin-top: 0;
    }

    label,
    select,
    input,
    button {
      display: block;
      width: 100%;
      margin-top: 10px;
      font: inherit;
    }

    input,
    select {
      padding: 10px 12px;
      border: 1px solid #cbd3e1;
      border-radius: 8px;
    }

    button {
      margin-top: 16px;
      padding: 12px 16px;
      border: 0;
      border-radius: 8px;
      background: #315bd6;
      color: #fff;
      cursor: pointer;
      font-weight: 600;
    }

    button:disabled {
      cursor: wait;
      opacity: 0.65;
    }

    .message {
      min-height: 1.5em;
      color: #315bd6;
    }

    .error {
      color: #a52323;
    }

    .order-heading {
      overflow-wrap: anywhere;
    }

    .order-details {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 8px 20px;
    }

    .order-details p {
      margin: 6px 0;
    }

    ul {
      padding-left: 22px;
    }

    li {
      margin: 8px 0;
    }

    a {
      color: #315bd6;
    }
  </style>
</head>
<body>
  <main>
    <p><a href="/">返回商品列表</a></p>
    <section class="panel" aria-labelledby="pageTitle">
      <h1 id="pageTitle">查詢訂單</h1>
      <p>可使用訂單編號或下單時提供的聯絡電話查詢。</p>
      <form id="lookupForm">
        <label for="lookupType">查詢方式</label>
        <select id="lookupType" name="lookup_type">
          <option value="order_id">訂單編號</option>
          <option value="customer_phone">聯絡電話</option>
        </select>
        <label id="lookupValueLabel" for="lookupValue">訂單 UUID</label>
        <input id="lookupValue" name="lookup_value" type="text" autocomplete="off" required>
        <button id="lookupButton" type="submit">查詢</button>
      </form>
      <p id="lookupMessage" class="message" role="status" aria-live="polite"></p>
    </section>
    <section id="lookupResults" aria-live="polite"></section>
  </main>
  <script>
    const form = document.querySelector('#lookupForm');
    const lookupType = document.querySelector('#lookupType');
    const lookupValue = document.querySelector('#lookupValue');
    const lookupValueLabel = document.querySelector('#lookupValueLabel');
    const lookupButton = document.querySelector('#lookupButton');
    const lookupMessage = document.querySelector('#lookupMessage');
    const lookupResults = document.querySelector('#lookupResults');

    function updateLookupInput() {
      const byOrderId = lookupType.value === 'order_id';
      lookupValueLabel.textContent = byOrderId ? '訂單 UUID' : '聯絡電話';
      lookupValue.type = byOrderId ? 'text' : 'tel';
      lookupValue.inputMode = byOrderId ? 'text' : 'tel';
      lookupValue.autocomplete = byOrderId ? 'off' : 'tel';
      lookupValue.placeholder = byOrderId
        ? 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
        : '+85212345678';
    }

    function addDetail(container, label, value) {
      const paragraph = document.createElement('p');
      const strong = document.createElement('strong');
      strong.textContent = `${label}：`;
      paragraph.append(strong, document.createTextNode(String(value)));
      container.append(paragraph);
    }

    function renderOrders(orders) {
      lookupResults.replaceChildren();
      if (orders.length === 0) {
        lookupMessage.textContent = '沒有可顯示的訂單資料，請確認查詢資料後重試。';
        return;
      }

      lookupMessage.textContent = `找到 ${orders.length} 張訂單。`;
      for (const order of orders) {
        const card = document.createElement('article');
        card.className = 'order-card';

        const heading = document.createElement('h2');
        heading.className = 'order-heading';
        heading.textContent = `訂單 ${order.order_id}`;

        const details = document.createElement('div');
        details.className = 'order-details';
        addDetail(details, '訂單狀態', order.shipping_status || '待處理');
        addDetail(details, '付款狀態', order.payment_status || '未知');
        addDetail(details, '訂單金額', order.total_amount == null ? '未提供' : `$${order.total_amount}`);
        addDetail(details, '出貨方式', order.shipping_method || '尚未安排');
        addDetail(details, '運單號碼', order.tracking_number || '尚未提供');
        addDetail(details, 'WhatsApp 出貨通知', notificationLabel(order.whatsapp_notification_status));

        const itemHeading = document.createElement('h3');
        itemHeading.textContent = '商品明細';
        const itemList = document.createElement('ul');
        const items = Array.isArray(order.items) ? order.items : [];
        if (items.length === 0) {
          const emptyItem = document.createElement('li');
          emptyItem.textContent = '沒有商品明細。';
          itemList.append(emptyItem);
        } else {
          for (const item of items) {
            const listItem = document.createElement('li');
            const received = Number.isFinite(Number(item.received_quantity))
              ? Number(item.received_quantity)
              : 0;
            const quantity = Number.isFinite(Number(item.quantity))
              ? Number(item.quantity)
              : 0;
            listItem.textContent = `${item.product_name || '商品'} × ${quantity} — ${item.reconciliation_status || item.item_status || '處理中'}（到貨 ${received}/${quantity}）`;
            itemList.append(listItem);
          }
        }

        card.append(heading, details, itemHeading, itemList);
        lookupResults.append(card);
      }
    }

    function notificationLabel(status) {
      const labels = {
        pending: '等待發送',
        sending: '發送中',
        sent: '已發送',
        failed: '發送失敗，管理員可重試',
        not_created: '尚未建立出貨通知'
      };
      return labels[status] || '狀態未提供';
    }

    lookupType.addEventListener('change', updateLookupInput);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      lookupResults.replaceChildren();
      lookupMessage.classList.remove('error');

      const value = lookupValue.value.trim();
      const payload = lookupType.value === 'order_id'
        ? { order_id: value }
        : { customer_phone: value };
      lookupButton.disabled = true;
      lookupButton.textContent = '查詢中';
      lookupMessage.textContent = '正在安全查詢訂單…';

      try {
        const response = await fetch('/api/customer/orders/lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        let result;
        try {
          result = await response.json();
        } catch (parseError) {
          throw new Error('伺服器回應格式無效，請稍後再試。');
        }

        if (!response.ok || !result || result.success !== true || !Array.isArray(result.data)) {
          throw new Error(result && typeof result.message === 'string'
            ? result.message
            : `查詢失敗，HTTP 狀態碼：${response.status}`);
        }
        renderOrders(result.data);
      } catch (error) {
        console.error('查詢訂單時發生錯誤：', error);
        lookupMessage.classList.add('error');
        lookupMessage.textContent = error.message || '查詢失敗，請稍後再試。';
      } finally {
        lookupButton.disabled = false;
        lookupButton.textContent = '查詢';
      }
    });

    updateLookupInput();
    const initialOrderId = new URLSearchParams(window.location.search).get('order_id');
    if (initialOrderId) {
      lookupValue.value = initialOrderId;
      form.requestSubmit();
    }
  </script>
</body>
</html>

```

---

### File: `public\vendor\chart.umd.min.js`

```
/*!
 * Chart.js v4.5.1
 * https://www.chartjs.org
 * (c) 2025 Chart.js Contributors
 * Released under the MIT License
 */
!function(t,e){"object"==typeof exports&&"undefined"!=typeof module?module.exports=e():"function"==typeof define&&define.amd?define(e):(t="undefined"!=typeof globalThis?globalThis:t||self).Chart=e()}(this,(function(){"use strict";var t=Object.freeze({__proto__:null,get Colors(){return Jo},get Decimation(){return ta},get Filler(){return ba},get Legend(){return Ma},get SubTitle(){return Pa},get Title(){return ka},get Tooltip(){return Na}});function e(){}const i=(()=>{let t=0;return()=>t++})();function s(t){return null==t}function n(t){if(Array.isArray&&Array.isArray(t))return!0;const e=Object.prototype.toString.call(t);return"[object"===e.slice(0,7)&&"Array]"===e.slice(-6)}function o(t){return null!==t&&"[object Object]"===Object.prototype.toString.call(t)}function a(t){return("number"==typeof t||t instanceof Number)&&isFinite(+t)}function r(t,e){return a(t)?t:e}function l(t,e){return void 0===t?e:t}const h=(t,e)=>"string"==typeof t&&t.endsWith("%")?parseFloat(t)/100:+t/e,c=(t,e)=>"string"==typeof t&&t.endsWith("%")?parseFloat(t)/100*e:+t;function d(t,e,i){if(t&&"function"==typeof t.call)return t.apply(i,e)}function u(t,e,i,s){let a,r,l;if(n(t))if(r=t.length,s)for(a=r-1;a>=0;a--)e.call(i,t[a],a);else for(a=0;a<r;a++)e.call(i,t[a],a);else if(o(t))for(l=Object.keys(t),r=l.length,a=0;a<r;a++)e.call(i,t[l[a]],l[a])}function f(t,e){let i,s,n,o;if(!t||!e||t.length!==e.length)return!1;for(i=0,s=t.length;i<s;++i)if(n=t[i],o=e[i],n.datasetIndex!==o.datasetIndex||n.index!==o.index)return!1;return!0}function g(t){if(n(t))return t.map(g);if(o(t)){const e=Object.create(null),i=Object.keys(t),s=i.length;let n=0;for(;n<s;++n)e[i[n]]=g(t[i[n]]);return e}return t}function p(t){return-1===["__proto__","prototype","constructor"].indexOf(t)}function m(t,e,i,s){if(!p(t))return;const n=e[t],a=i[t];o(n)&&o(a)?x(n,a,s):e[t]=g(a)}function x(t,e,i){const s=n(e)?e:[e],a=s.length;if(!o(t))return t;const r=(i=i||{}).merger||m;let l;for(let e=0;e<a;++e){if(l=s[e],!o(l))continue;const n=Object.keys(l);for(let e=0,s=n.length;e<s;++e)r(n[e],t,l,i)}return t}function b(t,e){return x(t,e,{merger:_})}function _(t,e,i){if(!p(t))return;const s=e[t],n=i[t];o(s)&&o(n)?b(s,n):Object.prototype.hasOwnProperty.call(e,t)||(e[t]=g(n))}const y={"":t=>t,x:t=>t.x,y:t=>t.y};function v(t){const e=t.split("."),i=[];let s="";for(const t of e)s+=t,s.endsWith("\\")?s=s.slice(0,-1)+".":(i.push(s),s="");return i}function M(t,e){const i=y[e]||(y[e]=function(t){const e=v(t);return t=>{for(const i of e){if(""===i)break;t=t&&t[i]}return t}}(e));return i(t)}function w(t){return t.charAt(0).toUpperCase()+t.slice(1)}const k=t=>void 0!==t,S=t=>"function"==typeof t,P=(t,e)=>{if(t.size!==e.size)return!1;for(const i of t)if(!e.has(i))return!1;return!0};function D(t){return"mouseup"===t.type||"click"===t.type||"contextmenu"===t.type}const C=Math.PI,O=2*C,A=O+C,T=Number.POSITIVE_INFINITY,L=C/180,E=C/2,R=C/4,I=2*C/3,z=Math.log10,F=Math.sign;function V(t,e,i){return Math.abs(t-e)<i}function B(t){const e=Math.round(t);t=V(t,e,t/1e3)?e:t;const i=Math.pow(10,Math.floor(z(t))),s=t/i;return(s<=1?1:s<=2?2:s<=5?5:10)*i}function W(t){const e=[],i=Math.sqrt(t);let s;for(s=1;s<i;s++)t%s==0&&(e.push(s),e.push(t/s));return i===(0|i)&&e.push(i),e.sort(((t,e)=>t-e)).pop(),e}function N(t){return!function(t){return"symbol"==typeof t||"object"==typeof t&&null!==t&&!(Symbol.toPrimitive in t||"toString"in t||"valueOf"in t)}(t)&&!isNaN(parseFloat(t))&&isFinite(t)}function H(t,e){const i=Math.round(t);return i-e<=t&&i+e>=t}function j(t,e,i){let s,n,o;for(s=0,n=t.length;s<n;s++)o=t[s][i],isNaN(o)||(e.min=Math.min(e.min,o),e.max=Math.max(e.max,o))}function $(t){return t*(C/180)}function Y(t){return t*(180/C)}function U(t){if(!a(t))return;let e=1,i=0;for(;Math.round(t*e)/e!==t;)e*=10,i++;return i}function X(t,e){const i=e.x-t.x,s=e.y-t.y,n=Math.sqrt(i*i+s*s);let o=Math.atan2(s,i);return o<-.5*C&&(o+=O),{angle:o,distance:n}}function q(t,e){return Math.sqrt(Math.pow(e.x-t.x,2)+Math.pow(e.y-t.y,2))}function K(t,e){return(t-e+A)%O-C}function G(t){return(t%O+O)%O}function J(t,e,i,s){const n=G(t),o=G(e),a=G(i),r=G(o-n),l=G(a-n),h=G(n-o),c=G(n-a);return n===o||n===a||s&&o===a||r>l&&h<c}function Z(t,e,i){return Math.max(e,Math.min(i,t))}function Q(t){return Z(t,-32768,32767)}function tt(t,e,i,s=1e-6){return t>=Math.min(e,i)-s&&t<=Math.max(e,i)+s}function et(t,e,i){i=i||(i=>t[i]<e);let s,n=t.length-1,o=0;for(;n-o>1;)s=o+n>>1,i(s)?o=s:n=s;return{lo:o,hi:n}}const it=(t,e,i,s)=>et(t,i,s?s=>{const n=t[s][e];return n<i||n===i&&t[s+1][e]===i}:s=>t[s][e]<i),st=(t,e,i)=>et(t,i,(s=>t[s][e]>=i));function nt(t,e,i){let s=0,n=t.length;for(;s<n&&t[s]<e;)s++;for(;n>s&&t[n-1]>i;)n--;return s>0||n<t.length?t.slice(s,n):t}const ot=["push","pop","shift","splice","unshift"];function at(t,e){t._chartjs?t._chartjs.listeners.push(e):(Object.defineProperty(t,"_chartjs",{configurable:!0,enumerable:!1,value:{listeners:[e]}}),ot.forEach((e=>{const i="_onData"+w(e),s=t[e];Object.defineProperty(t,e,{configurable:!0,enumerable:!1,value(...e){const n=s.apply(this,e);return t._chartjs.listeners.forEach((t=>{"function"==typeof t[i]&&t[i](...e)})),n}})})))}function rt(t,e){const i=t._chartjs;if(!i)return;const s=i.listeners,n=s.indexOf(e);-1!==n&&s.splice(n,1),s.length>0||(ot.forEach((e=>{delete t[e]})),delete t._chartjs)}function lt(t){const e=new Set(t);return e.size===t.length?t:Array.from(e)}const ht="undefined"==typeof window?function(t){return t()}:window.requestAnimationFrame;function ct(t,e){let i=[],s=!1;return function(...n){i=n,s||(s=!0,ht.call(window,(()=>{s=!1,t.apply(e,i)})))}}function dt(t,e){let i;return function(...s){return e?(clearTimeout(i),i=setTimeout(t,e,s)):t.apply(this,s),e}}const ut=t=>"start"===t?"left":"end"===t?"right":"center",ft=(t,e,i)=>"start"===t?e:"end"===t?i:(e+i)/2,gt=(t,e,i,s)=>t===(s?"left":"right")?i:"center"===t?(e+i)/2:e;function pt(t,e,i){const n=e.length;let o=0,a=n;if(t._sorted){const{iScale:r,vScale:l,_parsed:h}=t,c=t.dataset&&t.dataset.options?t.dataset.options.spanGaps:null,d=r.axis,{min:u,max:f,minDefined:g,maxDefined:p}=r.getUserBounds();if(g){if(o=Math.min(it(h,d,u).lo,i?n:it(e,d,r.getPixelForValue(u)).lo),c){const t=h.slice(0,o+1).reverse().findIndex((t=>!s(t[l.axis])));o-=Math.max(0,t)}o=Z(o,0,n-1)}if(p){let t=Math.max(it(h,r.axis,f,!0).hi+1,i?0:it(e,d,r.getPixelForValue(f),!0).hi+1);if(c){const e=h.slice(t-1).findIndex((t=>!s(t[l.axis])));t+=Math.max(0,e)}a=Z(t,o,n)-o}else a=n-o}return{start:o,count:a}}function mt(t){const{xScale:e,yScale:i,_scaleRanges:s}=t,n={xmin:e.min,xmax:e.max,ymin:i.min,ymax:i.max};if(!s)return t._scaleRanges=n,!0;const o=s.xmin!==e.min||s.xmax!==e.max||s.ymin!==i.min||s.ymax!==i.max;return Object.assign(s,n),o}class xt{constructor(){this._request=null,this._charts=new Map,this._running=!1,this._lastDate=void 0}_notify(t,e,i,s){const n=e.listeners[s],o=e.duration;n.forEach((s=>s({chart:t,initial:e.initial,numSteps:o,currentStep:Math.min(i-e.start,o)})))}_refresh(){this._request||(this._running=!0,this._request=ht.call(window,(()=>{this._update(),this._request=null,this._running&&this._refresh()})))}_update(t=Date.now()){let e=0;this._charts.forEach(((i,s)=>{if(!i.running||!i.items.length)return;const n=i.items;let o,a=n.length-1,r=!1;for(;a>=0;--a)o=n[a],o._active?(o._total>i.duration&&(i.duration=o._total),o.tick(t),r=!0):(n[a]=n[n.length-1],n.pop());r&&(s.draw(),this._notify(s,i,t,"progress")),n.length||(i.running=!1,this._notify(s,i,t,"complete"),i.initial=!1),e+=n.length})),this._lastDate=t,0===e&&(this._running=!1)}_getAnims(t){const e=this._charts;let i=e.get(t);return i||(i={running:!1,initial:!0,items:[],listeners:{complete:[],progress:[]}},e.set(t,i)),i}listen(t,e,i){this._getAnims(t).listeners[e].push(i)}add(t,e){e&&e.length&&this._getAnims(t).items.push(...e)}has(t){return this._getAnims(t).items.length>0}start(t){const e=this._charts.get(t);e&&(e.running=!0,e.start=Date.now(),e.duration=e.items.reduce(((t,e)=>Math.max(t,e._duration)),0),this._refresh())}running(t){if(!this._running)return!1;const e=this._charts.get(t);return!!(e&&e.running&&e.items.length)}stop(t){const e=this._charts.get(t);if(!e||!e.items.length)return;const i=e.items;let s=i.length-1;for(;s>=0;--s)i[s].cancel();e.items=[],this._notify(t,e,Date.now(),"complete")}remove(t){return this._charts.delete(t)}}var bt=new xt;
/*!
 * @kurkle/color v0.3.2
 * https://github.com/kurkle/color#readme
 * (c) 2023 Jukka Kurkela
 * Released under the MIT License
 */function _t(t){return t+.5|0}const yt=(t,e,i)=>Math.max(Math.min(t,i),e);function vt(t){return yt(_t(2.55*t),0,255)}function Mt(t){return yt(_t(255*t),0,255)}function wt(t){return yt(_t(t/2.55)/100,0,1)}function kt(t){return yt(_t(100*t),0,100)}const St={0:0,1:1,2:2,3:3,4:4,5:5,6:6,7:7,8:8,9:9,A:10,B:11,C:12,D:13,E:14,F:15,a:10,b:11,c:12,d:13,e:14,f:15},Pt=[..."0123456789ABCDEF"],Dt=t=>Pt[15&t],Ct=t=>Pt[(240&t)>>4]+Pt[15&t],Ot=t=>(240&t)>>4==(15&t);function At(t){var e=(t=>Ot(t.r)&&Ot(t.g)&&Ot(t.b)&&Ot(t.a))(t)?Dt:Ct;return t?"#"+e(t.r)+e(t.g)+e(t.b)+((t,e)=>t<255?e(t):"")(t.a,e):void 0}const Tt=/^(hsla?|hwb|hsv)\(\s*([-+.e\d]+)(?:deg)?[\s,]+([-+.e\d]+)%[\s,]+([-+.e\d]+)%(?:[\s,]+([-+.e\d]+)(%)?)?\s*\)$/;function Lt(t,e,i){const s=e*Math.min(i,1-i),n=(e,n=(e+t/30)%12)=>i-s*Math.max(Math.min(n-3,9-n,1),-1);return[n(0),n(8),n(4)]}function Et(t,e,i){const s=(s,n=(s+t/60)%6)=>i-i*e*Math.max(Math.min(n,4-n,1),0);return[s(5),s(3),s(1)]}function Rt(t,e,i){const s=Lt(t,1,.5);let n;for(e+i>1&&(n=1/(e+i),e*=n,i*=n),n=0;n<3;n++)s[n]*=1-e-i,s[n]+=e;return s}function It(t){const e=t.r/255,i=t.g/255,s=t.b/255,n=Math.max(e,i,s),o=Math.min(e,i,s),a=(n+o)/2;let r,l,h;return n!==o&&(h=n-o,l=a>.5?h/(2-n-o):h/(n+o),r=function(t,e,i,s,n){return t===n?(e-i)/s+(e<i?6:0):e===n?(i-t)/s+2:(t-e)/s+4}(e,i,s,h,n),r=60*r+.5),[0|r,l||0,a]}function zt(t,e,i,s){return(Array.isArray(e)?t(e[0],e[1],e[2]):t(e,i,s)).map(Mt)}function Ft(t,e,i){return zt(Lt,t,e,i)}function Vt(t){return(t%360+360)%360}function Bt(t){const e=Tt.exec(t);let i,s=255;if(!e)return;e[5]!==i&&(s=e[6]?vt(+e[5]):Mt(+e[5]));const n=Vt(+e[2]),o=+e[3]/100,a=+e[4]/100;return i="hwb"===e[1]?function(t,e,i){return zt(Rt,t,e,i)}(n,o,a):"hsv"===e[1]?function(t,e,i){return zt(Et,t,e,i)}(n,o,a):Ft(n,o,a),{r:i[0],g:i[1],b:i[2],a:s}}const Wt={x:"dark",Z:"light",Y:"re",X:"blu",W:"gr",V:"medium",U:"slate",A:"ee",T:"ol",S:"or",B:"ra",C:"lateg",D:"ights",R:"in",Q:"turquois",E:"hi",P:"ro",O:"al",N:"le",M:"de",L:"yello",F:"en",K:"ch",G:"arks",H:"ea",I:"ightg",J:"wh"},Nt={OiceXe:"f0f8ff",antiquewEte:"faebd7",aqua:"ffff",aquamarRe:"7fffd4",azuY:"f0ffff",beige:"f5f5dc",bisque:"ffe4c4",black:"0",blanKedOmond:"ffebcd",Xe:"ff",XeviTet:"8a2be2",bPwn:"a52a2a",burlywood:"deb887",caMtXe:"5f9ea0",KartYuse:"7fff00",KocTate:"d2691e",cSO:"ff7f50",cSnflowerXe:"6495ed",cSnsilk:"fff8dc",crimson:"dc143c",cyan:"ffff",xXe:"8b",xcyan:"8b8b",xgTMnPd:"b8860b",xWay:"a9a9a9",xgYF:"6400",xgYy:"a9a9a9",xkhaki:"bdb76b",xmagFta:"8b008b",xTivegYF:"556b2f",xSange:"ff8c00",xScEd:"9932cc",xYd:"8b0000",xsOmon:"e9967a",xsHgYF:"8fbc8f",xUXe:"483d8b",xUWay:"2f4f4f",xUgYy:"2f4f4f",xQe:"ced1",xviTet:"9400d3",dAppRk:"ff1493",dApskyXe:"bfff",dimWay:"696969",dimgYy:"696969",dodgerXe:"1e90ff",fiYbrick:"b22222",flSOwEte:"fffaf0",foYstWAn:"228b22",fuKsia:"ff00ff",gaRsbSo:"dcdcdc",ghostwEte:"f8f8ff",gTd:"ffd700",gTMnPd:"daa520",Way:"808080",gYF:"8000",gYFLw:"adff2f",gYy:"808080",honeyMw:"f0fff0",hotpRk:"ff69b4",RdianYd:"cd5c5c",Rdigo:"4b0082",ivSy:"fffff0",khaki:"f0e68c",lavFMr:"e6e6fa",lavFMrXsh:"fff0f5",lawngYF:"7cfc00",NmoncEffon:"fffacd",ZXe:"add8e6",ZcSO:"f08080",Zcyan:"e0ffff",ZgTMnPdLw:"fafad2",ZWay:"d3d3d3",ZgYF:"90ee90",ZgYy:"d3d3d3",ZpRk:"ffb6c1",ZsOmon:"ffa07a",ZsHgYF:"20b2aa",ZskyXe:"87cefa",ZUWay:"778899",ZUgYy:"778899",ZstAlXe:"b0c4de",ZLw:"ffffe0",lime:"ff00",limegYF:"32cd32",lRF:"faf0e6",magFta:"ff00ff",maPon:"800000",VaquamarRe:"66cdaa",VXe:"cd",VScEd:"ba55d3",VpurpN:"9370db",VsHgYF:"3cb371",VUXe:"7b68ee",VsprRggYF:"fa9a",VQe:"48d1cc",VviTetYd:"c71585",midnightXe:"191970",mRtcYam:"f5fffa",mistyPse:"ffe4e1",moccasR:"ffe4b5",navajowEte:"ffdead",navy:"80",Tdlace:"fdf5e6",Tive:"808000",TivedBb:"6b8e23",Sange:"ffa500",SangeYd:"ff4500",ScEd:"da70d6",pOegTMnPd:"eee8aa",pOegYF:"98fb98",pOeQe:"afeeee",pOeviTetYd:"db7093",papayawEp:"ffefd5",pHKpuff:"ffdab9",peru:"cd853f",pRk:"ffc0cb",plum:"dda0dd",powMrXe:"b0e0e6",purpN:"800080",YbeccapurpN:"663399",Yd:"ff0000",Psybrown:"bc8f8f",PyOXe:"4169e1",saddNbPwn:"8b4513",sOmon:"fa8072",sandybPwn:"f4a460",sHgYF:"2e8b57",sHshell:"fff5ee",siFna:"a0522d",silver:"c0c0c0",skyXe:"87ceeb",UXe:"6a5acd",UWay:"708090",UgYy:"708090",snow:"fffafa",sprRggYF:"ff7f",stAlXe:"4682b4",tan:"d2b48c",teO:"8080",tEstN:"d8bfd8",tomato:"ff6347",Qe:"40e0d0",viTet:"ee82ee",JHt:"f5deb3",wEte:"ffffff",wEtesmoke:"f5f5f5",Lw:"ffff00",LwgYF:"9acd32"};let Ht;function jt(t){Ht||(Ht=function(){const t={},e=Object.keys(Nt),i=Object.keys(Wt);let s,n,o,a,r;for(s=0;s<e.length;s++){for(a=r=e[s],n=0;n<i.length;n++)o=i[n],r=r.replace(o,Wt[o]);o=parseInt(Nt[a],16),t[r]=[o>>16&255,o>>8&255,255&o]}return t}(),Ht.transparent=[0,0,0,0]);const e=Ht[t.toLowerCase()];return e&&{r:e[0],g:e[1],b:e[2],a:4===e.length?e[3]:255}}const $t=/^rgba?\(\s*([-+.\d]+)(%)?[\s,]+([-+.e\d]+)(%)?[\s,]+([-+.e\d]+)(%)?(?:[\s,/]+([-+.e\d]+)(%)?)?\s*\)$/;const Yt=t=>t<=.0031308?12.92*t:1.055*Math.pow(t,1/2.4)-.055,Ut=t=>t<=.04045?t/12.92:Math.pow((t+.055)/1.055,2.4);function Xt(t,e,i){if(t){let s=It(t);s[e]=Math.max(0,Math.min(s[e]+s[e]*i,0===e?360:1)),s=Ft(s),t.r=s[0],t.g=s[1],t.b=s[2]}}function qt(t,e){return t?Object.assign(e||{},t):t}function Kt(t){var e={r:0,g:0,b:0,a:255};return Array.isArray(t)?t.length>=3&&(e={r:t[0],g:t[1],b:t[2],a:255},t.length>3&&(e.a=Mt(t[3]))):(e=qt(t,{r:0,g:0,b:0,a:1})).a=Mt(e.a),e}function Gt(t){return"r"===t.charAt(0)?function(t){const e=$t.exec(t);let i,s,n,o=255;if(e){if(e[7]!==i){const t=+e[7];o=e[8]?vt(t):yt(255*t,0,255)}return i=+e[1],s=+e[3],n=+e[5],i=255&(e[2]?vt(i):yt(i,0,255)),s=255&(e[4]?vt(s):yt(s,0,255)),n=255&(e[6]?vt(n):yt(n,0,255)),{r:i,g:s,b:n,a:o}}}(t):Bt(t)}class Jt{constructor(t){if(t instanceof Jt)return t;const e=typeof t;let i;var s,n,o;"object"===e?i=Kt(t):"string"===e&&(o=(s=t).length,"#"===s[0]&&(4===o||5===o?n={r:255&17*St[s[1]],g:255&17*St[s[2]],b:255&17*St[s[3]],a:5===o?17*St[s[4]]:255}:7!==o&&9!==o||(n={r:St[s[1]]<<4|St[s[2]],g:St[s[3]]<<4|St[s[4]],b:St[s[5]]<<4|St[s[6]],a:9===o?St[s[7]]<<4|St[s[8]]:255})),i=n||jt(t)||Gt(t)),this._rgb=i,this._valid=!!i}get valid(){return this._valid}get rgb(){var t=qt(this._rgb);return t&&(t.a=wt(t.a)),t}set rgb(t){this._rgb=Kt(t)}rgbString(){return this._valid?(t=this._rgb)&&(t.a<255?`rgba(${t.r}, ${t.g}, ${t.b}, ${wt(t.a)})`:`rgb(${t.r}, ${t.g}, ${t.b})`):void 0;var t}hexString(){return this._valid?At(this._rgb):void 0}hslString(){return this._valid?function(t){if(!t)return;const e=It(t),i=e[0],s=kt(e[1]),n=kt(e[2]);return t.a<255?`hsla(${i}, ${s}%, ${n}%, ${wt(t.a)})`:`hsl(${i}, ${s}%, ${n}%)`}(this._rgb):void 0}mix(t,e){if(t){const i=this.rgb,s=t.rgb;let n;const o=e===n?.5:e,a=2*o-1,r=i.a-s.a,l=((a*r==-1?a:(a+r)/(1+a*r))+1)/2;n=1-l,i.r=255&l*i.r+n*s.r+.5,i.g=255&l*i.g+n*s.g+.5,i.b=255&l*i.b+n*s.b+.5,i.a=o*i.a+(1-o)*s.a,this.rgb=i}return this}interpolate(t,e){return t&&(this._rgb=function(t,e,i){const s=Ut(wt(t.r)),n=Ut(wt(t.g)),o=Ut(wt(t.b));return{r:Mt(Yt(s+i*(Ut(wt(e.r))-s))),g:Mt(Yt(n+i*(Ut(wt(e.g))-n))),b:Mt(Yt(o+i*(Ut(wt(e.b))-o))),a:t.a+i*(e.a-t.a)}}(this._rgb,t._rgb,e)),this}clone(){return new Jt(this.rgb)}alpha(t){return this._rgb.a=Mt(t),this}clearer(t){return this._rgb.a*=1-t,this}greyscale(){const t=this._rgb,e=_t(.3*t.r+.59*t.g+.11*t.b);return t.r=t.g=t.b=e,this}opaquer(t){return this._rgb.a*=1+t,this}negate(){const t=this._rgb;return t.r=255-t.r,t.g=255-t.g,t.b=255-t.b,this}lighten(t){return Xt(this._rgb,2,t),this}darken(t){return Xt(this._rgb,2,-t),this}saturate(t){return Xt(this._rgb,1,t),this}desaturate(t){return Xt(this._rgb,1,-t),this}rotate(t){return function(t,e){var i=It(t);i[0]=Vt(i[0]+e),i=Ft(i),t.r=i[0],t.g=i[1],t.b=i[2]}(this._rgb,t),this}}function Zt(t){if(t&&"object"==typeof t){const e=t.toString();return"[object CanvasPattern]"===e||"[object CanvasGradient]"===e}return!1}function Qt(t){return Zt(t)?t:new Jt(t)}function te(t){return Zt(t)?t:new Jt(t).saturate(.5).darken(.1).hexString()}const ee=["x","y","borderWidth","radius","tension"],ie=["color","borderColor","backgroundColor"];const se=new Map;function ne(t,e,i){return function(t,e){e=e||{};const i=t+JSON.stringify(e);let s=se.get(i);return s||(s=new Intl.NumberFormat(t,e),se.set(i,s)),s}(e,i).format(t)}const oe={values:t=>n(t)?t:""+t,numeric(t,e,i){if(0===t)return"0";const s=this.chart.options.locale;let n,o=t;if(i.length>1){const e=Math.max(Math.abs(i[0].value),Math.abs(i[i.length-1].value));(e<1e-4||e>1e15)&&(n="scientific"),o=function(t,e){let i=e.length>3?e[2].value-e[1].value:e[1].value-e[0].value;Math.abs(i)>=1&&t!==Math.floor(t)&&(i=t-Math.floor(t));return i}(t,i)}const a=z(Math.abs(o)),r=isNaN(a)?1:Math.max(Math.min(-1*Math.floor(a),20),0),l={notation:n,minimumFractionDigits:r,maximumFractionDigits:r};return Object.assign(l,this.options.ticks.format),ne(t,s,l)},logarithmic(t,e,i){if(0===t)return"0";const s=i[e].significand||t/Math.pow(10,Math.floor(z(t)));return[1,2,3,5,10,15].includes(s)||e>.8*i.length?oe.numeric.call(this,t,e,i):""}};var ae={formatters:oe};const re=Object.create(null),le=Object.create(null);function he(t,e){if(!e)return t;const i=e.split(".");for(let e=0,s=i.length;e<s;++e){const s=i[e];t=t[s]||(t[s]=Object.create(null))}return t}function ce(t,e,i){return"string"==typeof e?x(he(t,e),i):x(he(t,""),e)}class de{constructor(t,e){this.animation=void 0,this.backgroundColor="rgba(0,0,0,0.1)",this.borderColor="rgba(0,0,0,0.1)",this.color="#666",this.datasets={},this.devicePixelRatio=t=>t.chart.platform.getDevicePixelRatio(),this.elements={},this.events=["mousemove","mouseout","click","touchstart","touchmove"],this.font={family:"'Helvetica Neue', 'Helvetica', 'Arial', sans-serif",size:12,style:"normal",lineHeight:1.2,weight:null},this.hover={},this.hoverBackgroundColor=(t,e)=>te(e.backgroundColor),this.hoverBorderColor=(t,e)=>te(e.borderColor),this.hoverColor=(t,e)=>te(e.color),this.indexAxis="x",this.interaction={mode:"nearest",intersect:!0,includeInvisible:!1},this.maintainAspectRatio=!0,this.onHover=null,this.onClick=null,this.parsing=!0,this.plugins={},this.responsive=!0,this.scale=void 0,this.scales={},this.showLine=!0,this.drawActiveElementsOnTop=!0,this.describe(t),this.apply(e)}set(t,e){return ce(this,t,e)}get(t){return he(this,t)}describe(t,e){return ce(le,t,e)}override(t,e){return ce(re,t,e)}route(t,e,i,s){const n=he(this,t),a=he(this,i),r="_"+e;Object.defineProperties(n,{[r]:{value:n[e],writable:!0},[e]:{enumerable:!0,get(){const t=this[r],e=a[s];return o(t)?Object.assign({},e,t):l(t,e)},set(t){this[r]=t}}})}apply(t){t.forEach((t=>t(this)))}}var ue=new de({_scriptable:t=>!t.startsWith("on"),_indexable:t=>"events"!==t,hover:{_fallback:"interaction"},interaction:{_scriptable:!1,_indexable:!1}},[function(t){t.set("animation",{delay:void 0,duration:1e3,easing:"easeOutQuart",fn:void 0,from:void 0,loop:void 0,to:void 0,type:void 0}),t.describe("animation",{_fallback:!1,_indexable:!1,_scriptable:t=>"onProgress"!==t&&"onComplete"!==t&&"fn"!==t}),t.set("animations",{colors:{type:"color",properties:ie},numbers:{type:"number",properties:ee}}),t.describe("animations",{_fallback:"animation"}),t.set("transitions",{active:{animation:{duration:400}},resize:{animation:{duration:0}},show:{animations:{colors:{from:"transparent"},visible:{type:"boolean",duration:0}}},hide:{animations:{colors:{to:"transparent"},visible:{type:"boolean",easing:"linear",fn:t=>0|t}}}})},function(t){t.set("layout",{autoPadding:!0,padding:{top:0,right:0,bottom:0,left:0}})},function(t){t.set("scale",{display:!0,offset:!1,reverse:!1,beginAtZero:!1,bounds:"ticks",clip:!0,grace:0,grid:{display:!0,lineWidth:1,drawOnChartArea:!0,drawTicks:!0,tickLength:8,tickWidth:(t,e)=>e.lineWidth,tickColor:(t,e)=>e.color,offset:!1},border:{display:!0,dash:[],dashOffset:0,width:1},title:{display:!1,text:"",padding:{top:4,bottom:4}},ticks:{minRotation:0,maxRotation:50,mirror:!1,textStrokeWidth:0,textStrokeColor:"",padding:3,display:!0,autoSkip:!0,autoSkipPadding:3,labelOffset:0,callback:ae.formatters.values,minor:{},major:{},align:"center",crossAlign:"near",showLabelBackdrop:!1,backdropColor:"rgba(255, 255, 255, 0.75)",backdropPadding:2}}),t.route("scale.ticks","color","","color"),t.route("scale.grid","color","","borderColor"),t.route("scale.border","color","","borderColor"),t.route("scale.title","color","","color"),t.describe("scale",{_fallback:!1,_scriptable:t=>!t.startsWith("before")&&!t.startsWith("after")&&"callback"!==t&&"parser"!==t,_indexable:t=>"borderDash"!==t&&"tickBorderDash"!==t&&"dash"!==t}),t.describe("scales",{_fallback:"scale"}),t.describe("scale.ticks",{_scriptable:t=>"backdropPadding"!==t&&"callback"!==t,_indexable:t=>"backdropPadding"!==t})}]);function fe(){return"undefined"!=typeof window&&"undefined"!=typeof document}function ge(t){let e=t.parentNode;return e&&"[object ShadowRoot]"===e.toString()&&(e=e.host),e}function pe(t,e,i){let s;return"string"==typeof t?(s=parseInt(t,10),-1!==t.indexOf("%")&&(s=s/100*e.parentNode[i])):s=t,s}const me=t=>t.ownerDocument.defaultView.getComputedStyle(t,null);function xe(t,e){return me(t).getPropertyValue(e)}const be=["top","right","bottom","left"];function _e(t,e,i){const s={};i=i?"-"+i:"";for(let n=0;n<4;n++){const o=be[n];s[o]=parseFloat(t[e+"-"+o+i])||0}return s.width=s.left+s.right,s.height=s.top+s.bottom,s}const ye=(t,e,i)=>(t>0||e>0)&&(!i||!i.shadowRoot);function ve(t,e){if("native"in t)return t;const{canvas:i,currentDevicePixelRatio:s}=e,n=me(i),o="border-box"===n.boxSizing,a=_e(n,"padding"),r=_e(n,"border","width"),{x:l,y:h,box:c}=function(t,e){const i=t.touches,s=i&&i.length?i[0]:t,{offsetX:n,offsetY:o}=s;let a,r,l=!1;if(ye(n,o,t.target))a=n,r=o;else{const t=e.getBoundingClientRect();a=s.clientX-t.left,r=s.clientY-t.top,l=!0}return{x:a,y:r,box:l}}(t,i),d=a.left+(c&&r.left),u=a.top+(c&&r.top);let{width:f,height:g}=e;return o&&(f-=a.width+r.width,g-=a.height+r.height),{x:Math.round((l-d)/f*i.width/s),y:Math.round((h-u)/g*i.height/s)}}const Me=t=>Math.round(10*t)/10;function we(t,e,i,s){const n=me(t),o=_e(n,"margin"),a=pe(n.maxWidth,t,"clientWidth")||T,r=pe(n.maxHeight,t,"clientHeight")||T,l=function(t,e,i){let s,n;if(void 0===e||void 0===i){const o=t&&ge(t);if(o){const t=o.getBoundingClientRect(),a=me(o),r=_e(a,"border","width"),l=_e(a,"padding");e=t.width-l.width-r.width,i=t.height-l.height-r.height,s=pe(a.maxWidth,o,"clientWidth"),n=pe(a.maxHeight,o,"clientHeight")}else e=t.clientWidth,i=t.clientHeight}return{width:e,height:i,maxWidth:s||T,maxHeight:n||T}}(t,e,i);let{width:h,height:c}=l;if("content-box"===n.boxSizing){const t=_e(n,"border","width"),e=_e(n,"padding");h-=e.width+t.width,c-=e.height+t.height}h=Math.max(0,h-o.width),c=Math.max(0,s?h/s:c-o.height),h=Me(Math.min(h,a,l.maxWidth)),c=Me(Math.min(c,r,l.maxHeight)),h&&!c&&(c=Me(h/2));return(void 0!==e||void 0!==i)&&s&&l.height&&c>l.height&&(c=l.height,h=Me(Math.floor(c*s))),{width:h,height:c}}function ke(t,e,i){const s=e||1,n=Me(t.height*s),o=Me(t.width*s);t.height=Me(t.height),t.width=Me(t.width);const a=t.canvas;return a.style&&(i||!a.style.height&&!a.style.width)&&(a.style.height=`${t.height}px`,a.style.width=`${t.width}px`),(t.currentDevicePixelRatio!==s||a.height!==n||a.width!==o)&&(t.currentDevicePixelRatio=s,a.height=n,a.width=o,t.ctx.setTransform(s,0,0,s,0,0),!0)}const Se=function(){let t=!1;try{const e={get passive(){return t=!0,!1}};fe()&&(window.addEventListener("test",null,e),window.removeEventListener("test",null,e))}catch(t){}return t}();function Pe(t,e){const i=xe(t,e),s=i&&i.match(/^(\d+)(\.\d+)?px$/);return s?+s[1]:void 0}function De(t){return!t||s(t.size)||s(t.family)?null:(t.style?t.style+" ":"")+(t.weight?t.weight+" ":"")+t.size+"px "+t.family}function Ce(t,e,i,s,n){let o=e[n];return o||(o=e[n]=t.measureText(n).width,i.push(n)),o>s&&(s=o),s}function Oe(t,e,i,s){let o=(s=s||{}).data=s.data||{},a=s.garbageCollect=s.garbageCollect||[];s.font!==e&&(o=s.data={},a=s.garbageCollect=[],s.font=e),t.save(),t.font=e;let r=0;const l=i.length;let h,c,d,u,f;for(h=0;h<l;h++)if(u=i[h],null==u||n(u)){if(n(u))for(c=0,d=u.length;c<d;c++)f=u[c],null==f||n(f)||(r=Ce(t,o,a,r,f))}else r=Ce(t,o,a,r,u);t.restore();const g=a.length/2;if(g>i.length){for(h=0;h<g;h++)delete o[a[h]];a.splice(0,g)}return r}function Ae(t,e,i){const s=t.currentDevicePixelRatio,n=0!==i?Math.max(i/2,.5):0;return Math.round((e-n)*s)/s+n}function Te(t,e){(e||t)&&((e=e||t.getContext("2d")).save(),e.resetTransform(),e.clearRect(0,0,t.width,t.height),e.restore())}function Le(t,e,i,s){Ee(t,e,i,s,null)}function Ee(t,e,i,s,n){let o,a,r,l,h,c,d,u;const f=e.pointStyle,g=e.rotation,p=e.radius;let m=(g||0)*L;if(f&&"object"==typeof f&&(o=f.toString(),"[object HTMLImageElement]"===o||"[object HTMLCanvasElement]"===o))return t.save(),t.translate(i,s),t.rotate(m),t.drawImage(f,-f.width/2,-f.height/2,f.width,f.height),void t.restore();if(!(isNaN(p)||p<=0)){switch(t.beginPath(),f){default:n?t.ellipse(i,s,n/2,p,0,0,O):t.arc(i,s,p,0,O),t.closePath();break;case"triangle":c=n?n/2:p,t.moveTo(i+Math.sin(m)*c,s-Math.cos(m)*p),m+=I,t.lineTo(i+Math.sin(m)*c,s-Math.cos(m)*p),m+=I,t.lineTo(i+Math.sin(m)*c,s-Math.cos(m)*p),t.closePath();break;case"rectRounded":h=.516*p,l=p-h,a=Math.cos(m+R)*l,d=Math.cos(m+R)*(n?n/2-h:l),r=Math.sin(m+R)*l,u=Math.sin(m+R)*(n?n/2-h:l),t.arc(i-d,s-r,h,m-C,m-E),t.arc(i+u,s-a,h,m-E,m),t.arc(i+d,s+r,h,m,m+E),t.arc(i-u,s+a,h,m+E,m+C),t.closePath();break;case"rect":if(!g){l=Math.SQRT1_2*p,c=n?n/2:l,t.rect(i-c,s-l,2*c,2*l);break}m+=R;case"rectRot":d=Math.cos(m)*(n?n/2:p),a=Math.cos(m)*p,r=Math.sin(m)*p,u=Math.sin(m)*(n?n/2:p),t.moveTo(i-d,s-r),t.lineTo(i+u,s-a),t.lineTo(i+d,s+r),t.lineTo(i-u,s+a),t.closePath();break;case"crossRot":m+=R;case"cross":d=Math.cos(m)*(n?n/2:p),a=Math.cos(m)*p,r=Math.sin(m)*p,u=Math.sin(m)*(n?n/2:p),t.moveTo(i-d,s-r),t.lineTo(i+d,s+r),t.moveTo(i+u,s-a),t.lineTo(i-u,s+a);break;case"star":d=Math.cos(m)*(n?n/2:p),a=Math.cos(m)*p,r=Math.sin(m)*p,u=Math.sin(m)*(n?n/2:p),t.moveTo(i-d,s-r),t.lineTo(i+d,s+r),t.moveTo(i+u,s-a),t.lineTo(i-u,s+a),m+=R,d=Math.cos(m)*(n?n/2:p),a=Math.cos(m)*p,r=Math.sin(m)*p,u=Math.sin(m)*(n?n/2:p),t.moveTo(i-d,s-r),t.lineTo(i+d,s+r),t.moveTo(i+u,s-a),t.lineTo(i-u,s+a);break;case"line":a=n?n/2:Math.cos(m)*p,r=Math.sin(m)*p,t.moveTo(i-a,s-r),t.lineTo(i+a,s+r);break;case"dash":t.moveTo(i,s),t.lineTo(i+Math.cos(m)*(n?n/2:p),s+Math.sin(m)*p);break;case!1:t.closePath()}t.fill(),e.borderWidth>0&&t.stroke()}}function Re(t,e,i){return i=i||.5,!e||t&&t.x>e.left-i&&t.x<e.right+i&&t.y>e.top-i&&t.y<e.bottom+i}function Ie(t,e){t.save(),t.beginPath(),t.rect(e.left,e.top,e.right-e.left,e.bottom-e.top),t.clip()}function ze(t){t.restore()}function Fe(t,e,i,s,n){if(!e)return t.lineTo(i.x,i.y);if("middle"===n){const s=(e.x+i.x)/2;t.lineTo(s,e.y),t.lineTo(s,i.y)}else"after"===n!=!!s?t.lineTo(e.x,i.y):t.lineTo(i.x,e.y);t.lineTo(i.x,i.y)}function Ve(t,e,i,s){if(!e)return t.lineTo(i.x,i.y);t.bezierCurveTo(s?e.cp1x:e.cp2x,s?e.cp1y:e.cp2y,s?i.cp2x:i.cp1x,s?i.cp2y:i.cp1y,i.x,i.y)}function Be(t,e,i,s,n){if(n.strikethrough||n.underline){const o=t.measureText(s),a=e-o.actualBoundingBoxLeft,r=e+o.actualBoundingBoxRight,l=i-o.actualBoundingBoxAscent,h=i+o.actualBoundingBoxDescent,c=n.strikethrough?(l+h)/2:h;t.strokeStyle=t.fillStyle,t.beginPath(),t.lineWidth=n.decorationWidth||2,t.moveTo(a,c),t.lineTo(r,c),t.stroke()}}function We(t,e){const i=t.fillStyle;t.fillStyle=e.color,t.fillRect(e.left,e.top,e.width,e.height),t.fillStyle=i}function Ne(t,e,i,o,a,r={}){const l=n(e)?e:[e],h=r.strokeWidth>0&&""!==r.strokeColor;let c,d;for(t.save(),t.font=a.string,function(t,e){e.translation&&t.translate(e.translation[0],e.translation[1]),s(e.rotation)||t.rotate(e.rotation),e.color&&(t.fillStyle=e.color),e.textAlign&&(t.textAlign=e.textAlign),e.textBaseline&&(t.textBaseline=e.textBaseline)}(t,r),c=0;c<l.length;++c)d=l[c],r.backdrop&&We(t,r.backdrop),h&&(r.strokeColor&&(t.strokeStyle=r.strokeColor),s(r.strokeWidth)||(t.lineWidth=r.strokeWidth),t.strokeText(d,i,o,r.maxWidth)),t.fillText(d,i,o,r.maxWidth),Be(t,i,o,d,r),o+=Number(a.lineHeight);t.restore()}function He(t,e){const{x:i,y:s,w:n,h:o,radius:a}=e;t.arc(i+a.topLeft,s+a.topLeft,a.topLeft,1.5*C,C,!0),t.lineTo(i,s+o-a.bottomLeft),t.arc(i+a.bottomLeft,s+o-a.bottomLeft,a.bottomLeft,C,E,!0),t.lineTo(i+n-a.bottomRight,s+o),t.arc(i+n-a.bottomRight,s+o-a.bottomRight,a.bottomRight,E,0,!0),t.lineTo(i+n,s+a.topRight),t.arc(i+n-a.topRight,s+a.topRight,a.topRight,0,-E,!0),t.lineTo(i+a.topLeft,s)}function je(t,e=[""],i,s,n=(()=>t[0])){const o=i||t;void 0===s&&(s=ti("_fallback",t));const a={[Symbol.toStringTag]:"Object",_cacheable:!0,_scopes:t,_rootScopes:o,_fallback:s,_getTarget:n,override:i=>je([i,...t],e,o,s)};return new Proxy(a,{deleteProperty:(e,i)=>(delete e[i],delete e._keys,delete t[0][i],!0),get:(i,s)=>qe(i,s,(()=>function(t,e,i,s){let n;for(const o of e)if(n=ti(Ue(o,t),i),void 0!==n)return Xe(t,n)?Ze(i,s,t,n):n}(s,e,t,i))),getOwnPropertyDescriptor:(t,e)=>Reflect.getOwnPropertyDescriptor(t._scopes[0],e),getPrototypeOf:()=>Reflect.getPrototypeOf(t[0]),has:(t,e)=>ei(t).includes(e),ownKeys:t=>ei(t),set(t,e,i){const s=t._storage||(t._storage=n());return t[e]=s[e]=i,delete t._keys,!0}})}function $e(t,e,i,s){const a={_cacheable:!1,_proxy:t,_context:e,_subProxy:i,_stack:new Set,_descriptors:Ye(t,s),setContext:e=>$e(t,e,i,s),override:n=>$e(t.override(n),e,i,s)};return new Proxy(a,{deleteProperty:(e,i)=>(delete e[i],delete t[i],!0),get:(t,e,i)=>qe(t,e,(()=>function(t,e,i){const{_proxy:s,_context:a,_subProxy:r,_descriptors:l}=t;let h=s[e];S(h)&&l.isScriptable(e)&&(h=function(t,e,i,s){const{_proxy:n,_context:o,_subProxy:a,_stack:r}=i;if(r.has(t))throw new Error("Recursion detected: "+Array.from(r).join("->")+"->"+t);r.add(t);let l=e(o,a||s);r.delete(t),Xe(t,l)&&(l=Ze(n._scopes,n,t,l));return l}(e,h,t,i));n(h)&&h.length&&(h=function(t,e,i,s){const{_proxy:n,_context:a,_subProxy:r,_descriptors:l}=i;if(void 0!==a.index&&s(t))return e[a.index%e.length];if(o(e[0])){const i=e,s=n._scopes.filter((t=>t!==i));e=[];for(const o of i){const i=Ze(s,n,t,o);e.push($e(i,a,r&&r[t],l))}}return e}(e,h,t,l.isIndexable));Xe(e,h)&&(h=$e(h,a,r&&r[e],l));return h}(t,e,i))),getOwnPropertyDescriptor:(e,i)=>e._descriptors.allKeys?Reflect.has(t,i)?{enumerable:!0,configurable:!0}:void 0:Reflect.getOwnPropertyDescriptor(t,i),getPrototypeOf:()=>Reflect.getPrototypeOf(t),has:(e,i)=>Reflect.has(t,i),ownKeys:()=>Reflect.ownKeys(t),set:(e,i,s)=>(t[i]=s,delete e[i],!0)})}function Ye(t,e={scriptable:!0,indexable:!0}){const{_scriptable:i=e.scriptable,_indexable:s=e.indexable,_allKeys:n=e.allKeys}=t;return{allKeys:n,scriptable:i,indexable:s,isScriptable:S(i)?i:()=>i,isIndexable:S(s)?s:()=>s}}const Ue=(t,e)=>t?t+w(e):e,Xe=(t,e)=>o(e)&&"adapters"!==t&&(null===Object.getPrototypeOf(e)||e.constructor===Object);function qe(t,e,i){if(Object.prototype.hasOwnProperty.call(t,e)||"constructor"===e)return t[e];const s=i();return t[e]=s,s}function Ke(t,e,i){return S(t)?t(e,i):t}const Ge=(t,e)=>!0===t?e:"string"==typeof t?M(e,t):void 0;function Je(t,e,i,s,n){for(const o of e){const e=Ge(i,o);if(e){t.add(e);const o=Ke(e._fallback,i,n);if(void 0!==o&&o!==i&&o!==s)return o}else if(!1===e&&void 0!==s&&i!==s)return null}return!1}function Ze(t,e,i,s){const a=e._rootScopes,r=Ke(e._fallback,i,s),l=[...t,...a],h=new Set;h.add(s);let c=Qe(h,l,i,r||i,s);return null!==c&&((void 0===r||r===i||(c=Qe(h,l,r,c,s),null!==c))&&je(Array.from(h),[""],a,r,(()=>function(t,e,i){const s=t._getTarget();e in s||(s[e]={});const a=s[e];if(n(a)&&o(i))return i;return a||{}}(e,i,s))))}function Qe(t,e,i,s,n){for(;i;)i=Je(t,e,i,s,n);return i}function ti(t,e){for(const i of e){if(!i)continue;const e=i[t];if(void 0!==e)return e}}function ei(t){let e=t._keys;return e||(e=t._keys=function(t){const e=new Set;for(const i of t)for(const t of Object.keys(i).filter((t=>!t.startsWith("_"))))e.add(t);return Array.from(e)}(t._scopes)),e}function ii(t,e,i,s){const{iScale:n}=t,{key:o="r"}=this._parsing,a=new Array(s);let r,l,h,c;for(r=0,l=s;r<l;++r)h=r+i,c=e[h],a[r]={r:n.parse(M(c,o),h)};return a}const si=Number.EPSILON||1e-14,ni=(t,e)=>e<t.length&&!t[e].skip&&t[e],oi=t=>"x"===t?"y":"x";function ai(t,e,i,s){const n=t.skip?e:t,o=e,a=i.skip?e:i,r=q(o,n),l=q(a,o);let h=r/(r+l),c=l/(r+l);h=isNaN(h)?0:h,c=isNaN(c)?0:c;const d=s*h,u=s*c;return{previous:{x:o.x-d*(a.x-n.x),y:o.y-d*(a.y-n.y)},next:{x:o.x+u*(a.x-n.x),y:o.y+u*(a.y-n.y)}}}function ri(t,e="x"){const i=oi(e),s=t.length,n=Array(s).fill(0),o=Array(s);let a,r,l,h=ni(t,0);for(a=0;a<s;++a)if(r=l,l=h,h=ni(t,a+1),l){if(h){const t=h[e]-l[e];n[a]=0!==t?(h[i]-l[i])/t:0}o[a]=r?h?F(n[a-1])!==F(n[a])?0:(n[a-1]+n[a])/2:n[a-1]:n[a]}!function(t,e,i){const s=t.length;let n,o,a,r,l,h=ni(t,0);for(let c=0;c<s-1;++c)l=h,h=ni(t,c+1),l&&h&&(V(e[c],0,si)?i[c]=i[c+1]=0:(n=i[c]/e[c],o=i[c+1]/e[c],r=Math.pow(n,2)+Math.pow(o,2),r<=9||(a=3/Math.sqrt(r),i[c]=n*a*e[c],i[c+1]=o*a*e[c])))}(t,n,o),function(t,e,i="x"){const s=oi(i),n=t.length;let o,a,r,l=ni(t,0);for(let h=0;h<n;++h){if(a=r,r=l,l=ni(t,h+1),!r)continue;const n=r[i],c=r[s];a&&(o=(n-a[i])/3,r[`cp1${i}`]=n-o,r[`cp1${s}`]=c-o*e[h]),l&&(o=(l[i]-n)/3,r[`cp2${i}`]=n+o,r[`cp2${s}`]=c+o*e[h])}}(t,o,e)}function li(t,e,i){return Math.max(Math.min(t,i),e)}function hi(t,e,i,s,n){let o,a,r,l;if(e.spanGaps&&(t=t.filter((t=>!t.skip))),"monotone"===e.cubicInterpolationMode)ri(t,n);else{let i=s?t[t.length-1]:t[0];for(o=0,a=t.length;o<a;++o)r=t[o],l=ai(i,r,t[Math.min(o+1,a-(s?0:1))%a],e.tension),r.cp1x=l.previous.x,r.cp1y=l.previous.y,r.cp2x=l.next.x,r.cp2y=l.next.y,i=r}e.capBezierPoints&&function(t,e){let i,s,n,o,a,r=Re(t[0],e);for(i=0,s=t.length;i<s;++i)a=o,o=r,r=i<s-1&&Re(t[i+1],e),o&&(n=t[i],a&&(n.cp1x=li(n.cp1x,e.left,e.right),n.cp1y=li(n.cp1y,e.top,e.bottom)),r&&(n.cp2x=li(n.cp2x,e.left,e.right),n.cp2y=li(n.cp2y,e.top,e.bottom)))}(t,i)}const ci=t=>0===t||1===t,di=(t,e,i)=>-Math.pow(2,10*(t-=1))*Math.sin((t-e)*O/i),ui=(t,e,i)=>Math.pow(2,-10*t)*Math.sin((t-e)*O/i)+1,fi={linear:t=>t,easeInQuad:t=>t*t,easeOutQuad:t=>-t*(t-2),easeInOutQuad:t=>(t/=.5)<1?.5*t*t:-.5*(--t*(t-2)-1),easeInCubic:t=>t*t*t,easeOutCubic:t=>(t-=1)*t*t+1,easeInOutCubic:t=>(t/=.5)<1?.5*t*t*t:.5*((t-=2)*t*t+2),easeInQuart:t=>t*t*t*t,easeOutQuart:t=>-((t-=1)*t*t*t-1),easeInOutQuart:t=>(t/=.5)<1?.5*t*t*t*t:-.5*((t-=2)*t*t*t-2),easeInQuint:t=>t*t*t*t*t,easeOutQuint:t=>(t-=1)*t*t*t*t+1,easeInOutQuint:t=>(t/=.5)<1?.5*t*t*t*t*t:.5*((t-=2)*t*t*t*t+2),easeInSine:t=>1-Math.cos(t*E),easeOutSine:t=>Math.sin(t*E),easeInOutSine:t=>-.5*(Math.cos(C*t)-1),easeInExpo:t=>0===t?0:Math.pow(2,10*(t-1)),easeOutExpo:t=>1===t?1:1-Math.pow(2,-10*t),easeInOutExpo:t=>ci(t)?t:t<.5?.5*Math.pow(2,10*(2*t-1)):.5*(2-Math.pow(2,-10*(2*t-1))),easeInCirc:t=>t>=1?t:-(Math.sqrt(1-t*t)-1),easeOutCirc:t=>Math.sqrt(1-(t-=1)*t),easeInOutCirc:t=>(t/=.5)<1?-.5*(Math.sqrt(1-t*t)-1):.5*(Math.sqrt(1-(t-=2)*t)+1),easeInElastic:t=>ci(t)?t:di(t,.075,.3),easeOutElastic:t=>ci(t)?t:ui(t,.075,.3),easeInOutElastic(t){const e=.1125;return ci(t)?t:t<.5?.5*di(2*t,e,.45):.5+.5*ui(2*t-1,e,.45)},easeInBack(t){const e=1.70158;return t*t*((e+1)*t-e)},easeOutBack(t){const e=1.70158;return(t-=1)*t*((e+1)*t+e)+1},easeInOutBack(t){let e=1.70158;return(t/=.5)<1?t*t*((1+(e*=1.525))*t-e)*.5:.5*((t-=2)*t*((1+(e*=1.525))*t+e)+2)},easeInBounce:t=>1-fi.easeOutBounce(1-t),easeOutBounce(t){const e=7.5625,i=2.75;return t<1/i?e*t*t:t<2/i?e*(t-=1.5/i)*t+.75:t<2.5/i?e*(t-=2.25/i)*t+.9375:e*(t-=2.625/i)*t+.984375},easeInOutBounce:t=>t<.5?.5*fi.easeInBounce(2*t):.5*fi.easeOutBounce(2*t-1)+.5};function gi(t,e,i,s){return{x:t.x+i*(e.x-t.x),y:t.y+i*(e.y-t.y)}}function pi(t,e,i,s){return{x:t.x+i*(e.x-t.x),y:"middle"===s?i<.5?t.y:e.y:"after"===s?i<1?t.y:e.y:i>0?e.y:t.y}}function mi(t,e,i,s){const n={x:t.cp2x,y:t.cp2y},o={x:e.cp1x,y:e.cp1y},a=gi(t,n,i),r=gi(n,o,i),l=gi(o,e,i),h=gi(a,r,i),c=gi(r,l,i);return gi(h,c,i)}const xi=/^(normal|(\d+(?:\.\d+)?)(px|em|%)?)$/,bi=/^(normal|italic|initial|inherit|unset|(oblique( -?[0-9]?[0-9]deg)?))$/;function _i(t,e){const i=(""+t).match(xi);if(!i||"normal"===i[1])return 1.2*e;switch(t=+i[2],i[3]){case"px":return t;case"%":t/=100}return e*t}const yi=t=>+t||0;function vi(t,e){const i={},s=o(e),n=s?Object.keys(e):e,a=o(t)?s?i=>l(t[i],t[e[i]]):e=>t[e]:()=>t;for(const t of n)i[t]=yi(a(t));return i}function Mi(t){return vi(t,{top:"y",right:"x",bottom:"y",left:"x"})}function wi(t){return vi(t,["topLeft","topRight","bottomLeft","bottomRight"])}function ki(t){const e=Mi(t);return e.width=e.left+e.right,e.height=e.top+e.bottom,e}function Si(t,e){t=t||{},e=e||ue.font;let i=l(t.size,e.size);"string"==typeof i&&(i=parseInt(i,10));let s=l(t.style,e.style);s&&!(""+s).match(bi)&&(console.warn('Invalid font style specified: "'+s+'"'),s=void 0);const n={family:l(t.family,e.family),lineHeight:_i(l(t.lineHeight,e.lineHeight),i),size:i,style:s,weight:l(t.weight,e.weight),string:""};return n.string=De(n),n}function Pi(t,e,i,s){let o,a,r,l=!0;for(o=0,a=t.length;o<a;++o)if(r=t[o],void 0!==r&&(void 0!==e&&"function"==typeof r&&(r=r(e),l=!1),void 0!==i&&n(r)&&(r=r[i%r.length],l=!1),void 0!==r))return s&&!l&&(s.cacheable=!1),r}function Di(t,e,i){const{min:s,max:n}=t,o=c(e,(n-s)/2),a=(t,e)=>i&&0===t?0:t+e;return{min:a(s,-Math.abs(o)),max:a(n,o)}}function Ci(t,e){return Object.assign(Object.create(t),e)}function Oi(t,e,i){return t?function(t,e){return{x:i=>t+t+e-i,setWidth(t){e=t},textAlign:t=>"center"===t?t:"right"===t?"left":"right",xPlus:(t,e)=>t-e,leftForLtr:(t,e)=>t-e}}(e,i):{x:t=>t,setWidth(t){},textAlign:t=>t,xPlus:(t,e)=>t+e,leftForLtr:(t,e)=>t}}function Ai(t,e){let i,s;"ltr"!==e&&"rtl"!==e||(i=t.canvas.style,s=[i.getPropertyValue("direction"),i.getPropertyPriority("direction")],i.setProperty("direction",e,"important"),t.prevTextDirection=s)}function Ti(t,e){void 0!==e&&(delete t.prevTextDirection,t.canvas.style.setProperty("direction",e[0],e[1]))}function Li(t){return"angle"===t?{between:J,compare:K,normalize:G}:{between:tt,compare:(t,e)=>t-e,normalize:t=>t}}function Ei({start:t,end:e,count:i,loop:s,style:n}){return{start:t%i,end:e%i,loop:s&&(e-t+1)%i==0,style:n}}function Ri(t,e,i){if(!i)return[t];const{property:s,start:n,end:o}=i,a=e.length,{compare:r,between:l,normalize:h}=Li(s),{start:c,end:d,loop:u,style:f}=function(t,e,i){const{property:s,start:n,end:o}=i,{between:a,normalize:r}=Li(s),l=e.length;let h,c,{start:d,end:u,loop:f}=t;if(f){for(d+=l,u+=l,h=0,c=l;h<c&&a(r(e[d%l][s]),n,o);++h)d--,u--;d%=l,u%=l}return u<d&&(u+=l),{start:d,end:u,loop:f,style:t.style}}(t,e,i),g=[];let p,m,x,b=!1,_=null;const y=()=>b||l(n,x,p)&&0!==r(n,x),v=()=>!b||0===r(o,p)||l(o,x,p);for(let t=c,i=c;t<=d;++t)m=e[t%a],m.skip||(p=h(m[s]),p!==x&&(b=l(p,n,o),null===_&&y()&&(_=0===r(p,n)?t:i),null!==_&&v()&&(g.push(Ei({start:_,end:t,loop:u,count:a,style:f})),_=null),i=t,x=p));return null!==_&&g.push(Ei({start:_,end:d,loop:u,count:a,style:f})),g}function Ii(t,e){const i=[],s=t.segments;for(let n=0;n<s.length;n++){const o=Ri(s[n],t.points,e);o.length&&i.push(...o)}return i}function zi(t,e){const i=t.points,s=t.options.spanGaps,n=i.length;if(!n)return[];const o=!!t._loop,{start:a,end:r}=function(t,e,i,s){let n=0,o=e-1;if(i&&!s)for(;n<e&&!t[n].skip;)n++;for(;n<e&&t[n].skip;)n++;for(n%=e,i&&(o+=n);o>n&&t[o%e].skip;)o--;return o%=e,{start:n,end:o}}(i,n,o,s);if(!0===s)return Fi(t,[{start:a,end:r,loop:o}],i,e);return Fi(t,function(t,e,i,s){const n=t.length,o=[];let a,r=e,l=t[e];for(a=e+1;a<=i;++a){const i=t[a%n];i.skip||i.stop?l.skip||(s=!1,o.push({start:e%n,end:(a-1)%n,loop:s}),e=r=i.stop?a:null):(r=a,l.skip&&(e=a)),l=i}return null!==r&&o.push({start:e%n,end:r%n,loop:s}),o}(i,a,r<a?r+n:r,!!t._fullLoop&&0===a&&r===n-1),i,e)}function Fi(t,e,i,s){return s&&s.setContext&&i?function(t,e,i,s){const n=t._chart.getContext(),o=Vi(t.options),{_datasetIndex:a,options:{spanGaps:r}}=t,l=i.length,h=[];let c=o,d=e[0].start,u=d;function f(t,e,s,n){const o=r?-1:1;if(t!==e){for(t+=l;i[t%l].skip;)t-=o;for(;i[e%l].skip;)e+=o;t%l!=e%l&&(h.push({start:t%l,end:e%l,loop:s,style:n}),c=n,d=e%l)}}for(const t of e){d=r?d:t.start;let e,o=i[d%l];for(u=d+1;u<=t.end;u++){const r=i[u%l];e=Vi(s.setContext(Ci(n,{type:"segment",p0:o,p1:r,p0DataIndex:(u-1)%l,p1DataIndex:u%l,datasetIndex:a}))),Bi(e,c)&&f(d,u-1,t.loop,c),o=r,c=e}d<u-1&&f(d,u-1,t.loop,c)}return h}(t,e,i,s):e}function Vi(t){return{backgroundColor:t.backgroundColor,borderCapStyle:t.borderCapStyle,borderDash:t.borderDash,borderDashOffset:t.borderDashOffset,borderJoinStyle:t.borderJoinStyle,borderWidth:t.borderWidth,borderColor:t.borderColor}}function Bi(t,e){if(!e)return!1;const i=[],s=function(t,e){return Zt(e)?(i.includes(e)||i.push(e),i.indexOf(e)):e};return JSON.stringify(t,s)!==JSON.stringify(e,s)}function Wi(t,e,i){return t.options.clip?t[i]:e[i]}function Ni(t,e){const i=e._clip;if(i.disabled)return!1;const s=function(t,e){const{xScale:i,yScale:s}=t;return i&&s?{left:Wi(i,e,"left"),right:Wi(i,e,"right"),top:Wi(s,e,"top"),bottom:Wi(s,e,"bottom")}:e}(e,t.chartArea);return{left:!1===i.left?0:s.left-(!0===i.left?0:i.left),right:!1===i.right?t.width:s.right+(!0===i.right?0:i.right),top:!1===i.top?0:s.top-(!0===i.top?0:i.top),bottom:!1===i.bottom?t.height:s.bottom+(!0===i.bottom?0:i.bottom)}}var Hi=Object.freeze({__proto__:null,HALF_PI:E,INFINITY:T,PI:C,PITAU:A,QUARTER_PI:R,RAD_PER_DEG:L,TAU:O,TWO_THIRDS_PI:I,_addGrace:Di,_alignPixel:Ae,_alignStartEnd:ft,_angleBetween:J,_angleDiff:K,_arrayUnique:lt,_attachContext:$e,_bezierCurveTo:Ve,_bezierInterpolation:mi,_boundSegment:Ri,_boundSegments:Ii,_capitalize:w,_computeSegments:zi,_createResolver:je,_decimalPlaces:U,_deprecated:function(t,e,i,s){void 0!==e&&console.warn(t+': "'+i+'" is deprecated. Please use "'+s+'" instead')},_descriptors:Ye,_elementsEqual:f,_factorize:W,_filterBetween:nt,_getParentNode:ge,_getStartAndCountOfVisiblePoints:pt,_int16Range:Q,_isBetween:tt,_isClickEvent:D,_isDomSupported:fe,_isPointInArea:Re,_limitValue:Z,_longestText:Oe,_lookup:et,_lookupByKey:it,_measureText:Ce,_merger:m,_mergerIf:_,_normalizeAngle:G,_parseObjectDataRadialScale:ii,_pointInLine:gi,_readValueToProps:vi,_rlookupByKey:st,_scaleRangesChanged:mt,_setMinAndMaxByKey:j,_splitKey:v,_steppedInterpolation:pi,_steppedLineTo:Fe,_textX:gt,_toLeftRightCenter:ut,_updateBezierControlPoints:hi,addRoundedRectPath:He,almostEquals:V,almostWhole:H,callback:d,clearCanvas:Te,clipArea:Ie,clone:g,color:Qt,createContext:Ci,debounce:dt,defined:k,distanceBetweenPoints:q,drawPoint:Le,drawPointLegend:Ee,each:u,easingEffects:fi,finiteOrDefault:r,fontString:function(t,e,i){return e+" "+t+"px "+i},formatNumber:ne,getAngleFromPoint:X,getDatasetClipArea:Ni,getHoverColor:te,getMaximumSize:we,getRelativePosition:ve,getRtlAdapter:Oi,getStyle:xe,isArray:n,isFinite:a,isFunction:S,isNullOrUndef:s,isNumber:N,isObject:o,isPatternOrGradient:Zt,listenArrayEvents:at,log10:z,merge:x,mergeIf:b,niceNum:B,noop:e,overrideTextDirection:Ai,readUsedSize:Pe,renderText:Ne,requestAnimFrame:ht,resolve:Pi,resolveObjectKey:M,restoreTextDirection:Ti,retinaScale:ke,setsEqual:P,sign:F,splineCurve:ai,splineCurveMonotone:ri,supportsEventListenerOptions:Se,throttled:ct,toDegrees:Y,toDimension:c,toFont:Si,toFontString:De,toLineHeight:_i,toPadding:ki,toPercentage:h,toRadians:$,toTRBL:Mi,toTRBLCorners:wi,uid:i,unclipArea:ze,unlistenArrayEvents:rt,valueOrDefault:l});function ji(t,e,i,n){const{controller:o,data:a,_sorted:r}=t,l=o._cachedMeta.iScale,h=t.dataset&&t.dataset.options?t.dataset.options.spanGaps:null;if(l&&e===l.axis&&"r"!==e&&r&&a.length){const r=l._reversePixels?st:it;if(!n){const n=r(a,e,i);if(h){const{vScale:e}=o._cachedMeta,{_parsed:i}=t,a=i.slice(0,n.lo+1).reverse().findIndex((t=>!s(t[e.axis])));n.lo-=Math.max(0,a);const r=i.slice(n.hi).findIndex((t=>!s(t[e.axis])));n.hi+=Math.max(0,r)}return n}if(o._sharedOptions){const t=a[0],s="function"==typeof t.getRange&&t.getRange(e);if(s){const t=r(a,e,i-s),n=r(a,e,i+s);return{lo:t.lo,hi:n.hi}}}}return{lo:0,hi:a.length-1}}function $i(t,e,i,s,n){const o=t.getSortedVisibleDatasetMetas(),a=i[e];for(let t=0,i=o.length;t<i;++t){const{index:i,data:r}=o[t],{lo:l,hi:h}=ji(o[t],e,a,n);for(let t=l;t<=h;++t){const e=r[t];e.skip||s(e,i,t)}}}function Yi(t,e,i,s,n){const o=[];if(!n&&!t.isPointInArea(e))return o;return $i(t,i,e,(function(i,a,r){(n||Re(i,t.chartArea,0))&&i.inRange(e.x,e.y,s)&&o.push({element:i,datasetIndex:a,index:r})}),!0),o}function Ui(t,e,i,s,n,o){let a=[];const r=function(t){const e=-1!==t.indexOf("x"),i=-1!==t.indexOf("y");return function(t,s){const n=e?Math.abs(t.x-s.x):0,o=i?Math.abs(t.y-s.y):0;return Math.sqrt(Math.pow(n,2)+Math.pow(o,2))}}(i);let l=Number.POSITIVE_INFINITY;return $i(t,i,e,(function(i,h,c){const d=i.inRange(e.x,e.y,n);if(s&&!d)return;const u=i.getCenterPoint(n);if(!(!!o||t.isPointInArea(u))&&!d)return;const f=r(e,u);f<l?(a=[{element:i,datasetIndex:h,index:c}],l=f):f===l&&a.push({element:i,datasetIndex:h,index:c})})),a}function Xi(t,e,i,s,n,o){return o||t.isPointInArea(e)?"r"!==i||s?Ui(t,e,i,s,n,o):function(t,e,i,s){let n=[];return $i(t,i,e,(function(t,i,o){const{startAngle:a,endAngle:r}=t.getProps(["startAngle","endAngle"],s),{angle:l}=X(t,{x:e.x,y:e.y});J(l,a,r)&&n.push({element:t,datasetIndex:i,index:o})})),n}(t,e,i,n):[]}function qi(t,e,i,s,n){const o=[],a="x"===i?"inXRange":"inYRange";let r=!1;return $i(t,i,e,((t,s,l)=>{t[a]&&t[a](e[i],n)&&(o.push({element:t,datasetIndex:s,index:l}),r=r||t.inRange(e.x,e.y,n))})),s&&!r?[]:o}var Ki={evaluateInteractionItems:$i,modes:{index(t,e,i,s){const n=ve(e,t),o=i.axis||"x",a=i.includeInvisible||!1,r=i.intersect?Yi(t,n,o,s,a):Xi(t,n,o,!1,s,a),l=[];return r.length?(t.getSortedVisibleDatasetMetas().forEach((t=>{const e=r[0].index,i=t.data[e];i&&!i.skip&&l.push({element:i,datasetIndex:t.index,index:e})})),l):[]},dataset(t,e,i,s){const n=ve(e,t),o=i.axis||"xy",a=i.includeInvisible||!1;let r=i.intersect?Yi(t,n,o,s,a):Xi(t,n,o,!1,s,a);if(r.length>0){const e=r[0].datasetIndex,i=t.getDatasetMeta(e).data;r=[];for(let t=0;t<i.length;++t)r.push({element:i[t],datasetIndex:e,index:t})}return r},point:(t,e,i,s)=>Yi(t,ve(e,t),i.axis||"xy",s,i.includeInvisible||!1),nearest(t,e,i,s){const n=ve(e,t),o=i.axis||"xy",a=i.includeInvisible||!1;return Xi(t,n,o,i.intersect,s,a)},x:(t,e,i,s)=>qi(t,ve(e,t),"x",i.intersect,s),y:(t,e,i,s)=>qi(t,ve(e,t),"y",i.intersect,s)}};const Gi=["left","top","right","bottom"];function Ji(t,e){return t.filter((t=>t.pos===e))}function Zi(t,e){return t.filter((t=>-1===Gi.indexOf(t.pos)&&t.box.axis===e))}function Qi(t,e){return t.sort(((t,i)=>{const s=e?i:t,n=e?t:i;return s.weight===n.weight?s.index-n.index:s.weight-n.weight}))}function ts(t,e){const i=function(t){const e={};for(const i of t){const{stack:t,pos:s,stackWeight:n}=i;if(!t||!Gi.includes(s))continue;const o=e[t]||(e[t]={count:0,placed:0,weight:0,size:0});o.count++,o.weight+=n}return e}(t),{vBoxMaxWidth:s,hBoxMaxHeight:n}=e;let o,a,r;for(o=0,a=t.length;o<a;++o){r=t[o];const{fullSize:a}=r.box,l=i[r.stack],h=l&&r.stackWeight/l.weight;r.horizontal?(r.width=h?h*s:a&&e.availableWidth,r.height=n):(r.width=s,r.height=h?h*n:a&&e.availableHeight)}return i}function es(t,e,i,s){return Math.max(t[i],e[i])+Math.max(t[s],e[s])}function is(t,e){t.top=Math.max(t.top,e.top),t.left=Math.max(t.left,e.left),t.bottom=Math.max(t.bottom,e.bottom),t.right=Math.max(t.right,e.right)}function ss(t,e,i,s){const{pos:n,box:a}=i,r=t.maxPadding;if(!o(n)){i.size&&(t[n]-=i.size);const e=s[i.stack]||{size:0,count:1};e.size=Math.max(e.size,i.horizontal?a.height:a.width),i.size=e.size/e.count,t[n]+=i.size}a.getPadding&&is(r,a.getPadding());const l=Math.max(0,e.outerWidth-es(r,t,"left","right")),h=Math.max(0,e.outerHeight-es(r,t,"top","bottom")),c=l!==t.w,d=h!==t.h;return t.w=l,t.h=h,i.horizontal?{same:c,other:d}:{same:d,other:c}}function ns(t,e){const i=e.maxPadding;function s(t){const s={left:0,top:0,right:0,bottom:0};return t.forEach((t=>{s[t]=Math.max(e[t],i[t])})),s}return s(t?["left","right"]:["top","bottom"])}function os(t,e,i,s){const n=[];let o,a,r,l,h,c;for(o=0,a=t.length,h=0;o<a;++o){r=t[o],l=r.box,l.update(r.width||e.w,r.height||e.h,ns(r.horizontal,e));const{same:a,other:d}=ss(e,i,r,s);h|=a&&n.length,c=c||d,l.fullSize||n.push(r)}return h&&os(n,e,i,s)||c}function as(t,e,i,s,n){t.top=i,t.left=e,t.right=e+s,t.bottom=i+n,t.width=s,t.height=n}function rs(t,e,i,s){const n=i.padding;let{x:o,y:a}=e;for(const r of t){const t=r.box,l=s[r.stack]||{count:1,placed:0,weight:1},h=r.stackWeight/l.weight||1;if(r.horizontal){const s=e.w*h,o=l.size||t.height;k(l.start)&&(a=l.start),t.fullSize?as(t,n.left,a,i.outerWidth-n.right-n.left,o):as(t,e.left+l.placed,a,s,o),l.start=a,l.placed+=s,a=t.bottom}else{const s=e.h*h,a=l.size||t.width;k(l.start)&&(o=l.start),t.fullSize?as(t,o,n.top,a,i.outerHeight-n.bottom-n.top):as(t,o,e.top+l.placed,a,s),l.start=o,l.placed+=s,o=t.right}}e.x=o,e.y=a}var ls={addBox(t,e){t.boxes||(t.boxes=[]),e.fullSize=e.fullSize||!1,e.position=e.position||"top",e.weight=e.weight||0,e._layers=e._layers||function(){return[{z:0,draw(t){e.draw(t)}}]},t.boxes.push(e)},removeBox(t,e){const i=t.boxes?t.boxes.indexOf(e):-1;-1!==i&&t.boxes.splice(i,1)},configure(t,e,i){e.fullSize=i.fullSize,e.position=i.position,e.weight=i.weight},update(t,e,i,s){if(!t)return;const n=ki(t.options.layout.padding),o=Math.max(e-n.width,0),a=Math.max(i-n.height,0),r=function(t){const e=function(t){const e=[];let i,s,n,o,a,r;for(i=0,s=(t||[]).length;i<s;++i)n=t[i],({position:o,options:{stack:a,stackWeight:r=1}}=n),e.push({index:i,box:n,pos:o,horizontal:n.isHorizontal(),weight:n.weight,stack:a&&o+a,stackWeight:r});return e}(t),i=Qi(e.filter((t=>t.box.fullSize)),!0),s=Qi(Ji(e,"left"),!0),n=Qi(Ji(e,"right")),o=Qi(Ji(e,"top"),!0),a=Qi(Ji(e,"bottom")),r=Zi(e,"x"),l=Zi(e,"y");return{fullSize:i,leftAndTop:s.concat(o),rightAndBottom:n.concat(l).concat(a).concat(r),chartArea:Ji(e,"chartArea"),vertical:s.concat(n).concat(l),horizontal:o.concat(a).concat(r)}}(t.boxes),l=r.vertical,h=r.horizontal;u(t.boxes,(t=>{"function"==typeof t.beforeLayout&&t.beforeLayout()}));const c=l.reduce(((t,e)=>e.box.options&&!1===e.box.options.display?t:t+1),0)||1,d=Object.freeze({outerWidth:e,outerHeight:i,padding:n,availableWidth:o,availableHeight:a,vBoxMaxWidth:o/2/c,hBoxMaxHeight:a/2}),f=Object.assign({},n);is(f,ki(s));const g=Object.assign({maxPadding:f,w:o,h:a,x:n.left,y:n.top},n),p=ts(l.concat(h),d);os(r.fullSize,g,d,p),os(l,g,d,p),os(h,g,d,p)&&os(l,g,d,p),function(t){const e=t.maxPadding;function i(i){const s=Math.max(e[i]-t[i],0);return t[i]+=s,s}t.y+=i("top"),t.x+=i("left"),i("right"),i("bottom")}(g),rs(r.leftAndTop,g,d,p),g.x+=g.w,g.y+=g.h,rs(r.rightAndBottom,g,d,p),t.chartArea={left:g.left,top:g.top,right:g.left+g.w,bottom:g.top+g.h,height:g.h,width:g.w},u(r.chartArea,(e=>{const i=e.box;Object.assign(i,t.chartArea),i.update(g.w,g.h,{left:0,top:0,right:0,bottom:0})}))}};class hs{acquireContext(t,e){}releaseContext(t){return!1}addEventListener(t,e,i){}removeEventListener(t,e,i){}getDevicePixelRatio(){return 1}getMaximumSize(t,e,i,s){return e=Math.max(0,e||t.width),i=i||t.height,{width:e,height:Math.max(0,s?Math.floor(e/s):i)}}isAttached(t){return!0}updateConfig(t){}}class cs extends hs{acquireContext(t){return t&&t.getContext&&t.getContext("2d")||null}updateConfig(t){t.options.animation=!1}}const ds="$chartjs",us={touchstart:"mousedown",touchmove:"mousemove",touchend:"mouseup",pointerenter:"mouseenter",pointerdown:"mousedown",pointermove:"mousemove",pointerup:"mouseup",pointerleave:"mouseout",pointerout:"mouseout"},fs=t=>null===t||""===t;const gs=!!Se&&{passive:!0};function ps(t,e,i){t&&t.canvas&&t.canvas.removeEventListener(e,i,gs)}function ms(t,e){for(const i of t)if(i===e||i.contains(e))return!0}function xs(t,e,i){const s=t.canvas,n=new MutationObserver((t=>{let e=!1;for(const i of t)e=e||ms(i.addedNodes,s),e=e&&!ms(i.removedNodes,s);e&&i()}));return n.observe(document,{childList:!0,subtree:!0}),n}function bs(t,e,i){const s=t.canvas,n=new MutationObserver((t=>{let e=!1;for(const i of t)e=e||ms(i.removedNodes,s),e=e&&!ms(i.addedNodes,s);e&&i()}));return n.observe(document,{childList:!0,subtree:!0}),n}const _s=new Map;let ys=0;function vs(){const t=window.devicePixelRatio;t!==ys&&(ys=t,_s.forEach(((e,i)=>{i.currentDevicePixelRatio!==t&&e()})))}function Ms(t,e,i){const s=t.canvas,n=s&&ge(s);if(!n)return;const o=ct(((t,e)=>{const s=n.clientWidth;i(t,e),s<n.clientWidth&&i()}),window),a=new ResizeObserver((t=>{const e=t[0],i=e.contentRect.width,s=e.contentRect.height;0===i&&0===s||o(i,s)}));return a.observe(n),function(t,e){_s.size||window.addEventListener("resize",vs),_s.set(t,e)}(t,o),a}function ws(t,e,i){i&&i.disconnect(),"resize"===e&&function(t){_s.delete(t),_s.size||window.removeEventListener("resize",vs)}(t)}function ks(t,e,i){const s=t.canvas,n=ct((e=>{null!==t.ctx&&i(function(t,e){const i=us[t.type]||t.type,{x:s,y:n}=ve(t,e);return{type:i,chart:e,native:t,x:void 0!==s?s:null,y:void 0!==n?n:null}}(e,t))}),t);return function(t,e,i){t&&t.addEventListener(e,i,gs)}(s,e,n),n}class Ss extends hs{acquireContext(t,e){const i=t&&t.getContext&&t.getContext("2d");return i&&i.canvas===t?(function(t,e){const i=t.style,s=t.getAttribute("height"),n=t.getAttribute("width");if(t[ds]={initial:{height:s,width:n,style:{display:i.display,height:i.height,width:i.width}}},i.display=i.display||"block",i.boxSizing=i.boxSizing||"border-box",fs(n)){const e=Pe(t,"width");void 0!==e&&(t.width=e)}if(fs(s))if(""===t.style.height)t.height=t.width/(e||2);else{const e=Pe(t,"height");void 0!==e&&(t.height=e)}}(t,e),i):null}releaseContext(t){const e=t.canvas;if(!e[ds])return!1;const i=e[ds].initial;["height","width"].forEach((t=>{const n=i[t];s(n)?e.removeAttribute(t):e.setAttribute(t,n)}));const n=i.style||{};return Object.keys(n).forEach((t=>{e.style[t]=n[t]})),e.width=e.width,delete e[ds],!0}addEventListener(t,e,i){this.removeEventListener(t,e);const s=t.$proxies||(t.$proxies={}),n={attach:xs,detach:bs,resize:Ms}[e]||ks;s[e]=n(t,e,i)}removeEventListener(t,e){const i=t.$proxies||(t.$proxies={}),s=i[e];if(!s)return;({attach:ws,detach:ws,resize:ws}[e]||ps)(t,e,s),i[e]=void 0}getDevicePixelRatio(){return window.devicePixelRatio}getMaximumSize(t,e,i,s){return we(t,e,i,s)}isAttached(t){const e=t&&ge(t);return!(!e||!e.isConnected)}}function Ps(t){return!fe()||"undefined"!=typeof OffscreenCanvas&&t instanceof OffscreenCanvas?cs:Ss}var Ds=Object.freeze({__proto__:null,BasePlatform:hs,BasicPlatform:cs,DomPlatform:Ss,_detectPlatform:Ps});const Cs="transparent",Os={boolean:(t,e,i)=>i>.5?e:t,color(t,e,i){const s=Qt(t||Cs),n=s.valid&&Qt(e||Cs);return n&&n.valid?n.mix(s,i).hexString():e},number:(t,e,i)=>t+(e-t)*i};class As{constructor(t,e,i,s){const n=e[i];s=Pi([t.to,s,n,t.from]);const o=Pi([t.from,n,s]);this._active=!0,this._fn=t.fn||Os[t.type||typeof o],this._easing=fi[t.easing]||fi.linear,this._start=Math.floor(Date.now()+(t.delay||0)),this._duration=this._total=Math.floor(t.duration),this._loop=!!t.loop,this._target=e,this._prop=i,this._from=o,this._to=s,this._promises=void 0}active(){return this._active}update(t,e,i){if(this._active){this._notify(!1);const s=this._target[this._prop],n=i-this._start,o=this._duration-n;this._start=i,this._duration=Math.floor(Math.max(o,t.duration)),this._total+=n,this._loop=!!t.loop,this._to=Pi([t.to,e,s,t.from]),this._from=Pi([t.from,s,e])}}cancel(){this._active&&(this.tick(Date.now()),this._active=!1,this._notify(!1))}tick(t){const e=t-this._start,i=this._duration,s=this._prop,n=this._from,o=this._loop,a=this._to;let r;if(this._active=n!==a&&(o||e<i),!this._active)return this._target[s]=a,void this._notify(!0);e<0?this._target[s]=n:(r=e/i%2,r=o&&r>1?2-r:r,r=this._easing(Math.min(1,Math.max(0,r))),this._target[s]=this._fn(n,a,r))}wait(){const t=this._promises||(this._promises=[]);return new Promise(((e,i)=>{t.push({res:e,rej:i})}))}_notify(t){const e=t?"res":"rej",i=this._promises||[];for(let t=0;t<i.length;t++)i[t][e]()}}class Ts{constructor(t,e){this._chart=t,this._properties=new Map,this.configure(e)}configure(t){if(!o(t))return;const e=Object.keys(ue.animation),i=this._properties;Object.getOwnPropertyNames(t).forEach((s=>{const a=t[s];if(!o(a))return;const r={};for(const t of e)r[t]=a[t];(n(a.properties)&&a.properties||[s]).forEach((t=>{t!==s&&i.has(t)||i.set(t,r)}))}))}_animateOptions(t,e){const i=e.options,s=function(t,e){if(!e)return;let i=t.options;if(!i)return void(t.options=e);i.$shared&&(t.options=i=Object.assign({},i,{$shared:!1,$animations:{}}));return i}(t,i);if(!s)return[];const n=this._createAnimations(s,i);return i.$shared&&function(t,e){const i=[],s=Object.keys(e);for(let e=0;e<s.length;e++){const n=t[s[e]];n&&n.active()&&i.push(n.wait())}return Promise.all(i)}(t.options.$animations,i).then((()=>{t.options=i}),(()=>{})),n}_createAnimations(t,e){const i=this._properties,s=[],n=t.$animations||(t.$animations={}),o=Object.keys(e),a=Date.now();let r;for(r=o.length-1;r>=0;--r){const l=o[r];if("$"===l.charAt(0))continue;if("options"===l){s.push(...this._animateOptions(t,e));continue}const h=e[l];let c=n[l];const d=i.get(l);if(c){if(d&&c.active()){c.update(d,h,a);continue}c.cancel()}d&&d.duration?(n[l]=c=new As(d,t,l,h),s.push(c)):t[l]=h}return s}update(t,e){if(0===this._properties.size)return void Object.assign(t,e);const i=this._createAnimations(t,e);return i.length?(bt.add(this._chart,i),!0):void 0}}function Ls(t,e){const i=t&&t.options||{},s=i.reverse,n=void 0===i.min?e:0,o=void 0===i.max?e:0;return{start:s?o:n,end:s?n:o}}function Es(t,e){const i=[],s=t._getSortedDatasetMetas(e);let n,o;for(n=0,o=s.length;n<o;++n)i.push(s[n].index);return i}function Rs(t,e,i,s={}){const n=t.keys,o="single"===s.mode;let r,l,h,c;if(null===e)return;let d=!1;for(r=0,l=n.length;r<l;++r){if(h=+n[r],h===i){if(d=!0,s.all)continue;break}c=t.values[h],a(c)&&(o||0===e||F(e)===F(c))&&(e+=c)}return d||s.all?e:0}function Is(t,e){const i=t&&t.options.stacked;return i||void 0===i&&void 0!==e.stack}function zs(t,e,i){const s=t[e]||(t[e]={});return s[i]||(s[i]={})}function Fs(t,e,i,s){for(const n of e.getMatchingVisibleMetas(s).reverse()){const e=t[n.index];if(i&&e>0||!i&&e<0)return n.index}return null}function Vs(t,e){const{chart:i,_cachedMeta:s}=t,n=i._stacks||(i._stacks={}),{iScale:o,vScale:a,index:r}=s,l=o.axis,h=a.axis,c=function(t,e,i){return`${t.id}.${e.id}.${i.stack||i.type}`}(o,a,s),d=e.length;let u;for(let t=0;t<d;++t){const i=e[t],{[l]:o,[h]:d}=i;u=(i._stacks||(i._stacks={}))[h]=zs(n,c,o),u[r]=d,u._top=Fs(u,a,!0,s.type),u._bottom=Fs(u,a,!1,s.type);(u._visualValues||(u._visualValues={}))[r]=d}}function Bs(t,e){const i=t.scales;return Object.keys(i).filter((t=>i[t].axis===e)).shift()}function Ws(t,e){const i=t.controller.index,s=t.vScale&&t.vScale.axis;if(s){e=e||t._parsed;for(const t of e){const e=t._stacks;if(!e||void 0===e[s]||void 0===e[s][i])return;delete e[s][i],void 0!==e[s]._visualValues&&void 0!==e[s]._visualValues[i]&&delete e[s]._visualValues[i]}}}const Ns=t=>"reset"===t||"none"===t,Hs=(t,e)=>e?t:Object.assign({},t);class js{static defaults={};static datasetElementType=null;static dataElementType=null;constructor(t,e){this.chart=t,this._ctx=t.ctx,this.index=e,this._cachedDataOpts={},this._cachedMeta=this.getMeta(),this._type=this._cachedMeta.type,this.options=void 0,this._parsing=!1,this._data=void 0,this._objectData=void 0,this._sharedOptions=void 0,this._drawStart=void 0,this._drawCount=void 0,this.enableOptionSharing=!1,this.supportsDecimation=!1,this.$context=void 0,this._syncList=[],this.datasetElementType=new.target.datasetElementType,this.dataElementType=new.target.dataElementType,this.initialize()}initialize(){const t=this._cachedMeta;this.configure(),this.linkScales(),t._stacked=Is(t.vScale,t),this.addElements(),this.options.fill&&!this.chart.isPluginEnabled("filler")&&console.warn("Tried to use the 'fill' option without the 'Filler' plugin enabled. Please import and register the 'Filler' plugin and make sure it is not disabled in the options")}updateIndex(t){this.index!==t&&Ws(this._cachedMeta),this.index=t}linkScales(){const t=this.chart,e=this._cachedMeta,i=this.getDataset(),s=(t,e,i,s)=>"x"===t?e:"r"===t?s:i,n=e.xAxisID=l(i.xAxisID,Bs(t,"x")),o=e.yAxisID=l(i.yAxisID,Bs(t,"y")),a=e.rAxisID=l(i.rAxisID,Bs(t,"r")),r=e.indexAxis,h=e.iAxisID=s(r,n,o,a),c=e.vAxisID=s(r,o,n,a);e.xScale=this.getScaleForId(n),e.yScale=this.getScaleForId(o),e.rScale=this.getScaleForId(a),e.iScale=this.getScaleForId(h),e.vScale=this.getScaleForId(c)}getDataset(){return this.chart.data.datasets[this.index]}getMeta(){return this.chart.getDatasetMeta(this.index)}getScaleForId(t){return this.chart.scales[t]}_getOtherScale(t){const e=this._cachedMeta;return t===e.iScale?e.vScale:e.iScale}reset(){this._update("reset")}_destroy(){const t=this._cachedMeta;this._data&&rt(this._data,this),t._stacked&&Ws(t)}_dataCheck(){const t=this.getDataset(),e=t.data||(t.data=[]),i=this._data;if(o(e)){const t=this._cachedMeta;this._data=function(t,e){const{iScale:i,vScale:s}=e,n="x"===i.axis?"x":"y",o="x"===s.axis?"x":"y",a=Object.keys(t),r=new Array(a.length);let l,h,c;for(l=0,h=a.length;l<h;++l)c=a[l],r[l]={[n]:c,[o]:t[c]};return r}(e,t)}else if(i!==e){if(i){rt(i,this);const t=this._cachedMeta;Ws(t),t._parsed=[]}e&&Object.isExtensible(e)&&at(e,this),this._syncList=[],this._data=e}}addElements(){const t=this._cachedMeta;this._dataCheck(),this.datasetElementType&&(t.dataset=new this.datasetElementType)}buildOrUpdateElements(t){const e=this._cachedMeta,i=this.getDataset();let s=!1;this._dataCheck();const n=e._stacked;e._stacked=Is(e.vScale,e),e.stack!==i.stack&&(s=!0,Ws(e),e.stack=i.stack),this._resyncElements(t),(s||n!==e._stacked)&&(Vs(this,e._parsed),e._stacked=Is(e.vScale,e))}configure(){const t=this.chart.config,e=t.datasetScopeKeys(this._type),i=t.getOptionScopes(this.getDataset(),e,!0);this.options=t.createResolver(i,this.getContext()),this._parsing=this.options.parsing,this._cachedDataOpts={}}parse(t,e){const{_cachedMeta:i,_data:s}=this,{iScale:a,_stacked:r}=i,l=a.axis;let h,c,d,u=0===t&&e===s.length||i._sorted,f=t>0&&i._parsed[t-1];if(!1===this._parsing)i._parsed=s,i._sorted=!0,d=s;else{d=n(s[t])?this.parseArrayData(i,s,t,e):o(s[t])?this.parseObjectData(i,s,t,e):this.parsePrimitiveData(i,s,t,e);const a=()=>null===c[l]||f&&c[l]<f[l];for(h=0;h<e;++h)i._parsed[h+t]=c=d[h],u&&(a()&&(u=!1),f=c);i._sorted=u}r&&Vs(this,d)}parsePrimitiveData(t,e,i,s){const{iScale:n,vScale:o}=t,a=n.axis,r=o.axis,l=n.getLabels(),h=n===o,c=new Array(s);let d,u,f;for(d=0,u=s;d<u;++d)f=d+i,c[d]={[a]:h||n.parse(l[f],f),[r]:o.parse(e[f],f)};return c}parseArrayData(t,e,i,s){const{xScale:n,yScale:o}=t,a=new Array(s);let r,l,h,c;for(r=0,l=s;r<l;++r)h=r+i,c=e[h],a[r]={x:n.parse(c[0],h),y:o.parse(c[1],h)};return a}parseObjectData(t,e,i,s){const{xScale:n,yScale:o}=t,{xAxisKey:a="x",yAxisKey:r="y"}=this._parsing,l=new Array(s);let h,c,d,u;for(h=0,c=s;h<c;++h)d=h+i,u=e[d],l[h]={x:n.parse(M(u,a),d),y:o.parse(M(u,r),d)};return l}getParsed(t){return this._cachedMeta._parsed[t]}getDataElement(t){return this._cachedMeta.data[t]}applyStack(t,e,i){const s=this.chart,n=this._cachedMeta,o=e[t.axis];return Rs({keys:Es(s,!0),values:e._stacks[t.axis]._visualValues},o,n.index,{mode:i})}updateRangeFromParsed(t,e,i,s){const n=i[e.axis];let o=null===n?NaN:n;const a=s&&i._stacks[e.axis];s&&a&&(s.values=a,o=Rs(s,n,this._cachedMeta.index)),t.min=Math.min(t.min,o),t.max=Math.max(t.max,o)}getMinMax(t,e){const i=this._cachedMeta,s=i._parsed,n=i._sorted&&t===i.iScale,o=s.length,r=this._getOtherScale(t),l=((t,e,i)=>t&&!e.hidden&&e._stacked&&{keys:Es(i,!0),values:null})(e,i,this.chart),h={min:Number.POSITIVE_INFINITY,max:Number.NEGATIVE_INFINITY},{min:c,max:d}=function(t){const{min:e,max:i,minDefined:s,maxDefined:n}=t.getUserBounds();return{min:s?e:Number.NEGATIVE_INFINITY,max:n?i:Number.POSITIVE_INFINITY}}(r);let u,f;function g(){f=s[u];const e=f[r.axis];return!a(f[t.axis])||c>e||d<e}for(u=0;u<o&&(g()||(this.updateRangeFromParsed(h,t,f,l),!n));++u);if(n)for(u=o-1;u>=0;--u)if(!g()){this.updateRangeFromParsed(h,t,f,l);break}return h}getAllParsedValues(t){const e=this._cachedMeta._parsed,i=[];let s,n,o;for(s=0,n=e.length;s<n;++s)o=e[s][t.axis],a(o)&&i.push(o);return i}getMaxOverflow(){return!1}getLabelAndValue(t){const e=this._cachedMeta,i=e.iScale,s=e.vScale,n=this.getParsed(t);return{label:i?""+i.getLabelForValue(n[i.axis]):"",value:s?""+s.getLabelForValue(n[s.axis]):""}}_update(t){const e=this._cachedMeta;this.update(t||"default"),e._clip=function(t){let e,i,s,n;return o(t)?(e=t.top,i=t.right,s=t.bottom,n=t.left):e=i=s=n=t,{top:e,right:i,bottom:s,left:n,disabled:!1===t}}(l(this.options.clip,function(t,e,i){if(!1===i)return!1;const s=Ls(t,i),n=Ls(e,i);return{top:n.end,right:s.end,bottom:n.start,left:s.start}}(e.xScale,e.yScale,this.getMaxOverflow())))}update(t){}draw(){const t=this._ctx,e=this.chart,i=this._cachedMeta,s=i.data||[],n=e.chartArea,o=[],a=this._drawStart||0,r=this._drawCount||s.length-a,l=this.options.drawActiveElementsOnTop;let h;for(i.dataset&&i.dataset.draw(t,n,a,r),h=a;h<a+r;++h){const e=s[h];e.hidden||(e.active&&l?o.push(e):e.draw(t,n))}for(h=0;h<o.length;++h)o[h].draw(t,n)}getStyle(t,e){const i=e?"active":"default";return void 0===t&&this._cachedMeta.dataset?this.resolveDatasetElementOptions(i):this.resolveDataElementOptions(t||0,i)}getContext(t,e,i){const s=this.getDataset();let n;if(t>=0&&t<this._cachedMeta.data.length){const e=this._cachedMeta.data[t];n=e.$context||(e.$context=function(t,e,i){return Ci(t,{active:!1,dataIndex:e,parsed:void 0,raw:void 0,element:i,index:e,mode:"default",type:"data"})}(this.getContext(),t,e)),n.parsed=this.getParsed(t),n.raw=s.data[t],n.index=n.dataIndex=t}else n=this.$context||(this.$context=function(t,e){return Ci(t,{active:!1,dataset:void 0,datasetIndex:e,index:e,mode:"default",type:"dataset"})}(this.chart.getContext(),this.index)),n.dataset=s,n.index=n.datasetIndex=this.index;return n.active=!!e,n.mode=i,n}resolveDatasetElementOptions(t){return this._resolveElementOptions(this.datasetElementType.id,t)}resolveDataElementOptions(t,e){return this._resolveElementOptions(this.dataElementType.id,e,t)}_resolveElementOptions(t,e="default",i){const s="active"===e,n=this._cachedDataOpts,o=t+"-"+e,a=n[o],r=this.enableOptionSharing&&k(i);if(a)return Hs(a,r);const l=this.chart.config,h=l.datasetElementScopeKeys(this._type,t),c=s?[`${t}Hover`,"hover",t,""]:[t,""],d=l.getOptionScopes(this.getDataset(),h),u=Object.keys(ue.elements[t]),f=l.resolveNamedOptions(d,u,(()=>this.getContext(i,s,e)),c);return f.$shared&&(f.$shared=r,n[o]=Object.freeze(Hs(f,r))),f}_resolveAnimations(t,e,i){const s=this.chart,n=this._cachedDataOpts,o=`animation-${e}`,a=n[o];if(a)return a;let r;if(!1!==s.options.animation){const s=this.chart.config,n=s.datasetAnimationScopeKeys(this._type,e),o=s.getOptionScopes(this.getDataset(),n);r=s.createResolver(o,this.getContext(t,i,e))}const l=new Ts(s,r&&r.animations);return r&&r._cacheable&&(n[o]=Object.freeze(l)),l}getSharedOptions(t){if(t.$shared)return this._sharedOptions||(this._sharedOptions=Object.assign({},t))}includeOptions(t,e){return!e||Ns(t)||this.chart._animationsDisabled}_getSharedOptions(t,e){const i=this.resolveDataElementOptions(t,e),s=this._sharedOptions,n=this.getSharedOptions(i),o=this.includeOptions(e,n)||n!==s;return this.updateSharedOptions(n,e,i),{sharedOptions:n,includeOptions:o}}updateElement(t,e,i,s){Ns(s)?Object.assign(t,i):this._resolveAnimations(e,s).update(t,i)}updateSharedOptions(t,e,i){t&&!Ns(e)&&this._resolveAnimations(void 0,e).update(t,i)}_setStyle(t,e,i,s){t.active=s;const n=this.getStyle(e,s);this._resolveAnimations(e,i,s).update(t,{options:!s&&this.getSharedOptions(n)||n})}removeHoverStyle(t,e,i){this._setStyle(t,i,"active",!1)}setHoverStyle(t,e,i){this._setStyle(t,i,"active",!0)}_removeDatasetHoverStyle(){const t=this._cachedMeta.dataset;t&&this._setStyle(t,void 0,"active",!1)}_setDatasetHoverStyle(){const t=this._cachedMeta.dataset;t&&this._setStyle(t,void 0,"active",!0)}_resyncElements(t){const e=this._data,i=this._cachedMeta.data;for(const[t,e,i]of this._syncList)this[t](e,i);this._syncList=[];const s=i.length,n=e.length,o=Math.min(n,s);o&&this.parse(0,o),n>s?this._insertElements(s,n-s,t):n<s&&this._removeElements(n,s-n)}_insertElements(t,e,i=!0){const s=this._cachedMeta,n=s.data,o=t+e;let a;const r=t=>{for(t.length+=e,a=t.length-1;a>=o;a--)t[a]=t[a-e]};for(r(n),a=t;a<o;++a)n[a]=new this.dataElementType;this._parsing&&r(s._parsed),this.parse(t,e),i&&this.updateElements(n,t,e,"reset")}updateElements(t,e,i,s){}_removeElements(t,e){const i=this._cachedMeta;if(this._parsing){const s=i._parsed.splice(t,e);i._stacked&&Ws(i,s)}i.data.splice(t,e)}_sync(t){if(this._parsing)this._syncList.push(t);else{const[e,i,s]=t;this[e](i,s)}this.chart._dataChanges.push([this.index,...t])}_onDataPush(){const t=arguments.length;this._sync(["_insertElements",this.getDataset().data.length-t,t])}_onDataPop(){this._sync(["_removeElements",this._cachedMeta.data.length-1,1])}_onDataShift(){this._sync(["_removeElements",0,1])}_onDataSplice(t,e){e&&this._sync(["_removeElements",t,e]);const i=arguments.length-2;i&&this._sync(["_insertElements",t,i])}_onDataUnshift(){this._sync(["_insertElements",0,arguments.length])}}class $s{static defaults={};static defaultRoutes=void 0;x;y;active=!1;options;$animations;tooltipPosition(t){const{x:e,y:i}=this.getProps(["x","y"],t);return{x:e,y:i}}hasValue(){return N(this.x)&&N(this.y)}getProps(t,e){const i=this.$animations;if(!e||!i)return this;const s={};return t.forEach((t=>{s[t]=i[t]&&i[t].active()?i[t]._to:this[t]})),s}}function Ys(t,e){const i=t.options.ticks,n=function(t){const e=t.options.offset,i=t._tickSize(),s=t._length/i+(e?0:1),n=t._maxLength/i;return Math.floor(Math.min(s,n))}(t),o=Math.min(i.maxTicksLimit||n,n),a=i.major.enabled?function(t){const e=[];let i,s;for(i=0,s=t.length;i<s;i++)t[i].major&&e.push(i);return e}(e):[],r=a.length,l=a[0],h=a[r-1],c=[];if(r>o)return function(t,e,i,s){let n,o=0,a=i[0];for(s=Math.ceil(s),n=0;n<t.length;n++)n===a&&(e.push(t[n]),o++,a=i[o*s])}(e,c,a,r/o),c;const d=function(t,e,i){const s=function(t){const e=t.length;let i,s;if(e<2)return!1;for(s=t[0],i=1;i<e;++i)if(t[i]-t[i-1]!==s)return!1;return s}(t),n=e.length/i;if(!s)return Math.max(n,1);const o=W(s);for(let t=0,e=o.length-1;t<e;t++){const e=o[t];if(e>n)return e}return Math.max(n,1)}(a,e,o);if(r>0){let t,i;const n=r>1?Math.round((h-l)/(r-1)):null;for(Us(e,c,d,s(n)?0:l-n,l),t=0,i=r-1;t<i;t++)Us(e,c,d,a[t],a[t+1]);return Us(e,c,d,h,s(n)?e.length:h+n),c}return Us(e,c,d),c}function Us(t,e,i,s,n){const o=l(s,0),a=Math.min(l(n,t.length),t.length);let r,h,c,d=0;for(i=Math.ceil(i),n&&(r=n-s,i=r/Math.floor(r/i)),c=o;c<0;)d++,c=Math.round(o+d*i);for(h=Math.max(o,0);h<a;h++)h===c&&(e.push(t[h]),d++,c=Math.round(o+d*i))}const Xs=(t,e,i)=>"top"===e||"left"===e?t[e]+i:t[e]-i,qs=(t,e)=>Math.min(e||t,t);function Ks(t,e){const i=[],s=t.length/e,n=t.length;let o=0;for(;o<n;o+=s)i.push(t[Math.floor(o)]);return i}function Gs(t,e,i){const s=t.ticks.length,n=Math.min(e,s-1),o=t._startPixel,a=t._endPixel,r=1e-6;let l,h=t.getPixelForTick(n);if(!(i&&(l=1===s?Math.max(h-o,a-h):0===e?(t.getPixelForTick(1)-h)/2:(h-t.getPixelForTick(n-1))/2,h+=n<e?l:-l,h<o-r||h>a+r)))return h}function Js(t){return t.drawTicks?t.tickLength:0}function Zs(t,e){if(!t.display)return 0;const i=Si(t.font,e),s=ki(t.padding);return(n(t.text)?t.text.length:1)*i.lineHeight+s.height}function Qs(t,e,i){let s=ut(t);return(i&&"right"!==e||!i&&"right"===e)&&(s=(t=>"left"===t?"right":"right"===t?"left":t)(s)),s}class tn extends $s{constructor(t){super(),this.id=t.id,this.type=t.type,this.options=void 0,this.ctx=t.ctx,this.chart=t.chart,this.top=void 0,this.bottom=void 0,this.left=void 0,this.right=void 0,this.width=void 0,this.height=void 0,this._margins={left:0,right:0,top:0,bottom:0},this.maxWidth=void 0,this.maxHeight=void 0,this.paddingTop=void 0,this.paddingBottom=void 0,this.paddingLeft=void 0,this.paddingRight=void 0,this.axis=void 0,this.labelRotation=void 0,this.min=void 0,this.max=void 0,this._range=void 0,this.ticks=[],this._gridLineItems=null,this._labelItems=null,this._labelSizes=null,this._length=0,this._maxLength=0,this._longestTextCache={},this._startPixel=void 0,this._endPixel=void 0,this._reversePixels=!1,this._userMax=void 0,this._userMin=void 0,this._suggestedMax=void 0,this._suggestedMin=void 0,this._ticksLength=0,this._borderValue=0,this._cache={},this._dataLimitsCached=!1,this.$context=void 0}init(t){this.options=t.setContext(this.getContext()),this.axis=t.axis,this._userMin=this.parse(t.min),this._userMax=this.parse(t.max),this._suggestedMin=this.parse(t.suggestedMin),this._suggestedMax=this.parse(t.suggestedMax)}parse(t,e){return t}getUserBounds(){let{_userMin:t,_userMax:e,_suggestedMin:i,_suggestedMax:s}=this;return t=r(t,Number.POSITIVE_INFINITY),e=r(e,Number.NEGATIVE_INFINITY),i=r(i,Number.POSITIVE_INFINITY),s=r(s,Number.NEGATIVE_INFINITY),{min:r(t,i),max:r(e,s),minDefined:a(t),maxDefined:a(e)}}getMinMax(t){let e,{min:i,max:s,minDefined:n,maxDefined:o}=this.getUserBounds();if(n&&o)return{min:i,max:s};const a=this.getMatchingVisibleMetas();for(let r=0,l=a.length;r<l;++r)e=a[r].controller.getMinMax(this,t),n||(i=Math.min(i,e.min)),o||(s=Math.max(s,e.max));return i=o&&i>s?s:i,s=n&&i>s?i:s,{min:r(i,r(s,i)),max:r(s,r(i,s))}}getPadding(){return{left:this.paddingLeft||0,top:this.paddingTop||0,right:this.paddingRight||0,bottom:this.paddingBottom||0}}getTicks(){return this.ticks}getLabels(){const t=this.chart.data;return this.options.labels||(this.isHorizontal()?t.xLabels:t.yLabels)||t.labels||[]}getLabelItems(t=this.chart.chartArea){return this._labelItems||(this._labelItems=this._computeLabelItems(t))}beforeLayout(){this._cache={},this._dataLimitsCached=!1}beforeUpdate(){d(this.options.beforeUpdate,[this])}update(t,e,i){const{beginAtZero:s,grace:n,ticks:o}=this.options,a=o.sampleSize;this.beforeUpdate(),this.maxWidth=t,this.maxHeight=e,this._margins=i=Object.assign({left:0,right:0,top:0,bottom:0},i),this.ticks=null,this._labelSizes=null,this._gridLineItems=null,this._labelItems=null,this.beforeSetDimensions(),this.setDimensions(),this.afterSetDimensions(),this._maxLength=this.isHorizontal()?this.width+i.left+i.right:this.height+i.top+i.bottom,this._dataLimitsCached||(this.beforeDataLimits(),this.determineDataLimits(),this.afterDataLimits(),this._range=Di(this,n,s),this._dataLimitsCached=!0),this.beforeBuildTicks(),this.ticks=this.buildTicks()||[],this.afterBuildTicks();const r=a<this.ticks.length;this._convertTicksToLabels(r?Ks(this.ticks,a):this.ticks),this.configure(),this.beforeCalculateLabelRotation(),this.calculateLabelRotation(),this.afterCalculateLabelRotation(),o.display&&(o.autoSkip||"auto"===o.source)&&(this.ticks=Ys(this,this.ticks),this._labelSizes=null,this.afterAutoSkip()),r&&this._convertTicksToLabels(this.ticks),this.beforeFit(),this.fit(),this.afterFit(),this.afterUpdate()}configure(){let t,e,i=this.options.reverse;this.isHorizontal()?(t=this.left,e=this.right):(t=this.top,e=this.bottom,i=!i),this._startPixel=t,this._endPixel=e,this._reversePixels=i,this._length=e-t,this._alignToPixels=this.options.alignToPixels}afterUpdate(){d(this.options.afterUpdate,[this])}beforeSetDimensions(){d(this.options.beforeSetDimensions,[this])}setDimensions(){this.isHorizontal()?(this.width=this.maxWidth,this.left=0,this.right=this.width):(this.height=this.maxHeight,this.top=0,this.bottom=this.height),this.paddingLeft=0,this.paddingTop=0,this.paddingRight=0,this.paddingBottom=0}afterSetDimensions(){d(this.options.afterSetDimensions,[this])}_callHooks(t){this.chart.notifyPlugins(t,this.getContext()),d(this.options[t],[this])}beforeDataLimits(){this._callHooks("beforeDataLimits")}determineDataLimits(){}afterDataLimits(){this._callHooks("afterDataLimits")}beforeBuildTicks(){this._callHooks("beforeBuildTicks")}buildTicks(){return[]}afterBuildTicks(){this._callHooks("afterBuildTicks")}beforeTickToLabelConversion(){d(this.options.beforeTickToLabelConversion,[this])}generateTickLabels(t){const e=this.options.ticks;let i,s,n;for(i=0,s=t.length;i<s;i++)n=t[i],n.label=d(e.callback,[n.value,i,t],this)}afterTickToLabelConversion(){d(this.options.afterTickToLabelConversion,[this])}beforeCalculateLabelRotation(){d(this.options.beforeCalculateLabelRotation,[this])}calculateLabelRotation(){const t=this.options,e=t.ticks,i=qs(this.ticks.length,t.ticks.maxTicksLimit),s=e.minRotation||0,n=e.maxRotation;let o,a,r,l=s;if(!this._isVisible()||!e.display||s>=n||i<=1||!this.isHorizontal())return void(this.labelRotation=s);const h=this._getLabelSizes(),c=h.widest.width,d=h.highest.height,u=Z(this.chart.width-c,0,this.maxWidth);o=t.offset?this.maxWidth/i:u/(i-1),c+6>o&&(o=u/(i-(t.offset?.5:1)),a=this.maxHeight-Js(t.grid)-e.padding-Zs(t.title,this.chart.options.font),r=Math.sqrt(c*c+d*d),l=Y(Math.min(Math.asin(Z((h.highest.height+6)/o,-1,1)),Math.asin(Z(a/r,-1,1))-Math.asin(Z(d/r,-1,1)))),l=Math.max(s,Math.min(n,l))),this.labelRotation=l}afterCalculateLabelRotation(){d(this.options.afterCalculateLabelRotation,[this])}afterAutoSkip(){}beforeFit(){d(this.options.beforeFit,[this])}fit(){const t={width:0,height:0},{chart:e,options:{ticks:i,title:s,grid:n}}=this,o=this._isVisible(),a=this.isHorizontal();if(o){const o=Zs(s,e.options.font);if(a?(t.width=this.maxWidth,t.height=Js(n)+o):(t.height=this.maxHeight,t.width=Js(n)+o),i.display&&this.ticks.length){const{first:e,last:s,widest:n,highest:o}=this._getLabelSizes(),r=2*i.padding,l=$(this.labelRotation),h=Math.cos(l),c=Math.sin(l);if(a){const e=i.mirror?0:c*n.width+h*o.height;t.height=Math.min(this.maxHeight,t.height+e+r)}else{const e=i.mirror?0:h*n.width+c*o.height;t.width=Math.min(this.maxWidth,t.width+e+r)}this._calculatePadding(e,s,c,h)}}this._handleMargins(),a?(this.width=this._length=e.width-this._margins.left-this._margins.right,this.height=t.height):(this.width=t.width,this.height=this._length=e.height-this._margins.top-this._margins.bottom)}_calculatePadding(t,e,i,s){const{ticks:{align:n,padding:o},position:a}=this.options,r=0!==this.labelRotation,l="top"!==a&&"x"===this.axis;if(this.isHorizontal()){const a=this.getPixelForTick(0)-this.left,h=this.right-this.getPixelForTick(this.ticks.length-1);let c=0,d=0;r?l?(c=s*t.width,d=i*e.height):(c=i*t.height,d=s*e.width):"start"===n?d=e.width:"end"===n?c=t.width:"inner"!==n&&(c=t.width/2,d=e.width/2),this.paddingLeft=Math.max((c-a+o)*this.width/(this.width-a),0),this.paddingRight=Math.max((d-h+o)*this.width/(this.width-h),0)}else{let i=e.height/2,s=t.height/2;"start"===n?(i=0,s=t.height):"end"===n&&(i=e.height,s=0),this.paddingTop=i+o,this.paddingBottom=s+o}}_handleMargins(){this._margins&&(this._margins.left=Math.max(this.paddingLeft,this._margins.left),this._margins.top=Math.max(this.paddingTop,this._margins.top),this._margins.right=Math.max(this.paddingRight,this._margins.right),this._margins.bottom=Math.max(this.paddingBottom,this._margins.bottom))}afterFit(){d(this.options.afterFit,[this])}isHorizontal(){const{axis:t,position:e}=this.options;return"top"===e||"bottom"===e||"x"===t}isFullSize(){return this.options.fullSize}_convertTicksToLabels(t){let e,i;for(this.beforeTickToLabelConversion(),this.generateTickLabels(t),e=0,i=t.length;e<i;e++)s(t[e].label)&&(t.splice(e,1),i--,e--);this.afterTickToLabelConversion()}_getLabelSizes(){let t=this._labelSizes;if(!t){const e=this.options.ticks.sampleSize;let i=this.ticks;e<i.length&&(i=Ks(i,e)),this._labelSizes=t=this._computeLabelSizes(i,i.length,this.options.ticks.maxTicksLimit)}return t}_computeLabelSizes(t,e,i){const{ctx:o,_longestTextCache:a}=this,r=[],l=[],h=Math.floor(e/qs(e,i));let c,d,f,g,p,m,x,b,_,y,v,M=0,w=0;for(c=0;c<e;c+=h){if(g=t[c].label,p=this._resolveTickFontOptions(c),o.font=m=p.string,x=a[m]=a[m]||{data:{},gc:[]},b=p.lineHeight,_=y=0,s(g)||n(g)){if(n(g))for(d=0,f=g.length;d<f;++d)v=g[d],s(v)||n(v)||(_=Ce(o,x.data,x.gc,_,v),y+=b)}else _=Ce(o,x.data,x.gc,_,g),y=b;r.push(_),l.push(y),M=Math.max(_,M),w=Math.max(y,w)}!function(t,e){u(t,(t=>{const i=t.gc,s=i.length/2;let n;if(s>e){for(n=0;n<s;++n)delete t.data[i[n]];i.splice(0,s)}}))}(a,e);const k=r.indexOf(M),S=l.indexOf(w),P=t=>({width:r[t]||0,height:l[t]||0});return{first:P(0),last:P(e-1),widest:P(k),highest:P(S),widths:r,heights:l}}getLabelForValue(t){return t}getPixelForValue(t,e){return NaN}getValueForPixel(t){}getPixelForTick(t){const e=this.ticks;return t<0||t>e.length-1?null:this.getPixelForValue(e[t].value)}getPixelForDecimal(t){this._reversePixels&&(t=1-t);const e=this._startPixel+t*this._length;return Q(this._alignToPixels?Ae(this.chart,e,0):e)}getDecimalForPixel(t){const e=(t-this._startPixel)/this._length;return this._reversePixels?1-e:e}getBasePixel(){return this.getPixelForValue(this.getBaseValue())}getBaseValue(){const{min:t,max:e}=this;return t<0&&e<0?e:t>0&&e>0?t:0}getContext(t){const e=this.ticks||[];if(t>=0&&t<e.length){const i=e[t];return i.$context||(i.$context=function(t,e,i){return Ci(t,{tick:i,index:e,type:"tick"})}(this.getContext(),t,i))}return this.$context||(this.$context=Ci(this.chart.getContext(),{scale:this,type:"scale"}))}_tickSize(){const t=this.options.ticks,e=$(this.labelRotation),i=Math.abs(Math.cos(e)),s=Math.abs(Math.sin(e)),n=this._getLabelSizes(),o=t.autoSkipPadding||0,a=n?n.widest.width+o:0,r=n?n.highest.height+o:0;return this.isHorizontal()?r*i>a*s?a/i:r/s:r*s<a*i?r/i:a/s}_isVisible(){const t=this.options.display;return"auto"!==t?!!t:this.getMatchingVisibleMetas().length>0}_computeGridLineItems(t){const e=this.axis,i=this.chart,s=this.options,{grid:n,position:a,border:r}=s,h=n.offset,c=this.isHorizontal(),d=this.ticks.length+(h?1:0),u=Js(n),f=[],g=r.setContext(this.getContext()),p=g.display?g.width:0,m=p/2,x=function(t){return Ae(i,t,p)};let b,_,y,v,M,w,k,S,P,D,C,O;if("top"===a)b=x(this.bottom),w=this.bottom-u,S=b-m,D=x(t.top)+m,O=t.bottom;else if("bottom"===a)b=x(this.top),D=t.top,O=x(t.bottom)-m,w=b+m,S=this.top+u;else if("left"===a)b=x(this.right),M=this.right-u,k=b-m,P=x(t.left)+m,C=t.right;else if("right"===a)b=x(this.left),P=t.left,C=x(t.right)-m,M=b+m,k=this.left+u;else if("x"===e){if("center"===a)b=x((t.top+t.bottom)/2+.5);else if(o(a)){const t=Object.keys(a)[0],e=a[t];b=x(this.chart.scales[t].getPixelForValue(e))}D=t.top,O=t.bottom,w=b+m,S=w+u}else if("y"===e){if("center"===a)b=x((t.left+t.right)/2);else if(o(a)){const t=Object.keys(a)[0],e=a[t];b=x(this.chart.scales[t].getPixelForValue(e))}M=b-m,k=M-u,P=t.left,C=t.right}const A=l(s.ticks.maxTicksLimit,d),T=Math.max(1,Math.ceil(d/A));for(_=0;_<d;_+=T){const t=this.getContext(_),e=n.setContext(t),s=r.setContext(t),o=e.lineWidth,a=e.color,l=s.dash||[],d=s.dashOffset,u=e.tickWidth,g=e.tickColor,p=e.tickBorderDash||[],m=e.tickBorderDashOffset;y=Gs(this,_,h),void 0!==y&&(v=Ae(i,y,o),c?M=k=P=C=v:w=S=D=O=v,f.push({tx1:M,ty1:w,tx2:k,ty2:S,x1:P,y1:D,x2:C,y2:O,width:o,color:a,borderDash:l,borderDashOffset:d,tickWidth:u,tickColor:g,tickBorderDash:p,tickBorderDashOffset:m}))}return this._ticksLength=d,this._borderValue=b,f}_computeLabelItems(t){const e=this.axis,i=this.options,{position:s,ticks:a}=i,r=this.isHorizontal(),l=this.ticks,{align:h,crossAlign:c,padding:d,mirror:u}=a,f=Js(i.grid),g=f+d,p=u?-d:g,m=-$(this.labelRotation),x=[];let b,_,y,v,M,w,k,S,P,D,C,O,A="middle";if("top"===s)w=this.bottom-p,k=this._getXAxisLabelAlignment();else if("bottom"===s)w=this.top+p,k=this._getXAxisLabelAlignment();else if("left"===s){const t=this._getYAxisLabelAlignment(f);k=t.textAlign,M=t.x}else if("right"===s){const t=this._getYAxisLabelAlignment(f);k=t.textAlign,M=t.x}else if("x"===e){if("center"===s)w=(t.top+t.bottom)/2+g;else if(o(s)){const t=Object.keys(s)[0],e=s[t];w=this.chart.scales[t].getPixelForValue(e)+g}k=this._getXAxisLabelAlignment()}else if("y"===e){if("center"===s)M=(t.left+t.right)/2-g;else if(o(s)){const t=Object.keys(s)[0],e=s[t];M=this.chart.scales[t].getPixelForValue(e)}k=this._getYAxisLabelAlignment(f).textAlign}"y"===e&&("start"===h?A="top":"end"===h&&(A="bottom"));const T=this._getLabelSizes();for(b=0,_=l.length;b<_;++b){y=l[b],v=y.label;const t=a.setContext(this.getContext(b));S=this.getPixelForTick(b)+a.labelOffset,P=this._resolveTickFontOptions(b),D=P.lineHeight,C=n(v)?v.length:1;const e=C/2,i=t.color,o=t.textStrokeColor,h=t.textStrokeWidth;let d,f=k;if(r?(M=S,"inner"===k&&(f=b===_-1?this.options.reverse?"left":"right":0===b?this.options.reverse?"right":"left":"center"),O="top"===s?"near"===c||0!==m?-C*D+D/2:"center"===c?-T.highest.height/2-e*D+D:-T.highest.height+D/2:"near"===c||0!==m?D/2:"center"===c?T.highest.height/2-e*D:T.highest.height-C*D,u&&(O*=-1),0===m||t.showLabelBackdrop||(M+=D/2*Math.sin(m))):(w=S,O=(1-C)*D/2),t.showLabelBackdrop){const e=ki(t.backdropPadding),i=T.heights[b],s=T.widths[b];let n=O-e.top,o=0-e.left;switch(A){case"middle":n-=i/2;break;case"bottom":n-=i}switch(k){case"center":o-=s/2;break;case"right":o-=s;break;case"inner":b===_-1?o-=s:b>0&&(o-=s/2)}d={left:o,top:n,width:s+e.width,height:i+e.height,color:t.backdropColor}}x.push({label:v,font:P,textOffset:O,options:{rotation:m,color:i,strokeColor:o,strokeWidth:h,textAlign:f,textBaseline:A,translation:[M,w],backdrop:d}})}return x}_getXAxisLabelAlignment(){const{position:t,ticks:e}=this.options;if(-$(this.labelRotation))return"top"===t?"left":"right";let i="center";return"start"===e.align?i="left":"end"===e.align?i="right":"inner"===e.align&&(i="inner"),i}_getYAxisLabelAlignment(t){const{position:e,ticks:{crossAlign:i,mirror:s,padding:n}}=this.options,o=t+n,a=this._getLabelSizes().widest.width;let r,l;return"left"===e?s?(l=this.right+n,"near"===i?r="left":"center"===i?(r="center",l+=a/2):(r="right",l+=a)):(l=this.right-o,"near"===i?r="right":"center"===i?(r="center",l-=a/2):(r="left",l=this.left)):"right"===e?s?(l=this.left+n,"near"===i?r="right":"center"===i?(r="center",l-=a/2):(r="left",l-=a)):(l=this.left+o,"near"===i?r="left":"center"===i?(r="center",l+=a/2):(r="right",l=this.right)):r="right",{textAlign:r,x:l}}_computeLabelArea(){if(this.options.ticks.mirror)return;const t=this.chart,e=this.options.position;return"left"===e||"right"===e?{top:0,left:this.left,bottom:t.height,right:this.right}:"top"===e||"bottom"===e?{top:this.top,left:0,bottom:this.bottom,right:t.width}:void 0}drawBackground(){const{ctx:t,options:{backgroundColor:e},left:i,top:s,width:n,height:o}=this;e&&(t.save(),t.fillStyle=e,t.fillRect(i,s,n,o),t.restore())}getLineWidthForValue(t){const e=this.options.grid;if(!this._isVisible()||!e.display)return 0;const i=this.ticks.findIndex((e=>e.value===t));if(i>=0){return e.setContext(this.getContext(i)).lineWidth}return 0}drawGrid(t){const e=this.options.grid,i=this.ctx,s=this._gridLineItems||(this._gridLineItems=this._computeGridLineItems(t));let n,o;const a=(t,e,s)=>{s.width&&s.color&&(i.save(),i.lineWidth=s.width,i.strokeStyle=s.color,i.setLineDash(s.borderDash||[]),i.lineDashOffset=s.borderDashOffset,i.beginPath(),i.moveTo(t.x,t.y),i.lineTo(e.x,e.y),i.stroke(),i.restore())};if(e.display)for(n=0,o=s.length;n<o;++n){const t=s[n];e.drawOnChartArea&&a({x:t.x1,y:t.y1},{x:t.x2,y:t.y2},t),e.drawTicks&&a({x:t.tx1,y:t.ty1},{x:t.tx2,y:t.ty2},{color:t.tickColor,width:t.tickWidth,borderDash:t.tickBorderDash,borderDashOffset:t.tickBorderDashOffset})}}drawBorder(){const{chart:t,ctx:e,options:{border:i,grid:s}}=this,n=i.setContext(this.getContext()),o=i.display?n.width:0;if(!o)return;const a=s.setContext(this.getContext(0)).lineWidth,r=this._borderValue;let l,h,c,d;this.isHorizontal()?(l=Ae(t,this.left,o)-o/2,h=Ae(t,this.right,a)+a/2,c=d=r):(c=Ae(t,this.top,o)-o/2,d=Ae(t,this.bottom,a)+a/2,l=h=r),e.save(),e.lineWidth=n.width,e.strokeStyle=n.color,e.beginPath(),e.moveTo(l,c),e.lineTo(h,d),e.stroke(),e.restore()}drawLabels(t){if(!this.options.ticks.display)return;const e=this.ctx,i=this._computeLabelArea();i&&Ie(e,i);const s=this.getLabelItems(t);for(const t of s){const i=t.options,s=t.font;Ne(e,t.label,0,t.textOffset,s,i)}i&&ze(e)}drawTitle(){const{ctx:t,options:{position:e,title:i,reverse:s}}=this;if(!i.display)return;const a=Si(i.font),r=ki(i.padding),l=i.align;let h=a.lineHeight/2;"bottom"===e||"center"===e||o(e)?(h+=r.bottom,n(i.text)&&(h+=a.lineHeight*(i.text.length-1))):h+=r.top;const{titleX:c,titleY:d,maxWidth:u,rotation:f}=function(t,e,i,s){const{top:n,left:a,bottom:r,right:l,chart:h}=t,{chartArea:c,scales:d}=h;let u,f,g,p=0;const m=r-n,x=l-a;if(t.isHorizontal()){if(f=ft(s,a,l),o(i)){const t=Object.keys(i)[0],s=i[t];g=d[t].getPixelForValue(s)+m-e}else g="center"===i?(c.bottom+c.top)/2+m-e:Xs(t,i,e);u=l-a}else{if(o(i)){const t=Object.keys(i)[0],s=i[t];f=d[t].getPixelForValue(s)-x+e}else f="center"===i?(c.left+c.right)/2-x+e:Xs(t,i,e);g=ft(s,r,n),p="left"===i?-E:E}return{titleX:f,titleY:g,maxWidth:u,rotation:p}}(this,h,e,l);Ne(t,i.text,0,0,a,{color:i.color,maxWidth:u,rotation:f,textAlign:Qs(l,e,s),textBaseline:"middle",translation:[c,d]})}draw(t){this._isVisible()&&(this.drawBackground(),this.drawGrid(t),this.drawBorder(),this.drawTitle(),this.drawLabels(t))}_layers(){const t=this.options,e=t.ticks&&t.ticks.z||0,i=l(t.grid&&t.grid.z,-1),s=l(t.border&&t.border.z,0);return this._isVisible()&&this.draw===tn.prototype.draw?[{z:i,draw:t=>{this.drawBackground(),this.drawGrid(t),this.drawTitle()}},{z:s,draw:()=>{this.drawBorder()}},{z:e,draw:t=>{this.drawLabels(t)}}]:[{z:e,draw:t=>{this.draw(t)}}]}getMatchingVisibleMetas(t){const e=this.chart.getSortedVisibleDatasetMetas(),i=this.axis+"AxisID",s=[];let n,o;for(n=0,o=e.length;n<o;++n){const o=e[n];o[i]!==this.id||t&&o.type!==t||s.push(o)}return s}_resolveTickFontOptions(t){return Si(this.options.ticks.setContext(this.getContext(t)).font)}_maxDigits(){const t=this._resolveTickFontOptions(0).lineHeight;return(this.isHorizontal()?this.width:this.height)/t}}class en{constructor(t,e,i){this.type=t,this.scope=e,this.override=i,this.items=Object.create(null)}isForType(t){return Object.prototype.isPrototypeOf.call(this.type.prototype,t.prototype)}register(t){const e=Object.getPrototypeOf(t);let i;(function(t){return"id"in t&&"defaults"in t})(e)&&(i=this.register(e));const s=this.items,n=t.id,o=this.scope+"."+n;if(!n)throw new Error("class does not have id: "+t);return n in s||(s[n]=t,function(t,e,i){const s=x(Object.create(null),[i?ue.get(i):{},ue.get(e),t.defaults]);ue.set(e,s),t.defaultRoutes&&function(t,e){Object.keys(e).forEach((i=>{const s=i.split("."),n=s.pop(),o=[t].concat(s).join("."),a=e[i].split("."),r=a.pop(),l=a.join(".");ue.route(o,n,l,r)}))}(e,t.defaultRoutes);t.descriptors&&ue.describe(e,t.descriptors)}(t,o,i),this.override&&ue.override(t.id,t.overrides)),o}get(t){return this.items[t]}unregister(t){const e=this.items,i=t.id,s=this.scope;i in e&&delete e[i],s&&i in ue[s]&&(delete ue[s][i],this.override&&delete re[i])}}class sn{constructor(){this.controllers=new en(js,"datasets",!0),this.elements=new en($s,"elements"),this.plugins=new en(Object,"plugins"),this.scales=new en(tn,"scales"),this._typedRegistries=[this.controllers,this.scales,this.elements]}add(...t){this._each("register",t)}remove(...t){this._each("unregister",t)}addControllers(...t){this._each("register",t,this.controllers)}addElements(...t){this._each("register",t,this.elements)}addPlugins(...t){this._each("register",t,this.plugins)}addScales(...t){this._each("register",t,this.scales)}getController(t){return this._get(t,this.controllers,"controller")}getElement(t){return this._get(t,this.elements,"element")}getPlugin(t){return this._get(t,this.plugins,"plugin")}getScale(t){return this._get(t,this.scales,"scale")}removeControllers(...t){this._each("unregister",t,this.controllers)}removeElements(...t){this._each("unregister",t,this.elements)}removePlugins(...t){this._each("unregister",t,this.plugins)}removeScales(...t){this._each("unregister",t,this.scales)}_each(t,e,i){[...e].forEach((e=>{const s=i||this._getRegistryForType(e);i||s.isForType(e)||s===this.plugins&&e.id?this._exec(t,s,e):u(e,(e=>{const s=i||this._getRegistryForType(e);this._exec(t,s,e)}))}))}_exec(t,e,i){const s=w(t);d(i["before"+s],[],i),e[t](i),d(i["after"+s],[],i)}_getRegistryForType(t){for(let e=0;e<this._typedRegistries.length;e++){const i=this._typedRegistries[e];if(i.isForType(t))return i}return this.plugins}_get(t,e,i){const s=e.get(t);if(void 0===s)throw new Error('"'+t+'" is not a registered '+i+".");return s}}var nn=new sn;class on{constructor(){this._init=void 0}notify(t,e,i,s){if("beforeInit"===e&&(this._init=this._createDescriptors(t,!0),this._notify(this._init,t,"install")),void 0===this._init)return;const n=s?this._descriptors(t).filter(s):this._descriptors(t),o=this._notify(n,t,e,i);return"afterDestroy"===e&&(this._notify(n,t,"stop"),this._notify(this._init,t,"uninstall"),this._init=void 0),o}_notify(t,e,i,s){s=s||{};for(const n of t){const t=n.plugin;if(!1===d(t[i],[e,s,n.options],t)&&s.cancelable)return!1}return!0}invalidate(){s(this._cache)||(this._oldCache=this._cache,this._cache=void 0)}_descriptors(t){if(this._cache)return this._cache;const e=this._cache=this._createDescriptors(t);return this._notifyStateChanges(t),e}_createDescriptors(t,e){const i=t&&t.config,s=l(i.options&&i.options.plugins,{}),n=function(t){const e={},i=[],s=Object.keys(nn.plugins.items);for(let t=0;t<s.length;t++)i.push(nn.getPlugin(s[t]));const n=t.plugins||[];for(let t=0;t<n.length;t++){const s=n[t];-1===i.indexOf(s)&&(i.push(s),e[s.id]=!0)}return{plugins:i,localIds:e}}(i);return!1!==s||e?function(t,{plugins:e,localIds:i},s,n){const o=[],a=t.getContext();for(const r of e){const e=r.id,l=an(s[e],n);null!==l&&o.push({plugin:r,options:rn(t.config,{plugin:r,local:i[e]},l,a)})}return o}(t,n,s,e):[]}_notifyStateChanges(t){const e=this._oldCache||[],i=this._cache,s=(t,e)=>t.filter((t=>!e.some((e=>t.plugin.id===e.plugin.id))));this._notify(s(e,i),t,"stop"),this._notify(s(i,e),t,"start")}}function an(t,e){return e||!1!==t?!0===t?{}:t:null}function rn(t,{plugin:e,local:i},s,n){const o=t.pluginScopeKeys(e),a=t.getOptionScopes(s,o);return i&&e.defaults&&a.push(e.defaults),t.createResolver(a,n,[""],{scriptable:!1,indexable:!1,allKeys:!0})}function ln(t,e){const i=ue.datasets[t]||{};return((e.datasets||{})[t]||{}).indexAxis||e.indexAxis||i.indexAxis||"x"}function hn(t){if("x"===t||"y"===t||"r"===t)return t}function cn(t,...e){if(hn(t))return t;for(const s of e){const e=s.axis||("top"===(i=s.position)||"bottom"===i?"x":"left"===i||"right"===i?"y":void 0)||t.length>1&&hn(t[0].toLowerCase());if(e)return e}var i;throw new Error(`Cannot determine type of '${t}' axis. Please provide 'axis' or 'position' option.`)}function dn(t,e,i){if(i[e+"AxisID"]===t)return{axis:e}}function un(t,e){const i=re[t.type]||{scales:{}},s=e.scales||{},n=ln(t.type,e),a=Object.create(null);return Object.keys(s).forEach((e=>{const r=s[e];if(!o(r))return console.error(`Invalid scale configuration for scale: ${e}`);if(r._proxy)return console.warn(`Ignoring resolver passed as options for scale: ${e}`);const l=cn(e,r,function(t,e){if(e.data&&e.data.datasets){const i=e.data.datasets.filter((e=>e.xAxisID===t||e.yAxisID===t));if(i.length)return dn(t,"x",i[0])||dn(t,"y",i[0])}return{}}(e,t),ue.scales[r.type]),h=function(t,e){return t===e?"_index_":"_value_"}(l,n),c=i.scales||{};a[e]=b(Object.create(null),[{axis:l},r,c[l],c[h]])})),t.data.datasets.forEach((i=>{const n=i.type||t.type,o=i.indexAxis||ln(n,e),r=(re[n]||{}).scales||{};Object.keys(r).forEach((t=>{const e=function(t,e){let i=t;return"_index_"===t?i=e:"_value_"===t&&(i="x"===e?"y":"x"),i}(t,o),n=i[e+"AxisID"]||e;a[n]=a[n]||Object.create(null),b(a[n],[{axis:e},s[n],r[t]])}))})),Object.keys(a).forEach((t=>{const e=a[t];b(e,[ue.scales[e.type],ue.scale])})),a}function fn(t){const e=t.options||(t.options={});e.plugins=l(e.plugins,{}),e.scales=un(t,e)}function gn(t){return(t=t||{}).datasets=t.datasets||[],t.labels=t.labels||[],t}const pn=new Map,mn=new Set;function xn(t,e){let i=pn.get(t);return i||(i=e(),pn.set(t,i),mn.add(i)),i}const bn=(t,e,i)=>{const s=M(e,i);void 0!==s&&t.add(s)};class _n{constructor(t){this._config=function(t){return(t=t||{}).data=gn(t.data),fn(t),t}(t),this._scopeCache=new Map,this._resolverCache=new Map}get platform(){return this._config.platform}get type(){return this._config.type}set type(t){this._config.type=t}get data(){return this._config.data}set data(t){this._config.data=gn(t)}get options(){return this._config.options}set options(t){this._config.options=t}get plugins(){return this._config.plugins}update(){const t=this._config;this.clearCache(),fn(t)}clearCache(){this._scopeCache.clear(),this._resolverCache.clear()}datasetScopeKeys(t){return xn(t,(()=>[[`datasets.${t}`,""]]))}datasetAnimationScopeKeys(t,e){return xn(`${t}.transition.${e}`,(()=>[[`datasets.${t}.transitions.${e}`,`transitions.${e}`],[`datasets.${t}`,""]]))}datasetElementScopeKeys(t,e){return xn(`${t}-${e}`,(()=>[[`datasets.${t}.elements.${e}`,`datasets.${t}`,`elements.${e}`,""]]))}pluginScopeKeys(t){const e=t.id;return xn(`${this.type}-plugin-${e}`,(()=>[[`plugins.${e}`,...t.additionalOptionScopes||[]]]))}_cachedScopes(t,e){const i=this._scopeCache;let s=i.get(t);return s&&!e||(s=new Map,i.set(t,s)),s}getOptionScopes(t,e,i){const{options:s,type:n}=this,o=this._cachedScopes(t,i),a=o.get(e);if(a)return a;const r=new Set;e.forEach((e=>{t&&(r.add(t),e.forEach((e=>bn(r,t,e)))),e.forEach((t=>bn(r,s,t))),e.forEach((t=>bn(r,re[n]||{},t))),e.forEach((t=>bn(r,ue,t))),e.forEach((t=>bn(r,le,t)))}));const l=Array.from(r);return 0===l.length&&l.push(Object.create(null)),mn.has(e)&&o.set(e,l),l}chartOptionScopes(){const{options:t,type:e}=this;return[t,re[e]||{},ue.datasets[e]||{},{type:e},ue,le]}resolveNamedOptions(t,e,i,s=[""]){const o={$shared:!0},{resolver:a,subPrefixes:r}=yn(this._resolverCache,t,s);let l=a;if(function(t,e){const{isScriptable:i,isIndexable:s}=Ye(t);for(const o of e){const e=i(o),a=s(o),r=(a||e)&&t[o];if(e&&(S(r)||vn(r))||a&&n(r))return!0}return!1}(a,e)){o.$shared=!1;l=$e(a,i=S(i)?i():i,this.createResolver(t,i,r))}for(const t of e)o[t]=l[t];return o}createResolver(t,e,i=[""],s){const{resolver:n}=yn(this._resolverCache,t,i);return o(e)?$e(n,e,void 0,s):n}}function yn(t,e,i){let s=t.get(e);s||(s=new Map,t.set(e,s));const n=i.join();let o=s.get(n);if(!o){o={resolver:je(e,i),subPrefixes:i.filter((t=>!t.toLowerCase().includes("hover")))},s.set(n,o)}return o}const vn=t=>o(t)&&Object.getOwnPropertyNames(t).some((e=>S(t[e])));const Mn=["top","bottom","left","right","chartArea"];function wn(t,e){return"top"===t||"bottom"===t||-1===Mn.indexOf(t)&&"x"===e}function kn(t,e){return function(i,s){return i[t]===s[t]?i[e]-s[e]:i[t]-s[t]}}function Sn(t){const e=t.chart,i=e.options.animation;e.notifyPlugins("afterRender"),d(i&&i.onComplete,[t],e)}function Pn(t){const e=t.chart,i=e.options.animation;d(i&&i.onProgress,[t],e)}function Dn(t){return fe()&&"string"==typeof t?t=document.getElementById(t):t&&t.length&&(t=t[0]),t&&t.canvas&&(t=t.canvas),t}const Cn={},On=t=>{const e=Dn(t);return Object.values(Cn).filter((t=>t.canvas===e)).pop()};function An(t,e,i){const s=Object.keys(t);for(const n of s){const s=+n;if(s>=e){const o=t[n];delete t[n],(i>0||s>e)&&(t[s+i]=o)}}}class Tn{static defaults=ue;static instances=Cn;static overrides=re;static registry=nn;static version="4.5.1";static getChart=On;static register(...t){nn.add(...t),Ln()}static unregister(...t){nn.remove(...t),Ln()}constructor(t,e){const s=this.config=new _n(e),n=Dn(t),o=On(n);if(o)throw new Error("Canvas is already in use. Chart with ID '"+o.id+"' must be destroyed before the canvas with ID '"+o.canvas.id+"' can be reused.");const a=s.createResolver(s.chartOptionScopes(),this.getContext());this.platform=new(s.platform||Ps(n)),this.platform.updateConfig(s);const r=this.platform.acquireContext(n,a.aspectRatio),l=r&&r.canvas,h=l&&l.height,c=l&&l.width;this.id=i(),this.ctx=r,this.canvas=l,this.width=c,this.height=h,this._options=a,this._aspectRatio=this.aspectRatio,this._layers=[],this._metasets=[],this._stacks=void 0,this.boxes=[],this.currentDevicePixelRatio=void 0,this.chartArea=void 0,this._active=[],this._lastEvent=void 0,this._listeners={},this._responsiveListeners=void 0,this._sortedMetasets=[],this.scales={},this._plugins=new on,this.$proxies={},this._hiddenIndices={},this.attached=!1,this._animationsDisabled=void 0,this.$context=void 0,this._doResize=dt((t=>this.update(t)),a.resizeDelay||0),this._dataChanges=[],Cn[this.id]=this,r&&l?(bt.listen(this,"complete",Sn),bt.listen(this,"progress",Pn),this._initialize(),this.attached&&this.update()):console.error("Failed to create chart: can't acquire context from the given item")}get aspectRatio(){const{options:{aspectRatio:t,maintainAspectRatio:e},width:i,height:n,_aspectRatio:o}=this;return s(t)?e&&o?o:n?i/n:null:t}get data(){return this.config.data}set data(t){this.config.data=t}get options(){return this._options}set options(t){this.config.options=t}get registry(){return nn}_initialize(){return this.notifyPlugins("beforeInit"),this.options.responsive?this.resize():ke(this,this.options.devicePixelRatio),this.bindEvents(),this.notifyPlugins("afterInit"),this}clear(){return Te(this.canvas,this.ctx),this}stop(){return bt.stop(this),this}resize(t,e){bt.running(this)?this._resizeBeforeDraw={width:t,height:e}:this._resize(t,e)}_resize(t,e){const i=this.options,s=this.canvas,n=i.maintainAspectRatio&&this.aspectRatio,o=this.platform.getMaximumSize(s,t,e,n),a=i.devicePixelRatio||this.platform.getDevicePixelRatio(),r=this.width?"resize":"attach";this.width=o.width,this.height=o.height,this._aspectRatio=this.aspectRatio,ke(this,a,!0)&&(this.notifyPlugins("resize",{size:o}),d(i.onResize,[this,o],this),this.attached&&this._doResize(r)&&this.render())}ensureScalesHaveIDs(){u(this.options.scales||{},((t,e)=>{t.id=e}))}buildOrUpdateScales(){const t=this.options,e=t.scales,i=this.scales,s=Object.keys(i).reduce(((t,e)=>(t[e]=!1,t)),{});let n=[];e&&(n=n.concat(Object.keys(e).map((t=>{const i=e[t],s=cn(t,i),n="r"===s,o="x"===s;return{options:i,dposition:n?"chartArea":o?"bottom":"left",dtype:n?"radialLinear":o?"category":"linear"}})))),u(n,(e=>{const n=e.options,o=n.id,a=cn(o,n),r=l(n.type,e.dtype);void 0!==n.position&&wn(n.position,a)===wn(e.dposition)||(n.position=e.dposition),s[o]=!0;let h=null;if(o in i&&i[o].type===r)h=i[o];else{h=new(nn.getScale(r))({id:o,type:r,ctx:this.ctx,chart:this}),i[h.id]=h}h.init(n,t)})),u(s,((t,e)=>{t||delete i[e]})),u(i,(t=>{ls.configure(this,t,t.options),ls.addBox(this,t)}))}_updateMetasets(){const t=this._metasets,e=this.data.datasets.length,i=t.length;if(t.sort(((t,e)=>t.index-e.index)),i>e){for(let t=e;t<i;++t)this._destroyDatasetMeta(t);t.splice(e,i-e)}this._sortedMetasets=t.slice(0).sort(kn("order","index"))}_removeUnreferencedMetasets(){const{_metasets:t,data:{datasets:e}}=this;t.length>e.length&&delete this._stacks,t.forEach(((t,i)=>{0===e.filter((e=>e===t._dataset)).length&&this._destroyDatasetMeta(i)}))}buildOrUpdateControllers(){const t=[],e=this.data.datasets;let i,s;for(this._removeUnreferencedMetasets(),i=0,s=e.length;i<s;i++){const s=e[i];let n=this.getDatasetMeta(i);const o=s.type||this.config.type;if(n.type&&n.type!==o&&(this._destroyDatasetMeta(i),n=this.getDatasetMeta(i)),n.type=o,n.indexAxis=s.indexAxis||ln(o,this.options),n.order=s.order||0,n.index=i,n.label=""+s.label,n.visible=this.isDatasetVisible(i),n.controller)n.controller.updateIndex(i),n.controller.linkScales();else{const e=nn.getController(o),{datasetElementType:s,dataElementType:a}=ue.datasets[o];Object.assign(e,{dataElementType:nn.getElement(a),datasetElementType:s&&nn.getElement(s)}),n.controller=new e(this,i),t.push(n.controller)}}return this._updateMetasets(),t}_resetElements(){u(this.data.datasets,((t,e)=>{this.getDatasetMeta(e).controller.reset()}),this)}reset(){this._resetElements(),this.notifyPlugins("reset")}update(t){const e=this.config;e.update();const i=this._options=e.createResolver(e.chartOptionScopes(),this.getContext()),s=this._animationsDisabled=!i.animation;if(this._updateScales(),this._checkEventBindings(),this._updateHiddenIndices(),this._plugins.invalidate(),!1===this.notifyPlugins("beforeUpdate",{mode:t,cancelable:!0}))return;const n=this.buildOrUpdateControllers();this.notifyPlugins("beforeElementsUpdate");let o=0;for(let t=0,e=this.data.datasets.length;t<e;t++){const{controller:e}=this.getDatasetMeta(t),i=!s&&-1===n.indexOf(e);e.buildOrUpdateElements(i),o=Math.max(+e.getMaxOverflow(),o)}o=this._minPadding=i.layout.autoPadding?o:0,this._updateLayout(o),s||u(n,(t=>{t.reset()})),this._updateDatasets(t),this.notifyPlugins("afterUpdate",{mode:t}),this._layers.sort(kn("z","_idx"));const{_active:a,_lastEvent:r}=this;r?this._eventHandler(r,!0):a.length&&this._updateHoverStyles(a,a,!0),this.render()}_updateScales(){u(this.scales,(t=>{ls.removeBox(this,t)})),this.ensureScalesHaveIDs(),this.buildOrUpdateScales()}_checkEventBindings(){const t=this.options,e=new Set(Object.keys(this._listeners)),i=new Set(t.events);P(e,i)&&!!this._responsiveListeners===t.responsive||(this.unbindEvents(),this.bindEvents())}_updateHiddenIndices(){const{_hiddenIndices:t}=this,e=this._getUniformDataChanges()||[];for(const{method:i,start:s,count:n}of e){An(t,s,"_removeElements"===i?-n:n)}}_getUniformDataChanges(){const t=this._dataChanges;if(!t||!t.length)return;this._dataChanges=[];const e=this.data.datasets.length,i=e=>new Set(t.filter((t=>t[0]===e)).map(((t,e)=>e+","+t.splice(1).join(",")))),s=i(0);for(let t=1;t<e;t++)if(!P(s,i(t)))return;return Array.from(s).map((t=>t.split(","))).map((t=>({method:t[1],start:+t[2],count:+t[3]})))}_updateLayout(t){if(!1===this.notifyPlugins("beforeLayout",{cancelable:!0}))return;ls.update(this,this.width,this.height,t);const e=this.chartArea,i=e.width<=0||e.height<=0;this._layers=[],u(this.boxes,(t=>{i&&"chartArea"===t.position||(t.configure&&t.configure(),this._layers.push(...t._layers()))}),this),this._layers.forEach(((t,e)=>{t._idx=e})),this.notifyPlugins("afterLayout")}_updateDatasets(t){if(!1!==this.notifyPlugins("beforeDatasetsUpdate",{mode:t,cancelable:!0})){for(let t=0,e=this.data.datasets.length;t<e;++t)this.getDatasetMeta(t).controller.configure();for(let e=0,i=this.data.datasets.length;e<i;++e)this._updateDataset(e,S(t)?t({datasetIndex:e}):t);this.notifyPlugins("afterDatasetsUpdate",{mode:t})}}_updateDataset(t,e){const i=this.getDatasetMeta(t),s={meta:i,index:t,mode:e,cancelable:!0};!1!==this.notifyPlugins("beforeDatasetUpdate",s)&&(i.controller._update(e),s.cancelable=!1,this.notifyPlugins("afterDatasetUpdate",s))}render(){!1!==this.notifyPlugins("beforeRender",{cancelable:!0})&&(bt.has(this)?this.attached&&!bt.running(this)&&bt.start(this):(this.draw(),Sn({chart:this})))}draw(){let t;if(this._resizeBeforeDraw){const{width:t,height:e}=this._resizeBeforeDraw;this._resizeBeforeDraw=null,this._resize(t,e)}if(this.clear(),this.width<=0||this.height<=0)return;if(!1===this.notifyPlugins("beforeDraw",{cancelable:!0}))return;const e=this._layers;for(t=0;t<e.length&&e[t].z<=0;++t)e[t].draw(this.chartArea);for(this._drawDatasets();t<e.length;++t)e[t].draw(this.chartArea);this.notifyPlugins("afterDraw")}_getSortedDatasetMetas(t){const e=this._sortedMetasets,i=[];let s,n;for(s=0,n=e.length;s<n;++s){const n=e[s];t&&!n.visible||i.push(n)}return i}getSortedVisibleDatasetMetas(){return this._getSortedDatasetMetas(!0)}_drawDatasets(){if(!1===this.notifyPlugins("beforeDatasetsDraw",{cancelable:!0}))return;const t=this.getSortedVisibleDatasetMetas();for(let e=t.length-1;e>=0;--e)this._drawDataset(t[e]);this.notifyPlugins("afterDatasetsDraw")}_drawDataset(t){const e=this.ctx,i={meta:t,index:t.index,cancelable:!0},s=Ni(this,t);!1!==this.notifyPlugins("beforeDatasetDraw",i)&&(s&&Ie(e,s),t.controller.draw(),s&&ze(e),i.cancelable=!1,this.notifyPlugins("afterDatasetDraw",i))}isPointInArea(t){return Re(t,this.chartArea,this._minPadding)}getElementsAtEventForMode(t,e,i,s){const n=Ki.modes[e];return"function"==typeof n?n(this,t,i,s):[]}getDatasetMeta(t){const e=this.data.datasets[t],i=this._metasets;let s=i.filter((t=>t&&t._dataset===e)).pop();return s||(s={type:null,data:[],dataset:null,controller:null,hidden:null,xAxisID:null,yAxisID:null,order:e&&e.order||0,index:t,_dataset:e,_parsed:[],_sorted:!1},i.push(s)),s}getContext(){return this.$context||(this.$context=Ci(null,{chart:this,type:"chart"}))}getVisibleDatasetCount(){return this.getSortedVisibleDatasetMetas().length}isDatasetVisible(t){const e=this.data.datasets[t];if(!e)return!1;const i=this.getDatasetMeta(t);return"boolean"==typeof i.hidden?!i.hidden:!e.hidden}setDatasetVisibility(t,e){this.getDatasetMeta(t).hidden=!e}toggleDataVisibility(t){this._hiddenIndices[t]=!this._hiddenIndices[t]}getDataVisibility(t){return!this._hiddenIndices[t]}_updateVisibility(t,e,i){const s=i?"show":"hide",n=this.getDatasetMeta(t),o=n.controller._resolveAnimations(void 0,s);k(e)?(n.data[e].hidden=!i,this.update()):(this.setDatasetVisibility(t,i),o.update(n,{visible:i}),this.update((e=>e.datasetIndex===t?s:void 0)))}hide(t,e){this._updateVisibility(t,e,!1)}show(t,e){this._updateVisibility(t,e,!0)}_destroyDatasetMeta(t){const e=this._metasets[t];e&&e.controller&&e.controller._destroy(),delete this._metasets[t]}_stop(){let t,e;for(this.stop(),bt.remove(this),t=0,e=this.data.datasets.length;t<e;++t)this._destroyDatasetMeta(t)}destroy(){this.notifyPlugins("beforeDestroy");const{canvas:t,ctx:e}=this;this._stop(),this.config.clearCache(),t&&(this.unbindEvents(),Te(t,e),this.platform.releaseContext(e),this.canvas=null,this.ctx=null),delete Cn[this.id],this.notifyPlugins("afterDestroy")}toBase64Image(...t){return this.canvas.toDataURL(...t)}bindEvents(){this.bindUserEvents(),this.options.responsive?this.bindResponsiveEvents():this.attached=!0}bindUserEvents(){const t=this._listeners,e=this.platform,i=(i,s)=>{e.addEventListener(this,i,s),t[i]=s},s=(t,e,i)=>{t.offsetX=e,t.offsetY=i,this._eventHandler(t)};u(this.options.events,(t=>i(t,s)))}bindResponsiveEvents(){this._responsiveListeners||(this._responsiveListeners={});const t=this._responsiveListeners,e=this.platform,i=(i,s)=>{e.addEventListener(this,i,s),t[i]=s},s=(i,s)=>{t[i]&&(e.removeEventListener(this,i,s),delete t[i])},n=(t,e)=>{this.canvas&&this.resize(t,e)};let o;const a=()=>{s("attach",a),this.attached=!0,this.resize(),i("resize",n),i("detach",o)};o=()=>{this.attached=!1,s("resize",n),this._stop(),this._resize(0,0),i("attach",a)},e.isAttached(this.canvas)?a():o()}unbindEvents(){u(this._listeners,((t,e)=>{this.platform.removeEventListener(this,e,t)})),this._listeners={},u(this._responsiveListeners,((t,e)=>{this.platform.removeEventListener(this,e,t)})),this._responsiveListeners=void 0}updateHoverStyle(t,e,i){const s=i?"set":"remove";let n,o,a,r;for("dataset"===e&&(n=this.getDatasetMeta(t[0].datasetIndex),n.controller["_"+s+"DatasetHoverStyle"]()),a=0,r=t.length;a<r;++a){o=t[a];const e=o&&this.getDatasetMeta(o.datasetIndex).controller;e&&e[s+"HoverStyle"](o.element,o.datasetIndex,o.index)}}getActiveElements(){return this._active||[]}setActiveElements(t){const e=this._active||[],i=t.map((({datasetIndex:t,index:e})=>{const i=this.getDatasetMeta(t);if(!i)throw new Error("No dataset found at index "+t);return{datasetIndex:t,element:i.data[e],index:e}}));!f(i,e)&&(this._active=i,this._lastEvent=null,this._updateHoverStyles(i,e))}notifyPlugins(t,e,i){return this._plugins.notify(this,t,e,i)}isPluginEnabled(t){return 1===this._plugins._cache.filter((e=>e.plugin.id===t)).length}_updateHoverStyles(t,e,i){const s=this.options.hover,n=(t,e)=>t.filter((t=>!e.some((e=>t.datasetIndex===e.datasetIndex&&t.index===e.index)))),o=n(e,t),a=i?t:n(t,e);o.length&&this.updateHoverStyle(o,s.mode,!1),a.length&&s.mode&&this.updateHoverStyle(a,s.mode,!0)}_eventHandler(t,e){const i={event:t,replay:e,cancelable:!0,inChartArea:this.isPointInArea(t)},s=e=>(e.options.events||this.options.events).includes(t.native.type);if(!1===this.notifyPlugins("beforeEvent",i,s))return;const n=this._handleEvent(t,e,i.inChartArea);return i.cancelable=!1,this.notifyPlugins("afterEvent",i,s),(n||i.changed)&&this.render(),this}_handleEvent(t,e,i){const{_active:s=[],options:n}=this,o=e,a=this._getActiveElements(t,s,i,o),r=D(t),l=function(t,e,i,s){return i&&"mouseout"!==t.type?s?e:t:null}(t,this._lastEvent,i,r);i&&(this._lastEvent=null,d(n.onHover,[t,a,this],this),r&&d(n.onClick,[t,a,this],this));const h=!f(a,s);return(h||e)&&(this._active=a,this._updateHoverStyles(a,s,e)),this._lastEvent=l,h}_getActiveElements(t,e,i,s){if("mouseout"===t.type)return[];if(!i)return e;const n=this.options.hover;return this.getElementsAtEventForMode(t,n.mode,n,s)}}function Ln(){return u(Tn.instances,(t=>t._plugins.invalidate()))}function En(){throw new Error("This method is not implemented: Check that a complete date adapter is provided.")}class Rn{static override(t){Object.assign(Rn.prototype,t)}options;constructor(t){this.options=t||{}}init(){}formats(){return En()}parse(){return En()}format(){return En()}add(){return En()}diff(){return En()}startOf(){return En()}endOf(){return En()}}var In={_date:Rn};function zn(t){const e=t.iScale,i=function(t,e){if(!t._cache.$bar){const i=t.getMatchingVisibleMetas(e);let s=[];for(let e=0,n=i.length;e<n;e++)s=s.concat(i[e].controller.getAllParsedValues(t));t._cache.$bar=lt(s.sort(((t,e)=>t-e)))}return t._cache.$bar}(e,t.type);let s,n,o,a,r=e._length;const l=()=>{32767!==o&&-32768!==o&&(k(a)&&(r=Math.min(r,Math.abs(o-a)||r)),a=o)};for(s=0,n=i.length;s<n;++s)o=e.getPixelForValue(i[s]),l();for(a=void 0,s=0,n=e.ticks.length;s<n;++s)o=e.getPixelForTick(s),l();return r}function Fn(t,e,i,s){return n(t)?function(t,e,i,s){const n=i.parse(t[0],s),o=i.parse(t[1],s),a=Math.min(n,o),r=Math.max(n,o);let l=a,h=r;Math.abs(a)>Math.abs(r)&&(l=r,h=a),e[i.axis]=h,e._custom={barStart:l,barEnd:h,start:n,end:o,min:a,max:r}}(t,e,i,s):e[i.axis]=i.parse(t,s),e}function Vn(t,e,i,s){const n=t.iScale,o=t.vScale,a=n.getLabels(),r=n===o,l=[];let h,c,d,u;for(h=i,c=i+s;h<c;++h)u=e[h],d={},d[n.axis]=r||n.parse(a[h],h),l.push(Fn(u,d,o,h));return l}function Bn(t){return t&&void 0!==t.barStart&&void 0!==t.barEnd}function Wn(t,e,i,s){let n=e.borderSkipped;const o={};if(!n)return void(t.borderSkipped=o);if(!0===n)return void(t.borderSkipped={top:!0,right:!0,bottom:!0,left:!0});const{start:a,end:r,reverse:l,top:h,bottom:c}=function(t){let e,i,s,n,o;return t.horizontal?(e=t.base>t.x,i="left",s="right"):(e=t.base<t.y,i="bottom",s="top"),e?(n="end",o="start"):(n="start",o="end"),{start:i,end:s,reverse:e,top:n,bottom:o}}(t);"middle"===n&&i&&(t.enableBorderRadius=!0,(i._top||0)===s?n=h:(i._bottom||0)===s?n=c:(o[Nn(c,a,r,l)]=!0,n=h)),o[Nn(n,a,r,l)]=!0,t.borderSkipped=o}function Nn(t,e,i,s){var n,o,a;return s?(a=i,t=Hn(t=(n=t)===(o=e)?a:n===a?o:n,i,e)):t=Hn(t,e,i),t}function Hn(t,e,i){return"start"===t?e:"end"===t?i:t}function jn(t,{inflateAmount:e},i){t.inflateAmount="auto"===e?1===i?.33:0:e}class $n extends js{static id="doughnut";static defaults={datasetElementType:!1,dataElementType:"arc",animation:{animateRotate:!0,animateScale:!1},animations:{numbers:{type:"number",properties:["circumference","endAngle","innerRadius","outerRadius","startAngle","x","y","offset","borderWidth","spacing"]}},cutout:"50%",rotation:0,circumference:360,radius:"100%",spacing:0,indexAxis:"r"};static descriptors={_scriptable:t=>"spacing"!==t,_indexable:t=>"spacing"!==t&&!t.startsWith("borderDash")&&!t.startsWith("hoverBorderDash")};static overrides={aspectRatio:1,plugins:{legend:{labels:{generateLabels(t){const e=t.data,{labels:{pointStyle:i,textAlign:s,color:n,useBorderRadius:o,borderRadius:a}}=t.legend.options;return e.labels.length&&e.datasets.length?e.labels.map(((e,r)=>{const l=t.getDatasetMeta(0).controller.getStyle(r);return{text:e,fillStyle:l.backgroundColor,fontColor:n,hidden:!t.getDataVisibility(r),lineDash:l.borderDash,lineDashOffset:l.borderDashOffset,lineJoin:l.borderJoinStyle,lineWidth:l.borderWidth,strokeStyle:l.borderColor,textAlign:s,pointStyle:i,borderRadius:o&&(a||l.borderRadius),index:r}})):[]}},onClick(t,e,i){i.chart.toggleDataVisibility(e.index),i.chart.update()}}}};constructor(t,e){super(t,e),this.enableOptionSharing=!0,this.innerRadius=void 0,this.outerRadius=void 0,this.offsetX=void 0,this.offsetY=void 0}linkScales(){}parse(t,e){const i=this.getDataset().data,s=this._cachedMeta;if(!1===this._parsing)s._parsed=i;else{let n,a,r=t=>+i[t];if(o(i[t])){const{key:t="value"}=this._parsing;r=e=>+M(i[e],t)}for(n=t,a=t+e;n<a;++n)s._parsed[n]=r(n)}}_getRotation(){return $(this.options.rotation-90)}_getCircumference(){return $(this.options.circumference)}_getRotationExtents(){let t=O,e=-O;for(let i=0;i<this.chart.data.datasets.length;++i)if(this.chart.isDatasetVisible(i)&&this.chart.getDatasetMeta(i).type===this._type){const s=this.chart.getDatasetMeta(i).controller,n=s._getRotation(),o=s._getCircumference();t=Math.min(t,n),e=Math.max(e,n+o)}return{rotation:t,circumference:e-t}}update(t){const e=this.chart,{chartArea:i}=e,s=this._cachedMeta,n=s.data,o=this.getMaxBorderWidth()+this.getMaxOffset(n)+this.options.spacing,a=Math.max((Math.min(i.width,i.height)-o)/2,0),r=Math.min(h(this.options.cutout,a),1),l=this._getRingWeight(this.index),{circumference:d,rotation:u}=this._getRotationExtents(),{ratioX:f,ratioY:g,offsetX:p,offsetY:m}=function(t,e,i){let s=1,n=1,o=0,a=0;if(e<O){const r=t,l=r+e,h=Math.cos(r),c=Math.sin(r),d=Math.cos(l),u=Math.sin(l),f=(t,e,s)=>J(t,r,l,!0)?1:Math.max(e,e*i,s,s*i),g=(t,e,s)=>J(t,r,l,!0)?-1:Math.min(e,e*i,s,s*i),p=f(0,h,d),m=f(E,c,u),x=g(C,h,d),b=g(C+E,c,u);s=(p-x)/2,n=(m-b)/2,o=-(p+x)/2,a=-(m+b)/2}return{ratioX:s,ratioY:n,offsetX:o,offsetY:a}}(u,d,r),x=(i.width-o)/f,b=(i.height-o)/g,_=Math.max(Math.min(x,b)/2,0),y=c(this.options.radius,_),v=(y-Math.max(y*r,0))/this._getVisibleDatasetWeightTotal();this.offsetX=p*y,this.offsetY=m*y,s.total=this.calculateTotal(),this.outerRadius=y-v*this._getRingWeightOffset(this.index),this.innerRadius=Math.max(this.outerRadius-v*l,0),this.updateElements(n,0,n.length,t)}_circumference(t,e){const i=this.options,s=this._cachedMeta,n=this._getCircumference();return e&&i.animation.animateRotate||!this.chart.getDataVisibility(t)||null===s._parsed[t]||s.data[t].hidden?0:this.calculateCircumference(s._parsed[t]*n/O)}updateElements(t,e,i,s){const n="reset"===s,o=this.chart,a=o.chartArea,r=o.options.animation,l=(a.left+a.right)/2,h=(a.top+a.bottom)/2,c=n&&r.animateScale,d=c?0:this.innerRadius,u=c?0:this.outerRadius,{sharedOptions:f,includeOptions:g}=this._getSharedOptions(e,s);let p,m=this._getRotation();for(p=0;p<e;++p)m+=this._circumference(p,n);for(p=e;p<e+i;++p){const e=this._circumference(p,n),i=t[p],o={x:l+this.offsetX,y:h+this.offsetY,startAngle:m,endAngle:m+e,circumference:e,outerRadius:u,innerRadius:d};g&&(o.options=f||this.resolveDataElementOptions(p,i.active?"active":s)),m+=e,this.updateElement(i,p,o,s)}}calculateTotal(){const t=this._cachedMeta,e=t.data;let i,s=0;for(i=0;i<e.length;i++){const n=t._parsed[i];null===n||isNaN(n)||!this.chart.getDataVisibility(i)||e[i].hidden||(s+=Math.abs(n))}return s}calculateCircumference(t){const e=this._cachedMeta.total;return e>0&&!isNaN(t)?O*(Math.abs(t)/e):0}getLabelAndValue(t){const e=this._cachedMeta,i=this.chart,s=i.data.labels||[],n=ne(e._parsed[t],i.options.locale);return{label:s[t]||"",value:n}}getMaxBorderWidth(t){let e=0;const i=this.chart;let s,n,o,a,r;if(!t)for(s=0,n=i.data.datasets.length;s<n;++s)if(i.isDatasetVisible(s)){o=i.getDatasetMeta(s),t=o.data,a=o.controller;break}if(!t)return 0;for(s=0,n=t.length;s<n;++s)r=a.resolveDataElementOptions(s),"inner"!==r.borderAlign&&(e=Math.max(e,r.borderWidth||0,r.hoverBorderWidth||0));return e}getMaxOffset(t){let e=0;for(let i=0,s=t.length;i<s;++i){const t=this.resolveDataElementOptions(i);e=Math.max(e,t.offset||0,t.hoverOffset||0)}return e}_getRingWeightOffset(t){let e=0;for(let i=0;i<t;++i)this.chart.isDatasetVisible(i)&&(e+=this._getRingWeight(i));return e}_getRingWeight(t){return Math.max(l(this.chart.data.datasets[t].weight,1),0)}_getVisibleDatasetWeightTotal(){return this._getRingWeightOffset(this.chart.data.datasets.length)||1}}class Yn extends js{static id="polarArea";static defaults={dataElementType:"arc",animation:{animateRotate:!0,animateScale:!0},animations:{numbers:{type:"number",properties:["x","y","startAngle","endAngle","innerRadius","outerRadius"]}},indexAxis:"r",startAngle:0};static overrides={aspectRatio:1,plugins:{legend:{labels:{generateLabels(t){const e=t.data;if(e.labels.length&&e.datasets.length){const{labels:{pointStyle:i,color:s}}=t.legend.options;return e.labels.map(((e,n)=>{const o=t.getDatasetMeta(0).controller.getStyle(n);return{text:e,fillStyle:o.backgroundColor,strokeStyle:o.borderColor,fontColor:s,lineWidth:o.borderWidth,pointStyle:i,hidden:!t.getDataVisibility(n),index:n}}))}return[]}},onClick(t,e,i){i.chart.toggleDataVisibility(e.index),i.chart.update()}}},scales:{r:{type:"radialLinear",angleLines:{display:!1},beginAtZero:!0,grid:{circular:!0},pointLabels:{display:!1},startAngle:0}}};constructor(t,e){super(t,e),this.innerRadius=void 0,this.outerRadius=void 0}getLabelAndValue(t){const e=this._cachedMeta,i=this.chart,s=i.data.labels||[],n=ne(e._parsed[t].r,i.options.locale);return{label:s[t]||"",value:n}}parseObjectData(t,e,i,s){return ii.bind(this)(t,e,i,s)}update(t){const e=this._cachedMeta.data;this._updateRadius(),this.updateElements(e,0,e.length,t)}getMinMax(){const t=this._cachedMeta,e={min:Number.POSITIVE_INFINITY,max:Number.NEGATIVE_INFINITY};return t.data.forEach(((t,i)=>{const s=this.getParsed(i).r;!isNaN(s)&&this.chart.getDataVisibility(i)&&(s<e.min&&(e.min=s),s>e.max&&(e.max=s))})),e}_updateRadius(){const t=this.chart,e=t.chartArea,i=t.options,s=Math.min(e.right-e.left,e.bottom-e.top),n=Math.max(s/2,0),o=(n-Math.max(i.cutoutPercentage?n/100*i.cutoutPercentage:1,0))/t.getVisibleDatasetCount();this.outerRadius=n-o*this.index,this.innerRadius=this.outerRadius-o}updateElements(t,e,i,s){const n="reset"===s,o=this.chart,a=o.options.animation,r=this._cachedMeta.rScale,l=r.xCenter,h=r.yCenter,c=r.getIndexAngle(0)-.5*C;let d,u=c;const f=360/this.countVisibleElements();for(d=0;d<e;++d)u+=this._computeAngle(d,s,f);for(d=e;d<e+i;d++){const e=t[d];let i=u,g=u+this._computeAngle(d,s,f),p=o.getDataVisibility(d)?r.getDistanceFromCenterForValue(this.getParsed(d).r):0;u=g,n&&(a.animateScale&&(p=0),a.animateRotate&&(i=g=c));const m={x:l,y:h,innerRadius:0,outerRadius:p,startAngle:i,endAngle:g,options:this.resolveDataElementOptions(d,e.active?"active":s)};this.updateElement(e,d,m,s)}}countVisibleElements(){const t=this._cachedMeta;let e=0;return t.data.forEach(((t,i)=>{!isNaN(this.getParsed(i).r)&&this.chart.getDataVisibility(i)&&e++})),e}_computeAngle(t,e,i){return this.chart.getDataVisibility(t)?$(this.resolveDataElementOptions(t,e).angle||i):0}}var Un=Object.freeze({__proto__:null,BarController:class extends js{static id="bar";static defaults={datasetElementType:!1,dataElementType:"bar",categoryPercentage:.8,barPercentage:.9,grouped:!0,animations:{numbers:{type:"number",properties:["x","y","base","width","height"]}}};static overrides={scales:{_index_:{type:"category",offset:!0,grid:{offset:!0}},_value_:{type:"linear",beginAtZero:!0}}};parsePrimitiveData(t,e,i,s){return Vn(t,e,i,s)}parseArrayData(t,e,i,s){return Vn(t,e,i,s)}parseObjectData(t,e,i,s){const{iScale:n,vScale:o}=t,{xAxisKey:a="x",yAxisKey:r="y"}=this._parsing,l="x"===n.axis?a:r,h="x"===o.axis?a:r,c=[];let d,u,f,g;for(d=i,u=i+s;d<u;++d)g=e[d],f={},f[n.axis]=n.parse(M(g,l),d),c.push(Fn(M(g,h),f,o,d));return c}updateRangeFromParsed(t,e,i,s){super.updateRangeFromParsed(t,e,i,s);const n=i._custom;n&&e===this._cachedMeta.vScale&&(t.min=Math.min(t.min,n.min),t.max=Math.max(t.max,n.max))}getMaxOverflow(){return 0}getLabelAndValue(t){const e=this._cachedMeta,{iScale:i,vScale:s}=e,n=this.getParsed(t),o=n._custom,a=Bn(o)?"["+o.start+", "+o.end+"]":""+s.getLabelForValue(n[s.axis]);return{label:""+i.getLabelForValue(n[i.axis]),value:a}}initialize(){this.enableOptionSharing=!0,super.initialize();this._cachedMeta.stack=this.getDataset().stack}update(t){const e=this._cachedMeta;this.updateElements(e.data,0,e.data.length,t)}updateElements(t,e,i,n){const o="reset"===n,{index:a,_cachedMeta:{vScale:r}}=this,l=r.getBasePixel(),h=r.isHorizontal(),c=this._getRuler(),{sharedOptions:d,includeOptions:u}=this._getSharedOptions(e,n);for(let f=e;f<e+i;f++){const e=this.getParsed(f),i=o||s(e[r.axis])?{base:l,head:l}:this._calculateBarValuePixels(f),g=this._calculateBarIndexPixels(f,c),p=(e._stacks||{})[r.axis],m={horizontal:h,base:i.base,enableBorderRadius:!p||Bn(e._custom)||a===p._top||a===p._bottom,x:h?i.head:g.center,y:h?g.center:i.head,height:h?g.size:Math.abs(i.size),width:h?Math.abs(i.size):g.size};u&&(m.options=d||this.resolveDataElementOptions(f,t[f].active?"active":n));const x=m.options||t[f].options;Wn(m,x,p,a),jn(m,x,c.ratio),this.updateElement(t[f],f,m,n)}}_getStacks(t,e){const{iScale:i}=this._cachedMeta,n=i.getMatchingVisibleMetas(this._type).filter((t=>t.controller.options.grouped)),o=i.options.stacked,a=[],r=this._cachedMeta.controller.getParsed(e),l=r&&r[i.axis],h=t=>{const e=t._parsed.find((t=>t[i.axis]===l)),n=e&&e[t.vScale.axis];if(s(n)||isNaN(n))return!0};for(const i of n)if((void 0===e||!h(i))&&((!1===o||-1===a.indexOf(i.stack)||void 0===o&&void 0===i.stack)&&a.push(i.stack),i.index===t))break;return a.length||a.push(void 0),a}_getStackCount(t){return this._getStacks(void 0,t).length}_getAxisCount(){return this._getAxis().length}getFirstScaleIdForIndexAxis(){const t=this.chart.scales,e=this.chart.options.indexAxis;return Object.keys(t).filter((i=>t[i].axis===e)).shift()}_getAxis(){const t={},e=this.getFirstScaleIdForIndexAxis();for(const i of this.chart.data.datasets)t[l("x"===this.chart.options.indexAxis?i.xAxisID:i.yAxisID,e)]=!0;return Object.keys(t)}_getStackIndex(t,e,i){const s=this._getStacks(t,i),n=void 0!==e?s.indexOf(e):-1;return-1===n?s.length-1:n}_getRuler(){const t=this.options,e=this._cachedMeta,i=e.iScale,s=[];let n,o;for(n=0,o=e.data.length;n<o;++n)s.push(i.getPixelForValue(this.getParsed(n)[i.axis],n));const a=t.barThickness;return{min:a||zn(e),pixels:s,start:i._startPixel,end:i._endPixel,stackCount:this._getStackCount(),scale:i,grouped:t.grouped,ratio:a?1:t.categoryPercentage*t.barPercentage}}_calculateBarValuePixels(t){const{_cachedMeta:{vScale:e,_stacked:i,index:n},options:{base:o,minBarLength:a}}=this,r=o||0,l=this.getParsed(t),h=l._custom,c=Bn(h);let d,u,f=l[e.axis],g=0,p=i?this.applyStack(e,l,i):f;p!==f&&(g=p-f,p=f),c&&(f=h.barStart,p=h.barEnd-h.barStart,0!==f&&F(f)!==F(h.barEnd)&&(g=0),g+=f);const m=s(o)||c?g:o;let x=e.getPixelForValue(m);if(d=this.chart.getDataVisibility(t)?e.getPixelForValue(g+p):x,u=d-x,Math.abs(u)<a){u=function(t,e,i){return 0!==t?F(t):(e.isHorizontal()?1:-1)*(e.min>=i?1:-1)}(u,e,r)*a,f===r&&(x-=u/2);const t=e.getPixelForDecimal(0),s=e.getPixelForDecimal(1),o=Math.min(t,s),h=Math.max(t,s);x=Math.max(Math.min(x,h),o),d=x+u,i&&!c&&(l._stacks[e.axis]._visualValues[n]=e.getValueForPixel(d)-e.getValueForPixel(x))}if(x===e.getPixelForValue(r)){const t=F(u)*e.getLineWidthForValue(r)/2;x+=t,u-=t}return{size:u,base:x,head:d,center:d+u/2}}_calculateBarIndexPixels(t,e){const i=e.scale,n=this.options,o=n.skipNull,a=l(n.maxBarThickness,1/0);let r,h;const c=this._getAxisCount();if(e.grouped){const i=o?this._getStackCount(t):e.stackCount,d="flex"===n.barThickness?function(t,e,i,s){const n=e.pixels,o=n[t];let a=t>0?n[t-1]:null,r=t<n.length-1?n[t+1]:null;const l=i.categoryPercentage;null===a&&(a=o-(null===r?e.end-e.start:r-o)),null===r&&(r=o+o-a);const h=o-(o-Math.min(a,r))/2*l;return{chunk:Math.abs(r-a)/2*l/s,ratio:i.barPercentage,start:h}}(t,e,n,i*c):function(t,e,i,n){const o=i.barThickness;let a,r;return s(o)?(a=e.min*i.categoryPercentage,r=i.barPercentage):(a=o*n,r=1),{chunk:a/n,ratio:r,start:e.pixels[t]-a/2}}(t,e,n,i*c),u="x"===this.chart.options.indexAxis?this.getDataset().xAxisID:this.getDataset().yAxisID,f=this._getAxis().indexOf(l(u,this.getFirstScaleIdForIndexAxis())),g=this._getStackIndex(this.index,this._cachedMeta.stack,o?t:void 0)+f;r=d.start+d.chunk*g+d.chunk/2,h=Math.min(a,d.chunk*d.ratio)}else r=i.getPixelForValue(this.getParsed(t)[i.axis],t),h=Math.min(a,e.min*e.ratio);return{base:r-h/2,head:r+h/2,center:r,size:h}}draw(){const t=this._cachedMeta,e=t.vScale,i=t.data,s=i.length;let n=0;for(;n<s;++n)null===this.getParsed(n)[e.axis]||i[n].hidden||i[n].draw(this._ctx)}},BubbleController:class extends js{static id="bubble";static defaults={datasetElementType:!1,dataElementType:"point",animations:{numbers:{type:"number",properties:["x","y","borderWidth","radius"]}}};static overrides={scales:{x:{type:"linear"},y:{type:"linear"}}};initialize(){this.enableOptionSharing=!0,super.initialize()}parsePrimitiveData(t,e,i,s){const n=super.parsePrimitiveData(t,e,i,s);for(let t=0;t<n.length;t++)n[t]._custom=this.resolveDataElementOptions(t+i).radius;return n}parseArrayData(t,e,i,s){const n=super.parseArrayData(t,e,i,s);for(let t=0;t<n.length;t++){const s=e[i+t];n[t]._custom=l(s[2],this.resolveDataElementOptions(t+i).radius)}return n}parseObjectData(t,e,i,s){const n=super.parseObjectData(t,e,i,s);for(let t=0;t<n.length;t++){const s=e[i+t];n[t]._custom=l(s&&s.r&&+s.r,this.resolveDataElementOptions(t+i).radius)}return n}getMaxOverflow(){const t=this._cachedMeta.data;let e=0;for(let i=t.length-1;i>=0;--i)e=Math.max(e,t[i].size(this.resolveDataElementOptions(i))/2);return e>0&&e}getLabelAndValue(t){const e=this._cachedMeta,i=this.chart.data.labels||[],{xScale:s,yScale:n}=e,o=this.getParsed(t),a=s.getLabelForValue(o.x),r=n.getLabelForValue(o.y),l=o._custom;return{label:i[t]||"",value:"("+a+", "+r+(l?", "+l:"")+")"}}update(t){const e=this._cachedMeta.data;this.updateElements(e,0,e.length,t)}updateElements(t,e,i,s){const n="reset"===s,{iScale:o,vScale:a}=this._cachedMeta,{sharedOptions:r,includeOptions:l}=this._getSharedOptions(e,s),h=o.axis,c=a.axis;for(let d=e;d<e+i;d++){const e=t[d],i=!n&&this.getParsed(d),u={},f=u[h]=n?o.getPixelForDecimal(.5):o.getPixelForValue(i[h]),g=u[c]=n?a.getBasePixel():a.getPixelForValue(i[c]);u.skip=isNaN(f)||isNaN(g),l&&(u.options=r||this.resolveDataElementOptions(d,e.active?"active":s),n&&(u.options.radius=0)),this.updateElement(e,d,u,s)}}resolveDataElementOptions(t,e){const i=this.getParsed(t);let s=super.resolveDataElementOptions(t,e);s.$shared&&(s=Object.assign({},s,{$shared:!1}));const n=s.radius;return"active"!==e&&(s.radius=0),s.radius+=l(i&&i._custom,n),s}},DoughnutController:$n,LineController:class extends js{static id="line";static defaults={datasetElementType:"line",dataElementType:"point",showLine:!0,spanGaps:!1};static overrides={scales:{_index_:{type:"category"},_value_:{type:"linear"}}};initialize(){this.enableOptionSharing=!0,this.supportsDecimation=!0,super.initialize()}update(t){const e=this._cachedMeta,{dataset:i,data:s=[],_dataset:n}=e,o=this.chart._animationsDisabled;let{start:a,count:r}=pt(e,s,o);this._drawStart=a,this._drawCount=r,mt(e)&&(a=0,r=s.length),i._chart=this.chart,i._datasetIndex=this.index,i._decimated=!!n._decimated,i.points=s;const l=this.resolveDatasetElementOptions(t);this.options.showLine||(l.borderWidth=0),l.segment=this.options.segment,this.updateElement(i,void 0,{animated:!o,options:l},t),this.updateElements(s,a,r,t)}updateElements(t,e,i,n){const o="reset"===n,{iScale:a,vScale:r,_stacked:l,_dataset:h}=this._cachedMeta,{sharedOptions:c,includeOptions:d}=this._getSharedOptions(e,n),u=a.axis,f=r.axis,{spanGaps:g,segment:p}=this.options,m=N(g)?g:Number.POSITIVE_INFINITY,x=this.chart._animationsDisabled||o||"none"===n,b=e+i,_=t.length;let y=e>0&&this.getParsed(e-1);for(let i=0;i<_;++i){const g=t[i],_=x?g:{};if(i<e||i>=b){_.skip=!0;continue}const v=this.getParsed(i),M=s(v[f]),w=_[u]=a.getPixelForValue(v[u],i),k=_[f]=o||M?r.getBasePixel():r.getPixelForValue(l?this.applyStack(r,v,l):v[f],i);_.skip=isNaN(w)||isNaN(k)||M,_.stop=i>0&&Math.abs(v[u]-y[u])>m,p&&(_.parsed=v,_.raw=h.data[i]),d&&(_.options=c||this.resolveDataElementOptions(i,g.active?"active":n)),x||this.updateElement(g,i,_,n),y=v}}getMaxOverflow(){const t=this._cachedMeta,e=t.dataset,i=e.options&&e.options.borderWidth||0,s=t.data||[];if(!s.length)return i;const n=s[0].size(this.resolveDataElementOptions(0)),o=s[s.length-1].size(this.resolveDataElementOptions(s.length-1));return Math.max(i,n,o)/2}draw(){const t=this._cachedMeta;t.dataset.updateControlPoints(this.chart.chartArea,t.iScale.axis),super.draw()}},PieController:class extends $n{static id="pie";static defaults={cutout:0,rotation:0,circumference:360,radius:"100%"}},PolarAreaController:Yn,RadarController:class extends js{static id="radar";static defaults={datasetElementType:"line",dataElementType:"point",indexAxis:"r",showLine:!0,elements:{line:{fill:"start"}}};static overrides={aspectRatio:1,scales:{r:{type:"radialLinear"}}};getLabelAndValue(t){const e=this._cachedMeta.vScale,i=this.getParsed(t);return{label:e.getLabels()[t],value:""+e.getLabelForValue(i[e.axis])}}parseObjectData(t,e,i,s){return ii.bind(this)(t,e,i,s)}update(t){const e=this._cachedMeta,i=e.dataset,s=e.data||[],n=e.iScale.getLabels();if(i.points=s,"resize"!==t){const e=this.resolveDatasetElementOptions(t);this.options.showLine||(e.borderWidth=0);const o={_loop:!0,_fullLoop:n.length===s.length,options:e};this.updateElement(i,void 0,o,t)}this.updateElements(s,0,s.length,t)}updateElements(t,e,i,s){const n=this._cachedMeta.rScale,o="reset"===s;for(let a=e;a<e+i;a++){const e=t[a],i=this.resolveDataElementOptions(a,e.active?"active":s),r=n.getPointPositionForValue(a,this.getParsed(a).r),l=o?n.xCenter:r.x,h=o?n.yCenter:r.y,c={x:l,y:h,angle:r.angle,skip:isNaN(l)||isNaN(h),options:i};this.updateElement(e,a,c,s)}}},ScatterController:class extends js{static id="scatter";static defaults={datasetElementType:!1,dataElementType:"point",showLine:!1,fill:!1};static overrides={interaction:{mode:"point"},scales:{x:{type:"linear"},y:{type:"linear"}}};getLabelAndValue(t){const e=this._cachedMeta,i=this.chart.data.labels||[],{xScale:s,yScale:n}=e,o=this.getParsed(t),a=s.getLabelForValue(o.x),r=n.getLabelForValue(o.y);return{label:i[t]||"",value:"("+a+", "+r+")"}}update(t){const e=this._cachedMeta,{data:i=[]}=e,s=this.chart._animationsDisabled;let{start:n,count:o}=pt(e,i,s);if(this._drawStart=n,this._drawCount=o,mt(e)&&(n=0,o=i.length),this.options.showLine){this.datasetElementType||this.addElements();const{dataset:n,_dataset:o}=e;n._chart=this.chart,n._datasetIndex=this.index,n._decimated=!!o._decimated,n.points=i;const a=this.resolveDatasetElementOptions(t);a.segment=this.options.segment,this.updateElement(n,void 0,{animated:!s,options:a},t)}else this.datasetElementType&&(delete e.dataset,this.datasetElementType=!1);this.updateElements(i,n,o,t)}addElements(){const{showLine:t}=this.options;!this.datasetElementType&&t&&(this.datasetElementType=this.chart.registry.getElement("line")),super.addElements()}updateElements(t,e,i,n){const o="reset"===n,{iScale:a,vScale:r,_stacked:l,_dataset:h}=this._cachedMeta,c=this.resolveDataElementOptions(e,n),d=this.getSharedOptions(c),u=this.includeOptions(n,d),f=a.axis,g=r.axis,{spanGaps:p,segment:m}=this.options,x=N(p)?p:Number.POSITIVE_INFINITY,b=this.chart._animationsDisabled||o||"none"===n;let _=e>0&&this.getParsed(e-1);for(let c=e;c<e+i;++c){const e=t[c],i=this.getParsed(c),p=b?e:{},y=s(i[g]),v=p[f]=a.getPixelForValue(i[f],c),M=p[g]=o||y?r.getBasePixel():r.getPixelForValue(l?this.applyStack(r,i,l):i[g],c);p.skip=isNaN(v)||isNaN(M)||y,p.stop=c>0&&Math.abs(i[f]-_[f])>x,m&&(p.parsed=i,p.raw=h.data[c]),u&&(p.options=d||this.resolveDataElementOptions(c,e.active?"active":n)),b||this.updateElement(e,c,p,n),_=i}this.updateSharedOptions(d,n,c)}getMaxOverflow(){const t=this._cachedMeta,e=t.data||[];if(!this.options.showLine){let t=0;for(let i=e.length-1;i>=0;--i)t=Math.max(t,e[i].size(this.resolveDataElementOptions(i))/2);return t>0&&t}const i=t.dataset,s=i.options&&i.options.borderWidth||0;if(!e.length)return s;const n=e[0].size(this.resolveDataElementOptions(0)),o=e[e.length-1].size(this.resolveDataElementOptions(e.length-1));return Math.max(s,n,o)/2}}});function Xn(t,e,i,s){const n=vi(t.options.borderRadius,["outerStart","outerEnd","innerStart","innerEnd"]);const o=(i-e)/2,a=Math.min(o,s*e/2),r=t=>{const e=(i-Math.min(o,t))*s/2;return Z(t,0,Math.min(o,e))};return{outerStart:r(n.outerStart),outerEnd:r(n.outerEnd),innerStart:Z(n.innerStart,0,a),innerEnd:Z(n.innerEnd,0,a)}}function qn(t,e,i,s){return{x:i+t*Math.cos(e),y:s+t*Math.sin(e)}}function Kn(t,e,i,s,n,o){const{x:a,y:r,startAngle:l,pixelMargin:h,innerRadius:c}=e,d=Math.max(e.outerRadius+s+i-h,0),u=c>0?c+s+i+h:0;let f=0;const g=n-l;if(s){const t=((c>0?c-s:0)+(d>0?d-s:0))/2;f=(g-(0!==t?g*t/(t+s):g))/2}const p=(g-Math.max(.001,g*d-i/C)/d)/2,m=l+p+f,x=n-p-f,{outerStart:b,outerEnd:_,innerStart:y,innerEnd:v}=Xn(e,u,d,x-m),M=d-b,w=d-_,k=m+b/M,S=x-_/w,P=u+y,D=u+v,O=m+y/P,A=x-v/D;if(t.beginPath(),o){const e=(k+S)/2;if(t.arc(a,r,d,k,e),t.arc(a,r,d,e,S),_>0){const e=qn(w,S,a,r);t.arc(e.x,e.y,_,S,x+E)}const i=qn(D,x,a,r);if(t.lineTo(i.x,i.y),v>0){const e=qn(D,A,a,r);t.arc(e.x,e.y,v,x+E,A+Math.PI)}const s=(x-v/u+(m+y/u))/2;if(t.arc(a,r,u,x-v/u,s,!0),t.arc(a,r,u,s,m+y/u,!0),y>0){const e=qn(P,O,a,r);t.arc(e.x,e.y,y,O+Math.PI,m-E)}const n=qn(M,m,a,r);if(t.lineTo(n.x,n.y),b>0){const e=qn(M,k,a,r);t.arc(e.x,e.y,b,m-E,k)}}else{t.moveTo(a,r);const e=Math.cos(k)*d+a,i=Math.sin(k)*d+r;t.lineTo(e,i);const s=Math.cos(S)*d+a,n=Math.sin(S)*d+r;t.lineTo(s,n)}t.closePath()}function Gn(t,e,i,s,n){const{fullCircles:o,startAngle:a,circumference:r,options:l}=e,{borderWidth:h,borderJoinStyle:c,borderDash:d,borderDashOffset:u,borderRadius:f}=l,g="inner"===l.borderAlign;if(!h)return;t.setLineDash(d||[]),t.lineDashOffset=u,g?(t.lineWidth=2*h,t.lineJoin=c||"round"):(t.lineWidth=h,t.lineJoin=c||"bevel");let p=e.endAngle;if(o){Kn(t,e,i,s,p,n);for(let e=0;e<o;++e)t.stroke();isNaN(r)||(p=a+(r%O||O))}g&&function(t,e,i){const{startAngle:s,pixelMargin:n,x:o,y:a,outerRadius:r,innerRadius:l}=e;let h=n/r;t.beginPath(),t.arc(o,a,r,s-h,i+h),l>n?(h=n/l,t.arc(o,a,l,i+h,s-h,!0)):t.arc(o,a,n,i+E,s-E),t.closePath(),t.clip()}(t,e,p),l.selfJoin&&p-a>=C&&0===f&&"miter"!==c&&function(t,e,i){const{startAngle:s,x:n,y:o,outerRadius:a,innerRadius:r,options:l}=e,{borderWidth:h,borderJoinStyle:c}=l,d=Math.min(h/a,G(s-i));if(t.beginPath(),t.arc(n,o,a-h/2,s+d/2,i-d/2),r>0){const e=Math.min(h/r,G(s-i));t.arc(n,o,r+h/2,i-e/2,s+e/2,!0)}else{const e=Math.min(h/2,a*G(s-i));if("round"===c)t.arc(n,o,e,i-C/2,s+C/2,!0);else if("bevel"===c){const a=2*e*e,r=-a*Math.cos(i+C/2)+n,l=-a*Math.sin(i+C/2)+o,h=a*Math.cos(s+C/2)+n,c=a*Math.sin(s+C/2)+o;t.lineTo(r,l),t.lineTo(h,c)}}t.closePath(),t.moveTo(0,0),t.rect(0,0,t.canvas.width,t.canvas.height),t.clip("evenodd")}(t,e,p),o||(Kn(t,e,i,s,p,n),t.stroke())}function Jn(t,e,i=e){t.lineCap=l(i.borderCapStyle,e.borderCapStyle),t.setLineDash(l(i.borderDash,e.borderDash)),t.lineDashOffset=l(i.borderDashOffset,e.borderDashOffset),t.lineJoin=l(i.borderJoinStyle,e.borderJoinStyle),t.lineWidth=l(i.borderWidth,e.borderWidth),t.strokeStyle=l(i.borderColor,e.borderColor)}function Zn(t,e,i){t.lineTo(i.x,i.y)}function Qn(t,e,i={}){const s=t.length,{start:n=0,end:o=s-1}=i,{start:a,end:r}=e,l=Math.max(n,a),h=Math.min(o,r),c=n<a&&o<a||n>r&&o>r;return{count:s,start:l,loop:e.loop,ilen:h<l&&!c?s+h-l:h-l}}function to(t,e,i,s){const{points:n,options:o}=e,{count:a,start:r,loop:l,ilen:h}=Qn(n,i,s),c=function(t){return t.stepped?Fe:t.tension||"monotone"===t.cubicInterpolationMode?Ve:Zn}(o);let d,u,f,{move:g=!0,reverse:p}=s||{};for(d=0;d<=h;++d)u=n[(r+(p?h-d:d))%a],u.skip||(g?(t.moveTo(u.x,u.y),g=!1):c(t,f,u,p,o.stepped),f=u);return l&&(u=n[(r+(p?h:0))%a],c(t,f,u,p,o.stepped)),!!l}function eo(t,e,i,s){const n=e.points,{count:o,start:a,ilen:r}=Qn(n,i,s),{move:l=!0,reverse:h}=s||{};let c,d,u,f,g,p,m=0,x=0;const b=t=>(a+(h?r-t:t))%o,_=()=>{f!==g&&(t.lineTo(m,g),t.lineTo(m,f),t.lineTo(m,p))};for(l&&(d=n[b(0)],t.moveTo(d.x,d.y)),c=0;c<=r;++c){if(d=n[b(c)],d.skip)continue;const e=d.x,i=d.y,s=0|e;s===u?(i<f?f=i:i>g&&(g=i),m=(x*m+e)/++x):(_(),t.lineTo(e,i),u=s,x=0,f=g=i),p=i}_()}function io(t){const e=t.options,i=e.borderDash&&e.borderDash.length;return!(t._decimated||t._loop||e.tension||"monotone"===e.cubicInterpolationMode||e.stepped||i)?eo:to}const so="function"==typeof Path2D;function no(t,e,i,s){so&&!e.options.segment?function(t,e,i,s){let n=e._path;n||(n=e._path=new Path2D,e.path(n,i,s)&&n.closePath()),Jn(t,e.options),t.stroke(n)}(t,e,i,s):function(t,e,i,s){const{segments:n,options:o}=e,a=io(e);for(const r of n)Jn(t,o,r.style),t.beginPath(),a(t,e,r,{start:i,end:i+s-1})&&t.closePath(),t.stroke()}(t,e,i,s)}class oo extends $s{static id="line";static defaults={borderCapStyle:"butt",borderDash:[],borderDashOffset:0,borderJoinStyle:"miter",borderWidth:3,capBezierPoints:!0,cubicInterpolationMode:"default",fill:!1,spanGaps:!1,stepped:!1,tension:0};static defaultRoutes={backgroundColor:"backgroundColor",borderColor:"borderColor"};static descriptors={_scriptable:!0,_indexable:t=>"borderDash"!==t&&"fill"!==t};constructor(t){super(),this.animated=!0,this.options=void 0,this._chart=void 0,this._loop=void 0,this._fullLoop=void 0,this._path=void 0,this._points=void 0,this._segments=void 0,this._decimated=!1,this._pointsUpdated=!1,this._datasetIndex=void 0,t&&Object.assign(this,t)}updateControlPoints(t,e){const i=this.options;if((i.tension||"monotone"===i.cubicInterpolationMode)&&!i.stepped&&!this._pointsUpdated){const s=i.spanGaps?this._loop:this._fullLoop;hi(this._points,i,t,s,e),this._pointsUpdated=!0}}set points(t){this._points=t,delete this._segments,delete this._path,this._pointsUpdated=!1}get points(){return this._points}get segments(){return this._segments||(this._segments=zi(this,this.options.segment))}first(){const t=this.segments,e=this.points;return t.length&&e[t[0].start]}last(){const t=this.segments,e=this.points,i=t.length;return i&&e[t[i-1].end]}interpolate(t,e){const i=this.options,s=t[e],n=this.points,o=Ii(this,{property:e,start:s,end:s});if(!o.length)return;const a=[],r=function(t){return t.stepped?pi:t.tension||"monotone"===t.cubicInterpolationMode?mi:gi}(i);let l,h;for(l=0,h=o.length;l<h;++l){const{start:h,end:c}=o[l],d=n[h],u=n[c];if(d===u){a.push(d);continue}const f=r(d,u,Math.abs((s-d[e])/(u[e]-d[e])),i.stepped);f[e]=t[e],a.push(f)}return 1===a.length?a[0]:a}pathSegment(t,e,i){return io(this)(t,this,e,i)}path(t,e,i){const s=this.segments,n=io(this);let o=this._loop;e=e||0,i=i||this.points.length-e;for(const a of s)o&=n(t,this,a,{start:e,end:e+i-1});return!!o}draw(t,e,i,s){const n=this.options||{};(this.points||[]).length&&n.borderWidth&&(t.save(),no(t,this,i,s),t.restore()),this.animated&&(this._pointsUpdated=!1,this._path=void 0)}}function ao(t,e,i,s){const n=t.options,{[i]:o}=t.getProps([i],s);return Math.abs(e-o)<n.radius+n.hitRadius}function ro(t,e){const{x:i,y:s,base:n,width:o,height:a}=t.getProps(["x","y","base","width","height"],e);let r,l,h,c,d;return t.horizontal?(d=a/2,r=Math.min(i,n),l=Math.max(i,n),h=s-d,c=s+d):(d=o/2,r=i-d,l=i+d,h=Math.min(s,n),c=Math.max(s,n)),{left:r,top:h,right:l,bottom:c}}function lo(t,e,i,s){return t?0:Z(e,i,s)}function ho(t){const e=ro(t),i=e.right-e.left,s=e.bottom-e.top,n=function(t,e,i){const s=t.options.borderWidth,n=t.borderSkipped,o=Mi(s);return{t:lo(n.top,o.top,0,i),r:lo(n.right,o.right,0,e),b:lo(n.bottom,o.bottom,0,i),l:lo(n.left,o.left,0,e)}}(t,i/2,s/2),a=function(t,e,i){const{enableBorderRadius:s}=t.getProps(["enableBorderRadius"]),n=t.options.borderRadius,a=wi(n),r=Math.min(e,i),l=t.borderSkipped,h=s||o(n);return{topLeft:lo(!h||l.top||l.left,a.topLeft,0,r),topRight:lo(!h||l.top||l.right,a.topRight,0,r),bottomLeft:lo(!h||l.bottom||l.left,a.bottomLeft,0,r),bottomRight:lo(!h||l.bottom||l.right,a.bottomRight,0,r)}}(t,i/2,s/2);return{outer:{x:e.left,y:e.top,w:i,h:s,radius:a},inner:{x:e.left+n.l,y:e.top+n.t,w:i-n.l-n.r,h:s-n.t-n.b,radius:{topLeft:Math.max(0,a.topLeft-Math.max(n.t,n.l)),topRight:Math.max(0,a.topRight-Math.max(n.t,n.r)),bottomLeft:Math.max(0,a.bottomLeft-Math.max(n.b,n.l)),bottomRight:Math.max(0,a.bottomRight-Math.max(n.b,n.r))}}}}function co(t,e,i,s){const n=null===e,o=null===i,a=t&&!(n&&o)&&ro(t,s);return a&&(n||tt(e,a.left,a.right))&&(o||tt(i,a.top,a.bottom))}function uo(t,e){t.rect(e.x,e.y,e.w,e.h)}function fo(t,e,i={}){const s=t.x!==i.x?-e:0,n=t.y!==i.y?-e:0,o=(t.x+t.w!==i.x+i.w?e:0)-s,a=(t.y+t.h!==i.y+i.h?e:0)-n;return{x:t.x+s,y:t.y+n,w:t.w+o,h:t.h+a,radius:t.radius}}var go=Object.freeze({__proto__:null,ArcElement:class extends $s{static id="arc";static defaults={borderAlign:"center",borderColor:"#fff",borderDash:[],borderDashOffset:0,borderJoinStyle:void 0,borderRadius:0,borderWidth:2,offset:0,spacing:0,angle:void 0,circular:!0,selfJoin:!1};static defaultRoutes={backgroundColor:"backgroundColor"};static descriptors={_scriptable:!0,_indexable:t=>"borderDash"!==t};circumference;endAngle;fullCircles;innerRadius;outerRadius;pixelMargin;startAngle;constructor(t){super(),this.options=void 0,this.circumference=void 0,this.startAngle=void 0,this.endAngle=void 0,this.innerRadius=void 0,this.outerRadius=void 0,this.pixelMargin=0,this.fullCircles=0,t&&Object.assign(this,t)}inRange(t,e,i){const s=this.getProps(["x","y"],i),{angle:n,distance:o}=X(s,{x:t,y:e}),{startAngle:a,endAngle:r,innerRadius:h,outerRadius:c,circumference:d}=this.getProps(["startAngle","endAngle","innerRadius","outerRadius","circumference"],i),u=(this.options.spacing+this.options.borderWidth)/2,f=l(d,r-a),g=J(n,a,r)&&a!==r,p=f>=O||g,m=tt(o,h+u,c+u);return p&&m}getCenterPoint(t){const{x:e,y:i,startAngle:s,endAngle:n,innerRadius:o,outerRadius:a}=this.getProps(["x","y","startAngle","endAngle","innerRadius","outerRadius"],t),{offset:r,spacing:l}=this.options,h=(s+n)/2,c=(o+a+l+r)/2;return{x:e+Math.cos(h)*c,y:i+Math.sin(h)*c}}tooltipPosition(t){return this.getCenterPoint(t)}draw(t){const{options:e,circumference:i}=this,s=(e.offset||0)/4,n=(e.spacing||0)/2,o=e.circular;if(this.pixelMargin="inner"===e.borderAlign?.33:0,this.fullCircles=i>O?Math.floor(i/O):0,0===i||this.innerRadius<0||this.outerRadius<0)return;t.save();const a=(this.startAngle+this.endAngle)/2;t.translate(Math.cos(a)*s,Math.sin(a)*s);const r=s*(1-Math.sin(Math.min(C,i||0)));t.fillStyle=e.backgroundColor,t.strokeStyle=e.borderColor,function(t,e,i,s,n){const{fullCircles:o,startAngle:a,circumference:r}=e;let l=e.endAngle;if(o){Kn(t,e,i,s,l,n);for(let e=0;e<o;++e)t.fill();isNaN(r)||(l=a+(r%O||O))}Kn(t,e,i,s,l,n),t.fill()}(t,this,r,n,o),Gn(t,this,r,n,o),t.restore()}},BarElement:class extends $s{static id="bar";static defaults={borderSkipped:"start",borderWidth:0,borderRadius:0,inflateAmount:"auto",pointStyle:void 0};static defaultRoutes={backgroundColor:"backgroundColor",borderColor:"borderColor"};constructor(t){super(),this.options=void 0,this.horizontal=void 0,this.base=void 0,this.width=void 0,this.height=void 0,this.inflateAmount=void 0,t&&Object.assign(this,t)}draw(t){const{inflateAmount:e,options:{borderColor:i,backgroundColor:s}}=this,{inner:n,outer:o}=ho(this),a=(r=o.radius).topLeft||r.topRight||r.bottomLeft||r.bottomRight?He:uo;var r;t.save(),o.w===n.w&&o.h===n.h||(t.beginPath(),a(t,fo(o,e,n)),t.clip(),a(t,fo(n,-e,o)),t.fillStyle=i,t.fill("evenodd")),t.beginPath(),a(t,fo(n,e)),t.fillStyle=s,t.fill(),t.restore()}inRange(t,e,i){return co(this,t,e,i)}inXRange(t,e){return co(this,t,null,e)}inYRange(t,e){return co(this,null,t,e)}getCenterPoint(t){const{x:e,y:i,base:s,horizontal:n}=this.getProps(["x","y","base","horizontal"],t);return{x:n?(e+s)/2:e,y:n?i:(i+s)/2}}getRange(t){return"x"===t?this.width/2:this.height/2}},LineElement:oo,PointElement:class extends $s{static id="point";parsed;skip;stop;static defaults={borderWidth:1,hitRadius:1,hoverBorderWidth:1,hoverRadius:4,pointStyle:"circle",radius:3,rotation:0};static defaultRoutes={backgroundColor:"backgroundColor",borderColor:"borderColor"};constructor(t){super(),this.options=void 0,this.parsed=void 0,this.skip=void 0,this.stop=void 0,t&&Object.assign(this,t)}inRange(t,e,i){const s=this.options,{x:n,y:o}=this.getProps(["x","y"],i);return Math.pow(t-n,2)+Math.pow(e-o,2)<Math.pow(s.hitRadius+s.radius,2)}inXRange(t,e){return ao(this,t,"x",e)}inYRange(t,e){return ao(this,t,"y",e)}getCenterPoint(t){const{x:e,y:i}=this.getProps(["x","y"],t);return{x:e,y:i}}size(t){let e=(t=t||this.options||{}).radius||0;e=Math.max(e,e&&t.hoverRadius||0);return 2*(e+(e&&t.borderWidth||0))}draw(t,e){const i=this.options;this.skip||i.radius<.1||!Re(this,e,this.size(i)/2)||(t.strokeStyle=i.borderColor,t.lineWidth=i.borderWidth,t.fillStyle=i.backgroundColor,Le(t,i,this.x,this.y))}getRange(){const t=this.options||{};return t.radius+t.hitRadius}}});function po(t,e,i,s){const n=t.indexOf(e);if(-1===n)return((t,e,i,s)=>("string"==typeof e?(i=t.push(e)-1,s.unshift({index:i,label:e})):isNaN(e)&&(i=null),i))(t,e,i,s);return n!==t.lastIndexOf(e)?i:n}function mo(t){const e=this.getLabels();return t>=0&&t<e.length?e[t]:t}function xo(t,e,{horizontal:i,minRotation:s}){const n=$(s),o=(i?Math.sin(n):Math.cos(n))||.001,a=.75*e*(""+t).length;return Math.min(e/o,a)}class bo extends tn{constructor(t){super(t),this.start=void 0,this.end=void 0,this._startValue=void 0,this._endValue=void 0,this._valueRange=0}parse(t,e){return s(t)||("number"==typeof t||t instanceof Number)&&!isFinite(+t)?null:+t}handleTickRangeOptions(){const{beginAtZero:t}=this.options,{minDefined:e,maxDefined:i}=this.getUserBounds();let{min:s,max:n}=this;const o=t=>s=e?s:t,a=t=>n=i?n:t;if(t){const t=F(s),e=F(n);t<0&&e<0?a(0):t>0&&e>0&&o(0)}if(s===n){let e=0===n?1:Math.abs(.05*n);a(n+e),t||o(s-e)}this.min=s,this.max=n}getTickLimit(){const t=this.options.ticks;let e,{maxTicksLimit:i,stepSize:s}=t;return s?(e=Math.ceil(this.max/s)-Math.floor(this.min/s)+1,e>1e3&&(console.warn(`scales.${this.id}.ticks.stepSize: ${s} would result generating up to ${e} ticks. Limiting to 1000.`),e=1e3)):(e=this.computeTickLimit(),i=i||11),i&&(e=Math.min(i,e)),e}computeTickLimit(){return Number.POSITIVE_INFINITY}buildTicks(){const t=this.options,e=t.ticks;let i=this.getTickLimit();i=Math.max(2,i);const n=function(t,e){const i=[],{bounds:n,step:o,min:a,max:r,precision:l,count:h,maxTicks:c,maxDigits:d,includeBounds:u}=t,f=o||1,g=c-1,{min:p,max:m}=e,x=!s(a),b=!s(r),_=!s(h),y=(m-p)/(d+1);let v,M,w,k,S=B((m-p)/g/f)*f;if(S<1e-14&&!x&&!b)return[{value:p},{value:m}];k=Math.ceil(m/S)-Math.floor(p/S),k>g&&(S=B(k*S/g/f)*f),s(l)||(v=Math.pow(10,l),S=Math.ceil(S*v)/v),"ticks"===n?(M=Math.floor(p/S)*S,w=Math.ceil(m/S)*S):(M=p,w=m),x&&b&&o&&H((r-a)/o,S/1e3)?(k=Math.round(Math.min((r-a)/S,c)),S=(r-a)/k,M=a,w=r):_?(M=x?a:M,w=b?r:w,k=h-1,S=(w-M)/k):(k=(w-M)/S,k=V(k,Math.round(k),S/1e3)?Math.round(k):Math.ceil(k));const P=Math.max(U(S),U(M));v=Math.pow(10,s(l)?P:l),M=Math.round(M*v)/v,w=Math.round(w*v)/v;let D=0;for(x&&(u&&M!==a?(i.push({value:a}),M<a&&D++,V(Math.round((M+D*S)*v)/v,a,xo(a,y,t))&&D++):M<a&&D++);D<k;++D){const t=Math.round((M+D*S)*v)/v;if(b&&t>r)break;i.push({value:t})}return b&&u&&w!==r?i.length&&V(i[i.length-1].value,r,xo(r,y,t))?i[i.length-1].value=r:i.push({value:r}):b&&w!==r||i.push({value:w}),i}({maxTicks:i,bounds:t.bounds,min:t.min,max:t.max,precision:e.precision,step:e.stepSize,count:e.count,maxDigits:this._maxDigits(),horizontal:this.isHorizontal(),minRotation:e.minRotation||0,includeBounds:!1!==e.includeBounds},this._range||this);return"ticks"===t.bounds&&j(n,this,"value"),t.reverse?(n.reverse(),this.start=this.max,this.end=this.min):(this.start=this.min,this.end=this.max),n}configure(){const t=this.ticks;let e=this.min,i=this.max;if(super.configure(),this.options.offset&&t.length){const s=(i-e)/Math.max(t.length-1,1)/2;e-=s,i+=s}this._startValue=e,this._endValue=i,this._valueRange=i-e}getLabelForValue(t){return ne(t,this.chart.options.locale,this.options.ticks.format)}}class _o extends bo{static id="linear";static defaults={ticks:{callback:ae.formatters.numeric}};determineDataLimits(){const{min:t,max:e}=this.getMinMax(!0);this.min=a(t)?t:0,this.max=a(e)?e:1,this.handleTickRangeOptions()}computeTickLimit(){const t=this.isHorizontal(),e=t?this.width:this.height,i=$(this.options.ticks.minRotation),s=(t?Math.sin(i):Math.cos(i))||.001,n=this._resolveTickFontOptions(0);return Math.ceil(e/Math.min(40,n.lineHeight/s))}getPixelForValue(t){return null===t?NaN:this.getPixelForDecimal((t-this._startValue)/this._valueRange)}getValueForPixel(t){return this._startValue+this.getDecimalForPixel(t)*this._valueRange}}const yo=t=>Math.floor(z(t)),vo=(t,e)=>Math.pow(10,yo(t)+e);function Mo(t){return 1===t/Math.pow(10,yo(t))}function wo(t,e,i){const s=Math.pow(10,i),n=Math.floor(t/s);return Math.ceil(e/s)-n}function ko(t,{min:e,max:i}){e=r(t.min,e);const s=[],n=yo(e);let o=function(t,e){let i=yo(e-t);for(;wo(t,e,i)>10;)i++;for(;wo(t,e,i)<10;)i--;return Math.min(i,yo(t))}(e,i),a=o<0?Math.pow(10,Math.abs(o)):1;const l=Math.pow(10,o),h=n>o?Math.pow(10,n):0,c=Math.round((e-h)*a)/a,d=Math.floor((e-h)/l/10)*l*10;let u=Math.floor((c-d)/Math.pow(10,o)),f=r(t.min,Math.round((h+d+u*Math.pow(10,o))*a)/a);for(;f<i;)s.push({value:f,major:Mo(f),significand:u}),u>=10?u=u<15?15:20:u++,u>=20&&(o++,u=2,a=o>=0?1:a),f=Math.round((h+d+u*Math.pow(10,o))*a)/a;const g=r(t.max,f);return s.push({value:g,major:Mo(g),significand:u}),s}class So extends tn{static id="logarithmic";static defaults={ticks:{callback:ae.formatters.logarithmic,major:{enabled:!0}}};constructor(t){super(t),this.start=void 0,this.end=void 0,this._startValue=void 0,this._valueRange=0}parse(t,e){const i=bo.prototype.parse.apply(this,[t,e]);if(0!==i)return a(i)&&i>0?i:null;this._zero=!0}determineDataLimits(){const{min:t,max:e}=this.getMinMax(!0);this.min=a(t)?Math.max(0,t):null,this.max=a(e)?Math.max(0,e):null,this.options.beginAtZero&&(this._zero=!0),this._zero&&this.min!==this._suggestedMin&&!a(this._userMin)&&(this.min=t===vo(this.min,0)?vo(this.min,-1):vo(this.min,0)),this.handleTickRangeOptions()}handleTickRangeOptions(){const{minDefined:t,maxDefined:e}=this.getUserBounds();let i=this.min,s=this.max;const n=e=>i=t?i:e,o=t=>s=e?s:t;i===s&&(i<=0?(n(1),o(10)):(n(vo(i,-1)),o(vo(s,1)))),i<=0&&n(vo(s,-1)),s<=0&&o(vo(i,1)),this.min=i,this.max=s}buildTicks(){const t=this.options,e=ko({min:this._userMin,max:this._userMax},this);return"ticks"===t.bounds&&j(e,this,"value"),t.reverse?(e.reverse(),this.start=this.max,this.end=this.min):(this.start=this.min,this.end=this.max),e}getLabelForValue(t){return void 0===t?"0":ne(t,this.chart.options.locale,this.options.ticks.format)}configure(){const t=this.min;super.configure(),this._startValue=z(t),this._valueRange=z(this.max)-z(t)}getPixelForValue(t){return void 0!==t&&0!==t||(t=this.min),null===t||isNaN(t)?NaN:this.getPixelForDecimal(t===this.min?0:(z(t)-this._startValue)/this._valueRange)}getValueForPixel(t){const e=this.getDecimalForPixel(t);return Math.pow(10,this._startValue+e*this._valueRange)}}function Po(t){const e=t.ticks;if(e.display&&t.display){const t=ki(e.backdropPadding);return l(e.font&&e.font.size,ue.font.size)+t.height}return 0}function Do(t,e,i,s,n){return t===s||t===n?{start:e-i/2,end:e+i/2}:t<s||t>n?{start:e-i,end:e}:{start:e,end:e+i}}function Co(t){const e={l:t.left+t._padding.left,r:t.right-t._padding.right,t:t.top+t._padding.top,b:t.bottom-t._padding.bottom},i=Object.assign({},e),s=[],o=[],a=t._pointLabels.length,r=t.options.pointLabels,l=r.centerPointLabels?C/a:0;for(let u=0;u<a;u++){const a=r.setContext(t.getPointLabelContext(u));o[u]=a.padding;const f=t.getPointPosition(u,t.drawingArea+o[u],l),g=Si(a.font),p=(h=t.ctx,c=g,d=n(d=t._pointLabels[u])?d:[d],{w:Oe(h,c.string,d),h:d.length*c.lineHeight});s[u]=p;const m=G(t.getIndexAngle(u)+l),x=Math.round(Y(m));Oo(i,e,m,Do(x,f.x,p.w,0,180),Do(x,f.y,p.h,90,270))}var h,c,d;t.setCenterPoint(e.l-i.l,i.r-e.r,e.t-i.t,i.b-e.b),t._pointLabelItems=function(t,e,i){const s=[],n=t._pointLabels.length,o=t.options,{centerPointLabels:a,display:r}=o.pointLabels,l={extra:Po(o)/2,additionalAngle:a?C/n:0};let h;for(let o=0;o<n;o++){l.padding=i[o],l.size=e[o];const n=Ao(t,o,l);s.push(n),"auto"===r&&(n.visible=To(n,h),n.visible&&(h=n))}return s}(t,s,o)}function Oo(t,e,i,s,n){const o=Math.abs(Math.sin(i)),a=Math.abs(Math.cos(i));let r=0,l=0;s.start<e.l?(r=(e.l-s.start)/o,t.l=Math.min(t.l,e.l-r)):s.end>e.r&&(r=(s.end-e.r)/o,t.r=Math.max(t.r,e.r+r)),n.start<e.t?(l=(e.t-n.start)/a,t.t=Math.min(t.t,e.t-l)):n.end>e.b&&(l=(n.end-e.b)/a,t.b=Math.max(t.b,e.b+l))}function Ao(t,e,i){const s=t.drawingArea,{extra:n,additionalAngle:o,padding:a,size:r}=i,l=t.getPointPosition(e,s+n+a,o),h=Math.round(Y(G(l.angle+E))),c=function(t,e,i){90===i||270===i?t-=e/2:(i>270||i<90)&&(t-=e);return t}(l.y,r.h,h),d=function(t){if(0===t||180===t)return"center";if(t<180)return"left";return"right"}(h),u=function(t,e,i){"right"===i?t-=e:"center"===i&&(t-=e/2);return t}(l.x,r.w,d);return{visible:!0,x:l.x,y:c,textAlign:d,left:u,top:c,right:u+r.w,bottom:c+r.h}}function To(t,e){if(!e)return!0;const{left:i,top:s,right:n,bottom:o}=t;return!(Re({x:i,y:s},e)||Re({x:i,y:o},e)||Re({x:n,y:s},e)||Re({x:n,y:o},e))}function Lo(t,e,i){const{left:n,top:o,right:a,bottom:r}=i,{backdropColor:l}=e;if(!s(l)){const i=wi(e.borderRadius),s=ki(e.backdropPadding);t.fillStyle=l;const h=n-s.left,c=o-s.top,d=a-n+s.width,u=r-o+s.height;Object.values(i).some((t=>0!==t))?(t.beginPath(),He(t,{x:h,y:c,w:d,h:u,radius:i}),t.fill()):t.fillRect(h,c,d,u)}}function Eo(t,e,i,s){const{ctx:n}=t;if(i)n.arc(t.xCenter,t.yCenter,e,0,O);else{let i=t.getPointPosition(0,e);n.moveTo(i.x,i.y);for(let o=1;o<s;o++)i=t.getPointPosition(o,e),n.lineTo(i.x,i.y)}}class Ro extends bo{static id="radialLinear";static defaults={display:!0,animate:!0,position:"chartArea",angleLines:{display:!0,lineWidth:1,borderDash:[],borderDashOffset:0},grid:{circular:!1},startAngle:0,ticks:{showLabelBackdrop:!0,callback:ae.formatters.numeric},pointLabels:{backdropColor:void 0,backdropPadding:2,display:!0,font:{size:10},callback:t=>t,padding:5,centerPointLabels:!1}};static defaultRoutes={"angleLines.color":"borderColor","pointLabels.color":"color","ticks.color":"color"};static descriptors={angleLines:{_fallback:"grid"}};constructor(t){super(t),this.xCenter=void 0,this.yCenter=void 0,this.drawingArea=void 0,this._pointLabels=[],this._pointLabelItems=[]}setDimensions(){const t=this._padding=ki(Po(this.options)/2),e=this.width=this.maxWidth-t.width,i=this.height=this.maxHeight-t.height;this.xCenter=Math.floor(this.left+e/2+t.left),this.yCenter=Math.floor(this.top+i/2+t.top),this.drawingArea=Math.floor(Math.min(e,i)/2)}determineDataLimits(){const{min:t,max:e}=this.getMinMax(!1);this.min=a(t)&&!isNaN(t)?t:0,this.max=a(e)&&!isNaN(e)?e:0,this.handleTickRangeOptions()}computeTickLimit(){return Math.ceil(this.drawingArea/Po(this.options))}generateTickLabels(t){bo.prototype.generateTickLabels.call(this,t),this._pointLabels=this.getLabels().map(((t,e)=>{const i=d(this.options.pointLabels.callback,[t,e],this);return i||0===i?i:""})).filter(((t,e)=>this.chart.getDataVisibility(e)))}fit(){const t=this.options;t.display&&t.pointLabels.display?Co(this):this.setCenterPoint(0,0,0,0)}setCenterPoint(t,e,i,s){this.xCenter+=Math.floor((t-e)/2),this.yCenter+=Math.floor((i-s)/2),this.drawingArea-=Math.min(this.drawingArea/2,Math.max(t,e,i,s))}getIndexAngle(t){return G(t*(O/(this._pointLabels.length||1))+$(this.options.startAngle||0))}getDistanceFromCenterForValue(t){if(s(t))return NaN;const e=this.drawingArea/(this.max-this.min);return this.options.reverse?(this.max-t)*e:(t-this.min)*e}getValueForDistanceFromCenter(t){if(s(t))return NaN;const e=t/(this.drawingArea/(this.max-this.min));return this.options.reverse?this.max-e:this.min+e}getPointLabelContext(t){const e=this._pointLabels||[];if(t>=0&&t<e.length){const i=e[t];return function(t,e,i){return Ci(t,{label:i,index:e,type:"pointLabel"})}(this.getContext(),t,i)}}getPointPosition(t,e,i=0){const s=this.getIndexAngle(t)-E+i;return{x:Math.cos(s)*e+this.xCenter,y:Math.sin(s)*e+this.yCenter,angle:s}}getPointPositionForValue(t,e){return this.getPointPosition(t,this.getDistanceFromCenterForValue(e))}getBasePosition(t){return this.getPointPositionForValue(t||0,this.getBaseValue())}getPointLabelPosition(t){const{left:e,top:i,right:s,bottom:n}=this._pointLabelItems[t];return{left:e,top:i,right:s,bottom:n}}drawBackground(){const{backgroundColor:t,grid:{circular:e}}=this.options;if(t){const i=this.ctx;i.save(),i.beginPath(),Eo(this,this.getDistanceFromCenterForValue(this._endValue),e,this._pointLabels.length),i.closePath(),i.fillStyle=t,i.fill(),i.restore()}}drawGrid(){const t=this.ctx,e=this.options,{angleLines:i,grid:s,border:n}=e,o=this._pointLabels.length;let a,r,l;if(e.pointLabels.display&&function(t,e){const{ctx:i,options:{pointLabels:s}}=t;for(let n=e-1;n>=0;n--){const e=t._pointLabelItems[n];if(!e.visible)continue;const o=s.setContext(t.getPointLabelContext(n));Lo(i,o,e);const a=Si(o.font),{x:r,y:l,textAlign:h}=e;Ne(i,t._pointLabels[n],r,l+a.lineHeight/2,a,{color:o.color,textAlign:h,textBaseline:"middle"})}}(this,o),s.display&&this.ticks.forEach(((t,e)=>{if(0!==e||0===e&&this.min<0){r=this.getDistanceFromCenterForValue(t.value);const i=this.getContext(e),a=s.setContext(i),l=n.setContext(i);!function(t,e,i,s,n){const o=t.ctx,a=e.circular,{color:r,lineWidth:l}=e;!a&&!s||!r||!l||i<0||(o.save(),o.strokeStyle=r,o.lineWidth=l,o.setLineDash(n.dash||[]),o.lineDashOffset=n.dashOffset,o.beginPath(),Eo(t,i,a,s),o.closePath(),o.stroke(),o.restore())}(this,a,r,o,l)}})),i.display){for(t.save(),a=o-1;a>=0;a--){const s=i.setContext(this.getPointLabelContext(a)),{color:n,lineWidth:o}=s;o&&n&&(t.lineWidth=o,t.strokeStyle=n,t.setLineDash(s.borderDash),t.lineDashOffset=s.borderDashOffset,r=this.getDistanceFromCenterForValue(e.reverse?this.min:this.max),l=this.getPointPosition(a,r),t.beginPath(),t.moveTo(this.xCenter,this.yCenter),t.lineTo(l.x,l.y),t.stroke())}t.restore()}}drawBorder(){}drawLabels(){const t=this.ctx,e=this.options,i=e.ticks;if(!i.display)return;const s=this.getIndexAngle(0);let n,o;t.save(),t.translate(this.xCenter,this.yCenter),t.rotate(s),t.textAlign="center",t.textBaseline="middle",this.ticks.forEach(((s,a)=>{if(0===a&&this.min>=0&&!e.reverse)return;const r=i.setContext(this.getContext(a)),l=Si(r.font);if(n=this.getDistanceFromCenterForValue(this.ticks[a].value),r.showLabelBackdrop){t.font=l.string,o=t.measureText(s.label).width,t.fillStyle=r.backdropColor;const e=ki(r.backdropPadding);t.fillRect(-o/2-e.left,-n-l.size/2-e.top,o+e.width,l.size+e.height)}Ne(t,s.label,0,-n,l,{color:r.color,strokeColor:r.textStrokeColor,strokeWidth:r.textStrokeWidth})})),t.restore()}drawTitle(){}}const Io={millisecond:{common:!0,size:1,steps:1e3},second:{common:!0,size:1e3,steps:60},minute:{common:!0,size:6e4,steps:60},hour:{common:!0,size:36e5,steps:24},day:{common:!0,size:864e5,steps:30},week:{common:!1,size:6048e5,steps:4},month:{common:!0,size:2628e6,steps:12},quarter:{common:!1,size:7884e6,steps:4},year:{common:!0,size:3154e7}},zo=Object.keys(Io);function Fo(t,e){return t-e}function Vo(t,e){if(s(e))return null;const i=t._adapter,{parser:n,round:o,isoWeekday:r}=t._parseOpts;let l=e;return"function"==typeof n&&(l=n(l)),a(l)||(l="string"==typeof n?i.parse(l,n):i.parse(l)),null===l?null:(o&&(l="week"!==o||!N(r)&&!0!==r?i.startOf(l,o):i.startOf(l,"isoWeek",r)),+l)}function Bo(t,e,i,s){const n=zo.length;for(let o=zo.indexOf(t);o<n-1;++o){const t=Io[zo[o]],n=t.steps?t.steps:Number.MAX_SAFE_INTEGER;if(t.common&&Math.ceil((i-e)/(n*t.size))<=s)return zo[o]}return zo[n-1]}function Wo(t,e,i){if(i){if(i.length){const{lo:s,hi:n}=et(i,e);t[i[s]>=e?i[s]:i[n]]=!0}}else t[e]=!0}function No(t,e,i){const s=[],n={},o=e.length;let a,r;for(a=0;a<o;++a)r=e[a],n[r]=a,s.push({value:r,major:!1});return 0!==o&&i?function(t,e,i,s){const n=t._adapter,o=+n.startOf(e[0].value,s),a=e[e.length-1].value;let r,l;for(r=o;r<=a;r=+n.add(r,1,s))l=i[r],l>=0&&(e[l].major=!0);return e}(t,s,n,i):s}class Ho extends tn{static id="time";static defaults={bounds:"data",adapters:{},time:{parser:!1,unit:!1,round:!1,isoWeekday:!1,minUnit:"millisecond",displayFormats:{}},ticks:{source:"auto",callback:!1,major:{enabled:!1}}};constructor(t){super(t),this._cache={data:[],labels:[],all:[]},this._unit="day",this._majorUnit=void 0,this._offsets={},this._normalized=!1,this._parseOpts=void 0}init(t,e={}){const i=t.time||(t.time={}),s=this._adapter=new In._date(t.adapters.date);s.init(e),b(i.displayFormats,s.formats()),this._parseOpts={parser:i.parser,round:i.round,isoWeekday:i.isoWeekday},super.init(t),this._normalized=e.normalized}parse(t,e){return void 0===t?null:Vo(this,t)}beforeLayout(){super.beforeLayout(),this._cache={data:[],labels:[],all:[]}}determineDataLimits(){const t=this.options,e=this._adapter,i=t.time.unit||"day";let{min:s,max:n,minDefined:o,maxDefined:r}=this.getUserBounds();function l(t){o||isNaN(t.min)||(s=Math.min(s,t.min)),r||isNaN(t.max)||(n=Math.max(n,t.max))}o&&r||(l(this._getLabelBounds()),"ticks"===t.bounds&&"labels"===t.ticks.source||l(this.getMinMax(!1))),s=a(s)&&!isNaN(s)?s:+e.startOf(Date.now(),i),n=a(n)&&!isNaN(n)?n:+e.endOf(Date.now(),i)+1,this.min=Math.min(s,n-1),this.max=Math.max(s+1,n)}_getLabelBounds(){const t=this.getLabelTimestamps();let e=Number.POSITIVE_INFINITY,i=Number.NEGATIVE_INFINITY;return t.length&&(e=t[0],i=t[t.length-1]),{min:e,max:i}}buildTicks(){const t=this.options,e=t.time,i=t.ticks,s="labels"===i.source?this.getLabelTimestamps():this._generate();"ticks"===t.bounds&&s.length&&(this.min=this._userMin||s[0],this.max=this._userMax||s[s.length-1]);const n=this.min,o=nt(s,n,this.max);return this._unit=e.unit||(i.autoSkip?Bo(e.minUnit,this.min,this.max,this._getLabelCapacity(n)):function(t,e,i,s,n){for(let o=zo.length-1;o>=zo.indexOf(i);o--){const i=zo[o];if(Io[i].common&&t._adapter.diff(n,s,i)>=e-1)return i}return zo[i?zo.indexOf(i):0]}(this,o.length,e.minUnit,this.min,this.max)),this._majorUnit=i.major.enabled&&"year"!==this._unit?function(t){for(let e=zo.indexOf(t)+1,i=zo.length;e<i;++e)if(Io[zo[e]].common)return zo[e]}(this._unit):void 0,this.initOffsets(s),t.reverse&&o.reverse(),No(this,o,this._majorUnit)}afterAutoSkip(){this.options.offsetAfterAutoskip&&this.initOffsets(this.ticks.map((t=>+t.value)))}initOffsets(t=[]){let e,i,s=0,n=0;this.options.offset&&t.length&&(e=this.getDecimalForValue(t[0]),s=1===t.length?1-e:(this.getDecimalForValue(t[1])-e)/2,i=this.getDecimalForValue(t[t.length-1]),n=1===t.length?i:(i-this.getDecimalForValue(t[t.length-2]))/2);const o=t.length<3?.5:.25;s=Z(s,0,o),n=Z(n,0,o),this._offsets={start:s,end:n,factor:1/(s+1+n)}}_generate(){const t=this._adapter,e=this.min,i=this.max,s=this.options,n=s.time,o=n.unit||Bo(n.minUnit,e,i,this._getLabelCapacity(e)),a=l(s.ticks.stepSize,1),r="week"===o&&n.isoWeekday,h=N(r)||!0===r,c={};let d,u,f=e;if(h&&(f=+t.startOf(f,"isoWeek",r)),f=+t.startOf(f,h?"day":o),t.diff(i,e,o)>1e5*a)throw new Error(e+" and "+i+" are too far apart with stepSize of "+a+" "+o);const g="data"===s.ticks.source&&this.getDataTimestamps();for(d=f,u=0;d<i;d=+t.add(d,a,o),u++)Wo(c,d,g);return d!==i&&"ticks"!==s.bounds&&1!==u||Wo(c,d,g),Object.keys(c).sort(Fo).map((t=>+t))}getLabelForValue(t){const e=this._adapter,i=this.options.time;return i.tooltipFormat?e.format(t,i.tooltipFormat):e.format(t,i.displayFormats.datetime)}format(t,e){const i=this.options.time.displayFormats,s=this._unit,n=e||i[s];return this._adapter.format(t,n)}_tickFormatFunction(t,e,i,s){const n=this.options,o=n.ticks.callback;if(o)return d(o,[t,e,i],this);const a=n.time.displayFormats,r=this._unit,l=this._majorUnit,h=r&&a[r],c=l&&a[l],u=i[e],f=l&&c&&u&&u.major;return this._adapter.format(t,s||(f?c:h))}generateTickLabels(t){let e,i,s;for(e=0,i=t.length;e<i;++e)s=t[e],s.label=this._tickFormatFunction(s.value,e,t)}getDecimalForValue(t){return null===t?NaN:(t-this.min)/(this.max-this.min)}getPixelForValue(t){const e=this._offsets,i=this.getDecimalForValue(t);return this.getPixelForDecimal((e.start+i)*e.factor)}getValueForPixel(t){const e=this._offsets,i=this.getDecimalForPixel(t)/e.factor-e.end;return this.min+i*(this.max-this.min)}_getLabelSize(t){const e=this.options.ticks,i=this.ctx.measureText(t).width,s=$(this.isHorizontal()?e.maxRotation:e.minRotation),n=Math.cos(s),o=Math.sin(s),a=this._resolveTickFontOptions(0).size;return{w:i*n+a*o,h:i*o+a*n}}_getLabelCapacity(t){const e=this.options.time,i=e.displayFormats,s=i[e.unit]||i.millisecond,n=this._tickFormatFunction(t,0,No(this,[t],this._majorUnit),s),o=this._getLabelSize(n),a=Math.floor(this.isHorizontal()?this.width/o.w:this.height/o.h)-1;return a>0?a:1}getDataTimestamps(){let t,e,i=this._cache.data||[];if(i.length)return i;const s=this.getMatchingVisibleMetas();if(this._normalized&&s.length)return this._cache.data=s[0].controller.getAllParsedValues(this);for(t=0,e=s.length;t<e;++t)i=i.concat(s[t].controller.getAllParsedValues(this));return this._cache.data=this.normalize(i)}getLabelTimestamps(){const t=this._cache.labels||[];let e,i;if(t.length)return t;const s=this.getLabels();for(e=0,i=s.length;e<i;++e)t.push(Vo(this,s[e]));return this._cache.labels=this._normalized?t:this.normalize(t)}normalize(t){return lt(t.sort(Fo))}}function jo(t,e,i){let s,n,o,a,r=0,l=t.length-1;i?(e>=t[r].pos&&e<=t[l].pos&&({lo:r,hi:l}=it(t,"pos",e)),({pos:s,time:o}=t[r]),({pos:n,time:a}=t[l])):(e>=t[r].time&&e<=t[l].time&&({lo:r,hi:l}=it(t,"time",e)),({time:s,pos:o}=t[r]),({time:n,pos:a}=t[l]));const h=n-s;return h?o+(a-o)*(e-s)/h:o}var $o=Object.freeze({__proto__:null,CategoryScale:class extends tn{static id="category";static defaults={ticks:{callback:mo}};constructor(t){super(t),this._startValue=void 0,this._valueRange=0,this._addedLabels=[]}init(t){const e=this._addedLabels;if(e.length){const t=this.getLabels();for(const{index:i,label:s}of e)t[i]===s&&t.splice(i,1);this._addedLabels=[]}super.init(t)}parse(t,e){if(s(t))return null;const i=this.getLabels();return((t,e)=>null===t?null:Z(Math.round(t),0,e))(e=isFinite(e)&&i[e]===t?e:po(i,t,l(e,t),this._addedLabels),i.length-1)}determineDataLimits(){const{minDefined:t,maxDefined:e}=this.getUserBounds();let{min:i,max:s}=this.getMinMax(!0);"ticks"===this.options.bounds&&(t||(i=0),e||(s=this.getLabels().length-1)),this.min=i,this.max=s}buildTicks(){const t=this.min,e=this.max,i=this.options.offset,s=[];let n=this.getLabels();n=0===t&&e===n.length-1?n:n.slice(t,e+1),this._valueRange=Math.max(n.length-(i?0:1),1),this._startValue=this.min-(i?.5:0);for(let i=t;i<=e;i++)s.push({value:i});return s}getLabelForValue(t){return mo.call(this,t)}configure(){super.configure(),this.isHorizontal()||(this._reversePixels=!this._reversePixels)}getPixelForValue(t){return"number"!=typeof t&&(t=this.parse(t)),null===t?NaN:this.getPixelForDecimal((t-this._startValue)/this._valueRange)}getPixelForTick(t){const e=this.ticks;return t<0||t>e.length-1?null:this.getPixelForValue(e[t].value)}getValueForPixel(t){return Math.round(this._startValue+this.getDecimalForPixel(t)*this._valueRange)}getBasePixel(){return this.bottom}},LinearScale:_o,LogarithmicScale:So,RadialLinearScale:Ro,TimeScale:Ho,TimeSeriesScale:class extends Ho{static id="timeseries";static defaults=Ho.defaults;constructor(t){super(t),this._table=[],this._minPos=void 0,this._tableRange=void 0}initOffsets(){const t=this._getTimestampsForTable(),e=this._table=this.buildLookupTable(t);this._minPos=jo(e,this.min),this._tableRange=jo(e,this.max)-this._minPos,super.initOffsets(t)}buildLookupTable(t){const{min:e,max:i}=this,s=[],n=[];let o,a,r,l,h;for(o=0,a=t.length;o<a;++o)l=t[o],l>=e&&l<=i&&s.push(l);if(s.length<2)return[{time:e,pos:0},{time:i,pos:1}];for(o=0,a=s.length;o<a;++o)h=s[o+1],r=s[o-1],l=s[o],Math.round((h+r)/2)!==l&&n.push({time:l,pos:o/(a-1)});return n}_generate(){const t=this.min,e=this.max;let i=super.getDataTimestamps();return i.includes(t)&&i.length||i.splice(0,0,t),i.includes(e)&&1!==i.length||i.push(e),i.sort(((t,e)=>t-e))}_getTimestampsForTable(){let t=this._cache.all||[];if(t.length)return t;const e=this.getDataTimestamps(),i=this.getLabelTimestamps();return t=e.length&&i.length?this.normalize(e.concat(i)):e.length?e:i,t=this._cache.all=t,t}getDecimalForValue(t){return(jo(this._table,t)-this._minPos)/this._tableRange}getValueForPixel(t){const e=this._offsets,i=this.getDecimalForPixel(t)/e.factor-e.end;return jo(this._table,i*this._tableRange+this._minPos,!0)}}});const Yo=["rgb(54, 162, 235)","rgb(255, 99, 132)","rgb(255, 159, 64)","rgb(255, 205, 86)","rgb(75, 192, 192)","rgb(153, 102, 255)","rgb(201, 203, 207)"],Uo=Yo.map((t=>t.replace("rgb(","rgba(").replace(")",", 0.5)")));function Xo(t){return Yo[t%Yo.length]}function qo(t){return Uo[t%Uo.length]}function Ko(t){let e=0;return(i,s)=>{const n=t.getDatasetMeta(s).controller;n instanceof $n?e=function(t,e){return t.backgroundColor=t.data.map((()=>Xo(e++))),e}(i,e):n instanceof Yn?e=function(t,e){return t.backgroundColor=t.data.map((()=>qo(e++))),e}(i,e):n&&(e=function(t,e){return t.borderColor=Xo(e),t.backgroundColor=qo(e),++e}(i,e))}}function Go(t){let e;for(e in t)if(t[e].borderColor||t[e].backgroundColor)return!0;return!1}var Jo={id:"colors",defaults:{enabled:!0,forceOverride:!1},beforeLayout(t,e,i){if(!i.enabled)return;const{data:{datasets:s},options:n}=t.config,{elements:o}=n,a=Go(s)||(r=n)&&(r.borderColor||r.backgroundColor)||o&&Go(o)||"rgba(0,0,0,0.1)"!==ue.borderColor||"rgba(0,0,0,0.1)"!==ue.backgroundColor;var r;if(!i.forceOverride&&a)return;const l=Ko(t);s.forEach(l)}};function Zo(t){if(t._decimated){const e=t._data;delete t._decimated,delete t._data,Object.defineProperty(t,"data",{configurable:!0,enumerable:!0,writable:!0,value:e})}}function Qo(t){t.data.datasets.forEach((t=>{Zo(t)}))}var ta={id:"decimation",defaults:{algorithm:"min-max",enabled:!1},beforeElementsUpdate:(t,e,i)=>{if(!i.enabled)return void Qo(t);const n=t.width;t.data.datasets.forEach(((e,o)=>{const{_data:a,indexAxis:r}=e,l=t.getDatasetMeta(o),h=a||e.data;if("y"===Pi([r,t.options.indexAxis]))return;if(!l.controller.supportsDecimation)return;const c=t.scales[l.xAxisID];if("linear"!==c.type&&"time"!==c.type)return;if(t.options.parsing)return;let{start:d,count:u}=function(t,e){const i=e.length;let s,n=0;const{iScale:o}=t,{min:a,max:r,minDefined:l,maxDefined:h}=o.getUserBounds();return l&&(n=Z(it(e,o.axis,a).lo,0,i-1)),s=h?Z(it(e,o.axis,r).hi+1,n,i)-n:i-n,{start:n,count:s}}(l,h);if(u<=(i.threshold||4*n))return void Zo(e);let f;switch(s(a)&&(e._data=h,delete e.data,Object.defineProperty(e,"data",{configurable:!0,enumerable:!0,get:function(){return this._decimated},set:function(t){this._data=t}})),i.algorithm){case"lttb":f=function(t,e,i,s,n){const o=n.samples||s;if(o>=i)return t.slice(e,e+i);const a=[],r=(i-2)/(o-2);let l=0;const h=e+i-1;let c,d,u,f,g,p=e;for(a[l++]=t[p],c=0;c<o-2;c++){let s,n=0,o=0;const h=Math.floor((c+1)*r)+1+e,m=Math.min(Math.floor((c+2)*r)+1,i)+e,x=m-h;for(s=h;s<m;s++)n+=t[s].x,o+=t[s].y;n/=x,o/=x;const b=Math.floor(c*r)+1+e,_=Math.min(Math.floor((c+1)*r)+1,i)+e,{x:y,y:v}=t[p];for(u=f=-1,s=b;s<_;s++)f=.5*Math.abs((y-n)*(t[s].y-v)-(y-t[s].x)*(o-v)),f>u&&(u=f,d=t[s],g=s);a[l++]=d,p=g}return a[l++]=t[h],a}(h,d,u,n,i);break;case"min-max":f=function(t,e,i,n){let o,a,r,l,h,c,d,u,f,g,p=0,m=0;const x=[],b=e+i-1,_=t[e].x,y=t[b].x-_;for(o=e;o<e+i;++o){a=t[o],r=(a.x-_)/y*n,l=a.y;const e=0|r;if(e===h)l<f?(f=l,c=o):l>g&&(g=l,d=o),p=(m*p+a.x)/++m;else{const i=o-1;if(!s(c)&&!s(d)){const e=Math.min(c,d),s=Math.max(c,d);e!==u&&e!==i&&x.push({...t[e],x:p}),s!==u&&s!==i&&x.push({...t[s],x:p})}o>0&&i!==u&&x.push(t[i]),x.push(a),h=e,m=0,f=g=l,c=d=u=o}}return x}(h,d,u,n);break;default:throw new Error(`Unsupported decimation algorithm '${i.algorithm}'`)}e._decimated=f}))},destroy(t){Qo(t)}};function ea(t,e,i,s){if(s)return;let n=e[t],o=i[t];return"angle"===t&&(n=G(n),o=G(o)),{property:t,start:n,end:o}}function ia(t,e,i){for(;e>t;e--){const t=i[e];if(!isNaN(t.x)&&!isNaN(t.y))break}return e}function sa(t,e,i,s){return t&&e?s(t[i],e[i]):t?t[i]:e?e[i]:0}function na(t,e){let i=[],s=!1;return n(t)?(s=!0,i=t):i=function(t,e){const{x:i=null,y:s=null}=t||{},n=e.points,o=[];return e.segments.forEach((({start:t,end:e})=>{e=ia(t,e,n);const a=n[t],r=n[e];null!==s?(o.push({x:a.x,y:s}),o.push({x:r.x,y:s})):null!==i&&(o.push({x:i,y:a.y}),o.push({x:i,y:r.y}))})),o}(t,e),i.length?new oo({points:i,options:{tension:0},_loop:s,_fullLoop:s}):null}function oa(t){return t&&!1!==t.fill}function aa(t,e,i){let s=t[e].fill;const n=[e];let o;if(!i)return s;for(;!1!==s&&-1===n.indexOf(s);){if(!a(s))return s;if(o=t[s],!o)return!1;if(o.visible)return s;n.push(s),s=o.fill}return!1}function ra(t,e,i){const s=function(t){const e=t.options,i=e.fill;let s=l(i&&i.target,i);void 0===s&&(s=!!e.backgroundColor);if(!1===s||null===s)return!1;if(!0===s)return"origin";return s}(t);if(o(s))return!isNaN(s.value)&&s;let n=parseFloat(s);return a(n)&&Math.floor(n)===n?function(t,e,i,s){"-"!==t&&"+"!==t||(i=e+i);if(i===e||i<0||i>=s)return!1;return i}(s[0],e,n,i):["origin","start","end","stack","shape"].indexOf(s)>=0&&s}function la(t,e,i){const s=[];for(let n=0;n<i.length;n++){const o=i[n],{first:a,last:r,point:l}=ha(o,e,"x");if(!(!l||a&&r))if(a)s.unshift(l);else if(t.push(l),!r)break}t.push(...s)}function ha(t,e,i){const s=t.interpolate(e,i);if(!s)return{};const n=s[i],o=t.segments,a=t.points;let r=!1,l=!1;for(let t=0;t<o.length;t++){const e=o[t],s=a[e.start][i],h=a[e.end][i];if(tt(n,s,h)){r=n===s,l=n===h;break}}return{first:r,last:l,point:s}}class ca{constructor(t){this.x=t.x,this.y=t.y,this.radius=t.radius}pathSegment(t,e,i){const{x:s,y:n,radius:o}=this;return e=e||{start:0,end:O},t.arc(s,n,o,e.end,e.start,!0),!i.bounds}interpolate(t){const{x:e,y:i,radius:s}=this,n=t.angle;return{x:e+Math.cos(n)*s,y:i+Math.sin(n)*s,angle:n}}}function da(t){const{chart:e,fill:i,line:s}=t;if(a(i))return function(t,e){const i=t.getDatasetMeta(e),s=i&&t.isDatasetVisible(e);return s?i.dataset:null}(e,i);if("stack"===i)return function(t){const{scale:e,index:i,line:s}=t,n=[],o=s.segments,a=s.points,r=function(t,e){const i=[],s=t.getMatchingVisibleMetas("line");for(let t=0;t<s.length;t++){const n=s[t];if(n.index===e)break;n.hidden||i.unshift(n.dataset)}return i}(e,i);r.push(na({x:null,y:e.bottom},s));for(let t=0;t<o.length;t++){const e=o[t];for(let t=e.start;t<=e.end;t++)la(n,a[t],r)}return new oo({points:n,options:{}})}(t);if("shape"===i)return!0;const n=function(t){const e=t.scale||{};if(e.getPointPositionForValue)return function(t){const{scale:e,fill:i}=t,s=e.options,n=e.getLabels().length,a=s.reverse?e.max:e.min,r=function(t,e,i){let s;return s="start"===t?i:"end"===t?e.options.reverse?e.min:e.max:o(t)?t.value:e.getBaseValue(),s}(i,e,a),l=[];if(s.grid.circular){const t=e.getPointPositionForValue(0,a);return new ca({x:t.x,y:t.y,radius:e.getDistanceFromCenterForValue(r)})}for(let t=0;t<n;++t)l.push(e.getPointPositionForValue(t,r));return l}(t);return function(t){const{scale:e={},fill:i}=t,s=function(t,e){let i=null;return"start"===t?i=e.bottom:"end"===t?i=e.top:o(t)?i=e.getPixelForValue(t.value):e.getBasePixel&&(i=e.getBasePixel()),i}(i,e);if(a(s)){const t=e.isHorizontal();return{x:t?s:null,y:t?null:s}}return null}(t)}(t);return n instanceof ca?n:na(n,s)}function ua(t,e,i){const s=da(e),{chart:n,index:o,line:a,scale:r,axis:l}=e,h=a.options,c=h.fill,d=h.backgroundColor,{above:u=d,below:f=d}=c||{},g=n.getDatasetMeta(o),p=Ni(n,g);s&&a.points.length&&(Ie(t,i),function(t,e){const{line:i,target:s,above:n,below:o,area:a,scale:r,clip:l}=e,h=i._loop?"angle":e.axis;t.save();let c=o;o!==n&&("x"===h?(fa(t,s,a.top),pa(t,{line:i,target:s,color:n,scale:r,property:h,clip:l}),t.restore(),t.save(),fa(t,s,a.bottom)):"y"===h&&(ga(t,s,a.left),pa(t,{line:i,target:s,color:o,scale:r,property:h,clip:l}),t.restore(),t.save(),ga(t,s,a.right),c=n));pa(t,{line:i,target:s,color:c,scale:r,property:h,clip:l}),t.restore()}(t,{line:a,target:s,above:u,below:f,area:i,scale:r,axis:l,clip:p}),ze(t))}function fa(t,e,i){const{segments:s,points:n}=e;let o=!0,a=!1;t.beginPath();for(const r of s){const{start:s,end:l}=r,h=n[s],c=n[ia(s,l,n)];o?(t.moveTo(h.x,h.y),o=!1):(t.lineTo(h.x,i),t.lineTo(h.x,h.y)),a=!!e.pathSegment(t,r,{move:a}),a?t.closePath():t.lineTo(c.x,i)}t.lineTo(e.first().x,i),t.closePath(),t.clip()}function ga(t,e,i){const{segments:s,points:n}=e;let o=!0,a=!1;t.beginPath();for(const r of s){const{start:s,end:l}=r,h=n[s],c=n[ia(s,l,n)];o?(t.moveTo(h.x,h.y),o=!1):(t.lineTo(i,h.y),t.lineTo(h.x,h.y)),a=!!e.pathSegment(t,r,{move:a}),a?t.closePath():t.lineTo(i,c.y)}t.lineTo(i,e.first().y),t.closePath(),t.clip()}function pa(t,e){const{line:i,target:s,property:n,color:o,scale:a,clip:r}=e,l=function(t,e,i){const s=t.segments,n=t.points,o=e.points,a=[];for(const t of s){let{start:s,end:r}=t;r=ia(s,r,n);const l=ea(i,n[s],n[r],t.loop);if(!e.segments){a.push({source:t,target:l,start:n[s],end:n[r]});continue}const h=Ii(e,l);for(const e of h){const s=ea(i,o[e.start],o[e.end],e.loop),r=Ri(t,n,s);for(const t of r)a.push({source:t,target:e,start:{[i]:sa(l,s,"start",Math.max)},end:{[i]:sa(l,s,"end",Math.min)}})}}return a}(i,s,n);for(const{source:e,target:h,start:c,end:d}of l){const{style:{backgroundColor:l=o}={}}=e,u=!0!==s;t.save(),t.fillStyle=l,ma(t,a,r,u&&ea(n,c,d)),t.beginPath();const f=!!i.pathSegment(t,e);let g;if(u){f?t.closePath():xa(t,s,d,n);const e=!!s.pathSegment(t,h,{move:f,reverse:!0});g=f&&e,g||xa(t,s,c,n)}t.closePath(),t.fill(g?"evenodd":"nonzero"),t.restore()}}function ma(t,e,i,s){const n=e.chart.chartArea,{property:o,start:a,end:r}=s||{};if("x"===o||"y"===o){let e,s,l,h;"x"===o?(e=a,s=n.top,l=r,h=n.bottom):(e=n.left,s=a,l=n.right,h=r),t.beginPath(),i&&(e=Math.max(e,i.left),l=Math.min(l,i.right),s=Math.max(s,i.top),h=Math.min(h,i.bottom)),t.rect(e,s,l-e,h-s),t.clip()}}function xa(t,e,i,s){const n=e.interpolate(i,s);n&&t.lineTo(n.x,n.y)}var ba={id:"filler",afterDatasetsUpdate(t,e,i){const s=(t.data.datasets||[]).length,n=[];let o,a,r,l;for(a=0;a<s;++a)o=t.getDatasetMeta(a),r=o.dataset,l=null,r&&r.options&&r instanceof oo&&(l={visible:t.isDatasetVisible(a),index:a,fill:ra(r,a,s),chart:t,axis:o.controller.options.indexAxis,scale:o.vScale,line:r}),o.$filler=l,n.push(l);for(a=0;a<s;++a)l=n[a],l&&!1!==l.fill&&(l.fill=aa(n,a,i.propagate))},beforeDraw(t,e,i){const s="beforeDraw"===i.drawTime,n=t.getSortedVisibleDatasetMetas(),o=t.chartArea;for(let e=n.length-1;e>=0;--e){const i=n[e].$filler;i&&(i.line.updateControlPoints(o,i.axis),s&&i.fill&&ua(t.ctx,i,o))}},beforeDatasetsDraw(t,e,i){if("beforeDatasetsDraw"!==i.drawTime)return;const s=t.getSortedVisibleDatasetMetas();for(let e=s.length-1;e>=0;--e){const i=s[e].$filler;oa(i)&&ua(t.ctx,i,t.chartArea)}},beforeDatasetDraw(t,e,i){const s=e.meta.$filler;oa(s)&&"beforeDatasetDraw"===i.drawTime&&ua(t.ctx,s,t.chartArea)},defaults:{propagate:!0,drawTime:"beforeDatasetDraw"}};const _a=(t,e)=>{let{boxHeight:i=e,boxWidth:s=e}=t;return t.usePointStyle&&(i=Math.min(i,e),s=t.pointStyleWidth||Math.min(s,e)),{boxWidth:s,boxHeight:i,itemHeight:Math.max(e,i)}};class ya extends $s{constructor(t){super(),this._added=!1,this.legendHitBoxes=[],this._hoveredItem=null,this.doughnutMode=!1,this.chart=t.chart,this.options=t.options,this.ctx=t.ctx,this.legendItems=void 0,this.columnSizes=void 0,this.lineWidths=void 0,this.maxHeight=void 0,this.maxWidth=void 0,this.top=void 0,this.bottom=void 0,this.left=void 0,this.right=void 0,this.height=void 0,this.width=void 0,this._margins=void 0,this.position=void 0,this.weight=void 0,this.fullSize=void 0}update(t,e,i){this.maxWidth=t,this.maxHeight=e,this._margins=i,this.setDimensions(),this.buildLabels(),this.fit()}setDimensions(){this.isHorizontal()?(this.width=this.maxWidth,this.left=this._margins.left,this.right=this.width):(this.height=this.maxHeight,this.top=this._margins.top,this.bottom=this.height)}buildLabels(){const t=this.options.labels||{};let e=d(t.generateLabels,[this.chart],this)||[];t.filter&&(e=e.filter((e=>t.filter(e,this.chart.data)))),t.sort&&(e=e.sort(((e,i)=>t.sort(e,i,this.chart.data)))),this.options.reverse&&e.reverse(),this.legendItems=e}fit(){const{options:t,ctx:e}=this;if(!t.display)return void(this.width=this.height=0);const i=t.labels,s=Si(i.font),n=s.size,o=this._computeTitleHeight(),{boxWidth:a,itemHeight:r}=_a(i,n);let l,h;e.font=s.string,this.isHorizontal()?(l=this.maxWidth,h=this._fitRows(o,n,a,r)+10):(h=this.maxHeight,l=this._fitCols(o,s,a,r)+10),this.width=Math.min(l,t.maxWidth||this.maxWidth),this.height=Math.min(h,t.maxHeight||this.maxHeight)}_fitRows(t,e,i,s){const{ctx:n,maxWidth:o,options:{labels:{padding:a}}}=this,r=this.legendHitBoxes=[],l=this.lineWidths=[0],h=s+a;let c=t;n.textAlign="left",n.textBaseline="middle";let d=-1,u=-h;return this.legendItems.forEach(((t,f)=>{const g=i+e/2+n.measureText(t.text).width;(0===f||l[l.length-1]+g+2*a>o)&&(c+=h,l[l.length-(f>0?0:1)]=0,u+=h,d++),r[f]={left:0,top:u,row:d,width:g,height:s},l[l.length-1]+=g+a})),c}_fitCols(t,e,i,s){const{ctx:n,maxHeight:o,options:{labels:{padding:a}}}=this,r=this.legendHitBoxes=[],l=this.columnSizes=[],h=o-t;let c=a,d=0,u=0,f=0,g=0;return this.legendItems.forEach(((t,o)=>{const{itemWidth:p,itemHeight:m}=function(t,e,i,s,n){const o=function(t,e,i,s){let n=t.text;n&&"string"!=typeof n&&(n=n.reduce(((t,e)=>t.length>e.length?t:e)));return e+i.size/2+s.measureText(n).width}(s,t,e,i),a=function(t,e,i){let s=t;"string"!=typeof e.text&&(s=va(e,i));return s}(n,s,e.lineHeight);return{itemWidth:o,itemHeight:a}}(i,e,n,t,s);o>0&&u+m+2*a>h&&(c+=d+a,l.push({width:d,height:u}),f+=d+a,g++,d=u=0),r[o]={left:f,top:u,col:g,width:p,height:m},d=Math.max(d,p),u+=m+a})),c+=d,l.push({width:d,height:u}),c}adjustHitBoxes(){if(!this.options.display)return;const t=this._computeTitleHeight(),{legendHitBoxes:e,options:{align:i,labels:{padding:s},rtl:n}}=this,o=Oi(n,this.left,this.width);if(this.isHorizontal()){let n=0,a=ft(i,this.left+s,this.right-this.lineWidths[n]);for(const r of e)n!==r.row&&(n=r.row,a=ft(i,this.left+s,this.right-this.lineWidths[n])),r.top+=this.top+t+s,r.left=o.leftForLtr(o.x(a),r.width),a+=r.width+s}else{let n=0,a=ft(i,this.top+t+s,this.bottom-this.columnSizes[n].height);for(const r of e)r.col!==n&&(n=r.col,a=ft(i,this.top+t+s,this.bottom-this.columnSizes[n].height)),r.top=a,r.left+=this.left+s,r.left=o.leftForLtr(o.x(r.left),r.width),a+=r.height+s}}isHorizontal(){return"top"===this.options.position||"bottom"===this.options.position}draw(){if(this.options.display){const t=this.ctx;Ie(t,this),this._draw(),ze(t)}}_draw(){const{options:t,columnSizes:e,lineWidths:i,ctx:s}=this,{align:n,labels:o}=t,a=ue.color,r=Oi(t.rtl,this.left,this.width),h=Si(o.font),{padding:c}=o,d=h.size,u=d/2;let f;this.drawTitle(),s.textAlign=r.textAlign("left"),s.textBaseline="middle",s.lineWidth=.5,s.font=h.string;const{boxWidth:g,boxHeight:p,itemHeight:m}=_a(o,d),x=this.isHorizontal(),b=this._computeTitleHeight();f=x?{x:ft(n,this.left+c,this.right-i[0]),y:this.top+c+b,line:0}:{x:this.left+c,y:ft(n,this.top+b+c,this.bottom-e[0].height),line:0},Ai(this.ctx,t.textDirection);const _=m+c;this.legendItems.forEach(((y,v)=>{s.strokeStyle=y.fontColor,s.fillStyle=y.fontColor;const M=s.measureText(y.text).width,w=r.textAlign(y.textAlign||(y.textAlign=o.textAlign)),k=g+u+M;let S=f.x,P=f.y;r.setWidth(this.width),x?v>0&&S+k+c>this.right&&(P=f.y+=_,f.line++,S=f.x=ft(n,this.left+c,this.right-i[f.line])):v>0&&P+_>this.bottom&&(S=f.x=S+e[f.line].width+c,f.line++,P=f.y=ft(n,this.top+b+c,this.bottom-e[f.line].height));if(function(t,e,i){if(isNaN(g)||g<=0||isNaN(p)||p<0)return;s.save();const n=l(i.lineWidth,1);if(s.fillStyle=l(i.fillStyle,a),s.lineCap=l(i.lineCap,"butt"),s.lineDashOffset=l(i.lineDashOffset,0),s.lineJoin=l(i.lineJoin,"miter"),s.lineWidth=n,s.strokeStyle=l(i.strokeStyle,a),s.setLineDash(l(i.lineDash,[])),o.usePointStyle){const a={radius:p*Math.SQRT2/2,pointStyle:i.pointStyle,rotation:i.rotation,borderWidth:n},l=r.xPlus(t,g/2);Ee(s,a,l,e+u,o.pointStyleWidth&&g)}else{const o=e+Math.max((d-p)/2,0),a=r.leftForLtr(t,g),l=wi(i.borderRadius);s.beginPath(),Object.values(l).some((t=>0!==t))?He(s,{x:a,y:o,w:g,h:p,radius:l}):s.rect(a,o,g,p),s.fill(),0!==n&&s.stroke()}s.restore()}(r.x(S),P,y),S=gt(w,S+g+u,x?S+k:this.right,t.rtl),function(t,e,i){Ne(s,i.text,t,e+m/2,h,{strikethrough:i.hidden,textAlign:r.textAlign(i.textAlign)})}(r.x(S),P,y),x)f.x+=k+c;else if("string"!=typeof y.text){const t=h.lineHeight;f.y+=va(y,t)+c}else f.y+=_})),Ti(this.ctx,t.textDirection)}drawTitle(){const t=this.options,e=t.title,i=Si(e.font),s=ki(e.padding);if(!e.display)return;const n=Oi(t.rtl,this.left,this.width),o=this.ctx,a=e.position,r=i.size/2,l=s.top+r;let h,c=this.left,d=this.width;if(this.isHorizontal())d=Math.max(...this.lineWidths),h=this.top+l,c=ft(t.align,c,this.right-d);else{const e=this.columnSizes.reduce(((t,e)=>Math.max(t,e.height)),0);h=l+ft(t.align,this.top,this.bottom-e-t.labels.padding-this._computeTitleHeight())}const u=ft(a,c,c+d);o.textAlign=n.textAlign(ut(a)),o.textBaseline="middle",o.strokeStyle=e.color,o.fillStyle=e.color,o.font=i.string,Ne(o,e.text,u,h,i)}_computeTitleHeight(){const t=this.options.title,e=Si(t.font),i=ki(t.padding);return t.display?e.lineHeight+i.height:0}_getLegendItemAt(t,e){let i,s,n;if(tt(t,this.left,this.right)&&tt(e,this.top,this.bottom))for(n=this.legendHitBoxes,i=0;i<n.length;++i)if(s=n[i],tt(t,s.left,s.left+s.width)&&tt(e,s.top,s.top+s.height))return this.legendItems[i];return null}handleEvent(t){const e=this.options;if(!function(t,e){if(("mousemove"===t||"mouseout"===t)&&(e.onHover||e.onLeave))return!0;if(e.onClick&&("click"===t||"mouseup"===t))return!0;return!1}(t.type,e))return;const i=this._getLegendItemAt(t.x,t.y);if("mousemove"===t.type||"mouseout"===t.type){const o=this._hoveredItem,a=(n=i,null!==(s=o)&&null!==n&&s.datasetIndex===n.datasetIndex&&s.index===n.index);o&&!a&&d(e.onLeave,[t,o,this],this),this._hoveredItem=i,i&&!a&&d(e.onHover,[t,i,this],this)}else i&&d(e.onClick,[t,i,this],this);var s,n}}function va(t,e){return e*(t.text?t.text.length:0)}var Ma={id:"legend",_element:ya,start(t,e,i){const s=t.legend=new ya({ctx:t.ctx,options:i,chart:t});ls.configure(t,s,i),ls.addBox(t,s)},stop(t){ls.removeBox(t,t.legend),delete t.legend},beforeUpdate(t,e,i){const s=t.legend;ls.configure(t,s,i),s.options=i},afterUpdate(t){const e=t.legend;e.buildLabels(),e.adjustHitBoxes()},afterEvent(t,e){e.replay||t.legend.handleEvent(e.event)},defaults:{display:!0,position:"top",align:"center",fullSize:!0,reverse:!1,weight:1e3,onClick(t,e,i){const s=e.datasetIndex,n=i.chart;n.isDatasetVisible(s)?(n.hide(s),e.hidden=!0):(n.show(s),e.hidden=!1)},onHover:null,onLeave:null,labels:{color:t=>t.chart.options.color,boxWidth:40,padding:10,generateLabels(t){const e=t.data.datasets,{labels:{usePointStyle:i,pointStyle:s,textAlign:n,color:o,useBorderRadius:a,borderRadius:r}}=t.legend.options;return t._getSortedDatasetMetas().map((t=>{const l=t.controller.getStyle(i?0:void 0),h=ki(l.borderWidth);return{text:e[t.index].label,fillStyle:l.backgroundColor,fontColor:o,hidden:!t.visible,lineCap:l.borderCapStyle,lineDash:l.borderDash,lineDashOffset:l.borderDashOffset,lineJoin:l.borderJoinStyle,lineWidth:(h.width+h.height)/4,strokeStyle:l.borderColor,pointStyle:s||l.pointStyle,rotation:l.rotation,textAlign:n||l.textAlign,borderRadius:a&&(r||l.borderRadius),datasetIndex:t.index}}),this)}},title:{color:t=>t.chart.options.color,display:!1,position:"center",text:""}},descriptors:{_scriptable:t=>!t.startsWith("on"),labels:{_scriptable:t=>!["generateLabels","filter","sort"].includes(t)}}};class wa extends $s{constructor(t){super(),this.chart=t.chart,this.options=t.options,this.ctx=t.ctx,this._padding=void 0,this.top=void 0,this.bottom=void 0,this.left=void 0,this.right=void 0,this.width=void 0,this.height=void 0,this.position=void 0,this.weight=void 0,this.fullSize=void 0}update(t,e){const i=this.options;if(this.left=0,this.top=0,!i.display)return void(this.width=this.height=this.right=this.bottom=0);this.width=this.right=t,this.height=this.bottom=e;const s=n(i.text)?i.text.length:1;this._padding=ki(i.padding);const o=s*Si(i.font).lineHeight+this._padding.height;this.isHorizontal()?this.height=o:this.width=o}isHorizontal(){const t=this.options.position;return"top"===t||"bottom"===t}_drawArgs(t){const{top:e,left:i,bottom:s,right:n,options:o}=this,a=o.align;let r,l,h,c=0;return this.isHorizontal()?(l=ft(a,i,n),h=e+t,r=n-i):("left"===o.position?(l=i+t,h=ft(a,s,e),c=-.5*C):(l=n-t,h=ft(a,e,s),c=.5*C),r=s-e),{titleX:l,titleY:h,maxWidth:r,rotation:c}}draw(){const t=this.ctx,e=this.options;if(!e.display)return;const i=Si(e.font),s=i.lineHeight/2+this._padding.top,{titleX:n,titleY:o,maxWidth:a,rotation:r}=this._drawArgs(s);Ne(t,e.text,0,0,i,{color:e.color,maxWidth:a,rotation:r,textAlign:ut(e.align),textBaseline:"middle",translation:[n,o]})}}var ka={id:"title",_element:wa,start(t,e,i){!function(t,e){const i=new wa({ctx:t.ctx,options:e,chart:t});ls.configure(t,i,e),ls.addBox(t,i),t.titleBlock=i}(t,i)},stop(t){const e=t.titleBlock;ls.removeBox(t,e),delete t.titleBlock},beforeUpdate(t,e,i){const s=t.titleBlock;ls.configure(t,s,i),s.options=i},defaults:{align:"center",display:!1,font:{weight:"bold"},fullSize:!0,padding:10,position:"top",text:"",weight:2e3},defaultRoutes:{color:"color"},descriptors:{_scriptable:!0,_indexable:!1}};const Sa=new WeakMap;var Pa={id:"subtitle",start(t,e,i){const s=new wa({ctx:t.ctx,options:i,chart:t});ls.configure(t,s,i),ls.addBox(t,s),Sa.set(t,s)},stop(t){ls.removeBox(t,Sa.get(t)),Sa.delete(t)},beforeUpdate(t,e,i){const s=Sa.get(t);ls.configure(t,s,i),s.options=i},defaults:{align:"center",display:!1,font:{weight:"normal"},fullSize:!0,padding:0,position:"top",text:"",weight:1500},defaultRoutes:{color:"color"},descriptors:{_scriptable:!0,_indexable:!1}};const Da={average(t){if(!t.length)return!1;let e,i,s=new Set,n=0,o=0;for(e=0,i=t.length;e<i;++e){const i=t[e].element;if(i&&i.hasValue()){const t=i.tooltipPosition();s.add(t.x),n+=t.y,++o}}if(0===o||0===s.size)return!1;return{x:[...s].reduce(((t,e)=>t+e))/s.size,y:n/o}},nearest(t,e){if(!t.length)return!1;let i,s,n,o=e.x,a=e.y,r=Number.POSITIVE_INFINITY;for(i=0,s=t.length;i<s;++i){const s=t[i].element;if(s&&s.hasValue()){const t=q(e,s.getCenterPoint());t<r&&(r=t,n=s)}}if(n){const t=n.tooltipPosition();o=t.x,a=t.y}return{x:o,y:a}}};function Ca(t,e){return e&&(n(e)?Array.prototype.push.apply(t,e):t.push(e)),t}function Oa(t){return("string"==typeof t||t instanceof String)&&t.indexOf("\n")>-1?t.split("\n"):t}function Aa(t,e){const{element:i,datasetIndex:s,index:n}=e,o=t.getDatasetMeta(s).controller,{label:a,value:r}=o.getLabelAndValue(n);return{chart:t,label:a,parsed:o.getParsed(n),raw:t.data.datasets[s].data[n],formattedValue:r,dataset:o.getDataset(),dataIndex:n,datasetIndex:s,element:i}}function Ta(t,e){const i=t.chart.ctx,{body:s,footer:n,title:o}=t,{boxWidth:a,boxHeight:r}=e,l=Si(e.bodyFont),h=Si(e.titleFont),c=Si(e.footerFont),d=o.length,f=n.length,g=s.length,p=ki(e.padding);let m=p.height,x=0,b=s.reduce(((t,e)=>t+e.before.length+e.lines.length+e.after.length),0);if(b+=t.beforeBody.length+t.afterBody.length,d&&(m+=d*h.lineHeight+(d-1)*e.titleSpacing+e.titleMarginBottom),b){m+=g*(e.displayColors?Math.max(r,l.lineHeight):l.lineHeight)+(b-g)*l.lineHeight+(b-1)*e.bodySpacing}f&&(m+=e.footerMarginTop+f*c.lineHeight+(f-1)*e.footerSpacing);let _=0;const y=function(t){x=Math.max(x,i.measureText(t).width+_)};return i.save(),i.font=h.string,u(t.title,y),i.font=l.string,u(t.beforeBody.concat(t.afterBody),y),_=e.displayColors?a+2+e.boxPadding:0,u(s,(t=>{u(t.before,y),u(t.lines,y),u(t.after,y)})),_=0,i.font=c.string,u(t.footer,y),i.restore(),x+=p.width,{width:x,height:m}}function La(t,e,i,s){const{x:n,width:o}=i,{width:a,chartArea:{left:r,right:l}}=t;let h="center";return"center"===s?h=n<=(r+l)/2?"left":"right":n<=o/2?h="left":n>=a-o/2&&(h="right"),function(t,e,i,s){const{x:n,width:o}=s,a=i.caretSize+i.caretPadding;return"left"===t&&n+o+a>e.width||"right"===t&&n-o-a<0||void 0}(h,t,e,i)&&(h="center"),h}function Ea(t,e,i){const s=i.yAlign||e.yAlign||function(t,e){const{y:i,height:s}=e;return i<s/2?"top":i>t.height-s/2?"bottom":"center"}(t,i);return{xAlign:i.xAlign||e.xAlign||La(t,e,i,s),yAlign:s}}function Ra(t,e,i,s){const{caretSize:n,caretPadding:o,cornerRadius:a}=t,{xAlign:r,yAlign:l}=i,h=n+o,{topLeft:c,topRight:d,bottomLeft:u,bottomRight:f}=wi(a);let g=function(t,e){let{x:i,width:s}=t;return"right"===e?i-=s:"center"===e&&(i-=s/2),i}(e,r);const p=function(t,e,i){let{y:s,height:n}=t;return"top"===e?s+=i:s-="bottom"===e?n+i:n/2,s}(e,l,h);return"center"===l?"left"===r?g+=h:"right"===r&&(g-=h):"left"===r?g-=Math.max(c,u)+n:"right"===r&&(g+=Math.max(d,f)+n),{x:Z(g,0,s.width-e.width),y:Z(p,0,s.height-e.height)}}function Ia(t,e,i){const s=ki(i.padding);return"center"===e?t.x+t.width/2:"right"===e?t.x+t.width-s.right:t.x+s.left}function za(t){return Ca([],Oa(t))}function Fa(t,e){const i=e&&e.dataset&&e.dataset.tooltip&&e.dataset.tooltip.callbacks;return i?t.override(i):t}const Va={beforeTitle:e,title(t){if(t.length>0){const e=t[0],i=e.chart.data.labels,s=i?i.length:0;if(this&&this.options&&"dataset"===this.options.mode)return e.dataset.label||"";if(e.label)return e.label;if(s>0&&e.dataIndex<s)return i[e.dataIndex]}return""},afterTitle:e,beforeBody:e,beforeLabel:e,label(t){if(this&&this.options&&"dataset"===this.options.mode)return t.label+": "+t.formattedValue||t.formattedValue;let e=t.dataset.label||"";e&&(e+=": ");const i=t.formattedValue;return s(i)||(e+=i),e},labelColor(t){const e=t.chart.getDatasetMeta(t.datasetIndex).controller.getStyle(t.dataIndex);return{borderColor:e.borderColor,backgroundColor:e.backgroundColor,borderWidth:e.borderWidth,borderDash:e.borderDash,borderDashOffset:e.borderDashOffset,borderRadius:0}},labelTextColor(){return this.options.bodyColor},labelPointStyle(t){const e=t.chart.getDatasetMeta(t.datasetIndex).controller.getStyle(t.dataIndex);return{pointStyle:e.pointStyle,rotation:e.rotation}},afterLabel:e,afterBody:e,beforeFooter:e,footer:e,afterFooter:e};function Ba(t,e,i,s){const n=t[e].call(i,s);return void 0===n?Va[e].call(i,s):n}class Wa extends $s{static positioners=Da;constructor(t){super(),this.opacity=0,this._active=[],this._eventPosition=void 0,this._size=void 0,this._cachedAnimations=void 0,this._tooltipItems=[],this.$animations=void 0,this.$context=void 0,this.chart=t.chart,this.options=t.options,this.dataPoints=void 0,this.title=void 0,this.beforeBody=void 0,this.body=void 0,this.afterBody=void 0,this.footer=void 0,this.xAlign=void 0,this.yAlign=void 0,this.x=void 0,this.y=void 0,this.height=void 0,this.width=void 0,this.caretX=void 0,this.caretY=void 0,this.labelColors=void 0,this.labelPointStyles=void 0,this.labelTextColors=void 0}initialize(t){this.options=t,this._cachedAnimations=void 0,this.$context=void 0}_resolveAnimations(){const t=this._cachedAnimations;if(t)return t;const e=this.chart,i=this.options.setContext(this.getContext()),s=i.enabled&&e.options.animation&&i.animations,n=new Ts(this.chart,s);return s._cacheable&&(this._cachedAnimations=Object.freeze(n)),n}getContext(){return this.$context||(this.$context=(t=this.chart.getContext(),e=this,i=this._tooltipItems,Ci(t,{tooltip:e,tooltipItems:i,type:"tooltip"})));var t,e,i}getTitle(t,e){const{callbacks:i}=e,s=Ba(i,"beforeTitle",this,t),n=Ba(i,"title",this,t),o=Ba(i,"afterTitle",this,t);let a=[];return a=Ca(a,Oa(s)),a=Ca(a,Oa(n)),a=Ca(a,Oa(o)),a}getBeforeBody(t,e){return za(Ba(e.callbacks,"beforeBody",this,t))}getBody(t,e){const{callbacks:i}=e,s=[];return u(t,(t=>{const e={before:[],lines:[],after:[]},n=Fa(i,t);Ca(e.before,Oa(Ba(n,"beforeLabel",this,t))),Ca(e.lines,Ba(n,"label",this,t)),Ca(e.after,Oa(Ba(n,"afterLabel",this,t))),s.push(e)})),s}getAfterBody(t,e){return za(Ba(e.callbacks,"afterBody",this,t))}getFooter(t,e){const{callbacks:i}=e,s=Ba(i,"beforeFooter",this,t),n=Ba(i,"footer",this,t),o=Ba(i,"afterFooter",this,t);let a=[];return a=Ca(a,Oa(s)),a=Ca(a,Oa(n)),a=Ca(a,Oa(o)),a}_createItems(t){const e=this._active,i=this.chart.data,s=[],n=[],o=[];let a,r,l=[];for(a=0,r=e.length;a<r;++a)l.push(Aa(this.chart,e[a]));return t.filter&&(l=l.filter(((e,s,n)=>t.filter(e,s,n,i)))),t.itemSort&&(l=l.sort(((e,s)=>t.itemSort(e,s,i)))),u(l,(e=>{const i=Fa(t.callbacks,e);s.push(Ba(i,"labelColor",this,e)),n.push(Ba(i,"labelPointStyle",this,e)),o.push(Ba(i,"labelTextColor",this,e))})),this.labelColors=s,this.labelPointStyles=n,this.labelTextColors=o,this.dataPoints=l,l}update(t,e){const i=this.options.setContext(this.getContext()),s=this._active;let n,o=[];if(s.length){const t=Da[i.position].call(this,s,this._eventPosition);o=this._createItems(i),this.title=this.getTitle(o,i),this.beforeBody=this.getBeforeBody(o,i),this.body=this.getBody(o,i),this.afterBody=this.getAfterBody(o,i),this.footer=this.getFooter(o,i);const e=this._size=Ta(this,i),a=Object.assign({},t,e),r=Ea(this.chart,i,a),l=Ra(i,a,r,this.chart);this.xAlign=r.xAlign,this.yAlign=r.yAlign,n={opacity:1,x:l.x,y:l.y,width:e.width,height:e.height,caretX:t.x,caretY:t.y}}else 0!==this.opacity&&(n={opacity:0});this._tooltipItems=o,this.$context=void 0,n&&this._resolveAnimations().update(this,n),t&&i.external&&i.external.call(this,{chart:this.chart,tooltip:this,replay:e})}drawCaret(t,e,i,s){const n=this.getCaretPosition(t,i,s);e.lineTo(n.x1,n.y1),e.lineTo(n.x2,n.y2),e.lineTo(n.x3,n.y3)}getCaretPosition(t,e,i){const{xAlign:s,yAlign:n}=this,{caretSize:o,cornerRadius:a}=i,{topLeft:r,topRight:l,bottomLeft:h,bottomRight:c}=wi(a),{x:d,y:u}=t,{width:f,height:g}=e;let p,m,x,b,_,y;return"center"===n?(_=u+g/2,"left"===s?(p=d,m=p-o,b=_+o,y=_-o):(p=d+f,m=p+o,b=_-o,y=_+o),x=p):(m="left"===s?d+Math.max(r,h)+o:"right"===s?d+f-Math.max(l,c)-o:this.caretX,"top"===n?(b=u,_=b-o,p=m-o,x=m+o):(b=u+g,_=b+o,p=m+o,x=m-o),y=b),{x1:p,x2:m,x3:x,y1:b,y2:_,y3:y}}drawTitle(t,e,i){const s=this.title,n=s.length;let o,a,r;if(n){const l=Oi(i.rtl,this.x,this.width);for(t.x=Ia(this,i.titleAlign,i),e.textAlign=l.textAlign(i.titleAlign),e.textBaseline="middle",o=Si(i.titleFont),a=i.titleSpacing,e.fillStyle=i.titleColor,e.font=o.string,r=0;r<n;++r)e.fillText(s[r],l.x(t.x),t.y+o.lineHeight/2),t.y+=o.lineHeight+a,r+1===n&&(t.y+=i.titleMarginBottom-a)}}_drawColorBox(t,e,i,s,n){const a=this.labelColors[i],r=this.labelPointStyles[i],{boxHeight:l,boxWidth:h}=n,c=Si(n.bodyFont),d=Ia(this,"left",n),u=s.x(d),f=l<c.lineHeight?(c.lineHeight-l)/2:0,g=e.y+f;if(n.usePointStyle){const e={radius:Math.min(h,l)/2,pointStyle:r.pointStyle,rotation:r.rotation,borderWidth:1},i=s.leftForLtr(u,h)+h/2,o=g+l/2;t.strokeStyle=n.multiKeyBackground,t.fillStyle=n.multiKeyBackground,Le(t,e,i,o),t.strokeStyle=a.borderColor,t.fillStyle=a.backgroundColor,Le(t,e,i,o)}else{t.lineWidth=o(a.borderWidth)?Math.max(...Object.values(a.borderWidth)):a.borderWidth||1,t.strokeStyle=a.borderColor,t.setLineDash(a.borderDash||[]),t.lineDashOffset=a.borderDashOffset||0;const e=s.leftForLtr(u,h),i=s.leftForLtr(s.xPlus(u,1),h-2),r=wi(a.borderRadius);Object.values(r).some((t=>0!==t))?(t.beginPath(),t.fillStyle=n.multiKeyBackground,He(t,{x:e,y:g,w:h,h:l,radius:r}),t.fill(),t.stroke(),t.fillStyle=a.backgroundColor,t.beginPath(),He(t,{x:i,y:g+1,w:h-2,h:l-2,radius:r}),t.fill()):(t.fillStyle=n.multiKeyBackground,t.fillRect(e,g,h,l),t.strokeRect(e,g,h,l),t.fillStyle=a.backgroundColor,t.fillRect(i,g+1,h-2,l-2))}t.fillStyle=this.labelTextColors[i]}drawBody(t,e,i){const{body:s}=this,{bodySpacing:n,bodyAlign:o,displayColors:a,boxHeight:r,boxWidth:l,boxPadding:h}=i,c=Si(i.bodyFont);let d=c.lineHeight,f=0;const g=Oi(i.rtl,this.x,this.width),p=function(i){e.fillText(i,g.x(t.x+f),t.y+d/2),t.y+=d+n},m=g.textAlign(o);let x,b,_,y,v,M,w;for(e.textAlign=o,e.textBaseline="middle",e.font=c.string,t.x=Ia(this,m,i),e.fillStyle=i.bodyColor,u(this.beforeBody,p),f=a&&"right"!==m?"center"===o?l/2+h:l+2+h:0,y=0,M=s.length;y<M;++y){for(x=s[y],b=this.labelTextColors[y],e.fillStyle=b,u(x.before,p),_=x.lines,a&&_.length&&(this._drawColorBox(e,t,y,g,i),d=Math.max(c.lineHeight,r)),v=0,w=_.length;v<w;++v)p(_[v]),d=c.lineHeight;u(x.after,p)}f=0,d=c.lineHeight,u(this.afterBody,p),t.y-=n}drawFooter(t,e,i){const s=this.footer,n=s.length;let o,a;if(n){const r=Oi(i.rtl,this.x,this.width);for(t.x=Ia(this,i.footerAlign,i),t.y+=i.footerMarginTop,e.textAlign=r.textAlign(i.footerAlign),e.textBaseline="middle",o=Si(i.footerFont),e.fillStyle=i.footerColor,e.font=o.string,a=0;a<n;++a)e.fillText(s[a],r.x(t.x),t.y+o.lineHeight/2),t.y+=o.lineHeight+i.footerSpacing}}drawBackground(t,e,i,s){const{xAlign:n,yAlign:o}=this,{x:a,y:r}=t,{width:l,height:h}=i,{topLeft:c,topRight:d,bottomLeft:u,bottomRight:f}=wi(s.cornerRadius);e.fillStyle=s.backgroundColor,e.strokeStyle=s.borderColor,e.lineWidth=s.borderWidth,e.beginPath(),e.moveTo(a+c,r),"top"===o&&this.drawCaret(t,e,i,s),e.lineTo(a+l-d,r),e.quadraticCurveTo(a+l,r,a+l,r+d),"center"===o&&"right"===n&&this.drawCaret(t,e,i,s),e.lineTo(a+l,r+h-f),e.quadraticCurveTo(a+l,r+h,a+l-f,r+h),"bottom"===o&&this.drawCaret(t,e,i,s),e.lineTo(a+u,r+h),e.quadraticCurveTo(a,r+h,a,r+h-u),"center"===o&&"left"===n&&this.drawCaret(t,e,i,s),e.lineTo(a,r+c),e.quadraticCurveTo(a,r,a+c,r),e.closePath(),e.fill(),s.borderWidth>0&&e.stroke()}_updateAnimationTarget(t){const e=this.chart,i=this.$animations,s=i&&i.x,n=i&&i.y;if(s||n){const i=Da[t.position].call(this,this._active,this._eventPosition);if(!i)return;const o=this._size=Ta(this,t),a=Object.assign({},i,this._size),r=Ea(e,t,a),l=Ra(t,a,r,e);s._to===l.x&&n._to===l.y||(this.xAlign=r.xAlign,this.yAlign=r.yAlign,this.width=o.width,this.height=o.height,this.caretX=i.x,this.caretY=i.y,this._resolveAnimations().update(this,l))}}_willRender(){return!!this.opacity}draw(t){const e=this.options.setContext(this.getContext());let i=this.opacity;if(!i)return;this._updateAnimationTarget(e);const s={width:this.width,height:this.height},n={x:this.x,y:this.y};i=Math.abs(i)<.001?0:i;const o=ki(e.padding),a=this.title.length||this.beforeBody.length||this.body.length||this.afterBody.length||this.footer.length;e.enabled&&a&&(t.save(),t.globalAlpha=i,this.drawBackground(n,t,s,e),Ai(t,e.textDirection),n.y+=o.top,this.drawTitle(n,t,e),this.drawBody(n,t,e),this.drawFooter(n,t,e),Ti(t,e.textDirection),t.restore())}getActiveElements(){return this._active||[]}setActiveElements(t,e){const i=this._active,s=t.map((({datasetIndex:t,index:e})=>{const i=this.chart.getDatasetMeta(t);if(!i)throw new Error("Cannot find a dataset at index "+t);return{datasetIndex:t,element:i.data[e],index:e}})),n=!f(i,s),o=this._positionChanged(s,e);(n||o)&&(this._active=s,this._eventPosition=e,this._ignoreReplayEvents=!0,this.update(!0))}handleEvent(t,e,i=!0){if(e&&this._ignoreReplayEvents)return!1;this._ignoreReplayEvents=!1;const s=this.options,n=this._active||[],o=this._getActiveElements(t,n,e,i),a=this._positionChanged(o,t),r=e||!f(o,n)||a;return r&&(this._active=o,(s.enabled||s.external)&&(this._eventPosition={x:t.x,y:t.y},this.update(!0,e))),r}_getActiveElements(t,e,i,s){const n=this.options;if("mouseout"===t.type)return[];if(!s)return e.filter((t=>this.chart.data.datasets[t.datasetIndex]&&void 0!==this.chart.getDatasetMeta(t.datasetIndex).controller.getParsed(t.index)));const o=this.chart.getElementsAtEventForMode(t,n.mode,n,i);return n.reverse&&o.reverse(),o}_positionChanged(t,e){const{caretX:i,caretY:s,options:n}=this,o=Da[n.position].call(this,t,e);return!1!==o&&(i!==o.x||s!==o.y)}}var Na={id:"tooltip",_element:Wa,positioners:Da,afterInit(t,e,i){i&&(t.tooltip=new Wa({chart:t,options:i}))},beforeUpdate(t,e,i){t.tooltip&&t.tooltip.initialize(i)},reset(t,e,i){t.tooltip&&t.tooltip.initialize(i)},afterDraw(t){const e=t.tooltip;if(e&&e._willRender()){const i={tooltip:e};if(!1===t.notifyPlugins("beforeTooltipDraw",{...i,cancelable:!0}))return;e.draw(t.ctx),t.notifyPlugins("afterTooltipDraw",i)}},afterEvent(t,e){if(t.tooltip){const i=e.replay;t.tooltip.handleEvent(e.event,i,e.inChartArea)&&(e.changed=!0)}},defaults:{enabled:!0,external:null,position:"average",backgroundColor:"rgba(0,0,0,0.8)",titleColor:"#fff",titleFont:{weight:"bold"},titleSpacing:2,titleMarginBottom:6,titleAlign:"left",bodyColor:"#fff",bodySpacing:2,bodyFont:{},bodyAlign:"left",footerColor:"#fff",footerSpacing:2,footerMarginTop:6,footerFont:{weight:"bold"},footerAlign:"left",padding:6,caretPadding:2,caretSize:5,cornerRadius:6,boxHeight:(t,e)=>e.bodyFont.size,boxWidth:(t,e)=>e.bodyFont.size,multiKeyBackground:"#fff",displayColors:!0,boxPadding:0,borderColor:"rgba(0,0,0,0)",borderWidth:0,animation:{duration:400,easing:"easeOutQuart"},animations:{numbers:{type:"number",properties:["x","y","width","height","caretX","caretY"]},opacity:{easing:"linear",duration:200}},callbacks:Va},defaultRoutes:{bodyFont:"font",footerFont:"font",titleFont:"font"},descriptors:{_scriptable:t=>"filter"!==t&&"itemSort"!==t&&"external"!==t,_indexable:!1,callbacks:{_scriptable:!1,_indexable:!1},animation:{_fallback:!1},animations:{_fallback:"animation"}},additionalOptionScopes:["interaction"]};return Tn.register(Un,$o,go,t),Tn.helpers={...Hi},Tn._adapters=In,Tn.Animation=As,Tn.Animations=Ts,Tn.animator=bt,Tn.controllers=nn.controllers.items,Tn.DatasetController=js,Tn.Element=$s,Tn.elements=go,Tn.Interaction=Ki,Tn.layouts=ls,Tn.platforms=Ds,Tn.Scale=tn,Tn.Ticks=ae,Object.assign(Tn,Un,$o,go,t,Ds),Tn.Chart=Tn,"undefined"!=typeof window&&(window.Chart=Tn),Tn}));
//# sourceMappingURL=chart.umd.min.js.map

```

---

### File: `public\vendor\chartjs.LICENSE.md`

```
The MIT License (MIT)

Copyright (c) 2014-2024 Chart.js Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

```

---

### File: `routes\analytics.js`

```
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

    const authorized = typeof options.isSessionAuthorized === 'function'
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
      .select('id, name, product_name')
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
      return sendError(res, 503, '資料庫訂單欄位尚未同步，請先執行訂單 schema migration。');
    }
    return sendError(res, 500, `${operation}失敗，請稍後再試。`);
  }

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

```

---

### File: `routes\customer.js`

```
const crypto = require('crypto');
const express = require('express');

const MISSING_RPC_CODES = new Set(['42883', 'PGRST202']);

function sendError(res, status, message) {
  return res.status(status).json({
    success: false,
    data: null,
    message
  });
}

function normalizeOrderId(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
    ? normalized
    : null;
}

function normalizePhone(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().replace(/^\+/, '');
  return /^\d{8,15}$/.test(normalized) ? normalized : null;
}

function getRateLimitKey(remoteAddress, secret) {
  if (typeof remoteAddress !== 'string' || remoteAddress.length === 0) {
    return null;
  }

  return crypto
    .createHmac('sha256', secret)
    .update(remoteAddress)
    .digest('hex');
}

function createCustomerRouter(supabase, options = {}) {
  const router = express.Router();
  const rateLimitSecret = options.rateLimitSecret || '';
  const readEnabled = options.readEnabled === true;

  router.post('/orders/lookup', async (req, res) => {
    try {
      if (!readEnabled) {
        return sendError(res, 503, '訂單查詢服務尚未設定 SUPABASE_SERVICE_ROLE_KEY。');
      }
      if (
        rateLimitSecret.length < 32 ||
        rateLimitSecret.startsWith('replace-with-')
      ) {
        return sendError(res, 503, '訂單查詢服務尚未設定 CUSTOMER_LOOKUP_RATE_SECRET。');
      }

      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return sendError(res, 400, '查詢資料格式無效。');
      }

      const hasPhone = body.customer_phone !== undefined && body.customer_phone !== null;
      const hasOrderId = body.order_id !== undefined && body.order_id !== null;
      if (hasPhone === hasOrderId) {
        return sendError(res, 400, '請只提供 customer_phone 或 order_id 其中一項。');
      }

      let customerPhone = null;
      let orderId = null;
      if (hasPhone) {
        customerPhone = normalizePhone(body.customer_phone);
        if (customerPhone === null) {
          return sendError(res, 400, 'customer_phone 必須是 8 至 15 位數字，可選擇以 + 開頭。');
        }
      } else {
        orderId = normalizeOrderId(body.order_id);
        if (orderId === null) {
          return sendError(res, 400, 'order_id 必須是有效的 UUID 訂單編號。');
        }
      }

      const rateLimitKey = getRateLimitKey(
        req.ip || (req.socket && req.socket.remoteAddress),
        rateLimitSecret
      );
      if (rateLimitKey === null) {
        console.error('無法取得訂單查詢請求來源位址。');
        return sendError(res, 503, '目前無法安全驗證查詢請求，請稍後再試。');
      }

      const { data, error } = await supabase.rpc('lookup_customer_orders', {
        p_customer_phone: customerPhone,
        p_order_id: orderId,
        p_rate_limit_key: rateLimitKey
      });

      if (error) {
        console.error('查詢客戶訂單 Supabase RPC 失敗：', error);
        if (MISSING_RPC_CODES.has(error.code)) {
          return sendError(res, 503, '訂單查詢資料庫 migration 尚未執行。');
        }
        return sendError(res, 500, '查詢訂單時發生資料庫錯誤，請稍後再試。');
      }

      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        console.error('客戶訂單查詢 RPC 回傳格式無效：', data);
        return sendError(res, 500, '訂單查詢結果格式無效。');
      }

      if (data.rate_limited === true) {
        res.set('Retry-After', '900');
        return sendError(res, 429, '查詢次數過多，請稍後再試。');
      }

      if (data.rate_limited !== false || !Array.isArray(data.orders)) {
        console.error('客戶訂單查詢 RPC 缺少必要欄位：', data);
        return sendError(res, 500, '訂單查詢結果格式無效。');
      }

      return res.json({
        success: true,
        data: data.orders,
        message: '查詢完成。若資料相符，將顯示相關訂單。'
      });
    } catch (error) {
      console.error('處理客戶訂單查詢時發生未預期錯誤：', error);
      return sendError(res, 500, '查詢訂單時發生錯誤，請稍後再試。');
    }
  });

  return router;
}

module.exports = createCustomerRouter;

```

---

### File: `routes\inbound.js`

```
const crypto = require('crypto');
const express = require('express');

const MAX_INBOUND_QUANTITY = 100000;
const MISSING_RPC_CODES = new Set(['42883', 'PGRST202']);

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

function parseOrderUuid(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
    ? normalized
    : null;
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
      return sendError(res, 503, '入庫資料庫遷移尚未執行，請先套用入庫／齊貨對賬 migration。');
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

      const { data, error } = await supabase.rpc('record_product_receipt', {
        p_product_id: productId,
        p_quantity: quantity
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

```

---

### File: `routes\orders.js`

```
'use strict';

const express = require('express');

const MISSING_SCHEMA_CODES = new Set(['42P01', '42703', '42883', 'PGRST202', 'PGRST204']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sendError(res, status, message, code) {
  return res.status(status).json({
    success: false,
    data: null,
    message,
    ...(code ? { code } : {})
  });
}

function createOrdersRouter(supabase, options = {}) {
  const router = express.Router();

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

      return res.status(201).json({
        success: true,
        data: result,
        message: '訂單建立成功'
      });
    } catch (error) {
      console.error('處理訂單結帳時發生未預期錯誤：', error);
      return sendError(res, 500, '處理訂單時發生錯誤，請稍後再試。');
    }
  });

  return router;
}

module.exports = createOrdersRouter;

```

---

### File: `routes\products.js`

```
const express = require('express');
const crypto = require('crypto');

const PRODUCT_STATUSES = new Set(['預購中', '旅購中', '已到貨', '已下架']);
const MISSING_COLUMN_ERROR_CODES = new Set(['42703', 'PGRST204']);
const MISSING_RPC_ERROR_CODES = new Set(['42883', 'PGRST202']);
const MAX_STOCK = 2147483647;
const PUBLIC_PRODUCT_FIELDS = new Set([
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
  'cutoff_datetime'
]);

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

function createProductsRouter(supabase, options = {}) {
  const router = express.Router();
  const adminToken = options.adminToken || '';
  const stockWriteEnabled = options.stockWriteEnabled === true;

  router.get('/', async (req, res) => {
    try {
      const category = req.query.category;
      const status = req.query.status;

      if (
        category !== undefined &&
        (typeof category !== 'string' || category.trim().length === 0 || category.trim().length > 100)
      ) {
        return res.status(400).json({
          success: false,
          data: null,
          message: '分類參數無效。'
        });
      }

      if (status !== undefined && (typeof status !== 'string' || !PRODUCT_STATUSES.has(status))) {
        return res.status(400).json({
          success: false,
          data: null,
          message: '產品狀態參數無效。'
        });
      }

      let query = supabase.from('products').select('*');

      if (category !== undefined) {
        query = query.eq('category', category.trim());
      }

      if (status !== undefined) {
        query = query.eq('status', status);
      }

      const { data, error } = await query;

      if (error) {
        console.error('讀取產品列表時發生 Supabase 錯誤：', error);
        if (status !== undefined && MISSING_COLUMN_ERROR_CODES.has(error.code)) {
          return res.status(503).json({
            success: false,
            data: null,
            message: '資料庫尚未建立 products.status 欄位，請先同步產品資料表規格。'
          });
        }

        return res.status(500).json({
          success: false,
          data: null,
          message: '讀取產品列表失敗，請檢查資料庫欄位設定後再試。'
        });
      }

      if (!Array.isArray(data)) {
        console.error('Supabase 產品列表回傳格式無效。');
        return res.status(500).json({
          success: false,
          data: null,
          message: '產品列表回傳格式無效。'
        });
      }

      return res.json({
        success: true,
        data: data.map(filterPublicProductFields),
        message: '產品列表讀取成功'
      });
    } catch (error) {
      console.error('讀取產品列表時發生未預期錯誤：', error);
      return res.status(500).json({
        success: false,
        data: null,
        message: '讀取產品列表時發生錯誤，請稍後再試。'
      });
    }
  });

  router.patch('/:productId/stock', async (req, res) => {
    try {
      if (adminToken.length < 32 || adminToken.startsWith('replace-with-')) {
        return res.status(503).json({
          success: false,
          data: null,
          message: '庫存更新服務尚未設定產品管理員 Token。'
        });
      }

      const authorized = typeof options.isSessionAuthorized === 'function'
        ? options.isSessionAuthorized(req, adminToken, 'products')
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
        return res.status(401).json({
          success: false,
          data: null,
          message: '沒有權限更新產品庫存。'
        });
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

      const { data, error } = await supabase.rpc('set_product_stock', {
        p_product_id: req.params.productId,
        p_stock: stock
      });

      if (error) {
        console.error('更新產品庫存時發生 Supabase 錯誤：', error);
        if (MISSING_RPC_ERROR_CODES.has(error.code)) {
          return res.status(503).json({
            success: false,
            data: null,
            message: '庫存更新資料庫 migration 尚未執行，請先套用產品庫存 migration。'
          });
        }
        if (error.code === 'P0002') {
          return res.status(404).json({
            success: false,
            data: null,
            message: '找不到指定產品。'
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

      if (!data || typeof data !== 'object' || data.success !== true || data.stock !== stock) {
        console.error('更新產品庫存 RPC 回傳格式無效：', data);
        return res.status(500).json({
          success: false,
          data: null,
          message: '庫存更新結果無效，請檢查資料庫 RPC。'
        });
      }

      return res.json({
        success: true,
        data,
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

  return router;
}

module.exports = createProductsRouter;

```

---

### File: `routes\reminders.js`

```
const crypto = require('crypto');
const express = require('express');

const REMINDER_STATUS_PENDING = '未提示';
const REMINDER_STATUS_SENT = '已發送提醒';
const MAX_WINDOW_HOURS = 168;
const CLAIM_LEASE_MINUTES = 30;
const PUBLIC_REMINDER_FIELDS = [
  'id',
  'product_id',
  'product_code',
  'name',
  'product_name',
  'supplier_name',
  'price',
  'retail_price',
  'cutoff_datetime',
  'remind_status',
  'status'
];

function sendError(res, status, message) {
  return res.status(status).json({
    success: false,
    data: null,
    message
  });
}

function getProductIdColumn(product) {
  if (product.product_id !== undefined) {
    return 'product_id';
  }
  return 'id';
}

function getProductId(product) {
  return product[getProductIdColumn(product)];
}

function getProductName(product) {
  return String(product.product_name || product.name || '未命名商品');
}

function filterReminderFields(product) {
  return Object.fromEntries(
    Object.entries(product).filter(([field]) => PUBLIC_REMINDER_FIELDS.includes(field))
  );
}

function parseWindowHours(value) {
  if (value === undefined) {
    return 24;
  }

  const hours = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/.test(value)
      ? Number(value)
      : null;
  return Number.isSafeInteger(hours) && hours >= 1 && hours <= MAX_WINDOW_HOURS
    ? hours
    : null;
}

function createReminderRouter(supabase, options = {}) {
  const router = express.Router();
  const cronToken = options.cronToken || '';
  const recipients = Array.isArray(options.recipients) ? options.recipients : [];
  const sendWhatsApp = options.sendWhatsApp;

  router.use((req, res, next) => {
    if (cronToken.length < 32 || cronToken === 'replace-with-a-long-random-secret') {
      return sendError(res, 503, '截單提醒服務尚未設定 REMINDER_CRON_TOKEN。');
    }

    const authorization = req.get('authorization') || '';
    const suppliedToken = authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';
    const expectedBuffer = Buffer.from(cronToken);
    const suppliedBuffer = Buffer.from(suppliedToken);

    if (
      expectedBuffer.length !== suppliedBuffer.length ||
      !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)
    ) {
      return sendError(res, 401, '沒有權限使用截單提醒服務。');
    }

    return next();
  });

  async function findUpcomingProducts(hours) {
    const now = new Date();
    const until = new Date(now.getTime() + hours * 60 * 60 * 1000);
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('remind_status', REMINDER_STATUS_PENDING)
      .gte('cutoff_datetime', now.toISOString())
      .lte('cutoff_datetime', until.toISOString())
      .order('cutoff_datetime', { ascending: true });

    if (error) {
      throw error;
    }

    if (!Array.isArray(data)) {
      throw new Error('Supabase 截單商品查詢回傳格式無效。');
    }

    return data.filter(product => (
      product.is_active !== false &&
      product.status !== '已下架'
    ));
  }

  async function releaseClaim(productIdColumn, productId, claimedAt) {
    const { error } = await supabase
      .from('products')
      .update({ remind_claimed_at: null })
      .eq(productIdColumn, productId)
      .eq('remind_status', REMINDER_STATUS_PENDING)
      .eq('remind_claimed_at', claimedAt);

    if (error) {
      throw error;
    }
  }

  router.get('/upcoming', async (req, res) => {
    try {
      const hours = parseWindowHours(req.query.hours);
      if (hours === null) {
        return sendError(res, 400, `hours 必須是 1 至 ${MAX_WINDOW_HOURS} 的整數。`);
      }

      const products = await findUpcomingProducts(hours);
      return res.json({
        success: true,
        data: products.map(filterReminderFields),
        message: `未來 ${hours} 小時內有 ${products.length} 件商品即將截單。`
      });
    } catch (error) {
      console.error('查詢即將截單商品失敗：', error);
      if (error && ['42703', 'PGRST204'].includes(error.code)) {
        return sendError(res, 503, 'products.cutoff_datetime、products.remind_status 或提醒鎖定欄位尚未建立，請先執行資料庫遷移。');
      }
      return sendError(res, 500, '查詢即將截單商品時發生錯誤。');
    }
  });

  router.post('/run', async (req, res) => {
    try {
      const hours = parseWindowHours(req.body && req.body.hours);
      if (hours === null) {
        return sendError(res, 400, `hours 必須是 1 至 ${MAX_WINDOW_HOURS} 的整數。`);
      }

      if (recipients.length === 0) {
        return sendError(res, 503, '尚未設定 WHATSAPP_REMINDER_RECIPIENTS。');
      }
      if (typeof sendWhatsApp !== 'function') {
        return sendError(res, 503, 'WhatsApp 提醒發送器尚未設定。');
      }

      const products = await findUpcomingProducts(hours);
      const results = [];

      for (const product of products) {
        const productIdColumn = getProductIdColumn(product);
        const productId = getProductId(product);
        const claimNow = new Date();
        const claimedAt = claimNow.toISOString();
        const staleClaimBefore = new Date(
          claimNow.getTime() - CLAIM_LEASE_MINUTES * 60 * 1000
        ).toISOString().replace(/\.\d{3}Z$/, 'Z');

        const { data: claimedRows, error: claimError } = await supabase
          .from('products')
          .update({ remind_claimed_at: claimedAt })
          .eq(productIdColumn, productId)
          .eq('remind_status', REMINDER_STATUS_PENDING)
          .or(`remind_claimed_at.is.null,remind_claimed_at.lt.${staleClaimBefore}`)
          .select(productIdColumn);

        if (claimError) {
          console.error('截單提醒商品鎖定失敗：', { productId, error: claimError });
          results.push({ product_id: productId, success: false, message: '無法鎖定提醒工作。' });
          continue;
        }

        if (!Array.isArray(claimedRows) || claimedRows.length !== 1) {
          results.push({ product_id: productId, success: false, skipped: true, message: '商品提醒已由其他工作程序處理。' });
          continue;
        }

        const cutoff = new Date(product.cutoff_datetime);
        const message = [
          `截單提醒：${getProductName(product)}`,
          `截單時間：${cutoff.toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' })}`,
          product.product_code ? `產品代號：${product.product_code}` : ''
        ].filter(Boolean).join('\n');
        const sentRecipients = [];
        const failedRecipients = [];

        for (const recipient of recipients) {
          try {
            await sendWhatsApp({ to: recipient, text: message });
            sentRecipients.push(recipient);
          } catch (error) {
            console.error('WhatsApp 截單提醒發送失敗：', {
              productId,
              recipient,
              error
            });
            failedRecipients.push(recipient);
          }
        }

        if (failedRecipients.length > 0) {
          let claimReleased = true;
          try {
            await releaseClaim(productIdColumn, productId, claimedAt);
          } catch (error) {
            claimReleased = false;
            console.error('釋放失敗提醒鎖定時發生錯誤：', {
              productId,
              error
            });
          }

          results.push({
            product_id: productId,
            success: false,
            sent_recipients: sentRecipients,
            failed_recipients: failedRecipients,
            message: claimReleased
              ? '部分或全部 WhatsApp 提醒發送失敗；提醒狀態未標記為已發送，重試時已送達對象可能收到重複提醒。'
              : '部分或全部 WhatsApp 提醒發送失敗；提醒鎖定暫未釋放，請檢查資料庫及發送紀錄。'
          });
          continue;
        }

        const sentAt = new Date().toISOString();
        const { data: updatedRows, error: updateError } = await supabase
          .from('products')
          .update({
            remind_status: REMINDER_STATUS_SENT,
            remind_claimed_at: null,
            remind_sent_at: sentAt
          })
          .eq(productIdColumn, productId)
          .eq('remind_status', REMINDER_STATUS_PENDING)
          .eq('remind_claimed_at', claimedAt)
          .select(productIdColumn);

        if (updateError || !Array.isArray(updatedRows) || updatedRows.length !== 1) {
          console.error('提醒已發送但更新 remind_status 失敗：', {
            productId,
            error: updateError || new Error('資料庫沒有更新到預期商品。')
          });
          results.push({
            product_id: productId,
            success: false,
            sent: true,
            message: '提醒已發送，但提醒狀態更新失敗；請檢查資料庫以免重複發送。'
          });
          continue;
        }

        results.push({
          product_id: productId,
          success: true,
          sent_recipients: recipients.length,
          remind_status: REMINDER_STATUS_SENT
        });
      }

      const failedCount = results.filter(result => !result.success).length;
      const responseStatus = failedCount > 0 ? 207 : 200;
      return res.status(responseStatus).json({
        success: failedCount === 0,
        data: results,
        message: `截單提醒處理完成：成功 ${results.length - failedCount} 件，失敗或略過 ${failedCount} 件。`
      });
    } catch (error) {
      console.error('執行截單提醒失敗：', error);
      if (error && ['42703', 'PGRST204'].includes(error.code)) {
        return sendError(res, 503, 'products.cutoff_datetime、products.remind_status 或提醒鎖定欄位尚未建立，請先執行資料庫遷移。');
      }
      return sendError(res, 500, '執行截單提醒時發生錯誤。');
    }
  });

  return router;
}

module.exports = createReminderRouter;

```

---

### File: `routes\shipping.js`

```
const crypto = require('crypto');
const express = require('express');

const MISSING_RPC_CODES = new Set(['42883', 'PGRST202']);
const SHIPPING_METHODS = new Set(['面交', '自取', '順豐', '京東']);
const MAX_PICK_LIST_ORDERS = 5000;
const MAX_PICK_LIST_ITEMS = 20000;

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

```

---

### File: `routes\webhook.js`

```
const crypto = require('crypto');
const express = require('express');

const MISSING_RPC_CODES = new Set(['42883', 'PGRST202']);

function sendError(res, status, message) {
  return res.status(status).json({
    success: false,
    data: null,
    message
  });
}

function constantTimeStringEquals(expected, supplied) {
  if (
    typeof expected !== 'string' ||
    expected.length < 32 ||
    expected.startsWith('replace-with-') ||
    typeof supplied !== 'string'
  ) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
}

function normalizePhone(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const phone = value.trim().replace(/^\+/, '');
  return /^\d{8,15}$/.test(phone) ? phone : null;
}

function parseOrderId(value) {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  ) {
    return null;
  }
  return value.toLowerCase();
}

function getMessageText(message) {
  if (!message || message.type !== 'text' || !message.text) {
    return '';
  }

  return typeof message.text.body === 'string'
    ? message.text.body.trim()
    : '';
}

function createWebhookRouter(supabase, options = {}) {
  const router = express.Router();
  const verifyToken = options.verifyToken || '';
  const appSecret = options.appSecret || '';
  const sendWhatsApp = options.sendWhatsApp;
  const writeEnabled = options.writeEnabled === true;

  router.get('/whatsapp', (req, res) => {
    try {
      const mode = req.query['hub.mode'];
      const suppliedToken = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];

      if (
        mode !== 'subscribe' ||
        !constantTimeStringEquals(verifyToken, suppliedToken) ||
        typeof challenge !== 'string' ||
        challenge.length === 0 ||
        challenge.length > 256
      ) {
        return res.status(403).type('text/plain').send('Webhook verification failed.');
      }

      return res.status(200).type('text/plain').send(challenge);
    } catch (error) {
      console.error('驗證 WhatsApp webhook 時發生錯誤：', error);
      return res.status(500).type('text/plain').send('Webhook verification failed.');
    }
  });

  function hasValidSignature(req) {
    if (
      appSecret.length < 32 ||
      appSecret.startsWith('replace-with-') ||
      appSecret.startsWith('your-') ||
      !Buffer.isBuffer(req.rawBody) ||
      typeof req.get !== 'function'
    ) {
      return false;
    }

    const signature = req.get('x-hub-signature-256') || '';
    if (!/^sha256=[0-9a-f]{64}$/i.test(signature)) {
      return false;
    }

    const expected = Buffer.from(
      `sha256=${crypto.createHmac('sha256', appSecret).update(req.rawBody).digest('hex')}`
    );
    const supplied = Buffer.from(signature.toLowerCase());
    return expected.length === supplied.length &&
      crypto.timingSafeEqual(expected, supplied);
  }

  async function getOrderStatus(phone, orderId) {
    const { data, error } = await supabase.rpc('lookup_whatsapp_order', {
      p_customer_phone: phone,
      p_order_id: orderId
    });

    if (error) {
      if (MISSING_RPC_CODES.has(error.code)) {
        throw new Error('WhatsApp 訂單查詢資料庫 migration 尚未執行。');
      }
      throw new Error('WhatsApp 訂單查詢資料庫操作失敗。');
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('WhatsApp 訂單查詢結果格式無效。');
    }

    return data;
  }

  async function reportPayment(phone, orderId, reference, providerMessageId) {
    const { data, error } = await supabase.rpc('record_whatsapp_payment_report', {
      p_customer_phone: phone,
      p_order_id: orderId,
      p_payment_reference: reference,
      p_provider_message_id: providerMessageId
    });

    if (error) {
      if (MISSING_RPC_CODES.has(error.code)) {
        throw new Error('WhatsApp 付款回報資料庫 migration 尚未執行。');
      }
      throw new Error('WhatsApp 付款回報資料庫操作失敗。');
    }

    if (!data || typeof data !== 'object' || typeof data.found !== 'boolean') {
      throw new Error('WhatsApp 付款回報結果格式無效。');
    }

    return data;
  }

  async function handleIncomingMessage(message) {
    const phone = normalizePhone(message && message.from);
    if (!phone || typeof message.id !== 'string' || message.id.length === 0) {
      return { processed: false, reason: 'invalid_sender_or_message_id' };
    }

    const text = getMessageText(message);
    if (!text) {
      return { processed: false, reason: 'unsupported_message_type' };
    }

    const queryMatch = text.match(/^(?:查詢訂單|訂單查詢|查單|訂單)\s+([0-9a-f-]{36})$/i);
    if (queryMatch) {
      const orderId = parseOrderId(queryMatch[1]);
      if (orderId === null) {
        return { processed: false, reason: 'invalid_order_id' };
      }

      const order = await getOrderStatus(phone, orderId);
      const reply = order.found
        ? [
          `訂單 #${order.order_id}`,
          `付款狀態：${order.payment_status}`,
          `出貨狀態：${order.shipping_status}`,
          `出貨方式：${order.shipping_method || '未安排'}`,
          `運單號碼：${order.tracking_number || '未提供'}`,
          ...(Array.isArray(order.items)
            ? order.items.map(item => `${item.product_name} × ${item.quantity}：${item.reconciliation_status}`)
            : [])
        ].join('\n')
        : '未找到與此 WhatsApp 號碼相符的訂單。';

      await sendWhatsApp({ to: phone, text: reply });
      return { processed: true, action: 'order_lookup', order_id: order.found ? order.order_id : null };
    }

    const paymentMatch = text.match(/^(?:付款回報|付款)\s+([0-9a-f-]{36})\s+(.+)$/i);
    if (paymentMatch) {
      const orderId = parseOrderId(paymentMatch[1]);
      const reference = paymentMatch[2].trim();
      if (orderId === null || reference.length === 0 || reference.length > 100) {
        return { processed: false, reason: 'invalid_payment_report' };
      }

      const result = await reportPayment(phone, orderId, reference, message.id);
      const reply = result.found
        ? '已收到付款回報，訂單仍待管理員核實；核實前付款狀態不會變更。'
        : '未找到與此 WhatsApp 號碼相符的訂單，付款回報未建立。';

      await sendWhatsApp({ to: phone, text: reply });
      return {
        processed: true,
        action: 'payment_report',
        order_id: result.found ? orderId : null,
        duplicate: result.duplicate === true
      };
    }

    await sendWhatsApp({
      to: phone,
      text: 'LittlePlanet 指令：查詢訂單 <UUID訂單編號>，或付款回報 <UUID訂單編號> <交易參考編號>。'
    });
    return { processed: true, action: 'help' };
  }

  router.post('/whatsapp', async (req, res) => {
    try {
      if (!writeEnabled) {
        return sendError(res, 503, 'Webhook 尚未設定 SUPABASE_SERVICE_ROLE_KEY。');
      }
      if (!hasValidSignature(req)) {
        return sendError(res, 401, 'Webhook 簽名驗證失敗。');
      }

      if (
        !req.body ||
        typeof req.body !== 'object' ||
        Array.isArray(req.body) ||
        req.body.object !== 'whatsapp_business_account' ||
        !Array.isArray(req.body.entry)
      ) {
        return sendError(res, 400, 'Webhook payload 格式無效。');
      }

      const incomingMessages = [];
      for (const entry of req.body.entry) {
        if (!entry || !Array.isArray(entry.changes)) {
          continue;
        }
        for (const change of entry.changes) {
          const value = change && change.value;
          const changeMessages = value && Array.isArray(value.messages)
            ? value.messages
            : [];
          incomingMessages.push(...changeMessages);
        }
      }

      if (incomingMessages.length > 0 && typeof sendWhatsApp !== 'function') {
        return sendError(res, 503, 'WhatsApp 回覆發送器尚未設定。');
      }

      const results = [];
      for (const message of incomingMessages) {
        results.push(await handleIncomingMessage(message));
      }

      return res.status(200).json({
        success: true,
        data: {
          processed_count: results.filter(result => result.processed).length,
          ignored_count: results.filter(result => !result.processed).length,
          results
        },
        message: 'WhatsApp webhook 已處理。'
      });
    } catch (error) {
      console.error('處理 WhatsApp webhook 時發生錯誤：', error);
      return sendError(res, 500, '處理 WhatsApp webhook 時發生錯誤，Meta 可安全重試。');
    }
  });

  return router;
}

module.exports = createWebhookRouter;

```

---

### File: `supabase\diagnostics\performance_review.sql`

```
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef,
  pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND tablename IN (
    'orders',
    'order_items',
    'products',
    'customers',
    'shipping_notifications',
    'whatsapp_payment_reports'
  )
ORDER BY tablename, indexname;

SELECT
  schemaname,
  relname AS table_name,
  seq_scan,
  seq_tup_read,
  idx_scan,
  n_live_tup AS estimated_live_rows,
  pg_size_pretty(pg_total_relation_size(relid)) AS total_size
FROM pg_stat_user_tables
WHERE schemaname = 'public'
  AND relname IN (
    'orders',
    'order_items',
    'products',
    'customers',
    'shipping_notifications',
    'whatsapp_payment_reports'
  )
ORDER BY pg_total_relation_size(relid) DESC;

```

---

### File: `supabase\migrations\20260926223000_add_products_status.sql`

```
BEGIN;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS status text;

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_status_check;

ALTER TABLE public.products
  ALTER COLUMN status DROP DEFAULT;

ALTER TABLE public.products
  ALTER COLUMN status TYPE text
  USING status::text;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'products'
      AND column_name = 'is_active'
  ) THEN
    EXECUTE $backfill$
      UPDATE public.products
      SET status = CASE
        WHEN is_active IS FALSE THEN '已下架'
        ELSE '預購中'
      END
      WHERE status IS NULL
         OR status NOT IN ('預購中', '旅購中', '已到貨', '已下架')
    $backfill$;
  ELSE
    UPDATE public.products
    SET status = '預購中'
    WHERE status IS NULL
       OR status NOT IN ('預購中', '旅購中', '已到貨', '已下架');
  END IF;
END
$migration$;

ALTER TABLE public.products
  ALTER COLUMN status SET DEFAULT '預購中',
  ALTER COLUMN status SET NOT NULL;

ALTER TABLE public.products
  ADD CONSTRAINT products_status_check
  CHECK (status IN ('預購中', '旅購中', '已到貨', '已下架'));

COMMIT;

```

---

### File: `supabase\migrations\20260926225000_align_orders_schema_with_prd.sql`

```
BEGIN;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name = 'id'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name = 'order_id'
  ) THEN
    ALTER TABLE public.orders RENAME COLUMN id TO order_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'order_items'
      AND column_name = 'id'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'order_items'
      AND column_name = 'item_id'
  ) THEN
    ALTER TABLE public.order_items RENAME COLUMN id TO item_id;
  END IF;
END
$migration$;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS customer_id integer,
  ADD COLUMN IF NOT EXISTS order_date timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT '未付款',
  ADD COLUMN IF NOT EXISTS shipping_status text NOT NULL DEFAULT '待到貨',
  ADD COLUMN IF NOT EXISTS shipping_method text,
  ADD COLUMN IF NOT EXISTS tracking_number varchar(100);

ALTER TABLE public.orders
  ALTER COLUMN order_date SET DEFAULT now(),
  ALTER COLUMN payment_status SET DEFAULT '未付款',
  ALTER COLUMN shipping_status SET DEFAULT '待到貨';

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name = 'status'
  ) THEN
    EXECUTE $backfill$
      UPDATE public.orders
      SET status = 'pending'
      WHERE status IS NULL
    $backfill$;
    ALTER TABLE public.orders
      ALTER COLUMN status SET DEFAULT 'pending';
  END IF;
END
$migration$;

UPDATE public.orders
SET payment_status = '未付款'
WHERE payment_status IS NULL
   OR payment_status NOT IN ('未付款', '已付訂金', '已付清');

UPDATE public.orders
SET shipping_status = '待到貨'
WHERE shipping_status IS NULL
   OR shipping_status NOT IN ('待到貨', '部分到貨', '可出貨', '已出貨');

ALTER TABLE public.orders
  ALTER COLUMN payment_status SET NOT NULL,
  ALTER COLUMN shipping_status SET NOT NULL;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_payment_status_check,
  DROP CONSTRAINT IF EXISTS orders_shipping_status_check,
  DROP CONSTRAINT IF EXISTS orders_shipping_method_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_payment_status_check
    CHECK (payment_status IN ('未付款', '已付訂金', '已付清')),
  ADD CONSTRAINT orders_shipping_status_check
    CHECK (shipping_status IN ('待到貨', '部分到貨', '可出貨', '已出貨')),
  ADD CONSTRAINT orders_shipping_method_check
    CHECK (shipping_method IS NULL OR shipping_method IN ('面交', '自取', '順豐', '京東'));

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS item_status text NOT NULL DEFAULT '待進貨',
  ADD COLUMN IF NOT EXISTS is_travel_buy boolean NOT NULL DEFAULT false;

UPDATE public.order_items
SET item_status = '待進貨'
WHERE item_status IS NULL
   OR item_status NOT IN ('待進貨', '已到貨倉', '已出貨');

ALTER TABLE public.order_items
  ALTER COLUMN item_status SET NOT NULL,
  ALTER COLUMN is_travel_buy SET NOT NULL;

ALTER TABLE public.order_items
  DROP CONSTRAINT IF EXISTS order_items_item_status_check;

ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_item_status_check
  CHECK (item_status IN ('待進貨', '已到貨倉', '已出貨'));

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'order_items_order_id_fkey'
      AND conrelid = 'public.order_items'::regclass
  ) THEN
    ALTER TABLE public.order_items
      ADD CONSTRAINT order_items_order_id_fkey
      FOREIGN KEY (order_id)
      REFERENCES public.orders(order_id)
      ON DELETE CASCADE;
  END IF;

  IF to_regclass('public.customers') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'customers'
         AND column_name = 'customer_id'
     )
     AND NOT EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conname = 'orders_customer_id_fkey'
         AND conrelid = 'public.orders'::regclass
     ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_customer_id_fkey
      FOREIGN KEY (customer_id)
      REFERENCES public.customers(customer_id)
      ON DELETE SET NULL;
  END IF;
END
$migration$;

NOTIFY pgrst, 'reload schema';

COMMIT;

```

---

### File: `supabase\migrations\20260926230000_add_product_reminder_fields.sql`

```
BEGIN;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS cutoff_datetime timestamptz,
  ADD COLUMN IF NOT EXISTS remind_status text,
  ADD COLUMN IF NOT EXISTS remind_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS remind_sent_at timestamptz;

ALTER TABLE public.products
  ALTER COLUMN remind_status DROP DEFAULT;

ALTER TABLE public.products
  ALTER COLUMN remind_status TYPE text
  USING remind_status::text;

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_remind_status_check;

UPDATE public.products
SET remind_status = '未提示'
WHERE remind_status IS NULL
   OR remind_status NOT IN ('未提示', '已發送提醒');

ALTER TABLE public.products
  ALTER COLUMN remind_status SET DEFAULT '未提示',
  ALTER COLUMN remind_status SET NOT NULL;

ALTER TABLE public.products
  ADD CONSTRAINT products_remind_status_check
  CHECK (remind_status IN ('未提示', '已發送提醒'));

CREATE INDEX IF NOT EXISTS products_reminder_due_idx
  ON public.products (cutoff_datetime)
  WHERE remind_status = '未提示';

NOTIFY pgrst, 'reload schema';

COMMIT;

```

---

### File: `supabase\migrations\20260926230200_add_analytics_reporting.sql`

```
BEGIN;

CREATE OR REPLACE FUNCTION public.get_revenue_overview(
  p_start_date date,
  p_end_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
    RAISE EXCEPTION '日期區間無效'
      USING ERRCODE = '22023';
  END IF;
  IF p_end_date - p_start_date > 3659 THEN
    RAISE EXCEPTION '日期區間不可超過 3660 日'
      USING ERRCODE = '22023';
  END IF;

  WITH selected_orders AS (
    SELECT
      order_id,
      COALESCE(total_amount, 0)::numeric AS total_amount,
      payment_status,
      shipping_status
    FROM public.orders
    WHERE order_date >= (p_start_date::timestamp AT TIME ZONE 'Asia/Hong_Kong')
      AND order_date < ((p_end_date + 1)::timestamp AT TIME ZONE 'Asia/Hong_Kong')
  ),
  totals AS (
    SELECT
      COUNT(*)::integer AS total_orders,
      COALESCE(SUM(total_amount), 0)::numeric(14, 2) AS total_revenue,
      COUNT(*) FILTER (
        WHERE payment_status IN ('已付訂金', '已付清')
      )::integer AS paid_orders,
      COUNT(*) FILTER (
        WHERE payment_status = '未付款'
      )::integer AS unpaid_orders,
      COUNT(*) FILTER (
        WHERE shipping_status = '已出貨'
      )::integer AS shipped_orders,
      COUNT(*) FILTER (
        WHERE shipping_status <> '已出貨'
      )::integer AS unshipped_orders
    FROM selected_orders
  )
  SELECT jsonb_build_object(
    'start_date', p_start_date,
    'end_date', p_end_date,
    'total_revenue', total_revenue,
    'total_orders', total_orders,
    'paid_orders', paid_orders,
    'unpaid_orders', unpaid_orders,
    'paid_order_percentage', CASE
      WHEN total_orders = 0 THEN 0
      ELSE round(paid_orders * 100.0 / total_orders, 2)
    END,
    'unpaid_order_percentage', CASE
      WHEN total_orders = 0 THEN 0
      ELSE round(unpaid_orders * 100.0 / total_orders, 2)
    END,
    'shipped_orders', shipped_orders,
    'unshipped_orders', unshipped_orders,
    'shipped_order_percentage', CASE
      WHEN total_orders = 0 THEN 0
      ELSE round(shipped_orders * 100.0 / total_orders, 2)
    END,
    'unshipped_order_percentage', CASE
      WHEN total_orders = 0 THEN 0
      ELSE round(unshipped_orders * 100.0 / total_orders, 2)
    END
  )
  INTO v_result
  FROM totals;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_top_selling_products(
  p_start_date date,
  p_end_date date,
  p_limit integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
    RAISE EXCEPTION '日期區間無效'
      USING ERRCODE = '22023';
  END IF;
  IF p_end_date - p_start_date > 3659 THEN
    RAISE EXCEPTION '日期區間不可超過 3660 日'
      USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION '排行榜 limit 必須介乎 1 至 50'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'rank', ranked.rank,
        'product_id', ranked.product_id,
        'product_name', ranked.product_name,
        'quantity_sold', ranked.quantity_sold,
        'sales_amount', ranked.sales_amount
      )
      ORDER BY ranked.rank
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM (
    SELECT
      row_number() OVER (
        ORDER BY SUM(oi.quantity) DESC,
          SUM(oi.quantity * oi.unit_price) DESC,
          oi.product_id
      )::integer AS rank,
      oi.product_id,
      COALESCE(
        to_jsonb(p)->>'product_name',
        to_jsonb(p)->>'name',
        '未命名商品'
      ) AS product_name,
      SUM(oi.quantity)::integer AS quantity_sold,
      SUM(oi.quantity * oi.unit_price)::numeric(14, 2) AS sales_amount
    FROM public.order_items AS oi
    JOIN public.orders AS o
      ON o.order_id = oi.order_id
    LEFT JOIN public.products AS p
      ON p.id = oi.product_id
    WHERE o.order_date >= (p_start_date::timestamp AT TIME ZONE 'Asia/Hong_Kong')
      AND o.order_date < ((p_end_date + 1)::timestamp AT TIME ZONE 'Asia/Hong_Kong')
    GROUP BY
      oi.product_id,
      COALESCE(
        to_jsonb(p)->>'product_name',
        to_jsonb(p)->>'name',
        '未命名商品'
      )
    ORDER BY SUM(oi.quantity) DESC,
      SUM(oi.quantity * oi.unit_price) DESC,
      oi.product_id
    LIMIT p_limit
  ) AS ranked;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_financial_reconciliation(
  p_start_date date,
  p_end_date date,
  p_payment_status text DEFAULT NULL,
  p_shipping_status text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
    RAISE EXCEPTION '日期區間無效'
      USING ERRCODE = '22023';
  END IF;
  IF p_end_date - p_start_date > 3659 THEN
    RAISE EXCEPTION '日期區間不可超過 3660 日'
      USING ERRCODE = '22023';
  END IF;
  IF p_payment_status IS NOT NULL
     AND p_payment_status NOT IN ('未付款', '已付訂金', '已付清') THEN
    RAISE EXCEPTION '付款狀態無效'
      USING ERRCODE = '22023';
  END IF;
  IF p_shipping_status IS NOT NULL
     AND p_shipping_status NOT IN ('待到貨', '部分到貨', '可出貨', '已出貨') THEN
    RAISE EXCEPTION '出貨狀態無效'
      USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100
     OR p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'limit 或 offset 無效'
      USING ERRCODE = '22023';
  END IF;

  WITH filtered_orders AS (
    SELECT
      o.order_id,
      o.order_date,
      COALESCE(o.total_amount, 0)::numeric(14, 2) AS total_amount,
      o.payment_status,
      o.shipping_status,
      o.shipping_method,
      o.tracking_number
    FROM public.orders AS o
    WHERE o.order_date >= (p_start_date::timestamp AT TIME ZONE 'Asia/Hong_Kong')
      AND o.order_date < ((p_end_date + 1)::timestamp AT TIME ZONE 'Asia/Hong_Kong')
      AND (p_payment_status IS NULL OR o.payment_status = p_payment_status)
      AND (p_shipping_status IS NULL OR o.shipping_status = p_shipping_status)
  ),
  selected_orders AS (
    SELECT *
    FROM filtered_orders
    ORDER BY order_date DESC, order_id DESC
    LIMIT p_limit
    OFFSET p_offset
  )
  SELECT jsonb_build_object(
    'total_count', (SELECT COUNT(*)::integer FROM filtered_orders),
    'rows', COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'order_id', selected_orders.order_id,
          'order_date', selected_orders.order_date,
          'total_amount', selected_orders.total_amount,
          'payment_status', selected_orders.payment_status,
          'shipping_status', selected_orders.shipping_status,
          'shipping_method', selected_orders.shipping_method,
          'tracking_number', selected_orders.tracking_number,
          'items', (
            SELECT COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'item_id', oi.item_id,
                  'product_id', oi.product_id,
                  'product_name', COALESCE(
                    to_jsonb(p)->>'product_name',
                    to_jsonb(p)->>'name',
                    '未命名商品'
                  ),
                  'quantity', oi.quantity,
                  'unit_price', oi.unit_price,
                  'line_total', oi.quantity * oi.unit_price,
                  'item_status', oi.item_status,
                  'received_quantity', oi.received_quantity
                )
                ORDER BY oi.item_id
              ),
              '[]'::jsonb
            )
            FROM public.order_items AS oi
            LEFT JOIN public.products AS p
              ON p.id = oi.product_id
            WHERE oi.order_id = selected_orders.order_id
          )
        )
        ORDER BY selected_orders.order_date DESC, selected_orders.order_id DESC
      ),
      '[]'::jsonb
    )
  )
  INTO v_result
  FROM selected_orders;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_revenue_overview(date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_top_selling_products(date, date, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_financial_reconciliation(date, date, text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_revenue_overview(date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_top_selling_products(date, date, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_financial_reconciliation(date, date, text, text, integer, integer) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

```

---

### File: `supabase\migrations\20260926233000_add_inbound_reconciliation.sql`

```
BEGIN;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name = 'id'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name = 'order_id'
  ) THEN
    ALTER TABLE public.orders RENAME COLUMN id TO order_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'order_items'
      AND column_name = 'id'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'order_items'
      AND column_name = 'item_id'
  ) THEN
    ALTER TABLE public.order_items RENAME COLUMN id TO item_id;
  END IF;
END
$migration$;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS stock integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT '預購中';

ALTER TABLE public.products
  ALTER COLUMN status DROP DEFAULT;

ALTER TABLE public.products
  ALTER COLUMN status TYPE text
  USING status::text;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'products'
      AND column_name = 'is_active'
  ) THEN
    EXECUTE $backfill$
      UPDATE public.products
      SET status = CASE
        WHEN is_active IS FALSE THEN '已下架'
        ELSE '預購中'
      END
      WHERE status IS NULL
         OR status NOT IN ('預購中', '旅購中', '已到貨', '已下架')
    $backfill$;
  ELSE
    UPDATE public.products
    SET status = '預購中'
    WHERE status IS NULL
       OR status NOT IN ('預購中', '旅購中', '已到貨', '已下架');
  END IF;
END
$migration$;

ALTER TABLE public.products
  ALTER COLUMN status SET DEFAULT '預購中',
  ALTER COLUMN status SET NOT NULL;

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_status_check;

ALTER TABLE public.products
  ADD CONSTRAINT products_status_check
  CHECK (status IN ('預購中', '旅購中', '已到貨', '已下架'));

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS customer_id integer,
  ADD COLUMN IF NOT EXISTS order_date timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT '未付款',
  ADD COLUMN IF NOT EXISTS shipping_status text NOT NULL DEFAULT '待到貨';

UPDATE public.orders
SET payment_status = '未付款'
WHERE payment_status IS NULL
   OR payment_status NOT IN ('未付款', '已付訂金', '已付清');

UPDATE public.orders
SET shipping_status = '待到貨'
WHERE shipping_status IS NULL
   OR shipping_status NOT IN ('待到貨', '部分到貨', '可出貨', '已出貨');

ALTER TABLE public.orders
  ALTER COLUMN payment_status SET NOT NULL,
  ALTER COLUMN shipping_status SET NOT NULL;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_payment_status_check,
  DROP CONSTRAINT IF EXISTS orders_shipping_status_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_payment_status_check
    CHECK (payment_status IN ('未付款', '已付訂金', '已付清')),
  ADD CONSTRAINT orders_shipping_status_check
    CHECK (shipping_status IN ('待到貨', '部分到貨', '可出貨', '已出貨'));

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS item_status text NOT NULL DEFAULT '待進貨',
  ADD COLUMN IF NOT EXISTS received_quantity integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_travel_buy boolean NOT NULL DEFAULT false;

UPDATE public.order_items
SET item_status = '待進貨'
WHERE item_status IS NULL
   OR item_status NOT IN ('待進貨', '已到貨倉', '已出貨');

UPDATE public.order_items
SET received_quantity = quantity
WHERE item_status IN ('已到貨倉', '已出貨')
  AND received_quantity = 0;

ALTER TABLE public.order_items
  ALTER COLUMN item_status SET NOT NULL,
  ALTER COLUMN received_quantity SET NOT NULL,
  ALTER COLUMN is_travel_buy SET NOT NULL;

ALTER TABLE public.order_items
  DROP CONSTRAINT IF EXISTS order_items_item_status_check,
  DROP CONSTRAINT IF EXISTS order_items_received_quantity_check;

ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_item_status_check
    CHECK (item_status IN ('待進貨', '已到貨倉', '已出貨')),
  ADD CONSTRAINT order_items_received_quantity_check
    CHECK (received_quantity >= 0 AND received_quantity <= quantity);

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'order_items_order_id_fkey'
      AND conrelid = 'public.order_items'::regclass
  ) THEN
    ALTER TABLE public.order_items
      ADD CONSTRAINT order_items_order_id_fkey
      FOREIGN KEY (order_id)
      REFERENCES public.orders(order_id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'order_items_product_id_fkey'
      AND conrelid = 'public.order_items'::regclass
  ) THEN
    ALTER TABLE public.order_items
      ADD CONSTRAINT order_items_product_id_fkey
      FOREIGN KEY (product_id)
      REFERENCES public.products(id)
      ON DELETE RESTRICT;
  END IF;
END
$migration$;

CREATE INDEX IF NOT EXISTS order_items_pending_product_idx
  ON public.order_items (product_id, order_id, item_id)
  WHERE item_status = '待進貨';

CREATE OR REPLACE FUNCTION public.reconcile_inbound_orders(p_order_id integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF p_order_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.orders
       WHERE order_id = p_order_id
     ) THEN
    RAISE EXCEPTION '找不到訂單 %', p_order_id
      USING ERRCODE = 'P0002';
  END IF;

  WITH readiness AS (
    SELECT
      oi.order_id,
      bool_and(
        oi.item_status = '已出貨'
        OR oi.item_status = '已到貨倉'
        OR oi.received_quantity >= oi.quantity
      ) AS all_ready,
      bool_or(
        oi.received_quantity > 0
        OR oi.item_status IN ('已到貨倉', '已出貨')
      ) AS any_received
    FROM public.order_items AS oi
    WHERE p_order_id IS NULL OR oi.order_id = p_order_id
    GROUP BY oi.order_id
  )
  UPDATE public.orders AS o
  SET shipping_status = CASE
    WHEN r.all_ready THEN '可出貨'
    WHEN r.any_received THEN '部分到貨'
    ELSE '待到貨'
  END
  FROM readiness AS r
  WHERE o.order_id = r.order_id
    AND o.shipping_status <> '已出貨';

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'order_id', o.order_id,
        'customer_id', o.customer_id,
        'shipping_status', o.shipping_status,
        'items', (
          SELECT COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'item_id', oi.item_id,
                'product_id', oi.product_id,
                'quantity', oi.quantity,
                'received_quantity', oi.received_quantity,
                'item_status', oi.item_status,
                'reconciliation_status', CASE
                  WHEN oi.item_status = '已出貨'
                    OR oi.received_quantity >= oi.quantity THEN '已齊貨'
                  ELSE '缺貨'
                END,
                'shortage_quantity', GREATEST(oi.quantity - oi.received_quantity, 0)
              )
              ORDER BY oi.item_id
            ),
            '[]'::jsonb
          )
          FROM public.order_items AS oi
          WHERE oi.order_id = o.order_id
        )
      )
      ORDER BY o.order_date, o.order_id
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM public.orders AS o
  WHERE (p_order_id IS NULL OR o.order_id = p_order_id)
    AND EXISTS (
      SELECT 1
      FROM public.order_items AS oi
      WHERE oi.order_id = o.order_id
    );

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_product_receipt(
  p_product_id integer,
  p_quantity integer
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_product public.products%ROWTYPE;
  v_item record;
  v_remaining integer;
  v_allocation integer;
  v_new_received integer;
  v_allocated integer := 0;
  v_touched_orders integer[] := ARRAY[]::integer[];
  v_order_id integer;
  v_allocations jsonb := '[]'::jsonb;
BEGIN
  IF p_product_id IS NULL OR p_product_id <= 0 THEN
    RAISE EXCEPTION 'product_id 必須是正整數'
      USING ERRCODE = '22023';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity > 100000 THEN
    RAISE EXCEPTION '入庫數量必須介乎 1 至 100000'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_product
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到商品 %', p_product_id
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.products
  SET stock = COALESCE(stock, 0) + p_quantity,
      status = CASE
        WHEN status IN ('預購中', '旅購中') THEN '已到貨'
        ELSE status
      END
      WHERE id = p_product_id
  RETURNING * INTO v_product;

  v_remaining := p_quantity;

  FOR v_item IN
    SELECT
      oi.item_id,
      oi.order_id,
      oi.quantity,
      oi.received_quantity
    FROM public.order_items AS oi
    JOIN public.orders AS o
      ON o.order_id = oi.order_id
    WHERE oi.product_id = p_product_id
      AND oi.item_status = '待進貨'
      AND oi.received_quantity < oi.quantity
    ORDER BY o.order_date, o.order_id, oi.item_id
    FOR UPDATE OF oi
  LOOP
    EXIT WHEN v_remaining = 0;

    v_allocation := LEAST(v_remaining, v_item.quantity - v_item.received_quantity);
    v_new_received := v_item.received_quantity + v_allocation;

    UPDATE public.order_items
    SET received_quantity = v_new_received,
        item_status = CASE
          WHEN v_new_received >= quantity THEN '已到貨倉'
          ELSE '待進貨'
        END
    WHERE item_id = v_item.item_id;

    v_remaining := v_remaining - v_allocation;
    v_allocated := v_allocated + v_allocation;
    v_touched_orders := array_append(v_touched_orders, v_item.order_id);
    v_allocations := v_allocations || jsonb_build_array(
      jsonb_build_object(
        'order_id', v_item.order_id,
        'item_id', v_item.item_id,
        'received_quantity', v_new_received,
        'ordered_quantity', v_item.quantity,
        'item_status', CASE
          WHEN v_new_received >= v_item.quantity THEN '已到貨倉'
          ELSE '待進貨'
        END
      )
    );
  END LOOP;

  FOR v_order_id IN
    SELECT DISTINCT touched.order_id
    FROM unnest(v_touched_orders) AS touched(order_id)
  LOOP
    PERFORM public.reconcile_inbound_orders(v_order_id);
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'product_id', p_product_id,
    'stock', v_product.stock,
    'product_status', v_product.status,
    'received_quantity', p_quantity,
    'allocated_quantity', v_allocated,
    'unallocated_quantity', v_remaining,
    'allocations', v_allocations
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_inbound_orders(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_product_receipt(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_inbound_orders(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_product_receipt(integer, integer) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

```

---

### File: `supabase\migrations\20260926234000_add_shipping_management.sql`

```
BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS customer_phone varchar(20);

CREATE TABLE IF NOT EXISTS public.shipping_notifications (
  order_id uuid PRIMARY KEY
    REFERENCES public.orders(order_id)
    ON DELETE CASCADE,
  customer_phone varchar(20) NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  claimed_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shipping_notifications_status_check
    CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  CONSTRAINT shipping_notifications_attempts_check
    CHECK (attempts >= 0),
  CONSTRAINT shipping_notifications_phone_check
    CHECK (customer_phone ~ '^[0-9]{8,15}$')
);

ALTER TABLE public.shipping_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shipping_notifications FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.shipping_notifications TO service_role;

CREATE INDEX IF NOT EXISTS shipping_notifications_pending_idx
  ON public.shipping_notifications (status, claimed_at)
  WHERE status IN ('pending', 'failed', 'sending');

CREATE OR REPLACE FUNCTION public.get_shipping_pick_list(p_group_by text DEFAULT 'order')
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF p_group_by NOT IN ('order', 'product') THEN
    RAISE EXCEPTION 'group_by 只接受 order 或 product'
      USING ERRCODE = '22023';
  END IF;

  IF p_group_by = 'order' THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'order_id', ready.order_id,
          'order_date', ready.order_date,
          'shipping_method', ready.shipping_method,
          'tracking_number', ready.tracking_number,
          'items', ready.items
        )
        ORDER BY ready.order_date, ready.order_id
      ),
      '[]'::jsonb
    )
    INTO v_result
    FROM (
      SELECT
        o.order_id,
        o.order_date,
        o.shipping_method,
        o.tracking_number,
        jsonb_agg(
          jsonb_build_object(
            'item_id', oi.item_id,
            'product_id', oi.product_id,
            'product_name', COALESCE(
              to_jsonb(p)->>'product_name',
              to_jsonb(p)->>'name',
              '未命名商品'
            ),
            'quantity', oi.quantity,
            'item_status', oi.item_status
          )
          ORDER BY oi.item_id
        ) AS items
      FROM public.orders AS o
      JOIN public.order_items AS oi
        ON oi.order_id = o.order_id
      JOIN public.products AS p
        ON p.id = oi.product_id
      WHERE o.shipping_status = '可出貨'
        AND oi.item_status = '已到貨倉'
      GROUP BY
        o.order_id,
        o.order_date,
        o.shipping_method,
        o.tracking_number
    ) AS ready;
  ELSE
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'product_id', ready.product_id,
          'product_name', ready.product_name,
          'total_quantity', ready.total_quantity,
          'orders', ready.orders
        )
        ORDER BY ready.product_name, ready.product_id
      ),
      '[]'::jsonb
    )
    INTO v_result
    FROM (
      SELECT
        oi.product_id,
        COALESCE(
          to_jsonb(p)->>'product_name',
          to_jsonb(p)->>'name',
          '未命名商品'
        ) AS product_name,
        SUM(oi.quantity)::integer AS total_quantity,
        jsonb_agg(
          jsonb_build_object(
            'order_id', o.order_id,
            'item_id', oi.item_id,
            'quantity', oi.quantity
          )
          ORDER BY o.order_date, o.order_id, oi.item_id
        ) AS orders
      FROM public.orders AS o
      JOIN public.order_items AS oi
        ON oi.order_id = o.order_id
      JOIN public.products AS p
        ON p.id = oi.product_id
      WHERE o.shipping_status = '可出貨'
        AND oi.item_status = '已到貨倉'
      GROUP BY
        oi.product_id,
        COALESCE(
          to_jsonb(p)->>'product_name',
          to_jsonb(p)->>'name',
          '未命名商品'
        )
    ) AS ready;
  END IF;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ship_order(
  p_order_id integer,
  p_shipping_method text,
  p_tracking_number text,
  p_customer_phone text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_phone text;
  v_item_count integer;
  v_result jsonb;
BEGIN
  IF p_order_id IS NULL OR p_order_id <= 0 THEN
    RAISE EXCEPTION 'order_id 必須是正整數'
      USING ERRCODE = '22023';
  END IF;
  IF p_shipping_method IS NULL
     OR p_shipping_method NOT IN ('面交', '自取', '順豐', '京東') THEN
    RAISE EXCEPTION 'shipping_method 無效'
      USING ERRCODE = '22023';
  END IF;
  IF p_tracking_number IS NULL
     OR length(btrim(p_tracking_number)) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'tracking_number 必須是 1 至 100 個字元'
      USING ERRCODE = '22023';
  END IF;
  IF p_customer_phone IS NOT NULL
     AND p_customer_phone !~ '^[0-9]{8,15}$' THEN
    RAISE EXCEPTION 'customer_phone 必須是 8 至 15 位數字'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE order_id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到訂單 %', p_order_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_order.shipping_status <> '可出貨' THEN
    RAISE EXCEPTION '訂單必須處於可出貨狀態才可出貨'
      USING ERRCODE = '55000';
  END IF;

  SELECT COUNT(*)
  INTO v_item_count
  FROM public.order_items
  WHERE order_id = p_order_id;

  IF v_item_count = 0 OR EXISTS (
    SELECT 1
    FROM public.order_items
    WHERE order_id = p_order_id
      AND item_status <> '已到貨倉'
  ) THEN
    RAISE EXCEPTION '訂單明細尚未全部齊貨，不能出貨'
      USING ERRCODE = '55000';
  END IF;

  v_phone := COALESCE(p_customer_phone, v_order.customer_phone);
  IF v_phone IS NULL OR v_phone !~ '^[0-9]{8,15}$' THEN
    RAISE EXCEPTION '訂單缺少有效 WhatsApp 聯絡電話'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.orders
  SET shipping_status = '已出貨',
      shipping_method = p_shipping_method,
      tracking_number = btrim(p_tracking_number),
      customer_phone = v_phone
  WHERE order_id = p_order_id;

  UPDATE public.order_items
  SET item_status = '已出貨'
  WHERE order_id = p_order_id
    AND item_status = '已到貨倉';

  INSERT INTO public.shipping_notifications (
    order_id,
    customer_phone,
    status,
    attempts,
    claimed_at,
    sent_at,
    last_error,
    updated_at
  )
  VALUES (
    p_order_id,
    v_phone,
    'pending',
    0,
    NULL,
    NULL,
    NULL,
    now()
  )
  ON CONFLICT (order_id) DO UPDATE
  SET customer_phone = EXCLUDED.customer_phone,
      status = 'pending',
      claimed_at = NULL,
      sent_at = NULL,
      last_error = NULL,
      updated_at = now()
  WHERE public.shipping_notifications.status <> 'sent';

  SELECT jsonb_build_object(
    'order_id', p_order_id,
    'shipping_status', '已出貨',
    'shipping_method', p_shipping_method,
    'tracking_number', btrim(p_tracking_number),
    'item_count', v_item_count
  )
  INTO v_result;

  RETURN jsonb_build_object('success', true, 'shipment', v_result);
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_shipping_notification(p_order_id integer)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_notification public.shipping_notifications%ROWTYPE;
BEGIN
  UPDATE public.shipping_notifications
  SET status = 'sending',
      attempts = attempts + 1,
      claimed_at = now(),
      updated_at = now()
  WHERE order_id = p_order_id
    AND (
      status IN ('pending', 'failed')
      OR (status = 'sending' AND claimed_at < now() - interval '5 minutes')
    )
  RETURNING * INTO v_notification;

  IF NOT FOUND THEN
    SELECT *
    INTO v_notification
    FROM public.shipping_notifications
    WHERE order_id = p_order_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION '找不到出貨通知工作'
        USING ERRCODE = 'P0002';
    END IF;

    RETURN jsonb_build_object(
      'claimed', false,
      'status', v_notification.status
    );
  END IF;

  RETURN jsonb_build_object(
    'claimed', true,
    'status', v_notification.status,
    'customer_phone', v_notification.customer_phone,
    'shipping_method', (
      SELECT shipping_method FROM public.orders WHERE order_id = p_order_id
    ),
    'tracking_number', (
      SELECT tracking_number FROM public.orders WHERE order_id = p_order_id
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.finish_shipping_notification(
  p_order_id integer,
  p_success boolean,
  p_error_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_status text;
BEGIN
  IF p_success IS NULL THEN
    RAISE EXCEPTION 'success 必須有布林值'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.shipping_notifications
  SET status = CASE WHEN p_success THEN 'sent' ELSE 'failed' END,
      sent_at = CASE WHEN p_success THEN now() ELSE NULL END,
      claimed_at = NULL,
      last_error = CASE
        WHEN p_success THEN NULL
        ELSE left(COALESCE(p_error_message, 'WhatsApp 發送失敗'), 500)
      END,
      updated_at = now()
  WHERE order_id = p_order_id
    AND status = 'sending'
  RETURNING status INTO v_status;

  IF NOT FOUND THEN
    RAISE EXCEPTION '出貨通知未處於發送中狀態'
      USING ERRCODE = '55000';
  END IF;

  RETURN jsonb_build_object('status', v_status);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_shipping_pick_list(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ship_order(integer, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_shipping_notification(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_shipping_notification(integer, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_shipping_pick_list(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ship_order(integer, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_shipping_notification(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_shipping_notification(integer, boolean, text) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

```

---

### File: `supabase\migrations\20260926235000_add_customer_order_lookup.sql`

```
BEGIN;

CREATE TABLE IF NOT EXISTS public.customer_lookup_rate_limits (
  rate_limit_key varchar(64) PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_lookup_rate_limits_key_check
    CHECK (rate_limit_key ~ '^[0-9a-f]{64}$'),
  CONSTRAINT customer_lookup_rate_limits_count_check
    CHECK (request_count > 0)
);

ALTER TABLE public.customer_lookup_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.customer_lookup_rate_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.customer_lookup_rate_limits TO service_role;

CREATE INDEX IF NOT EXISTS orders_customer_lookup_idx
  ON public.orders (customer_phone, order_date DESC, order_id DESC);

CREATE OR REPLACE FUNCTION public.lookup_customer_orders(
  p_customer_phone text,
  p_order_id integer,
  p_rate_limit_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_request_count integer;
  v_orders jsonb;
BEGIN
  IF (p_customer_phone IS NULL) = (p_order_id IS NULL) THEN
    RAISE EXCEPTION '必須且只可提供一種查詢條件'
      USING ERRCODE = '22023';
  END IF;

  IF p_customer_phone IS NOT NULL
     AND p_customer_phone !~ '^[0-9]{8,15}$' THEN
    RAISE EXCEPTION 'customer_phone 必須是 8 至 15 位數字'
      USING ERRCODE = '22023';
  END IF;

  IF p_order_id IS NOT NULL AND p_order_id <= 0 THEN
    RAISE EXCEPTION 'order_id 必須是正整數'
      USING ERRCODE = '22023';
  END IF;

  IF p_rate_limit_key IS NULL
     OR p_rate_limit_key !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'rate limit key 無效'
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.customer_lookup_rate_limits
  WHERE updated_at < now() - interval '1 day';

  INSERT INTO public.customer_lookup_rate_limits AS current_limit (
    rate_limit_key,
    window_started_at,
    request_count,
    updated_at
  )
  VALUES (
    p_rate_limit_key,
    now(),
    1,
    now()
  )
  ON CONFLICT (rate_limit_key) DO UPDATE
  SET window_started_at = CASE
    WHEN current_limit.window_started_at
             <= now() - interval '15 minutes' THEN now()
    ELSE current_limit.window_started_at
      END,
      request_count = CASE
    WHEN current_limit.window_started_at
             <= now() - interval '15 minutes' THEN 1
    ELSE current_limit.request_count + 1
      END,
      updated_at = now()
  RETURNING request_count INTO v_request_count;

  IF v_request_count > 10 THEN
    RETURN jsonb_build_object('rate_limited', true);
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'order_id', matching_orders.order_id,
        'order_date', matching_orders.order_date,
        'total_amount', matching_orders.total_amount,
        'payment_status', matching_orders.payment_status,
        'shipping_status', matching_orders.shipping_status,
        'shipping_method', matching_orders.shipping_method,
        'tracking_number', matching_orders.tracking_number,
        'items', matching_orders.items
      )
      ORDER BY matching_orders.order_date DESC, matching_orders.order_id DESC
    ),
    '[]'::jsonb
  )
  INTO v_orders
  FROM (
    SELECT
      o.order_id,
      o.order_date,
      o.total_amount,
      o.payment_status,
      o.shipping_status,
      o.shipping_method,
      o.tracking_number,
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'item_id', oi.item_id,
              'product_id', oi.product_id,
              'product_name', COALESCE(
                to_jsonb(p)->>'product_name',
                to_jsonb(p)->>'name',
                '未命名商品'
              ),
              'quantity', oi.quantity,
              'received_quantity', oi.received_quantity,
              'item_status', oi.item_status,
              'reconciliation_status', CASE
                WHEN oi.item_status = '已出貨'
                  OR oi.received_quantity >= oi.quantity THEN '已齊貨'
                WHEN oi.received_quantity > 0 THEN '部分到貨'
                ELSE '待到貨'
              END,
              'shortage_quantity', GREATEST(
                oi.quantity - oi.received_quantity,
                0
              )
            )
            ORDER BY oi.item_id
          )
          FROM public.order_items AS oi
          LEFT JOIN public.products AS p
            ON p.id = oi.product_id
          WHERE oi.order_id = o.order_id
        ),
        '[]'::jsonb
      ) AS items
    FROM public.orders AS o
    WHERE (
        p_customer_phone IS NULL
        OR regexp_replace(o.customer_phone, '^\+', '') = p_customer_phone
      )
      AND (p_order_id IS NULL OR o.order_id = p_order_id)
    ORDER BY o.order_date DESC, o.order_id DESC
    LIMIT 20
  ) AS matching_orders;

  RETURN jsonb_build_object(
    'rate_limited', false,
    'orders', v_orders
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.lookup_customer_orders(text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_customer_orders(text, integer, text) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

```

---

### File: `supabase\migrations\20260927000100_add_whatsapp_webhook.sql`

```
BEGIN;

CREATE TABLE IF NOT EXISTS public.whatsapp_payment_reports (
  provider_message_id varchar(255) PRIMARY KEY,
  order_id uuid NOT NULL
    REFERENCES public.orders(order_id)
    ON DELETE CASCADE,
  customer_phone varchar(20) NOT NULL,
  payment_reference varchar(100) NOT NULL,
  status text NOT NULL DEFAULT '待核實',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_payment_reports_status_check
    CHECK (status IN ('待核實', '已核實', '不成立')),
  CONSTRAINT whatsapp_payment_reports_phone_check
    CHECK (customer_phone ~ '^[0-9]{8,15}$')
);

ALTER TABLE public.whatsapp_payment_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.whatsapp_payment_reports FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.whatsapp_payment_reports TO service_role;

CREATE INDEX IF NOT EXISTS whatsapp_payment_reports_order_idx
  ON public.whatsapp_payment_reports (order_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.lookup_whatsapp_order(
  p_customer_phone text,
  p_order_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_order jsonb;
BEGIN
  IF p_customer_phone IS NULL
     OR p_customer_phone !~ '^[0-9]{8,15}$'
     OR p_order_id IS NULL
     OR p_order_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'WhatsApp 訂單查詢參數無效'
      USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object(
    'found', true,
    'order_id', o.order_id,
    'payment_status', o.payment_status,
    'shipping_status', o.shipping_status,
    'shipping_method', o.shipping_method,
    'tracking_number', o.tracking_number,
    'items', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'product_name', COALESCE(
              to_jsonb(p)->>'product_name',
              to_jsonb(p)->>'name',
              '未命名商品'
            ),
            'quantity', oi.quantity,
            'received_quantity', oi.received_quantity,
            'item_status', oi.item_status,
            'reconciliation_status', CASE
              WHEN oi.item_status = '已出貨'
                OR oi.received_quantity >= oi.quantity THEN '已齊貨'
              WHEN oi.received_quantity > 0 THEN '部分到貨'
              ELSE '待到貨'
            END
          )
          ORDER BY oi.item_id
        )
        FROM public.order_items AS oi
        LEFT JOIN public.products AS p
          ON p.id = oi.product_id
        WHERE oi.order_id = o.order_id
      ),
      '[]'::jsonb
    )
  )
  INTO v_order
  FROM public.orders AS o
  WHERE o.order_id::text = lower(p_order_id)
    AND regexp_replace(o.customer_phone, '^\+', '') = p_customer_phone;

  RETURN COALESCE(v_order, jsonb_build_object('found', false));
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_whatsapp_payment_report(
  p_customer_phone text,
  p_order_id text,
  p_payment_reference text,
  p_provider_message_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_inserted_message_id varchar(255);
  v_existing public.whatsapp_payment_reports%ROWTYPE;
BEGIN
  IF p_customer_phone IS NULL
     OR p_customer_phone !~ '^[0-9]{8,15}$'
     OR p_order_id IS NULL
     OR p_order_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR p_payment_reference IS NULL
     OR length(btrim(p_payment_reference)) NOT BETWEEN 1 AND 100
     OR p_provider_message_id IS NULL
     OR length(p_provider_message_id) NOT BETWEEN 1 AND 255 THEN
    RAISE EXCEPTION 'WhatsApp 付款回報資料無效'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.orders AS o
  WHERE o.order_id::text = lower(p_order_id)
    AND regexp_replace(o.customer_phone, '^\+', '') = p_customer_phone
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false, 'duplicate', false);
  END IF;

  INSERT INTO public.whatsapp_payment_reports (
    provider_message_id,
    order_id,
    customer_phone,
    payment_reference
  )
  VALUES (
    p_provider_message_id,
    p_order_id::uuid,
    p_customer_phone,
    btrim(p_payment_reference)
  )
  ON CONFLICT (provider_message_id) DO NOTHING
  RETURNING provider_message_id INTO v_inserted_message_id;

  IF v_inserted_message_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'found', true,
      'duplicate', false,
      'status', '待核實'
    );
  END IF;

  SELECT *
  INTO v_existing
  FROM public.whatsapp_payment_reports
  WHERE provider_message_id = p_provider_message_id;

  IF NOT FOUND
     OR v_existing.order_id <> p_order_id::uuid
     OR v_existing.customer_phone <> p_customer_phone THEN
    RETURN jsonb_build_object('found', false, 'duplicate', false);
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'duplicate', true,
    'status', v_existing.status
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.lookup_whatsapp_order(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_whatsapp_payment_report(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_whatsapp_order(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_whatsapp_payment_report(text, text, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

```

---

### File: `supabase\migrations\20260927000200_add_product_stock_update.sql`

```
BEGIN;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS stock integer NOT NULL DEFAULT 0;

ALTER TABLE public.products
  ALTER COLUMN stock SET DEFAULT 0;

UPDATE public.products
SET stock = 0
WHERE stock IS NULL;

ALTER TABLE public.products
  ALTER COLUMN stock SET NOT NULL;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_stock_nonnegative_check'
      AND conrelid = 'public.products'::regclass
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_stock_nonnegative_check
      CHECK (stock >= 0);
  END IF;
END
$migration$;

CREATE OR REPLACE FUNCTION public.set_product_stock(
  p_product_id text,
  p_stock integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_product public.products%ROWTYPE;
BEGIN
  IF p_product_id IS NULL OR length(btrim(p_product_id)) = 0 THEN
    RAISE EXCEPTION 'product_id 不可為空'
      USING ERRCODE = '22023';
  END IF;

  IF p_stock IS NULL OR p_stock < 0 THEN
    RAISE EXCEPTION 'stock 必須是非負整數'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_product
  FROM public.products
  WHERE id::text = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到產品 %', p_product_id
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.products
  SET stock = p_stock
  WHERE id::text = p_product_id
  RETURNING * INTO v_product;

  RETURN jsonb_build_object(
    'success', true,
    'product_id', v_product.id::text,
    'stock', v_product.stock,
    'status', v_product.status
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.set_product_stock(text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_product_stock(text, integer)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

```

---

### File: `supabase\migrations\20260927000300_support_uuid_order_shipping.sql`

```
BEGIN;

CREATE OR REPLACE FUNCTION public.ship_order(
  p_order_id text,
  p_shipping_method text,
  p_tracking_number text,
  p_customer_phone text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_product_id public.products.id%TYPE;
  v_product public.products%ROWTYPE;
  v_required_quantity integer;
  v_phone text;
  v_item_count integer;
  v_result jsonb;
BEGIN
  IF p_order_id IS NULL OR length(btrim(p_order_id)) = 0 THEN
    RAISE EXCEPTION 'order_id 不可為空'
      USING ERRCODE = '22023';
  END IF;
  IF p_shipping_method IS NULL
     OR p_shipping_method NOT IN ('面交', '自取', '順豐', '京東') THEN
    RAISE EXCEPTION 'shipping_method 無效'
      USING ERRCODE = '22023';
  END IF;
  IF p_tracking_number IS NULL
     OR length(btrim(p_tracking_number)) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'tracking_number 必須是 1 至 100 個字元'
      USING ERRCODE = '22023';
  END IF;
  IF p_customer_phone IS NOT NULL
     AND p_customer_phone !~ '^[0-9]{8,15}$' THEN
    RAISE EXCEPTION 'customer_phone 必須是 8 至 15 位數字'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE order_id::text = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到訂單 %', p_order_id
      USING ERRCODE = 'P0002';
  END IF;

  FOR v_product_id IN
    SELECT DISTINCT p.id
    FROM public.products AS p
    JOIN public.order_items AS oi
      ON oi.product_id = p.id
    WHERE oi.order_id = v_order.order_id
    ORDER BY p.id
  LOOP
    SELECT *
    INTO v_product
    FROM public.products
    WHERE id = v_product_id
    FOR UPDATE;

    SELECT COALESCE(SUM(quantity), 0)::integer
    INTO v_required_quantity
    FROM public.order_items
    WHERE order_id = v_order.order_id
      AND product_id = v_product_id;

    IF v_product.stock < v_required_quantity THEN
      RAISE EXCEPTION '產品 % 庫存不足，不能出貨', v_product_id
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE order_id::text = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到訂單 %', p_order_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_order.shipping_status <> '可出貨' THEN
    RAISE EXCEPTION '訂單必須處於可出貨狀態才可出貨'
      USING ERRCODE = '55000';
  END IF;

  SELECT COUNT(*)
  INTO v_item_count
  FROM public.order_items
  WHERE order_id = v_order.order_id;

  IF v_item_count = 0 OR EXISTS (
    SELECT 1
    FROM public.order_items
    WHERE order_id = v_order.order_id
      AND item_status <> '已到貨倉'
  ) THEN
    RAISE EXCEPTION '訂單明細尚未全部齊貨，不能出貨'
      USING ERRCODE = '55000';
  END IF;

  v_phone := COALESCE(p_customer_phone, v_order.customer_phone);
  IF v_phone IS NULL OR v_phone !~ '^[0-9]{8,15}$' THEN
    RAISE EXCEPTION '訂單缺少有效 WhatsApp 聯絡電話'
      USING ERRCODE = '22023';
  END IF;

  FOR v_product_id IN
    SELECT DISTINCT p.id
    FROM public.products AS p
    JOIN public.order_items AS oi
      ON oi.product_id = p.id
    WHERE oi.order_id = v_order.order_id
    ORDER BY p.id
  LOOP
    SELECT COALESCE(SUM(quantity), 0)::integer
    INTO v_required_quantity
    FROM public.order_items
    WHERE order_id = v_order.order_id
      AND product_id = v_product_id;

    UPDATE public.products
    SET stock = stock - v_required_quantity
    WHERE id = v_product_id;
  END LOOP;

  UPDATE public.orders
  SET shipping_status = '已出貨',
      shipping_method = p_shipping_method,
      tracking_number = btrim(p_tracking_number),
      customer_phone = v_phone
  WHERE order_id = v_order.order_id;

  UPDATE public.order_items
  SET item_status = '已出貨'
  WHERE order_id = v_order.order_id
    AND item_status = '已到貨倉';

  INSERT INTO public.shipping_notifications (
    order_id,
    customer_phone,
    status,
    attempts,
    claimed_at,
    sent_at,
    last_error,
    updated_at
  )
  VALUES (
    v_order.order_id,
    v_phone,
    'pending',
    0,
    NULL,
    NULL,
    NULL,
    now()
  )
  ON CONFLICT (order_id) DO UPDATE
  SET customer_phone = EXCLUDED.customer_phone,
      status = 'pending',
      claimed_at = NULL,
      sent_at = NULL,
      last_error = NULL,
      updated_at = now()
  WHERE public.shipping_notifications.status <> 'sent';

  SELECT jsonb_build_object(
    'order_id', v_order.order_id,
    'shipping_status', '已出貨',
    'shipping_method', p_shipping_method,
    'tracking_number', btrim(p_tracking_number),
    'item_count', v_item_count
  )
  INTO v_result;

  RETURN jsonb_build_object('success', true, 'shipment', v_result);
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_shipping_notification(p_order_id text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_notification public.shipping_notifications%ROWTYPE;
BEGIN
  UPDATE public.shipping_notifications
  SET status = 'sending',
      attempts = attempts + 1,
      claimed_at = now(),
      updated_at = now()
  WHERE order_id::text = p_order_id
    AND (
      status IN ('pending', 'failed')
      OR (status = 'sending' AND claimed_at < now() - interval '5 minutes')
    )
  RETURNING * INTO v_notification;

  IF NOT FOUND THEN
    SELECT *
    INTO v_notification
    FROM public.shipping_notifications
    WHERE order_id::text = p_order_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION '找不到出貨通知工作'
        USING ERRCODE = 'P0002';
    END IF;

    RETURN jsonb_build_object(
      'claimed', false,
      'status', v_notification.status
    );
  END IF;

  RETURN jsonb_build_object(
    'claimed', true,
    'status', v_notification.status,
    'customer_phone', v_notification.customer_phone,
    'shipping_method', (
      SELECT shipping_method
      FROM public.orders
      WHERE order_id::text = p_order_id
    ),
    'tracking_number', (
      SELECT tracking_number
      FROM public.orders
      WHERE order_id::text = p_order_id
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.finish_shipping_notification(
  p_order_id text,
  p_success boolean,
  p_error_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_status text;
BEGIN
  IF p_success IS NULL THEN
    RAISE EXCEPTION 'success 必須有布林值'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.shipping_notifications
  SET status = CASE WHEN p_success THEN 'sent' ELSE 'failed' END,
      sent_at = CASE WHEN p_success THEN now() ELSE NULL END,
      claimed_at = NULL,
      last_error = CASE
        WHEN p_success THEN NULL
        ELSE left(COALESCE(p_error_message, 'WhatsApp 發送失敗'), 500)
      END,
      updated_at = now()
  WHERE order_id::text = p_order_id
    AND status = 'sending'
  RETURNING status INTO v_status;

  IF NOT FOUND THEN
    RAISE EXCEPTION '出貨通知未處於發送中狀態'
      USING ERRCODE = '55000';
  END IF;

  RETURN jsonb_build_object('status', v_status);
END;
$function$;

REVOKE ALL ON FUNCTION public.ship_order(text, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_shipping_notification(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_shipping_notification(text, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ship_order(text, text, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_shipping_notification(text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_shipping_notification(text, boolean, text)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

```

---

### File: `supabase\migrations\20260927000500_atomic_customer_checkout.sql`

```
BEGIN;

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS received_quantity integer NOT NULL DEFAULT 0;

UPDATE public.order_items
SET received_quantity = quantity
WHERE item_status IN ('已到貨倉', '已出貨')
  AND received_quantity = 0;

ALTER TABLE public.order_items
  ALTER COLUMN received_quantity SET NOT NULL;

ALTER TABLE public.order_items
  DROP CONSTRAINT IF EXISTS order_items_received_quantity_check;

ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_received_quantity_check
    CHECK (received_quantity >= 0 AND received_quantity <= quantity);

CREATE OR REPLACE FUNCTION public.create_customer_order(
  p_customer_phone text,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_item jsonb;
  v_product_id text;
  v_quantity integer;
  v_product record;
  v_order_id uuid := gen_random_uuid();
  v_order_items jsonb := '[]'::jsonb;
  v_total numeric(14, 2) := 0;
  v_order_date timestamptz := now();
BEGIN
  IF p_customer_phone IS NULL
     OR p_customer_phone !~ '^[0-9]{8,15}$'
     OR p_items IS NULL
     OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION '結帳資料無效' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS entry(value)
    WHERE jsonb_typeof(entry.value) <> 'object'
       OR COALESCE(entry.value->>'product_id', '') = ''
       OR COALESCE(entry.value->>'quantity', '') !~ '^[1-9][0-9]*$'
       OR CASE
         WHEN COALESCE(entry.value->>'quantity', '') ~ '^[1-9][0-9]*$'
           THEN (entry.value->>'quantity')::numeric > 1000
         ELSE false
       END
  ) THEN
    RAISE EXCEPTION '商品編號或數量無效' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS entry(value)
    GROUP BY lower(entry.value->>'product_id')
    HAVING COUNT(*) > 1
        OR SUM((entry.value->>'quantity')::numeric) > 1000
  ) THEN
    RAISE EXCEPTION '重複商品或商品數量超出限制' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_items)
    ORDER BY value->>'product_id'
  LOOP
    v_product_id := v_item->>'product_id';
    v_quantity := (v_item->>'quantity')::integer;

    SELECT
      p.id::text AS id,
      COALESCE(NULLIF(to_jsonb(p)->>'product_name', ''), NULLIF(to_jsonb(p)->>'name', ''), '未命名商品') AS product_name,
      COALESCE(NULLIF(to_jsonb(p)->>'price', '')::numeric, 0)::numeric(14, 2) AS unit_price,
      COALESCE(NULLIF(to_jsonb(p)->>'stock', '')::integer, 0) AS stock,
      COALESCE(to_jsonb(p)->>'status', 'active') AS product_status,
      COALESCE(to_jsonb(p)->>'is_active', 'true') AS is_active
    INTO v_product
    FROM public.products AS p
    WHERE lower(p.id::text) = lower(v_product_id)
    FOR UPDATE;

    IF NOT FOUND
       OR v_product.product_status IN ('inactive', 'archived', '停用', '下架', '已下架')
       OR v_product.is_active = 'false' THEN
      RAISE EXCEPTION 'PRODUCT_UNAVAILABLE' USING ERRCODE = 'P0001';
    END IF;
    IF v_product.stock < v_quantity THEN
      RAISE EXCEPTION 'STOCK_UNAVAILABLE'
        USING ERRCODE = 'P0001',
              DETAIL = jsonb_build_object(
                'product_id', v_product_id,
                'product_name', v_product.product_name,
                'requested', v_quantity,
                'available', v_product.stock
              )::text;
    END IF;
    IF v_product.unit_price < 0 THEN
      RAISE EXCEPTION '商品售價無效' USING ERRCODE = '22023';
    END IF;

    v_total := v_total + (v_product.unit_price * v_quantity);
    v_order_items := v_order_items || jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id,
      'product_name', v_product.product_name,
      'quantity', v_quantity,
      'unit_price', v_product.unit_price,
      'item_status', '待進貨',
      'is_travel_buy', false
    ));
  END LOOP;

  INSERT INTO public.orders (
    order_id,
    customer_phone,
    order_date,
    payment_status,
    shipping_status,
    total_amount
  )
  VALUES (
    v_order_id,
    p_customer_phone,
    v_order_date,
    '未付款',
    '待到貨',
    v_total
  );

  INSERT INTO public.order_items (
    order_id,
    product_id,
    quantity,
    unit_price,
    item_status,
    is_travel_buy,
    received_quantity
  )
  SELECT
    v_order_id,
    p.id,
    (entry.value->>'quantity')::integer,
    (entry.value->>'unit_price')::numeric,
    entry.value->>'item_status',
    false,
    0
  FROM jsonb_array_elements(v_order_items) AS entry(value)
  JOIN public.products AS p
    ON lower(p.id::text) = lower(entry.value->>'product_id');

  IF NOT FOUND THEN
    RAISE EXCEPTION '訂單明細建立失敗' USING ERRCODE = 'P0001';
  END IF;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_items)
    ORDER BY value->>'product_id'
  LOOP
    v_product_id := v_item->>'product_id';
    v_quantity := (v_item->>'quantity')::integer;

    UPDATE public.products AS p
    SET stock = p.stock - v_quantity
    WHERE lower(p.id::text) = lower(v_product_id);

    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRODUCT_UNAVAILABLE' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'order_date', v_order_date,
    'payment_status', '未付款',
    'shipping_status', '待到貨',
    'total_amount', v_total,
    'items', v_order_items
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_customer_order(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_customer_order(text, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

```

---

### File: `supabase\migrations\20260927000600_uuid_customer_lookup.sql`

```
BEGIN;

CREATE TABLE IF NOT EXISTS public.customer_lookup_rate_limits (
  rate_limit_key varchar(64) PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_lookup_rate_limits_key_check
    CHECK (rate_limit_key ~ '^[0-9a-f]{64}$'),
  CONSTRAINT customer_lookup_rate_limits_count_check
    CHECK (request_count > 0)
);

ALTER TABLE public.customer_lookup_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.customer_lookup_rate_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.customer_lookup_rate_limits TO service_role;

CREATE INDEX IF NOT EXISTS orders_customer_lookup_idx
  ON public.orders (customer_phone, order_date DESC, order_id DESC);

DROP FUNCTION IF EXISTS public.lookup_customer_orders(text, integer, text);

CREATE OR REPLACE FUNCTION public.lookup_customer_orders(
  p_customer_phone text,
  p_order_id uuid,
  p_rate_limit_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_request_count integer;
  v_orders jsonb;
BEGIN
  IF (p_customer_phone IS NULL) = (p_order_id IS NULL) THEN
    RAISE EXCEPTION '必須且只可提供一種查詢條件'
      USING ERRCODE = '22023';
  END IF;

  IF p_customer_phone IS NOT NULL
     AND p_customer_phone !~ '^[0-9]{8,15}$' THEN
    RAISE EXCEPTION 'customer_phone 必須是 8 至 15 位數字'
      USING ERRCODE = '22023';
  END IF;

  IF p_rate_limit_key IS NULL
     OR p_rate_limit_key !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'rate limit key 無效'
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.customer_lookup_rate_limits
  WHERE updated_at < now() - interval '1 day';

  INSERT INTO public.customer_lookup_rate_limits AS current_limit (
    rate_limit_key,
    window_started_at,
    request_count,
    updated_at
  )
  VALUES (
    p_rate_limit_key,
    now(),
    1,
    now()
  )
  ON CONFLICT (rate_limit_key) DO UPDATE
  SET window_started_at = CASE
        WHEN current_limit.window_started_at <= now() - interval '15 minutes' THEN now()
        ELSE current_limit.window_started_at
      END,
      request_count = CASE
        WHEN current_limit.window_started_at <= now() - interval '15 minutes' THEN 1
        ELSE current_limit.request_count + 1
      END,
      updated_at = now()
  RETURNING request_count INTO v_request_count;

  IF v_request_count > 10 THEN
    RETURN jsonb_build_object('rate_limited', true);
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'order_id', matching_orders.order_id,
        'order_date', matching_orders.order_date,
        'total_amount', matching_orders.total_amount,
        'payment_status', matching_orders.payment_status,
        'shipping_status', matching_orders.shipping_status,
        'shipping_method', matching_orders.shipping_method,
        'tracking_number', matching_orders.tracking_number,
        'whatsapp_notification_status', matching_orders.whatsapp_notification_status,
        'items', matching_orders.items
      )
      ORDER BY matching_orders.order_date DESC, matching_orders.order_id DESC
    ),
    '[]'::jsonb
  )
  INTO v_orders
  FROM (
    SELECT
      o.order_id,
      o.order_date,
      o.total_amount,
      o.payment_status,
      o.shipping_status,
      o.shipping_method,
      o.tracking_number,
      COALESCE(sn.status, 'not_created') AS whatsapp_notification_status,
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'product_name', COALESCE(
                to_jsonb(p)->>'product_name',
                to_jsonb(p)->>'name',
                '未命名商品'
              ),
              'quantity', oi.quantity,
              'received_quantity', oi.received_quantity,
              'item_status', oi.item_status,
              'reconciliation_status', CASE
                WHEN oi.item_status = '已出貨'
                  OR oi.received_quantity >= oi.quantity THEN '已齊貨'
                WHEN oi.received_quantity > 0 THEN '部分到貨'
                ELSE '待到貨'
              END,
              'shortage_quantity', GREATEST(oi.quantity - oi.received_quantity, 0)
            )
            ORDER BY oi.item_id
          )
          FROM public.order_items AS oi
          LEFT JOIN public.products AS p ON p.id = oi.product_id
          WHERE oi.order_id = o.order_id
        ),
        '[]'::jsonb
      ) AS items
    FROM public.orders AS o
    LEFT JOIN public.shipping_notifications AS sn ON sn.order_id = o.order_id
    WHERE (
        p_customer_phone IS NULL
        OR regexp_replace(o.customer_phone, '^\+', '') = p_customer_phone
      )
      AND (p_order_id IS NULL OR o.order_id = p_order_id)
    ORDER BY o.order_date DESC, o.order_id DESC
    LIMIT 20
  ) AS matching_orders;

  RETURN jsonb_build_object(
    'rate_limited', false,
    'orders', v_orders
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.lookup_customer_orders(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_customer_orders(text, uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

```

---

### File: `supabase\migrations\20260927000700_uuid_inbound_reconciliation.sql`

```
BEGIN;

DROP FUNCTION IF EXISTS public.reconcile_inbound_orders(integer);

CREATE FUNCTION public.reconcile_inbound_orders(p_order_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF p_order_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.orders
       WHERE order_id = p_order_id
     ) THEN
    RAISE EXCEPTION '找不到訂單 %', p_order_id
      USING ERRCODE = 'P0002';
  END IF;

  WITH readiness AS (
    SELECT
      oi.order_id,
      bool_and(
        oi.item_status = '已出貨'
        OR oi.item_status = '已到貨倉'
        OR oi.received_quantity >= oi.quantity
      ) AS all_ready,
      bool_or(
        oi.received_quantity > 0
        OR oi.item_status IN ('已到貨倉', '已出貨')
      ) AS any_received
    FROM public.order_items AS oi
    WHERE p_order_id IS NULL OR oi.order_id = p_order_id
    GROUP BY oi.order_id
  )
  UPDATE public.orders AS o
  SET shipping_status = CASE
    WHEN readiness.all_ready THEN '可出貨'
    WHEN readiness.any_received THEN '部分到貨'
    ELSE '待到貨'
  END
  FROM readiness
  WHERE o.order_id = readiness.order_id
    AND o.shipping_status <> '已出貨';

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'order_id', o.order_id,
        'customer_id', o.customer_id,
        'shipping_status', o.shipping_status,
        'items', (
          SELECT COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'item_id', oi.item_id,
                'product_id', oi.product_id,
                'quantity', oi.quantity,
                'received_quantity', oi.received_quantity,
                'item_status', oi.item_status,
                'reconciliation_status', CASE
                  WHEN oi.item_status = '已出貨'
                    OR oi.received_quantity >= oi.quantity THEN '已齊貨'
                  ELSE '缺貨'
                END,
                'shortage_quantity', GREATEST(oi.quantity - oi.received_quantity, 0)
              )
              ORDER BY oi.item_id
            ),
            '[]'::jsonb
          )
          FROM public.order_items AS oi
          WHERE oi.order_id = o.order_id
        )
      )
      ORDER BY o.order_date, o.order_id
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM public.orders AS o
  WHERE (p_order_id IS NULL OR o.order_id = p_order_id)
    AND EXISTS (
      SELECT 1
      FROM public.order_items AS oi
      WHERE oi.order_id = o.order_id
    );

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_product_receipt(
  p_product_id integer,
  p_quantity integer
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_product public.products%ROWTYPE;
  v_item record;
  v_remaining integer;
  v_allocation integer;
  v_new_received integer;
  v_allocated integer := 0;
  v_touched_orders uuid[] := ARRAY[]::uuid[];
  v_order_id uuid;
  v_allocations jsonb := '[]'::jsonb;
BEGIN
  IF p_product_id IS NULL OR p_product_id <= 0 THEN
    RAISE EXCEPTION 'product_id 必須是正整數'
      USING ERRCODE = '22023';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity > 100000 THEN
    RAISE EXCEPTION '入庫數量必須介乎 1 至 100000'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_product
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到商品 %', p_product_id
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.products
  SET stock = COALESCE(stock, 0) + p_quantity,
      status = CASE
        WHEN status IN ('預購中', '旅購中') THEN '已到貨'
        ELSE status
      END
  WHERE id = p_product_id
  RETURNING * INTO v_product;

  v_remaining := p_quantity;

  FOR v_item IN
    SELECT
      oi.item_id,
      oi.order_id,
      oi.quantity,
      oi.received_quantity
    FROM public.order_items AS oi
    JOIN public.orders AS o ON o.order_id = oi.order_id
    WHERE oi.product_id = p_product_id
      AND oi.item_status = '待進貨'
      AND oi.received_quantity < oi.quantity
    ORDER BY o.order_date, o.order_id, oi.item_id
    FOR UPDATE OF oi
  LOOP
    EXIT WHEN v_remaining = 0;

    v_allocation := LEAST(v_remaining, v_item.quantity - v_item.received_quantity);
    v_new_received := v_item.received_quantity + v_allocation;

    UPDATE public.order_items
    SET received_quantity = v_new_received,
        item_status = CASE
          WHEN v_new_received >= quantity THEN '已到貨倉'
          ELSE '待進貨'
        END
    WHERE item_id = v_item.item_id;

    v_remaining := v_remaining - v_allocation;
    v_allocated := v_allocated + v_allocation;
    v_touched_orders := array_append(v_touched_orders, v_item.order_id);
    v_allocations := v_allocations || jsonb_build_array(
      jsonb_build_object(
        'order_id', v_item.order_id,
        'item_id', v_item.item_id,
        'received_quantity', v_new_received,
        'ordered_quantity', v_item.quantity,
        'item_status', CASE
          WHEN v_new_received >= v_item.quantity THEN '已到貨倉'
          ELSE '待進貨'
        END
      )
    );
  END LOOP;

  FOR v_order_id IN
    SELECT DISTINCT touched.order_id
    FROM unnest(v_touched_orders) AS touched(order_id)
  LOOP
    PERFORM public.reconcile_inbound_orders(v_order_id);
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'product_id', p_product_id,
    'stock', v_product.stock,
    'product_status', v_product.status,
    'received_quantity', p_quantity,
    'allocated_quantity', v_allocated,
    'unallocated_quantity', v_remaining,
    'allocations', v_allocations
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_inbound_orders(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_product_receipt(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_inbound_orders(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_product_receipt(integer, integer) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

```

---

### File: `tests\admin-sessions.test.js`

```
'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const createAdminSessions = require('../middleware/admin-sessions');

const SHIPPING_TOKEN = 'shipping-session-test-token-0123456789abcdef';
const ANALYTICS_TOKEN = 'analytics-session-test-token-0123456789abcdef';
const SESSION_SECRET = 'independent-admin-session-signing-secret-012345';

async function withServer(app, run) {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
}

function createTestApp(options = {}) {
  const sessions = createAdminSessions({
    sessionSecret: SESSION_SECRET,
    credentials: [
      { token: SHIPPING_TOKEN, scopes: ['shipping', 'products'] },
      { token: ANALYTICS_TOKEN, scopes: ['analytics'] }
    ],
    ...options
  });
  const app = express();
  app.use(express.json());
  app.use('/api/admin-auth', sessions.router);
  app.get('/api/shipping/report', (req, res) => {
    const authorized = sessions.isAuthorized(req, SHIPPING_TOKEN, 'shipping');
    return authorized
      ? res.json({ success: true, data: { authorized }, message: 'ok' })
      : res.status(401).json({ success: false, data: null, message: 'Unauthorized.' });
  });
  app.post('/api/shipping/update', (req, res) => {
    const authorized = sessions.isAuthorized(req, SHIPPING_TOKEN, 'shipping');
    return authorized
      ? res.json({ success: true, data: { authorized }, message: 'ok' })
      : res.status(403).json({ success: false, data: null, message: 'Unauthorized or invalid origin.' });
  });
  return app;
}

test('admin login issues an HttpOnly scoped cookie and session authorizes same-origin writes', async () => {
  const app = createTestApp({ secureCookie: true });
  await withServer(app, async baseUrl => {
    const origin = baseUrl;
    const loginResponse = await fetch(`${baseUrl}/api/admin-auth/login`, {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ token: SHIPPING_TOKEN })
    });
    const loginBody = await loginResponse.json();
    const setCookie = loginResponse.headers.get('set-cookie');
    assert.equal(loginResponse.status, 200);
    assert.equal(loginBody.success, true);
    assert.deepEqual(loginBody.data.scopes, ['shipping', 'products']);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    assert.match(setCookie, /Secure/i);
    assert.match(setCookie, /Path=\/api/i);
    assert.doesNotMatch(setCookie, new RegExp(SHIPPING_TOKEN));

    const cookie = setCookie.split(';', 1)[0];
    const sessionResponse = await fetch(`${baseUrl}/api/admin-auth/session`, {
      headers: { Cookie: cookie }
    });
    const sessionBody = await sessionResponse.json();
    assert.equal(sessionBody.data.authenticated, true);

    const readResponse = await fetch(`${baseUrl}/api/shipping/report`, {
      headers: { Cookie: cookie }
    });
    assert.equal(readResponse.status, 200);

    const writeResponse = await fetch(`${baseUrl}/api/shipping/update`, {
      method: 'POST',
      headers: {
        Origin: origin,
        Cookie: cookie
      }
    });
    assert.equal(writeResponse.status, 200);

    const crossOriginWrite = await fetch(`${baseUrl}/api/shipping/update`, {
      method: 'POST',
      headers: {
        Origin: 'http://attacker.example',
        Cookie: cookie
      }
    });
    assert.equal(crossOriginWrite.status, 403);
    assert.equal((await crossOriginWrite.json()).success, false);
  });
});

test('admin login rejects bad credentials and cross-origin login requests', async () => {
  await withServer(createTestApp(), async baseUrl => {
    const invalidToken = await fetch(`${baseUrl}/api/admin-auth/login`, {
      method: 'POST',
      headers: {
        Origin: baseUrl,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ token: 'incorrect-secret' })
    });
    assert.equal(invalidToken.status, 401);
    assert.equal((await invalidToken.json()).success, false);
    assert.equal(invalidToken.headers.get('set-cookie'), null);

    const invalidOrigin = await fetch(`${baseUrl}/api/admin-auth/login`, {
      method: 'POST',
      headers: {
        Origin: 'http://attacker.example',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ token: SHIPPING_TOKEN })
    });
    assert.equal(invalidOrigin.status, 403);
    assert.equal((await invalidOrigin.json()).success, false);
    assert.equal(invalidOrigin.headers.get('set-cookie'), null);
  });
});

test('session cookies reject tampering and do not grant other credentials scopes', async () => {
  await withServer(createTestApp(), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/admin-auth/login`, {
      method: 'POST',
      headers: {
        Origin: baseUrl,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ token: ANALYTICS_TOKEN })
    });
    const cookie = response.headers.get('set-cookie').split(';', 1)[0];
    const analyticsOnly = await fetch(`${baseUrl}/api/shipping/report`, {
      headers: { Cookie: cookie }
    });
    assert.equal(analyticsOnly.status, 401);

    const [name, value] = cookie.split('=');
    const tampered = `${name}=x${value.slice(1)}`;
    const invalidSession = await fetch(`${baseUrl}/api/admin-auth/session`, {
      headers: { Cookie: tampered }
    });
    assert.equal((await invalidSession.json()).data.authenticated, false);
  });
});

test('logout expires the HttpOnly session cookie', async () => {
  await withServer(createTestApp(), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/admin-auth/logout`, {
      method: 'POST',
      headers: { Origin: baseUrl }
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.match(response.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/i);
    assert.match(response.headers.get('set-cookie'), /HttpOnly/i);
  });
});

```

---

### File: `tests\analytics.test.js`

```
const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const createAnalyticsRouter = require('../routes/analytics');

const ADMIN_TOKEN = 'fedcba9876543210fedcba9876543210';

async function withServer(router, run) {
  const app = express();
  app.use(express.json());
  app.use('/api/analytics', router);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
}

async function request(baseUrl, path, token = ADMIN_TOKEN) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return {
    status: response.status,
    body: await response.json(),
    cacheStatus: response.headers.get('x-analytics-cache')
  };
}

function createRouter(supabase, options = {}) {
  return createAnalyticsRouter(supabase, {
    adminToken: ADMIN_TOKEN,
    readEnabled: true,
    ...options
  });
}

function createTableClient(tables) {
  return {
    from(tableName) {
      const state = {
        rows: tables[tableName] || [],
        filters: [],
        start: 0,
        end: Infinity
      };
      const query = {
        select(_columns, options) {
          state.countRequested = Boolean(options && options.count === 'exact');
          return query;
        },
        gte(column, value) {
          state.filters.push(row => new Date(row[column]).getTime() >= new Date(value).getTime());
          return query;
        },
        lt(column, value) {
          state.filters.push(row => new Date(row[column]).getTime() < new Date(value).getTime());
          return query;
        },
        eq(column, value) {
          state.filters.push(row => row[column] === value);
          return query;
        },
        in(column, values) {
          const selected = new Set(values.map(String));
          state.filters.push(row => selected.has(String(row[column])));
          return query;
        },
        order() {
          return query;
        },
        limit(limit) {
          state.end = Math.min(state.end, limit - 1);
          return query;
        },
        range(start, end) {
          state.start = start;
          state.end = end;
          return query;
        },
        then(resolve, reject) {
          const matchingRows = state.rows.filter(row => state.filters.every(filter => filter(row)));
          const result = {
            data: matchingRows.slice(state.start, state.end + 1),
            error: null,
            count: state.countRequested ? matchingRows.length : null
          };
          return Promise.resolve(result).then(resolve, reject);
        }
      };
      return query;
    }
  };
}

test('table fallback reports live orders and UUID-keyed product totals', async () => {
  const router = createRouter(createTableClient({
    orders: [
      {
        order_id: 'a123',
        order_date: '2026-09-20T10:00:00+08:00',
        total_amount: 150,
        payment_status: '未付款',
        shipping_status: '待到貨'
      },
      {
        order_id: 'b456',
        order_date: '2026-09-21T10:00:00+08:00',
        total_amount: 300,
        payment_status: '未付款',
        shipping_status: '待到貨'
      }
    ],
    order_items: [
      {
        item_id: 'i001',
        order_id: 'a123',
        product_id: 'p001',
        quantity: 1,
        unit_price: 150,
        item_status: '待進貨'
      },
      {
        item_id: 'i002',
        order_id: 'b456',
        product_id: 'p001',
        quantity: 2,
        unit_price: 150,
        item_status: '待進貨'
      }
    ],
    products: [{ id: 'p001', name: 'LittlePlanet 星球筆記本' }]
  }), { useTableFallback: true });

  await withServer(router, async baseUrl => {
    const overview = await request(
      baseUrl,
      '/api/analytics/overview?start_date=2026-09-01&end_date=2026-09-27'
    );
    assert.equal(overview.status, 200);
    assert.equal(overview.body.data.total_revenue, 450);
    assert.equal(overview.body.data.total_orders, 2);
    assert.equal(overview.body.data.paid_order_percentage, 0);
    assert.equal(overview.body.data.shipped_order_percentage, 0);

    const ranking = await request(
      baseUrl,
      '/api/analytics/top-products?start_date=2026-09-01&end_date=2026-09-27'
    );
    assert.equal(ranking.status, 200);
    assert.equal(ranking.body.data[0].product_id, 'p001');
    assert.equal(ranking.body.data[0].quantity_sold, 3);
    assert.equal(ranking.body.data[0].sales_amount, 450);

    const reconciliation = await request(
      baseUrl,
      '/api/analytics/reconciliation?start_date=2026-09-01&end_date=2026-09-27'
    );
    assert.equal(reconciliation.status, 200);
    assert.equal(reconciliation.body.data.total_count, 2);
    assert.equal(reconciliation.body.data.rows[0].order_id, 'a123');
  });
});

test('analytics report responses are cached by endpoint and query parameters', async () => {
  let rpcCalls = 0;
  const router = createRouter({
    rpc: async (_functionName, parameters) => {
      rpcCalls += 1;
      return {
        data: {
          start_date: parameters.p_start_date,
          end_date: parameters.p_end_date,
          total_revenue: rpcCalls,
          total_orders: rpcCalls,
          paid_orders: 0,
          unpaid_orders: rpcCalls,
          paid_order_percentage: 0,
          unpaid_order_percentage: 100,
          shipped_orders: 0,
          unshipped_orders: rpcCalls,
          shipped_order_percentage: 0,
          unshipped_order_percentage: 100
        },
        error: null
      };
    }
  });

  await withServer(router, async baseUrl => {
    const path = '/api/analytics/overview?start_date=2026-09-01&end_date=2026-09-26';
    const first = await request(baseUrl, path);
    const cached = await request(baseUrl, path);
    const differentRange = await request(
      baseUrl,
      '/api/analytics/overview?start_date=2026-09-02&end_date=2026-09-26'
    );

    assert.equal(first.status, 200);
    assert.equal(first.body.data.total_revenue, 1);
    assert.equal(first.body.success, true);
    assert.equal(cached.body.data.total_revenue, 1);
    assert.equal(first.cacheStatus, 'MISS');
    assert.equal(cached.cacheStatus, 'HIT');
    assert.equal(differentRange.body.data.total_revenue, 2);
    assert.equal(rpcCalls, 2);
  });
});

test('sales trend returns daily Hong Kong totals and fills dates without orders', async () => {
  const router = createRouter(createTableClient({
    orders: [
      {
        order_id: 'trend-1',
        order_date: '2026-09-20T23:30:00-07:00',
        total_amount: 150
      },
      {
        order_id: 'trend-2',
        order_date: '2026-09-22T12:00:00+08:00',
        total_amount: 300
      }
    ]
  }));

  await withServer(router, async baseUrl => {
    const response = await request(
      baseUrl,
      '/api/analytics/sales-trend?start_date=2026-09-21&end_date=2026-09-22'
    );
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data.labels, ['2026-09-21', '2026-09-22']);
    assert.deepEqual(response.body.data.revenue, [150, 300]);
    assert.deepEqual(response.body.data.order_count, [1, 1]);
    assert.equal(response.body.data.total_revenue, 450);
    assert.equal(response.body.data.total_orders, 2);
  });
});

test('sales trend validates dates, requires admin auth and surfaces database errors', async () => {
  await withServer(createRouter({
    from() {
      return {
        select() {
          return this;
        },
        gte() {
          return this;
        },
        lt() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return Promise.resolve({
            data: null,
            error: { code: 'XX000' }
          });
        }
      };
    }
  }), async baseUrl => {
    const invalid = await request(
      baseUrl,
      '/api/analytics/sales-trend?start_date=2026-02-30&end_date=2026-03-01'
    );
    assert.equal(invalid.status, 400);

    const dbError = await request(
      baseUrl,
      '/api/analytics/sales-trend?start_date=2026-09-01&end_date=2026-09-02'
    );
    assert.equal(dbError.status, 500);
    assert.equal(dbError.body.success, false);

    const unauthorized = await request(
      baseUrl,
      '/api/analytics/sales-trend?start_date=2026-09-01&end_date=2026-09-02',
      'wrong'
    );
    assert.equal(unauthorized.status, 401);
  });
});

test('revenue overview validates date range and returns RPC report', async () => {
  let call;
  const router = createRouter({
    rpc: async (name, args) => {
      call = { name, args };
      return {
        data: {
          total_revenue: 150,
          total_orders: 3,
          paid_orders: 2,
          unpaid_orders: 1,
          paid_order_percentage: 66.67,
          unshipped_order_percentage: 33.33
        },
        error: null
      };
    }
  });

  await withServer(router, async baseUrl => {
    const response = await request(
      baseUrl,
      '/api/analytics/overview?start_date=2026-01-01&end_date=2026-01-31'
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.data.total_revenue, 150);

    for (const query of [
      '',
      '?start_date=2026-02-30&end_date=2026-03-01',
      '?start_date=0000-01-01&end_date=0000-01-02',
      '?start_date=2026-02-02&end_date=2026-02-01',
      '?start_date=2010-01-01&end_date=2026-01-01'
    ]) {
      const invalid = await request(baseUrl, `/api/analytics/overview${query}`);
      assert.equal(invalid.status, 400);
    }
  });

  assert.deepEqual(call, {
    name: 'get_revenue_overview',
    args: {
      p_start_date: '2026-01-01',
      p_end_date: '2026-01-31'
    }
  });
});

test('top product ranking validates its limit and returns ordered rows', async () => {
  let args;
  const router = createRouter({
    rpc: async (name, parameters) => {
      assert.equal(name, 'get_top_selling_products');
      args = parameters;
      return {
        data: [{
          rank: 1,
          product_id: 5,
          product_name: '星星公仔',
          quantity_sold: 8,
          sales_amount: 240
        }],
        error: null
      };
    }
  });

  await withServer(router, async baseUrl => {
    const result = await request(
      baseUrl,
      '/api/analytics/top-products?start_date=2026-09-01&end_date=2026-09-26&limit=5'
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.data[0].quantity_sold, 8);

    for (const limit of ['0', '51', '1.5', '-1']) {
      const invalid = await request(
        baseUrl,
        `/api/analytics/top-products?start_date=2026-09-01&end_date=2026-09-26&limit=${limit}`
      );
      assert.equal(invalid.status, 400);
    }
  });

  assert.deepEqual(args, {
    p_start_date: '2026-09-01',
    p_end_date: '2026-09-26',
    p_limit: 5
  });
});

test('financial reconciliation validates filters and pagination', async () => {
  let args;
  const router = createRouter({
    rpc: async (name, parameters) => {
      assert.equal(name, 'get_financial_reconciliation');
      args = parameters;
      return {
        data: {
          total_count: 1,
          rows: [{
            order_id: 1,
            payment_status: '已付清',
            shipping_status: '已出貨',
            items: []
          }]
        },
        error: null
      };
    }
  });

  await withServer(router, async baseUrl => {
    const response = await request(
      baseUrl,
      '/api/analytics/reconciliation?start_date=2026-09-01&end_date=2026-09-26&payment_status=%E5%B7%B2%E4%BB%98%E6%B8%85&shipping_status=%E5%B7%B2%E5%87%BA%E8%B2%A8&limit=20&offset=40'
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.data.total_count, 1);

    for (const query of [
      '&payment_status=unknown',
      '&shipping_status=unknown',
      '&limit=101',
      '&offset=-1',
      '&offset=1.5',
      '&offset=2147483648'
    ]) {
      const invalid = await request(
        baseUrl,
        `/api/analytics/reconciliation?start_date=2026-09-01&end_date=2026-09-26${query}`
      );
      assert.equal(invalid.status, 400);
    }
  });

  assert.deepEqual(args, {
    p_start_date: '2026-09-01',
    p_end_date: '2026-09-26',
    p_payment_status: '已付清',
    p_shipping_status: '已出貨',
    p_limit: 20,
    p_offset: 40
  });
});

test('admin token and service role are enforced before report queries', async () => {
  let rpcCalls = 0;
  const router = createRouter({
    rpc: async () => {
      rpcCalls += 1;
      return { data: [], error: null };
    }
  });

  await withServer(router, async baseUrl => {
    const unauthorized = await request(
      baseUrl,
      '/api/analytics/top-products?start_date=2026-09-01&end_date=2026-09-26',
      'incorrect'
    );
    assert.equal(unauthorized.status, 401);

    const unavailable = createAnalyticsRouter({ rpc: async () => ({ data: [], error: null }) }, {
      adminToken: ADMIN_TOKEN,
      readEnabled: false
    });
    await withServer(unavailable, async unavailableUrl => {
      const response = await request(
        unavailableUrl,
        '/api/analytics/top-products?start_date=2026-09-01&end_date=2026-09-26'
      );
      assert.equal(response.status, 503);
    });
  });

  assert.equal(rpcCalls, 0);
});

test('Supabase errors and malformed RPC responses are explicit', async () => {
  await withServer(createRouter({
    rpc: async () => ({ data: null, error: { code: 'PGRST202' } })
  }), async baseUrl => {
    const response = await request(
      baseUrl,
      '/api/analytics/overview?start_date=2026-09-01&end_date=2026-09-26'
    );
    assert.equal(response.status, 503);
    assert.equal(response.body.success, false);
  });

  await withServer(createRouter({
    rpc: async () => ({ data: null, error: { code: 'XX000' } })
  }), async baseUrl => {
    const response = await request(
      baseUrl,
      '/api/analytics/overview?start_date=2026-09-01&end_date=2026-09-26'
    );
    assert.equal(response.status, 500);
    assert.equal(response.body.success, false);
  });

  await withServer(createRouter({
    rpc: async () => ({ data: [], error: null })
  }), async baseUrl => {
    const response = await request(
      baseUrl,
      '/api/analytics/overview?start_date=2026-09-01&end_date=2026-09-26'
    );
    assert.equal(response.status, 500);
    assert.equal(response.body.success, false);
  });
});

```

---

### File: `tests\customer.test.js`

```
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const createCustomerRouter = require('../routes/customer');

const RATE_SECRET = '0123456789abcdef0123456789abcdef';
const ORDER_UUID = 'e1da0bac-9021-4e87-920b-2f5bf5381f32';

async function withServer(router, run) {
  const app = express();
  app.use(express.json());
  app.use('/api/customer', router);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
}

async function request(baseUrl, body) {
  const response = await fetch(`${baseUrl}/api/customer/orders/lookup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return {
    status: response.status,
    retryAfter: response.headers.get('retry-after'),
    body: await response.json()
  };
}

function createRouter(supabase, options = {}) {
  return createCustomerRouter(supabase, {
    rateLimitSecret: RATE_SECRET,
    readEnabled: true,
    ...options
  });
}

test('phone lookup normalizes the phone and sends only a keyed hash of the IP', async () => {
  let arguments_;
  const router = createRouter({
    rpc: async (name, args) => {
      assert.equal(name, 'lookup_customer_orders');
      arguments_ = args;
      return {
        data: {
          rate_limited: false,
          orders: [{
            order_id: 12,
            payment_status: '已付清',
            shipping_status: '部分到貨',
            shipping_method: null,
            tracking_number: null,
            items: [{
              item_status: '待進貨',
              received_quantity: 1,
              reconciliation_status: '部分到貨'
            }]
          }]
        },
        error: null
      };
    }
  });

  await withServer(router, async baseUrl => {
    const response = await request(baseUrl, { customer_phone: '+85212345678' });
    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data[0].order_id, 12);
  });

  assert.equal(arguments_.p_customer_phone, '85212345678');
  assert.equal(arguments_.p_order_id, null);
  assert.match(arguments_.p_rate_limit_key, /^[0-9a-f]{64}$/);
  assert.equal(arguments_.p_rate_limit_key.includes('127.0.0.1'), false);
  const expectedHash = crypto
    .createHmac('sha256', RATE_SECRET)
    .update('127.0.0.1')
    .digest('hex');
  assert.equal(arguments_.p_rate_limit_key, expectedHash);
});

test('UUID order lookup works and does not distinguish a missing order', async () => {
  let arguments_;
  const router = createRouter({
    rpc: async (name, args) => {
      arguments_ = args;
      return { data: { rate_limited: false, orders: [] }, error: null };
    }
  });

  await withServer(router, async baseUrl => {
    const response = await request(baseUrl, { order_id: ORDER_UUID });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data, []);
    assert.match(response.body.message, /若資料相符/);
  });

  assert.equal(arguments_.p_customer_phone, null);
  assert.equal(arguments_.p_order_id, ORDER_UUID);
});

test('invalid or ambiguous lookup inputs do not call Supabase', async () => {
  let calls = 0;
  const router = createRouter({
    rpc: async () => {
      calls += 1;
      return { data: { rate_limited: false, orders: [] }, error: null };
    }
  });

  await withServer(router, async baseUrl => {
    for (const body of [
      {},
      { customer_phone: 'invalid' },
      { order_id: '123' },
      { customer_phone: '85212345678', order_id: 10 },
      { customer_phone: null, order_id: null }
    ]) {
      const response = await request(baseUrl, body);
      assert.equal(response.status, 400);
      assert.equal(response.body.success, false);
      assert.equal(response.body.data, null);
    }
  });

  assert.equal(calls, 0);
});

test('database rate limit is surfaced with Retry-After', async () => {
  const router = createRouter({
    rpc: async () => ({ data: { rate_limited: true }, error: null })
  });

  await withServer(router, async baseUrl => {
    const response = await request(baseUrl, { order_id: ORDER_UUID });
    assert.equal(response.status, 429);
    assert.equal(response.retryAfter, '900');
    assert.equal(response.body.success, false);
  });
});

test('missing migration, database errors, and invalid RPC results are explicit', async () => {
  await withServer(createRouter({
    rpc: async () => ({ data: null, error: { code: 'PGRST202' } })
  }), async baseUrl => {
    const response = await request(baseUrl, { order_id: ORDER_UUID });
    assert.equal(response.status, 503);
    assert.equal(response.body.success, false);
  });

  await withServer(createRouter({
    rpc: async () => ({ data: null, error: { code: 'XX000' } })
  }), async baseUrl => {
    const response = await request(baseUrl, { order_id: ORDER_UUID });
    assert.equal(response.status, 500);
    assert.equal(response.body.success, false);
  });

  await withServer(createRouter({
    rpc: async () => ({ data: { rate_limited: false }, error: null })
  }), async baseUrl => {
    const response = await request(baseUrl, { order_id: ORDER_UUID });
    assert.equal(response.status, 500);
    assert.equal(response.body.success, false);
  });
});

test('service role and rate-limit secret are required', async () => {
  await withServer(createRouter({ rpc: async () => ({ data: {}, error: null }) }, {
    readEnabled: false
  }), async baseUrl => {
    const response = await request(baseUrl, { order_id: ORDER_UUID });
    assert.equal(response.status, 503);
  });

  await withServer(createRouter({ rpc: async () => ({ data: {}, error: null }) }, {
    rateLimitSecret: 'replace-with-a-long-random-secret'
  }), async baseUrl => {
    const response = await request(baseUrl, { order_id: ORDER_UUID });
    assert.equal(response.status, 503);
  });
});

```

---

### File: `tests\e2e.test.js`

```
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const test = require('node:test');
const express = require('express');

const createProductsRouter = require('../routes/products');
const createOrdersRouter = require('../routes/orders');
const createReminderRouter = require('../routes/reminders');
const createInboundRouter = require('../routes/inbound');
const createShippingRouter = require('../routes/shipping');
const createCustomerRouter = require('../routes/customer');
const createAnalyticsRouter = require('../routes/analytics');
const createWebhookRouter = require('../routes/webhook');

const TOKENS = {
  reminder: 'r'.repeat(40),
  inbound: 'i'.repeat(40),
  shipping: 's'.repeat(40),
  lookup: 'l'.repeat(40),
  analytics: 'a'.repeat(40),
  webhookVerify: 'w'.repeat(40),
  webhookAppSecret: 'meta-app-secret-for-integration-tests'
};

function createStore() {
  const cutoff = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const store = {
    products: [{
      id: 51,
      name: 'LittlePlanet 月亮公仔',
      price: 25,
      stock: 2,
      is_active: true,
      status: '旅購中',
      category: '公仔',
      cutoff_datetime: cutoff,
      remind_status: '未提示',
      remind_claimed_at: null,
      remind_sent_at: null
    }],
    orders: [],
    orderItems: [],
    nextOrderId: 700,
    nextItemId: 900,
    failNextOrderInsert: false,
    failNextOrderItemsInsert: false,
    notifications: new Map(),
    whatsappMessages: [],
    paymentReports: new Map(),
    reminderClaims: 0,
    queryCount: 0
  };

  store.supabase = {
    from(table) {
      return new QueryBuilder(store, table);
    },
    async rpc(name, args) {
      store.queryCount += 1;

      if (name === 'create_customer_order') {
        if (store.failNextOrderInsert) {
          store.failNextOrderInsert = false;
          return { data: null, error: { code: 'PGRST202', message: 'Function is not available.' } };
        }
        if (store.failNextOrderItemsInsert) {
          store.failNextOrderItemsInsert = false;
          return { data: null, error: { code: 'XX000', message: 'Simulated atomic transaction failure.' } };
        }

        const requestedItems = args.p_items.map(item => ({
          product: store.products.find(candidate => String(candidate.id) === String(item.product_id)),
          quantity: item.quantity
        }));
        const missingProduct = requestedItems.find(item => !item.product);
        if (missingProduct) {
          return { data: null, error: { code: 'P0001', message: 'PRODUCT_UNAVAILABLE' } };
        }
        const shortStock = requestedItems.find(item => item.product.stock < item.quantity);
        if (shortStock) {
          return {
            data: null,
            error: {
              code: 'P0001',
              message: 'STOCK_UNAVAILABLE',
              details: JSON.stringify({
                product_id: shortStock.product.id,
                requested: shortStock.quantity,
                available: shortStock.product.stock
              })
            }
          };
        }

        const orderId = crypto.randomUUID();
        const order = {
          order_id: orderId,
          customer_phone: args.p_customer_phone,
          order_date: new Date().toISOString(),
          total_amount: requestedItems.reduce(
            (total, item) => total + Number(item.product.price) * item.quantity,
            0
          ),
          payment_status: '未付款',
          shipping_status: '待到貨'
        };
        const createdItems = requestedItems.map(({ product, quantity }) => ({
          item_id: crypto.randomUUID(),
          order_id: orderId,
          product_id: product.id,
          product_name: product.name,
          quantity,
          unit_price: product.price,
          received_quantity: 0,
          item_status: '待進貨',
          is_travel_buy: false
        }));
        store.orders.push(order);
        store.orderItems.push(...createdItems);
        for (const { product, quantity } of requestedItems) {
          product.stock -= quantity;
        }
        return {
          data: {
            order_id: orderId,
            order_date: order.order_date,
            payment_status: order.payment_status,
            shipping_status: order.shipping_status,
            total_amount: order.total_amount,
            items: createdItems
          },
          error: null
        };
      }

      if (name === 'record_product_receipt') {
        const product = store.products.find(item => item.id === args.p_product_id);
        if (!product) {
          return { data: null, error: { code: 'P0002' } };
        }

        product.stock += args.p_quantity;
        if (['預購中', '旅購中'].includes(product.status)) {
          product.status = '已到貨';
        }

        let remaining = args.p_quantity;
        let allocated = 0;
        const allocations = [];
        const matchingItems = store.orderItems
          .filter(item => item.product_id === product.id && item.item_status === '待進貨')
          .sort((left, right) => {
            const leftOrder = store.orders.find(order => order.order_id === left.order_id);
            const rightOrder = store.orders.find(order => order.order_id === right.order_id);
            return new Date(leftOrder.order_date) - new Date(rightOrder.order_date) ||
              left.item_id - right.item_id;
          });

        for (const item of matchingItems) {
          if (remaining === 0) break;
          const amount = Math.min(remaining, item.quantity - item.received_quantity);
          item.received_quantity += amount;
          if (item.received_quantity >= item.quantity) {
            item.item_status = '已到貨倉';
          }
          remaining -= amount;
          allocated += amount;
          allocations.push({ item_id: item.item_id, received_quantity: item.received_quantity });
        }

        for (const order of store.orders) {
          const items = store.orderItems.filter(item => item.order_id === order.order_id);
          if (items.length > 0) {
            const ready = items.every(item => (
              item.item_status === '已出貨' ||
              item.item_status === '已到貨倉' ||
              item.received_quantity >= item.quantity
            ));
            const anyReceived = items.some(item => item.received_quantity > 0);
            order.shipping_status = ready ? '可出貨' : anyReceived ? '部分到貨' : '待到貨';
          }
        }

        return {
          data: {
            success: true,
            product_id: product.id,
            stock: product.stock,
            allocated_quantity: allocated,
            unallocated_quantity: remaining,
            allocations
          },
          error: null
        };
      }

      if (name === 'reconcile_inbound_orders') {
        const result = store.orders
          .filter(order => args.p_order_id === null || order.order_id === args.p_order_id)
          .map(order => ({
            order_id: order.order_id,
            shipping_status: order.shipping_status,
            items: store.orderItems
              .filter(item => item.order_id === order.order_id)
              .map(item => ({
                item_id: item.item_id,
                item_status: item.item_status,
                received_quantity: item.received_quantity,
                reconciliation_status: item.received_quantity >= item.quantity ? '已齊貨' : '缺貨',
                shortage_quantity: Math.max(0, item.quantity - item.received_quantity)
              }))
          }));
        return { data: result, error: null };
      }

      if (name === 'get_shipping_pick_list') {
        const readyItems = store.orderItems.filter(item => {
          const order = store.orders.find(candidate => candidate.order_id === item.order_id);
          return order && order.shipping_status === '可出貨' && item.item_status === '已到貨倉';
        });

        if (args.p_group_by === 'product') {
          const result = new Map();
          for (const item of readyItems) {
            const product = store.products.find(candidate => candidate.id === item.product_id);
            let row = result.get(item.product_id);
            if (!row) {
              row = {
                product_id: item.product_id,
                product_name: product.name,
                total_quantity: 0,
                orders: []
              };
              result.set(item.product_id, row);
            }
            row.total_quantity += item.quantity;
            row.orders.push({ order_id: item.order_id, item_id: item.item_id, quantity: item.quantity });
          }
          return { data: [...result.values()], error: null };
        }

        const grouped = new Map();
        for (const item of readyItems) {
          const order = store.orders.find(candidate => candidate.order_id === item.order_id);
          let row = grouped.get(order.order_id);
          if (!row) {
            row = { order_id: order.order_id, items: [] };
            grouped.set(order.order_id, row);
          }
          const product = store.products.find(candidate => candidate.id === item.product_id);
          row.items.push({
            item_id: item.item_id,
            product_id: item.product_id,
            product_name: product.name,
            quantity: item.quantity,
            item_status: item.item_status
          });
        }
        return { data: [...grouped.values()], error: null };
      }

      if (name === 'ship_order') {
        const order = store.orders.find(candidate => String(candidate.order_id) === String(args.p_order_id));
        if (!order) return { data: null, error: { code: 'P0002' } };
        if (order.shipping_status !== '可出貨') {
          return { data: null, error: { code: '55000', message: '訂單未齊貨。' } };
        }

        order.shipping_status = '已出貨';
        order.shipping_method = args.p_shipping_method;
        order.tracking_number = args.p_tracking_number;
        for (const item of store.orderItems.filter(candidate => candidate.order_id === order.order_id)) {
          item.item_status = '已出貨';
        }
        for (const item of store.orderItems.filter(candidate => candidate.order_id === order.order_id)) {
          const product = store.products.find(candidate => candidate.id === item.product_id);
          product.stock -= item.quantity;
        }
        store.notifications.set(String(order.order_id), {
          status: 'pending',
          customer_phone: args.p_customer_phone || order.customer_phone,
          shipping_method: order.shipping_method,
          tracking_number: order.tracking_number
        });
        return { data: { success: true, shipment: { order_id: order.order_id } }, error: null };
      }

      if (name === 'claim_shipping_notification') {
        const notification = store.notifications.get(String(args.p_order_id));
        if (!notification) return { data: null, error: { code: 'P0002' } };
        if (notification.status !== 'pending' && notification.status !== 'failed') {
          return { data: { claimed: false, status: notification.status }, error: null };
        }
        notification.status = 'sending';
        return { data: { claimed: true, ...notification }, error: null };
      }

      if (name === 'finish_shipping_notification') {
        const notification = store.notifications.get(String(args.p_order_id));
        if (!notification) return { data: null, error: { code: 'P0002' } };
        notification.status = args.p_success ? 'sent' : 'failed';
        return { data: { status: notification.status }, error: null };
      }

      if (name === 'lookup_customer_orders') {
        const orders = store.orders
          .filter(order => (
            args.p_customer_phone === null ||
            order.customer_phone === args.p_customer_phone
          ) && (
            args.p_order_id === null ||
            order.order_id === args.p_order_id
          ))
          .sort((left, right) => new Date(right.order_date) - new Date(left.order_date))
          .slice(0, 20)
          .map(order => ({
            order_id: order.order_id,
            order_date: order.order_date,
            total_amount: order.total_amount,
            payment_status: order.payment_status,
            shipping_status: order.shipping_status,
            shipping_method: order.shipping_method || null,
            tracking_number: order.tracking_number || null,
            whatsapp_notification_status: store.notifications.has(String(order.order_id))
              ? store.notifications.get(String(order.order_id)).status
              : 'not_created',
            items: store.orderItems
              .filter(item => item.order_id === order.order_id)
              .map(item => ({
                item_id: item.item_id,
                product_id: item.product_id,
                product_name: store.products.find(product => product.id === item.product_id).name,
                quantity: item.quantity,
                received_quantity: item.received_quantity,
                item_status: item.item_status,
                reconciliation_status: item.item_status === '已出貨'
                  ? '已齊貨'
                  : item.received_quantity >= item.quantity
                    ? '已齊貨'
                    : item.received_quantity > 0
                      ? '部分到貨'
                      : '待到貨'
              }))
          }));
        return { data: { rate_limited: false, orders }, error: null };
      }

      if (name === 'get_revenue_overview') {
        const totalRevenue = store.orders.reduce((sum, order) => sum + order.total_amount, 0);
        const totalOrders = store.orders.length;
        const paidOrders = store.orders.filter(order => order.payment_status !== '未付款').length;
        const shippedOrders = store.orders.filter(order => order.shipping_status === '已出貨').length;
        return {
          data: {
            total_revenue: totalRevenue,
            total_orders: totalOrders,
            paid_orders: paidOrders,
            unpaid_orders: totalOrders - paidOrders,
            paid_order_percentage: totalOrders ? paidOrders * 100 / totalOrders : 0,
            unpaid_order_percentage: totalOrders ? (totalOrders - paidOrders) * 100 / totalOrders : 0,
            shipped_orders: shippedOrders,
            unshipped_orders: totalOrders - shippedOrders,
            shipped_order_percentage: totalOrders ? shippedOrders * 100 / totalOrders : 0,
            unshipped_order_percentage: totalOrders ? (totalOrders - shippedOrders) * 100 / totalOrders : 0
          },
          error: null
        };
      }

      if (name === 'get_top_selling_products') {
        const aggregate = new Map();
        for (const item of store.orderItems) {
          const product = store.products.find(candidate => candidate.id === item.product_id);
          const existing = aggregate.get(product.id) || {
            product_id: product.id,
            product_name: product.name,
            quantity_sold: 0,
            sales_amount: 0
          };
          existing.quantity_sold += item.quantity;
          existing.sales_amount += item.quantity * item.unit_price;
          aggregate.set(product.id, existing);
        }
        const result = [...aggregate.values()]
          .sort((left, right) => right.quantity_sold - left.quantity_sold)
          .slice(0, args.p_limit)
          .map((item, index) => ({ rank: index + 1, ...item }));
        return { data: result, error: null };
      }

      if (name === 'get_financial_reconciliation') {
        return {
          data: {
            total_count: store.orders.length,
            rows: store.orders.slice(args.p_offset, args.p_offset + args.p_limit).map(order => ({
              order_id: order.order_id,
              order_date: order.order_date,
              total_amount: order.total_amount,
              payment_status: order.payment_status,
              shipping_status: order.shipping_status,
              shipping_method: order.shipping_method || null,
              tracking_number: order.tracking_number || null,
              items: store.orderItems.filter(item => item.order_id === order.order_id)
            }))
          },
          error: null
        };
      }

      if (name === 'lookup_whatsapp_order') {
        const order = store.orders.find(candidate => (
          candidate.order_id === args.p_order_id &&
          candidate.customer_phone === args.p_customer_phone
        ));
        return {
          data: order ? { found: true, order_id: order.order_id } : { found: false },
          error: null
        };
      }

      if (name === 'record_whatsapp_payment_report') {
        const order = store.orders.find(candidate => (
          candidate.order_id === args.p_order_id &&
          candidate.customer_phone === args.p_customer_phone
        ));
        if (!order) return { data: { found: false, duplicate: false }, error: null };
        if (store.paymentReports.has(args.p_provider_message_id)) {
          return { data: { found: true, duplicate: true }, error: null };
        }
        store.paymentReports.set(args.p_provider_message_id, {
          order_id: args.p_order_id,
          payment_reference: args.p_payment_reference,
          status: '待核實'
        });
        return { data: { found: true, duplicate: false, status: '待核實' }, error: null };
      }

      throw new Error(`Unexpected Supabase RPC: ${name}`);
    }
  };

  return store;
}

class QueryBuilder {
  constructor(store, table) {
    this.store = store;
    this.table = table;
    this.operation = 'select';
    this.filters = [];
    this.sorts = [];
    this.payload = null;
    this.selectedColumns = '*';
    this.singleResult = false;
  }

  select(columns = '*') {
    this.selectedColumns = columns;
    return this;
  }

  in(column, values) {
    this.filters.push(row => values.includes(row[column]));
    return this;
  }

  eq(column, value) {
    this.filters.push(row => row[column] === value);
    return this;
  }

  gte(column, value) {
    this.filters.push(row => String(row[column]) >= String(value));
    return this;
  }

  lte(column, value) {
    this.filters.push(row => String(row[column]) <= String(value));
    return this;
  }

  or() {
    return this;
  }

  order(column, options = {}) {
    this.sorts.push({ column, ascending: options.ascending !== false });
    return this;
  }

  update(values) {
    this.operation = 'update';
    this.payload = values;
    return this;
  }

  insert(values) {
    this.operation = 'insert';
    this.payload = values;
    return this;
  }

  delete() {
    this.operation = 'delete';
    return this;
  }

  single() {
    this.singleResult = true;
    return this.execute().then(result => ({
      data: Array.isArray(result.data) ? result.data[0] || null : result.data,
      error: result.error
    }));
  }

  async execute() {
    const { store, table } = this;
    if (table === 'products') {
      if (this.operation === 'update') {
        const updated = store.products.filter(row => this.filters.every(filter => filter(row)));
        for (const row of updated) {
          if (this.payload.remind_claimed_at) {
            store.reminderClaims += 1;
          }
          Object.assign(row, this.payload);
        }
        return { data: updated.map(row => ({ ...row })), error: null };
      }
      let selected = store.products.filter(row => this.filters.every(filter => filter(row)));
      for (const sort of this.sorts) {
        selected = selected.slice().sort((left, right) => {
          const comparison = String(left[sort.column]).localeCompare(String(right[sort.column]));
          return sort.ascending ? comparison : -comparison;
        });
      }
      return { data: selected.map(row => ({ ...row })), error: null };
    }

    if (table === 'orders') {
      if (this.operation === 'insert') {
        if (store.failNextOrderInsert) {
          store.failNextOrderInsert = false;
          return {
            data: null,
            error: { code: '42703', message: 'Missing order column.' }
          };
        }
        const inserted = this.payload.map(record => ({
          order_id: store.nextOrderId++,
          ...record
        }));
        store.orders.push(...inserted);
        return { data: inserted.map(row => ({ ...row })), error: null };
      }
      if (this.operation === 'delete') {
        const deleted = store.orders.filter(row => this.filters.every(filter => filter(row)));
        store.orders = store.orders.filter(row => !deleted.includes(row));
        const deletedIds = new Set(deleted.map(row => row.order_id));
        store.orderItems = store.orderItems.filter(row => !deletedIds.has(row.order_id));
        return { data: deleted, error: null };
      }
      return {
        data: store.orders.filter(row => this.filters.every(filter => filter(row))).map(row => ({ ...row })),
        error: null
      };
    }

    if (table === 'order_items') {
      if (this.operation === 'insert') {
        if (store.failNextOrderItemsInsert) {
          store.failNextOrderItemsInsert = false;
          return { data: null, error: { code: 'XX000', message: 'Simulated detail insert failure.' } };
        }
        const inserted = this.payload.map(record => ({
          item_id: store.nextItemId++,
          received_quantity: 0,
          ...record
        }));
        store.orderItems.push(...inserted);
        return { data: inserted.map(row => ({ ...row })), error: null };
      }
      return {
        data: store.orderItems.filter(row => this.filters.every(filter => filter(row))).map(row => ({ ...row })),
        error: null
      };
    }

    throw new Error(`Unexpected Supabase table: ${table}`);
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }
}

function createApplication(store) {
  const app = express();
  app.use(express.json({
    limit: '50kb',
    verify(req, res, buffer) {
      if (req.originalUrl.startsWith('/api/webhook/whatsapp')) {
        req.rawBody = Buffer.from(buffer);
      }
    }
  }));

  app.use('/api/products', createProductsRouter(store.supabase));
  app.use('/api/orders', createOrdersRouter(store.supabase));
  app.use('/api/reminders', createReminderRouter(store.supabase, {
    cronToken: TOKENS.reminder,
    recipients: ['85212345678'],
    sendWhatsApp: async message => store.whatsappMessages.push(message)
  }));
  app.use('/api/inbound', createInboundRouter(store.supabase, {
    adminToken: TOKENS.inbound,
    writeEnabled: true
  }));
  app.use('/api/shipping', createShippingRouter(store.supabase, {
    adminToken: TOKENS.shipping,
    writeEnabled: true,
    sendWhatsApp: async message => store.whatsappMessages.push(message)
  }));
  app.use('/api/customer', createCustomerRouter(store.supabase, {
    rateLimitSecret: TOKENS.lookup,
    readEnabled: true
  }));
  app.use('/api/analytics', createAnalyticsRouter(store.supabase, {
    adminToken: TOKENS.analytics,
    readEnabled: true
  }));
  app.use('/api/webhook', createWebhookRouter(store.supabase, {
    verifyToken: TOKENS.webhookVerify,
    appSecret: TOKENS.webhookAppSecret,
    writeEnabled: true,
    sendWhatsApp: async message => store.whatsappMessages.push(message)
  }));
  return app;
}

async function withServer(app, run) {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
}

async function jsonRequest(baseUrl, path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

function createSignature(rawBody) {
  return `sha256=${crypto
    .createHmac('sha256', TOKENS.webhookAppSecret)
    .update(rawBody)
    .digest('hex')}`;
}

test('E2E business flow: products, checkout rollback, reminders, inbound, shipping, customer lookup, analytics', async () => {
  const store = createStore();
  const app = createApplication(store);

  await withServer(app, async baseUrl => {
    const products = await jsonRequest(baseUrl, '/api/products?category=%E5%85%AC%E4%BB%94');
    assert.equal(products.status, 200);
    assert.equal(products.body.success, true);
    assert.equal(products.body.data[0].id, 51);

    const checkoutBody = {
      customer_phone: '+85212345678',
      totalAmount: 50,
      items: [{ product_id: 51, quantity: 2 }]
    };
    store.failNextOrderItemsInsert = true;
    const rolledBack = await jsonRequest(baseUrl, '/api/orders', {
      method: 'POST',
      body: checkoutBody
    });
    assert.equal(rolledBack.status, 500);
    assert.equal(rolledBack.body.success, false);
    assert.equal(store.orders.length, 0);
    assert.equal(store.orderItems.length, 0);
    assert.equal(store.products[0].stock, 2);

    const checkout = await jsonRequest(baseUrl, '/api/orders', {
      method: 'POST',
      body: checkoutBody
    });
    assert.equal(checkout.status, 201);
    assert.equal(checkout.body.success, true);
    const orderId = checkout.body.data.order_id;
    assert.match(orderId, /^[0-9a-f-]{36}$/i);
    assert.equal(store.orders.length, 1);
    assert.equal(store.orderItems.length, 1);
    assert.equal(store.products[0].stock, 0);

    const reminderAuth = TOKENS.reminder;
    const upcoming = await jsonRequest(
      baseUrl,
      '/api/reminders/upcoming?hours=24',
      { token: reminderAuth }
    );
    assert.equal(upcoming.status, 200);
    assert.equal(upcoming.body.data.length, 1);

    const reminderRun = await jsonRequest(baseUrl, '/api/reminders/run', {
      method: 'POST',
      token: reminderAuth,
      body: { hours: 24 }
    });
    assert.equal(reminderRun.status, 200);
    assert.equal(reminderRun.body.data[0].success, true);
    assert.equal(store.reminderClaims, 1);
    assert.equal(store.products[0].remind_status, '已發送提醒');
    assert.equal(store.whatsappMessages.some(message => message.text.includes('截單提醒')), true);

    const receipt = await jsonRequest(baseUrl, '/api/inbound/receipt', {
      method: 'POST',
      token: TOKENS.inbound,
      body: { product_id: 51, quantity: 2 }
    });
    assert.equal(receipt.status, 200);
    assert.equal(receipt.body.data.allocated_quantity, 2);
    assert.equal(store.orderItems[0].item_status, '已到貨倉');
    assert.equal(store.orders[0].shipping_status, '可出貨');
    assert.equal(store.products[0].stock, 2);

    const reconciliation = await jsonRequest(baseUrl, '/api/inbound/reconcile', {
      method: 'POST',
      token: TOKENS.inbound,
      body: { order_id: orderId }
    });
    assert.equal(reconciliation.status, 200);
    assert.equal(reconciliation.body.data[0].items[0].reconciliation_status, '已齊貨');

    const pickList = await jsonRequest(
      baseUrl,
      '/api/shipping/pick-list?group_by=order',
      { token: TOKENS.shipping }
    );
    assert.equal(pickList.status, 200);
    assert.equal(pickList.body.data[0].order_id, orderId);

    const productPickList = await jsonRequest(
      baseUrl,
      '/api/shipping/pick-list?group_by=product',
      { token: TOKENS.shipping }
    );
    assert.equal(productPickList.status, 200);
    assert.equal(productPickList.body.data[0].total_quantity, 2);

    const shipped = await jsonRequest(baseUrl, `/api/shipping/${orderId}/ship`, {
      method: 'POST',
      token: TOKENS.shipping,
      body: { shipping_method: '順豐', tracking_number: 'SF-E2E-700' }
    });
    assert.equal(shipped.status, 200);
    assert.equal(shipped.body.data.notification.success, true);
    assert.equal(store.orders[0].shipping_status, '已出貨');
    assert.equal(store.orderItems[0].item_status, '已出貨');
    assert.equal(store.notifications.get(String(orderId)).status, 'sent');
    assert.equal(store.products[0].stock, 0);
    assert.equal(store.whatsappMessages.some(message => message.text.includes('SF-E2E-700')), true);

    const customerLookup = await jsonRequest(baseUrl, '/api/customer/orders/lookup', {
      method: 'POST',
      body: { customer_phone: '85212345678' }
    });
    assert.equal(customerLookup.status, 200);
    assert.equal(customerLookup.body.data[0].order_id, orderId);
    assert.equal(customerLookup.body.data[0].shipping_status, '已出貨');
    assert.equal(customerLookup.body.data[0].tracking_number, 'SF-E2E-700');
    assert.equal(customerLookup.body.data[0].whatsapp_notification_status, 'sent');
    assert.equal(customerLookup.body.data[0].items[0].reconciliation_status, '已齊貨');

    const reportDate = new Date();
    const rangeStart = new Date(Date.UTC(
      reportDate.getUTCFullYear(),
      reportDate.getUTCMonth(),
      1
    )).toISOString().slice(0, 10);
    const rangeEnd = new Date(Date.UTC(
      reportDate.getUTCFullYear(),
      reportDate.getUTCMonth() + 1,
      0
    )).toISOString().slice(0, 10);
    const range = `start_date=${rangeStart}&end_date=${rangeEnd}`;
    const overview = await jsonRequest(
      baseUrl,
      `/api/analytics/overview?${range}`,
      { token: TOKENS.analytics }
    );
    assert.equal(overview.status, 200);
    assert.equal(overview.body.data.total_orders, 1);
    assert.equal(overview.body.data.total_revenue, 50);
    assert.equal(overview.body.data.shipped_orders, 1);

    const topProducts = await jsonRequest(
      baseUrl,
      `/api/analytics/top-products?${range}&limit=5`,
      { token: TOKENS.analytics }
    );
    assert.equal(topProducts.status, 200);
    assert.equal(topProducts.body.data[0].quantity_sold, 2);
    assert.equal(topProducts.body.data[0].sales_amount, 50);

    const financialRows = await jsonRequest(
      baseUrl,
      `/api/analytics/reconciliation?${range}&payment_status=%E6%9C%AA%E4%BB%98%E6%AC%BE&shipping_status=%E5%B7%B2%E5%87%BA%E8%B2%A8`,
      { token: TOKENS.analytics }
    );
    assert.equal(financialRows.status, 200);
    assert.equal(financialRows.body.data.rows[0].order_id, orderId);
  });
});

test('checkout reports unapplied database migrations as service unavailable', async () => {
  const store = createStore();
  store.failNextOrderInsert = true;

  await withServer(createApplication(store), async baseUrl => {
    const response = await jsonRequest(baseUrl, '/api/orders', {
      method: 'POST',
      body: {
        customer_phone: '85212345678',
        totalAmount: 25,
        items: [{ product_id: 51, quantity: 1 }]
      }
    });

    assert.equal(response.status, 503);
    assert.equal(response.body.success, false);
    assert.match(response.body.message, /結帳庫存 migration/);
    assert.equal(store.orders.length, 0);
    assert.equal(store.orderItems.length, 0);
  });
});

test('WhatsApp webhook verifies Meta challenge and signature before processing messages', async () => {
  const store = createStore();
  const orderId = 'e1da0bac-9021-4e87-920b-2f5bf5381f32';
  const order = {
    order_id: orderId,
    customer_phone: '85212345678',
    order_date: new Date().toISOString(),
    total_amount: 50,
    payment_status: '未付款',
    shipping_status: '待到貨'
  };
  store.orders.push(order);
  const app = createApplication(store);

  await withServer(app, async baseUrl => {
    const verification = await fetch(
      `${baseUrl}/api/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=${TOKENS.webhookVerify}&hub.challenge=challenge-abc`
    );
    assert.equal(verification.status, 200);
    assert.equal(await verification.text(), 'challenge-abc');

    const invalidVerification = await fetch(
      `${baseUrl}/api/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=challenge-abc`
    );
    assert.equal(invalidVerification.status, 403);

    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          value: {
            messages: [{
              id: 'wamid.lookup-1',
              from: '+85212345678',
              type: 'text',
              text: { body: `查詢訂單 ${orderId}` }
            }]
          }
        }]
      }]
    };
    const rawBody = JSON.stringify(payload);
    const unauthorized = await fetch(`${baseUrl}/api/webhook/whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': 'sha256=invalid' },
      body: rawBody
    });
    assert.equal(unauthorized.status, 401);

    const accepted = await fetch(`${baseUrl}/api/webhook/whatsapp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': createSignature(rawBody)
      },
      body: rawBody
    });
    const result = await accepted.json();
    assert.equal(accepted.status, 200);
    assert.equal(result.success, true);
    assert.equal(result.data.processed_count, 1);
    assert.equal(store.whatsappMessages.at(-1).to, '85212345678');
    assert.match(store.whatsappMessages.at(-1).text, new RegExp(`訂單 #${orderId}`));
  });
});

test('WhatsApp payment reports remain pending manual verification and are idempotent', async () => {
  const store = createStore();
  const orderId = '8aaf1bf3-57a6-4ed4-bc77-5ea46dfc72f2';
  store.orders.push({
    order_id: orderId,
    customer_phone: '85212345678',
    order_date: new Date().toISOString(),
    total_amount: 50,
    payment_status: '未付款',
    shipping_status: '待到貨'
  });
  const app = createApplication(store);

  await withServer(app, async baseUrl => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          value: {
            messages: [{
              id: 'wamid.payment-1',
              from: '85212345678',
              type: 'text',
              text: { body: `付款回報 ${orderId} TX-REF-880` }
            }]
          }
        }]
      }]
    };
    const rawBody = JSON.stringify(payload);
    const response = await fetch(`${baseUrl}/api/webhook/whatsapp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': createSignature(rawBody)
      },
      body: rawBody
    });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.data.results[0].action, 'payment_report');
    assert.equal(store.paymentReports.get('wamid.payment-1').status, '待核實');
    assert.equal(store.orders[0].payment_status, '未付款');
    assert.match(store.whatsappMessages.at(-1).text, /仍待管理員核實/);
  });
});

test('WhatsApp webhook catches Supabase failures and accepts status callbacks without outbound config', async () => {
  const app = express();
  app.use(express.json({
    verify(req, res, buffer) {
      req.rawBody = Buffer.from(buffer);
    }
  }));
  app.use('/api/webhook', createWebhookRouter({
    rpc: async () => ({ data: null, error: { code: 'XX000' } })
  }, {
    verifyToken: TOKENS.webhookVerify,
    appSecret: TOKENS.webhookAppSecret,
    writeEnabled: true,
    sendWhatsApp: async () => {}
  }));

  await withServer(app, async baseUrl => {
    const messagePayload = {
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          value: {
            messages: [{
              id: 'wamid.db-error',
              from: '85212345678',
              type: 'text',
              text: { body: '查詢訂單 e1da0bac-9021-4e87-920b-2f5bf5381f32' }
            }]
          }
        }]
      }]
    };
    const messageBody = JSON.stringify(messagePayload);
    const failed = await fetch(`${baseUrl}/api/webhook/whatsapp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': createSignature(messageBody)
      },
      body: messageBody
    });
    const failedBody = await failed.json();
    assert.equal(failed.status, 500);
    assert.equal(failedBody.success, false);
    assert.equal(typeof failedBody.message, 'string');

  });

  const statusApp = express();
  statusApp.use(express.json({
    verify(req, res, buffer) {
      req.rawBody = Buffer.from(buffer);
    }
  }));
  statusApp.use('/api/webhook', createWebhookRouter({
    rpc: async () => {
      throw new Error('Status callbacks must not query the database.');
    }
  }, {
    verifyToken: TOKENS.webhookVerify,
    appSecret: TOKENS.webhookAppSecret,
    writeEnabled: true
  }));

  await withServer(statusApp, async baseUrl => {
    const statusPayload = {
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          value: {
            statuses: [{ id: 'wamid.status-update', status: 'delivered' }]
          }
        }]
      }]
    };
    const statusBody = JSON.stringify(statusPayload);
    const accepted = await fetch(`${baseUrl}/api/webhook/whatsapp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': createSignature(statusBody)
      },
      body: statusBody
    });
    const acceptedBody = await accepted.json();
    assert.equal(accepted.status, 200);
    assert.equal(acceptedBody.data.processed_count, 0);
  });
});

```

---

### File: `tests\error-handler.test.js`

```
'use strict';

require('express-async-errors');

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const { apiNotFound, errorHandler } = require('../middleware/error-handler');

async function withServer(app, run) {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
}

function responseShape(body) {
  assert.deepEqual(Object.keys(body).sort(), ['data', 'message', 'success']);
  assert.equal(body.success, false);
  assert.equal(body.data, null);
  assert.equal(typeof body.message, 'string');
}

test('central handler returns a structured error for rejected async route handlers', async () => {
  const app = express();
  app.set('env', 'production');
  app.get('/api/failure', async (req, res) => {
    await Promise.resolve();
    throw new Error('private database detail');
  });
  app.use('/api', apiNotFound);
  app.use(errorHandler);

  await withServer(app, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/failure`);
    const body = await response.json();
    assert.equal(response.status, 500);
    responseShape(body);
    assert.equal(JSON.stringify(body).includes('private database detail'), false);
    assert.equal(JSON.stringify(body).includes('stack'), false);
  });
});

test('central handler formats malformed JSON and unknown API routes consistently', async () => {
  const app = express();
  app.use(express.json());
  app.post('/api/echo', (req, res) => res.json({ success: true, data: req.body, message: 'ok' }));
  app.use('/api', apiNotFound);
  app.use(errorHandler);

  await withServer(app, async baseUrl => {
    const malformed = await fetch(`${baseUrl}/api/echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"incomplete":'
    });
    assert.equal(malformed.status, 400);
    responseShape(await malformed.json());

    const missing = await fetch(`${baseUrl}/api/not-found`);
    assert.equal(missing.status, 404);
    responseShape(await missing.json());
  });
});

```

---

### File: `tests\health.test.js`

```
const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'https://health-test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'health-test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'health-test-service-role-key';
process.env.CUSTOMER_LOOKUP_RATE_SECRET = 'health-test-rate-limit-secret-with-more-than-32-characters';

const app = require('../index');

test('GET /health returns a cache-disabled liveness response', async () => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(body).sort(), ['status', 'timestamp']);
    assert.equal(body.status, 'ok');
    assert.equal(Number.isNaN(Date.parse(body.timestamp)), false);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(
      response.headers.get('referrer-policy'),
      'strict-origin-when-cross-origin'
    );
    assert.equal(response.headers.get('x-powered-by'), null);
    assert.equal(response.headers.get('content-security-policy'), null);
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
});

test('production API errors do not return stack traces or database internals', async () => {
  const previousEnvironment = app.get('env');
  app.set('env', 'production');
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"invalid":'
    });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.success, false);
    assert.equal(body.data, null);
    assert.equal(typeof body.message, 'string');
    assert.equal(JSON.stringify(body).includes('SyntaxError'), false);
    assert.equal(JSON.stringify(body).includes('stack'), false);
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
    app.set('env', previousEnvironment);
  }
});

```

---

### File: `tests\insert-test-data.js`

```
const { createClient } = require('@supabase/supabase-js');

// 請換成你自己的 Supabase 網址與 Anon Key
const supabaseUrl = 'YOUR_SUPABASE_URL';
const supabaseKey = 'YOUR_SUPABASE_ANON_KEY';
const supabase = createClient(supabaseUrl, supabaseKey);

async function insertTestData() {
  console.log('正在插入測試商品...');
  
  // 插入範例商品
  const { data: productData, error: productError } = await supabase
    .from('products')
    .insert([
      { name: 'LittlePlanet 環保水樽', price: 150, stock: 50 },
      { name: 'LittlePlanet 多功能收納袋', price: 120, stock: 30 }
    ])
    .select();

  if (productError) {
    console.error('插入商品失敗:', productError);
    return;
  }
  console.log('商品插入成功:', productData);

  console.log('正在插入測試訂單...');
  // 插入範例訂單
  const { data: orderData, error: orderError } = await supabase
    .from('orders')
    .insert([
      { customer_name: '測試買家', phone: '91234567', total_amount: 150, status: 'pending' }
    ])
    .select();

  if (orderError) {
    console.error('插入訂單失敗:', orderError);
    return;
  }
  console.log('訂單插入成功:', orderData);
  console.log('所有測試資料已成功注入！');
}

insertTestData();
```

---

### File: `tests\orders.test.js`

```
const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const createOrdersRouter = require('../routes/orders');

const ORDER_UUID = 'e1da0bac-9021-4e87-920b-2f5bf5381f32';

async function withServer(router, run) {
  const app = express();
  app.use(express.json());
  app.use('/api/orders', router);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
}

async function postOrder(baseUrl, body) {
  const response = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

const validOrder = {
  customer_phone: '+85212345678',
  items: [
    { product_id: 51, quantity: 1 },
    { product_id: '51', quantity: 2 }
  ]
};

test('checkout merges duplicate products and returns server-calculated UUID order', async () => {
  let rpcCall;
  await withServer(createOrdersRouter({
    rpc: async (name, args) => {
      rpcCall = { name, args };
      return {
        data: {
          order_id: ORDER_UUID,
          total_amount: 75,
          items: [{ product_id: 51, quantity: 3, unit_price: 25 }]
        },
        error: null
      };
    }
  }), async baseUrl => {
    const response = await postOrder(baseUrl, {
      ...validOrder,
      totalAmount: 0
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.order_id, ORDER_UUID);
    assert.equal(response.body.data.total_amount, 75);
  });

  assert.equal(rpcCall.name, 'create_customer_order');
  assert.equal(rpcCall.args.p_customer_phone, '85212345678');
  assert.deepEqual(rpcCall.args.p_items, [{ product_id: '51', quantity: 3 }]);
});

test('stock conflict is surfaced without a success-shaped fallback', async () => {
  await withServer(createOrdersRouter({
    rpc: async () => ({
      data: null,
      error: {
        code: 'P0001',
        message: 'STOCK_UNAVAILABLE',
        details: JSON.stringify({ product_id: '51', requested: 3, available: 1 })
      }
    })
  }), async baseUrl => {
    const response = await postOrder(baseUrl, validOrder);
    assert.equal(response.status, 409);
    assert.equal(response.body.success, false);
    assert.equal(response.body.code, 'STOCK_UNAVAILABLE');
    assert.deepEqual(response.body.data, { product_id: '51', requested: 3, available: 1 });
  });
});

test('invalid checkout data and missing service role never call the RPC', async () => {
  let calls = 0;
  const supabase = {
    rpc: async () => {
      calls += 1;
      return { data: null, error: null };
    }
  };

  await withServer(createOrdersRouter(supabase), async baseUrl => {
    for (const body of [
      { ...validOrder, customer_phone: 'bad' },
      { ...validOrder, items: [{ product_id: 51, quantity: 0 }] },
      { ...validOrder, items: [{ product_id: 'not-an-id', quantity: 1 }] },
      { ...validOrder, items: [{ product_id: 51, quantity: '1' }] },
      { ...validOrder, items: [{ product_id: 51, quantity: true }] }
    ]) {
      const response = await postOrder(baseUrl, body);
      assert.equal(response.status, 400);
      assert.equal(response.body.success, false);
    }
  });
  assert.equal(calls, 0);

  await withServer(createOrdersRouter(supabase, { serviceRoleAvailable: false }), async baseUrl => {
    const response = await postOrder(baseUrl, validOrder);
    assert.equal(response.status, 503);
    assert.equal(response.body.success, false);
    assert.equal(response.body.code, 'CHECKOUT_NOT_CONFIGURED');
    assert.match(response.body.message, /SUPABASE_SERVICE_ROLE_KEY/);
  });
  assert.equal(calls, 0);
});

```

---

### File: `tests\products.test.js`

```
const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const createProductsRouter = require('../routes/products');

const ADMIN_TOKEN = 'product-stock-admin-token-for-tests-000000';

async function withServer(router, run) {
  const app = express();
  app.use(express.json());
  app.use('/api/products', router);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
}

async function request(baseUrl, path, options = {}) {
  const headers = {
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    ...(options.body ? { 'Content-Type': 'application/json' } : {})
  };
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  return { status: response.status, body: await response.json() };
}

function createRouter(supabase, options = {}) {
  return createProductsRouter(supabase, {
    adminToken: ADMIN_TOKEN,
    stockWriteEnabled: true,
    ...options
  });
}

function createProductsQuery(rows) {
  const filters = [];
  const query = {
    select() {
      return query;
    },
    eq(column, value) {
      filters.push(row => row[column] === value);
      return query;
    },
    then(resolve, reject) {
      return Promise.resolve({
        data: rows.filter(row => filters.every(filter => filter(row))),
        error: null
      }).then(resolve, reject);
    }
  };
  return query;
}

test('products endpoint reads stock and retains category and status filtering', async () => {
  const rows = [
    { id: '4c260c94-2cb3-4de4-a71e-5b0f5cf53d87', name: '星球筆記本', category: '文具', status: '已到貨', stock: 12 },
    { id: '4c260c94-2cb3-4de4-a71e-5b0f5cf53d88', name: '星球公仔', category: '公仔', status: '已到貨', stock: 4 }
  ];
  const router = createRouter({
    from(table) {
      assert.equal(table, 'products');
      return createProductsQuery(rows);
    }
  });

  await withServer(router, async baseUrl => {
    const all = await request(baseUrl, '/api/products');
    assert.equal(all.status, 200);
    assert.equal(all.body.data[0].stock, 12);

    const filtered = await request(baseUrl, '/api/products?category=%E6%96%87%E5%85%B7&status=%E5%B7%B2%E5%88%B0%E8%B2%A8');
    assert.equal(filtered.status, 200);
    assert.equal(filtered.body.data.length, 1);
    assert.equal(filtered.body.data[0].stock, 12);
  });
});

test('stock update requires admin authorization and service role, then returns persisted stock', async () => {
  const rpcCalls = [];
  const router = createRouter({
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      return {
        data: {
          success: true,
          product_id: args.p_product_id,
          stock: args.p_stock,
          status: '已到貨'
        },
        error: null
      };
    }
  });

  await withServer(router, async baseUrl => {
    const path = '/api/products/4c260c94-2cb3-4de4-a71e-5b0f5cf53d87/stock';
    const unauthorized = await request(baseUrl, path, {
      method: 'PATCH',
      body: { stock: 20 }
    });
    assert.equal(unauthorized.status, 401);

    const updated = await request(baseUrl, path, {
      method: 'PATCH',
      token: ADMIN_TOKEN,
      body: { stock: 20 }
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.stock, 20);
  });

  assert.deepEqual(rpcCalls, [{
    name: 'set_product_stock',
    args: {
      p_product_id: '4c260c94-2cb3-4de4-a71e-5b0f5cf53d87',
      p_stock: 20
    }
  }]);
});

test('stock update validates product ID and stock without calling Supabase', async () => {
  let rpcCalls = 0;
  const router = createRouter({
    rpc: async () => {
      rpcCalls += 1;
      return { data: null, error: null };
    }
  });

  await withServer(router, async baseUrl => {
    for (const [path, stock] of [
      ['/api/products/not-a-product-id/stock', 5],
      ['/api/products/7/stock', -1],
      ['/api/products/7/stock', 1.5],
      ['/api/products/7/stock', '01'],
      ['/api/products/7/stock', '5'],
      ['/api/products/7/stock', true]
    ]) {
      const invalid = await request(baseUrl, path, {
        method: 'PATCH',
        token: ADMIN_TOKEN,
        body: { stock }
      });
      assert.equal(invalid.status, 400);
    }
  });

  assert.equal(rpcCalls, 0);
});

test('stock update surfaces missing migration, missing product and unexpected Supabase errors', async () => {
  for (const [error, expectedStatus] of [
    [{ code: 'PGRST202' }, 503],
    [{ code: 'P0002' }, 404],
    [{ code: 'XX000' }, 500]
  ]) {
    const router = createRouter({
      rpc: async () => ({ data: null, error })
    });
    await withServer(router, async baseUrl => {
      const response = await request(
        baseUrl,
        '/api/products/7/stock',
        { method: 'PATCH', token: ADMIN_TOKEN, body: { stock: 3 } }
      );
      assert.equal(response.status, expectedStatus);
      assert.equal(response.body.success, false);
    });
  }
});

test('stock update fails closed if service role or admin token is unavailable', async () => {
  const supabase = {
    rpc: async () => {
      throw new Error('RPC must not be called while writes are disabled.');
    }
  };
  const router = createRouter(supabase, {
    adminToken: '',
    stockWriteEnabled: false
  });

  await withServer(router, async baseUrl => {
    const response = await request(baseUrl, '/api/products/7/stock', {
      method: 'PATCH',
      body: { stock: 3 }
    });
    assert.equal(response.status, 503);
  });
});

```

---

### File: `tests\security.test.js`

```
const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const createApiProtection = require('../middleware/api-protection');

async function withServer(middleware, run) {
  const app = express();
  app.set('trust proxy', false);
  app.use('/api', middleware);
  app.get('/api/ping', (req, res) => res.json({ success: true }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
}

test('API protection rate limits requests and returns retry metadata', async () => {
  const middleware = createApiProtection({ windowMs: 60000, maxRequests: 2 });
  await withServer(middleware, async baseUrl => {
    const first = await fetch(`${baseUrl}/api/ping`);
    const second = await fetch(`${baseUrl}/api/ping`);
    const limited = await fetch(`${baseUrl}/api/ping`);
    const body = await limited.json();

    assert.equal(first.status, 200);
    assert.equal(first.headers.get('ratelimit-limit'), '2');
    assert.equal(second.status, 200);
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after') !== null, true);
    assert.equal(body.success, false);
    assert.equal(body.data, null);
  });
});

test('API CORS allows same-origin and configured origins, rejects others', async () => {
  const middleware = createApiProtection({
    allowedOrigins: ['https://shop.example.com']
  });
  await withServer(middleware, async baseUrl => {
    const sameOrigin = await fetch(`${baseUrl}/api/ping`, {
      headers: { Origin: baseUrl }
    });
    assert.equal(sameOrigin.status, 200);
    assert.equal(sameOrigin.headers.get('access-control-allow-origin'), baseUrl);

    const configured = await fetch(`${baseUrl}/api/ping`, {
      headers: { Origin: 'https://shop.example.com' }
    });
    assert.equal(configured.status, 200);
    assert.equal(configured.headers.get('access-control-allow-origin'), 'https://shop.example.com');

    const blocked = await fetch(`${baseUrl}/api/ping`, {
      headers: { Origin: 'https://attacker.example' }
    });
    assert.equal(blocked.status, 403);
    assert.equal((await blocked.json()).success, false);

    const preflight = await fetch(`${baseUrl}/api/ping`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://shop.example.com',
        'Access-Control-Request-Method': 'POST'
      }
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-methods'), 'GET, POST, PATCH, OPTIONS');
  });
});

```

---

### File: `tests\sensitive-rate-limits.test.js`

```
'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const createSensitiveRateLimiters = require('../middleware/sensitive-rate-limits');

test('sensitive rate limiter returns a structured 429 response', async () => {
  const app = express();
  app.set('trust proxy', false);
  const limiters = createSensitiveRateLimiters({
    windowMs: 60000,
    checkoutMax: 1
  });
  app.post('/api/orders', limiters.checkout, (req, res) => {
    res.json({ success: true, data: null, message: 'ok' });
  });

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const url = `http://127.0.0.1:${port}/api/orders`;
    const first = await fetch(url, { method: 'POST' });
    const second = await fetch(url, { method: 'POST' });
    const body = await second.json();

    assert.equal(first.status, 200);
    assert.equal(second.status, 429);
    assert.equal(body.success, false);
    assert.equal(body.data, null);
    assert.equal(typeof body.message, 'string');
    assert.notEqual(second.headers.get('retry-after'), null);
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
});

```

---

### File: `tests\shipping.test.js`

```
const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const createShippingRouter = require('../routes/shipping');
const createOrdersRouter = require('../routes/orders');

const ADMIN_TOKEN = '0123456789abcdef0123456789abcdef';

async function withServer(router, run, mountPath = '/api/shipping') {
  const app = express();
  app.use(express.json());
  app.use(mountPath, router);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
}

async function request(baseUrl, path, options = {}) {
  const headers = {
    Authorization: `Bearer ${ADMIN_TOKEN}`,
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {})
  };
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  return { status: response.status, body: await response.json() };
}

function createRouter(supabase, options = {}) {
  return createShippingRouter(supabase, {
    adminToken: ADMIN_TOKEN,
    writeEnabled: true,
    ...options
  });
}

function createTableClient(tables) {
  return {
    from(tableName) {
      const state = {
        rows: tables[tableName] || [],
        filters: []
      };
      const query = {
        select() {
          return query;
        },
        eq(column, value) {
          state.filters.push(row => row[column] === value);
          return query;
        },
        in(column, values) {
          const selected = new Set(values.map(String));
          state.filters.push(row => selected.has(String(row[column])));
          return query;
        },
        order() {
          return query;
        },
        limit() {
          return query;
        },
        then(resolve, reject) {
          return Promise.resolve({
            data: state.rows.filter(row => state.filters.every(filter => filter(row))),
            error: null
          }).then(resolve, reject);
        }
      };
      return query;
    }
  };
}

test('read-only table fallback returns order and product pick lists but blocks shipment writes', async () => {
  const router = createRouter(createTableClient({
    orders: [{
      order_id: 'f6d0d17c-60a4-4434-a704-7f68456c0bf2',
      order_date: '2026-09-20T10:00:00+08:00',
      customer_phone: '85212345678',
      shipping_method: '順豐',
      tracking_number: null,
      shipping_status: '可出貨'
    }],
    order_items: [{
      item_id: '56a3da12-3340-4b24-8373-b2bf59f49f5b',
      order_id: 'f6d0d17c-60a4-4434-a704-7f68456c0bf2',
      product_id: 'a56c1af6-82a4-4cdf-9176-08fb268aca43',
      quantity: 2,
      item_status: '已到貨倉'
    }],
    products: [{
      id: 'a56c1af6-82a4-4cdf-9176-08fb268aca43',
      name: '星球筆記本'
    }]
  }), { readEnabled: true, writeEnabled: false });

  await withServer(router, async baseUrl => {
    const byOrder = await request(baseUrl, '/api/shipping/pick-list?group_by=order');
    assert.equal(byOrder.status, 200);
    assert.equal(byOrder.body.data[0].order_id, 'f6d0d17c-60a4-4434-a704-7f68456c0bf2');
    assert.equal(byOrder.body.data[0].items[0].product_name, '星球筆記本');

    const byProduct = await request(baseUrl, '/api/shipping/pick-list?group_by=product');
    assert.equal(byProduct.status, 200);
    assert.equal(byProduct.body.data[0].total_quantity, 2);
    assert.equal(byProduct.body.data[0].orders[0].order_id, 'f6d0d17c-60a4-4434-a704-7f68456c0bf2');

    const blockedWrite = await request(baseUrl, '/api/shipping/anything/ship', {
      method: 'POST',
      body: { shipping_method: '順豐', tracking_number: 'SF12345678' }
    });
    assert.equal(blockedWrite.status, 503);
  });
});

test('pick list supports order and product grouping and validates group_by', async () => {
  const calls = [];
  const router = createRouter({
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: [{ order_id: 15 }], error: null };
    }
  });

  await withServer(router, async baseUrl => {
    const byOrder = await request(baseUrl, '/api/shipping/pick-list?group_by=order');
    assert.equal(byOrder.status, 200);
    assert.equal(byOrder.body.success, true);
    const byProduct = await request(baseUrl, '/api/shipping/pick-list?group_by=product');
    assert.equal(byProduct.status, 200);
    const invalid = await request(baseUrl, '/api/shipping/pick-list?group_by=customer');
    assert.equal(invalid.status, 400);
  });

  assert.deepEqual(calls, [
    { name: 'get_shipping_pick_list', args: { p_group_by: 'order' } },
    { name: 'get_shipping_pick_list', args: { p_group_by: 'product' } }
  ]);
});

test('shipping updates atomically and sends a WhatsApp notification', async () => {
  const calls = [];
  const sent = [];
  const supabase = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === 'ship_order') {
        return { data: { success: true, shipment: { order_id: 29 } }, error: null };
      }
      if (name === 'claim_shipping_notification') {
        return {
          data: {
            claimed: true,
            status: 'sending',
            customer_phone: '85212345678',
            shipping_method: '順豐',
            tracking_number: 'SF1000'
          },
          error: null
        };
      }
      return { data: { status: 'sent' }, error: null };
    }
  };
  const router = createRouter(supabase, {
    sendWhatsApp: async message => sent.push(message)
  });

  await withServer(router, async baseUrl => {
    const response = await request(baseUrl, '/api/shipping/29/ship', {
      method: 'POST',
      body: {
        shipping_method: '順豐',
        tracking_number: 'SF1000'
      }
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.notification.status, 'sent');
  });

  assert.deepEqual(calls, [
    {
      name: 'ship_order',
      args: {
        p_order_id: '29',
        p_shipping_method: '順豐',
        p_tracking_number: 'SF1000',
        p_customer_phone: null
      }
    },
    { name: 'claim_shipping_notification', args: { p_order_id: '29' } },
    {
      name: 'finish_shipping_notification',
      args: {
        p_order_id: '29',
        p_success: true,
        p_error_message: null
      }
    }
  ]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, '85212345678');
  assert.match(sent[0].text, /SF1000/);
});

test('shipping route accepts UUID order IDs used by the production database', async () => {
  const orderId = 'f6d0d17c-60a4-4434-a704-7f68456c0bf2';
  const calls = [];
  const router = createRouter({
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === 'ship_order') {
        return { data: { success: true, shipment: { order_id: orderId } }, error: null };
      }
      if (name === 'claim_shipping_notification') {
        return { data: { claimed: false, status: 'sent' }, error: null };
      }
      return { data: { status: 'sent' }, error: null };
    }
  });

  await withServer(router, async baseUrl => {
    const response = await request(baseUrl, `/api/shipping/${orderId}/ship`, {
      method: 'POST',
      body: { shipping_method: '順豐', tracking_number: 'SF-UUID-001' }
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
  });

  assert.equal(calls[0].name, 'ship_order');
  assert.equal(calls[0].args.p_order_id, orderId);
  assert.equal(calls[1].name, 'claim_shipping_notification');
  assert.equal(calls[1].args.p_order_id, orderId);
});

test('shipping notification RPC exceptions do not hide a completed shipment', async () => {
  for (const failingRpc of ['claim_shipping_notification', 'finish_shipping_notification']) {
    const router = createRouter({
      rpc: async (name, args) => {
        if (name === 'ship_order') {
          return { data: { success: true, shipment: { order_id: '31' } }, error: null };
        }
        if (name === failingRpc) {
          throw new Error(`${name} unavailable`);
        }
        if (name === 'claim_shipping_notification') {
          return {
            data: {
              claimed: true,
              status: 'sending',
              customer_phone: '85212345678',
              shipping_method: '順豐',
              tracking_number: 'SF-31'
            },
            error: null
          };
        }
        return { data: { status: 'sent' }, error: null };
      }
    }, {
      sendWhatsApp: async () => {}
    });

    await withServer(router, async baseUrl => {
      const response = await request(baseUrl, '/api/shipping/31/ship', {
        method: 'POST',
        body: { shipping_method: '順豐', tracking_number: 'SF-31' }
      });
      assert.equal(response.status, 200);
      assert.equal(response.body.success, true);
      assert.equal(response.body.data.notification.success, false);
      assert.ok(response.body.data.notification.message);
    });
  }
});

test('WhatsApp failure remains explicit and can be retried', async () => {
  let attempt = 0;
  const recorded = [];
  const supabase = {
    rpc: async (name, args) => {
      recorded.push({ name, args });
      if (name === 'ship_order') {
        return { data: { success: true }, error: null };
      }
      if (name === 'claim_shipping_notification') {
        attempt += 1;
        return {
          data: {
            claimed: true,
            status: 'sending',
            customer_phone: '85212345678',
            shipping_method: '京東',
            tracking_number: 'JD007'
          },
          error: null
        };
      }
      return { data: { status: args.p_success ? 'sent' : 'failed' }, error: null };
    }
  };
  const router = createRouter(supabase, {
    sendWhatsApp: async () => {
      if (attempt === 1) {
        throw new Error('WhatsApp unavailable');
      }
    }
  });

  await withServer(router, async baseUrl => {
    const shipped = await request(baseUrl, '/api/shipping/30/ship', {
      method: 'POST',
      body: { shipping_method: '京東', tracking_number: 'JD007' }
    });
    assert.equal(shipped.status, 200);
    assert.equal(shipped.body.success, true);
    assert.equal(shipped.body.data.notification.success, false);

    const retried = await request(baseUrl, '/api/shipping/30/notification/retry', {
      method: 'POST'
    });
    assert.equal(retried.status, 200);
    assert.equal(retried.body.success, true);
  });

  assert.equal(recorded.filter(call => call.name === 'claim_shipping_notification').length, 2);
  const finishCalls = recorded.filter(call => call.name === 'finish_shipping_notification');
  assert.equal(finishCalls[0].args.p_success, false);
  assert.equal(finishCalls[1].args.p_success, true);
});

test('admin token, service role, and shipment input are enforced', async () => {
  let rpcCalls = 0;
  const router = createRouter({
    rpc: async () => {
      rpcCalls += 1;
      return { data: { success: true }, error: null };
    }
  });

  await withServer(router, async baseUrl => {
    const unauthorized = await request(baseUrl, '/api/shipping/pick-list', {
      headers: { Authorization: 'Bearer wrong' }
    });
    assert.equal(unauthorized.status, 401);

    const invalidMethod = await request(baseUrl, '/api/shipping/4/ship', {
      method: 'POST',
      body: { shipping_method: 'Unknown', tracking_number: 'ABC' }
    });
    assert.equal(invalidMethod.status, 400);

    const invalidTracking = await request(baseUrl, '/api/shipping/4/ship', {
      method: 'POST',
      body: { shipping_method: '順豐', tracking_number: '' }
    });
    assert.equal(invalidTracking.status, 400);
  });
  assert.equal(rpcCalls, 0);

  await withServer(createShippingRouter({ rpc: async () => ({ data: [], error: null }) }, {
    adminToken: ADMIN_TOKEN,
    writeEnabled: false
  }), async baseUrl => {
    const response = await request(baseUrl, '/api/shipping/pick-list');
    assert.equal(response.status, 503);
    assert.equal(response.body.success, false);
  });

  await withServer(createShippingRouter({ rpc: async () => ({ data: [], error: null }) }, {
    adminToken: 'replace-with-another-long-random-secret',
    writeEnabled: true
  }), async baseUrl => {
    const response = await request(baseUrl, '/api/shipping/pick-list');
    assert.equal(response.status, 503);
    assert.equal(response.body.success, false);
  });
});

test('RPC errors and unexpected pick-list payloads are not returned as success', async () => {
  await withServer(createRouter({
    rpc: async () => ({ data: null, error: { code: 'PGRST202' } })
  }), async baseUrl => {
    const missingMigration = await request(baseUrl, '/api/shipping/pick-list');
    assert.equal(missingMigration.status, 503);
    assert.equal(missingMigration.body.success, false);
  });

  await withServer(createRouter({
    rpc: async () => ({ data: null, error: { code: 'XX000' } })
  }), async baseUrl => {
    const dbError = await request(baseUrl, '/api/shipping/pick-list');
    assert.equal(dbError.status, 500);
    assert.equal(dbError.body.success, false);
  });

  await withServer(createRouter({
    rpc: async () => ({ data: { not: 'an array' }, error: null })
  }), async baseUrl => {
    const invalidPayload = await request(baseUrl, '/api/shipping/pick-list');
    assert.equal(invalidPayload.status, 500);
    assert.equal(invalidPayload.body.success, false);
  });
});

test('checkout requires a WhatsApp contact number before database operations', async () => {
  let databaseCalls = 0;
  const supabase = {
    from: () => {
      databaseCalls += 1;
      throw new Error('Database should not be called for invalid phone input.');
    }
  };

  await withServer(createOrdersRouter(supabase), async baseUrl => {
    const missingPhone = await request(baseUrl, '/api/orders', {
      method: 'POST',
      body: {
        totalAmount: 5,
        items: [{ product_id: 1, quantity: 1 }]
      }
    });
    assert.equal(missingPhone.status, 400);
    assert.equal(missingPhone.body.success, false);

    const invalidPhone = await request(baseUrl, '/api/orders', {
      method: 'POST',
      body: {
        customer_phone: 'abc',
        totalAmount: 5,
        items: [{ product_id: 1, quantity: 1 }]
      }
    });
    assert.equal(invalidPhone.status, 400);
    assert.equal(invalidPhone.body.success, false);
  }, '/api/orders');

  assert.equal(databaseCalls, 0);
});

```

---

