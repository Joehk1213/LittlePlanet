require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('錯誤：請先在 .env 檔案中設定 SUPABASE_URL 及 SUPABASE_SERVICE_ROLE_KEY。');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function backupDatabase() {
    console.log('🔄 開始備份 LittlePlanet 資料庫...');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(__dirname, 'backups');

    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }

    const tables = ['products', 'orders', 'order_items', 'whatsapp_payment_reports'];
    const backupData = {};

    try {
        for (const table of tables) {
            const { data, error } = await supabase.from(table).select('*');
            if (error) {
                console.warn(`⚠️ 警告：讀取資料表 ${table} 失敗（可能尚未建立）: ${error.message}`);
                backupData[table] = [];
            } else {
                backupData[table] = data;
                console.log(`✅ 已備份資料表 [${table}] 共 ${data.length} 筆資料`);
            }
        }

        const backupFilePath = path.join(backupDir, `backup-${timestamp}.json`);
        fs.writeFileSync(backupFilePath, JSON.stringify(backupData, null, 2), 'utf8');
        console.log(`🎉 備份成功完成！檔案已儲存至：\n   ${backupFilePath}`);
    } catch (err) {
        console.error('❌ 備份過程發生錯誤:', err.message);
    }
}

backupDatabase();