'use strict';

const pino = require('pino');
const normalizePhone = require('./normalize-phone');

const OPTIONAL_SHIPPING_FIELDS = 'shipping_fee,pickup_location_id';
const BASE_SHIPPING_FIELDS = 'order_number,customer_phone,shipping_method,tracking_number';

function orderNumber(order) {
  return typeof order.order_number === 'string' && order.order_number.trim()
    ? order.order_number.trim()
    : '資料不足';
}

function buildShippedMessage(order = {}) {
  const rawShippingFee = order.shipping_fee;
  const parsedShippingFee =
    (typeof rawShippingFee === 'number' ||
      (typeof rawShippingFee === 'string' && rawShippingFee.trim() !== ''))
      ? Number(rawShippingFee)
      : NaN;
  const pickupLocation = typeof order.pickup_location_id === 'string' &&
    order.pickup_location_id.trim()
    ? order.pickup_location_id.trim()
    : ['自取', '面交'].includes(order.shipping_method)
      ? `${order.shipping_method}（地點資料不足）`
      : '送貨';
  const shippingFee = Number.isFinite(parsedShippingFee) && parsedShippingFee >= 0
    ? parsedShippingFee.toFixed(2)
    : '資料不足';
  const tracking = typeof order.tracking_number === 'string' && order.tracking_number.trim()
    ? order.tracking_number.trim()
    : '未提供';

  return [
    `LittlePlanet 訂單 ${orderNumber(order)} 已出貨！`,
    `自取／送貨：${pickupLocation}`,
    `運費：HK$${shippingFee}`,
    `追蹤：${tracking}`,
  ].join('\n');
}

function buildPaidReminderMessage(order = {}) {
  return [
    `LittlePlanet 訂單 ${orderNumber(order)} 已付清。`,
    '請回覆確認取貨安排；如尚未收到到貨通知，請等候通知。',
    '如已完成取貨，請忽略此提醒。',
  ].join('\n');
}

function buildUnpaidReminderMessage(order = {}) {
  return [
    `LittlePlanet 訂單 ${orderNumber(order)} 尚未付款。`,
    '貨到後可安排付款；出貨前需確認付清。',
    '如已付款，請忽略此提醒。',
  ].join('\n');
}

function getLogger(logger) {
  return logger && typeof logger.info === 'function' &&
    typeof logger.warn === 'function' &&
    typeof logger.error === 'function'
    ? logger
    : pino({ level: 'info' });
}

function safeErrorCode(error) {
  return error && typeof error.code === 'string' && /^[A-Z0-9_-]{1,32}$/i.test(error.code)
    ? error.code
    : 'UNKNOWN';
}

function redactPhone(message, phone) {
  let preview = message.slice(0, 160);
  const variants = [`+${phone}`, phone];
  for (const variant of variants) {
    preview = preview.replaceAll(variant, '[電話已隱藏]');
  }
  return preview;
}

function hasWhatsAppToken(env) {
  return [
    env.WHATSAPP_TOKEN,
    env.WHATSAPP_API_TOKEN,
    env.WHATSAPP_ACCESS_TOKEN,
  ].some(value => typeof value === 'string' && value.trim().length > 0);
}

