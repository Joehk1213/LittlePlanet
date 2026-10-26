# LittlePlanet 重構詳細報告 - 2026-10-26 06:54

> 由 33個散file + oom -536870904 + 153/160 fail → 25個乾淨目錄 + 162/162 pass + CI + ESLint

## 1. 總結 (你怕爆context睇呢段就夠)

- **原本問題**: `routes/` `middleware/` `utils/` 散喺根目錄，`import use` 有空格中文路徑 `小行星網店` 觸發 `cdn.fbsbx.com` block，OneDrive掃 `2023-04~2024-03` + `node_modules` 搞到 VS Code `oom -536870904`，Copilot Agent `6個室error`
- **而家狀態**: `src/` `scripts/` `docs/` `public/assets/images/` `import_use/` 乾淨，`node --check` 過，`npm run dev /health 200`，`npm test 162/162`
- **備份**: `034ea09 backup before restructure`，任何時間可返轉頭

## 2. 新舊路徑對照表 (你話睇唔慣path睇呢個)

| 舊路徑 | 新路徑 | 備註 |
|---|---|---|
| `backup-data.js` | `scripts/backup-data.js` |  |
| `bundle_to_md.py` | `scripts/bundle_to_md.py` |  |
| `clean_script.py` | `scripts/clean_script.py` |  |
| `fix_script.py` | `scripts/fix_script.py` |  |
| `data.json` | `scripts/data.json` |  |
| `DEPLOYMENT.md` | `docs/DEPLOYMENT.md` |  |
| `ERROR_LOG.md` | `docs/ERROR_LOG.md` |  |
| `TODO.md` | `docs/TODO.md` |  |
| `project_summary.md` | `docs/project_summary.md` + 根目錄副本保留 | 你的記憶檔 |
| `import use/` | `import_use/` | 去空格 |
| `routes/analytics.js` | `backups/old-analytics-20241024.js` | 封存，hash同Fixed版一樣 |
| `routes/Routes-Analytics-Fixed.js` | `src/routes/Routes-Analytics-Fixed.js` | 指定保留版 |
| `routes/customer.js` | `src/routes/customer.js` | 會員端 `/api/customer` |
| `routes/customers.js` | `src/routes/customers.js` | 後台CRM `/api/admin/customers`，兩個都保留，唔係重複 |
| `routes/inbound.js` | `src/routes/inbound.js` |  |
| `routes/orders.js` | `src/routes/orders.js` |  |
| `routes/payment-proofs.js` | `src/routes/payments.js` | 改簡潔名 |
| `routes/products.js` (52KB最大) | `src/routes/products/` -> `validation.js` + `queries.js` + `handlers.js` + `index.js` | PR #2 拆細 |
| `routes/reminders.js` | `src/routes/reminders.js` |  |
| `routes/reviews.js` | `src/routes/reviews.js` |  |
| `routes/shipping.js` | `src/routes/shipping.js` |  |
| `routes/webhook.js` | `src/routes/webhooks.js` | 改複數，URL `/api/webhook` 不變 |
| `middleware/*.js` (6個) | `src/middleware/*.js` | admin-sessions, api-protection, customer-session, error-handler, sensitive-rate-limits, whatsapp-cloud-api |
| `utils/*.js` | `src/utils/*.js` | whatsapp-cloud-api, whatsapp-order-parser |
| `public/image/*` | `public/assets/images/*` | manifest + sw.js 已更新 |

**根目錄仲有**: `index.js` (而家委派 `require('./src/routes')`), `project_summary.md` 副本, `.vscode/settings.json v2` (exclude node_modules/backups/2023-04...)

## 3. 測試進化史

- **PR #0 重構前**: `153/160`，7個fail係 `analytics margin/cost` assertion
- **PR #1 fix-tests-docs-tooling (75 steps, 6.5 credits, 7m3s)**
  - 原因: fixture用舊 `price_at_purchase`，但migration而家係 `unit_price`，利潤報表 `100%成本覆蓋` 重複加總
  - 修正: `tests/analytics.test.js` + `src/routes/Routes-Analytics-Fixed.js`
  - 結果: `160/160`，commit `6d42bb5`
  - 文件: `README.md` + `docs/DEPLOYMENT/TODO/ERROR_LOG.md` 更新，commit `c6080c8`
  - 工具: ESLint + Prettier + `lint/format` scripts，commit `6d0bc4c`
