const { createClient } = require('@supabase/supabase-js');
const xlsx = require('xlsx');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('請先在 .env 檔案中設定 SUPABASE_URL 及 SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function importExcelData() {
  console.log('正在讀取 Excel 檔案 (LittlePlanet.xlsx)...');
  const workbook = xlsx.readFile('LittlePlanet.xlsx');
  const sheetName = '訂單內容';
  const rawData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

  console.log(`成功讀取 ${rawData.length} 筆資料，準備匯入 Supabase...`);

  let successCount = 0;
  let errorCount = 0;

  for (const row of rawData) {
    try {
      const year = row['年'] ? (row['年'] < 100 ? 2000 + row['年'] : row['年']) : 2026;
      const month = row['月'] || 1;
      const day = row['日'] || 1;
      const orderDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00Z`;

      const customerName = row['姓名'];
      if (!customerName || !row['商品名稱']) continue; // 跳過空行

      const totalPrice = row['總數'] || (row[' 單價'] * row['數量']) || 0;
      const shippingStatus = row['出貨'] || '處理中';

      const orderPayload = {
        customer_id: null,
        total_amount: totalPrice,
        status: shippingStatus === '已出貨' ? 'completed' : 'pending',
        order_date: orderDate,
      };

      const { error: orderError } = await supabase
        .from('orders')
        .insert([orderPayload]);

      if (orderError) {
        console.error('插入訂單失敗:', orderError.message);
        errorCount++;
        continue;
      }

      successCount++;
    } catch (err) {
      console.error('處理資料發生錯誤:', err.message);
      errorCount++;
    }
  }

  console.log(`匯入完成！成功: ${successCount} 筆，失敗: ${errorCount} 筆`);
}

importExcelData();