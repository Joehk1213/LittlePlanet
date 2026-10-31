# PR #3 Shipping Initialization Fix — 2026-10-31

## Issue and root cause

Orders created before `20261031000200_shipping_fee_pickup.sql` receive the migration defaults `shipping_fee = 0` and `shipping_details_initialized = false`. The order reads and tracking page previously ignored the initialization flag, presenting the default zero as a confirmed shipping fee.

## Fix

- Both admin order-list APIs now read `shipping_details_initialized`. Only an exact `true` exposes shipping fee/location/slot; false, null, missing flag, or missing optional columns return null values and `shipping_details_message: "資料不足"`, while keeping the admin list available.
- Customer order lookup now exposes the same explicit insufficient-data state and retries without optional shipping columns if the schema does not contain them.
- Customer tracking only calculates the displayed subtotal and formats a fee when shipping details are initialized; otherwise fee and derived subtotal show `資料不足`.
- `calculateShippingFee` already returns `null` for missing catalog/weight data; its existing behavior is covered by shipping tests and was not changed.
- Payment/status transition guards, notification timing, and profit calculations were not changed.

## Changed files

- `src/routes/admin/orders.js`
- `src/routes/orders.js`
- `public/track.html`
- `tests/admin-orders.test.js`
- `tests/orders.test.js`
- `tests/storefront-ux.test.js`
- `docs/PR3_FIX_SHIPPING_FLAG_20261031.md`

## Verification

- Baseline: 299 tests / 298 passed / 0 failed / 1 skipped.
- After fix: **303 tests / 302 passed / 0 failed / 1 skipped**.
- Targeted order, shipping and tracking tests: 58 passed / 0 failed.
- `npm ci`: PASS.
- `npm run lint`: PASS.
- `git diff --check`: PASS.
- Status transition migration still uses `FOR UPDATE`, requires payment `已付清` before paid/shipped/picked-up transitions, and separately checks shipment confirmation.
- `order_profit` remains restricted to `service_role`; missing cost data still yields `NULL`, not zero.
- Phone normalization, product ID validation, and idempotency code remain unchanged.

## Safety and data gates

| Archive | Length | SHA256 | Result |
|---|---:|---|---|
| `C:\docker-data\littleplanet-handover\images.tar` | 894,679,040 | `3D91F03B5292A82F77D4338316D6E446D767356E6FE33CC37236D651C96CAC41` | PASS before and after |
| `D:\docker-data\littleplanet\images.tar` | 894,679,040 | `3D91F03B5292A82F77D4338316D6E446D767356E6FE33CC37236D651C96CAC41` | PASS before and after |

- No worktree changes under `database/family-rag`, `src/rag`, or `.env.docker`.
- `source/products.csv` is absent on JOE-SERVER: product weight/cost/deadline reports remain **資料不足**; no CSV was added.
- `docker-compose.prod.yml` is absent: **config 未驗證**.
- Migrations were inspected statically only; no database, Docker, or WhatsApp operation was performed.

## Final record

混合版結構統一修正記錄，PJ1 + PJ2 兩邊都已入檔，RULE 1-4 檔名結構 PASS，TODO 0。PJ1 未掂 PJ2 嘅檔，PJ2 未掂 PJ1 嘅檔，D: 未掂。
