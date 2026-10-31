# Overnight F2 Report — 2026-10-30

## Branch and safety

- Branch: `pj1/dev-next-f2-real-import`, created from `origin/pj1/dev-next` at `ab2ea5a`.
- The existing local E work and CSV remain preserved in Git stashes; this branch contains no E worktree changes.
- `source/products.csv` remains untracked and is not included in the F2 deliverables.
- No migration was applied, no database write was performed, and `--real` was not run.
- No access was made to D:, OneDrive, PJ2 paths, or `.env.docker`.
- `xlsx` remains declared as `^0.18.5`.

## Archive verification

- C: archive: `C:\docker-data\littleplanet-handover\images.tar`
- Size: `894679040` bytes.
- SHA-256: `3D91F03B5292A82F77D4338316D6E446D767356E6FE33CC37236D651C96CAC41` — matches the sealed value.
- The SERVER copy was not checked on this desktop.

## CSV and margin validation

- `source/products.csv`: 27 records, 16 columns, product IDs 4268–4294.
- All 27 records pass the implemented ID, positive-price, nonnegative-stock, tier-price, and available-field checks; 0 invalid rows.
- The CSV does not contain `cost_price`; therefore no real margin values were calculated. `F_PRODUCT_MARGIN_REPORT_DT.md` lists the 27 products needing authoritative cost values and states「資料不足」.
- The database already has nullable `products.cost_price` through tracked migrations; the next data step is to add/populate that field in the CSV from an authoritative source, not to apply a duplicate migration.
- The CSV `status` value `preorder` does not match the current database status constraint. The importer warns and omits that field rather than guessing a translation.

## Import dry-run

- `F_IMPORT_DRYRUN_REPORT.md`: 27 validated rows, 0 invalid rows, 27 missing costs.
- The dry-run performed no database calls or writes. Its `FOR UPDATE` entries are simulations only; the CSV stock values were validated, not compared to or locked against live database stock.
- The real-mode client reads the service-role key from `.env.docker` only when explicitly invoked with `--real`; tests use a mocked client. Real import was not executed.

## Image reconciliation

- `public/images` is absent; the CSV has 27 remote HTTP(S) image URLs, which were not fetched or classified as missing.
- `public/assets/images` has 4 UI/PWA image assets and is not treated as product imagery.
- `F_IMAGE_RECONCILE_REPORT_DT.md` records that `images.tar` is the sealed Docker image archive (7 PJ1 image tags), not a product-image archive.

## Verification

- `npm test`: 210 tests, 209 passed, 0 failed, 1 skipped.
- `npm run lint`: passed.
- `git diff --check`: clean.

## Next steps

1. Add authoritative `cost_price` values to the CSV export; rerun validation before using any margin report.
2. Confirm whether the legacy `preorder` status should map to a current database status before including status updates.
3. Review stock synchronization and concurrency requirements before any real upsert; the REST upsert does not acquire a `FOR UPDATE` lock.
4. Verify remote product image URLs separately if availability confirmation is required.
