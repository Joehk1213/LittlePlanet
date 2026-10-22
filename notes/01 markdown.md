# 🪐 LittlePlanet 小行星宇宙網店 — 專案日誌與背景備案 (Project Log)

## 📌 專案基本資訊 (Project Background)
- **專案名稱**：LittlePlanet (小行星宇宙網店)
- **專案性質**：電商網站全端開發與後台營運系統
- **技術棧 (Tech Stack)**：
  - **後端 (Backend)**：Node.js (>=22), Express 4, JavaScript (ES6+)
  - **資料庫 (Database & RLS)**：Supabase (PostgreSQL), Supabase JS Client (^2.43.0)
  - **前台與 UI (Frontend)**：HTML5, CSS3, 原生 JavaScript (Vanilla JS), Chart.js (vendor 本地託管)
  - **第三方整合 (Integrations)**：Meta WhatsApp Cloud API (Webhook & 通知發送)
  - **安全性與防護 (Security)**：Helmet, Express Rate Limit, HMAC/Session 簽署 (HttpOnly + SameSite=Strict Cookie)
- **開發者**：Joe Leung
- **儲存庫/部署環境**：GitHub / Render / Railway / Supabase SQL Editor

---

## 🏗️ 專案架構與關鍵檔案說明 (Architecture & Key Files)

LittlePlanet/
├── index.js                           # Express 後端主入口點 (路由掛載、安全中間件、Supabase/WhatsApp 初始化)
├── package.json                       # 依賴套件配置 (Express, Supabase, Helmet, Rate Limit 等)
├── DEPLOYMENT.md                      # 生產環境部署指南 (環境變數、Supabase Migration 執行順序)
├── backup-data.js                     # 資料庫本地 JSON 備份指令腳本
├── bundle_to_md.py                    # 專案程式碼打包腳本 (生成 project_summary.md)
├── middleware/                        # 中間件目錄
│   ├── admin-sessions.js              # 管理員 Session 與 Token 簽署驗證
│   ├── api-protection.js              # API CORS 與全域 Rate Limit 防護
│   ├── error-handler.js               # 統一 JSON 錯誤處理與 404 處理
│   └── sensitive-rate-limits.js       # 敏感操作 (結帳/庫存/登入) 獨立 Rate Limit
├── public/                            # 前台與後台靜態檔案
│   ├── index.html                     # 網店前台首頁 (商品瀏覽、分類、優惠碼、結帳 Modal)
│   ├── admin.html                     # 營運管理後台 (營收儀表板、Chart.js 銷售趨勢圖、庫存與出貨)
│   ├── track.html                     # 買家訂單查詢頁面 (支援 UUID / 電話查詢)
│   └── vendor/
│       └── chart.umd.min.js           # 圖表庫本地檔案
├── backups/                           # 資料庫備份檔存放資料夾
└── notes/
└── Project_Log.md                 # 專案筆記與開發日誌 (本檔案)


```

---

## 🔐 關鍵功能與營運架構 (Core Features)

1. **商品與庫存管理**：
   - 支援商品狀態、低庫存警示 (<=5件)、即時 PATCH 庫存更新與進貨對帳 (Inbound Reconciliation)。
2. **結帳與訂單流轉**：
   - 前台購物車支援優惠碼 (如 `PLANET9` 9折)、WhatsApp 電話號碼驗證、原子化庫存扣減。
3. **出貨與物流**：
   - 執貨清單 (Pick List) 支援「按訂單」與「按貨品」動態分組。
   - 出貨自動發送 SF/順豐運單號碼至買家 WhatsApp，支援發送失敗重試。
4. **營收與數據分析**：
   - 30 日銷售趨勢圖 (Chart.js)、總營業額、訂單數、付款率及出貨率計算與快取機制。
5. **安全防衛機制**：
   - 管理員 8 小時 Session Cookie 防護 (HttpOnly + SameSite=Strict + Secure)。
   - 分級 API Rate Limiting (防範暴力破解與惡意連點)。

---

## 📝 專案開發進度紀錄 (Development Timelines & Milestones)

> *註：以下紀錄將隨對話與開發進程持續更新*

- **[階段 1 - 基礎建置]**：完成 Node.js + Express + Supabase 基礎架構搭建與靜態前台頁面 (`index.html`, `track.html`, `admin.html`)。
- **[階段 2 - 資料庫與 API]**：實作 `products`, `orders`, `order_items`, `whatsapp_payment_reports` 等資料表與 API 路由。
- **[階段 3 - 安全性與防護加強]**：引入 Session Cookie 認證、Helmet、CORS 與微服務 Rate Limit 防護。
- **[階段 4 - 部署與運籌整合]**：撰寫 `DEPLOYMENT.md`，支援 Render/Railway 部署及 WhatsApp Cloud API 整合通知。

```

