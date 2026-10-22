const { createClient } = require('@supabase/supabase-js');

// 請換成你自己的 Supabase 網址與 Anon Key
const supabaseUrl = 'YOUR_SUPABASE_URL';
const supabaseKey = 'YOUR_SUPABASE_ANON_KEY';
const supabase = createClient(supabaseUrl, supabaseKey);

async function insertTestData() {
  console.log('正在插入測試商品...');
  
  // 插入範例商品
  const { data: productData, error: productError } = await supabase
    .from('products')
    .insert([
      { name: 'LittlePlanet 環保水樽', price: 150, stock: 50 },
      { name: 'LittlePlanet 多功能收納袋', price: 120, stock: 30 }
    ])
    .select();

  if (productError) {
    console.error('插入商品失敗:', productError);
    return;
  }
  console.log('商品插入成功:', productData);

  console.log('正在插入測試訂單...');
  // 插入範例訂單
  const { data: orderData, error: orderError } = await supabase
    .from('orders')
    .insert([
      { customer_name: '測試買家', phone: '91234567', total_amount: 150, status: 'pending' }
    ])
    .select();

  if (orderError) {
    console.error('插入訂單失敗:', orderError);
    return;
  }
  console.log('訂單插入成功:', orderData);
  console.log('所有測試資料已成功注入！');
}

insertTestData();