````
# 🪐 LittlePlanet 小行星宇宙網店 — 完整專案開發史與演進備忘錄 (Project Master Log)

> **筆記路徑**：`C:\Users\JOE\OneDrive\Couse\Project\小行星網店\LittlePlanet\notes\Project_Log.md`
> **維護者**：Joe Leung
> **專案定位**：結合前端現代化 UI、後端高安全性 API 與 Supabase 資料庫原子化交易的全端電商及營運管理系統。

---

## 📌 1. 專案基本資訊與架構規格
* **專案名稱**：LittlePlanet (小行星宇宙網店)
* **開工日期**：2026 年 9 月 26 日
* **技術棧 (Tech Stack)**：
  * **後端 (Backend)**：Node.js (>=22), Express 4, JavaScript (ES6+), Express Validator
  * **資料庫 (Database & RLS)**：Supabase (PostgreSQL), Supabase JS Client (^2.43.0), Stored Procedures & RPC Transactions
  * **前台與後台 UI**：HTML5, CSS3, 原生 JavaScript (Vanilla JS), Chart.js (本地託管)
  * **第三方整合**：Meta WhatsApp Cloud API (Webhook 與運送通知)
  * **安全性與防護**：Helmet, Express Rate Limit, HMAC/Session 簽署 (HttpOnly + SameSite=Strict Cookie)

---

