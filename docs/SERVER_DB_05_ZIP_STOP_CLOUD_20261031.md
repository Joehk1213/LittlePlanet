# SERVER-DB-05 ZIP Clue, Empty DB Stop, and Cloud Comparison — 2026-10-31

## Result

The empty LittlePlanet `app-db-1` container was stopped as authorized. It exited with code 0, and the mounted `postmaster.pid` is absent. Only the pre-existing `familysystem-*` containers remain running.

The ZIP clue `D:\docker-data\littleplanet\postgres.zip` contains a PostgreSQL 17 PGDATA layout, but its 1,074 files match `D:\docker-data\littleplanet\postgres_live` file-for-file by SHA256 (1,074 matches, 0 mismatches). Its uncompressed size is only 42,451,226 bytes, so it is the same small vanilla cluster—not the missing production database. `D:\backup\postgres-20261029.zip` contains neither PGDATA markers nor SQL/dump files.

The deployed `D:\docker-data\littleplanet\.env.docker` selects the self-host URL host `littleplanet.localhost`. The repository `.env` contains a `your-project.supabase.co` placeholder, while `src/routes/customer.js` has a cloud-host fallback. This is a configuration divergence to resolve before deploying or restoring; no credentials were exposed.

## Host, branch, archive gate, and pre-stop state

- Host: `JOE-SERVER`.
- Repository: `C:\Project\LittlePlanet`.
- Branch/head before this report: `pj1/dev-next` at `dc6312c`.
- Before stop, `app-db-1` was `running`/`healthy`, its DB mount was `D:\docker-data\littleplanet\postgres` → `/var/lib/postgresql/data`, and `postmaster.pid` existed.
- No Windows-host `postgres` process was present.
- Both archive hashes passed before the stop at `2026-10-31 15:07:28–15:07:29 +08:00` and after the ZIP checks/stop at `15:10:04–15:10:05 +08:00`.

| Archive | Length | SHA256 | Result |
|---|---:|---|---|
| `C:\docker-data\littleplanet-handover\images.tar` | 894,679,040 | `3D91F03B5292A82F77D4338316D6E446D767356E6FE33CC37236D651C96CAC41` | PASS before/after |
| `D:\docker-data\littleplanet\images.tar` | 894,679,040 | `3D91F03B5292A82F77D4338316D6E446D767356E6FE33CC37236D651C96CAC41` | PASS before/after |

## Stop action and post-stop state

- Ran `docker compose --env-file ..\.env.docker -f docker-compose.prod.yml stop db` from `D:\docker-data\littleplanet\app`.
- Compose reported `app-db-1` stopped. Docker inspect reported `State=exited`, `ExitCode=0`, `OOMKilled=False`.
- `D:\docker-data\littleplanet\postgres\postmaster.pid` is absent after stop.
- The last 50 lines available from `docker logs app-db-1` contained six lines; no shutdown marker was present in that retained tail. The report therefore records the successful Compose stop and exit code, not a log shutdown marker.
- `docker ps` after stop listed only the pre-existing `familysystem-auth-1`, `familysystem-storage-1`, `familysystem-rest-1`, `familysystem-db-1`, and `familysystem-gateway-1` containers. No Family container was stopped or otherwise operated on.
- No volume was removed, no PGDATA directory was deleted or overwritten, and the database was not restarted.

## Read-only ZIP inspection

Both ZIPs were opened with `System.IO.Compression.ZipFile.OpenRead`; entries were enumerated in memory only. Nothing was extracted or written to either PostgreSQL directory.

| ZIP path | Compressed bytes | LastWriteTime | Entries (incl. dirs) | File entries | Total uncompressed bytes | PG_VERSION | `base/` | `global/pg_control` | `pg_wal/` | `.sql` / `.dump` | Classification |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| `D:\backup\postgres-20261029.zip` | 7,913,792 | 2026-10-29 02:00:48 | 1,315 | 1,300 | 63,155,419 | No | No | No | No | No / No | Neither recognized PGDATA nor SQL/dump |
| `D:\docker-data\littleplanet\postgres.zip` | 5,961,824 | 2026-10-28 10:59:29 | 1,101 | 1,074 | 42,451,226 | Yes (4 entries incl. database-internal markers) | Yes (995 entries) | Yes | Yes | No / No | PostgreSQL PGDATA archive |

Representative entries in `postgres.zip`:

