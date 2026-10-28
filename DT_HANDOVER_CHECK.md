# DT Handover Verification — 2026-10-29

Read-only inventory of top-level files in `C:\docker-data\littleplanet-handover`. The `.env.docker*` files were not opened or modified. No D: path, OneDrive path, PJ2 data, or live database directory was accessed.

| File | Bytes |
|---|---:|
| `.env.docker` | 2,908 |
| `.env.docker.JOE-SERVER` | 2,913 |
| `CHECKSUM.txt` | 761 |
| `docker_images.txt` | 630 |
| `images.tar` | 894,679,040 |
| `images.tar.mixed_9tags_backup_20261028` | 1,287,879,680 |
| `images.tar.old_mixed` | 1,287,879,680 |
| `images.tar.pj1-pure_20261028` | 894,679,040 |
| `IMAGES_PJ1_ONLY_MANIFEST.txt` | 1,500 |
| `MANIFEST.txt` | 127,830 |
| `postgres.zip` | 5,961,824 |
| `README_JOE.txt` | 4,499 |

## Hash verification

| File | SHA-256 | Result |
|---|---|---|
| `images.tar` | `3D91F03B5292A82F77D4338316D6E446D767356E6FE33CC37236D651C96CAC41` | Matches sealed PJ1 archive value. |
| `postgres.zip` | `279D8CB392FBF5D5D303F8C108AA92DC7D582A6C9B23F6E367FA8BFBDB46FC3F` | Hash computed; no archive contents extracted or changed. |

The pure PJ1 archive and both retained mixed backups remain present. No deletion, replacement, database write, or migration application was performed.
