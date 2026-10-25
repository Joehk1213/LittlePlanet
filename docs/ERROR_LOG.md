# LittlePlanet 常見錯誤紀錄與處理範本

> 以下是供排查及交接使用的常見情境範本；除非另有事故紀錄，不代表每次出現都已確認為正式環境事故。

## 重構後程式位置

- 服務入口是根目錄 `index.js`；API 路由集中於 `src/routes/`，middleware 位於 `src/middleware/`，共用工具位於 `src/utils/`。
- `/api/customer` 會員路由在 `src/routes/customer.js`；`/api/admin/customers` CRM 管理路由在 `src/routes/customers.js`，不可因檔名相似而混用。
- 付款憑證路由使用 `src/routes/payments.js`（舊名 `payment-proofs.js`）；Webhook 使用 `src/routes/webhooks.js`（舊名 `webhook.js`）。
- 前台圖片目錄為 `public/assets/images/`，不再使用 `public/image/`。
- 部署與本機啟動方式見 [`DEPLOYMENT.md`](./DEPLOYMENT.md)。

## Port 3000 佔用（`EADDRINUSE`）

- **症狀：** Node.js 啟動失敗，錯誤包含 `listen EADDRINUSE` 或 `address already in use :::3000`。
- **常見原因：** 另一個本機開發伺服器仍在執行，或同一服務重複啟動。
- **排查：** PowerShell 執行 `Get-NetTCPConnection -LocalPort 3000 -State Listen | Select-Object LocalAddress, LocalPort, OwningProcess`，再以 `Get-Process -Id <OwningProcess>` 確認該 PID 的程式與用途。
- **處理：** 若確認是可停止的舊開發程序，使用 `Stop-Process -Id <已確認的 PID>` 後重啟。不要使用名稱型或未核實 PID 的終止指令；若程序用途不明，先保留並查明來源。
- **預防：** 關閉舊終端的開發程序；啟動前檢查 3000 port，並確認只執行一個預期的 server instance。
- **事故紀錄：** 日期／環境：待填；PID：待填；原因：待確認；處理結果：待填。

## 前端 `.json()` 遇到純文字／非 JSON 錯誤

- **症狀：** API 或代理伺服器回傳純文字／HTML（例如錯誤頁），前端執行 `response.json()` 時再拋出 `SyntaxError`，遮蓋原本的 HTTP 錯誤。
- **常見原因：** 上游錯誤頁、反向代理回應、服務未啟動，或回應本文為空／格式錯誤。
- **排查：** 記錄 HTTP status 與 `Content-Type`；在不記錄電話、訂單內容或 token 等敏感資料的情況下檢查回應本文格式。
- **處理：** 對預期 JSON 的請求明確捕捉 JSON 解析失敗，轉為結構化錯誤訊息，不要把解析失敗視為成功。可在解析前檢查 `Content-Type`，或先讀取 `response.text()` 再安全解析。
- **預防：** API 錯誤維持 `{ success, data, message }` 格式；前端同時處理非 2xx 與無效 JSON，顯示明確提示並保留必要的重試／表單狀態。
- **事故紀錄：** 日期／環境：待填；端點：待填；HTTP status／Content-Type：待填；原因：待確認；處理結果：待填。