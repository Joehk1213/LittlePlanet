# F 100 張合成測試訂單摘要

注意：source/products.csv 不存在；這 100 張單採用合成範例商品與價格，不代表真實訂單或利潤。

- 商品來源：`source\products.csv.example`
- 可用商品數：5（不合格 CSV 列不會被用來生成測試訂單）
- 訂單數：100
- 電話：只使用合成 8 位數字 `5550xxxx`，資料欄位保存為 `8525550xxxx`；禁止用於 WhatsApp／SMS 通知
- UUID v4 order_id / idempotency_key：每張單各自固定且唯一
- 合計毛利（只按測試商品成本計算）：HK$2678.00
- 平均明細列數：1.93
- 平均件數：5.34
- 訂單狀態分布：

| 狀態 | 數量 |
| --- | --- |
| pending | 10 |
| paid | 16 |
| shipped | 13 |
| picked_up | 19 |
| completed | 13 |
| cancelled | 29 |

輸出：`F_TEST_ORDERS_100.json`。資料內含 `is_test_data: true`，只供離線負載測試 fixture 使用；不會連線或寫入資料庫。
