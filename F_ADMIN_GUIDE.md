# F Admin and Catalog Guide

## Order status and profit (E)

Use the admin order page while signed in with the `orders` scope. Filter by phone, order status, or date range; the API normalizes phone search and returns order items, quantity totals, and per-order profit. Profit is unknown when any product cost is missing.

Allowed order-state transitions:

| Current | Next |
|---|---|
| `pending` | `paid`, `cancelled` |
| `paid` | `shipped`, `picked_up`, `cancelled` |
| `shipped` or `picked_up` | `completed` |

The order state is separate from the payment-proof review, payment state, item arrival, and shipping state. Do not mark an order paid based on a customer-submitted proof alone. The server requires verified `已付清` before paid/shipped/pickup and confirmed shipment/pickup conditions where applicable.

## F catalog dry-runs

1. Put the approved input at `source/products.csv`; do not overwrite or commit the shop's real CSV.
2. Run `node scripts/f-validate-products.js`. It reads only and writes `F_CSV_VALIDATION_REPORT.md` and `F_PROFIT_TRUTH_TOP20.md`.
3. Run `node scripts/f-reconcile-images.js`. It checks local public image folders, marks remote URLs unverified without contacting them, and reports Docker-image archive metadata separately from product image files.
4. Run `node scripts/f-preorder-auto-close.js`. It previews expired `預購中` rows and writes a comment-only `.sql.draft`. It does not update products. `旅購中` rows are not automatically closed.
5. Run `node scripts/f-generate-test-orders.js` to create 100 deterministic synthetic orders in `F_TEST_ORDERS_100.json`. They use fake `5550xxxx` phone values and are marked `is_test_data`; never use them for customer communications or production writes.

When `source/products.csv` is absent, scripts use `source/products.csv.example` only for an explicitly labelled demonstration. All example-derived totals, rankings, image gaps, and close candidates are synthetic and must not be presented as actual shop results.

## Product CSV contract notes

- Required columns for this validator: `id`, `name`, `price`, `cost_price`, `stock`, `tier_prices`, `preorder_deadline`, `image_url`.
- Product IDs are restricted to 4268–4294 by this requested dry-run policy.
- Current DB tier schema is `{ "min_qty": 2, "price": 12.5 }`; the validator accepts CSV `qty` as an alias but DB uses `min_qty`.
- Current product status values are `預購中`, `旅購中`, `已到貨`, `已下架`. Do not use the proposed English `preorder` / `closed`.
- No import, database connection, SQL execution, migration application, or external image request is performed by these scripts.
