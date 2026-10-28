'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  PROJECT_ROOT,
  markdownTable,
  readCatalog,
  writeReport,
} = require('./f-catalog-utils');

const PREORDER_STATUS = '預購中';

function isExpired(deadline, now) {
  const timestamp = Date.parse(deadline);
  return Number.isFinite(timestamp) && timestamp < now.getTime();
}

function run(options = {}) {
  const root = options.root || PROJECT_ROOT;
  const now = options.now || new Date();
  const catalog = readCatalog(root);
  const candidates = catalog.records
    .filter((record) => {
      if (!record.preorder_deadline || !isExpired(record.preorder_deadline, now)) {
        return false;
      }
      return !record.status || record.status === PREORDER_STATUS;
    })
    .map((record) => ({
      id: record.id || '',
      name: record.name || record.product_name || '',
      deadline: record.preorder_deadline,
      stock: record.stock || '0',
      action: 'close (status=已下架)',
    }));
  const skippedStatuses = catalog.records.filter((record) => (
    record.preorder_deadline &&
    isExpired(record.preorder_deadline, now) &&
    record.status &&
    record.status !== PREORDER_STATUS
  ));
  const inputLabel = catalog.isExample
    ? 'CSV 真檔不存在；候選清單基於合成範例，不是實際關單指令。'
    : '唯讀 dry-run；沒有更新資料庫。';
  const report = `# F 預購截單自動關閉候選清單

${inputLabel}

- 評估時間：${now.toISOString()}
- CSV 來源：\`${path.relative(root, catalog.path)}\`
- 過期且符合目前商品狀態的候選數：${candidates.length}
- 因狀態不符而略過：${skippedStatuses.length}
- 現行 products.status 列舉：\`預購中\`、\`旅購中\`、\`已到貨\`、\`已下架\`
- 本清單只建議將 \`預購中\` 改為 \`已下架\`；不會改動 \`旅購中\`。
- 如果來源 CSV 沒有 \`status\` 欄，候選預設假設會按 DB 現行預設狀態 \`預購中\` 建立；必須先以正式資料核對。
- 資料庫沒有執行任何 SQL。

${markdownTable(['商品 ID', '名稱', '截單時間', '庫存', '建議動作'], candidates.map((item) => [
    item.id,
    item.name,
    item.deadline,
    item.stock,
    item.action,
  ]))}

## 預覽 SQL（不可執行）

對應 draft 位於 \`supabase/migrations/20261031000100_preorder_auto_close.sql.draft\`。這不是可套用 migration；須經業務確認、測試及另行批准後才可建立正式 migration。
`;

  const draftPath = path.join(
    root,
    'supabase',
    'migrations',
    '20261031000100_preorder_auto_close.sql.draft'
  );
  fs.writeFileSync(
    draftPath,
    `-- DRAFT ONLY: not a Supabase migration; do not apply or rename to .sql.
-- Existing schema values are Chinese; do not use the unrecognized 'preorder'/'closed'.
-- Current candidates: status = '預購中' AND preorder_deadline < now().
-- Preview only:
-- UPDATE public.products
-- SET status = '已下架'
-- WHERE preorder_deadline < now()
--   AND status = '預購中';
-- This file intentionally contains comments only.
`,
    'utf8'
  );
  writeReport(root, 'F_PREORDER_AUTOCLOSE_LIST.md', report);
  return {
    candidateCount: candidates.length,
    skippedStatusCount: skippedStatuses.length,
    isExample: catalog.isExample,
    draftPath,
  };
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(run(), null, 2));
  } catch (error) {
    console.error(`Preorder preview failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  isExpired,
  run,
};
