'use strict';

function sendError(res, status, message) {
  return res.status(status).json({
    success: false,
    data: null,
    message
  });
}

function apiNotFound(req, res) {
  return sendError(res, 404, '找不到指定 API 路徑。');
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  const environment = req.app.get('env');
  console.error('處理 HTTP 請求時發生錯誤：', {
    method: req.method,
    path: req.path,
    message: error.message,
    ...(environment === 'production' ? {} : { stack: error.stack })
  });

  if (error.type === 'entity.parse.failed') {
    return sendError(res, 400, '請求 JSON 格式無效。');
  }
  if (error.type === 'entity.too.large') {
    return sendError(res, 413, '請求資料超出大小限制。');
  }

  return sendError(res, 500, '伺服器發生錯誤，請稍後再試。');
}

module.exports = {
  apiNotFound,
  errorHandler
};
