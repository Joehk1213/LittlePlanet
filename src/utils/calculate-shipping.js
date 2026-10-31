'use strict';

const MAX_SHIPPING_FEE = 99999999.99;

function reportInsufficientData(logger, reason) {
  if (logger && typeof logger.warn === 'function') {
    logger.warn({ event: 'shipping_fee_data_insufficient', reason }, '資料不足');
  }
}

function normalizeProductId(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) {
    return null;
  }

  try {
    const id = BigInt(text);
    return id >= 4268n && id <= 4294n ? id.toString() : null;
  } catch {
    return null;
  }
}

function validateShippingData(input = {}) {
  let pickupLocationId = null;
  if (input.pickup_location_id !== undefined && input.pickup_location_id !== null) {
    if (typeof input.pickup_location_id !== 'string') {
      return { error: 'pickup_location_id 必須是文字。' };
    }
    pickupLocationId = input.pickup_location_id.trim() || null;
    if (
      pickupLocationId &&
      (pickupLocationId.length > 100 || /[\u0000-\u001f\u007f]/.test(pickupLocationId))
    ) {
      return { error: 'pickup_location_id 格式無效。' };
    }
  }

  let pickupSlot = null;
  if (input.pickup_slot !== undefined && input.pickup_slot !== null && input.pickup_slot !== '') {
    if (
      typeof input.pickup_slot !== 'string' ||
      !/(?:Z|[+-]\d{2}:\d{2})$/i.test(input.pickup_slot) ||
      !Number.isFinite(Date.parse(input.pickup_slot))
    ) {
      return { error: 'pickup_slot 必須是包含時區的有效日期時間。' };
    }
    pickupSlot = new Date(input.pickup_slot).toISOString();
    if (!pickupLocationId) {
      return { error: '設定 pickup_slot 時必須同時提供 pickup_location_id。' };
    }
  }

  let shippingFee;
  if (input.shipping_fee !== undefined && input.shipping_fee !== null) {
    if (
      typeof input.shipping_fee !== 'number' ||
      !Number.isFinite(input.shipping_fee) ||
      input.shipping_fee < 0 ||
      input.shipping_fee > MAX_SHIPPING_FEE ||
      Math.abs(input.shipping_fee * 100 - Math.round(input.shipping_fee * 100)) > 1e-7
    ) {
      return { error: 'shipping_fee 必須是大於或等於 0 的有效金額。' };
    }
    shippingFee = input.shipping_fee;
  }

  return {
    values: {
      pickup_location_id: pickupLocationId,
      pickup_slot: pickupSlot,
      shipping_fee: shippingFee,
    },
  };
}

function calculateShippingFee(items, pickupLocationId, csvCatalog, logger) {
  if (!Array.isArray(items) || items.length === 0) {
    reportInsufficientData(logger, 'invalid_items');
    return null;
  }

  if (pickupLocationId) {
    return 0;
  }

  if (
    !csvCatalog ||
    csvCatalog.missing ||
    !Array.isArray(csvCatalog.headers) ||
    !csvCatalog.headers.includes('weight') ||
    !Array.isArray(csvCatalog.records)
  ) {
    reportInsufficientData(logger, csvCatalog && csvCatalog.missing ? 'catalog_missing' : 'weight_column_missing');
    return null;
  }

  const products = new Map();
  for (const product of csvCatalog.records) {
    const id = normalizeProductId(product.id);
    if (!id || products.has(id)) {
      reportInsufficientData(logger, 'invalid_or_duplicate_product_id');
      return null;
    }
    products.set(id, product);
  }

  let totalWeight = 0;
  for (const item of items) {
    const id = normalizeProductId(item.product_id);
    const quantity = Number(item.quantity ?? item.qty);
    const product = id && products.get(id);
    const weight = product ? Number(product.weight) : NaN;
    if (
      !product ||
      !Number.isSafeInteger(quantity) ||
      quantity <= 0 ||
      !Number.isFinite(weight) ||
      weight <= 0
    ) {
      reportInsufficientData(logger, 'product_weight_missing_or_invalid');
      return null;
    }
    totalWeight += quantity * weight;
  }

  if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
    reportInsufficientData(logger, 'total_weight_invalid');
    return null;
  }
  if (totalWeight <= 5) {
    return 30;
  }
  if (totalWeight <= 10) {
    return 50;
  }
  return 80;
}

module.exports = {
  calculateShippingFee,
  normalizeProductId,
  validateShippingData,
};
