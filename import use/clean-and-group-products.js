const { createClient } = require('@supabase/supabase-js');
const xlsx = require('xlsx');
require('dotenv').config({ path: '../.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function cleanAndImportProducts() {
  console.log('正在進階清洗商品名稱與配對圖片...');
  const workbook = xlsx.readFile('../LittlePlanet.xlsx');
  const rawData = xlsx.utils.sheet_to_json(workbook.Sheets['訂單內容']);

  const productMap = new Map();

  rawData.forEach(row => {
    let rawName = row['商品名稱'];
    const price = row[' 單價'] || 0;
    if (!rawName) return;

    // 1. 強力清洗團號、年份、日期括號與款式標籤
    let cleanName = rawName
      // 濾除各種括號內的團號或活動 (如: (9月_26團), 【Costco3月_2026】, （Cosme Week 2026）)
      .replace(/[\(（【\[].*?(團\vert{}Costco\vert{}Cosme\vert{}月\vert{}批次\vert{}預訂).*?[\)）】\]]/gi, '')
      // 濾除款式代碼 (如 : C1【...】, : B8【...】, : A4)
      .replace(/[:：]\s*[A-Z0-9]+\s*【[^】]*】/gi, '')
      .replace(/[:：]\s*[A-Z0-9]+\s*.*/gi, '')
      .replace(/^\s*[\-\_\:\：]\s*/, '')
      .trim();

    if (cleanName.length < 2) cleanName = rawName.trim();

    // 2. 更精準的商品分類與圖片自動配對
    let category = '精選現貨';
    let imageUrl = 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600'; // 預設

    const nameLower = cleanName.toLowerCase();

    if (cleanName.includes('咖啡') || cleanName.includes('奶茶') || cleanName.includes('茶')) {
      category = '飲品特選';
      imageUrl = 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=600';
    } else if (cleanName.includes('韓國') || cleanName.includes('面膜') || cleanName.includes('精華') || cleanName.includes('霜') || cleanName.includes('美容液')) {
      category = '韓流美妝';
      imageUrl = 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=600';
    } else if (cleanName.includes('零食') || cleanName.includes('蝦餅') || cleanName.includes('小雞麵') || cleanName.includes('朱古力') || cleanName.includes('巧克')) {
      category = '美味零食';
      imageUrl = 'https://images.unsplash.com/photo-1582293041079-7814c2f12063?w=600';
    } else if (cleanName.includes('牙刷') || cleanName.includes('地墊') || cleanName.includes('除臭') || cleanName.includes('毛巾') || cleanName.includes('浴巾') || cleanName.includes('膠布')) {
      category = '家居生活';
      imageUrl = 'https://images.unsplash.com/photo-1583947215259-38e31be8751f?w=600';
    } else if (cleanName.includes('寵物') || cleanName.includes('犬') || cleanName.includes('貓')) {
      category = '寵物用品';
      imageUrl = 'https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?w=600';
    }

    if (!productMap.has(cleanName)) {
      productMap.set(cleanName, {
        name: cleanName,
        price: Number(price) > 0 ? Number(price) : 50,
        stock: 99,
        category: category,
        image_url: imageUrl,
        description: `LittlePlanet 精選好物：${cleanName}`
      });
    }
  });

  const uniqueProducts = Array.from(productMap.values());
  console.log(`進階清洗完畢！共得出 ${uniqueProducts.length} 款乾淨商品，準備寫入 Supabase...`);

  // 清空舊 products 資料表並重新匯入
  await supabase.from('products').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  let success = 0;
  for (const prod of uniqueProducts) {
    const { error } = await supabase.from('products').insert([prod]);
    if (!error) success++;
  }

  console.log(`重新上架完成！成功寫入 ${success} 筆乾淨商品。`);
}

cleanAndImportProducts();