const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const publicDirectory = path.join(__dirname, '..', 'public');

test('storefront web app manifest declares installable LittlePlanet app metadata and an existing icon', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(publicDirectory, 'manifest.json'), 'utf8')
  );
  assert.equal(manifest.name, 'LittlePlanet 宇宙網店');
  assert.equal(manifest.short_name, 'LittlePlanet');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.theme_color, '#f8fafc');
  for (const size of ['192x192', '512x512']) {
    const icon = manifest.icons.find(item => item.sizes === size);
    assert.ok(icon, `manifest should include a ${size} icon`);
    assert.ok(fs.existsSync(path.join(publicDirectory, icon.src.replace(/^\//, ''))));
  }
  assert.ok(manifest.icons.some(icon =>
    icon.sizes === 'any' &&
    fs.existsSync(path.join(publicDirectory, icon.src.replace(/^\//, '')))
  ));
});

test('service worker parses and explicitly avoids caching API responses', () => {
  const source = fs.readFileSync(path.join(publicDirectory, 'sw.js'), 'utf8');
  assert.doesNotThrow(() => new vm.Script(source, { filename: 'public/sw.js' }));
  assert.match(source, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(source, /request\.mode === 'navigate'/);
  assert.match(source, /response\.ok && !url\.search/);
  assert.match(source, /caches\.match\('\/'\)/);
});
