# LittlePlanet Production Deployment

## 1. Production checklist

- Use Node.js 22 or later. The installed Supabase client dependency requires a current Node runtime.
- Keep the repository and production service on the same Node version; the service start command is `npm start`.
- Configure all secrets in the cloud provider's environment-variable settings. Never commit `.env`, Supabase service-role keys, Meta tokens, or admin tokens.
- `SUPABASE_SERVICE_ROLE_KEY` is required in production. The server refuses to start without it because checkout, inventory, shipping, and customer lookup require privileged server-side database access.
- Set a unique random secret of at least 32 characters for `CUSTOMER_LOOKUP_RATE_SECRET`, `CUSTOMER_SESSION_SECRET`, `SHIPPING_ADMIN_TOKEN`, `INBOUND_ADMIN_TOKEN`, `ANALYTICS_ADMIN_TOKEN`, `PRODUCT_ADMIN_TOKEN`, `REVIEWS_ADMIN_TOKEN`, and `REMINDER_CRON_TOKEN`. Do not reuse one secret for multiple features.
- Set `ADMIN_SESSION_SECRET` to a separate random secret of at least 32 bytes. Production startup requires it to sign admin sessions.
- Admin login accepts the configured shipping, product, analytics, inbound, and reviews admin tokens, then issues an 8-hour signed session cookie scoped to the matched operations. The cookie is `HttpOnly`, `SameSite=Strict`, and `Secure` in production; state-changing requests using it must carry a same-origin `Origin` header. The browser UI does not store or resend the raw admin token. Product review moderation requires the separate `reviews` session scope.
- The admin session is stateless and signed. Logging out clears the browser cookie; to revoke an already copied cookie immediately, rotate `ADMIN_SESSION_SECRET`. Otherwise the session expires within eight hours.
- Customer membership verification requires a phone number plus an existing order UUID as proof of ownership; phone number alone never grants access to order history. It issues a separate 24-hour HttpOnly, SameSite=Strict cookie (Secure in production), signed with `CUSTOMER_SESSION_SECRET`. The customer page does not store bearer tokens in browser storage.
- Configure Meta WhatsApp variables only when WhatsApp sending/webhook features are enabled.
- Helmet sets baseline security headers. Content Security Policy is not enabled because the current admin page uses inline scripts and styles.
- Express 4 async route rejections are forwarded to a centralized JSON error handler; malformed/oversized JSON and unknown `/api` routes also receive `{ success: false, data: null, message }` responses. Checkout quantities and stock updates require JSON integers, not coercible strings or booleans.
- The API has a global limiter plus stricter per-route limits: checkout and customer lookup allow 10 requests per IP per 15 minutes; customer member verification and payment-proof upload allow 5 requests; member order reads allow 30 requests per IP per 15 minutes; inventory updates, shipping writes, and inbound writes allow 30 per IP per 15 minutes. These in-memory limits are per running instance. Keep the customer lookup's database rate limit enabled; use a shared limiter (for example, a managed Redis service) if the app is scaled across multiple instances.
- Customer review submissions are limited to 5 requests per IP per 15 minutes. Each verified member can review a purchased product once; admin review reads/deletes use the `reviews` session scope.
- Customer wishlist reads are limited to 30 requests per IP per 15 minutes, and wishlist writes to 15 requests per IP per 15 minutes. All wishlist access is scoped to the signed customer session; direct database access is restricted to `service_role`.
- `/health` is a liveness endpoint; it confirms that the process responds, not that Supabase or WhatsApp is reachable.

## Current repository paths

The application entry point is the root `index.js`; Express route modules are in `src/routes/`, middleware is in `src/middleware/`, and shared helpers are in `src/utils/`. Maintenance utilities are in `scripts/`, documentation is in `docs/`, and storefront images are in `public/assets/images/`.

| File | Responsibility |
| --- | --- |
| `src/routes/customer.js` | Customer member endpoints mounted under `/api/customer`. |
| `src/routes/customers.js` | Admin customer CRM endpoints mounted under `/api/admin/customers`. |
| `src/routes/payments.js` | Payment-proof upload and review endpoints; the old `payment-proofs.js` module was renamed. |
| `src/routes/webhooks.js` | WhatsApp and other webhook endpoints; the old `webhook.js` module was renamed. |
| `public/assets/images/` | Public storefront image assets; use this instead of the old `public/image/` path. |

