'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const createWebhookRouter = require('../routes/webhook');

const APP_SECRET = 'whatsapp-payment-proof-test-secret-0123456789';
const ORDER_ID = 'e1da0bac-9021-4e87-920b-2f5bf5381f32';
const ORDER_NUMBER = 'LP-20261023-0003';
const PHONE = '85291234567';
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

function createStore(options = {}) {
  const store = {
    orders: [{
      order_id: ORDER_ID,
      order_number: ORDER_NUMBER,
      customer_phone: PHONE,
      payment_status: '未付款',
      payment_proof_status: 'pending',
      payment_proof_url: null
    }],
    receipts: new Map(),
    storageCalls: [],
    rpcCalls: [],
    replies: [],
    images: []
  };

  store.supabase = {
    async rpc(name, args) {
      store.rpcCalls.push({ name, args });
      if (name === 'claim_whatsapp_payment_proof') {
        if (
          args.p_customer_phone !== PHONE ||
          args.p_order_number !== ORDER_NUMBER
        ) {
          return {
            data: {
              success: false,
              data: null,
              message: '找不到符合此電話及訂單編號的訂單。',
              code: 'ORDER_NOT_FOUND'
            },
            error: null
          };
        }
        const previous = store.receipts.get(args.p_message_id);
        if (previous) {
          return {
            data: {
              success: true,
              data: {
                order_id: ORDER_ID,
                order_number: ORDER_NUMBER,
                duplicate: true
              },
              message: '此 WhatsApp 訊息已處理。'
            },
            error: null
          };
        }
        store.receipts.set(args.p_message_id, {
          order_id: ORDER_ID,
          order_number: ORDER_NUMBER,
          status: 'processing'
        });
        return {
          data: {
            success: true,
            data: {
              order_id: ORDER_ID,
              order_number: ORDER_NUMBER,
              duplicate: false
            },
            message: '付款憑證訂單已驗證。'
          },
          error: null
        };
      }
      if (name === 'complete_whatsapp_payment_proof') {
        const receipt = store.receipts.get(args.p_message_id);
        if (options.completeError) {
          return { data: null, error: options.completeError };
        }
        receipt.status = 'pending_review';
        store.orders[0].payment_proof_url = args.p_object_path;
        store.orders[0].payment_proof_status = 'pending';
        return {
          data: {
            success: true,
            data: {
              order_number: ORDER_NUMBER,
              old_proof_path: null,
              payment_proof_status: 'pending'
            },
            message: '付款憑證已儲存並等待管理員審核。'
          },
          error: null
        };
      }
      if (name === 'fail_whatsapp_payment_proof') {
        const receipt = store.receipts.get(args.p_message_id);
        if (receipt) receipt.status = 'failed';
        return {
          data: { success: true, data: null, message: '處理失敗已記錄。' },
          error: null
        };
      }
      if (name === 'set_whatsapp_payment_proof_notification') {
        const receipt = store.receipts.get(args.p_message_id);
        if (!receipt || receipt.status !== 'pending_review') {
          return {
            data: { success: false, data: null, message: '記錄不存在。' },
            error: null
          };
        }
        receipt.notification_status = args.p_status;
        receipt.notification_error = args.p_error;
        return {
          data: { success: true, data: { status: args.p_status }, message: '已更新。' },
          error: null
        };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, 'payment-proofs');
        return {
          async upload(path, media, fileOptions) {
            store.storageCalls.push({ method: 'upload', path, media, fileOptions });
            if (options.storageError) {
              return { data: null, error: options.storageError };
            }
            return { data: { path }, error: null };
          },
          async remove(paths) {
            store.storageCalls.push({ method: 'remove', paths });
            return { data: paths, error: null };
          }
        };
      }
    }
  };
  return store;
}

