'use strict';

const { rateLimit } = require('express-rate-limit');

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;

function createSensitiveRateLimiters(options = {}) {
  const windowMs = Number.isSafeInteger(options.windowMs) && options.windowMs > 0
    ? options.windowMs
    : DEFAULT_WINDOW_MS;

  function createLimiter(limit, message) {
    return rateLimit({
      windowMs,
      limit,
      standardHeaders: true,
      legacyHeaders: false,
      handler(req, res) {
        return res.status(429).json({
          success: false,
          data: null,
          message
        });
      }
    });
  }

  return {
    checkout: createLimiter(
      options.checkoutMax || 10,
      '落單請求次數過多，請稍後再試。'
    ),
    inventory: createLimiter(
      options.inventoryMax || 30,
      '庫存更新請求次數過多，請稍後再試。'
    ),
    customerLookup: createLimiter(
      options.customerLookupMax || 10,
      '訂單查詢請求次數過多，請稍後再試。'
    ),
    customerAuth: createLimiter(
      options.customerAuthMax || 5,
      '會員身份驗證次數過多，請稍後再試。'
    ),
    customerOrders: createLimiter(
      options.customerOrdersMax || 30,
      '會員訂單讀取次數過多，請稍後再試。'
    ),
    customerWishlistRead: createLimiter(
      options.customerWishlistReadMax || 30,
      '會員收藏讀取次數過多，請稍後再試。'
    ),
    customerWishlistWrite: createLimiter(
      options.customerWishlistWriteMax || 15,
      '會員收藏操作次數過多，請稍後再試。'
    ),
    customerReview: createLimiter(
      options.customerReviewMax || 5,
      '評價提交次數過多，請稍後再試。'
    ),
    paymentProofUpload: createLimiter(
      options.paymentProofUploadMax || 5,
      '付款憑證上傳次數過多，請稍後再試。'
    ),
    reviewAdmin: createLimiter(
      options.reviewAdminMax || 60,
      '評價管理請求次數過多，請稍後再試。'
    ),
    adminLogin: createLimiter(
      options.adminLoginMax || 5,
      '登入嘗試次數過多，請稍後再試。'
    ),
    adminWrite: createLimiter(
      options.adminWriteMax || 30,
      '管理操作請求次數過多，請稍後再試。'
    )
  };
}

module.exports = createSensitiveRateLimiters;
