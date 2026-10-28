# Overnight Value Report - 2026-10-29 03:17 +08:00

## Environment and safety

- Machine: `JOE-SERVER`
- Branch / HEAD: `pj1/dev-next` / `3d46aa7` (working-tree changes not committed at report time)
- Pure PJ1 archive: `D:\docker-data\littleplanet\images.tar`, 894,679,040 bytes, SHA256 `3D91F03B5292A82F77D4338316D6E446D767356E6FE33CC37236D651C96CAC41` at both start and end.
- Protected paths `database/family-rag`, `src/rag`, and `.env.docker` have no changes. No database connection, SQL execution, migration application, or CSV import was performed.
- `source/products.csv` is absent on this host. It was not created, copied, staged, or committed. Accordingly, no CSV dry-run report or product top-10 ranking can truthfully be produced.

## E final status

- Migration `20261030000100_admin_order_status_profit.sql` is present and statically reviewed. It maps legacy `shipping` to `shipped`, aborts on other unknown statuses or missing customer phones, extends the existing status constraint, and defines a service-role-only profit view and row-locked status transition RPC.
- The view uses the repository's actual schema (`orders.order_id`, `order_items.item_id`, `order_items.quantity`, and `products.id`); `items_count` is the sum of item quantities. Unknown product cost remains `NULL` in profit rather than being treated as zero.
- Existing schema uses `payment_status` values such as `已付清`, shipping values such as `可出貨` and `已出貨`, and `order_date` rather than `created_at`. The migration and endpoint preserve those established columns and safeguards; they do not introduce the proposed English database values or email identity.
- Existing status PATCH and the new admin PATCH both call the shared transition RPC; the admin listing is protected by the existing `orders` session scope and uses service-role access. Pino logs only the phone suffix for filtered listings.
- `npm test` was run three times: each run **190 tests, 189 passed, 0 failed, 1 skipped** (local anon RLS test). `npm run lint` passed. JavaScript syntax, HTML inline-script parsing, and `git diff --check` passed.
- `npm ci` was not run: `node_modules` is present and no dependency manifest changed for this task.
- Migration is not live-verified because database access and migration application were explicitly prohibited.

## Profit reporting

No live profit query was run. Once the migration is reviewed and separately approved for deployment, the following is a read-only sample query for a service-role reporting context:

```sql
SELECT
  o.order_number,
  o.customer_phone,
  o.status,
  o.order_date,
  p.items_count,
  p.profit_total
FROM public.order_profit AS p
JOIN public.orders AS o USING (order_id)
ORDER BY p.profit_total DESC NULLS LAST
LIMIT 10;
```

**Top 10 profit products:** unavailable in this run because `source/products.csv` was not found and live database reads were not authorized. No product ranking or profit figures are fabricated.

## CSV dry-run

- Status: not run; source file absent.
- When the owner provides `source/products.csv`, the dry-run should validate the actual repository schema and safely report invalid IDs, duplicates, negative stock, missing costs, and cost-versus-price anomalies without importing data. The proposed `tier_prices` and `preorder_deadline` columns must first be verified against that CSV and current migrations.

## Next suggestion F - Product CSV Import + Image + Preorder Auto-Close

1. **CSV contract and dry-run validator** — Acceptance: required/optional columns are derived from the approved CSV and migrations; reports duplicate/invalid product IDs, numeric/range errors, missing costs, and price anomalies; never writes to the database.
2. **Approved transactional import design** — Acceptance: owner approves upsert/identity rules; migration or RPC validates the complete batch atomically, is idempotent, and does not change order, payment, or stock-batch semantics.
3. **Image mapping and validation** — Acceptance: every image maps to one validated product ID; missing, duplicate, or unsupported files are reported; no image archive is rebuilt or overwritten without approval.
4. **Preorder cutoff and auto-close** — Acceptance: uses the verified cutoff field and existing reminder policy; close operation is idempotent, records failures, and has tests for boundary times and retries.
5. **Admin review, reconciliation, and rollback** — Acceptance: preview/diff and per-row errors are available before apply; totals reconcile after apply; an approved rollback/recovery procedure and tests exist before production use.

## Next suggestion G - Shipping fee + pickup time slot

- Confirm fee ownership/calculation and free-shipping thresholds, and whether pickup time slots require a new persisted schema. Then implement server-side validation, admin/customer UI, migration/RLS if needed, and tests for fee totals, unavailable slots, and timezone boundaries. Do not infer the shipping fee policy or store pickup data in unrelated fields.
