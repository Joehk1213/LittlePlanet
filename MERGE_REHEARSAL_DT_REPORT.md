# PJ1 DT Merge Rehearsal Report

## Scope and safety

- Rehearsal branch: `pj1/dev-next-merge-rehearsal-dt`, based on `origin/pj1/dev-next` at `ab2ea5a`.
- F2, G, and H were integrated in that order. The rehearsal branch is local-only; it was not pushed or merged into `pj1/dev-next`.
- No database connection, migration application, Compose startup, or WhatsApp send was performed.
- `source/products.csv` remains untracked and was excluded from every snapshot commit.
- Protected paths `database/family-rag`, `src/rag`, and `.env.docker` had no reported working-tree changes.
- The DT archive gate remained valid at each checked boundary: 894,679,040 bytes, SHA-256 `3D91F03B5292A82F77D4338316D6E446D767356E6FE33CC37236D651C96CAC41`.

## Branch recovery deviation

The local feature refs `pj1/dev-next-f2-real-import`, `pj1/dev-next-g-shipping`, and `pj1/dev-next-h-whatsapp` all pointed to `ab2ea5a`, so their requested merges were already empty. To preserve the work without moving those refs or applying/removing stashes, local snapshot branches were reconstructed from the preserved stashes and merged into the rehearsal branch:

| Phase | Snapshot commit | Rehearsal merge |
|---|---|---|
| F2 | `9b0d7c3` | `2e09f1d` |
| G | `1b56af1` | `65c910d` |
| H | `45f0897` | `fd81161` |

The original F2/G/H refs remain at `ab2ea5a`; no remote rehearsal ref exists.

## Conflicts and resolutions

- F2 merge: no conflicts.
- G merge: no conflicts.
- H merge conflicts were limited to:
  - `public/admin.html`: retained the shipping-fee display while preserving H's null/schema-aware `資料不足` fallback.
  - `src/routes/orders.js`: combined G shipping/catalog imports with H's `notifyShippedOrder` import and retained both behaviors.
- `src/routes/admin/orders.js` and `src/routes/index.js` auto-merged. Shipping-detail lookup, H notification after a shipped transition, and `whatsappSender` router wiring are present.
- Round 3 exposed an optional-schema fallback issue in `src/routes/admin/orders.js`: shipping columns were requested in the required base query before the optional lookup could handle their absence. They are now fetched separately; absent columns produce null shipping details, including `pickup_slot`, without failing the order list.

## Test and validation rounds

| Round | Integrated phase | Tests | Passed | Failed | Skipped |
|---|---|---:|---:|---:|---:|
| 1 | F2 | 210 | 209 | 0 | 1 |
| 2 | F2 + G | 238 | 237 | 0 | 1 |
| 3 | F2 + G + H | 298 | 297 | 0 | 1 |

- `npm run lint`: passed.
- `git diff --check` and `git diff --cached --check`: passed after the report and code fix were prepared.
- `xlsx@0.18.5`: installed and present.
- Required F/G/H scripts and shared utilities were present.
- Migration order verified statically: `20261030000100_admin_order_status_profit.sql` → `20261031000100_preorder_auto_close.sql` → `20261031000200_shipping_fee_pickup.sql`. No migration was applied.

## Dry-run results

- `node scripts/f-validate-products.js`: 27 rows, 27 valid, 0 invalid, 27 missing `cost_price`; margin data is insufficient.
- `node scripts/f-import-products.js --dry-run`: 27 rows, 27 valid, 0 invalid, zero database writes.
- `node scripts/g-preorder-auto-close.js`: zero expired candidates; data insufficient because the DT CSV has no preorder deadlines.
- `node scripts/h-whatsapp-reminder.js`: zero candidates; data insufficient because no order data was supplied. No database lookup or messages were sent.
- Dry-runs generated or refreshed their corresponding F/G/H reports. The CSV still remains untracked.

## Compose and DT/SERVER difference

- `docker compose -f docker-compose.prod.yml config --quiet` could not run because `docker-compose.prod.yml` is absent from this working tree. No substitute Compose file was guessed, and no service was started.
- DT has the local 27-row CSV, but it lacks `cost_price` and `weight`, and all `preorder_deadline` values are empty. SERVER has no `source/products.csv`; the formal SERVER merge must report `資料不足` instead of inferring data.

## Final status

The rehearsal branch remains local-only and contains the F2 → G → H merge history. No push was made, no production data was accessed, and D: was not touched.