## 🏗️ 2. 專案核心架構與檔案清單
```text
LittlePlanet/
├── index.js                           # Express 後端主入口點 (路由掛載、安全中間件、Supabase/WhatsApp 初始化，含 EADDRINUSE 埠佔用防護)
├── package.json                       # 依賴套件與執行指令配置
├── docs/                              # 部署與專案文件
├── PROJECT_CHECKPOINT.md              # 專案階段性檢查點與驗證紀錄
├── scripts/                           # 維護與備份指令腳本
├── src/middleware/                    # 系統中間件
│   ├── admin-sessions.js              # 管理員 Session 與 Token 簽署驗證
│   ├── api-protection.js              # API CORS 與全域 Rate Limit 防護
│   ├── error-handler.js               # 統一 JSON 錯誤處理與 404 處理
│   └── sensitive-rate-limits.js       # 敏感操作 (結帳/庫存/登入) 獨立 Rate Limit
├── src/routes/                        # 業務路由模組
│   ├── products.js                    # 商品管理、狀態篩選、CRUD 與刪除 API
│   ├── orders.js                      # 持久化訂單與原子化結帳
│   ├── reminders.js                   # 截單提醒系統與樂觀鎖
│   ├── inbound.js                     # 入庫管理與 FIFO 齊貨對賬 (含批次效期管理)
│   ├── shipping.js                    # 出貨管理與執貨清單 (Pick List)
│   ├── customer.js                    # 客戶自助訂單查詢 API
│   ├── Routes-Analytics-Fixed.js      # 營收報表與數據視覺化統計
│   └── webhooks.js                    # WhatsApp 訊息與付款回報接收端
├── public/                            # 前後台靜態網頁
│   ├── index.html                     # 網店前台首頁 (商品瀏覽、分類、優惠碼、結帳 Modal)
│   ├── product.html                   # 產品現代化網格管理介面 (支援批次、效期與刪除)
│   ├── admin.html                     # 營運管理後台 (營收儀表板、Chart.js 銷售趨勢圖、低庫存警報)
│   ├── track.html                     # 買家訂單查詢頁面 (支援 UUID / 電話查詢)
│   └── vendor/                        # 第三方前端套件 (chart.umd.min.js)
└── notes/
    └── Project_Log.md                 # 專案筆記與開發日誌 (本檔案)
````

## 🗓️ 3. 專案完整開發歷程與重大對話演進

### 🚀 第一階段：專案起步與基礎設施建立

- **架構確立**：建立基於 Express 的後端模組化路由結構，統一所有 API 回應格式為 `{ success, data: { ... }, message }`。
    
      
    
- **安全基準**：引入 HttpOnly Cookies、SameSite=Strict、速率限制（Rate Limits）及管理員 Session 機制，確保後台管理員身分驗證安全。
    
      
    
- **基礎靜態頁面**：完成前台 `index.html`、訂單查詢 `track.html` 及管理後台 `admin.html` 的骨架建置。
    
      
    

### 🚀 第二階段：核心營運模組與資料庫對齊（FR001 ~ FR007）

- **商品管理 (`routes/products.js`)**：對齊 PRD 規格，新增商品狀態（預購中、旅購中、已到貨、已下架），並加入公開欄位白名單機制（`PUBLIC_PRODUCT_FIELDS`），保護成本價不外洩。
    
      
    
- **持久化訂單與交易防護 (`routes/orders.js`)**：徹底移除舊有模擬降級機制 (`simulated: true`)，改由 Supabase 執行 `create_customer_order` RPC，在單一交易內完成訂單建立、明細寫入與庫存即時扣減，並由後端重新校驗價格防止篡改。
    
      
    
- **截單提醒與入庫對賬**：實作截單提醒排程與樂觀鎖 (`routes/reminders.js`)；建立入庫與 FIFO 齊貨對賬演算法 (`routes/inbound.js`)，貨品到貨時自動按訂單日期由舊至新分配數量。
    
      
    
- **出貨與客戶查詢**：實作執貨清單 (`src/routes/shipping.js`)、原子出貨 RPC 與 WhatsApp 自動運送通知；建立買家自助訂單查詢 (`src/routes/customer.js`)，搭配 HMAC 匿名化 IP 限流保護隱私。
    
      
    
- **數據視覺化**：整合營收報表 API 與 Chart.js 銷售趨勢折線圖 (`src/routes/Routes-Analytics-Fixed.js` 與 `public/admin.html`)。
    
      
    

### 🚀 第三階段：營運數據儀表板與低庫存警報系統

- **後端彙整 API**：新增 `GET /api/admin/dashboard-summary` 端點，計算總營業額、總訂單數、總會員數（依不重複電話計算）、Top 5 熱銷商品，以及低庫存（`stock <= 5`）警報清單。
    
      
    
- **管理後台升級**：在管理後台首頁直觀呈現即時營運數據與低庫存提醒，提供快速跳轉至商品庫存管理的互動捷徑。
    
      
    

### 🚀 第四階段：產品管理頁面 (`product.html`) 現代化重構

- **響應式網格介面**：將舊有清單改為現代化的 **Grid 網格卡片排版**（電腦版 3-4 欄，手機版 1-2 欄），支援圖片縮圖、錯誤容錯、HKD 價格格式化與庫存狀態顯示。
    
      
    
- **互動視窗（Modal）操作**：支援透過介面直接新增、修改商品名稱、價格、圖片網址 (`image_url`) 與庫存量。
    
      
    
- **前端防禦機制**：引入共用的安全回應解析器，徹底解決因未登入或伺服器回傳純文字 `"Forbidden."` 導致 `.json()` 崩潰的問題；統一多頁面 Session 同步。
    
      
    

### 🚀 第五階段：產品批次與最佳使用日期 (Best Before / Expiry Date) 系統

- **入庫批次追蹤**：建立 `public.product_stock_batches` 資料表及對應 Migration，用以記錄每次進貨的批次數量與效期。
    
      
    
- **原子化入庫 RPC**：實作收貨入庫 API (`POST /api/inbound/receipt`) 與 Supabase 資料庫函數，保證總庫存與批次紀錄在同一交易中同步更新。
    
      
    
- **前台效期展示**：允許管理員在後台編輯／清除個別批次的最佳使用日期，並擴充公開產品 API (`include_best_before_dates=true`) 安全顯示效期摘要。
    
      
    

### 🚀 第六階段：產品完整 CRUD 收尾（新增、查詢、修改、刪除）

- **後端刪除 API**：新增 `DELETE /api/products/:id`，嚴格套用 Session 驗證、`products` scope 權限檢查及 Supabase `service_role` 寫入閘門。
    
      
    
- **前端動態刪除按鈕**：在產品列表中為具備權限的管理員動態渲染刪除按鈕，點擊後跳出 `confirm()` 提示並自動刷新清單。
    
      
    
- **單元測試全綠**：在測試套件中補上刪除權限、未登入拒絕、找不到商品等測試案例，維持 80+ 項測試 100% 通過。
    
      
    

### 🚀 第七階段：伺服器穩定性與防呆升級（Port 佔用防護）

- **伺服器啟動防崩潰 (`index.js`)**：在 `app.listen()` 引入 `server.on('error', ...)` 監聽器。
    
      
    
- **友善提示**：當偵測到 `EADDRINUSE`（Port 3000 被佔用）時，會印出清晰的繁體中文提示，並以 `process.exit(1)` 安全結束，徹底根除過去未捕捉例外導致的 `-4091` 終端崩潰問題。
    
      
    

## 🗄️ 4. SQL Migration 腳本對照表

|**腳本檔案名**|**主要作用**|
|---|---|
|`20260926223000_add_products_status.sql`|為 products 表加入 status 欄位與 CHECK 約束|
|`20260926225000_align_orders_schema_with_prd.sql`|規範 orders 及 order_items 表結構與主外鍵|
|`20260926230000_add_product_reminder_fields.sql`|加入截單時間 cutoff_datetime 及提醒樂觀鎖欄位[cite: 7]|
|`20260926233000_add_inbound_reconciliation.sql`|建立入庫與 FIFO 齊貨對賬 RPC 函數[cite: 7]|
|`20260926234000_add_shipping_management.sql`|建立執貨清單、ship_order 出貨 RPC 及通知佇列[cite: 7]|
|`20260926235000_add_customer_order_lookup.sql`|建立買家訂單查詢 RPC 及 IP 限流資料表[cite: 7]|
|`20260926235900_add_analytics_reporting.sql`|建立營收總覽、熱銷排行及財務對賬 RPC[cite: 7]|
|`20260927000100_add_whatsapp_webhook.sql`|建立 WhatsApp 付款回報紀錄表與查詢 RPC[cite: 7]|
|`20260927000200_add_product_stock_update.sql`|建立安全的庫存更新 RPC `set_product_stock`<br><br>  <br><br>[cite: 7]|
|`20260927000300_support_uuid_order_shipping.sql`|出貨 RPC 支援 UUID 訂單編號並在出貨時扣減庫存[cite: 7]|
|`20260927000500_atomic_customer_checkout.sql`|原子化結帳 RPC `create_customer_order`<br><br>  <br><br>[cite: 7]|

## 🛡️ 5. 核心開發守則與避坑寶典 (Guardrails & Troubleshooting)

1. **Port 佔用防護 (`EADDRINUSE` / `-4091` 錯誤)**：
    
      
    - 啟動 Node.js 伺服器時必須以 `const server = app.listen(...)` 搭配 `server.on('error', ...)` 捕捉連接埠衝突錯誤，印出友善提示並以 `process.exit(1)` 安全退場，絕對避免未捕捉異常崩潰。
        
          
        
2. **前端 API JSON 崩潰防禦**：
    
      
    - 絕不能假設後端回傳的一定是 JSON。遇到 403 權限不足或 500 錯誤時（如回傳純文字 `"Forbidden."`），必須先透過 `res.text()` 讀取再作處理，防止前端因 `.json()` 解析崩潰。
        
          
        
3. **Session 與 Cookie 一致性**：
    
      
    - 跨頁面請求管理員 API 時，必須確保帶有正確的同源驗證與 `credentials: 'same-origin'` 設定。
        
          
        
4. **資料庫異動原子性**：
    
      
    - 涉及庫存增減、批次更新、結帳扣款的操作，必須透過 Supabase Transaction 或 RPC 處理，確保資料絕對一致。
---

```markdown
---
title: "LittlePlanet 小行星網店 AI Agent 系統開發總結筆記"
date: 2026-10-12
tags: [project, littleplanet, ai-agent, obsidian, workflow]
status: "開發中 / MVP 疊代期"
---