- **PR #2 security-ci-refactor-docs (4合1)**
  - `7b8ebe5 security`: CORS限同源/白名單，Google登入+電話認領補rate limit，唔回DB錯誤細節
  - `4506969 ci`: `.github/workflows/ci.yml` Node20 `npm ci + lint + test` + README badge
  - `0874a5a refactor`: `products.js` 52KB拆做 `validation/queries/handlers`
  - `2a16594 docs`: `docs/API.md` 10個router完整端點
  - 結果: `162/162` (新增 `security.test.js`)

## 4. 現時目錄樹 (25項)

```
LittlePlanet/
├── .github/workflows/ci.yml
├── .vscode/settings.json (v2: exclude node_modules, backups, 2023-04...)
├── backups/old-analytics-20241024.js
├── docs/API.md, DEPLOYMENT.md, TODO.md, ERROR_LOG.md, project_summary.md
├── import_use/
├── public/assets/images/littleplanet.png, pwa-icon.svg...
├── scripts/backup-data.js, bundle_to_md.py...
├── source/ (Excel/Word業務草稿，保留)
├── src/
│   ├── routes/
│   │   ├── index.js (集中掛載)
│   │   ├── Routes-Analytics-Fixed.js
│   │   ├── customer.js, customers.js, inbound.js, orders.js
│   │   ├── payments.js, reminders.js, reviews.js, shipping.js, webhooks.js
│   │   └── products/validation.js, queries.js, handlers.js, index.js
│   ├── middleware/admin-sessions.js...
│   └── utils/whatsapp-*.js
├── supabase/migrations/
├── tests/ (160->162 tests)
├── index.js, package.json, project_summary.md (root副本)
└── eslint.config.js, .prettierrc.json
```

## 5. 點樣搵file (你話睇唔慣)

- VS Code `Ctrl+P` 打 `customer` -> 出 `src/routes/customer.js` + `customers.js`
- `Ctrl+Shift+F` 全文搜 `unit_price`
- Explorer pin `src/` folder
- `import_use` 無空格，唔會再trigger cdn.fbsbx.com block

## 6. OneDrive 2216個delete警告處理

- 原因: `git mv` 搬file，OneDrive以為你delete舊file，想幫你雲端都delete埋，連 `.git/FETCH_HEAD` 都想刪
- 正確按: 藍色 `保留2216個項目`，唔好剔 `不要再詢問`，然後右鍵 `永遠保留在此裝置上` + `暫停同步2小時` 再 `繼續同步`

## 7. Credits使用 (11月1日08:00重置)

- 開始: `45% used`
- PR #1: `6.5 credits`, 7m3s, +2698 -1447
- PR #2: 4合1，約12-15 credits
- 仲有 ~40% 到11/1，夠做多2-3轉

## 8. 下一步 (你聽朝返工前)

- [x] Merge PR #1 (已做) -> 160/160
- [x] Merge PR #2 (已做) -> 162/162 + CI + docs
- [ ] 本地 `git checkout master && git pull && npm test` 確認綠
- [ ] `git branch -d agents/...` 清worktree
- [ ] OneDrive 綠剔後 `npm run dev` 試 `/health 200`
- 下次可做: Dockerfile, 效能N+1查詢, 前台 `public` 快取, WhatsApp中文解析優化

## 9. Commit歷史 (重點)

- `034ea09 backup before restructure`
- `restructure: move to src/, scripts/, docs/, assets`
- `6d42bb5 fix analytics profit fallback tests`
- `c6080c8 docs: update paths after restructuring`
- `6d0bc4c chore: add lint and format tooling`
- `7b8ebe5 security: harden middleware and routes`
- `4506969 ci: add GitHub Actions workflow`
- `0874a5a refactor: split products route into modules`
- `2a16594 docs: add API documentation`

---

你由 `今日零開發....炆都炆左幾個鐘` 到 `162 tests全過 + 自動波通宵`，呢份就係得著。瞓啦，聽朝直接寫feature得。
