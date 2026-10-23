const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const publicDirectory = path.join(__dirname, '..', 'public');

test('storefront includes instant keyword search, urgency badges and accessible cart interactions', () => {
  const html = fs.readFileSync(path.join(publicDirectory, 'index.html'), 'utf8');
  const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1])
    .filter(Boolean)
    .join('\n');

  assert.match(html, /data-search-keyword="日本直送"/);
  assert.match(html, /data-search-keyword="限時特價"/);
  assert.match(html, /data-search-keyword="人氣熱賣"/);
  assert.match(html, /id="cartShippingHint"/);
  assert.match(html, /id="cartDrawer"[^>]*role="dialog"/);
  assert.match(script, /setTimeout\(\(\) => loadProducts\(0\), 140\)/);
  assert.match(script, /stock > 0 && stock < 5/);
  assert.match(script, /團購優惠中/);
  assert.match(script, /openCart\(\);[\s\S]*showToast\(`已將 \$\{quantity\} 件/);
  assert.match(script, /const rawOrderNo = orderData\.order_number \|\| orderData\.orderNo/);
  assert.match(script, /UUID_PATTERN|0-9a-f\]\{8\}-\[0-9a-f\]/i);
  assert.match(script, /track\.html\?phone=\$\{encodeURIComponent\(phone\)\}&order_no=\$\{encodeURIComponent\(orderNo\)\}/);
  assert.match(script, /}, 2000\)/);
  assert.doesNotThrow(() => new vm.Script(script, { filename: 'public/index.html' }));
});

test('admin uses timed toasts and table skeletons during order and customer loads', () => {
  const html = fs.readFileSync(path.join(publicDirectory, 'admin.html'), 'utf8');
  const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1])
    .filter(Boolean)
    .join('\n');

  assert.match(script, /}, 2000\)/);
  assert.match(script, /function setTableSkeleton/);
  assert.match(script, /setTableSkeleton\(tbody, 7\)/);
  assert.match(script, /setTableSkeleton\(document\.getElementById\('orders-tbody'\), 10\)/);
  assert.doesNotThrow(() => new vm.Script(script, { filename: 'public/admin.html' }));
});
