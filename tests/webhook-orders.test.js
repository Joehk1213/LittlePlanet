'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const createWebhookRouter = require('../routes/webhook');

const APP_SECRET = 'whatsapp-order-webhook-test-secret-0123456789';
const PHONE = '85291234567';
const INTENT_TOKEN = 'f6d946f1-6712-4ea2-9a75-a1ca24a60001';

function createStore() {
  const store = {
    products: [
      {
        id: 101,
        product_code: 'A',
        product_name: '星球餅乾',
        price: 20,
        stock: 8,
        status: '預購中',
        is_active: true,
        tier_prices: [],
        preorder_deadline: null
      },
      {
        id: 102,
        product_code: 'B款',
        product_name: '月亮公仔',
        price: 30,
        stock: 6,
        status: '預購中',
        is_active: true,
        tier_prices: [],
        preorder_deadline: null
      }
    ],
    intents: new Map(),
    confirmationMessages: new Map(),
    orders: [],
    rpcCalls: [],
    replies: []
  };

  store.supabase = {
    async rpc(name, args = {}) {
      store.rpcCalls.push({ name, args });

      if (name === 'list_whatsapp_order_catalog') {
        return { data: store.products.map(product => ({ ...product })), error: null };
      }

      if (name === 'create_whatsapp_order_intent') {
        const previous = store.intents.get(args.p_source_message_id);
        if (previous) {
          if (previous.customer_phone !== args.p_customer_phone) {
            return {
              data: {
                success: false,
                data: null,
                message: '訊息 ID 已被其他客戶使用。',
                code: 'MESSAGE_ID_CONFLICT'
              },
              error: null
            };
          }
          return {
            data: {
              success: true,
              data: { ...previous, duplicate: true },
              message: '此 WhatsApp 訊息已處理。'
            },
            error: null
          };
        }

        const items = [];
        let total = 0;
        for (const requested of args.p_items) {
          const product = store.products.find(item => String(item.id) === requested.product_id);
          if (!product || product.product_code !== requested.product_code) {
            return {
              data: {
                success: false,
                data: null,
                message: '商品已下架、截單或資料已變更，請重新提交。',
                code: 'PRODUCT_UNAVAILABLE'
              },
              error: null
            };
          }
          if (product.stock < requested.quantity) {
            return {
              data: {
                success: false,
                data: null,
                message: '商品庫存不足，請調整數量後再試。',
                code: 'STOCK_UNAVAILABLE'
              },
              error: null
            };
          }
          const subtotal = product.price * requested.quantity;
          total += subtotal;
          items.push({
            product_id: requested.product_id,
            product_code: product.product_code,
            product_name: product.product_name,
            quantity: requested.quantity,
            unit_price: product.price,
            subtotal
          });
        }

        const intent = {
          duplicate: false,
          status: 'pending',
          intent_token: INTENT_TOKEN,
          items,
          total_amount: total,
          expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          customer_phone: args.p_customer_phone
        };
        store.intents.set(args.p_source_message_id, intent);
        return {
          data: {
            success: true,
            data: { ...intent },
            message: '訂單預覽已建立，等待客戶確認。'
          },
          error: null
        };
      }

      if (name === 'confirm_whatsapp_order_intent') {
        const prior = store.confirmationMessages.get(args.p_confirmation_message_id);
        if (prior) {
          return {
            data: {
              success: true,
              data: { ...prior, duplicate: true },
              message: '此確認訊息已處理。'
            },
            error: null
          };
        }

        const intent = [...store.intents.values()].find(item => (
          item.intent_token === args.p_intent_token &&
          item.customer_phone === args.p_customer_phone
        ));
        if (!intent || intent.status !== 'pending') {
          return {
            data: {
              success: false,
              data: null,
              message: '找不到此電話號碼對應的待確認訂單。',
              code: 'INTENT_NOT_FOUND'
            },
            error: null
          };
        }

        const order = {
          order_number: 'LP-20261023-ABCDEF12',
          payment_status: '未付款',
          total_amount: intent.total_amount
        };
        for (const item of intent.items) {
          const product = store.products.find(candidate => (
            String(candidate.id) === item.product_id
          ));
          product.stock -= item.quantity;
        }
        store.orders.push(order);
        intent.status = 'confirmed';
        intent.order_number = order.order_number;
        const confirmed = {
          duplicate: false,
          status: 'confirmed',
          order_number: order.order_number,
          total_amount: order.total_amount
        };
        store.confirmationMessages.set(args.p_confirmation_message_id, confirmed);
        return {
          data: {
            success: true,
            data: confirmed,
            message: '訂單已建立，付款狀態為未付款。'
          },
          error: null
        };
      }

      throw new Error(`Unexpected RPC: ${name}`);
    }
  };
  return store;
}

