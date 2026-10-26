# LittlePlanet 兩日散修修 Note 總總結 - 2026-10-26 返工前最後版

> 呢份係將呢兩日散喺 `notes/` `docs/` `project_summary.md` `RESTRUCTURE_DETAIL.md` `SOP` `source/` 嘅野，濃縮做一個file，唔會再爆context。

## 一句總結
由 **33個file散喺根目錄 + oom -536870904 + 153/160 fail + OneDrive 2216個delete警告** → **28個乾淨目錄 + 162/162全綠 + CI + ESLint + README + API文件 + Merged #1 #2**。

---

## 1. 專案係咩 (由你個 source/ 同 notes/ 業務草稿整合)

- **名**: LittlePlanet 小行星網店
- **Stack**: Express 4.19.2 + Supabase JS 2.43.0 + WhatsApp Cloud API + node-cache + helmet + rate-limit
- **核心流程**: 
  1. 客戶WhatsApp落單 (文字 `產品碼+數量` 中文變體/全形/簡寫都識) -> `whatsapp-order-parser.js`
  2. `inbound.js` 建立 `待確認意圖`，唔會即時扣庫存
  3. 相同訊息重送只建一個意圖，重用確認碼
  4. 確認後先建 `未付款訂單`，重送確認唔會重複建單
  5. 付款憑證圖片 `webhooks.js` / `payments.js` 處理：要order-number caption + matching sender phone，驗圖片格式，私存轉發內部，防重，去重，轉發失敗會記錄但保留 `pendingreview`
  6. `products.js` 52KB最大，管產品CRUD、庫存、圖片上傳 `PRODUCT_IMAGE_BUCKET`
  7. `analytics.js` (Routes-Analytics-Fixed.js) 利潤/毛利/成本覆蓋/top-products，原本用 `price_at_purchase`，migration而家係 `unit_price`

- **角色**:
  - `customer.js` -> `/api/customer` 會員端 (收藏清單 wishlist、落單)
  - `customers.js` -> `/api/admin/customers` 後台CRM，兩個唔同權限，唔可以合併

## 2. 重構全過程 (由你啲notes/01,02,03 + Copilot log 執返)

**10/25 23:27** 初版 `settings.json` 只有 `workspaceExcludePatterns` 含 `**/OneDrive/**`，導致連自己project都exclude，照爆。

**10/26 00:50** 發現 `routes/` 12個file：
`analytics.js 37KB vs Routes-Analytics-Fixed.js 36KB hash一樣`、`customer.js 31KB vs customers.js 8KB 唔係重複`、`payment-proofs.js 10KB->payments.js`、`webhook.js 27KB->webhooks.js`、`products.js 52KB最大`。

**10/26 02:xx** 第一次重構稽核，Copilot話 `public/image/` 被首頁/manifest/sw.js引用，`project_summary.md` + `notes/.obsidian/workspace.json` 要保留，`source/` 入面係3份Excel/Word業務草稿+PRD唔係舊code。

**10/26 oom -536870904** VS Code `Visual Studio Code (7) 579MB + Copilot Runtime 270MB + Chrome 510MB`，原因係Agent掃埋 `OneDrive/Couse/Project/小行星網店` 上層 + `2023-04 to 2024-03` + `node_modules`。

**修正**: `.vscode/settings.json v2` 加 `files.exclude` + `search.exclude` 排除 `node_modules, backups, 2023-04...`，刪走 `**/OneDrive/**`，OneDrive右鍵暫停同步2小時，`import use` 空格改 `import_use`，`public/image` -> `public/assets/images`。

**結果**: `git mv` 成功，`34ea09 backup before restructure`，`restructure: move to src/, scripts/, docs/, assets`，由33項變25項，後來加CI/lint/docs變28項，全部綠剔，OneDrive 2216個delete按藍色 `保留` 解決。

## 3. 新舊路徑對照 (你話睇唔慣path)

```
backup-data.js, bundle_to_md.py, clean_script.py, fix_script.py, data.json -> scripts/
DEPLOYMENT.md, ERROR_LOG.md, TODO.md -> docs/ (project_summary.md保留根副本+docs副本)
import use/ -> import_use/
routes/* -> src/routes/* (customer+customers都保留)
middleware/* -> src/middleware/* (6個)
utils/* -> src/utils/*
public/image/* -> public/assets/images/*
routes/analytics.js -> backups/old-analytics-20241024.js (封存)
routes/Routes-Analytics-Fixed.js -> src/routes/Routes-Analytics-Fixed.js
routes/products.js -> src/routes/products/validation.js, queries.js, handlers.js, index.js (PR #2)
```

**搵file**: VS Code `Ctrl+P` 打 `customer`，`Ctrl+Shift+F` 搜 `unit_price`。

## 4. 測試進化

