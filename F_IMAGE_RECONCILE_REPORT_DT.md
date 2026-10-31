# F2 商品圖片對帳報告

- 日期：2026-10-30
- CSV 結果：以唯讀方式檢查；沒有發出網絡請求或修改圖片。

## 商品圖片

- CSV 商品列：27
- `public/images` 目錄存在：否
- `public/images` 本機圖片數：0
- CSV 遠端 HTTP(S) 圖片 URL（未請求、未驗證）：27
- CSV 指向但本機找不到的圖片：0
- 無效／不安全的本機圖片路徑：0
- 空白圖片欄：0
- 未被本機 CSV 路徑引用的圖片：0
- `public/assets/images` 中 UI/PWA 候選圖片：4（不當作商品圖片）

_沒有可列出的項目。_

_沒有可列出的項目。_

## Docker archive（不是商品圖片）

- 封存檔核對通過：894679040 bytes，SHA-256 3D91F03B5292A82F77D4338316D6E446D767356E6FE33CC37236D651C96CAC41。
- 路徑：`C:\docker-data\littleplanet-handover\images.tar`
- handover 列出的 7 個 PJ1 Docker image tags：
- `littleplanet-app`
- `postgres:17.6.1.136`
- `gotrue:2.197.0`
- `realtime:2.143.3`
- `storage-api:1.81.0`
- `postgrest:14.18`
- `caddy:2.10.2`
- `images.tar` 是 Docker container image archive，以上 image tags 不是商品圖片；不得以 Docker archive 判定 CSV 的 `image_url` 缺圖。
- 遠端 Supabase Storage URL 未作 HTTP 請求，因此本報告只標記為未驗證，不宣稱圖片缺失或可用。
