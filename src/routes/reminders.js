const crypto = require('crypto');
const express = require('express');

const REMINDER_STATUS_PENDING = '未提示';
const REMINDER_STATUS_SENT = '已發送提醒';
const MAX_WINDOW_HOURS = 168;
const CLAIM_LEASE_MINUTES = 30;
const PUBLIC_REMINDER_FIELDS = [
  'id',
  'product_id',
  'product_code',
  'name',
  'product_name',
  'supplier_name',
  'price',
  'retail_price',
  'cutoff_datetime',
  'remind_status',
  'status'
];

function sendError(res, status, message) {
  return res.status(status).json({
    success: false,
    data: null,
    message
  });
}

function getProductIdColumn(product) {
  if (product.product_id !== undefined) {
    return 'product_id';
  }
  return 'id';
}

function getProductId(product) {
  return product[getProductIdColumn(product)];
}

function getProductName(product) {
  return String(product.product_name || product.name || '未命名商品');
}

function filterReminderFields(product) {
  return Object.fromEntries(
    Object.entries(product).filter(([field]) => PUBLIC_REMINDER_FIELDS.includes(field))
  );
}

function parseWindowHours(value) {
  if (value === undefined) {
    return 24;
  }

  const hours = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/.test(value)
      ? Number(value)
      : null;
  return Number.isSafeInteger(hours) && hours >= 1 && hours <= MAX_WINDOW_HOURS
    ? hours
    : null;
}