- 重構前: `153/160`，7個fail係 `tests/analytics.test.js` 用舊 `price_at_purchase`，現行migration `unit_price` + 利潤100%覆蓋重複加總。
- PR #1 `agents/fix-tests-docs-tooling-setup` 75 steps 7m3s 6.5 credits +2698 -1447:
  - `6d42bb5 fix analytics profit fallback tests` -> `160/160`
  - `c6080c8 docs: update paths after restructuring` -> README + DEPLOYMENT/TODO/ERROR_LOG
  - `6d0bc4c chore: add lint and format tooling` -> ESLint + Prettier + lint/format scripts + /health 200
- PR #2 `agents/security-ci-refactor-docs-tasks` 4合1:
  - `7b8ebe5 security`: CORS限同源/白名單，Google登入+電話認領補專用rate limit，唔回DB錯誤細節
  - `4506969 ci`: `.github/workflows/ci.yml` Node20 push master跑 npm ci + lint + test + README badge
  - `0874a5a refactor`: `products.js` 拆做 `validation/queries/handlers`
  - `2a16594 docs`: `docs/API.md` 10個router完整端點 + 認證 + 參數 + static路徑
  - 結果: `162/162` (新增 `security.test.js`)

測試log重點: `WhatsApp image receipts require order-number caption`、`valid receipt is stored privately`、`invalid image bytes are rejected`、`wishlist endpoints require member session` 全部 `✔`。

## 5. 文件同SOP (由 notes/SOP.md + docs/ 組合)

**SOP重點** (你notes/SOP.md):
- 落單: WhatsApp文字解析 -> 待確認意圖 -> 確認 -> 未付款訂單 -> 付款憑證圖片驗證
- 圖片: 要caption有order-number，sender phone要match，大小限制，allowlisted URL先download
- 轉發: 失敗會記錄但唔會令proof變paid，保持pendingreview
- 庫存: 唔係即時扣，確認意圖後先扣，零數量/超checkout limit reject

**DEPLOYMENT.md 26KB (26/10 6:54更新)**:
- 新路徑 `src/` `scripts/` `docs/` `public/assets/images/` `import_use/`
- 環境變數 `SUPABASE_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`, `PORT`
- `npm run dev` -> `/health 200`

**ERROR_LOG.md 3KB**:
- 之前 `cdn.fbsbx.com` block中文路徑、`oom -536870904`、`markdown無限loop` 已解
- 而家 `public` 雲朵圖示係按需下載，正常

**TODO.md 2KB**:
- PR #1 #2 已清，下一步: Dockerfile, N+1查詢優化, 前台快取, WhatsApp中文變體優化

**RESTRUCTURE_DETAIL.md 7KB 7:22**:
- 你啱啱save入 `docs/` 嗰份，係我幫你濃縮嘅得著

## 6. 現時目錄 (28項，全部OneDrive綠剔)

```
LittlePlanet/
├── .github/workflows/ci.yml
├── .vscode/settings.json v2
├── backups/old-analytics-20241024.js
├── docs/API.md, DEPLOYMENT.md, ERROR_LOG.md, TODO.md, project_summary.md, RESTRUCTURE_DETAIL.md
├── import_use/
├── public/assets/images/littleplanet.png, pwa-icon.svg...
├── scripts/backup-data.js, bundle_to_md.py...
├── source/ (Excel/Word草稿，保留)
├── src/routes/index.js + 10個route + products/ 4個module
├── src/middleware/ 6個
├── src/utils/ 2個
├── supabase/migrations/
├── tests/ 162 tests
├── index.js, package.json, README.md, project_summary.md, eslint.config.js, .prettierrc.json
```

## 7. Credits同時間線

- 開始: 45% used, 10/26 6:56 Merged PR #1, 7:22 RESTRUCTURE_DETAIL.md, 7:23 docs/ 5項
- PR #1: 6.5 credits, 7m3s
- PR #2: 約12-15 credits
- 重置: 11月1日 08:00，仲有~40%夠做Dockerfile + 效能優化

## 8. 返工前最後checklist

- [x] OneDrive 2216個delete按藍色保留，已全綠剔
- [x] `git checkout master && git pull && npm test` -> 162/162
- [x] `docs/RESTRUCTURE_DETAIL.md` 已入docs
- [x] PR #1 #2 Merged
- [ ] `git branch -d agents/...` 清worktree (得閒先)
- [ ] `npm run dev` /health 200 (聽朝)

**一句俾Copilot下次自動波用**: 你而家貼 `docs/RESTRUCTURE_DETAIL.md` + 呢份 `FINAL_SUMMARY.md`，我就會返晒嚟，唔使再60個file逐個喂，唔會爆context。

---

呢兩日你由 `今日零開發....炆都炆左幾個鐘` 到 `160->162全綠 + 自動波通宵`，得著唔係 `仲未明既RESTRUCTURE`，係成個地基起好咗。去返工啦，個tree我幫你睇住。
