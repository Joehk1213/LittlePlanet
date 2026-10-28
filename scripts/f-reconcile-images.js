'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  PROJECT_ROOT,
  markdownTable,
  readCatalog,
  writeReport,
} = require('./f-catalog-utils');

const IMAGE_EXTENSIONS = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.png', '.webp']);
const DEFAULT_ARCHIVE = 'D:\\docker-data\\littleplanet\\images.tar';
const DEFAULT_DOCKER_MANIFEST = 'D:\\docker-data\\littleplanet\\docker_images.txt';
const DEFAULT_EXPECTED_SHA256 =
  '3D91F03B5292A82F77D4338316D6E446D767356E6FE33CC37236D651C96CAC41';

function listImageFiles(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listImageFiles(fullPath));
    } else if (entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }
  return files;
}

function normalizeImagePath(value) {
  return value
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
    .join('/')
    .toLowerCase();
}

function readProductImages(root, records) {
  const publicRoot = path.join(root, 'public');
  const appImagesRoot = path.join(root, 'app', 'images');
  const roots = [
    publicRoot,
    appImagesRoot,
  ];
  const inventory = [...new Set(roots.flatMap(listImageFiles))].sort();
  const imagePaths = new Set();
  for (const file of inventory) {
    for (const imageRoot of roots) {
      if (file.startsWith(`${imageRoot}${path.sep}`)) {
        const relative = normalizeImagePath(path.relative(imageRoot, file));
        imagePaths.add(imageRoot === publicRoot ? relative : `images/${relative}`);
      }
    }
  }

  const missing = [];
  const remoteUnverified = [];
  const referenced = new Set();
  for (const record of records) {
    const value = (record.image_url || '').trim();
    if (!value) {
      continue;
    }
    if (/^https?:\/\//i.test(value)) {
      remoteUnverified.push({ id: record.id || '', url: value });
      continue;
    }
    let relative;
    try {
      relative = decodeURIComponent(new URL(value, 'https://local.invalid').pathname);
    } catch {
      missing.push({ id: record.id || '', url: value, reason: '無法解析路徑' });
      continue;
    }
    const normalized = normalizeImagePath(relative);
    if (imagePaths.has(normalized)) {
      referenced.add(normalized);
    } else {
      missing.push({ id: record.id || '', url: value, reason: '本機圖片目錄找不到檔案' });
    }
  }

  const orphanFiles = [...imagePaths]
    .filter((imagePath) => !referenced.has(imagePath))
    .sort();
  return {
    inventory: [...imagePaths].sort(),
    missing,
    orphanFiles,
    remoteUnverified,
  };
}

function readDockerImageReferences(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    return [];
  }
  return fs.readFileSync(manifestPath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => /^AVAILABLE\s+/i.test(line))
    .map((line) => line.replace(/^AVAILABLE\s+/i, '').trim());
}

function run(options = {}) {
  const root = options.root || PROJECT_ROOT;
  const archivePath = options.archivePath || DEFAULT_ARCHIVE;
  const dockerManifestPath = options.dockerManifestPath || DEFAULT_DOCKER_MANIFEST;
  const catalog = readCatalog(root);
  const { inventory, missing, orphanFiles, remoteUnverified } =
    readProductImages(root, catalog.records);
  let archiveBytes = null;
  if (fs.existsSync(archivePath)) {
    archiveBytes = fs.statSync(archivePath).size;
  }
  const dockerImageReferences = readDockerImageReferences(dockerManifestPath);
  const catalogLabel = catalog.isExample
    ? 'CSV 真檔不存在；商品 URL 只來自合成範例，不能代表真實缺圖率。'
    : 'CSV 以唯讀方式檢查；沒有解包、修改或重建 archive。';

  const report = `# F 商品圖片對帳報告

${catalogLabel}

## 商品圖檔結果

- CSV 來源：\`${path.relative(root, catalog.path)}\`
- 本機候選圖片目錄：\`public/images\`、\`public/assets/images\`、\`app/images\`
- 候選本機圖片檔：${inventory.length}
- CSV 本機圖片 URL 找不到檔案：${missing.length}
- CSV 遠端 HTTP(S) URL（未發出網絡請求）：${remoteUnverified.length}
- 未被 CSV 本機路徑引用的候選圖片（可能是 UI 圖示，非必然孤兒商品圖）：${orphanFiles.length}

${markdownTable(['商品 ID', 'image_url', '結果'], missing.map((entry) => [
    entry.id,
    entry.url,
    entry.reason,
  ]))}

## 遠端 URL（未驗證）

${markdownTable(['商品 ID', 'URL'], remoteUnverified.map((entry) => [entry.id, entry.url]))}

## 未被 CSV 引用的本機候選圖片（可能包含 UI 資產）

${markdownTable(['本機相對路徑'], orphanFiles.map((file) => [file]))}

## Docker archive 說明

- Archive：\`${archivePath}\`
- Archive 大小：${archiveBytes === null ? '找不到' : `${archiveBytes} bytes`}
- 預期純 PJ1 SHA256：\`${DEFAULT_EXPECTED_SHA256}\`
- Docker manifest 路徑：\`${dockerManifestPath}\`
- Manifest 中的 Docker image references：${dockerImageReferences.length}
- Docker image references 是容器映像名稱，不是商品圖片檔清單；\`images.tar\` 是 Docker image archive，不能用來判定商品 \`image_url\` 是否存在。
- handover \`MANIFEST.txt\` 是檔案交接清單，非目前 tar 內的商品圖清單；本報告不把其歷史路徑誤判為目前可用圖片。
`;

  writeReport(root, 'F_IMAGE_RECONCILE_REPORT.md', report);
  return {
    localImageCount: inventory.length,
    missingImageCount: missing.length,
    remoteUnverifiedCount: remoteUnverified.length,
    orphanImageCount: orphanFiles.length,
    archiveBytes,
    dockerImageReferenceCount: dockerImageReferences.length,
    isExample: catalog.isExample,
  };
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(run(), null, 2));
  } catch (error) {
    console.error(`Image reconciliation failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  listImageFiles,
  normalizeImagePath,
  readProductImages,
  run,
};