# LittlePlanet 小行星網店 AI Agent 系統開發筆記

## 1. 業務背景與核心營運模式

* **業務性質**：經營約 10 年的 WhatsApp 日常用品代購網店。
* **客戶分佈**：
  * 主要活躍於 WhatsApp 群組（約 1,200 人）。
  * 長期核心客戶估算約 100 - 200 人。
* **貨源渠道**：
  * 向 10-8 間分銷商/代理商以批發價買入，再以建議零售價售出賺取差價。
  * **旅購**：店主親自到不同國家/地區進行限時代購、推薦熱門潮流產品。
* **營運策略與風險**：
  * **策略**：採用「貨到後付、出貨前找清帳目」機制。
  * **好處**：大幅提高客戶下單意欲，對新客戶友善（降低網購受騙戒心）。
  * **壞處**：需預繳貨品價錢、流動資金較不靈活、存在客人生日走單風險。

---

## 2. 核心工作流程 (Workflows)

### Part 1：進貨與發佈
1. **篩選與Review**：店主 Review 批發商發出的 WhatsApp 訊息（產品圖片及介紹），或自行採購並拍攝產品照片。
2. **多維度審核**：
   * A. 產品內容 Review。
   * B. 圖片與內容是否一致。
   * C. 價錢 Review（零售價 > 批發價，多件買入可能享有少量 discount）。
3. **發佈貼文**：將整理好的內容發布至 WhatsApp 群組。

