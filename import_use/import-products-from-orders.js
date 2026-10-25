const { createClient } = require('@supabase/supabase-js');
const xlsx = require('xlsx');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function importProducts() {
  console.log('正在從 Excel 提取商品清單...');
  const workbook = xlsx.readFile('LittlePlanet.xlsx');
  const rawData = xlsx.utils.sheet_to_json(workbook.Sheets['訂單內容']);

  // 過濾出所有不重複的商品名稱與價格
  const productMap = new Map();
  rawData.forEach(row => {
    const name = row['商品名稱'];
    const price = row[' 單價'] || 0;
    if (name && !productMap.has(name)) {
      productMap.set(name, {
        name: name,
        price: Number(price) > 0 ? Number(price) : 0,
        stock: 99, // 預設庫存
        category: '精選現貨'
      });
    }
  });

  const uniqueProducts = Array.from(productMap.values());
  console.log(`找到 ${uniqueProducts.length} 款獨特商品，準備寫入 Supabase...`);

  let success = 0;
  let fail = 0;

  for (const prod of uniqueProducts) {
    const { error } = await supabase.from('products').insert([{
      name: prod.name,
      price: prod.price,
      stock: prod.stock,
      category: prod.category,
      description: '由歷史訂單自動匯入之現貨商品'
    }]);

    if (error) {
      fail++;
    } else {
      success++;
    }
  }

  console.log(`商品匯入完成！成功: ${success} 筆，失敗: ${fail} 筆`);
}

importProducts();