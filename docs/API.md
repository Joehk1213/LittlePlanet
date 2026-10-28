# API 參考

本文根據目前 Express routes 整理；所有 API 路徑均以本機應用程式根目錄為基準。成功及錯誤回應通常使用 `{ success, data, message }` 格式。除另有註明，JSON body 請使用 `Content-Type: application/json`。

## 認證方式

- **公開**：不要求管理員或會員登入；仍須符合端點本身的電話／訂單核對條件。
- **會員 Session**：先登入會員，瀏覽器持有 HttpOnly Cookie；需要寫入的會員端點亦要求同源 `Origin`。
- **管理員 Session**：使用 `/api/admin-auth/login` 建立有權限範圍的管理員 Cookie。寫入操作要求同源請求。
- **管理員 Bearer Token**：`Authorization: Bearer <token>`；僅適用於路由有明確支援 Token 的範圍。
- **管理員 Session 或 Bearer Token**：須具備該路由指定的管理權限範圍。
- **排程 Bearer Token**：`Authorization: Bearer <REMINDER_CRON_TOKEN>`。
- **Meta 簽名**：WhatsApp webhook POST 需提供 `X-Hub-Signature-256`，由原始 request body 驗證。

管理員登入 body 為 `{ "token": "<管理員密鑰>" }`。登入會依密鑰設定授予權限；瀏覽器 Session 與各 API 的管理權限範圍分開核對。所有 `/api` 請求亦受全域來源政策及請求速率限制。

## 管理員 Session

| 方法 | 路徑                      | 認證                               | 參數／body     |
| ---- | ------------------------- | ---------------------------------- | -------------- |
| POST | `/api/admin-auth/login`   | 同源請求；body 提供管理員密鑰      | JSON：`token`  |
| GET  | `/api/admin-auth/session` | 公開；回報目前 Cookie Session 狀態 | Cookie（如有） |
| POST | `/api/admin-auth/logout`  | 同源請求                           | Cookie（如有） |

## 商品

掛載於 `/api/products`。商品管理操作使用 `products` 權限範圍；管理員 Session 或對應管理 Bearer Token 均可。公開商品列表可選擇附帶管理 Bearer Token，以取得額外管理欄位。

