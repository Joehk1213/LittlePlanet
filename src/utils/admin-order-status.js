'use strict';

const ORDER_STATUSES = new Set([
  'pending',
  'paid',
  'shipped',
  'picked_up',
  'completed',
  'cancelled',
]);

function normalizeAdminOrderStatus(status) {
  if (status === 'shipping') {
    return 'shipped';
  }
  return ORDER_STATUSES.has(status) ? status : null;
}

async function transitionAdminOrderStatus(supabase, orderId, status) {
  const normalizedStatus = normalizeAdminOrderStatus(status);
  if (!normalizedStatus) {
    return { data: null, error: { code: 'INVALID_STATUS' } };
  }

  const { data, error } = await supabase.rpc('transition_admin_order_status', {
    p_order_id: orderId,
    p_status: normalizedStatus,
  });
  return { data, error, status: normalizedStatus };
}

function respondToStatusTransition(res, data, error) {
  if (error) {
    if (error.code === 'P0002') {
      return res.status(404).json({
        success: false,
        data: null,
        message: '找不到指定訂單。',
      });
    }
    if (['P0001', '55000'].includes(error.code)) {
      return res.status(409).json({
        success: false,
        data: null,
        message: error.code === '55000'
          ? '請先核實訂單已付清及相符的出貨／面交狀態。'
          : '狀態跳轉不合法。',
      });
    }
    return null;
  }
  if (!data || typeof data !== 'object' || typeof data.status !== 'string') {
    return res.status(500).json({
      success: false,
      data: null,
      message: '訂單狀態更新回傳格式無效。',
    });
  }
  return res.json({
    success: true,
    data,
    message: '訂單狀態已更新。',
  });
}

module.exports = {
  ORDER_STATUSES,
  normalizeAdminOrderStatus,
  respondToStatusTransition,
  transitionAdminOrderStatus,
};
