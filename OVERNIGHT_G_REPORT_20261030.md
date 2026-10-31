# G - 運費、自取時段與預購自動截單成果

## 分支與安全核對

- 工作分支：`pj1/dev-next-g-shipping`
- 基底：`origin/pj1/dev-next`，commit `ab2ea5a`。
- 封存檔核對：`images.tar` 為 894,679,040 bytes，SHA-256 `3D91F03B5292A82F77D4338316D6E446D767356E6FE33CC37236D651C96CAC41`；操作前後均一致。
- 依交接清單，封存檔是 Docker 映像而非商品圖片；清單列出的 7 個映像為 `littleplanet-app`、`postgres 17.6.1.136`、`gotrue 2.197.0`、`realtime 2.143.3`、`storage-api 1.81.0`、`postgrest 14.18`、`caddy 2.10.2`。
- `database/family-rag`、`src/rag`、`.env.docker` 無變更；`source/products.csv` 保持未追蹤，沒有提交。
- 沒有連接資料庫、寫入資料庫或套用 migration。

## CSV 與運費

- 桌面機 CSV 有 27 列、商品 ID 4268–4294；缺少 `weight`、`pickup_location_id`，27 筆 `preorder_deadline` 均空白。
- CSV 的 `status` 為 `preorder`，不是已核實的資料庫商品狀態，因此不會將這些列當成可截單商品。
- 結帳新增後端重量分段計算、自取地點／時段驗證及 service-role RPC 寫入。自取地點運費為 HK$0；配送分段為 ≤5 kg HK$30、>5 至 10 kg HK$50、>10 kg HK$80。
- 由於實際重量缺失，無法產生真實配送費；後端記錄「資料不足」，按要求以 HK$0 作為結帳預設值。客戶提供的 `shipping_fee` 不會覆蓋伺服器計算值。

## 預購自動截單 dry-run

- 過期候選：0。
- 缺少截止時間：27。
- 無效資料列：0。
- 不支援的狀態值：27。
- 結果為「資料不足」；未推定日期或修改任何商品。關單函式只將過期且 `status='預購中'` 的商品轉為既有狀態 `已下架`，不改動付款或物流狀態。
- 本次不會發送 WhatsApp 訊息；排程與授權呼叫仍需另行配置。

## Migration 與測試

- 建立靜態 migration：`20261031000100_preorder_auto_close.sql`、`20261031000200_shipping_fee_pickup.sql`。尚未套用；結帳 RPC 與自動關單 RPC 均限制為 `service_role`。
- `npm test`：218 tests，217 passed，0 failed，1 skipped。
- `npm run lint`：通過。
- `git diff --check`：通過。

## 後續

1. 補齊並核實商品公斤重量及自取地點識別碼／時段來源，重新計算實際費用；在重量資料可用前不可把 HK$0 視為已核實運費。
2. 先在獲授權的部署流程套用兩個 migration，再以測試環境確認 RPC 權限、冪等重試、訂單總額和自取欄位。
3. 由營運確認 CSV 狀態及預購截止時間映射後，才安排具授權的自動關單呼叫。
