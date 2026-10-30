# F 商品毛利資料檢查

- 日期：2026-10-30
- CSV：source/products.csv
- CSV 商品列：27
- 成本資料：cost_price 欄位缺失，無法計算真 margin，資料不足。
- 本報告不以 retail_price 或其他欄位推測成本或毛利。

## 待補成本商品

| 商品 ID | 商品名稱 | 售價 | 狀態 |
| --- | --- | --- | --- |
| 4281 | COCO MCT OIL 椰子中鏈油 5g × 120袋入 | 258.00 | 待提供權威 cost_price |
| 4282 | NISSUI 日本水產 速筋之力 蛋白顆粒（抹茶風味）30條裝 | 168.00 | 待提供權威 cost_price |
| 4283 | ORIHIRO 低分子玻尿酸膠原蛋白顆粒50包 | 168.00 | 待提供權威 cost_price |
| 4284 | 日本漢方藥品葛根湯84 包 | 178.00 | 待提供權威 cost_price |
| 4285 | umios 鮭魚鬆(200g×3) | 178.00 | 待提供權威 cost_price |
| 4286 | umios 秋葵裙帶菜黏滑即食湯 12食入 | 138.00 | 待提供權威 cost_price |
| 4268 | True Blue 蜂膠麥蘆卡蜂蜜潤喉糖 800g | 198.00 | 待提供權威 cost_price |
| 4269 | UCHIPOTA 北海道濃厚蔬菜濃湯 20包入 | 168.00 | 待提供權威 cost_price |
| 4270 | IRIS FOODS 即食芝士燉飯 21入 | 168.00 | 待提供權威 cost_price |
| 4292 | Arencia 麻薯磨砂洗面膏套裝 | 218.00 | 待提供權威 cost_price |
| 4271 | KEWPIE丘比 即撈意粉醬綜合BOX 3種x 4食入 | 168.00 | 待提供權威 cost_price |
| 4272 | 味之素 Knorr 康寶 冷凍乾燥蓬鬆蛋花湯20入 | 138.00 | 待提供權威 cost_price |
| 4273 | marukome 料亭之味 減鹽即食味噌湯 72食 | 138.00 | 待提供權威 cost_price |
| 4274 | 鴨湯竹籠蕎麥麵 1.38kg 12食入 | 178.00 | 待提供權威 cost_price |
| 4275 | 新日本製藥 亞麻籽油套組（320g × 2 ） | 158.00 | 待提供權威 cost_price |
| 4276 | KIRKLAND 輔酶Q10軟膠囊 240粒 | 198.00 | 待提供權威 cost_price |
| 4277 | Asahi Dear-Natura Style 鐵×複合維他命60粒×2包 | 168.00 | 待提供權威 cost_price |
| 4278 | 小林製藥 眼鏡清潔濕巾 120包入 | 148.00 | 待提供權威 cost_price |
| 4279 | FUJIFILM  META BARRIER EX抗糖丸 45日分 | 288.00 | 待提供權威 cost_price |
| 4280 | 小林製藥 Easy Fiber 膳食纖維粉50 回分 | 148.00 | 待提供權威 cost_price |
| 4293 | ROUND LAB 樺樹汁保濕防曬套裝 | 268.00 | 待提供權威 cost_price |
| 4294 | 一榮食品 煙薰鵪鶉蛋420g | 158.00 | 待提供權威 cost_price |
| 4290 | EUTHYMOL 紫管美白牙膏套裝 | 238.00 | 待提供權威 cost_price |
| 4289 | UHA味覺糖 當地PREMIUM軟糖 (白桃&葡萄) 728g | 178.00 | 待提供權威 cost_price |
| 4288 | UHA味覺糖 巨峰葡萄 忍者軟糖 26g x 10小袋 | 128.00 | 待提供權威 cost_price |
| 4287 | Kanes 鍋巴即食湯 18食入 | 178.00 | 待提供權威 cost_price |
| 4291 | ROHTO樂敦 MELANO CC 淡斑美容液套裝 | 168.00 | 待提供權威 cost_price |

資料庫的 nullable cost_price 欄位已由既有 migration 建立；目前欠缺的是 CSV 成本資料，不應重複建立 migration。
