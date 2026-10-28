'use strict';

const MAX_PRODUCT_ID = 9223372036854775807n;

function normalizeProductId(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const productId = value.trim();
  if (
    productId.length > 19 ||
    !/^[1-9]\d*$/.test(productId) ||
    BigInt(productId) > MAX_PRODUCT_ID
  ) {
    return null;
  }
  return productId;
}

module.exports = normalizeProductId;
