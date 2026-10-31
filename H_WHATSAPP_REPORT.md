# H - WhatsApp 訊息與提醒整合

## 既有落單 parser 稽核與復用

- Parser 位於 `src/utils/whatsapp-order-parser.js`，不是另建 WhatsApp API。
- 已支援格式如 `B款 x3`、`A x 1, C x 1`，亦會正規化全形字元並接受 `x`、`×`、`*` 數量分隔符。
- Parser 以唯一 `product_code` 對照商品；拒絕不明／重複代號、重複項目、無效數量、超過 1,000 件及不可售商品。
- Parser 只回傳經驗證的商品代號及數量，並不直接建立正式訂單。`src/routes/webhooks.js` 會將它們轉為商品 ID，建立訂單意圖及預覽，再要求客人以確認碼確認；重送交由既有訊息 ID 去重流程處理。
- 沒有重寫 parser，也沒有新增落單格式或跳過確認流程。

## 電話正規化與隱私

- `src/routes/webhooks.js` 與新通知服務共用 `src/utils/normalize-phone.js`：只移除首個 `+`，其餘須為 8–15 位數字；不會默默接受連字號等其他格式。
- WhatsApp 通知、Pino 記錄及提醒清單只輸出電話末四碼。通知訊息不包含電話或內部 `order_id`；除 dry-run 回傳的短訊息預覽外，不記錄訊息內容，預覽亦會遮蔽電話。
- 已付清及未付款提醒文字維持「付款狀態／憑證審核分離」及「貨到後付款、出貨前付清」政策，不把付款回報視為已核實收款。

## 出貨狀態通知

- 管理員 `/api/admin/orders/:order_id/status` 與舊 `/api/orders/admin/orders/:orderId/status` 都只在狀態 RPC 成功且新狀態為 `shipped` 後通知。
- 既有 `transition_admin_order_status` 的付款及物流 guard 原封不動；`paid`、`picked_up`、失敗的狀態跳轉不觸發出貨通知。
- 通知查詢及外部發送失敗均只記錄安全錯誤碼，不會回滾或阻止已成功的狀態轉移。
- 訊息包含正式訂單編號、取貨／送貨方式、運費及追蹤資料。G 的運費欄位未在 H 基線 migration 中；若資料庫尚無該欄，查詢會安全退回舊欄位並顯示「資料不足」。
- 管理訂單頁同樣在缺少運費欄位時顯示「資料不足」，不會假設運費為零。

## Dry-run 與真實發送限制

- `sendWhatsAppNotification` 預設 dry-run；`NODE_ENV=test`、dry-run 或缺少 WhatsApp token 時，不呼叫外部 API。
- 真實呼叫另需 `NODE_ENV=production`、`WHATSAPP_ENABLED=true`、service-role 可用及已配置 sender；development 下的 `--real` 會拒絕執行。
- 本次所有狀態通知測試都注入 mock sender；沒有呼叫 Graph API、沒有發送真實 WhatsApp 訊息。
- 提醒腳本不連資料庫、不寫入資料庫、不發送訊息，只使用明確傳入的模擬 JSON 訂單資料。

## 部署注意

- H 沒有新增或套用 migration。G 運費欄位 migration 尚未併入此基線；缺欄位 fallback 已測試。
- 真實提醒日期需以資料來源核實；`shipped` 提醒需要 `shipped_at`，若資料缺失會列為「資料不足」，不以 `order_date` 冒充出貨時間。