async function sendWhatsAppNotification({
  phone,
  message,
  dryRun = true,
  sender,
  serviceRoleAvailable = false,
  logger,
  env = process.env,
} = {}) {
  const log = getLogger(logger);
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    log.warn({ event: 'whatsapp_notification_rejected', reason: 'invalid_phone' }, 'WhatsApp notification skipped');
    return { ok: false, dryRun: true, phoneSuffix: null, messagePreview: '' };
  }
  if (typeof message !== 'string' || message.trim() === '' || message.length > 4096) {
    log.warn(
      { event: 'whatsapp_notification_rejected', phone_suffix: normalizedPhone.slice(-4), reason: 'invalid_message' },
      'WhatsApp notification skipped'
    );
    return {
      ok: false,
      dryRun: true,
      phoneSuffix: normalizedPhone.slice(-4),
      messagePreview: '',
    };
  }

  const phoneSuffix = normalizedPhone.slice(-4);
  const messagePreview = redactPhone(message.trim(), normalizedPhone);
  const tokenAvailable = hasWhatsAppToken(env);
  if (dryRun || env.NODE_ENV === 'test' || !tokenAvailable) {
    log.info(
      { event: 'whatsapp_notification_dry_run', phone_suffix: phoneSuffix },
      'WhatsApp notification was not sent'
    );
    return { ok: true, dryRun: true, phoneSuffix, messagePreview };
  }

  if (
    env.NODE_ENV !== 'production' ||
    env.WHATSAPP_ENABLED !== 'true' ||
    serviceRoleAvailable !== true
  ) {
    throw new Error('WhatsApp real send disabled in Development.');
  }
  if (typeof sender !== 'function') {
    throw new Error('WhatsApp real send disabled: sender is not configured.');
  }

  try {
    await sender({ to: normalizedPhone, text: message.trim() });
    log.info(
      { event: 'whatsapp_notification_sent', phone_suffix: phoneSuffix },
      'WhatsApp notification sent'
    );
    return { ok: true, dryRun: false, phoneSuffix, messagePreview };
  } catch (error) {
    log.error(
      {
        event: 'whatsapp_notification_failed',
        phone_suffix: phoneSuffix,
        code: safeErrorCode(error),
      },
      'WhatsApp notification failed'
    );
    throw new Error('WhatsApp notification failed.', { cause: error });
  }
}

async function notifyShippedOrder({
  supabase,
  orderId,
  logger,
  sender,
  serviceRoleAvailable = false,
  notifier = sendWhatsAppNotification,
  env = process.env,
} = {}) {
  const log = getLogger(logger);
  try {
    if (!supabase || typeof supabase.from !== 'function') {
      throw new Error('Order notification database client unavailable.');
    }

    let response = await supabase
      .from('orders')
      .select(`${BASE_SHIPPING_FIELDS},${OPTIONAL_SHIPPING_FIELDS}`)
      .eq('order_id', orderId)
      .maybeSingle();

    if (response.error && response.error.code === '42703') {
      response = await supabase
        .from('orders')
        .select(BASE_SHIPPING_FIELDS)
        .eq('order_id', orderId)
        .maybeSingle();
      if (!response.error && response.data) {
        response.data = {
          ...response.data,
          shipping_fee: null,
          pickup_location_id: null,
        };
        log.warn(
          { event: 'whatsapp_shipping_fields_unavailable', code: '42703' },
          'Shipping notification uses incomplete optional order fields'
        );
      }
    }
    if (response.error) {
      log.error(
        { event: 'whatsapp_order_lookup_failed', code: safeErrorCode(response.error) },
        'Shipping notification order lookup failed'
      );
      return { ok: false, dryRun: true, phoneSuffix: null, messagePreview: '' };
    }
    if (!response.data) {
      log.warn({ event: 'whatsapp_order_lookup_empty' }, 'Shipping notification skipped');
      return { ok: false, dryRun: true, phoneSuffix: null, messagePreview: '' };
    }

    return await notifier({
      phone: response.data.customer_phone,
      message: buildShippedMessage(response.data),
      dryRun: env.NODE_ENV !== 'production',
      sender,
      serviceRoleAvailable,
      logger: log,
      env,
    });
  } catch (error) {
    log.error(
      { event: 'whatsapp_order_notification_failed', code: safeErrorCode(error) },
      'Shipping notification failed without affecting order status'
    );
    return { ok: false, dryRun: true, phoneSuffix: null, messagePreview: '' };
  }
}

module.exports = {
  buildPaidReminderMessage,
  buildShippedMessage,
  buildUnpaidReminderMessage,
  notifyShippedOrder,
  sendWhatsAppNotification,
};
