const crypto = require('crypto');
const express = require('express');
const { parseWhatsAppOrderMessage } = require('../utils/whatsapp-order-parser');

const MISSING_RPC_CODES = new Set(['42883', 'PGRST202']);
const INTENT_TOKEN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAYMENT_PROOF_BUCKET = 'payment-proofs';
const MAX_PAYMENT_PROOF_BYTES = 5 * 1024 * 1024;

function sendError(res, status, message) {
  return res.status(status).json({
    success: false,
    data: null,
    message,
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
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
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

function parseIntentToken(value) {
  return typeof value === 'string' && INTENT_TOKEN_PATTERN.test(value) ? value.toLowerCase() : null;
}

function getMessageText(message) {
  if (!message || message.type !== 'text' || !message.text) {
    return '';
  }

  return typeof message.text.body === 'string' ? message.text.body.trim() : '';
}

function getImageType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return { mimeType: 'image/png', extension: 'png' };
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { mimeType: 'image/webp', extension: 'webp' };
  }
  return null;
}

function createWebhookRouter(supabase, options = {}) {
  const router = express.Router();
  const verifyToken = options.verifyToken || '';
  const appSecret = options.appSecret || '';
  const sendWhatsApp = options.sendWhatsApp;
  const downloadWhatsAppMedia =
    options.downloadWhatsAppMedia || (sendWhatsApp && sendWhatsApp.downloadMedia);
  const sendWhatsAppImage = options.sendWhatsAppImage || (sendWhatsApp && sendWhatsApp.sendImage);
  const receiptRecipients = options.receiptRecipients || [];
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
    return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
  }

  async function getOrderStatus(phone, orderId) {
    const { data, error } = await supabase.rpc('lookup_whatsapp_order', {
      p_customer_phone: phone,
      p_order_id: orderId,
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
      p_provider_message_id: providerMessageId,
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

  async function callPaymentProofRpc(name, args, description) {
    const { data, error } = await supabase.rpc(name, args);
    if (error) {
      if (MISSING_RPC_CODES.has(error.code)) {
        throw new Error('WhatsApp 付款憑證 migration 尚未執行。');
      }
      throw new Error(`${description}資料庫操作失敗。`);
    }
    if (!data || typeof data !== 'object' || typeof data.success !== 'boolean') {
      throw new Error(`${description}資料庫回傳格式無效。`);
    }
    return data;
  }

  async function markPaymentProofFailed(messageId, error) {
    const result = await callPaymentProofRpc(
      'fail_whatsapp_payment_proof',
      {
        p_message_id: messageId,
        p_error: error instanceof Error ? error.message.slice(0, 500) : '付款憑證處理失敗',
      },
      '記錄付款憑證處理失敗'
    );
    if (!result.success) {
      throw new Error(result.message || '未能記錄付款憑證處理失敗。');
    }
  }

  async function setPaymentProofNotification(messageId, status, errorMessage = null) {
    const result = await callPaymentProofRpc(
      'set_whatsapp_payment_proof_notification',
      {
        p_message_id: messageId,
        p_status: status,
        p_error: errorMessage,
      },
      '更新付款憑證內部通知狀態'
    );
    if (!result.success) {
      throw new Error(result.message || '未能更新付款憑證內部通知狀態。');
    }
  }

  async function handlePaymentProofImage(message, phone) {
    const mediaId = message.image && message.image.id;
    const caption = typeof message.image.caption === 'string' ? message.image.caption : '';
    const orderMatch = caption.toUpperCase().match(/\b(LP-[A-Z0-9][A-Z0-9-]{0,96})\b/);
    if (!orderMatch) {
      await sendWhatsApp({
        to: phone,
        text: '請重新傳送付款截圖，並在圖片說明加入正式訂單編號，例如：付款 LP-YYYYMMDD-0003。',
      });
      return {
        processed: true,
        action: 'payment_proof',
        success: false,
        reason: 'order_number_required',
      };
    }
    if (typeof mediaId !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(mediaId)) {
      throw new Error('WhatsApp 付款憑證媒體 ID 無效。');
    }
    if (typeof downloadWhatsAppMedia !== 'function' || typeof sendWhatsAppImage !== 'function') {
      throw new Error('WhatsApp 付款憑證媒體服務尚未設定。');
    }

    const orderNumber = orderMatch[1];
    const claim = await callPaymentProofRpc(
      'claim_whatsapp_payment_proof',
      {
        p_message_id: message.id,
        p_customer_phone: phone,
        p_order_number: orderNumber,
      },
      '驗證付款憑證訂單'
    );
    if (!claim.success) {
      await sendWhatsApp({
        to: phone,
        text: claim.message || '找不到符合此電話及訂單編號的訂單，憑證未有保存。',
      });
      return {
        processed: true,
        action: 'payment_proof',
        success: false,
        reason: claim.code || 'order_not_found',
      };
    }
    const claimData = claim.data;
    if (!claimData || typeof claimData.order_id !== 'string') {
      throw new Error('付款憑證訂單識別資料無效。');
    }
    if (claimData.duplicate) {
      await sendWhatsApp({
        to: phone,
        text: '此付款截圖訊息已收到，管理員核對後會更新付款狀態。',
      });
      return {
        processed: true,
        action: 'payment_proof',
        duplicate: true,
        success: true,
        order_number: orderNumber,
      };
    }

    let objectPath = null;
    let finalized = false;
    try {
      const downloaded = await downloadWhatsAppMedia(mediaId);
      if (
        !downloaded ||
        !Buffer.isBuffer(downloaded.media) ||
        downloaded.media.length === 0 ||
        downloaded.media.length > MAX_PAYMENT_PROOF_BYTES
      ) {
        throw new Error('付款憑證圖片無效或超過 5 MB。');
      }
      const imageType = getImageType(downloaded.media);
      if (!imageType || imageType.mimeType !== downloaded.mimeType) {
        throw new Error('付款憑證圖片內容與檔案格式不符。');
      }

      objectPath = `${claimData.order_id}/${crypto.randomUUID()}.${imageType.extension}`;
      const { error: uploadError } = await supabase.storage
        .from(PAYMENT_PROOF_BUCKET)
        .upload(objectPath, downloaded.media, {
          contentType: imageType.mimeType,
          cacheControl: '300',
          upsert: false,
        });
      if (uploadError) {
        console.error('WhatsApp 付款憑證儲存失敗：', uploadError);
        throw new Error('付款憑證儲存失敗。');
      }

      const completed = await callPaymentProofRpc(
        'complete_whatsapp_payment_proof',
        {
          p_message_id: message.id,
          p_object_path: objectPath,
        },
        '關聯 WhatsApp 付款憑證'
      );
      if (
        !completed.success ||
        !completed.data ||
        typeof completed.data.order_number !== 'string'
      ) {
        throw new Error(completed.message || '未能將付款憑證連結至訂單。');
      }
      finalized = true;

      const oldProofPath = completed.data.old_proof_path;
      if (typeof oldProofPath === 'string' && oldProofPath && oldProofPath !== objectPath) {
        const { error: removeError } = await supabase.storage
          .from(PAYMENT_PROOF_BUCKET)
          .remove([oldProofPath]);
        if (removeError) {
          console.error('移除已替換的 WhatsApp 付款憑證失敗：', removeError);
        }
      }

      let notificationStatus = 'not_configured';
      let notificationError = null;
      if (receiptRecipients.length > 0) {
        const forwardingErrors = [];
        for (const recipient of receiptRecipients) {
          try {
            await sendWhatsAppImage({
              to: recipient,
              media: downloaded.media,
              mimeType: imageType.mimeType,
              caption: `付款憑證待審核｜${completed.data.order_number}｜客戶 ${phone}`,
            });
          } catch (error) {
            forwardingErrors.push(error);
            console.error('轉發付款憑證至內部收件人失敗：', error);
          }
        }
        notificationStatus = forwardingErrors.length === 0 ? 'sent' : 'failed';
        notificationError = forwardingErrors.length > 0 ? '一個或多個內部收件人轉發失敗。' : null;
      }
      try {
        await setPaymentProofNotification(message.id, notificationStatus, notificationError);
      } catch (error) {
        console.error('記錄付款憑證內部通知結果失敗：', error);
        notificationStatus = 'failed';
        notificationError = '付款憑證已保存，但內部通知結果未能記錄。';
      }

      await sendWhatsApp({
        to: phone,
        text:
          notificationStatus === 'failed'
            ? `已收到訂單 ${completed.data.order_number} 的付款截圖，惟內部自動通知未完成，管理員仍需到後台核對。付款狀態尚未更改。`
            : `已收到訂單 ${completed.data.order_number} 的付款截圖，現正等待管理員核對。核實前付款狀態不會更改。`,
      });
      return {
        processed: true,
        action: 'payment_proof',
        success: true,
        order_number: completed.data.order_number,
        notification_status: notificationStatus,
      };
    } catch (error) {
      if (!finalized && objectPath) {
        const { error: cleanupError } = await supabase.storage
          .from(PAYMENT_PROOF_BUCKET)
          .remove([objectPath]);
        if (cleanupError) {
          console.error('清理未關聯的 WhatsApp 付款憑證失敗：', cleanupError);
        }
      }
      if (!finalized) {
        await markPaymentProofFailed(message.id, error);
      }
      throw error;
    }
  }

  async function getOrderCatalog() {
    const { data, error } = await supabase.rpc('list_whatsapp_order_catalog');
    if (error) {
      if (MISSING_RPC_CODES.has(error.code)) {
        throw new Error('WhatsApp 商品目錄 migration 尚未執行。');
      }
      throw new Error('WhatsApp 商品目錄查詢失敗。');
    }
    if (!Array.isArray(data) || data.some((product) => !product || typeof product !== 'object')) {
      throw new Error('WhatsApp 商品目錄回傳格式無效。');
    }
    return data;
  }

  function isOrderCandidate(text) {
    return /(?:^|[,，、;；\n])\s*.+?\s*(?:x|×|\*)\s*\d+/i.test(text.normalize('NFKC'));
  }

  async function handleOrderConfirmation(phone, confirmationToken, message) {
    const { data, error } = await supabase.rpc('confirm_whatsapp_order_intent', {
      p_customer_phone: phone,
      p_intent_token: confirmationToken,
      p_confirmation_message_id: message.id,
    });

    if (error) {
      if (error.message === 'STOCK_UNAVAILABLE') {
        await sendWhatsApp({
          to: phone,
          text: '確認失敗：部分商品庫存不足，未有建立訂單或扣減庫存，請重新落單。',
        });
        return { processed: true, action: 'order_confirmation', success: false };
      }
      if (error.message === 'PRODUCT_UNAVAILABLE') {
        await sendWhatsApp({
          to: phone,
          text: '確認失敗：部分商品已下架或截單，未有建立訂單，請重新落單。',
        });
        return { processed: true, action: 'order_confirmation', success: false };
      }
      if (MISSING_RPC_CODES.has(error.code)) {
        throw new Error('WhatsApp 訂單確認 migration 尚未執行。');
      }
      throw new Error('WhatsApp 訂單確認資料庫操作失敗。');
    }

    if (
      !data ||
      typeof data !== 'object' ||
      typeof data.success !== 'boolean' ||
      (data.success && (!data.data || typeof data.data !== 'object'))
    ) {
      throw new Error('WhatsApp 訂單確認回傳格式無效。');
    }

    if (!data.success) {
      await sendWhatsApp({ to: phone, text: data.message || '訂單確認未能完成。' });
      return {
        processed: true,
        action: 'order_confirmation',
        success: false,
        reason: data.code || 'confirmation_rejected',
      };
    }

    if (data.data.status !== 'confirmed' || typeof data.data.order_number !== 'string') {
      return {
        processed: true,
        action: 'order_confirmation',
        duplicate: data.data.duplicate === true,
        success: false,
      };
    }

    await sendWhatsApp({
      to: phone,
      text: data.data.duplicate
        ? `此訂單已確認：${data.data.order_number}。付款狀態仍為未付款，出貨前需付清。`
        : `訂單已確認：${data.data.order_number}。付款狀態為未付款；貨到後付款，出貨前需付清。`,
    });
    return {
      processed: true,
      action: 'order_confirmation',
      duplicate: data.data.duplicate === true,
      order_number: data.data.order_number,
    };
  }

  async function handleOrderIntent(phone, text, message) {
    if (!isOrderCandidate(text)) {
      return null;
    }

    const catalog = await getOrderCatalog();
    const parsed = parseWhatsAppOrderMessage(text, catalog);
    if (!parsed.success) {
      await sendWhatsApp({ to: phone, text: parsed.message });
      return {
        processed: true,
        action: 'order_intent',
        success: false,
        reason: parsed.error && parsed.error.code,
      };
    }

    const normalizedCatalog = new Map(
      catalog.map((product) => [
        product.product_code.normalize('NFKC').trim().toLocaleLowerCase('en'),
        product,
      ])
    );
    const intentItems = parsed.data.items.map((item) => {
      const product = normalizedCatalog.get(
        item.product_code.normalize('NFKC').trim().toLocaleLowerCase('en')
      );
      if (!product || (typeof product.id !== 'string' && typeof product.id !== 'number')) {
        throw new Error('WhatsApp 解析商品缺少有效資料庫識別碼。');
      }
      return {
        product_id: String(product.id),
        product_code: product.product_code,
        quantity: item.quantity,
      };
    });

    const { data, error } = await supabase.rpc('create_whatsapp_order_intent', {
      p_customer_phone: phone,
      p_source_message_id: message.id,
      p_items: intentItems,
    });
    if (error) {
      if (error.message === 'STOCK_UNAVAILABLE' || error.message === 'PRODUCT_UNAVAILABLE') {
        await sendWhatsApp({
          to: phone,
          text:
            error.message === 'STOCK_UNAVAILABLE'
              ? '商品庫存不足，暫時未能建立訂單預覽，請調整數量後再試。'
              : '商品已下架或截單，未能建立訂單預覽。',
        });
        return { processed: true, action: 'order_intent', success: false };
      }
      if (MISSING_RPC_CODES.has(error.code)) {
        throw new Error('WhatsApp 訂單意圖 migration 尚未執行。');
      }
      throw new Error('建立 WhatsApp 訂單意圖失敗。');
    }

    if (
      !data ||
      typeof data !== 'object' ||
      typeof data.success !== 'boolean' ||
      (data.success && (!data.data || typeof data.data !== 'object'))
    ) {
      throw new Error('WhatsApp 訂單意圖回傳格式無效。');
    }

    if (!data.success) {
      await sendWhatsApp({ to: phone, text: data.message || '未能建立訂單預覽。' });
      return {
        processed: true,
        action: 'order_intent',
        success: false,
        reason: data.code || 'intent_rejected',
      };
    }

    const intent = data.data;
    if (intent.status !== 'pending' || typeof intent.intent_token !== 'string') {
      return {
        processed: true,
        action: 'order_intent',
        duplicate: intent.duplicate === true,
        success: intent.status === 'confirmed',
      };
    }

    if (!Array.isArray(intent.items) || !Number.isFinite(Number(intent.total_amount))) {
      throw new Error('WhatsApp 訂單意圖預覽資料無效。');
    }

    const expiry = new Date(intent.expires_at);
    if (Number.isNaN(expiry.getTime())) {
      throw new Error('WhatsApp 訂單意圖過期時間無效。');
    }
    if (expiry.getTime() <= Date.now()) {
      await sendWhatsApp({
        to: phone,
        text: '此訂單預覽已過期，請重新發送商品代號及數量。',
      });
      return {
        processed: true,
        action: 'order_intent',
        duplicate: intent.duplicate === true,
        success: false,
        reason: 'INTENT_EXPIRED',
      };
    }

    const lines = intent.items.map(
      (item) =>
        `${item.product_name}（${item.product_code}）× ${item.quantity}：HK$${Number(item.subtotal).toFixed(2)}`
    );

    await sendWhatsApp({
      to: phone,
      text: [
        'LittlePlanet 訂單預覽（尚未落實，暫未扣庫存）：',
        ...lines,
        `合計：HK$${Number(intent.total_amount).toFixed(2)}`,
        `如確認，請於 ${expiry.toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' })} 前回覆：確認 ${intent.intent_token}`,
        '確認後訂單付款狀態為未付款；貨到後付款，出貨前需付清。',
      ].join('\n'),
    });
    return {
      processed: true,
      action: 'order_intent',
      duplicate: intent.duplicate === true,
      success: true,
      intent_token: intent.intent_token,
    };
  }

  async function handleIncomingMessage(message) {
    const phone = normalizePhone(message && message.from);
    if (!phone || typeof message.id !== 'string' || message.id.length === 0) {
      return { processed: false, reason: 'invalid_sender_or_message_id' };
    }

    if (message.type === 'image') {
      return handlePaymentProofImage(message, phone);
    }

    const text = getMessageText(message);
    if (!text) {
      return { processed: false, reason: 'unsupported_message_type' };
    }

    const confirmationMatch = text.match(/^(?:確認|confirm)\s+([0-9a-f-]{36})$/i);
    if (confirmationMatch) {
      const intentToken = parseIntentToken(confirmationMatch[1]);
      if (!intentToken) {
        await sendWhatsApp({ to: phone, text: '確認碼格式無效，請使用訂單預覽中的完整確認碼。' });
        return { processed: true, action: 'order_confirmation', success: false };
      }
      return handleOrderConfirmation(phone, intentToken, message);
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
              ? order.items.map(
                  (item) => `${item.product_name} × ${item.quantity}：${item.reconciliation_status}`
                )
              : []),
          ].join('\n')
        : '未找到與此 WhatsApp 號碼相符的訂單。';

      await sendWhatsApp({ to: phone, text: reply });
      return {
        processed: true,
        action: 'order_lookup',
        order_id: order.found ? order.order_id : null,
      };
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
        duplicate: result.duplicate === true,
      };
    }

    const orderIntent = await handleOrderIntent(phone, text, message);
    if (orderIntent) {
      return orderIntent;
    }

    await sendWhatsApp({
      to: phone,
      text: 'LittlePlanet 指令：查詢訂單 <UUID訂單編號>、付款回報 <UUID訂單編號> <交易參考編號>，或以「商品代號 x 數量」格式落單。',
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
          const changeMessages = value && Array.isArray(value.messages) ? value.messages : [];
          incomingMessages.push(...changeMessages);
        }
      }

      if (incomingMessages.length > 0 && typeof sendWhatsApp !== 'function') {
        return sendError(res, 503, 'WhatsApp 回覆發送器尚未設定。');
      }
      if (
        incomingMessages.some((message) => message && message.type === 'image') &&
        (typeof downloadWhatsAppMedia !== 'function' || typeof sendWhatsAppImage !== 'function')
      ) {
        return sendError(res, 503, 'WhatsApp 付款憑證媒體服務尚未設定。');
      }

      const results = [];
      for (const message of incomingMessages) {
        results.push(await handleIncomingMessage(message));
      }

      return res.status(200).json({
        success: true,
        data: {
          processed_count: results.filter((result) => result.processed).length,
          ignored_count: results.filter((result) => !result.processed).length,
          results,
        },
        message: 'WhatsApp webhook 已處理。',
      });
    } catch (error) {
      console.error('處理 WhatsApp webhook 時發生錯誤：', error);
      return sendError(res, 500, '處理 WhatsApp webhook 時發生錯誤，Meta 可安全重試。');
    }
  });

  return router;
}

module.exports = createWebhookRouter;
