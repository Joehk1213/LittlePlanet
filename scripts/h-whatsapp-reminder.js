'use strict';

const fs = require('node:fs');
const path = require('node:path');
const pino = require('pino');
const normalizePhone = require('../src/utils/normalize-phone');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const REPORT_PATH = path.join(PROJECT_ROOT, 'H_REMINDER_LIST.md');
const DAY_MS = 24 * 60 * 60 * 1000;

function getOrderAge(order, field, now) {
  const timestamp = Date.parse(order[field] || '');
  if (!Number.isFinite(timestamp) || timestamp > now.getTime()) {
    return null;
  }
  return now.getTime() - timestamp;
}

function classifyReminderCandidates(orders, now = new Date()) {
  const result = {
    unpaid: [],
    paid: [],
    shipped: [],
    invalid: 0,
    insufficient: 0,
    dataInsufficient: !Array.isArray(orders),
  };
  if (!Array.isArray(orders)) {
    return result;
  }

  for (const order of orders) {
    if (!order || typeof order !== 'object') {
      result.invalid += 1;
      continue;
    }

    const phone = normalizePhone(order.customer_phone);
    if (!phone || typeof order.order_number !== 'string' || !order.order_number.trim()) {
      result.invalid += 1;
      continue;
    }

    let category = null;
    let ageField = 'order_date';
    let threshold = 0;
    if (order.status === 'pending' && order.payment_status !== '已付清') {
      category = 'unpaid';
      threshold = DAY_MS;
    } else if (order.status === 'paid' && order.payment_status === '已付清') {
      category = 'paid';
      threshold = 2 * DAY_MS;
    } else if (order.status === 'shipped' && order.shipping_status === '已出貨') {
      category = 'shipped';
      ageField = 'shipped_at';
      threshold = 3 * DAY_MS;
    }

    if (!category) {
      continue;
    }

    const age = getOrderAge(order, ageField, now);
    if (age === null) {
      result.insufficient += 1;
      continue;
    }
    if (age <= threshold) {
      continue;
    }

    result[category].push({
      order_number: order.order_number.trim(),
      phone_suffix: phone.slice(-4),
    });
  }

  result.dataInsufficient = result.insufficient > 0;
  return result;
}

function formatReminderReport(result, mode = 'dry-run') {
  const lines = [
    '# WhatsApp 提醒 dry-run 清單',
    '',
    `- 模式：${mode === 'dry-run' ? 'dry-run（不發送訊息、不查詢資料庫）' : 'real 開關檢查；本工具仍只產生清單'}`,
    `- 資料來源：${result.dataInsufficient && result.unpaid.length + result.paid.length + result.shipped.length === 0
      ? '資料不足：未提供訂單資料，不會查詢真實資料庫或推測訂單'
      : '呼叫端提供的測試／模擬訂單資料'}`,
    `- 未付款超過 24 小時：${result.unpaid.length}`,
    `- 已付清但未出貨超過 48 小時：${result.paid.length}`,
    `- 已出貨超過 72 小時待完成：${result.shipped.length}`,
    `- 無效資料：${result.invalid}`,
    `- 時間資料不足：${result.insufficient}`,
  ];

  for (const [category, title] of [
    ['unpaid', '未付款超過 24 小時'],
    ['paid', '已付清但未出貨超過 48 小時'],
    ['shipped', '已出貨超過 72 小時待完成'],
  ]) {
    lines.push('', `## ${title}`, '');
    if (result[category].length === 0) {
      lines.push('- 沒有符合條件的訂單。');
      continue;
    }
    for (const order of result[category]) {
      lines.push(`- 訂單 ${order.order_number}｜電話尾碼 ${order.phone_suffix}`);
    }
  }

  lines.push(
    '',
    '本報告只輸出正式訂單編號及電話尾碼；此腳本不連接資料庫、不寫入資料庫，也不發送 WhatsApp 訊息。',
    ''
  );
  return lines.join('\n');
}

function assertRealModeAllowed(env, serviceRoleAvailable) {
  if (
    env.NODE_ENV !== 'production' ||
    env.WHATSAPP_ENABLED !== 'true' ||
    serviceRoleAvailable !== true
  ) {
    throw new Error('WhatsApp real send disabled in Development.');
  }
}

async function run(options = {}) {
  const env = options.env || process.env;
  const mode = options.mode || 'dry-run';
  if (!['dry-run', 'real'].includes(mode)) {
    throw new Error('Mode must be dry-run or real.');
  }
  if (mode === 'real') {
    assertRealModeAllowed(env, options.serviceRoleAvailable === true);
  }

  let orders = options.orders;
  if (orders === undefined && options.inputPath) {
    const raw = fs.readFileSync(options.inputPath, 'utf8');
    orders = JSON.parse(raw);
  }
  const result = classifyReminderCandidates(orders, options.now || new Date());
  const reportPath = options.reportPath || REPORT_PATH;
  fs.writeFileSync(reportPath, formatReminderReport(result, mode), 'utf8');
  const logger = options.logger || pino({ level: 'info' });
  logger.info({
    event: 'whatsapp_reminder_list_generated',
    mode,
    unpaid_count: result.unpaid.length,
    paid_count: result.paid.length,
    shipped_count: result.shipped.length,
    data_insufficient: result.dataInsufficient,
  }, 'WhatsApp reminder list generated');
  return { ...result, reportPath };
}

if (require.main === module) {
  const mode = process.argv.includes('--real') ? 'real' : 'dry-run';
  const inputIndex = process.argv.indexOf('--input');
  const inputPath = inputIndex >= 0 ? process.argv[inputIndex + 1] : undefined;
  const serviceRoleAvailable = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  run({ mode, inputPath, serviceRoleAvailable }).catch(error => {
    pino({ level: 'error' }).error(
      { event: 'whatsapp_reminder_list_failed' },
      error.message
    );
    process.exitCode = 1;
  });
}

module.exports = {
  assertRealModeAllowed,
  classifyReminderCandidates,
  formatReminderReport,
  run,
};
