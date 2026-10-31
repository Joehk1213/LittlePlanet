# SERVER-DB-06 Cloud Dump and Self-Host Restore — 2026-10-31

## Result

**BLOCKED BEFORE CLOUD CONNECTION — the empty self-host PGDATA was safely backed up, but a Cloud dump and restore could not be performed.** The repository `.env` points to the placeholder host `your-project.supabase.co`; neither env file contains `SUPABASE_DB_URL`, `DATABASE_URL`, or `POSTGRES_URL`; `supabase/config.toml` is absent; and `pg_dump`, `pg_restore`, `psql`, and the Supabase CLI are not installed. No Cloud connection was attempted. No DB data directory was cleared, replaced, or restored, and no migration was applied.

The empty self-host database remains stopped. This task does not establish a real Cloud project reference or provide a direct PostgreSQL connection credential. Supabase API keys are not PostgreSQL passwords and were not used for a database dump.

## Host, branch, archive, and disk preflight

- Host: `JOE-SERVER`.
- Repository: `C:\Project\LittlePlanet`.
- Branch/head at start: `pj1/dev-next` / `e562be9`.
- `app-db-1`: `exited`; `D:\docker-data\littleplanet\postgres\postmaster.pid` absent.
- No Windows-host `postgres` process was present.
- No changes under `database/family-rag`, `src/rag`, `.env.docker`, or `source/products.csv`.
- `source/products.csv` is absent; actual product data remains **資料不足**.
- C:/D: free space at preflight: C: 88.4 GB; D: 166.4 GB.
- Both archives passed before the backup operation at `2026-10-31 15:18:57–15:19:01 +08:00` and after it at `15:20:14–15:20:19 +08:00`.

| Archive | Length | SHA256 | Result |
|---|---:|---|---|
| `C:\docker-data\littleplanet-handover\images.tar` | 894,679,040 | `3D91F03B5292A82F77D4338316D6E446D767356E6FE33CC37236D651C96CAC41` | PASS before/after |
| `D:\docker-data\littleplanet\images.tar` | 894,679,040 | `3D91F03B5292A82F77D4338316D6E446D767356E6FE33CC37236D651C96CAC41` | PASS before/after |

## Empty PGDATA backup

The stopped, Compose-mounted empty cluster was copied without changing the source:

| Item | Result |
|---|---|
| Source | `D:\docker-data\littleplanet\postgres` |
| Backup | `D:\backup\postgres-empty-20261031\postgres` |
| Source / backup files | 1,074 / 1,074 |
| Source / backup bytes | 42,455,160 / 42,455,160 |
| Per-file SHA256 | 1,074 matched; 0 mismatches |
| `PG_VERSION` | 17 |

The prior `postgres_live` and `C:\backup\littleplanet-postgres_live-20261031\postgres_live` fallback copies were not modified. The self-host `postgres` directory was not cleared or replaced.

## Cloud connection discovery

Only variable names, presence, URL host/scheme/port, and the safe data-root path were inspected. No key, password, or connection string value was printed or recorded.

| Source | URL host / config | Direct DB URL present? | Assessment |
|---|---|---|---|
| `C:\Project\LittlePlanet\.env` | HTTPS `your-project.supabase.co`, default port | No | Placeholder URL; not a usable Cloud project configuration |
| `C:\Project\LittlePlanet\.env.local` | Not found | No | No local override |
| `D:\docker-data\littleplanet\.env.docker` | HTTPS `littleplanet.localhost`, default port | No | Self-host endpoint, not Cloud dump credentials |
| `D:\docker-data\littleplanet\.env.docker.bak-20261031` | HTTPS `littleplanet.localhost`, default port | No | Backup of self-host configuration |
| `C:\Project\LittlePlanet\supabase\config.toml` | Not found | — | No linked project reference or DB config |
| Process environment | `SUPABASE_DB_URL`, `DATABASE_URL`, `POSTGRES_URL`, `PGHOST`, `PGDATABASE`, `PGUSER`, and `PGPASSWORD` absent | No | No direct connection credentials available |

`src/routes/customer.js` contains an application fallback to a Supabase Cloud host (`wteditztyndkfvnzkpvn.supabase.co`) when `SUPABASE_URL` is unset. That source-code fallback is not a verified database connection string or confirmation that this is the authoritative Cloud project; it was not used for a connection.

Tool check: `pg_dump`, `pg_restore`, `psql`, `supabase`, and `7z` were not available on PATH.

## Dump and restore status

| Step | Result |
|---|---|
| Schema-only Cloud dump | Not attempted; no valid Cloud host/DB URL or dump tool |
| Full Cloud dump | Not attempted; no valid Cloud host/DB URL or dump tool |
| Dump file / schema inspection / Cloud table counts | None created or queried |
| Self-host PGDATA clear/replacement | Not performed |
| Restore | Not performed |
| Migration history and `20261031000100` / `20261031000200` | Not queried/applied |
| Post-restore database checks | Not applicable |
| App DB container | Remains exited; no start was attempted |

No customer records or other application rows were accessed or copied.

## Required next steps

1. Have the data owner confirm the authoritative Cloud Supabase project and securely configure a direct PostgreSQL connection URL in a protected local environment (for example `SUPABASE_DB_URL`), without pasting credentials into chat or committing them.
2. Install/provision the approved PostgreSQL client tools (`pg_dump`, `pg_restore`, `psql`) or the approved Supabase CLI. Confirm SSL, network allowlisting, and a least-privilege read-only dump role.
3. Before retrying, re-check the Cloud URL host without showing the URL or credentials, confirm available space, and create a schema-only dump first. Only proceed with the full dump after confirming the expected project and schema. Keep the dump files private and exclude them from Git.
4. Validate the dump contents and counts without exposing customer data. Restore only after a separately reviewed restore plan; preserve all existing PGDATA and backups. Then inspect migration history and apply only the approved missing migrations.
5. Keep the self-host DB stopped until a valid Cloud source and restore plan are available. Do not treat the Cloud fallback in application code as authorization or connection credentials.

## Final record

SERVER-DB-06 已將停止中的空白 self-host PGDATA 備份至 `D:\backup\postgres-empty-20261031\postgres` 並逐檔驗證 1,074 個 SHA256 全數相同；Cloud dump／restore 因缺少有效 Cloud project URL、直接 DB URL 與 dump 工具而未執行。資料目錄未清空、容器保持停止、migration 未套用；雙封存前後 PASS，未觸碰 Family 資料或提交任何憑證。