## 2. Configure environment variables

Use [.env.example](../.env.example) as the variable checklist. On Render or Railway, enter values in the service's environment-variable dashboard rather than uploading `.env`.

Required core settings:

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | Set to `production`; enables production startup checks and keeps stack traces out of HTTP error responses. |
| `PORT` | HTTP listener port. The platform normally injects this automatically. |
| `SUPABASE_URL` | Project URL, HTTPS in production. |
| `SUPABASE_ANON_KEY` | Server's public/anon key, used for public reads. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only elevated key. Never expose it to browser code. |
| `CUSTOMER_LOOKUP_RATE_SECRET` | Unique HMAC key of at least 32 characters. |
| `CUSTOMER_SESSION_SECRET` | Separate random signing key (at least 32 bytes) for customer session cookies; required in production. |
| `SHIPPING_ADMIN_TOKEN` | Authorizes shipping administration endpoints. |
| `INBOUND_ADMIN_TOKEN` | Authorizes inbound/reconciliation endpoints. |
| `ANALYTICS_ADMIN_TOKEN` | Authorizes analytics endpoints. |
| `ANALYTICS_PROFIT_DETAILS_ENABLED` | Set to `true` only after verifying `public.order_items` contains `product_id` and `quantity`; defaults to `false` so profit reports do not query an unavailable detail table. |
| `PRODUCT_ADMIN_TOKEN` | Authorizes stock adjustments; currently falls back to `SHIPPING_ADMIN_TOKEN` if omitted. |
| `REVIEWS_ADMIN_TOKEN` | Authorizes product review moderation through the isolated `reviews` admin session scope. |
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
- `WHATSAPP_PAYMENT_RECEIPT_RECIPIENTS`, optional comma-separated internal WhatsApp phone numbers (8–15 digits) that receive submitted payment-proof images for manual review. WhatsApp group delivery is not assumed; configure individual recipients supported by the Cloud API.

The server also accepts `WHATSAPP_ACCESS_TOKEN` as a legacy alias; new deployments should use `WHATSAPP_API_TOKEN`.

Before enabling WhatsApp payment-proof intake, apply
`supabase/migrations/20261023000200_whatsapp_payment_proof_receipts.sql`.
Customers must include the formal order number in the image caption. Uploaded
proofs remain private and pending until an administrator reviews them. Marking
a proof as verified also records the order as paid; the database prevents
shipping any order that is not fully paid.

## Analytics cache and database indexes

Analytics overview, sales trend, top products, reconciliation, summary, and profit responses are cached in process memory for 60 seconds. Cache keys include all validated date, filter, and pagination parameters; failed database responses are never cached. A successful write can therefore take up to 60 seconds to appear in reports. The cache is per application instance and is cleared on restart; use shared Redis caching if the service is scaled and cross-instance consistency is required.

Run [`supabase/diagnostics/performance_review.sql`](../supabase/diagnostics/performance_review.sql) in Supabase SQL Editor to inspect current index definitions, sizes, scan counts, and table sequential scans. Review the results with realistic traffic before adding indexes; indexes consume storage and slow writes.

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
14. `20261003000100_add_order_tracking_status.sql`
15. `20261004000100_add_product_reviews.sql`
16. `20261004000200_add_customer_wishlists.sql`
17. `20261009000100_add_product_categories.sql`
18. `20261009000200_add_product_stock_batches.sql`
19. `20261022000100_add_customer_crm.sql`
20. `20261022000200_payment_proofs_tracking_alerts.sql`
21. `20261022000300_checkout_contact_and_pickup_memory.sql`
22. `20261022000400_tiered_pricing_and_review_moderation.sql`
23. `20261022000500_product_cost_price.sql`
24. `20261022000600_product_image_storage.sql`
25. `20261022000700_smart_inventory_and_bulk_shipping.sql`
26. `20261023000100_whatsapp_order_intents.sql`
27. `20261023000200_whatsapp_payment_proof_receipts.sql`
28. `20261024000100_repair_inventory_adjustment_schema.sql`