function createReminderRouter(supabase, options = {}) {
  const router = express.Router();
  const cronToken = options.cronToken || '';
  const recipients = Array.isArray(options.recipients) ? options.recipients : [];
  const sendWhatsApp = options.sendWhatsApp;

  router.use((req, res, next) => {
    if (cronToken.length < 32 || cronToken === 'replace-with-a-long-random-secret') {
      return sendError(res, 503, '截單提醒服務尚未設定 REMINDER_CRON_TOKEN。');
    }

    const authorization = req.get('authorization') || '';
    const suppliedToken = authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';
    const expectedBuffer = Buffer.from(cronToken);
    const suppliedBuffer = Buffer.from(suppliedToken);

    if (
      expectedBuffer.length !== suppliedBuffer.length ||
      !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)
    ) {
      return sendError(res, 401, '沒有權限使用截單提醒服務。');
    }

    return next();
  });

  async function findUpcomingProducts(hours) {
    const now = new Date();
    const until = new Date(now.getTime() + hours * 60 * 60 * 1000);
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('remind_status', REMINDER_STATUS_PENDING)
      .gte('cutoff_datetime', now.toISOString())
      .lte('cutoff_datetime', until.toISOString())
      .order('cutoff_datetime', { ascending: true });

    if (error) {
      throw error;
    }

    if (!Array.isArray(data)) {
      throw new Error('Supabase 截單商品查詢回傳格式無效。');
    }

    return data.filter(product => (
      product.is_active !== false &&
      product.status !== '已下架'
    ));
  }

  async function releaseClaim(productIdColumn, productId, claimedAt) {
    const { error } = await supabase
      .from('products')
      .update({ remind_claimed_at: null })
      .eq(productIdColumn, productId)
      .eq('remind_status', REMINDER_STATUS_PENDING)
      .eq('remind_claimed_at', claimedAt);

    if (error) {
      throw error;
    }
  }

  router.get('/upcoming', async (req, res) => {
    try {
      const hours = parseWindowHours(req.query.hours);
      if (hours === null) {
        return sendError(res, 400, `hours 必須是 1 至 ${MAX_WINDOW_HOURS} 的整數。`);
      }

      const products = await findUpcomingProducts(hours);
      return res.json({
        success: true,
        data: products.map(filterReminderFields),
        message: `未來 ${hours} 小時內有 ${products.length} 件商品即將截單。`
      });
    } catch (error) {
      console.error('查詢即將截單商品失敗：', error);
      if (error && ['42703', 'PGRST204'].includes(error.code)) {
        return sendError(res, 503, 'products.cutoff_datetime、products.remind_status 或提醒鎖定欄位尚未建立，請先執行資料庫遷移。');
      }
      return sendError(res, 500, '查詢即將截單商品時發生錯誤。');
    }
  });

  router.post('/run', async (req, res) => {
    try {
      const hours = parseWindowHours(req.body && req.body.hours);
      if (hours === null) {
        return sendError(res, 400, `hours 必須是 1 至 ${MAX_WINDOW_HOURS} 的整數。`);
      }

      if (recipients.length === 0) {
        return sendError(res, 503, '尚未設定 WHATSAPP_REMINDER_RECIPIENTS。');
      }
      if (typeof sendWhatsApp !== 'function') {
        return sendError(res, 503, 'WhatsApp 提醒發送器尚未設定。');
      }

      const products = await findUpcomingProducts(hours);
      const results = [];

      for (const product of products) {
        const productIdColumn = getProductIdColumn(product);
        const productId = getProductId(product);
        const claimNow = new Date();
        const claimedAt = claimNow.toISOString();
        const staleClaimBefore = new Date(
          claimNow.getTime() - CLAIM_LEASE_MINUTES * 60 * 1000
        ).toISOString().replace(/\.\d{3}Z$/, 'Z');

        const { data: claimedRows, error: claimError } = await supabase
          .from('products')
          .update({ remind_claimed_at: claimedAt })
          .eq(productIdColumn, productId)
          .eq('remind_status', REMINDER_STATUS_PENDING)
          .or(`remind_claimed_at.is.null,remind_claimed_at.lt.${staleClaimBefore}`)
          .select(productIdColumn);

        if (claimError) {
          console.error('截單提醒商品鎖定失敗：', { productId, error: claimError });
          results.push({ product_id: productId, success: false, message: '無法鎖定提醒工作。' });
          continue;
        }

        if (!Array.isArray(claimedRows) || claimedRows.length !== 1) {
          results.push({ product_id: productId, success: false, skipped: true, message: '商品提醒已由其他工作程序處理。' });
          continue;
        }

        const cutoff = new Date(product.cutoff_datetime);
        const message = [
          `截單提醒：${getProductName(product)}`,
          `截單時間：${cutoff.toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' })}`,
          product.product_code ? `產品代號：${product.product_code}` : ''
        ].filter(Boolean).join('\n');
        const sentRecipients = [];
        const failedRecipients = [];

        for (const recipient of recipients) {
          try {
            await sendWhatsApp({ to: recipient, text: message });
            sentRecipients.push(recipient);
          } catch (error) {
            console.error('WhatsApp 截單提醒發送失敗：', {
              productId,
              recipient,
              error
            });
            failedRecipients.push(recipient);
          }
        }

        if (failedRecipients.length > 0) {
          let claimReleased = true;
          try {
            await releaseClaim(productIdColumn, productId, claimedAt);
          } catch (error) {
            claimReleased = false;
            console.error('釋放失敗提醒鎖定時發生錯誤：', {
              productId,
              error
            });
          }

          results.push({
            product_id: productId,
            success: false,
            sent_recipients: sentRecipients,
            failed_recipients: failedRecipients,
            message: claimReleased
              ? '部分或全部 WhatsApp 提醒發送失敗；提醒狀態未標記為已發送，重試時已送達對象可能收到重複提醒。'
              : '部分或全部 WhatsApp 提醒發送失敗；提醒鎖定暫未釋放，請檢查資料庫及發送紀錄。'
          });
          continue;
        }

        const sentAt = new Date().toISOString();
        const { data: updatedRows, error: updateError } = await supabase
          .from('products')
          .update({
            remind_status: REMINDER_STATUS_SENT,
            remind_claimed_at: null,
            remind_sent_at: sentAt
          })
          .eq(productIdColumn, productId)
          .eq('remind_status', REMINDER_STATUS_PENDING)
          .eq('remind_claimed_at', claimedAt)
          .select(productIdColumn);

        if (updateError || !Array.isArray(updatedRows) || updatedRows.length !== 1) {
          console.error('提醒已發送但更新 remind_status 失敗：', {
            productId,
            error: updateError || new Error('資料庫沒有更新到預期商品。')
          });
          results.push({
            product_id: productId,
            success: false,
            sent: true,
            message: '提醒已發送，但提醒狀態更新失敗；請檢查資料庫以免重複發送。'
          });
          continue;
        }

        results.push({
          product_id: productId,
          success: true,
          sent_recipients: recipients.length,
          remind_status: REMINDER_STATUS_SENT
        });
      }

      const failedCount = results.filter(result => !result.success).length;
      const responseStatus = failedCount > 0 ? 207 : 200;
      return res.status(responseStatus).json({
        success: failedCount === 0,
        data: results,
        message: `截單提醒處理完成：成功 ${results.length - failedCount} 件，失敗或略過 ${failedCount} 件。`
      });
    } catch (error) {
      console.error('執行截單提醒失敗：', error);
      if (error && ['42703', 'PGRST204'].includes(error.code)) {
        return sendError(res, 503, 'products.cutoff_datetime、products.remind_status 或提醒鎖定欄位尚未建立，請先執行資料庫遷移。');
      }
      return sendError(res, 500, '執行截單提醒時發生錯誤。');
    }
  });

  return router;
}

module.exports = createReminderRouter;