### Part 2：接單與標記
1. **客戶回覆**：客人在 WhatsApp 群組回覆貼文下單（例如指定種類與數量，格式如 `B x 3` 或 `b x 3`）。
2. **訂單確認**：店主將下單紀錄寫入系統/Excel，並在 WhatsApp 該留言回覆：
   * ❤️ 代表普通代購商品。
   * 👍 代表即時代購（旅購）商品。
   * 截單日前一天會發送溫馨提示（Remind）提醒客戶下單。

### Part 3：到貨與點貨
1. **實體倉點貨**：批發商出貨收貨、或旅購回港返貨倉後進行點貨並上貨架。
2. **箱號索引 (Index)**：點貨時手寫箱號（例如 `A1/A2...A23`、`B1/B2...B43`），作為檔案櫃/實體貨倉的快捷目錄，大幅提升日後執貨速度。
3. **系統更新**：在系統/Excel 標記到貨產品。

### Part 4：對賬、出貨與財務
1. **自動對賬清單**：Filter 篩選出已齊貨的客戶購物清單，截圖聯絡客戶出貨與付款。
2. **付款確認**：客戶付款後 Send Receipt 截圖到 WhatsApp，店主轉發至收據群組儲存（年尾交會計師樓報稅）。
3. **執貨與物流**：執貨 ➔ 拍照 ➔ 選擇運送方法（約地點面交、貨倉自取、順豐/京東運輸） ➔ 輸入快遞單號發送給客戶 ➔ 完成交易。

---

## 3. 系統架構規劃 (PRD 與 DB Schema)

* **起步時間**：2026 年 9 月 26 日開始 Build Up 系統。
* **技術棧 (Tech Stack)**：
  * 前端：HTML + Tailwind CSS (響應式 Web 界面)。
  * 後端：Node.js (Express) / Python (FastAPI)。
  * AI 核心：OpenRouter.ai API (GPT-4o / Claude 3.5 Sonnet) 用於 NLP 留言解析與 Vision 付款截圖 OCR 辨識。
  * 資料庫：Supabase (PostgreSQL)。

### 六大核心資料庫表格 (DB Schema)
1. **`customers` (客戶表)**：記錄 WhatsApp 電話、暱稱、預設取貨方式、信用評級（優良/需付訂金/黑名單）。
2. **`products` (產品表)**：記錄產品代號 (SKU)、成本價、零售價、折扣規則、截單時間、營運狀態。
3. **`orders` (訂單主表)**：關聯客戶、付款狀態、物流總狀態、總金額。
4. **`order_items` (訂單明細表)**：關聯訂單與產品、購買數量、成交單價、單品到貨狀態、是否為旅購。
5. **`payments` (付款紀錄表)**：記錄實收金額、付款管道（FPS/PayMe/銀行轉賬/現金）、收據雲端 URL、OCR 參考編號、對數狀態。
6. **`expenses` (營運開支表)**：記錄進貨成本、物流運費、旅購差旅、倉儲租金等會計分類，供報稅使用。

---

## 4. 開發過程中的額外增修項目 (Scope Creep & Change Log)

在實際開發與討論過程中，衍生出以下原先 Planning 未涵蓋但實戰極需的功能：
* **`product_expire_records` (產品有效期限/批次到期記錄)**：因代購零食及護膚品涉及保質期，需獨立追蹤各批次到期日，保障長期客戶品質並避免客訴。
* **人手覆核機制 (Manual Review Queue)**：針對非標準 WhatsApp 留言或模糊付款截圖，提供待人手確認狀態，防止 AI 誤判。
* **後台商品管理欄位增修**：於 `product.html` 新增「產品有效期限 / 批次日期 (Best Before Date)」輸入欄位，並同步更新前端卡片顯示邏輯。

---

## 5. 近期開發進度與除錯記錄 (Troubleshooting & Current Status)

* **跨裝置開發環境**：透過 OneDrive 同步原始碼，於不同 Notebook（例如屋企與公司電腦）之間切換開發。
* **Port 3000 佔用問題**：曾遇上 `EADDRINUSE` 錯誤（Port 3000 被背景舊 Node.js 程式佔用），已透過指令（如 `Stop-Process` 或重啟 VS Code）順利解決。
* **`product.html` 表單驗證修復**：
  * 新增了有效期限日期選擇器。
  * 修正了分類下拉選單未選擇時觸發後端驗證錯誤（「商品分類必須是 1 至 100 個字元」）的問題。