The WhatsApp webhook/payment-report schema also uses UUID order IDs, matching production orders and the storefront's order references.

Apply only migrations not already recorded as applied. The repository currently contains the migration SQL files but not a Supabase CLI `config.toml`; do not run `supabase db push` until the CLI project configuration and remote migration history have been deliberately initialized and reviewed. If you use the CLI, link the intended project, verify `supabase migration list --linked`, then push outstanding migrations and verify the list again.

If migrations have previously been applied manually or the remote history does not match the repository, stop and reconcile the migration history with a database administrator before running `db push`; do not blindly repair or reset production history. The recent migrations provide atomic checkout/stock deduction, UUID order lookup plus safe WhatsApp notification status, UUID-based inbound reconciliation, customer-visible order tracking status, and product reviews. The reviews migration adapts its foreign-key type to the existing `products.id`, enables RLS, and grants direct table access only to `service_role`; the server's public read endpoint returns only non-identifying review data.

The product-categories migration creates `public.product_categories`, seeds the existing default categories, and imports distinct non-empty category values already used by products. The table is restricted to the server's `service_role` key; product-category administration therefore also requires `SUPABASE_SERVICE_ROLE_KEY` to be configured.

The product-stock-batches migration creates `public.product_stock_batches` using the existing `products.id` type, records each inbound receipt's nullable `best_before_date` as a PostgreSQL `date`, and extends the receipt RPC so batch insertion, total-stock increase, and inbound order reconciliation commit or roll back together. It removes the old two-argument receipt RPC so an older server cannot bypass batch recording. Existing positive stock is copied into an explicitly marked legacy opening-balance row with an unknown date; no expiry date is inferred. Apply this migration using the same reviewed, one-file-at-a-time procedure above and only if it is not already recorded as applied. The migration is not run by the application or test suite.

Batch remaining quantities currently represent recorded receipt/opening quantities, not post-sale physical balances: checkout, shipment, and stock adjustments update `products.stock` without allocating deductions to a specific batch. The admin UI warns operators of this limitation and keeps the product total as the authoritative stock count. Do not use batch remaining quantities for fulfillment decisions until a batch-allocation policy and workflow are approved.

The customer CRM migration creates the service-role-only `public.customers` table, imports existing order phone numbers, and registers new customers automatically when an order is inserted. Its `list_admin_customers` RPC reports live order counts and spend totals; `/api/admin/customers` and `/api/admin/customers/:id/credit-status` require an admin session with the `customers` scope. The existing shipping/order admin credential receives this scope.

The payment-proof/tracking migration adds `orders.payment_proof_url` (a private Storage object path), `payment_proof_status` (`pending`, `verified`, or `rejected`), and `shipping_carrier`. It creates the private `payment-proofs` Storage bucket for JPG, PNG, and WEBP files up to 5 MB; only server-side service-role operations can upload or read proofs, while the admin list returns short-lived signed image URLs. The existing `orders.payment_status` continues to mean `未付款` / `已付訂金` / `已付清` and is deliberately not reused for proof review. Shipping RPC updates map `順豐` and `京東` to SF Express and Jump Point for public tracking links. The `inbound` admin scope exposes `/api/inbound/expiring` and its 30-day/expired stock dashboard. Deploy the application only after this migration has been reviewed and applied.

The checkout contact/pickup migration adds order recipient and pickup-address fields, stores each opt-in customer's latest contact and shipping details in the service-role-only CRM table, and updates the atomic multi-item checkout RPC without changing its inventory-locking behavior. The storefront remembers details only in the same browser after the customer selects the explicit remember-on-this-device option; it does not disclose server-side CRM data from a phone-number-only lookup. SF Station/locker selections are stored under the existing `順豐` shipping method with the pickup type included in `shipping_address`. Apply this migration after the CRM and payment-proof migrations, then deploy the matching application.

