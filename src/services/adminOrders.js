(function (root) {
  const ORDER_STATUSES = new Set([
    'pending',
    'paid',
    'shipped',
    'picked_up',
    'completed',
    'cancelled'
  ]);
  const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  async function send(url, options = {}) {
    const response = await root.fetch(url, {
      ...options,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(options.headers || {})
      }
    });
    let result;
    try {
      result = await response.json();
    } catch {
      result = {
        success: false,
        data: null,
        message: '伺服器回應異常，請稍後再試。'
      };
    }
    return { response, result };
  }

  function listOrders(filters = {}) {
    const query = new URLSearchParams();
    for (const key of ['phone', 'status', 'from', 'to', 'limit', 'offset']) {
      const value = filters[key];
      if (value !== undefined && value !== null && value !== '') {
        query.set(key, String(value));
      }
    }
    const suffix = query.toString();
    return send(`/api/admin/orders${suffix ? `?${suffix}` : ''}`);
  }

  function updateOrderStatus(orderId, status) {
    if (typeof orderId !== 'string' || !UUID_PATTERN.test(orderId)) {
      throw new TypeError('訂單編號必須是有效的 UUID。');
    }
    if (!ORDER_STATUSES.has(status)) {
      throw new TypeError('訂單狀態無效。');
    }
    return send(`/api/admin/orders/${encodeURIComponent(orderId)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
  }

  root.LittlePlanetAdminOrders = Object.freeze({
    listOrders,
    updateOrderStatus
  });
})(globalThis.window);
