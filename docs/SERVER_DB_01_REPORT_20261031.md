# SERVER-DB-01 Formal DB Validation — 2026-10-31

## Result

**BLOCKED — no live database connection was established and neither migration was applied.** The offline PostgreSQL data directory was backed up and verified, but current production target identity and schema history could not be validated. No database or application data was changed.

## Host, branch, and archive gate

- Host: `JOE-SERVER`.
- Repository: `C:\Project\LittlePlanet`.
- Branch: `pj1/dev-next` at `19f1633`; `origin/pj1/dev-next` matched at preflight.
- Archive gate: both paths passed before and after this validation attempt.

| Archive | Length | SHA256 | Result |
|---|---:|---|---|
| `C:\docker-data\littleplanet-handover\images.tar` | 894,679,040 | `3D91F03B5292A82F77D4338316D6E446D767356E6FE33CC37236D651C96CAC41` | PASS |
| `D:\docker-data\littleplanet\images.tar` | 894,679,040 | `3D91F03B5292A82F77D4338316D6E446D767356E6FE33CC37236D651C96CAC41` | PASS |

No worktree entries were present under `database/family-rag`, `src/rag`, or `.env.docker`. `source/products.csv` is absent and was not created or added.

## Backup evidence

- Candidate offline PostgreSQL data directory: `D:\docker-data\littleplanet\postgres_live`.
- PostgreSQL major version marker: `17`.
- No `postmaster.pid` or local `postgres` process was present at backup time; no running LittlePlanet DB container was listed.
- Backup copy: `C:\backup\littleplanet-postgres_live-20261031\postgres_live`.
- Verified at `2026-10-31 14:24:00 +08:00`: 1,074 files and 42,451,226 bytes at source and destination; all per-file SHA256 hashes matched.
- This was a file-level copy of the offline data directory. Restore was not tested; it is not evidence that the production database is startable or current.

## Connection and deployment blockers

- `psql`, `pg_dump`, `pg_restore`, and Supabase CLI are not installed. Docker is installed, but this task explicitly prohibited Docker operations beyond the initial read-only inspection; no container was started.
- The production env file at `D:\docker-data\littleplanet\.env.docker` contains configured Supabase URL, service-role key, and database-password variables. Their values were not displayed or recorded. `WHATSAPP_API_TOKEN` is defined but empty, and `WHATSAPP_ENABLED` is not true; no WhatsApp request was made.
- The configured Supabase host `littleplanet.localhost` did not resolve. Ports 443 and 5432 were not reachable. No migration-history or live-schema query could be made.
- The repository has no `docker-compose.prod.yml` or `docker-compose.yml`. A deployment copy exists at `D:\docker-data\littleplanet\app\docker-compose.prod.yml`, but it was not run or runtime-validated.
- The deployment env sets `LITTLEPLANET_DATA_ROOT=C:/docker-data/littleplanet`, so the Compose DB service would mount `C:\docker-data\littleplanet\postgres`; that directory does not exist. The candidate offline data is instead at `D:\docker-data\littleplanet\postgres_live`. Starting that Compose service without resolving the mismatch risks initializing a different, empty data directory. Therefore Compose status is **config 未驗證**, and no service was started.

## Migration and database verification status

| Check | Result |
|---|---|
| Pre-migration schema and `supabase_migrations.schema_migrations` history | Not queried; DB unreachable |
| `20261031000100_preorder_auto_close.sql` | Read statically only; **not applied** |
| `20261031000200_shipping_fee_pickup.sql` | Read statically only; **not applied** |
| Shipping columns/types/defaults after migration | Not verified against a database |
| `shipping_details_initialized = false` and `shipping_fee IS NULL` counts | Not queried |
| `order_profit` grants and unknown-cost `NULL` behavior | Static migration review only; not verified in the live DB |
| Status transition/payment/shipment guards | Static migration and mock-test review only; not exercised against the live DB |

Do not treat this report as migration approval or deployment completion. Before resuming, confirm the authoritative LittlePlanet PGDATA location and approved launch method, reconcile the Compose bind path without touching any Family data, establish a verified direct DB connection, inspect migration history/schema, and test the backup restore path. Then apply only the two named migrations in order with a verified rollback/backup plan.

## Application checks

- `npm ci`: PASS (401 packages installed).
- `npm test`: **303 tests, 302 passed, 0 failed, 1 skipped**.
- `npm run lint`: PASS.
- `git diff --check`: PASS.
- The one skipped test is the existing local anon-RLS connectivity skip. The suite uses its test/mocked paths; it is not a production DB check.
- Dependency audit reported 14 findings (13 moderate, 1 high). The known high issue is SheetJS `xlsx@0.18.5` prototype pollution / ReDoS; this validation did not change dependencies.
- `source/products.csv` is absent: actual `cost_price`, weight, and `preorder_deadline` values remain **資料不足**; no profit Top 10 or real-data conclusion is produced.

## Final record

混合版結構統一修正記錄，PJ1 + PJ2 兩邊都已入檔，RULE 1-4 檔名結構 PASS，TODO 0。PJ1 未掂 PJ2 嘅檔，PJ2 未掂 PJ1 嘅檔，D: 未掂。
