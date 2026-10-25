'use strict';

function createApiProtection(options = {}) {
  const windowMs =
    Number.isSafeInteger(options.windowMs) && options.windowMs > 0
      ? options.windowMs
      : 15 * 60 * 1000;
  const maxRequests =
    Number.isSafeInteger(options.maxRequests) && options.maxRequests > 0
      ? options.maxRequests
      : 120;
  const maxEntries =
    Number.isSafeInteger(options.maxEntries) && options.maxEntries > 0 ? options.maxEntries : 10000;

  const allowedOrigins = new Set(options.allowedOrigins || []);
  const requests = new Map();

  return function protectApi(req, res, next) {
    const origin = req.get('origin');
    if (origin) {
      let parsedOrigin;
      try {
        parsedOrigin = new URL(origin).origin;
      } catch (error) {
        return res.status(403).json({
          success: false,
          data: null,
          message: '不允許此來源存取 API。',
        });
      }

      const requestOrigin = `${req.protocol}://${req.get('host')}`;

      // 檢查是否為同源、是否在手動白名單中、或是來自 devtunnels / localhost 開發環境
      const isDevTunnel =
        parsedOrigin.endsWith('.devtunnels.ms') ||
        parsedOrigin.includes('localhost') ||
        parsedOrigin.includes('127.0.0.1');

      if (parsedOrigin !== requestOrigin && !allowedOrigins.has(parsedOrigin) && !isDevTunnel) {
        return res.status(403).json({
          success: false,
          data: null,
          message: '不允許此來源存取 API。',
        });
      }

      res.set('Access-Control-Allow-Origin', parsedOrigin);
      res.vary('Origin');
      res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Hub-Signature-256');
      res.set('Access-Control-Max-Age', '600');
    }

    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }

    const now = Date.now();
    const ip = typeof req.ip === 'string' && req.ip.length > 0 ? req.ip : req.socket.remoteAddress;
    let entry = requests.get(ip);

    if (!entry || entry.resetAt <= now) {
      if (!entry && requests.size >= maxEntries) {
        for (const [key, value] of requests) {
          if (value.resetAt <= now) {
            requests.delete(key);
          }
        }
      }

      if (!entry && requests.size >= maxEntries) {
        return res.status(503).json({
          success: false,
          data: null,
          message: 'API 暫時繁忙，請稍後再試。',
        });
      }

      entry = { count: 0, resetAt: now + windowMs };
      requests.set(ip, entry);
    }

    entry.count += 1;
    const remaining = Math.max(0, maxRequests - entry.count);
    const resetSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    res.set('RateLimit-Limit', String(maxRequests));
    res.set('RateLimit-Remaining', String(remaining));
    res.set('RateLimit-Reset', String(resetSeconds));

    if (entry.count > maxRequests) {
      res.set('Retry-After', String(resetSeconds));
      return res.status(429).json({
        success: false,
        data: null,
        message: '請求次數過多，請稍後再試。',
      });
    }

    return next();
  };
}

module.exports = createApiProtection;