async function withServer(store, run, options = {}) {
  const app = express();
  app.use(express.json({
    verify(req, res, buffer) {
      req.rawBody = Buffer.from(buffer);
    }
  }));
  app.use('/api/webhook', createWebhookRouter(store.supabase, {
    appSecret: APP_SECRET,
    writeEnabled: true,
    receiptRecipients: ['85290000001'],
    sendWhatsApp: async message => store.replies.push(message),
    downloadWhatsAppMedia: async () => ({
      media: options.media || PNG,
      mimeType: options.mimeType || 'image/png'
    }),
    sendWhatsAppImage: async message => {
      store.images.push(message);
      if (options.forwardError) throw new Error('simulated internal notification failure');
      return 'wamid.receipt';
    }
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

function createPayload(messageId, caption = `付款 ${ORDER_NUMBER}`, phone = PHONE) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        value: {
          messages: [{
            id: messageId,
            from: phone,
            type: 'image',
            image: { id: 'media-123', caption }
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

test('WhatsApp image receipts require order-number caption and matching sender phone', async () => {
  const store = createStore();
  await withServer(store, async baseUrl => {
    const missingNumber = await sendWebhook(baseUrl, createPayload('wamid.no-order', '收據'));
    assert.equal(missingNumber.status, 200);
    assert.equal(missingNumber.body.data.results[0].reason, 'order_number_required');

    const mismatchedPhone = await sendWebhook(
      baseUrl,
      createPayload('wamid.wrong-phone', `付款 ${ORDER_NUMBER}`, '85290000000')
    );
    assert.equal(mismatchedPhone.status, 200);
    assert.equal(mismatchedPhone.body.data.results[0].success, false);
    assert.equal(store.storageCalls.length, 0);
    assert.equal(store.orders[0].payment_proof_url, null);
    assert.equal(store.orders[0].payment_status, '未付款');
  });
});

test('valid receipt is stored privately, forwarded internally and deduplicated without marking payment paid', async () => {
  const store = createStore();
  await withServer(store, async baseUrl => {
    const payload = createPayload('wamid.valid');
    const response = await sendWebhook(baseUrl, payload);
    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.results[0].success, true);
    assert.equal(response.body.data.results[0].notification_status, 'sent');
    assert.equal(store.orders[0].payment_proof_status, 'pending');
    assert.equal(store.orders[0].payment_status, '未付款');
    assert.match(store.orders[0].payment_proof_url, new RegExp(`^${ORDER_ID}/[0-9a-f-]+\\.png$`));
    assert.equal(store.storageCalls[0].method, 'upload');
    assert.equal(store.images.length, 1);
    assert.equal(store.images[0].to, '85290000001');
    assert.equal(store.images[0].caption, `付款憑證待審核｜${ORDER_NUMBER}｜客戶 ${PHONE}`);

    const duplicate = await sendWebhook(baseUrl, payload);
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.body.data.results[0].duplicate, true);
    assert.equal(store.storageCalls.length, 1);
    assert.equal(store.images.length, 1);
  });
});

test('invalid image bytes are rejected and failed processing remains retryable', async () => {
  const store = createStore();
  await withServer(store, async baseUrl => {
    const response = await sendWebhook(baseUrl, createPayload('wamid.bad-image'));
    assert.equal(response.status, 500);
    assert.equal(response.body.success, false);
    assert.equal(store.storageCalls.length, 0);
    assert.equal(store.receipts.get('wamid.bad-image').status, 'failed');
    assert.equal(store.orders[0].payment_proof_url, null);
    assert.equal(store.orders[0].payment_status, '未付款');
  }, { media: Buffer.from('not an image'), mimeType: 'image/png' });
});

test('receipt forwarding failure is recorded while the private proof remains pending review', async () => {
  const store = createStore();
  await withServer(store, async baseUrl => {
    const response = await sendWebhook(baseUrl, createPayload('wamid.forward-failure'));
    assert.equal(response.status, 200);
    assert.equal(response.body.data.results[0].success, true);
    assert.equal(response.body.data.results[0].notification_status, 'failed');
    assert.equal(store.receipts.get('wamid.forward-failure').notification_status, 'failed');
    assert.equal(store.orders[0].payment_proof_status, 'pending');
    assert.equal(store.orders[0].payment_status, '未付款');
    assert.match(store.replies.at(-1).text, /內部自動通知未完成/);
  }, { forwardError: true });
});
