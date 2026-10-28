(function (root) {
  async function submit(payload) {
    const response = await root.fetch('/api/orders/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload)
    });
    let result;
    try {
      result = await response.json();
    } catch {
      result = {
        success: false,
        message: '伺服器回應異常，請稍後再試。',
        code: 'SERVER_ERROR'
      };
    }
    return { response, result };
  }

  root.LittlePlanetCheckout = Object.freeze({ submit });
})(globalThis.window);