```



--------------------------------
# 🪐 LittlePlanet 小行星 — 會員中心與 Google OAuth 安全登入系統規格書

本文件記錄了會員系統的整體架構、核心商業邏輯、後端與前端的設定方式，供日後維護與查閱。

  

## 一、 核心商業邏輯與資安設計理念

1. **極速結帳，零阻力落單**：
    
      
    - 顧客在網店結帳時，**不需要強制註冊帳號或進行 Google 登入**。
        
          
        
    - 顧客僅需填寫收件資料與**手提電話號碼**即可完成下單，最大程度降低結帳門檻，提升轉化率。
        
          
        
    - 系統會將訂單記錄以手提電話號碼（`customer_phone`）寫入 `orders` 資料庫。
        
          
        
2. **高安全防護的會員中心**：
    
      
    - 當顧客事後希望查看歷史訂單、追蹤物流或管理收藏時，進入會員中心 (`customer.html`)。
        
          
        
    - 為了防止惡意人士單憑猜測或輸入別人的電話號碼來偷看敏感帳單，**會員中心強制採用 Google OAuth 進行高安全性身份驗證**。
        
          
        
3. **無縫認領機制（新舊帳號串接）**：
    
      
    - 當顧客首次使用 Google 帳號登入時，因舊訂單僅記錄了手機號碼，系統會顯示「暫無歷史訂單」。
        
          
        
    - 系統提供溫和且安全的「歷史訂單認領」**功能：顧客只需輸入一次以前下單的**舊手機號碼 + 其中一張訂單編號進行核對。
        
          
        
    - 核對成功後，後端會自動將該手機號碼過往的所有歷史訂單永久綁定到此 Google Email（填入 `customer_email`），此後一勞永逸。
        
          
        

## 二、 雲端平台與後台設定對照

### 1. Google Cloud Console 設定

- **專案名稱**：`LittlePlanet`
    
      
    
      
    
- **OAuth 2.0 用戶端設定**：建立網頁應用程式用戶端 ID。
    
      
    
- **重新導向 URI (Redirect URI)**：必須填入 Supabase 專屬的回調網址：
    
      
    
    Plaintext
    
    ```
    https://wteditztyndkfvnzkpvn.supabase.co/auth/v1/callback
    ```
    
- **注意**：建立後取得 `Client ID` 與 `Client Secret`。
    
      
    

### 2. Supabase Dashboard 設定

- 路徑：`Authentication` -> `Configuration` -> `Sign In / Providers` -> 啟用 **Google**。
    
      
    
- 填入從 Google Cloud 取得的 `Client ID` 與 `Client Secret` 並點擊儲存。
    
      
    

## 三、 後端 API 架構 (`src/routes/customer.js`)

後端採用 Node.js / Express，所有敏感金鑰（如 Service Role Key、Session Secret）均嚴格鎖在 `.env` 檔案中，絕不外洩。

  

### 主要端點 (Endpoints)：

- `GET /api/customer/config`：安全提供前端所需的公開配置（`SUPABASE_URL` 與 `SUPABASE_ANON_KEY`），實現零硬編碼。
    
      
    
- `POST /api/customer/member/google-session`：接收前端的 Google Bearer Token，透過 Supabase 驗證後簽發安全的 HttpOnly Session Cookie。
    
      
    
- `POST /api/customer/member/link-phone`：驗證舊手機與訂單號碼，將歷史訂單的安全歸屬轉移至當前的 Google Email。
    
      
    
- `POST /api/customer/member/session`：傳統「手機 + 訂單號碼」快速驗證登入。
    
      
    
- `GET /api/customer/member/session`：檢查當前登入狀態（支援 Google 與 Phone 雙軌識別）。
    
      
    
- `POST /api/customer/member/logout`：清除安全 Cookie，安全登出。
    
      
    
- `GET /api/customer/orders`：根據當前登入身份（Google Email 或多格式電話變體）完美撈出所有歷史訂單與商品明細。
    
      
    

## 四、 前端介面架構 (`public/customer.html`)

前端採用 Tailwind CSS 打造現代化 UI，並透過 Supabase JS SDK 實現安全無縫的互動。

  

### 核心運作流程：

1. 頁面載入時，自動向後端請求 `/api/customer/config` 動態初始化 `supabaseClient`。
    
      
    
2. 檢查是否有 Google OAuth 登入回調或現有 Cookie Session。
    
      
    
3. 渲染雙軌登入介面（Google 一鍵登入按鈕 + 傳統手機快速驗證）。
    
      
    
4. 登入成功後動態載入歷史訂單；若為 Google 登入且無對應訂單，則自動顯示「認領舊手機訂單」黃色提示區塊。
    
      
    

這套系統兼具了**極佳的電商轉換率（免強制作業落單）**與**頂級的資安防護（Google OAuth 驗證 + 隱私保護）**，並且程式碼結構清晰、無任何敏感密鑰外洩風險。