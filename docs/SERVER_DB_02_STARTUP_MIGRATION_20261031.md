# SERVER-DB-02 Startup and Migration — 2026-10-31

## Result

**BLOCKED SAFELY — the authorized `db` service started and passed its readiness checks, but the mounted cluster does not contain the expected LittlePlanet/Supabase database schema. The service was stopped; neither migration was applied.** No production migration or application data change was performed.

## Safety gates and data preservation

- Host: `JOE-SERVER`.
- Repository: `C:\Project\LittlePlanet`; branch `pj1/dev-next` at starting commit `a79164a`.
- Both archive checks passed before startup and again after the database was stopped:

| Archive | Length | SHA256 | Result |
|---|---:|---|---|
| `C:\docker-data\littleplanet-handover\images.tar` | 894,679,040 | `3D91F03B5292A82F77D4338316D6E446D767356E6FE33CC37236D651C96CAC41` | PASS |
| `D:\docker-data\littleplanet\images.tar` | 894,679,040 | `3D91F03B5292A82F77D4338316D6E446D767356E6FE33CC37236D651C96CAC41` | PASS |

- The offline source `D:\docker-data\littleplanet\postgres_live` and backup `C:\backup\littleplanet-postgres_live-20261031\postgres_live` each contain 1,074 files / 42,451,226 bytes, report `PG_VERSION` 17, and had 0 per-file SHA256 mismatches when rechecked.
- The Compose target `D:\docker-data\littleplanet\postgres` contained 1,074 files / 42,455,160 bytes after startup and clean shutdown. Its size changed during PostgreSQL startup; this post-start directory was not represented as an untouched backup.
- `D:\docker-data\littleplanet\.env.docker` still points `LITTLEPLANET_DATA_ROOT` to `D:\docker-data\littleplanet`; the backup `.env.docker.bak-20261031` exists. No environment values or secrets were recorded.
- The `app-db-1` service was stopped after the schema mismatch was found. The remaining running containers were the pre-existing `familysystem-*` containers; none were operated on. No `postmaster.pid` remained.
- No worktree changes were found under `database/family-rag`, `src/rag`, `.env.docker`, or `source/products.csv`. `source/products.csv` is absent, so real product cost/weight data remains **資料不足**.

## Startup and Compose evidence

- Compose config validated before startup. The `db` service used image `supabase/postgres:17.6.1.136`, had no declared service dependencies, and bound `D:\docker-data\littleplanet\postgres` to `/var/lib/postgresql/data`.
- `docker compose ... up -d db` created only the Compose network `app_littleplanet` and container `app-db-1`.
- The container reached `running` / `healthy`; `pg_isready -U postgres -d postgres` returned `accepting connections`. `postmaster.pid` existed while running.
- Following the schema inspection below, `docker compose ... stop db` stopped that service cleanly. The container is retained in the stopped state; no data directory or backup was deleted.

## Pre-migration database inspection

Read-only inspection returned PostgreSQL 17.6 with current database/role `postgres`/`postgres`. The only databases returned by the connectable-database query were `postgres` and `template1`; no application database was listed.

| Check | Observed result |
|---|---|
| `supabase_migrations.schema_migrations` | Absent (`to_regclass` returned false); migration history could not be read |
| `public.orders` | Only basic columns were present, including `order_id`, `customer_id`, `payment_status`, `shipping_status`, and `shipping_method`; the expected phone-based/order schema was not present |
| Target shipping columns | `shipping_fee`, `pickup_location_id`, `pickup_slot`, and `shipping_details_initialized` were all absent |
| `public.products` | `preorder_deadline` existed; `cost_price` and `weight` were absent |
| `public.order_profit` and grants | View absent; no grant rows found |

This cluster does not match the expected LittlePlanet/Supabase production schema. The configured mount path alone is not sufficient proof of database identity, so migration execution was blocked rather than modifying an unidentified or incomplete cluster.

## Migration and application verification

- `20261031000100_preorder_auto_close.sql`: **not applied**.
- `20261031000200_shipping_fee_pickup.sql`: **not applied**.
- No SQL migration transaction was started, and no migration-history rows were written.
- Post-migration column checks, false/uninitialized order counts, and live `order_profit` grants/NULL behavior are **not verified** because the migrations were not run.
- The repository migration `20261030000100_admin_order_status_profit.sql` statically defines `order_profit` so orders with unknown product costs have `NULL` profit, and restricts view access to `service_role`. The database did not contain that view, so this is not a live verification.
- The status transition guards are present in that migration and covered by the repository's tests, but were not exercised against this database.

## Repository checks

- `npm ci`: PASS (401 packages installed); npm reported 14 dependency audit findings (13 moderate, 1 high).
- `npm test`: **303 tests, 302 passed, 0 failed, 1 skipped**.
- `npm run lint`: PASS.
- `git diff --check`: PASS.
- The passing suite and static migration review do not establish production DB identity or migration success.

## Required next steps

1. Identify and verify the authoritative LittlePlanet PGDATA/cluster before mounting or restoring it. Do not delete `postgres_live`, the backup, or the stopped container's data.
2. Verify a restorable backup of the confirmed production cluster and confirm that its database list, Supabase schemas, migration history, and expected tables match the application.
3. Only after those checks pass, review the migration history and apply the two authorized migrations in order, then verify the resulting columns, grants, status guards, and data counts.
4. For F2 real-data import, obtain and validate the approved `source/products.csv`; until then, cost, weight, and profit conclusions remain **資料不足**.

## Final record

SERVER-DB-01b 僅啟動並檢查指定的 db 容器；由於掛載資料庫缺少 LittlePlanet/Supabase schema 與 migration history，已停止容器並未套用任何 migration。雙封存檔啟動前後均 PASS；Family/RAG 資料未觸碰；真實商品資料仍為資料不足。
