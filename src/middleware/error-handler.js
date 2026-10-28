'use strict';

function sendError(res, status, message, code) {
  return res.status(status).json({
    success: false,
    data: null,
    message,
    error: message,
    code,
  });
}

function apiNotFound(req, res) {
  return sendError(res, 404, '找不到指定 API 路徑。', 'API_NOT_FOUND');
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  if (error.type === 'entity.parse.failed') {
    req.log.error({ code: 'INVALID_JSON' }, 'Request failed');
    return sendError(res, 400, '請求 JSON 格式無效。', 'INVALID_JSON');
  }
  if (error.type === 'entity.too.large') {
    req.log.error({ code: 'REQUEST_TOO_LARGE' }, 'Request failed');
    return sendError(res, 413, '請求資料超出大小限制。', 'REQUEST_TOO_LARGE');
  }
  if (error.type === 'encoding.unsupported') {
    req.log.error({ code: 'UNSUPPORTED_ENCODING' }, 'Request failed');
    return sendError(res, 415, '不支援此請求內容編碼。', 'UNSUPPORTED_ENCODING');
  }
  if (error.type === 'request.aborted') {
    req.log.error({ code: 'REQUEST_ABORTED' }, 'Request failed');
    return sendError(res, 400, '請求資料未能完整接收。', 'REQUEST_ABORTED');
  }
  if (Number.isInteger(error.status) && error.status >= 400 && error.status < 500) {
    req.log.error({ code: 'REQUEST_REJECTED' }, 'Request failed');
    return sendError(res, error.status, '請求無效或不受支援。', 'REQUEST_REJECTED');
  }

  req.log.error({ code: 'INTERNAL_SERVER_ERROR' }, 'Request failed');
  return sendError(res, 500, '伺服器發生錯誤，請稍後再試。', 'INTERNAL_SERVER_ERROR');
}

module.exports = {
  apiNotFound,
  errorHandler,
};
