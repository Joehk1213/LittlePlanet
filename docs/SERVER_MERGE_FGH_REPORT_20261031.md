# SERVER F2/G/H Merge Report - 2026-10-31

## Host, baseline, and archive gate

- Hostname: `JOE-SERVER`.
- Integration branch: `pj1/dev-next-merge-fgh` at `5145613`; pushed to origin after verification. Pull request creation is pending authenticated GitHub access.
- Base: `origin/pj1/dev-next` at E FINAL `ab2ea5a`. `git merge-base origin/pj1/dev-next HEAD` is `ab2ea5a`; no master-based work was used.
- Remote mainline remains `origin/pj1/dev-next` at `ab2ea5a`.
- SERVER archive gate passed both before and after the work:
  - `D:\docker-data\littleplanet\images.tar`
  - 894,679,040 bytes
  - SHA256 `3D91F03B5292A82F77D4338316D6E446D767356E6FE33CC37236D651C96CAC41`
- The C: handover directory is DT-only; it was not used or populated on this SERVER.

## Fetched payload and merge ancestry

After `git fetch origin`, all requested refs were visible:

| Ref | Tip at fetch | Result |
|---|---|---|
| `origin/pj1/dev-next-merge-rehearsal-dt` | `9ff921e` | Optional shipping-schema fallback rehearsal; not merged wholesale |
| `origin/pj1/rehearsal-f2-snapshot` | `9b0d7c3` | F2 import tooling snapshot |
| `origin/pj1/rehearsal-g-snapshot` | `1b56af1` | G shipping/pickup snapshot |
| `origin/pj1/rehearsal-h-snapshot` | `45f0897` | H WhatsApp snapshot |

Merge order was F2 -> G -> H, each with a no-fast-forward merge:

1. F2 merge `06219a4` (`Merge F2 snapshot 210/209`).
2. G merge `98249d0` (`Merge G snapshot 218/217`).
3. Preserved optional shipping fallback in commit `594973d`.
4. H merge `5145613` (`Merge H snapshot 250/249`).

HEAD was `5145613` at initial push, seven commits ahead of `origin/pj1/dev-next`. A follow-up documentation commit records PR handover details; the branch remains separate from mainline.

## Merge conflict resolution

H had content conflicts in `public/admin.html`, `src/routes/orders.js`, and `src/routes/admin/orders.js`.

- `public/admin.html`: retained existing order/profit rendering and H notification UI; missing shipping data displays `運費：資料不足`.
- `src/routes/orders.js`: retained G server-side shipping-fee calculation/catalog access and H shipped-order notification.
- `src/routes/admin/orders.js`: retained H notification behavior and added an optional shipping-details query separate from the core order query. Missing-column/schema errors mark optional values null and return `shipping_details_message: '資料不足'`, so an unapplied shipping migration does not break the order list.
- Added a regression test for the optional-field fallback. The branch total is therefore one test above the rehearsal's stated count.
- Shipping notifications are called only after a successful `shipped` state transition; no WhatsApp message was sent during this task.

## Test and lint evidence

| Round | Operation | Tests | Passed | Failed | Skipped | Other checks |
|---|---|---:|---:|---:|---:|---|
| F2 | `npm ci`, then `npm test` | 210 | 209 | 0 | 1 | `npm run lint` and `git diff --check` passed |
| G | `npm test` | 238 | 237 | 0 | 1 | `npm run lint` and `git diff --check` passed |
| H/final | `npm test` after conflict resolution and merge commit | 299 | 298 | 0 | 1 | `npm run lint`, JS syntax checks, staged/unstaged `git diff --check` passed |

The final count is 299/298/0/1 rather than 298/297/0/1 because the optional shipping-schema regression test was added during merge hardening. The one skip is the existing local anon RLS test.

## Static migration and safety review

- 36 migration files are present. The tail is ordered:
  - `20261030000100_admin_order_status_profit.sql` (E)
  - `20261031000100_preorder_auto_close.sql` (G)
  - `20261031000200_shipping_fee_pickup.sql` (G)
- Static inspection confirms the E status RPC locks the order row, status transitions remain separate from payment/shipping status, and `order_profit` is service-role-only with unknown costs represented as `NULL`.
- The preorder migration uses existing product status values (`預購中` → `已下架`) and limits updates to expired preorder products. The shipping migration adds fee/pickup fields and a service-role checkout RPC wrapper.
- Migrations were inspected as text only. No `psql`, Supabase CLI/database connection, `db push`, migration application, or live query was run.
- `database/family-rag`, `src/rag`, and `.env.docker` have no worktree changes. No secrets were read, no archive was extracted, no compose service was started, and no OneDrive/PJ2 path was accessed.
- `source/products.csv` is absent: actual product costs, weights, shipping fees, and preorder deadlines are **資料不足**. No CSV was added or committed.
- `docker-compose.prod.yml` is absent: deployment compose configuration is **config 未驗證**.

## Current state

- Branch: `pj1/dev-next-merge-fgh`, pushed to origin; PR creation is pending. See [SERVER_PR_20261031.md](./SERVER_PR_20261031.md) for the create-PR URL and ready-to-paste description.
- `origin/pj1/dev-next` remains at `ab2ea5a`.
- F2/G/H code, static migrations, and the optional-schema fallback are present on the local integration branch.
