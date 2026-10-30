'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  PROJECT_ROOT,
  getHongKongDate,
  markdownTable,
  readCatalog,
  writeReport,
} = require('./f-catalog-utils');

const DEFAULT_ARCHIVE_PATH = 'C:\\docker-data\\littleplanet-handover\\images.tar';
const SEALED_ARCHIVE_BYTES = 894679040;
const SEALED_ARCHIVE_SHA256 =
  '3D91F03B5292A82F77D4338316D6E446D767356E6FE33CC37236D651C96CAC41';
const IMAGE_EXTENSIONS = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp']);
const DOCKER_IMAGE_TAGS = [
  'littleplanet-app',
  'postgres:17.6.1.136',
  'gotrue:2.197.0',
  'realtime:2.143.3',
  'storage-api:1.81.0',
  'postgrest:14.18',
  'caddy:2.10.2',
];

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

function resolveLocalImage(value, imagesRoot) {
  let relative = value.trim().replace(/\\/g, '/');
  if (relative.startsWith('/images/')) {
    relative = relative.slice('/images/'.length);
  } else if (relative.startsWith('images/')) {
    relative = relative.slice('images/'.length);
  } else if (relative.startsWith('/')) {
    return null;
  }

  try {
    relative = decodeURIComponent(relative);
  } catch {
    return null;
  }
  const root = path.resolve(imagesRoot);
  const candidate = path.resolve(root, relative);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    return null;
  }
  return candidate;
}

function reconcileProductImages(root, records) {
  const imagesRoot = path.join(root, 'public', 'images');
  const inventory = listImageFiles(imagesRoot);
  const referenced = new Set();
  const remoteUnverified = [];
  const missingLocal = [];
  const malformedLocal = [];
  const emptyImageCount = records.filter((record) => !(record.image_url || '').trim()).length;

  for (const record of records) {
    const imageUrl = (record.image_url || '').trim();
    if (!imageUrl) {
      continue;
    }
    if (/^https?:\/\//i.test(imageUrl)) {
      remoteUnverified.push(record.id || '');
      continue;
    }
    const localPath = resolveLocalImage(imageUrl, imagesRoot);
    if (!localPath) {
      malformedLocal.push({ id: record.id || '', path: imageUrl });
    } else if (!fs.existsSync(localPath) || !fs.statSync(localPath).isFile()) {
      missingLocal.push({ id: record.id || '', path: imageUrl });
    } else {
      referenced.add(localPath);
    }
  }

  const unreferencedLocal = inventory
    .filter((file) => !referenced.has(path.resolve(file)))
    .map((file) => path.relative(imagesRoot, file).replace(/\\/g, '/'))
    .sort();
  const assetsImagesRoot = path.join(root, 'public', 'assets', 'images');
  return {
    imagesDirectoryExists: fs.existsSync(imagesRoot),
    localImageCount: inventory.length,
    remoteUnverified,
    missingLocal,
    malformedLocal,
    emptyImageCount,
    unreferencedLocal,
    uiAssetImageCount: listImageFiles(assetsImagesRoot).length,
  };
}

async function summarizeArchive(archivePath = DEFAULT_ARCHIVE_PATH) {
  if (!fs.existsSync(archivePath)) {
    return { exists: false, path: archivePath, bytes: null, sha256: null, matchesSealed: false };
  }
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(archivePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  const bytes = fs.statSync(archivePath).size;
  const sha256 = hash.digest('hex').toUpperCase();
  return {
    exists: true,
    path: archivePath,
    bytes,
    sha256,
    matchesSealed: bytes === SEALED_ARCHIVE_BYTES && sha256 === SEALED_ARCHIVE_SHA256,
  };
}

function createReport(root, catalog, imageResults, archive) {
  const date = getHongKongDate();
  const csvLabel = catalog.missing
    ? `- 日期：${date}\n- CSV 結果：source/products.csv 不存在，商品圖片結果屬資料不足。`
    : `- 日期：${date}\n- CSV 結果：以唯讀方式檢查；沒有發出網絡請求或修改圖片。`;
  const archiveLabel = !archive.exists
    ? 'C: handover images.tar 不存在，未能核對封存檔。'
    : archive.matchesSealed
      ? `封存檔核對通過：${archive.bytes} bytes，SHA-256 ${archive.sha256}。`
      : `封存檔與 sealed 值不符：${archive.bytes} bytes，SHA-256 ${archive.sha256}。`;
  const productTags = DOCKER_IMAGE_TAGS.map((tag) => `- \`${tag}\``).join('\n');
  return `# F2 商品圖片對帳報告\n\n${csvLabel}\n\n## 商品圖片\n\n- CSV 商品列：${catalog.records.length}\n- \`public/images\` 目錄存在：${imageResults.imagesDirectoryExists ? '是' : '否'}\n- \`public/images\` 本機圖片數：${imageResults.localImageCount}\n- CSV 遠端 HTTP(S) 圖片 URL（未請求、未驗證）：${imageResults.remoteUnverified.length}\n- CSV 指向但本機找不到的圖片：${imageResults.missingLocal.length}\n- 無效／不安全的本機圖片路徑：${imageResults.malformedLocal.length}\n- 空白圖片欄：${imageResults.emptyImageCount}\n- 未被本機 CSV 路徑引用的圖片：${imageResults.unreferencedLocal.length}\n- \`public/assets/images\` 中 UI/PWA 候選圖片：${imageResults.uiAssetImageCount}（不當作商品圖片）\n\n${markdownTable(['商品 ID', '本機 image_url', '結果'], imageResults.missingLocal.map((entry) => [
    entry.id,
    entry.path,
    '本機 public/images 找不到檔案',
  ]))}\n\n${markdownTable(['商品 ID', '無效 image_url'], imageResults.malformedLocal.map((entry) => [
    entry.id,
    entry.path,
  ]))}\n\n## Docker archive（不是商品圖片）\n\n- ${archiveLabel}\n- 路徑：\`${archive.path}\`\n- handover 列出的 7 個 PJ1 Docker image tags：\n${productTags}\n- \`images.tar\` 是 Docker container image archive，以上 image tags 不是商品圖片；不得以 Docker archive 判定 CSV 的 \`image_url\` 缺圖。\n- 遠端 Supabase Storage URL 未作 HTTP 請求，因此本報告只標記為未驗證，不宣稱圖片缺失或可用。\n`;
}

async function run(options = {}) {
  const root = options.root || PROJECT_ROOT;
  const catalog = readCatalog(root);
  const imageResults = reconcileProductImages(root, catalog.records);
  const archive = options.archive || await summarizeArchive(options.archivePath || DEFAULT_ARCHIVE_PATH);
  const report = createReport(root, catalog, imageResults, archive);
  const reportPath = writeReport(root, 'F_IMAGE_RECONCILE_REPORT_DT.md', report);
  return { ...imageResults, archive, reportPath, isExample: false };
}

if (require.main === module) {
  run()
    .then((result) => {
      const { reportPath, ...summary } = result;
      console.log(JSON.stringify({ ...summary, reportPath }, null, 2));
    })
    .catch(() => {
      console.error('Image reconciliation failed; details omitted.');
      process.exitCode = 1;
    });
}

module.exports = {
  DEFAULT_ARCHIVE_PATH,
  DOCKER_IMAGE_TAGS,
  SEALED_ARCHIVE_BYTES,
  SEALED_ARCHIVE_SHA256,
  createReport,
  reconcileProductImages,
  resolveLocalImage,
  run,
  summarizeArchive,
};
