# H - WhatsApp 與提醒工作成果

## 分支與安全核對

- 工作分支：`pj1/dev-next-h-whatsapp`，基於 `origin/pj1/dev-next` 的 `ab2ea5a`。
- 原 G 工作保存在本機 `preserve pre-H` stash；G 與 F2 分支均未修改，沒有推送或提交。
- `source/products.csv` 保持未追蹤；沒有讀取或修改 `.env.docker`、OneDrive、PJ2 或受保護的 family-rag 路徑。
- `images.tar` 操作前後皆為 894,679,040 bytes，SHA-256 `3D91F03B5292A82F77D4338316D6E446D767356E6FE33CC37236D651C96CAC41`。
- 封存檔是 Docker 映像而非商品圖片；交接清單包含 7 個映像：`littleplanet-app`、`postgres 17.6.1.136`、`gotrue 2.197.0`、`realtime 2.143.3`、`storage-api 1.81.0`、`postgrest 14.18`、`caddy 2.10.2`。
- 沒有連接資料庫、寫入資料庫、套用 migration 或發送 WhatsApp。

## 實作摘要

- 復用 `src/utils/whatsapp-order-parser.js` 及 webhook 的訂單意圖／客戶確認流程；parser 格式與限制詳見 [H_WHATSAPP_REPORT.md](./H_WHATSAPP_REPORT.md)。
- 新增 `src/utils/whatsapp-notify.js`，提供出貨、已付清提醒及未付款提醒文字、電話遮蔽、dry-run 和明確的 production 發送閘門。
- webhook 與通知共用 `normalize-phone.js`。管理員及舊訂單狀態 API 僅在 status RPC 成功且狀態變為 `shipped` 後觸發通知；失敗不影響狀態成功回應。
- 管理訂單列表及頁面兼容尚未有 G 運費欄位的資料庫，明確回傳／顯示「資料不足」。
- 新增 `scripts/h-whatsapp-reminder.js`。因本機沒有可用訂單資料，產生 0 筆候選並標示「資料不足」；未讀真實 DB 或推測訂單。
- 沒有新增 migration；G 的 migration 仍保持未套用且不在 H 分支。

## 驗證

- 基線：190 tests，189 passed、0 failed、1 skipped。
- 完成後：250 tests，249 passed、0 failed、1 skipped。
- `npm run lint`：通過。
- `git diff --check`：通過。

## JOE-SERVER 三輪驗收與整合建議

1. 在 SERVER 先確認 H branch ref 及 archive hash；SERVER 沒有商品 CSV，提醒及運費資料應顯示「資料不足」。
2. 在非正式測試環境執行三輪：管理員狀態成功、狀態 guard 拒絕、通知 mock 失敗；每輪確認沒有真實 WhatsApp 發送，`payment_status`／`shipping_status` 不被自動更改。
3. 確認 G migration 欄位存在／缺少兩種狀況的 fallback、提醒資料來源及 shipped timestamp 後，先在整合分支按 F2 → G → H 順序整合和解決衝突，再回歸測試，最後才提議合併至 `pj1/dev-next`。本次沒有執行該整合或推送。
