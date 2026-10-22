const crypto = require('crypto');
const express = require('express');

const MISSING_RPC_CODES = new Set(['42883', 'PGRST202']);

function sendError(res, status, message) {
  return res.status(status).json({
    success: false,
    data: null,
    message
  });
}

function constantTimeStringEquals(expected, supplied) {
  if (
    typeof expected !== 'string' ||
    expected.length < 32 ||
    expected.startsWith('replace-with-') ||
    typeof supplied !== 'string'
  ) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
}

function normalizePhone(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const phone = value.trim().replace(/^\+/, '');
  return /^\d{8,15}$/.test(phone) ? phone : null;
}

function parseOrderId(value) {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  ) {
    return null;
  }
  return value.toLowerCase();
}

function getMessageText(message) {
  if (!message || message.type !== 'text' || !message.text) {
    return '';
  }

  return typeof message.text.body === 'string'
    ? message.text.body.trim()
    : '';
}

function createWebhookRouter(supabase, options = {}) {
  const router = express.Router();
  const verifyToken = options.verifyToken || '';
  const appSecret = options.appSecret || '';
  const sendWhatsApp = options.sendWhatsApp;
  const writeEnabled = options.writeEnabled === true;

  router.get('/whatsapp', (req, res) => {
    try {
      const mode = req.query['hub.mode'];
      const suppliedToken = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];

      if (
        mode !== 'subscribe' ||
        !constantTimeStringEquals(verifyToken, suppliedToken) ||
        typeof challenge !== 'string' ||
        challenge.length === 0 ||
        challenge.length > 256
      ) {
        return res.status(403).type('text/plain').send('Webhook verification failed.');
      }

      return res.status(200).type('text/plain').send(challenge);
    } catch (error) {
      console.error('驗證 WhatsApp webhook 時發生錯誤：', error);
      return res.status(500).type('text/plain').send('Webhook verification failed.');
    }
  });

  function hasValidSignature(req) {
    if (
      appSecret.length < 32 ||
      appSecret.startsWith('replace-with-') ||
      appSecret.startsWith('your-') ||
      !Buffer.isBuffer(req.rawBody) ||
      typeof req.get !== 'function'
    ) {
      return false;
    }

    const signature = req.get('x-hub-signature-256') || '';
    if (!/^sha256=[0-9a-f]{64}$/i.test(signature)) {
      return false;
    }

    const expected = Buffer.from(
      `sha256=${crypto.createHmac('sha256', appSecret).update(req.rawBody).digest('hex')}`
    );
    const supplied = Buffer.from(signature.toLowerCase());
    return expected.length === supplied.length &&
      crypto.timingSafeEqual(expected, supplied);
  }

  async function getOrderStatus(phone, orderId) {
    const { data, error } = await supabase.rpc('lookup_whatsapp_order', {
      p_customer_phone: phone,
      p_order_id: orderId
    });

    if (error) {
      if (MISSING_RPC_CODES.has(error.code)) {
        throw new Error('WhatsApp 訂單查詢資料庫 migration 尚未執行。');
      }
      throw new Error('WhatsApp 訂單查詢資料庫操作失敗。');
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('WhatsApp 訂單查詢結果格式無效。');
    }

    return data;
  }

  async function reportPayment(phone, orderId, reference, providerMessageId) {
    const { data, error } = await supabase.rpc('record_whatsapp_payment_report', {
      p_customer_phone: phone,
      p_order_id: orderId,
      p_payment_reference: reference,
      p_provider_message_id: providerMessageId
    });

    if (error) {
      if (MISSING_RPC_CODES.has(error.code)) {
        throw new Error('WhatsApp 付款回報資料庫 migration 尚未執行。');
      }
      throw new Error('WhatsApp 付款回報資料庫操作失敗。');
    }

    if (!data || typeof data !== 'object' || typeof data.found !== 'boolean') {
      throw new Error('WhatsApp 付款回報結果格式無效。');
    }

    return data;
  }

  async function handleIncomingMessage(message) {
    const phone = normalizePhone(message && message.from);
    if (!phone || typeof message.id !== 'string' || message.id.length === 0) {
      return { processed: false, reason: 'invalid_sender_or_message_id' };
    }

    const text = getMessageText(message);
    if (!text) {
      return { processed: false, reason: 'unsupported_message_type' };
    }

    const queryMatch = text.match(/^(?:查詢訂單|訂單查詢|查單|訂單)\s+([0-9a-f-]{36})$/i);
    if (queryMatch) {
      const orderId = parseOrderId(queryMatch[1]);
      if (orderId === null) {
        return { processed: false, reason: 'invalid_order_id' };
      }

      const order = await getOrderStatus(phone, orderId);
      const reply = order.found
        ? [
          `訂單 #${order.order_id}`,
          `付款狀態：${order.payment_status}`,
          `出貨狀態：${order.shipping_status}`,
          `出貨方式：${order.shipping_method || '未安排'}`,
          `運單號碼：${order.tracking_number || '未提供'}`,
          ...(Array.isArray(order.items)
            ? order.items.map(item => `${item.product_name} × ${item.quantity}：${item.reconciliation_status}`)
            : [])
        ].join('\n')
        : '未找到與此 WhatsApp 號碼相符的訂單。';

      await sendWhatsApp({ to: phone, text: reply });
      return { processed: true, action: 'order_lookup', order_id: order.found ? order.order_id : null };
    }

    const paymentMatch = text.match(/^(?:付款回報|付款)\s+([0-9a-f-]{36})\s+(.+)$/i);
    if (paymentMatch) {
      const orderId = parseOrderId(paymentMatch[1]);
      const reference = paymentMatch[2].trim();
      if (orderId === null || reference.length === 0 || reference.length > 100) {
        return { processed: false, reason: 'invalid_payment_report' };
      }

      const result = await reportPayment(phone, orderId, reference, message.id);
      const reply = result.found
        ? '已收到付款回報，訂單仍待管理員核實；核實前付款狀態不會變更。'
        : '未找到與此 WhatsApp 號碼相符的訂單，付款回報未建立。';

      await sendWhatsApp({ to: phone, text: reply });
      return {
        processed: true,
        action: 'payment_report',
        order_id: result.found ? orderId : null,
        duplicate: result.duplicate === true
      };
    }

    await sendWhatsApp({
      to: phone,
      text: 'LittlePlanet 指令：查詢訂單 <UUID訂單編號>，或付款回報 <UUID訂單編號> <交易參考編號>。'
    });
    return { processed: true, action: 'help' };
  }

  router.post('/whatsapp', async (req, res) => {
    try {
      if (!writeEnabled) {
        return sendError(res, 503, 'Webhook 尚未設定 SUPABASE_SERVICE_ROLE_KEY。');
      }
      if (!hasValidSignature(req)) {
        return sendError(res, 401, 'Webhook 簽名驗證失敗。');
      }

      if (
        !req.body ||
        typeof req.body !== 'object' ||
        Array.isArray(req.body) ||
        req.body.object !== 'whatsapp_business_account' ||
        !Array.isArray(req.body.entry)
      ) {
        return sendError(res, 400, 'Webhook payload 格式無效。');
      }

      const incomingMessages = [];
      for (const entry of req.body.entry) {
        if (!entry || !Array.isArray(entry.changes)) {
          continue;
        }
        for (const change of entry.changes) {
          const value = change && change.value;
          const changeMessages = value && Array.isArray(value.messages)
            ? value.messages
            : [];
          incomingMessages.push(...changeMessages);
        }
      }

      if (incomingMessages.length > 0 && typeof sendWhatsApp !== 'function') {
        return sendError(res, 503, 'WhatsApp 回覆發送器尚未設定。');
      }

      const results = [];
      for (const message of incomingMessages) {
        results.push(await handleIncomingMessage(message));
      }

      return res.status(200).json({
        success: true,
        data: {
          processed_count: results.filter(result => result.processed).length,
          ignored_count: results.filter(result => !result.processed).length,
          results
        },
        message: 'WhatsApp webhook 已處理。'
      });
    } catch (error) {
      console.error('處理 WhatsApp webhook 時發生錯誤：', error);
      return sendError(res, 500, '處理 WhatsApp webhook 時發生錯誤，Meta 可安全重試。');
    }
  });

  return router;
}

module.exports = createWebhookRouter;
