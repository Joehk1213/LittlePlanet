# LittlePlanet 專案協作指引

## 1. 業務背景與不可違反規則

- LittlePlanet 是營運約十年的香港零售／代購網店，主要透過 WhatsApp、Facebook、Instagram 經營；WhatsApp 群約 1,200 人，另有熟客。商品來源包括批發商及店主旅購。
- 現行系統以 Node.js、Express、Supabase/PostgreSQL 及原生 HTML/CSS/JavaScript 為準。PRD 提到的 React、Python、n8n、AI 自動接單等屬構想，除非程式、依賴及部署文件證實，否則不可描述成現行功能。
- **貨到後付、出貨前清帳**：客人可先下單，貨到後再安排付款；出貨前必須確認訂單已付清。建立訂單、客人回報付款或上載付款憑證均不等於收款核實。付款狀態與付款憑證審核狀態是兩回事，不可互相代替或自動推定。
- 不得擅自改變訂金、信用評級或放貨規則。任何與現行政策不同的例外流程，先取得店主確認，並同步檢查後端驗證、管理介面及測試。
- **截單與 WhatsApp 提醒**：營運流程要求截單前一天提醒；商品以 `cutoff_datetime`、`remind_status` 等欄位記錄提醒狀態，提醒路由由外部排程／授權呼叫執行。發送器、收件對象及排程未設定時，不可宣稱提醒已自動送出。保留防重複、失敗記錄及安全重試行為。
- **實體倉與箱號**：貨品實際存放位置以 `A1`、`B2` 等箱號辨識，但目前 migrations 未建立正式箱號欄位／完整箱位模型。不得假設 `box_location` 已存在或自行將箱號塞入不相干欄位。若要實作，先確認一個商品可否分置多箱、箱內數量及入庫／執貨更新規則，再設計 migration、介面與測試。
- `product_stock_batches.quantity_remaining` 目前不是扣除銷售後的實際箱內餘量；未有批次分配政策前，執貨及商品總庫存以現有權威流程為準，不可把批次餘量當成可履約庫存。

## 2. 規格與資料庫依據

新增或修改功能前，依次核對：**目前 migrations、實際程式與測試 → 部署文件 → PRD／Excel／營運手稿**。PRD 是業務目標，不是現行 schema；發現衝突時採用已實作 schema，並在回覆中說明差異。無法確認的欄位或規則要明確標為待確認，不可猜測。

目前已核實的核心資料對應如下；欄位以 migration 為準，實作前仍須檢查最新定義：

| 資料 | 現行基準 | 注意事項 |
|---|---|---|
| `products` | 以 `id` 識別商品，含現行商品名稱、價格、`stock`、`status` 等欄位；`cost_price`、`cutoff_datetime`、階梯價等屬已擴充欄位，須按 migration 確認。 | PRD 的 `title`、`wholesale_price` 等不一定是現行欄位。 |
| `orders` | 以 UUID `order_id` 作內部識別，對客使用正式 `order_number`；另有 `customer_phone`、`customer_name`、`shipping_address`、`total_amount`、`order_date`、付款及物流欄位。 | 絕不把內部 UUID 當正式訂單編號展示或用作訪客驗證。 |
| `order_items` | 以 `order_id`、`product_id` 關聯，含 `quantity`、`unit_price`、`item_status`、`is_travel_buy` 等欄位。 | 明細到貨狀態、訂單付款狀態及物流狀態各自獨立。 |
| `customers` | 以 UUID `id` 及唯一 `customer_phone` 識別，另有 `customer_name`、`credit_status`、`default_shipping_method`、`notes`、`created_at`。 | PRD 的 `whatsapp_id`、`credit_rating`、`permanent_member` 等不是已核實的現行欄位。 |
| 箱號／倉位 | 未核實有正式欄位或關聯表。 | 需求見營運手稿；未有 migration 前只可視為待實作。 |

- 訂單付款狀態目前使用 `未付款`、`已付訂金`、`已付清`；物流狀態使用 `待到貨`、`部分到貨`、`可出貨`、`已出貨`。修改前核對 migration 約束及現有路由，勿自行引入同義狀態。
- `payment_proof_status` 使用 `pending`、`verified`、`rejected`，與 `payment_status` 分開。付款憑證存於私有 Storage；不可把私有物件路徑當公開 URL，後台預覽應沿用短效簽署連結的現有方式。
- 顧客單筆訂單查詢必須同時核對正規化後的電話及正式 `order_number`（AND）；不能退回只憑電話或只憑訂單號查詢。
- PRD 所列 `payments`、`expenses`、箱號欄位及 AI OCR／群組自動監聽功能，只有在對應 migration、程式和測試均存在時，才可稱為已實作。

## 3. WhatsApp 訊息及短格式落單

- 常見輸入包括 `B款 x3`、`b x 3`、`A x 1, C x 1`。目前 webhook 支援的指令以程式實作為準；它的 UUID 查單／付款回報功能不代表已支援上述短格式自動落單。
- 如新增解析器，先按該商品帖文或明確 SKU／款式表建立唯一對照；不可只以字母猜商品。正規化大小寫、空格及明確支援的分隔符／乘號，並保留原始訊息供核對。
- 驗證每個代號唯一有效、商品仍可售、數量為正整數並符合系統上限；檢查重複項目、超量及混合格式。解析不完整、代號不明或對應多個商品時，不建立訂單，要求客戶／店主確認。
- 自動建單前回顯商品、款式、數量及價格並取得確認；對 webhook 重送採用冪等／去重，避免同一訊息重複落單。不得把 AI／OCR 推測結果當作已確認訂單、付款或收貨事實。

## 4. 開發、錯誤處理與協作流程

- 延續現有目錄、命名、Express router、中介層、Supabase helper 及前端寫法；新增共用邏輯前先搜尋可重用的 helper／既有路由。避免無關重構。
- 所有非同步 API 路由採明確 `try...catch`；檢查 Supabase 回傳的 `error`，用專案既有錯誤處理及 `{ success, data, message }` 回應格式。不可吞掉錯誤、回傳成功形狀的預設值或暴露堆疊、機密資料。
- 機密只從環境變數讀取；service-role key 不得送到瀏覽器。管理 API 必須沿用管理員認證及授權範圍；訪客路由只回傳必要資料，避免洩漏電話、付款憑證或內部 UUID。
- DB 變更須建立有序 Supabase migration，沿用現有 RLS、GRANT／REVOKE、約束、索引及 RPC 權限模式；更新直接相關測試與部署文件，不可假設 migration 已套用。
- 註釋只補充非顯而易見的原因，使用繁體中文並遵循鄰近程式風格；前台文字採香港繁體中文。維持型別／輸入驗證及既有 API 行為。
- 執行任務時依序：讀取相關 routes、migrations、前端及測試 → 核對實際欄位／業務規則 → 作最小完整修改 → 跑涵蓋變更的測試（需要時再跑 `npm test`）→ 回報修改、測試結果及尚未驗證的部署條件。
- 涉及付款政策、箱號資料模型、模糊訊息自動建單、生產資料操作或不可逆變更時，先向店主確認；不得在未授權下修改生產資料或執行破壞性操作。

## 5. 主要參考

- [部署與 migrations 指南](../DEPLOYMENT.md)
- [商品上架 SOP](../notes/SOP.md)
- [專案規格摘要](../notes/大崗規格書.md)
- Supabase migrations：`supabase/migrations/`
- 目前 webhook 行為：`routes/webhook.js`
