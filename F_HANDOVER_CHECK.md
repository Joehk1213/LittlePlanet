# F Handover Check

- Machine: `JOE-SERVER`
- Working branch: `pj1/dev-next-f-full`, based on E FINAL `ab2ea5a`
- Test suite: three consecutive runs, each **196 total / 195 passed / 0 failed / 1 skipped**
- Lint: passed (`F_LINT.log`)
- `npm audit`: **1 high**, 0 critical (`F_AUDIT.log`); direct dependency `xlsx`, reported prototype pollution and regular-expression denial-of-service advisories; audit reports no available automatic fix.
- Migration files present: 35. E status/profit migration `20261030000100_admin_order_status_profit.sql` is present. Preorder SQL is a comments-only `.sql.draft`, not a runnable migration.
- Real `source/products.csv`: absent. `source/products.csv.example` is synthetic; sample-only counts and profit figures are not real shop results.
- D archive: 894,679,040 bytes, SHA256 `3D91F03B5292A82F77D4338316D6E446D767356E6FE33CC37236D651C96CAC41` verified at task start and final handover.
- No live DB reads/writes, migration application, archive extraction, image rebuild, OneDrive operation, or access to protected PJ2 paths.

## Generated F artifacts

- `F_CSV_VALIDATION_REPORT.md`
- `F_PROFIT_TRUTH_TOP20.md`
- `F_IMAGE_RECONCILE_REPORT.md`
- `F_PREORDER_AUTOCLOSE_LIST.md`
- `F_TEST_ORDERS_100.json`
- `F_TEST_ORDERS_SUMMARY.md`
- `F_API_SPEC.md`
- `F_ADMIN_GUIDE.md`
- `F_LINT.log`
- `F_AUDIT.log`
- `F_TEST_LOOP.log`
- `OVERNIGHT_CONSTRUCTIVE_REPORT_20261029_0332.md`
- `supabase/migrations/20261031000100_preorder_auto_close.sql.draft`
