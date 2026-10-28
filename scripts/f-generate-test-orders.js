'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const {
  PROJECT_ROOT,
  markdownTable,
  readCatalog,
  writeReport,
} = require('./f-catalog-utils');
const { validateRecord } = require('./f-validate-products');

const ORDER_COUNT = 100;
const ORDER_STATUSES = [
  'pending',
  'paid',
  'shipped',
  'picked_up',
  'completed',
  'cancelled',
];

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function deterministicUuid(label) {
  const hex = crypto.createHash('sha256').update(label).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function selectPrice(product, quantity) {
  return product.tiers
    .filter((tier) => tier.min_qty <= quantity)
    .reduce((price, tier) => tier.price, product.price);
}

function prepareProducts(records) {
  return records
    .map((record) => ({ record, result: validateRecord(record) }))
    .filter(({ result }) => result.errors.length === 0)
    .map(({ result }) => ({
      id: result.id,
      name: result.name,
      price: result.price,
      costPrice: result.costPrice,
      stock: result.stock,
      tiers: result.tiers,
    }));
}

function buildOrder(index, products, random) {
  const lineCount = 1 + Math.floor(random() * Math.min(3, products.length));
  const selectedProducts = new Set();
  while (selectedProducts.size < lineCount) {
    selectedProducts.add(products[Math.floor(random() * products.length)]);
  }
  const items = [...selectedProducts].map((product, itemIndex) => {
    const quantity = 1 + Math.floor(random() * 5);
    const unitPrice = selectPrice(product, quantity);
    return {
      product_id: product.id,
      product_name: product.name,
      quantity,
      unit_price: unitPrice,
      subtotal: Number((unitPrice * quantity).toFixed(2)),
      cost_price: product.costPrice,
      profit: Number(((unitPrice - product.costPrice) * quantity).toFixed(2)),
      line_number: itemIndex + 1,
    };
  });
  const totalAmount = Number(items.reduce((sum, item) => sum + item.subtotal, 0).toFixed(2));
  const profitTotal = Number(items.reduce((sum, item) => sum + item.profit, 0).toFixed(2));
  const status = ORDER_STATUSES[Math.floor(random() * ORDER_STATUSES.length)];
  const pickup = status === 'picked_up' || (status === 'completed' && random() < 0.3);
  const wasShipped = status === 'shipped' || (status === 'completed' && !pickup);
  const isPaid = ['paid', 'shipped', 'picked_up', 'completed'].includes(status);
  const localPhone = `5550${String(index).padStart(4, '0')}`;
  const priorStatus = status === 'shipped' || status === 'picked_up' ? 'paid' :
    status === 'completed' ? (pickup ? 'picked_up' : 'shipped') :
      status === 'cancelled' && random() < 0.5 ? 'paid' : 'pending';

  return {
    order_id: deterministicUuid(`f-full-order-${index}`),
    order_number: `TEST-F-${String(index).padStart(5, '0')}`,
    customer_phone: `852${localPhone}`,
    is_test_data: true,
    idempotency_key: deterministicUuid(`f-full-idempotency-${index}`),
    order_date: new Date(Date.UTC(2026, 9, 28, 12, 0, index)).toISOString(),
    status,
    status_history: status === 'pending'
      ? ['pending']
      : [priorStatus, status],
    payment_status: isPaid || (status === 'cancelled' && priorStatus === 'paid')
      ? '已付清'
      : '未付款',
    shipping_status: wasShipped ? '已出貨' : '待到貨',
    shipping_method: pickup ? '自取' : '順豐',
    total_amount: totalAmount,
    profit_total: profitTotal,
    items_count: items.reduce((sum, item) => sum + item.quantity, 0),
    items,
  };
}

function run(options = {}) {
  const root = options.root || PROJECT_ROOT;
  const catalog = readCatalog(root);
  const products = prepareProducts(catalog.records);
  if (products.length === 0) {
    throw new Error('No valid catalog products are available for synthetic test-order generation.');
  }
  const random = seededRandom(options.seed ?? 20261029);
  const orders = Array.from({ length: ORDER_COUNT }, (_, index) => (
    buildOrder(index, products, random)
  ));
  const statusCounts = new Map(ORDER_STATUSES.map((status) => [status, 0]));
  for (const order of orders) {
    statusCounts.set(order.status, statusCounts.get(order.status) + 1);
  }
  const totalProfit = Number(orders.reduce((sum, order) => sum + order.profit_total, 0).toFixed(2));
  const totalLineItems = orders.reduce((sum, order) => sum + order.items.length, 0);
  const totalItemUnits = orders.reduce((sum, order) => sum + order.items_count, 0);
  const outputPath = path.join(root, 'F_TEST_ORDERS_100.json');
  const warning = catalog.isExample
    ? '注意：source/products.csv 不存在；這 100 張單採用合成範例商品與價格，不代表真實訂單或利潤。'
    : '注意：這是合成測試資料，不是真實訂單；不可用於生產、通知客人或寫入正式資料庫。';
  const summary = `# F 100 張合成測試訂單摘要

${warning}

- 商品來源：\`${path.relative(root, catalog.path)}\`
- 可用商品數：${products.length}（不合格 CSV 列不會被用來生成測試訂單）
- 訂單數：${orders.length}
- 電話：只使用合成 8 位數字 \`5550xxxx\`，資料欄位保存為 \`8525550xxxx\`；禁止用於 WhatsApp／SMS 通知
- UUID v4 order_id / idempotency_key：每張單各自固定且唯一
- 合計毛利（只按測試商品成本計算）：HK$${totalProfit.toFixed(2)}
- 平均明細列數：${(totalLineItems / orders.length).toFixed(2)}
- 平均件數：${(totalItemUnits / orders.length).toFixed(2)}
- 訂單狀態分布：

${markdownTable(['狀態', '數量'], [...statusCounts.entries()])}

輸出：\`F_TEST_ORDERS_100.json\`。資料內含 \`is_test_data: true\`，只供離線負載測試 fixture 使用；不會連線或寫入資料庫。
`;
  require('node:fs').writeFileSync(outputPath, `${JSON.stringify({
    generated_at: new Date().toISOString(),
    synthetic: true,
    catalog_source: path.relative(root, catalog.path),
    catalog_is_example: catalog.isExample,
    orders,
  }, null, 2)}\n`, 'utf8');
  writeReport(root, 'F_TEST_ORDERS_SUMMARY.md', summary);
  return {
    orderCount: orders.length,
    totalProfit,
    averageLineItems: totalLineItems / orders.length,
    averageItemUnits: totalItemUnits / orders.length,
    statusCounts: Object.fromEntries(statusCounts),
    isExample: catalog.isExample,
  };
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(run(), null, 2));
  } catch (error) {
    console.error(`Synthetic order generation failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildOrder,
  deterministicUuid,
  prepareProducts,
  run,
  seededRandom,
};
