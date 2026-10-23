const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const adminHtml = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'admin.html'),
  'utf8'
);
const inlineScript = [...adminHtml.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1])
  .filter(Boolean)
  .join('\n');

test('admin SOP generator is limited to product managers and supplies pricing, cutoff, upload and preview controls', () => {
  assert.match(adminHtml, /id="sop-tab"[^>]*hidden>🪐 SOP 貼文生成器/);
  assert.match(adminHtml, /id="sop-section" hidden/);
  assert.match(adminHtml, /id="sop-supplier-source"/);
  assert.match(adminHtml, /id="sop-image" type="file" accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(adminHtml, /id="sop-preview"/);
  assert.match(inlineScript, /Math\.ceil\(cost \* 1\.2\)/);
  assert.match(inlineScript, /deadline\.setDate\(deadline\.getDate\(\) \+ 7\)/);
  assert.match(inlineScript, /deadline\.setHours\(23, 59, 0, 0\)/);
  assert.match(inlineScript, /activeAdminView === 'sop' && !adminScopes\.includes\('products'\)/);
  assert.match(inlineScript, /method: 'POST',[\s\S]*body: JSON\.stringify\(\{[\s\S]*cost_price: costPrice/);
  assert.match(inlineScript, /\/api\/products\/images/);
  assert.match(inlineScript, /LittlePlanet 宇宙直送/);
  assert.match(inlineScript, /items=\$\{encodeURIComponent\(productId\)\}:1/);
  assert.doesNotMatch(inlineScript, /sop-supplier-source[\s\S]{0,100}body:/);
  assert.doesNotThrow(() => new vm.Script(inlineScript, { filename: 'public/admin.html' }));
});