**🪐 LittlePlanet** **小行星網店 —** **專案開發備案日誌 (Project Log)**

**📌** **專案基本資訊 (Project Metadata)**

- **專案名稱**：LittlePlanet 小行星網店
- **開工日期**：2026 年 9 月 26 日
- **核心技術棧**：

- **後端**：Node.js (Express.js) + dotenv + Express Validator / Custom Middleware
- **資料庫**：Supabase (PostgreSQL / RLS 安全政策 / Stored Procedures & RPC Transactions)
- **前端**：HTML5 + CSS3 + Vanilla JavaScript (FETCH API) + Chart.js (圖表視覺化)
- **第三方整合**：Meta WhatsApp Cloud API (Webhook & 運送通知)

**🗓️** **核心功能開發進程 (Development Timeline & Modules)**

**1.** **專案初始化與前台基礎 (2026-09-26)**

- **系統配置**：建立 system-prompt.json 定義全端開發規則與香港繁體中文規範。
- **前端頁面**：完成 public/index.html 基本 UI、商品卡片、購物車 Modal 與數量控制。
- **基礎 API**：開通 GET /api/products 與購物車基本結帳路由。

**2. FR001** **商品管理與分類/****狀態篩選 (routes/products.js)**

- **資料對齊**：對齊 PRD 規格，新增商品狀態（預購中、旅購中、已到貨、已下架）。
- **安全性防護**：加入公開欄位白名單機制（PUBLIC_PRODUCT_FIELDS），避免向買家洩漏 cost_price（成本價）。
- **庫存更新**：新增 PATCH /api/products/:productId/stock 介面，支援低庫存警示與管理員更新。

**3. FR003** **持久化訂單與事務防護 (routes/orders.js)**

- **移除模擬機制**：徹底移除舊有 simulated: true 模擬成功降級，改為嚴格的 Supabase 原子化寫入。
- **原子化結帳 (RPC)**：實作 create_customer_order RPC，在單一資料庫交易內完成訂單建立、明細寫入與庫存即時扣減。
- **回滾與金額校驗**：由後端重新從資料庫核對單價與總額，防止前端篡改價格；若明細寫入失敗自動回滾主單。

**4. FR002** **截單提醒系統 (routes/reminders.js)**

- **定時排程 API**：提供 GET /api/reminders/upcoming 與 POST /api/reminders/run。
- **樂觀鎖機制**：透過 remind_claimed_at 避免多個 Cron 排程重複發送提醒。
- WhatsApp 整合：成功發送後更新 remind_status 為 已發送提醒。

**5. FR004** **入庫與 FIFO** **齊貨對賬 (routes/inbound.js)**

- **原子入庫 RPC**：實作 record_product_receipt 與 reconcile_inbound_orders。
- **FIFO** **對賬演算法**：貨品到貨時自動按訂單日期由舊至新分配數量，並更新訂單明細為 已到貨倉 / 部分到貨 / 可出貨。

**6. FR005** **出貨管理與執貨清單 (routes/shipping.js)**

- **執貨清單 API**：GET /api/shipping/pick-list 支持按「訂單」或「貨品」分組。
- **原子出貨 (RPC)**：ship_order 交易同時更新訂單狀態、物流單號，並排入 shipping_notifications 佇列。
- **自動運送通知**：成功出貨後自動觸發 WhatsApp 物流通知，失敗時提供重試機制。

**7. FR006** **客戶自助訂單查詢 (routes/customer.js & public/track.html)**

- **公開查詢頁面**：買家可輸入 UUID 訂單編號或手機號碼查詢付款、到貨與物流狀態。
- **隱私與防爬蟲**：採用 HMAC 匿名化 IP 限流（每 15 分鐘最多 10 次），查無資料傳回通用提示。

**8. FR007** **營收報表與數據視覺化 (routes/analytics.js & public/admin.html)**

- **統計 API**：提供香港時區 (Asia/Hong_Kong) 營業額、訂單數、付款與出貨佔比統計。
- **Chart.js** **整合**：後台整合 Chart.js，呈現銷售趨勢折線圖與每日訂單數柱狀圖。

**9. P8 WhatsApp Webhook** **接收端 (routes/webhook.js)**

- **Meta Webhook** **驗證**：實作 GET Challenge 校驗與 POST HMAC-SHA256 簽名驗證。
- **買家互動處理**：自動解析買家傳送的「查詢訂單」與「付款回報」（寫入待人工核實紀錄）。

**10.** **生產環境部署準備 (Production Readiness)**

- **安全中間件 (middleware/api-protection.js)**：整合 CORS 白名單、Helmet 安全標頭與 Rate Limiting。
- **健康檢查**：提供 /health 端點供 Render / Railway 等雲端平台進行健康探針檢測。
- **文件與依賴**：完善 package.json、.env.example 與 DEPLOYMENT.md。

**🗄️ SQL Migration** **腳本清單 (Database Migrations)**

|**腳本檔案名**|**主要作用**|
|---|---|
|20260926223000_add_products_status.sql|為 products 表加入 status 欄位與 CHECK 約束|
|20260926225000_align_orders_schema_with_prd.sql|規範 orders 及 order_items 表結構與主外鍵|
|20260926230000_add_product_reminder_fields.sql|加入截單時間 cutoff_datetime 及提醒樂觀鎖欄位|
|20260926233000_add_inbound_reconciliation.sql|建立入庫與 FIFO 齊貨對賬 RPC 函數|
|20260926234000_add_shipping_management.sql|建立執貨清單、ship_order 出貨 RPC 及通知佇列|
|20260926235000_add_customer_order_lookup.sql|建立買家訂單查詢 RPC 及 IP 限流資料表|
|20260926235900_add_analytics_reporting.sql|建立營收總覽、熱銷排行及財務對賬 RPC|
|20260927000100_add_whatsapp_webhook.sql|建立 WhatsApp 付款回報紀錄表與查詢 RPC|
|20260927000200_add_product_stock_update.sql|建立安全的庫存更新 RPC set_product_stock|
|20260927000300_support_uuid_order_shipping.sql|出貨 RPC 支援 UUID 訂單編號並在出貨時扣減庫存|
|20260927000500_atomic_customer_checkout.sql|原子化結帳 RPC create_customer_order|

**🛠️** **重要故障排除紀錄 (Troubleshooting History)**

**🔴 1.** **結帳時出現 Unexpected token '<', '<!DOCTYPE ...' 404** **錯誤**

- **問題原因**：背景有舊版 Node 程序常駐在 Port 3000，未載入新編寫的路由。
- **解決方案**：在 PowerShell 執行 Stop-Process 強制結束舊 Node 程序後重啟服務。

**🔴 2.** **結帳提示「訂單建立成功」但 Supabase** **無資料**

- **問題原因**：舊版代碼包含降級機制 (simulated: true)。
- **解決方案**：全面移除模擬成功路徑，當 Schema 不符合時明確傳回 HTTP 503 並提示套用 Migration。

**🔴 3.** **後台登入後數據顯示為 0 /** **載入失敗**

- **問題原因**：後台傳送 SHIPPING_ADMIN_TOKEN，但 Analytics API 要求 ANALYTICS_ADMIN_TOKEN。
- **解決方案**：統一 Token 讀取權限，並在缺少 SUPABASE_SERVICE_ROLE_KEY 時提供 Table 唯讀 Fallback，避免介面卡死。

# LittlePlanet 宇宙網店 — 完整專案開發日誌與架構演進

> **筆記路徑**：`C:\Users\JOE\OneDrive\Couse\Project\小行星網店\LittlePlanet\notes\Project_Log.md`
> 
> **技術棧**：Node.js (Express) + Supabase (PostgreSQL) + Vanilla JS / HTML / CSS (Admin UI)
> 
> **核心目標**：打造具備完整權限控制、低庫存警報、批次效期追蹤與安全防護機制的電子商務後台管理系統。

## 📅 開發時間軸與重大里程碑

### 1. 專案起步與基礎設施建立

- **架構確立**：建立基於 Express 的後端路由結構，採用模組化設計（如 `routes/products.js`、`middleware/admin-sessions.js`）。
    
- **API 標準化**：規定所有 API 回應必須嚴格遵循 `{ success, data, message }` 的統一格式，確保前後端溝通穩定。
    
- **安全基準**：引入 HttpOnly Cookies、SameSite=Strict、速率限制（Rate Limits）及管理員 Session 機制，確保後台管理員身份驗證安全。
    

### 2. 營運數據儀表板與低庫存警報系統

- **後端彙整 API**：新增 `GET /api/admin/dashboard-summary` 端點，用以計算總營業額、總訂單數、總會員數（以不重複電話計算）、Top 5 熱銷商品，以及低庫存（`stock <= 5`）警報清單。
    
- **前端儀表板 (`public/admin.html`)**：在管理後台首頁直觀呈現即時營運數據與低庫存提醒，並提供直接跳轉至商品庫存管理的互動捷徑。
    

### 3. 產品管理頁面 (`product.html`) 現代化重構

- **響應式網格介面**：將呆板的直列清單改為現代化的 **Grid 網格卡片排版**（電腦版 3-4 欄，手機版 1-2 欄），支援圖片縮圖、錯誤容錯、HKD 價格格式化。
    
- **互動視窗（Modal）操作**：支援透過介面直接新增、修改商品名稱、價格、圖片網址 (`image_url`) 與庫存量。
    
- **安全防禦機制**：
    
    - 前端加入共用的安全回應解析器，徹底解決因未登入或伺服器回傳純文字 `"Forbidden."` 導致 `.json()` 崩潰的問題。
        
    - 統一 `admin.html` 與 `product.html` 的登入狀態檢查，實現多頁面 Session 同步。
        

### 4. 產品批次與最佳使用日期 (Best Before / Expiry Date) 系統

- **入庫追蹤**：建立 `public.product_stock_batches` 資料表及對應 Migration，用以記錄每次進貨的批次數量與效期。
    
- **原子化入庫 RPC**：實作收貨入庫 API (`POST /api/inbound/receipt`) 與 Supabase 資料庫函數，保證總庫存與批次紀錄在同一交易中同步更新。
    
- **前台效期展示**：擴充公開產品 API (`include_best_before_dates=true`)，讓前台能安全展示各批次的最佳使用日期與舊庫存狀態。
    

### 5. 產品完整 CRUD（新增、查詢、修改、刪除）收尾

- **後端刪除 API**：新增 `DELETE /api/products/:id`，嚴格套用 Session 驗證、`products` scope 權限檢查及 Supabase `service_role` 寫入閘門。
    
- **前端動態刪除按鈕**：在產品列表中為具備權限的管理員動態渲染刪除按鈕，點擊後跳出 `confirm()` 提示並自動刷新清單。
    
- **單元測試全綠**：在測試套件中補上刪除權限、未登入拒絕、找不到商品等測試案例，維持 80+ 項測試 100% 通過。
    

### 6. 穩定性與防呆機制升級（Port 佔用防護）

- **伺服器啟動防崩潰**：在 `index.js` 的 `app.listen()` 引入 `server.on('error', ...)` 監聽器。
    
- **友善提示**：當偵測到 `EADDRINUSE`（Port 3000 被佔用）時，會印出清晰的繁體中文提示，並以 `process.exit(1)` 安全結束，徹底根除過去未捕捉例外導致的 `-4091` 終端崩潰問題。
    

## 🛡️ 核心開發守則與避坑寶典 (Guardrails)

1. **前端 API 容錯**：
    
    - 絕不能假設後端回傳的一定是 JSON。遇到 403 或 500 錯誤時，應先以 `res.text()` 讀取內容再作處理，防止前端介面因解析崩潰。
        
2. **Session 與 Cookie 一致性**：
    
    - 跨頁面請求管理員 API 時，必須確保帶有正確的同源驗證與 `credentials: 'same-origin'` 設定。
        
3. **資料庫異動原子性**：
    
    - 牽涉到庫存增減、批次更新的操作，必須透過 Supabase Transaction 或 RPC 處理，避免資料不對稱。
        
4. **連接埠異常處理**：
    
    - 啟動 Node.js 伺服器時必須捕捉 `error` 事件，避免埠號衝突時直接拋出未捕捉異常。
        

如果你手頭上有其他特定的對話紀錄段落、細節或程式碼片段想要補充進去這份 Obsidian 筆記裡，隨時告訴我，我會第一時間幫你融合進這份結構化的 Markdown 內！