The tiered-pricing/review migration adds validated `products.tier_prices` JSONB and `preorder_deadline`, and replaces the atomic checkout RPC so qualifying quantity tiers are calculated from database prices while inventory is locked. Past-deadline products cannot be checked out. It also adds review order/name/moderation fields, preserves existing reviews as approved, and makes new order-verified reviews pending until an administrator approves them. The admin review scope controls moderation; public review APIs expose only approved comments, display names, and aggregate ratings, never phone numbers. Apply it after all migrations above and before deploying code that edits tier settings, shows timers, or uses moderated ratings.

The product-cost migration adds nullable, non-negative `products.cost_price`. The Analytics-scoped `/api/admin/analytics/profit` report reads quantities and product IDs from `order_items`, then uses each product's current `price` and `cost_price`; it does not depend on `order_items.unit_price`. Overall sales revenue still comes from `orders.total_amount`. If the `order_items` query fails, the endpoint reports order revenue with `details_available: false`, omits the profit ranking, and does not cache the partial result. Changing a product price or cost can therefore affect past per-product analysis because historical item price/cost snapshots are not stored. A null, omitted, or blank cost is treated as zero; sold items whose product record cannot be found remain uncovered, and gross profit/margin are withheld until those records are resolved. Apply it after the tiered-pricing/review migration and before deploying the profit dashboard.

The product-image migration creates the public `product-images` bucket with a 5 MB limit and JPG/PNG/WebP MIME allowlist. Uploads are accepted only by the product-admin API, which checks image signatures before writing with the server-side service role. Apply it before using the admin SOP post generator's image upload.

The smart-inventory migration ensures `orders.order_number` exists, backfills missing human-readable numbers, and creates a case-insensitive unique index before enabling bulk matching. It also adds a reason-required inventory adjustment log and transactional RPCs for delta adjustments and absolute stock updates. The product-admin inventory-alert RPC flags stock at or below three units and products with no order in the last 30 days (new products are excluded); its restock draft targets ten units. The CRM list adds transparent `#熟客VIP` tags at five orders, `#高消費客群` at HK$5,000 spend, and up to two most-purchased product preferences. The shipping-admin bulk-import RPC applies up to 100 order-number/tracking rows through the existing `ship_order` transaction; the entire batch rolls back if any row cannot ship. Apply this migration after the product-image migration and before deploying the related admin features.

The inventory-adjustment repair migration is forward-only: it ensures the adjustment table and grants exist, then replaces the inventory RPCs with text product IDs so both the existing numeric and UUID `products.id` schemas work. Apply it after reviewing remote migration history, especially if `/api/products/adjustments` reports that `inventory_adjustments` is missing from the schema cache. The application does not run database migrations automatically.

Analytics reports that report missing schema objects need the corresponding outstanding migrations applied: `/api/admin/analytics/profit` requires `20261022000500_product_cost_price.sql`, and inventory adjustment history requires `20261022000700_smart_inventory_and_bulk_shipping.sql` plus the repair migration. Check `supabase migration list --linked` and reconcile any manual or divergent migration history before applying changes; do not blindly push or mark migrations applied.

The WhatsApp order-intent migration creates a service-role-only, expiring confirmation-intent table and RPCs for the server-side product catalog, intent creation, and atomic intent confirmation. The first customer message only creates a price preview and does not reserve or deduct stock; the existing checkout RPC rechecks stock and current database prices only after the customer confirms. The confirmation RPC records the human-readable `order_number` and consumes the intent in the same transaction as checkout, so retries cannot create a second order. Apply it after the smart-inventory migration and before deploying the matching webhook. Configure Meta webhook signature verification and WhatsApp sending credentials; test with a low-value product before enabling production traffic.

The storefront PWA manifest and service worker cache only the static app shell and same-origin static assets. API requests are deliberately excluded from offline caching to prevent stale customer, order, or administrative data from being stored as responses.

Private order links generated in the product-management dashboard encode product IDs and quantities plus optional customer phone/name. The storefront validates each item against current product availability, removes the query string after processing to reduce exposure, and requires the customer to review and submit checkout; the link does not place an order automatically.

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
npm run lint
npm test
node --check index.js
npm start
```

Use `npm run dev` for local development. The health endpoint can then be checked at `http://localhost:3000/health` (or the configured `PORT`). `npm run format` formats JavaScript files under `src/` and `scripts/` only.
