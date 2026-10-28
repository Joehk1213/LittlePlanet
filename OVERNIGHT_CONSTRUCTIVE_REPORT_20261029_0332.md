# Overnight Constructive Report - F Full - 2026-10-29 03:32 HKT

- Machine: `JOE-SERVER`
- Date: 2026-10-29 HKT
- Branch: `pj1/dev-next-f-full`
- Base HEAD: `ab2ea5a` (E FINAL)
- Final validation timestamp: `2026-10-29 03:32 +08:00`
- Expected D archive: 894,679,040 bytes / SHA256 `3D91F03B5292A82F77D4338316D6E446D767356E6FE33CC37236D651C96CAC41` — verified at start and final handover.
- E baseline: 190 tests, 189 passed, 0 failed, 1 skipped before F tooling.

## F results - actual-data limitation

`source/products.csv` was not present. No real catalog profit, real missing-image count, or real expired-preorder count can be calculated. The five-row `source/products.csv.example` and all figures below are explicitly synthetic demonstrations, not the shop's products or business results.

| Measure | Real CSV | Synthetic example only |
|---|---:|---:|
| Product rows | Not available (file absent) | 5 |
| Valid / invalid | Not available | 5 / 0 |
| Missing cost | Not available | 0 |
| Cost exceeds at least one price | Not available | 1 product |
| Local image paths missing | Not available | 4 |
| Remote image paths unverified | Not available | 1 |
| Expired preorder candidates | Not available | 1 |

### Example-only margin illustration

Top five tier/base margin rows:

1. Example product 4269, base price: 150.00%
2. Example product 4269, qty 2: 108.33%
3. Example product 4268, base price: 100.00%
4. Example product 4271, base price: 100.00%
5. Example product 4268, qty 2: 80.00%

Bottom loss rows (the example has two):

1. Example product 4270, qty 2: -12.50%
2. Example product 4270, base price: -6.25%

These are only validator examples. Do not treat them as real product IDs/prices or make buying decisions from them.

### Image and preorder interpretation

- The three local files found are under `public/assets/images` and appear to be application/PWA artwork, not a catalog image set.
- The four missing local URLs and one unverified remote URL are from the synthetic example. The D: `images.tar` is a Docker container-image archive; its nine Docker references do not provide a product-photo inventory. It was not extracted.
- The one expired preorder candidate is synthetic. The generated SQL is comments-only `.sql.draft` and uses current `預購中` -> `已下架` values; it is not an executable or applied migration.

## Synthetic load fixture

- Generated: 100 orders, all `is_test_data: true`.
- Test phone pattern: synthetic `5550xxxx` local numbers, stored with normalized `852` prefix. Do not use for customer contact or notification.
- Example-only calculated profit total: HK$2,678.00; average 1.93 line items and 5.34 units per order.
- Status distribution: pending 10, paid 16, shipped 13, picked_up 19, completed 13, cancelled 29.
- The fixture is deterministic for repeatable offline tests and is not written to any database.

## Validation and security

- Full `npm test`, three consecutive runs: each **196 tests, 195 passed, 0 failed, 1 skipped**.
- `npm run lint`: passed.
- `npm audit`: **1 high**, 0 critical. Direct dependency `xlsx` has reported prototype-pollution and ReDoS advisories; audit reports no available automatic fix. No dependency was changed and no forced audit remediation was attempted.
- `npm ci` was intentionally not run because `node_modules` exists and package manifests were unchanged.
- Existing E migration remains static-only. No database connection, SQL execution, migration application, or live profit query was performed.

## Next steps

- **F2 - Product CSV Import:** first obtain and approve the real CSV, validate its column contract and dry-run totals, then separately plan an authenticated/idempotent import with rollback and owner approval before any DB write.
- **G - Shipping fee + pickup slot:** confirm the fee policy, shipping thresholds and persisted slot model; derive weight fields only from verified data, not assumptions.
- **H - Paid-to-shipped WhatsApp notification:** use existing verified payment/shipping transitions, idempotent delivery records, retry-safe failure logging and authorized recipients; never infer verified payment from a submitted proof.

## Generated files

- Scripts/tests: `scripts/f-catalog-utils.js`, `scripts/f-validate-products.js`, `scripts/f-reconcile-images.js`, `scripts/f-preorder-auto-close.js`, `scripts/f-generate-test-orders.js`, `tests/f-tools.test.js`
- Example input: `source/products.csv.example` (synthetic only; actual `source/products.csv` absent)
- Reports: `F_CSV_VALIDATION_REPORT.md`, `F_PROFIT_TRUTH_TOP20.md`, `F_IMAGE_RECONCILE_REPORT.md`, `F_PREORDER_AUTOCLOSE_LIST.md`, `F_TEST_ORDERS_SUMMARY.md`, `F_API_SPEC.md`, `F_ADMIN_GUIDE.md`, `F_HANDOVER_CHECK.md`
- Test fixture: `F_TEST_ORDERS_100.json`
- Validation logs: `F_LINT.log`, `F_AUDIT.log`, `F_TEST_LOOP.log`
- Inert draft: `supabase/migrations/20261031000100_preorder_auto_close.sql.draft`