| 方法   | 路徑                                   | 認證                                   | 參數／body                                                                                                                                                                                     |
| ------ | -------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/products`                        | 公開；管理 Bearer Token 可取得管理欄位 | Query：`limit`、`offset`、`sort`（`default`、`newest`、`price-asc`、`price-desc`）、`search`、`category`、`status`、`ids`（逗號分隔；不可與搜尋／分類／狀態混用）、`include_best_before_dates` |
| POST   | `/api/products/images`                 | `products` 管理權限                    | 原始圖片 body；`Content-Type` 為 JPG、PNG 或 WebP，最多 5 MB                                                                                                                                   |
| GET    | `/api/products/categories`             | `products` 管理權限                    | 無                                                                                                                                                                                             |
| POST   | `/api/products/categories`             | `products` 管理權限                    | JSON：`name`                                                                                                                                                                                   |
| GET    | `/api/products/inventory-alerts`       | `products` 管理權限                    | Query：`safety_stock`、`target_stock`、`slow_days`                                                                                                                                             |
| GET    | `/api/products/adjustments`            | `products` 管理權限                    | Query：`limit`（1–100）                                                                                                                                                                        |
| POST   | `/api/products/:productId/adjustments` | `products` 管理權限                    | Path：`productId`；JSON：`quantity_delta`、`reason`、可選 `note`                                                                                                                               |
| PATCH  | `/api/products/:productId/stock`       | `products` 管理權限                    | Path：`productId`；JSON：`stock`、`reason`、可選 `note`                                                                                                                                        |
| POST   | `/api/products`                        | `products` 管理權限                    | JSON：必填 `name`、`price`；支援 `cost_price`、`stock`、`status`、`category`、`image_url`／`image`、`description`、`tier_prices`、`preorder_deadline`、`best_before_date`                      |
| PATCH  | `/api/products/:productId`             | `products` 管理權限                    | Path：`productId`；商品欄位同新增商品                                                                                                                                                          |
| DELETE | `/api/products/:productId`             | `products` 管理權限                    | Path：`productId`                                                                                                                                                                              |

## 訂單

掛載於 `/api/orders`。查詢個別客戶訂單的公開端點均以客人電話及正式訂單編號一併核對；不使用內部 UUID 作訪客驗證。

| 方法  | 路徑                                       | 認證                                   | 參數／body                                                                                                               |
| ----- | ------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| POST  | `/api/orders`                              | 公開                                   | JSON：`customer_phone`、`items`（`product_id`、`quantity`）；可選 `customer_name`、`shipping_method`、`shipping_address` |
| POST  | `/api/orders/checkout`                     | 公開                                   | JSON：`customer.phone`、`items`（字串 `product_id`、正整數 `qty`）；可選 `customer.name`、`pickup`、`shipping_address` |
| POST  | `/api/orders/query-order`                  | 公開；必須電話及正式訂單編號吻合       | JSON：`phone`、`orderNo`                                                                                                 |
| PATCH | `/api/orders/update-info`                  | 公開；必須提供原登記電話及正式訂單編號 | JSON：`phone`、`orderNo`；可更新 `customer_phone`、`shipping_method`                                                     |
| GET   | `/api/orders/admin/orders`                 | `orders` 管理員 Session                | Query：`limit`、`offset`                                                                                                 |
| PATCH | `/api/orders/admin/orders/:orderId/status` | `orders` 管理員 Session                | Path：`orderId`；JSON：`status`（`pending`、`shipping`、`completed`）                                                    |

程式內 `/api/orders/admin/orders` 註冊了兩個 GET handler；第一個 handler 會直接回應，後續同路徑 handler 在一般請求流程中不會執行。

`/api/orders/checkout` 使用現行 `create_customer_order()` RPC；`customer.phone` 會依電話規則正規化，商品代號必須是有效正整數 bigint。`customer.email` 暫未有訂單欄位保存，會忽略並記錄欄位名稱。回應的 `data.order_id` 是正式對客訂單編號，不是內部 UUID；內部識別碼不會回傳給訪客。

## 客戶會員

掛載於 `/api/customer`。

| 方法   | 路徑                                  | 認證                                                       | 參數／body                                                           |
| ------ | ------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------- |
| GET    | `/api/customer/config`                | 公開                                                       | 無；回傳前端可用的 Supabase URL 及 anon key，不包含 service-role key |
| GET    | `/api/customer/wishlist`              | 會員 Session                                               | Query：`limit`、`offset`                                             |
| POST   | `/api/customer/wishlist`              | 會員 Session；同源                                         | JSON：`product_id`                                                   |
| DELETE | `/api/customer/wishlist/:productId`   | 會員 Session；同源                                         | Path：`productId`                                                    |
| POST   | `/api/customer/member/link-phone`     | Google 會員 Session；同源                                  | JSON：`customer_phone`、`order_number`                               |
| POST   | `/api/customer/member/google-session` | 同源；`Authorization: Bearer <Supabase Auth access token>` | Bearer access token                                                  |
| POST   | `/api/customer/member/session`        | 同源；以訂單資料核對                                       | JSON：`customer_phone`、`order_id`（UUID 或正式訂單編號）            |
| GET    | `/api/customer/member/session`        | 公開；如有會員 Cookie 則回報 Session                       | Cookie（如有）                                                       |
| POST   | `/api/customer/member/logout`         | 同源                                                       | 會員 Cookie（如有）                                                  |
| GET    | `/api/customer/orders`                | 會員 Session                                               | Query：`limit`、`offset`                                             |
| POST   | `/api/customer/orders/forgot`         | 公開；以電話查找最近訂單                                   | JSON：`customer_phone`                                               |
| POST   | `/api/customer/orders/lookup`         | 公開；電話及正式訂單編號必須同時吻合                       | JSON：`customer_phone`、`order_number`                               |

## 管理客戶

掛載於 `/api/admin/customers`；全部端點要求 `customers` 管理員 Session。

| 方法  | 路徑                                              | 認證                 | 參數／body                                                                      |
| ----- | ------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------- |
| GET   | `/api/admin/customers`                            | `customers` 管理權限 | Query：`limit`、`offset`、`search`                                              |
| POST  | `/api/admin/customers/:customerPhone/bind-google` | `customers` 管理權限 | Path：`customerPhone`；JSON：`google_email`                                     |
| PATCH | `/api/admin/customers/:id/credit-status`          | `customers` 管理權限 | Path：`id`；JSON：`credit_status`（`normal`、`require_deposit`、`blacklisted`） |

## 付款憑證

| 方法  | 路徑                                        | 認證                                             | 參數／body                                                                              |
| ----- | ------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| POST  | `/api/orders/:id/payment-proof`             | 公開；正式訂單編號及 `x-customer-phone` 必須吻合 | Path：`id` 為正式訂單編號；原始圖片 body，`Content-Type` 為 JPG、PNG 或 WebP，最多 5 MB |
| PATCH | `/api/admin/orders/:orderId/payment-status` | `orders` 管理員 Session                          | Path：`orderId`；JSON：`payment_proof_status`（`verified` 或 `rejected`）               |

上載付款憑證只會建立待審核憑證；不代表已核實收款。

## WhatsApp Webhook

掛載於 `/api/webhook`。

| 方法 | 路徑                    | 認證                    | 參數／body                                                             |
| ---- | ----------------------- | ----------------------- | ---------------------------------------------------------------------- |
| GET  | `/api/webhook/whatsapp` | Meta webhook 驗證 Token | Query：`hub.mode`、`hub.verify_token`、`hub.challenge`                 |
| POST | `/api/webhook/whatsapp` | Meta HMAC 簽名          | Header：`X-Hub-Signature-256`；JSON：WhatsApp Business webhook payload |

## 出貨

掛載於 `/api/shipping`；全部端點（包括 GET）均要求 `shipping` 管理權限及有效的資料庫讀取／寫入設定。

| 方法 | 路徑                                        | 認證                                          | 參數／body                                                                             |
| ---- | ------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------- |
| GET  | `/api/shipping/pick-list`                   | `shipping` 管理員 Session 或管理 Bearer Token | Query：`group_by`（`order` 或 `product`）                                              |
| POST | `/api/shipping/bulk-tracking`               | `shipping` 管理員 Session 或管理 Bearer Token | Header：`x-upload-filename`、可選 `x-shipping-method`；原始 CSV／Excel 檔案，最多 2 MB |
| POST | `/api/shipping/:orderId/ship`               | `shipping` 管理員 Session 或管理 Bearer Token | Path：`orderId`；JSON：`shipping_method`、`tracking_number`、可選 `customer_phone`     |
| POST | `/api/shipping/:orderId/notification/retry` | `shipping` 管理員 Session 或管理 Bearer Token | Path：`orderId`                                                                        |

## 商品評價

掛載於 `/api`。公開讀取及電話／訂單核對的評價提交不要求會員登入；會員購買記錄路徑要求會員 Session。管理端要求 `reviews` 管理員 Session。

| 方法   | 路徑                                  | 認證                                           | 參數／body                                                                                             |
| ------ | ------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| GET    | `/api/products/:productId/reviews`    | 公開                                           | Path：`productId`；Query：`limit`、`offset`                                                            |
| GET    | `/api/reviews/summary`                | 公開                                           | Query：`product_ids`（逗號分隔）                                                                       |
| POST   | `/api/reviews`                        | 公開；同源；電話、正式訂單及商品購買資料須吻合 | JSON：`product_id`、`customer_phone`、`order_number`、`rating`（1–5）、`comment`；可選 `customer_name` |
| POST   | `/api/products/:productId/reviews`    | 會員 Session；同源；須曾購買商品               | Path：`productId`；JSON：`rating`、`comment`                                                           |
| GET    | `/api/admin/reviews`                  | `reviews` 管理權限                             | Query：`limit`、`offset`                                                                               |
| PATCH  | `/api/admin/reviews/:reviewId/status` | `reviews` 管理權限                             | Path：`reviewId`；JSON：`status`                                                                       |
| DELETE | `/api/admin/reviews/:reviewId`        | `reviews` 管理權限                             | Path：`reviewId`                                                                                       |

## 截單提醒

掛載於 `/api/reminders`；全部端點要求排程 Bearer Token。路由本身不代表已設定發送器、收件人或自動排程。

| 方法 | 路徑                      | 認證              | 參數／body              |
| ---- | ------------------------- | ----------------- | ----------------------- |
| GET  | `/api/reminders/upcoming` | 排程 Bearer Token | Query：`hours`（1–168） |
| POST | `/api/reminders/run`      | 排程 Bearer Token | JSON：`hours`（1–168）  |

## 入庫

掛載於 `/api/inbound`；全部端點要求 `inbound` 管理權限及 service-role 寫入設定。

| 方法  | 路徑                            | 認證                                         | 參數／body                                                       |
| ----- | ------------------------------- | -------------------------------------------- | ---------------------------------------------------------------- |
| POST  | `/api/inbound/receipt`          | `inbound` 管理員 Session 或管理 Bearer Token | JSON：`product_id`、`quantity`、可選 `best_before_date`          |
| GET   | `/api/inbound/expiring`         | `inbound` 管理員 Session 或管理 Bearer Token | 無                                                               |
| GET   | `/api/inbound/batches`          | `inbound` 管理員 Session 或管理 Bearer Token | Query：`product_id`                                              |
| PATCH | `/api/inbound/batches/:batchId` | `inbound` 管理員 Session 或管理 Bearer Token | Path：`batchId`；JSON：`best_before_date`（日期、`null` 或空值） |
| POST  | `/api/inbound/reconcile`        | `inbound` 管理員 Session 或管理 Bearer Token | JSON：可選 `order_id`（訂單 UUID；缺省時處理全部符合條件的訂單） |

## 分析報表

掛載於 `/api/admin/analytics` 及 `/api/analytics`。管理報表一般要求 Analytics 管理員 Session 或 Analytics 管理 Bearer Token。`/api/admin/analytics` 僅接受管理員 Session；`summary` 亦只在此管理路徑接受具 Analytics 權限的 Session。`/api/analytics/summary` 目前不符合該 handler 的 Session 條件，會回覆未授權。

| 方法 | 路徑                                                                   | 認證                     | 參數／query                                                                             |
| ---- | ---------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------- |
| GET  | `/api/admin/analytics/summary`                                         | Analytics 管理員 Session | 無                                                                                      |
| GET  | `/api/admin/analytics/profit`、`/api/analytics/profit`                 | 依上述管理報表認證規則   | Query：`start_date`、`end_date`、`limit`                                                |
| GET  | `/api/admin/analytics/overview`、`/api/analytics/overview`             | 依上述管理報表認證規則   | Query：`start_date`、`end_date`                                                         |
| GET  | `/api/admin/analytics/sales-trend`、`/api/analytics/sales-trend`       | 依上述管理報表認證規則   | Query：`start_date`、`end_date`                                                         |
| GET  | `/api/admin/analytics/top-products`、`/api/analytics/top-products`     | 依上述管理報表認證規則   | Query：`start_date`、`end_date`、`limit`                                                |
| GET  | `/api/admin/analytics/reconciliation`、`/api/analytics/reconciliation` | 依上述管理報表認證規則   | Query：`start_date`、`end_date`、`payment_status`、`shipping_status`、`limit`、`offset` |

日期參數使用 `YYYY-MM-DD`，日期區間及其他選項須符合各報表路由驗證規則。

## 靜態圖片路徑

`public/` 由 Express 靜態檔案服務提供。商品圖片檔案位於 `public/assets/images/` 時，對應網站路徑為 `/assets/images/<檔名>`；這是靜態檔案路徑，不是 API endpoint。
