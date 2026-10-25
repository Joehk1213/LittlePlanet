'use strict';

function sendError(res, status, message) {
  return res.status(status).json({
    success: false,
    data: null,
    message,
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
    ...(environment === 'production' ? {} : { stack: error.stack }),
  });

  if (error.type === 'entity.parse.failed') {
    return sendError(res, 400, '請求 JSON 格式無效。');
  }
  if (error.type === 'entity.too.large') {
    return sendError(res, 413, '請求資料超出大小限制。');
  }
  if (error.type === 'encoding.unsupported') {
    return sendError(res, 415, '不支援此請求內容編碼。');
  }
  if (error.type === 'request.aborted') {
    return sendError(res, 400, '請求資料未能完整接收。');
  }
  if (Number.isInteger(error.status) && error.status >= 400 && error.status < 500) {
    return sendError(res, error.status, '請求無效或不受支援。');
  }

  return sendError(res, 500, '伺服器發生錯誤，請稍後再試。');
}

module.exports = {
  apiNotFound,
  errorHandler,
};
