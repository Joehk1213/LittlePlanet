# F 商品圖片對帳報告

CSV 真檔不存在；商品 URL 只來自合成範例，不能代表真實缺圖率。

## 商品圖檔結果

- CSV 來源：`source\products.csv.example`
- 本機候選圖片目錄：`public/images`、`public/assets/images`、`app/images`
- 候選本機圖片檔：3
- CSV 本機圖片 URL 找不到檔案：4
- CSV 遠端 HTTP(S) URL（未發出網絡請求）：1
- 未被 CSV 本機路徑引用的候選圖片（可能是 UI 圖示，非必然孤兒商品圖）：3

| 商品 ID | image_url | 結果 |
| --- | --- | --- |
| 4268 | /assets/images/example-sticker-a.jpg | 本機圖片目錄找不到檔案 |
| 4269 | /assets/images/example-bag-b.jpg | 本機圖片目錄找不到檔案 |
| 4270 | /assets/images/example-cup-c.jpg | 本機圖片目錄找不到檔案 |
| 4272 | /assets/images/example-box-e.jpg | 本機圖片目錄找不到檔案 |

## 遠端 URL（未驗證）

| 商品 ID | URL |
| --- | --- |
| 4271 | https://example.invalid/images/sample-charm-d.jpg |

## 未被 CSV 引用的本機候選圖片（可能包含 UI 資產）

| 本機相對路徑 |
| --- |
| assets/images/littleplanet.png |
| assets/images/pwa-icon-192.png |
| assets/images/pwa-icon-512.png |

## Docker archive 說明

- Archive：`D:\docker-data\littleplanet\images.tar`
- Archive 大小：894679040 bytes
- 預期純 PJ1 SHA256：`3D91F03B5292A82F77D4338316D6E446D767356E6FE33CC37236D651C96CAC41`
- Docker manifest 路徑：`D:\docker-data\littleplanet\docker_images.txt`
- Manifest 中的 Docker image references：9
- Docker image references 是容器映像名稱，不是商品圖片檔清單；`images.tar` 是 Docker image archive，不能用來判定商品 `image_url` 是否存在。
- handover `MANIFEST.txt` 是檔案交接清單，非目前 tar 內的商品圖清單；本報告不把其歷史路徑誤判為目前可用圖片。
