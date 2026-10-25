# LittlePlanet 專案控制清單

## 重構後檔案位置

- 顧客會員功能：[`src/routes/customer.js`](../src/routes/customer.js)，掛載於 `/api/customer`。
- 管理員顧客 CRM：[`src/routes/customers.js`](../src/routes/customers.js)，掛載於 `/api/admin/customers`；兩個檔案用途不同，請勿合併或互換。
- 付款憑證路由：[`src/routes/payments.js`](../src/routes/payments.js)（原 `payment-proofs.js`）。
- Webhook 路由：[`src/routes/webhooks.js`](../src/routes/webhooks.js)（原 `webhook.js`）。
- 前台圖片：[`public/assets/images/`](../public/assets/images/)（原 `public/image/`）。
- 部署說明：[`DEPLOYMENT.md`](./DEPLOYMENT.md)；錯誤排查範本：[`ERROR_LOG.md`](./ERROR_LOG.md)。

## 已完成

- [x] 基礎架構：Node.js、Express、Supabase 與靜態前台。
- [x] 商品 CRUD。
- [x] 庫存批次管理。
- [x] Google 登入與歷史訂單認領。
- [x] 結帳成功回傳正式易讀 `order_number`，前端拒絕 UUID 並以電話及訂單編號前往訂單追蹤頁。
- [x] 訪客單筆訂單查詢同時驗證電話號碼及正式訂單編號（AND）；已檢查 `/api/orders/query-order` 與 `/api/customer/orders/lookup`。

## 進行中／待辦

1. [x] 結帳成功後前端／回傳改為顯示易讀正式訂單編號（例如 `LP-20261017-0003`），不得使用內部 UUID。已完成；結帳 API 回傳 `order_number`／`orderNo`，不回傳 `order_id`，前台會驗證後導向追蹤頁。
2. [x] 收緊訪客單筆訂單查詢，由 OR 改為必須同時輸入電話號碼 `AND` 訂單編號。已完成並確認兩個訪客查詢入口均對電話與訂單編號套用 AND 條件。

## 後續規劃

- 尚無未完成項目；新增需求請先列出影響範圍、依賴項及驗收測試，再開始實作。