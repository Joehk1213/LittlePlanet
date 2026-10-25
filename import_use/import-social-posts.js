const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// 初始化 Supabase Client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ 錯誤：找不到 Supabase 設定，請檢查 .env 檔案中的 SUPABASE_URL 與 KEY。');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// 設定檔案與路徑
const TXT_FILE_PATH = path.join(__dirname, 'my_posts.txt');
const IMAGE_DIR_PATH = path.join(__dirname, 'image');
const BUCKET_NAME = 'products'; // Supabase Storage Bucket 名稱

// 尋找對應編號的相片（自動匹配 .jfif, .jpg, .jpeg, .png, .webp）
function findImageFile(index) {
  if (!fs.existsSync(IMAGE_DIR_PATH)) return null;
  const files = fs.readdirSync(IMAGE_DIR_PATH);
  const extensions = ['.jfif', '.jpg', '.jpeg', '.png', '.webp'];

  for (const ext of extensions) {
    const targetName = `${index}${ext}`;
    const found = files.find(f => f.toLowerCase() === targetName.toLowerCase());
    if (found) {
      return path.join(IMAGE_DIR_PATH, found);
    }
  }
  return null;
}

// 將相片上傳至 Supabase Storage 並取得 Public URL
async function uploadImageToSupabase(filePath, index) {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    
    // 設定 Content-Type
    let contentType = 'image/jpeg';
    if (ext === '.png') contentType = 'image/png';
    if (ext === '.webp') contentType = 'image/webp';

    const fileName = `social_imports/${Date.now()}_${index}${ext}`;

    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(fileName, fileBuffer, {
        contentType,
        upsert: true,
      });

    if (error) {
      console.error(`⚠️ 相片 ${index} 上傳失敗:`, error.message);
      return null;
    }

    const { data: urlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(fileName);

    return urlData.publicUrl;
  } catch (err) {
    console.error(`⚠️ 讀取或上傳圖片 ${index} 發生異常:`, err.message);
    return null;
  }
}

// 解析文案中的價格 (從 💰198/包 中提取 198)
function parsePrice(text) {
  const match = text.match(/💰\s*(\d+(\.\d+)?)/);
  if (match) {
    return parseFloat(match[1]);
  }
  return 0;
}

async function runSync() {
  console.log('🚀 開始處理 my_posts.txt 與相片同步...\n');

  if (!fs.existsSync(TXT_FILE_PATH)) {
    console.error(`❌ 錯誤：找不到文案檔案 ${TXT_FILE_PATH}`);
    return;
  }

  const rawContent = fs.readFileSync(TXT_FILE_PATH, 'utf-8');
  
  // 以 === 區隔文案區塊
  const rawBlocks = rawContent.split(/^===\s*/m).filter(b => b.trim().length > 0);

  let successCount = 0;

  for (const block of rawBlocks) {
    const lines = block.trim().split('\n');
    if (lines.length === 0) continue;

    // 解析第幾號 Post（例如 ===1 中的 1）
    const headerLine = lines[0].trim();
    const postIndexMatch = headerLine.match(/^(\d+)/);
    
    let postIndex = null;
    let contentLines = [];

    if (postIndexMatch) {
      postIndex = postIndexMatch[1];
      contentLines = lines.slice(1);
    } else {
      contentLines = lines;
    }

    const rawDescription = contentLines.join('\n').trim();
    if (!rawDescription) continue;

    // 💡 自動在每一篇文案最頂部加上統一的截單與到貨公告
    const batchNotice = `📣📣小幫手去日本Costco📣📣\n✂️10月21截單 \n✈️11月中到貨\n\n`;
    const fullDescription = batchNotice + rawDescription;

    // 抓取標題（第一行非空行）
    const productName = contentLines.find(l => l.trim().length > 0) || '精選商品';
    const price = parsePrice(fullDescription);

    console.log(`--------------------------------------------------`);
    console.log(`📦 正在處理商品 #${postIndex || '未知'}: ${productName}`);
    console.log(`💰 提取售價: HK$${price}`);

    // 尋找並上傳圖片
    let imageUrl = null;
    if (postIndex) {
      const localImagePath = findImageFile(postIndex);
      if (localImagePath) {
        console.log(`📸 找到本機相片: ${path.basename(localImagePath)}`);
        imageUrl = await uploadImageToSupabase(localImagePath, postIndex);
        if (imageUrl) console.log(`☁️ 已上傳至雲端: ${imageUrl}`);
      } else {
        console.log(`⚠️ 提示：在 image/ 資料夾找不到對應編號 ${postIndex} 的相片`);
      }
    }

    // 準備寫入 Supabase 資料庫
const productPayload = {
  name: productName.trim(),
  description: fullDescription,
  price: price,
  image_url: imageUrl,
  stock: 99,         // 保持有庫存，避免變「暫無庫存」
  status: 'preorder' // 標記為預購
};

    const { data, error } = await supabase
      .from('products')
      .insert([productPayload]);

    if (error) {
      console.error(`❌ 寫入資料庫失敗 (${productName}):`, error.message);
    } else {
      console.log(`✅ 成功寫入網店資料庫！`);
      successCount++;
    }
  }

  console.log(`\n🎉 同步完成！共成功上架 ${successCount} 款商品至 Supabase。`);
}

runSync();