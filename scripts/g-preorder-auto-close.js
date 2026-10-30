'use strict';

const fs = require('node:fs');
const path = require('node:path');
const pino = require('pino');
const { readProductCatalog } = require('../src/utils/product-csv');
const { normalizeProductId } = require('../src/utils/calculate-shipping');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const REPORT_PATH = path.join(PROJECT_ROOT, 'G_PREORDER_AUTOCLOSE_LIST.md');
const VALID_PRODUCT_STATUSES = new Set(['預購中', '旅購中', '已到貨', '已下架']);

function inspectExpiredPreorders(catalog, now = new Date()) {
  const records = catalog && Array.isArray(catalog.records) ? catalog.records : [];
  const hasDeadlineColumn = Boolean(catalog && catalog.headers.includes('preorder_deadline'));
  const expired = [];
  let missingDeadline = 0;
  let invalidRows = 0;
  let unsupportedStatus = 0;

  for (const record of records) {
    const productId = normalizeProductId(record.id);
    if (!productId) {
      invalidRows += 1;
      continue;
    }

    if (!VALID_PRODUCT_STATUSES.has(record.status)) {
      unsupportedStatus += 1;
    }

    const deadlineText = typeof record.preorder_deadline === 'string'
      ? record.preorder_deadline.trim()
      : '';
    if (!deadlineText) {
      missingDeadline += 1;
      continue;
    }
    const deadline = Date.parse(deadlineText);
    if (!Number.isFinite(deadline)) {
      invalidRows += 1;
      continue;
    }
    if (deadline >= now.getTime()) {
      continue;
    }
    if (!VALID_PRODUCT_STATUSES.has(record.status)) {
      continue;
    }
    if (record.status === '預購中') {
      expired.push({
        id: productId,
        name: record.name || '',
        deadline: new Date(deadline).toISOString(),
        currentStatus: record.status,
        nextStatus: '已下架',
      });
    }
  }

  return {
    expired,
    missingDeadline,
    invalidRows,
    unsupportedStatus,
    dataInsufficient: !catalog || catalog.missing || !hasDeadlineColumn || missingDeadline === records.length,
  };
}

function formatReport(catalog, result, mode, rpcResult = null) {
  const lines = [
    '# 預購自動截單檢查',
    '',
    `- 執行模式：${mode === 'dry-run' ? 'dry-run（不寫入資料庫）' : 'mock RPC（測試模擬）'}`,
    `- CSV：${catalog && !catalog.missing ? '已讀取 source/products.csv' : '資料不足：找不到 source/products.csv'}`,
    `- CSV 商品數：${catalog && Array.isArray(catalog.records) ? catalog.records.length : 0}`,
    `- 可關閉商品數：${result.expired.length}`,
    `- 缺少截止時間：${result.missingDeadline}`,
    `- 無效資料列：${result.invalidRows}`,
    `- 不支援的狀態值：${result.unsupportedStatus}`,
  ];

  if (result.dataInsufficient) {
    lines.push('- 資料狀態：資料不足；未推定或補造任何截止時間。');
  }
  if (mode === 'mock-real') {
    lines.push(`- close_expired_preorders RPC 模擬：${rpcResult && !rpcResult.error ? '成功' : '失敗'}`);
  }

  lines.push('', '## 過期預購商品', '');
  if (result.expired.length === 0) {
    lines.push('- 沒有符合條件的商品。');
  } else {
    for (const product of result.expired) {
      lines.push(
        `- ID ${product.id}｜${product.name || '（未命名）'}｜截止 ${product.deadline}｜${product.currentStatus} → ${product.nextStatus}`
      );
    }
  }
  lines.push('', '本報告只依 CSV 做靜態檢查；正式關單只可透過授權後端 RPC 執行。', '');
  return `${lines.join('\n')}`;
}

async function run(options = {}) {
  const mode = options.mode || 'dry-run';
  if (!['dry-run', 'real'].includes(mode)) {
    throw new Error('Mode must be dry-run or real.');
  }
  if (mode === 'real' && !options.mockedSupabaseClient) {
    throw new Error('Real mode requires an explicitly injected mock Supabase client in this development tool.');
  }

  const catalog = options.catalog || readProductCatalog(options.rootDirectory || PROJECT_ROOT);
  const result = inspectExpiredPreorders(catalog, options.now || new Date());
  let rpcResult = null;
  if (mode === 'real') {
    rpcResult = await options.mockedSupabaseClient.rpc('close_expired_preorders');
    if (!rpcResult || rpcResult.error) {
      throw new Error('Mock close_expired_preorders RPC failed.');
    }
  }

  const report = formatReport(catalog, result, mode === 'real' ? 'mock-real' : 'dry-run', rpcResult);
  const reportPath = options.reportPath || REPORT_PATH;
  fs.writeFileSync(reportPath, report, 'utf8');

  const logger = options.logger || pino({ level: 'info' });
  logger.info({
    event: 'preorder_autoclose_inspected',
    mode,
    expired_count: result.expired.length,
    data_insufficient: result.dataInsufficient,
  }, '預購截單檢查完成');

  return { ...result, reportPath };
}

if (require.main === module) {
  const mode = process.argv.includes('--real') ? 'real' : 'dry-run';
  run({ mode }).catch(error => {
    pino({ level: 'error' }).error({ event: 'preorder_autoclose_failed' }, error.message);
    process.exitCode = 1;
  });
}

module.exports = { formatReport, inspectExpiredPreorders, run };
