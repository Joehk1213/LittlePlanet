'use strict';

const crypto = require('node:crypto');
const express = require('express');

const PAYMENT_PROOF_BUCKET = 'payment-proofs';
const MAX_PROOF_BYTES = 5 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORDER_NUMBER_PATTERN = /^[A-Z0-9][A-Z0-9-]{0,99}$/;
const PROOF_STATUSES = new Set(['verified', 'rejected']);

function sendError(res, status, message) {
  return res.status(status).json({
    success: false,
    data: null,
    message,
  });
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

function getPhoneVariants(phone) {
  const normalized = phone.trim().replace(/^\+/, '');
  if (!/^\d{8,15}$/.test(normalized)) {
    return null;
  }
  const rawPhone = normalized.replace(/^852/, '');
  return [
    ...new Set([normalized, rawPhone, `852${rawPhone}`, `+${normalized}`, `+852${rawPhone}`]),
  ];
}

function createPaymentProofRouter(supabase, options = {}) {
  const router = express.Router();
  const serviceRoleAvailable = options.serviceRoleAvailable !== false;

  function authorizeAdmin(req, res) {
    if (
      typeof options.isSessionAuthorized !== 'function' ||
      !options.isSessionAuthorized(req, 'orders')
    ) {
      sendError(res, 401, '請先以具備訂單管理權限的管理員 Session 登入。');
      return false;
    }
    if (!supabase || !serviceRoleAvailable) {
      sendError(res, 503, '付款憑證服務尚未設定資料庫服務權限。');
      return false;
    }
    return true;
  }

  if (options.enableUpload !== false) {
    router.post(
      '/:id/payment-proof',
      express.raw({
        type: ['image/jpeg', 'image/png', 'image/webp'],
        limit: MAX_PROOF_BYTES,
      }),
      async (req, res) => {
        res.set('Cache-Control', 'no-store');
        if (!supabase || !serviceRoleAvailable) {
          return sendError(res, 503, '付款憑證服務尚未設定資料庫服務權限。');
        }

        const orderNumber =
          typeof req.params.id === 'string' ? req.params.id.trim().toUpperCase() : '';
        const phoneVariants = getPhoneVariants(req.get('x-customer-phone') || '');
        const file = req.body;
        const imageType = Buffer.isBuffer(file) ? getImageType(file) : null;

        if (
          !orderNumber ||
          !ORDER_NUMBER_PATTERN.test(orderNumber) ||
          UUID_PATTERN.test(orderNumber) ||
          !phoneVariants
        ) {
          return sendError(res, 400, '必須提供正式訂單編號及有效聯絡電話。');
        }
        if (
          !Buffer.isBuffer(file) ||
          file.length === 0 ||
          file.length > MAX_PROOF_BYTES ||
          !imageType
        ) {
          return sendError(res, 400, '請上傳有效的 JPG、PNG 或 WEBP 圖片（最多 5 MB）。');
        }
        if (req.get('content-type') !== imageType.mimeType) {
          return sendError(res, 400, '上傳檔案格式與圖片內容不符。');
        }

        try {
          const { data: order, error: orderError } = await supabase
            .from('orders')
            .select('order_id,order_number,customer_phone,payment_proof_url,payment_proof_status')
            .in('customer_phone', phoneVariants)
            .eq('order_number', orderNumber)
            .maybeSingle();

          if (orderError) {
            console.error('付款憑證訂單驗證失敗：', orderError);
            return sendError(res, 500, '驗證訂單失敗，請稍後再試。');
          }
          if (!order) {
            return sendError(res, 404, '找不到符合電話及訂單編號的訂單。');
          }
          if (order.payment_proof_status === 'verified') {
            return sendError(res, 409, '此訂單付款憑證已核實，不能重新提交。');
          }

          const objectPath = `${order.order_id}/${crypto.randomUUID()}.${imageType.extension}`;
          const { error: uploadError } = await supabase.storage
            .from(PAYMENT_PROOF_BUCKET)
            .upload(objectPath, file, {
              contentType: imageType.mimeType,
              cacheControl: '300',
              upsert: false,
            });
          if (uploadError) {
            console.error('儲存付款憑證失敗：', uploadError);
            return sendError(res, 500, '付款憑證上傳失敗，請稍後再試。');
          }

          const { data, error: updateError } = await supabase
            .from('orders')
            .update({
              payment_proof_url: objectPath,
              payment_proof_status: 'pending',
            })
            .eq('order_id', order.order_id)
            .select('order_number,payment_proof_status')
            .maybeSingle();

          if (updateError || !data) {
            if (updateError) {
              console.error('儲存付款憑證資料失敗：', updateError);
            }
            const { error: cleanupError } = await supabase.storage
              .from(PAYMENT_PROOF_BUCKET)
              .remove([objectPath]);
            if (cleanupError) {
              console.error('清理未關聯的付款憑證失敗：', cleanupError);
            }
            return sendError(res, 500, '付款憑證未能連結至訂單，請稍後再試。');
          }

          if (
            typeof order.payment_proof_url === 'string' &&
            order.payment_proof_url &&
            order.payment_proof_url !== objectPath
          ) {
            try {
              const { error: oldProofError } = await supabase.storage
                .from(PAYMENT_PROOF_BUCKET)
                .remove([order.payment_proof_url]);
              if (oldProofError) {
                console.error('移除已替換的付款憑證失敗：', oldProofError);
              }
            } catch (cleanupError) {
              console.error('移除已替換的付款憑證時發生錯誤：', cleanupError);
            }
          }

          return res.status(201).json({
            success: true,
            data,
            message: '付款憑證已收到，管理員核對後會更新付款狀態。',
          });
        } catch (error) {
          console.error('處理付款憑證時發生未預期錯誤：', error);
          return sendError(res, 500, '處理付款憑證時發生錯誤，請稍後再試。');
        }
      }
    );
  }

  if (options.enableAdmin !== false) {
    router.patch('/:orderId/payment-status', async (req, res) => {
      if (!authorizeAdmin(req, res)) {
        return;
      }
      res.set('Cache-Control', 'no-store');
      const { orderId } = req.params;
      if (!UUID_PATTERN.test(orderId) && !/^[1-9]\d*$/.test(orderId)) {
        return sendError(res, 400, 'orderId 必須是有效訂單識別碼。');
      }
      const paymentProofStatus = req.body && req.body.payment_proof_status;
      if (typeof paymentProofStatus !== 'string' || !PROOF_STATUSES.has(paymentProofStatus)) {
        return sendError(res, 400, 'payment_proof_status 必須是 verified 或 rejected。');
      }

      try {
        const { data: order, error: orderError } = await supabase
          .from('orders')
          .select('order_id,payment_proof_url')
          .eq('order_id', orderId)
          .maybeSingle();
        if (orderError) {
          console.error('讀取待審核付款憑證失敗：', orderError);
          return sendError(res, 500, '讀取付款憑證資料失敗，請稍後再試。');
        }
        if (!order) {
          return sendError(res, 404, '找不到指定訂單。');
        }
        if (typeof order.payment_proof_url !== 'string' || !order.payment_proof_url) {
          return sendError(res, 409, '此訂單尚未提交付款憑證。');
        }

        const updateValues = { payment_proof_status: paymentProofStatus };
        if (paymentProofStatus === 'verified') {
          updateValues.payment_status = '已付清';
        }
        const { data, error } = await supabase
          .from('orders')
          .update(updateValues)
          .eq('order_id', orderId)
          .select('order_id,order_number,payment_proof_status,payment_status')
          .maybeSingle();

        if (error) {
          console.error('審核付款憑證失敗：', error);
          return sendError(res, 500, '更新付款憑證狀態失敗，請稍後再試。');
        }
        if (!data) {
          return sendError(res, 404, '找不到指定訂單。');
        }

        return res.json({
          success: true,
          data,
          message:
            paymentProofStatus === 'verified' ? '付款憑證已核實。' : '付款憑證已標記為不通過。',
        });
      } catch (error) {
        console.error('審核付款憑證時發生未預期錯誤：', error);
        return sendError(res, 500, '審核付款憑證時發生錯誤，請稍後再試。');
      }
    });
  }

  return router;
}

module.exports = createPaymentProofRouter;
module.exports.PAYMENT_PROOF_BUCKET = PAYMENT_PROOF_BUCKET;