async function withWebhookServer(store, run) {
  const app = express();
  app.use(express.json({
    verify(req, res, buffer) {
      req.rawBody = Buffer.from(buffer);
    }
  }));
  app.use('/api/webhook', createWebhookRouter(store.supabase, {
    appSecret: APP_SECRET,
    verifyToken: 'v'.repeat(40),
    writeEnabled: true,
    sendWhatsApp: async message => store.replies.push(message)
  }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
}

function createPayload(messageId, text, phone = PHONE) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        value: {
          messages: [{
            id: messageId,
            from: phone,
            type: 'text',
            text: { body: text }
          }]
        }
      }]
    }]
  };
}

function sign(body) {
  return `sha256=${crypto.createHmac('sha256', APP_SECRET).update(body).digest('hex')}`;
}

async function sendWebhook(baseUrl, payload) {
  const body = JSON.stringify(payload);
  const response = await fetch(`${baseUrl}/api/webhook/whatsapp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': sign(body)
    },
    body
  });
  return { status: response.status, body: await response.json() };
}

test('有效落單內容只建立待確認意圖，不會即時扣庫存或建立訂單', async () => {
  const store = createStore();
  await withWebhookServer(store, async baseUrl => {
    const response = await sendWebhook(
      baseUrl,
      createPayload('wamid.order-preview-1', 'A x 1, B款 x 2')
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.results[0].action, 'order_intent');
    assert.equal(response.body.data.results[0].success, true);
    assert.equal(store.intents.size, 1);
    assert.equal(store.orders.length, 0);
    assert.equal(store.products[0].stock, 8);
    assert.equal(store.products[1].stock, 6);
    assert.match(store.replies[0].text, /星球餅乾/);
    assert.match(store.replies[0].text, /合計：HK\$80\.00/);
    assert.match(store.replies[0].text, /確認 f6d946f1-6712-4ea2-9a75-a1ca24a60001/);
  });
});

test('未知商品不建立待確認意圖或訂單並回覆錯誤提示', async () => {
  const store = createStore();
  await withWebhookServer(store, async baseUrl => {
    const response = await sendWebhook(
      baseUrl,
      createPayload('wamid.order-unknown-1', 'UNKNOWN x 1')
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.results[0].success, false);
    assert.equal(response.body.data.results[0].reason, 'PRODUCT_NOT_FOUND');
    assert.equal(store.intents.size, 0);
    assert.equal(store.orders.length, 0);
    assert.match(store.replies[0].text, /找不到商品代號/);
    assert.equal(store.rpcCalls.some(call => call.name === 'create_whatsapp_order_intent'), false);
  });
});

test('相同來源訊息重送只建立一個意圖，並重用相同確認碼', async () => {
  const store = createStore();
  const payload = createPayload('wamid.order-duplicate-1', 'A x 1');
  await withWebhookServer(store, async baseUrl => {
    const first = await sendWebhook(baseUrl, payload);
    const retry = await sendWebhook(baseUrl, payload);

    assert.equal(first.status, 200);
    assert.equal(retry.status, 200);
    assert.equal(store.intents.size, 1);
    assert.equal(store.orders.length, 0);
    assert.equal(store.replies.length, 2);
    assert.equal(store.replies[0].text, store.replies[1].text);
    assert.equal(
      store.rpcCalls.filter(call => call.name === 'create_whatsapp_order_intent').length,
      2
    );
  });
});

test('確認待確認意圖後才建立未付款訂單，重送確認不會重複建單', async () => {
  const store = createStore();
  await withWebhookServer(store, async baseUrl => {
    const preview = await sendWebhook(
      baseUrl,
      createPayload('wamid.order-preview-2', 'A x 2')
    );
    const confirmPayload = createPayload(
      'wamid.order-confirm-1',
      `確認 ${INTENT_TOKEN}`
    );
    const confirmed = await sendWebhook(baseUrl, confirmPayload);
    const retry = await sendWebhook(baseUrl, confirmPayload);

    assert.equal(preview.status, 200);
    assert.equal(confirmed.status, 200);
    assert.equal(retry.status, 200);
    assert.equal(store.orders.length, 1);
    assert.equal(store.orders[0].payment_status, '未付款');
    assert.equal(store.products[0].stock, 6);
    assert.equal(store.intents.get('wamid.order-preview-2').status, 'confirmed');
    assert.match(store.replies.at(-1).text, /LP-20261023-ABCDEF12/);
    assert.match(store.replies.at(-1).text, /出貨前需付清/);
    assert.equal(
      store.rpcCalls.filter(call => call.name === 'confirm_whatsapp_order_intent').length,
      2
    );
  });
});
