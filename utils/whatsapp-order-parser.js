'use strict';

const MAX_ORDER_QUANTITY = 1000;
const ITEM_SEPARATOR_PATTERN = /[,、;\n\r]+/;
const ITEM_PATTERN = /^(.+?)\s*(?:x|×|\*)\s*(\d+)$/i;

function normalizeCode(value) {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en');
}

function failure(message, code) {
  return {
    success: false,
    data: null,
    message,
    error: { code }
  };
}

function parseWhatsAppOrderMessage(message, products) {
  try {
    if (typeof message !== 'string' || message.trim() === '') {
      return failure('請提供落單內容。', 'EMPTY_MESSAGE');
    }
    if (!Array.isArray(products)) {
      return failure('商品清單格式無效，未能驗證商品代號。', 'INVALID_CATALOG');
    }

    const productByCode = new Map();
    for (const product of products) {
      if (!product || typeof product.product_code !== 'string') {
        return failure('商品清單包含無效的商品代號。', 'INVALID_CATALOG');
      }

      const normalizedCode = normalizeCode(product.product_code);
      if (!normalizedCode) {
        return failure('商品清單包含空白的商品代號。', 'INVALID_CATALOG');
      }
      if (productByCode.has(normalizedCode)) {
        return failure(
          `商品代號「${product.product_code}」重複，無法唯一識別商品。`,
          'AMBIGUOUS_PRODUCT_CODE'
        );
      }

      productByCode.set(normalizedCode, product);
    }

    const normalizedMessage = message
      .normalize('NFKC')
      .replace(/[，]/g, ',')
      .replace(/[；]/g, ';')
      .trim();
    const segments = normalizedMessage
      .split(ITEM_SEPARATOR_PATTERN)
      .map(segment => segment.trim())
      .filter(Boolean);

    if (segments.length === 0) {
      return failure('未找到有效的商品項目。', 'EMPTY_ITEMS');
    }

    const seenCodes = new Set();
    const items = [];

    for (const segment of segments) {
      const match = segment.match(ITEM_PATTERN);
      if (!match) {
        return failure(
          `格式無法辨識：「${segment}」。請使用「商品代號 x 數量」格式。`,
          'INVALID_ITEM_FORMAT'
        );
      }

      const suppliedCode = match[1].trim();
      const normalizedCode = normalizeCode(suppliedCode);
      if (!normalizedCode) {
        return failure('商品代號不可為空白。', 'EMPTY_PRODUCT_CODE');
      }

      const quantity = Number(match[2]);
      if (!Number.isSafeInteger(quantity) || quantity <= 0) {
        return failure(`商品「${suppliedCode}」的數量必須是正整數。`, 'INVALID_QUANTITY');
      }
      if (quantity > MAX_ORDER_QUANTITY) {
        return failure(
          `商品「${suppliedCode}」的數量不可多於 ${MAX_ORDER_QUANTITY}。`,
          'QUANTITY_EXCEEDED'
        );
      }

      if (seenCodes.has(normalizedCode)) {
        return failure(`商品「${suppliedCode}」重複出現，請合併數量後再提交。`, 'DUPLICATE_ITEM');
      }
      seenCodes.add(normalizedCode);

      const product = productByCode.get(normalizedCode);
      if (!product) {
        return failure(`找不到商品代號「${suppliedCode}」，請確認商品代號。`, 'PRODUCT_NOT_FOUND');
      }
      if (
        product.is_active === false ||
        ['inactive', 'archived', '已下架', '停用'].includes(product.status)
      ) {
        return failure(`商品「${product.product_code}」目前未有供應。`, 'PRODUCT_UNAVAILABLE');
      }

      items.push({
        product_code: product.product_code,
        quantity
      });
    }

    return {
      success: true,
      data: { items },
      message: '落單內容已驗證，尚未建立訂單。'
    };
  } catch (error) {
    console.error('解析 WhatsApp 落單訊息時發生未預期錯誤：', error);
    return failure('解析落單訊息時發生未預期錯誤。', 'PARSER_ERROR');
  }
}

module.exports = {
  MAX_ORDER_QUANTITY,
  parseWhatsAppOrderMessage
};
