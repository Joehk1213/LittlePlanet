'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const pino = require('pino');
const {
  PROJECT_ROOT,
  markdownTable,
  writeReport,
} = require('./f-catalog-utils');
const { validateCatalog } = require('./f-validate-products');

function parseMode(args) {
  const unknown = args.filter((argument) => !['--dry-run', '--real'].includes(argument));
  if (unknown.length > 0 || (args.includes('--dry-run') && args.includes('--real'))) {
    throw new Error('Use either --dry-run or --real.');
  }
  return args.includes('--real') ? 'real' : 'dry-run';
}

function createServiceRoleClient(root = PROJECT_ROOT, createClientFn = createClient) {
  const envPath = path.join(root, '.env.docker');
  let env;
  try {
    env = dotenv.parse(fs.readFileSync(envPath));
  } catch {
    throw new Error('Unable to load required .env.docker configuration.');
  }
  const supabaseUrl = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('.env.docker must define SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }
  try {
    return createClientFn(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  } catch {
    throw new Error('Unable to initialize the backend service-role client.');
  }
}

function createDryRunReport(validation) {
  const simulated = validation.validRows.map(({ result }) => [
    result.id,
    result.stock,
    '已驗證 CSV 非負庫存；只模擬 FOR UPDATE 計畫，沒有連線或鎖資料庫',
  ]);
  const invalid = validation.invalidRows.map(({ record, result }) => [
    record.__row,
    result.id,
    result.errors.join('；'),
  ]);
  const statusWarnings = validation.results
    .filter(({ result }) => result.warnings.some((warning) => warning.includes('status 不符合')))
    .length;
  const costWarning = validation.catalog.headers.includes('cost_price')
    ? 'cost_price 欄存在；只會匯入通過驗證的非空成本值。'
    : 'cost_price 欄缺失，匯入 payload 會省略該欄以免清除既有成本；毛利資料不足。';
  return [
    '# F 商品匯入 Dry-run 報告',
    '',
    '- 模式：dry-run；沒有連線、寫入或改動資料庫。',
    `- 來源：${validation.catalog.missing ? 'source/products.csv 不存在' : 'source/products.csv'}`,
    `- 商品列：${validation.catalog.records.length}`,
    `- 通過列：${validation.validRows.length}`,
    `- 無效列：${validation.invalidRows.length}`,
    `- 缺少 cost_price：${validation.missingCostRows.length}`,
    `- 無法按資料庫 enum 使用、已略過的 status 列：${statusWarnings}`,
    '- FOR UPDATE：只記錄模擬計畫；沒有取得實際資料庫鎖，庫存檢查只驗證 CSV 值。',
    '- 真實匯入會使用後端 service_role client；本報告不載入或輸出任何金鑰。',
    '- 不匯入 created_at；空白 optional 欄位及未知 status 不會用猜測值覆蓋現有資料。',
    '',
    '## CSV 庫存檢查模擬',
    '',
    markdownTable(['商品 ID', 'CSV stock', '檢查'], simulated),
    '',
    '## 無效列',
    '',
    markdownTable(['CSV 列', '商品 ID', '原因'], invalid),
    '',
    '## 成本資料警告',
    '',
    costWarning,
  ].join('\n');
}

function createRealReport(validation, importedCount) {
  return `# F 商品匯入執行報告\n\n- 模式：real\n- 商品列：${validation.catalog.records.length}\n- 成功提交 upsert 的列：${importedCount}\n- 寫入使用 service_role；只回報數量，不記錄金鑰或資料庫錯誤細節。\n- 請注意：Supabase REST upsert 不提供 FOR UPDATE 鎖；本工具不執行庫存扣減或原子庫存分配。\n`;
}

async function runImport(options = {}) {
  const mode = parseMode(options.args || []);
  const root = options.root || PROJECT_ROOT;
  const validation = validateCatalog(root);
  const logger = options.logger || pino({ level: 'info' });
  const payload = validation.validRows.map(({ result }) => result.payload);

  if (mode === 'dry-run') {
    const reportPath = writeReport(root, 'F_IMPORT_DRYRUN_REPORT.md', createDryRunReport(validation));
    logger.info({
      mode,
      rows: validation.catalog.records.length,
      valid_rows: validation.validRows.length,
      invalid_rows: validation.invalidRows.length,
      simulated_for_update: validation.validRows.length,
      database_writes: 0,
    }, 'Dry-run complete; no database lock or write was performed.');
    return {
      mode,
      totalRows: validation.catalog.records.length,
      validRows: validation.validRows.length,
      invalidRows: validation.invalidRows.length,
      reportPath,
    };
  }

  if (validation.catalog.missing || validation.invalidRows.length > 0) {
    throw new Error('Real import refused because the CSV is missing or contains invalid rows.');
  }
  if (payload.length === 0) {
    throw new Error('Real import refused because there are no validated products.');
  }

  const client = options.client || createServiceRoleClient(root, options.createClientFn);
  let response;
  try {
    response = await client.from('products').upsert(payload, { onConflict: 'id' });
  } catch {
    throw new Error('Product upsert failed; database details were omitted.');
  }
  if (response?.error) {
    throw new Error('Product upsert failed; database details were omitted.');
  }

  const reportPath = writeReport(root, 'F_IMPORT_REAL_REPORT.md', createRealReport(validation, payload.length));
  logger.info({
    mode,
    imported_rows: payload.length,
  }, 'Product upsert completed.');
  return {
    mode,
    totalRows: validation.catalog.records.length,
    importedRows: payload.length,
    reportPath,
  };
}

if (require.main === module) {
  runImport({ args: process.argv.slice(2) })
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error.message || 'Product import failed; details omitted.');
      process.exitCode = 1;
    });
}

module.exports = {
  createDryRunReport,
  createServiceRoleClient,
  parseMode,
  runImport,
};