| Entry | Uncompressed bytes | Compressed bytes | Entry LastWriteTime |
|---|---:|---:|---|
| `postgres/PG_VERSION` | 3 | 5 | 2026-10-28 10:59:26 +08:00 |
| `postgres/base/1/PG_VERSION` | 3 | 5 | 2026-10-28 10:59:28 +08:00 |
| `postgres/base/4/PG_VERSION` | 3 | 5 | 2026-10-28 10:59:28 +08:00 |
| `postgres/base/5/PG_VERSION` | 3 | 5 | 2026-10-28 10:59:28 +08:00 |
| `postgres/global/pg_control` | 8,192 | 191 | 2026-10-28 10:59:28 +08:00 |
| `postgres/pg_wal/000000010000000000000001` | 16,777,216 | 2,534,867 | 2026-10-28 10:59:28 +08:00 |

The `postgres.zip` file list, uncompressed sizes, and entry times were compared to `D:\docker-data\littleplanet\postgres_live` without extraction: 1,074 matching relative paths, 0 size mismatches, 1,074 SHA256 matches, and 0 SHA256 mismatches. Root `PG_VERSION` content is `17`. This establishes that this archive is a copy of the already identified 42 MB vanilla cluster, not a real-data backup.

The first ZIP had 1,300 file entries, but no PostgreSQL data-directory markers and no `.sql`, `.dump`, or `.backup` file extensions. Its contents were not extracted or treated as a restorable database.

## Self-host vs. Supabase Cloud configuration

Only environment variable names, presence, URL host/scheme/port, and the safe data-root path were inspected. No key or password values were printed or recorded.

| Source | URL host / status | Classification |
|---|---|---|
| `D:\docker-data\littleplanet\.env.docker` | `littleplanet.localhost`, HTTPS, default port | Self-host |
| `D:\docker-data\littleplanet\.env.docker.bak-20261031` | `littleplanet.localhost`, HTTPS, default port | Self-host |
| `C:\Project\LittlePlanet\.env` | `your-project.supabase.co`, HTTPS, default port | Cloud-shaped placeholder; not an actual project ref |
| `C:\Project\LittlePlanet\.env.local` | Not found | Not configured |
| `C:\Project\LittlePlanet\supabase\config.toml` | Not found | No local project ref/config available |
| `src/routes/customer.js` fallback | `wteditztyndkfvnzkpvn.supabase.co` | Cloud fallback; project ref `wteditztyndkfvnzkpvn` |

The route config uses `process.env.SUPABASE_URL` first and the cloud fallback only when that variable is unset. The deployment env currently supplies the self-host URL; repository `.env` is a cloud placeholder. Keep those environments separate and ensure the runtime env is present before deploying. `LITTLEPLANET_DATA_ROOT` is `D:\docker-data\littleplanet`.

Safe key-presence check for `D:\docker-data\littleplanet\.env.docker`: `POSTGRES_DB`, `POSTGRES_PASSWORD`, `JWT_SECRET`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `WHATSAPP_API_TOKEN` are present; `POSTGRES_USER` is absent from the file (Compose declares the DB user). Values were not displayed. Repository `.env` contains `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `WHATSAPP_API_TOKEN` variable names; their values were not displayed.

## Conclusion and next steps

- **ZIP clue result:** `postgres.zip` is not the missing real database; it exactly matches the small vanilla `postgres_live` cluster. The other ZIP is not identified as a PGDATA or SQL dump.
- **Database service:** stopped and left stopped. Do not start it again or replace either data directory until the true production data source is verified.
- **Production data:** no real LittlePlanet PGDATA or SQL dump was found. Ask the data owner for the authoritative backup source; do not infer database identity from the ZIP filename.
- **Restore path:** if a verified production PGDATA is later provided, preserve the current `postgres` and `postgres_live` directories and backups, validate the backup and restore plan, and only then prepare a separately approved replacement. If a verified SQL dump is provided, restore it only under a separately authorized plan after schema/identity checks.
- `source/products.csv` is absent; real product cost/weight data and profit conclusions remain **資料不足**.
- No worktree changes occurred under `database/family-rag`, `src/rag`, `.env.docker`, or `source/products.csv`. The prior untracked SERVER-DB-03 and SERVER-DB-04 reports were preserved and not staged.

## Final record

SERVER-DB-05 已停止空白 `app-db-1`；容器 exited、exit code 0，`postmaster.pid` 已消失，Family 容器維持運行。唯讀 ZIP 比對確認 `postgres.zip` 與 42 MB `postgres_live` 逐檔 SHA256 相同，不是真實生產 DB。部署 env 指向 self-host `littleplanet.localhost`，repo `.env` 是 Cloud placeholder，程式另有 Cloud fallback；雙封存 hash 前後均 PASS，未解壓、未套 migration、未刪改 PGDATA。
