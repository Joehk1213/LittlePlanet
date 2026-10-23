'use strict';

const express = require('express');

const CREDIT_STATUSES = new Set(['normal', 'require_deposit', 'blacklisted']);
const CUSTOMER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

function sendError(res, status, message) {
  return res.status(status).json({
    success: false,
    data: null,
    message
  });
}

function parsePageValue(value, fallback, maximum) {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : null;
}

function createCustomersRouter(supabase, options = {}) {
  const router = express.Router();

  function authorizeCustomers(req, res) {
    if (
      typeof options.isSessionAuthorized !== 'function' ||
      !options.isSessionAuthorized(req, 'customers')
    ) {
      sendError(res, 401, '請先以具備客戶管理權限的管理員 Session 登入。');
      return false;
    }
    if (!supabase || options.serviceRoleAvailable === false) {
      sendError(res, 503, '客戶管理服務尚未設定資料庫服務權限。');
      return false;
    }
    return true;
  }

  router.get('/', async (req, res) => {
    if (!authorizeCustomers(req, res)) {
      return;
    }

    const limit = parsePageValue(req.query.limit, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const offset = parsePageValue(req.query.offset, 0, 2147483647);
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    if (
      limit === null ||
      limit < 1 ||
      offset === null ||
      search.length > 100
    ) {
      return sendError(res, 400, '客戶搜尋或分頁參數無效。');
    }

    try {
      const { data, error } = await supabase.rpc('list_admin_customers', {
        p_search: search || null,
        p_limit: limit,
        p_offset: offset
      });

      if (error) {
        console.error('管理員客戶列表查詢失敗：', error);
        return sendError(res, 500, '讀取客戶列表失敗，請稍後再試。');
      }
      if (!Array.isArray(data)) {
        console.error('管理員客戶列表查詢回傳格式無效：', data);
        return sendError(res, 500, '客戶列表回傳格式無效。');
      }

      return res.json({
        success: true,
        data: {
          customers: data,
          limit,
          offset
        },
        message: '客戶列表載入完成。'
      });
    } catch (error) {
      console.error('讀取管理員客戶列表時發生未預期錯誤：', error);
      return sendError(res, 500, '讀取客戶列表時發生錯誤，請稍後再試。');
    }
  });

  router.patch('/:id/credit-status', async (req, res) => {
    if (!authorizeCustomers(req, res)) {
      return;
    }

    const { id } = req.params;
    const creditStatus = req.body && req.body.credit_status;
    if (!CUSTOMER_ID_PATTERN.test(id)) {
      return sendError(res, 400, '客戶 ID 格式無效。');
    }
    if (typeof creditStatus !== 'string' || !CREDIT_STATUSES.has(creditStatus)) {
      return sendError(res, 400, '信用評級必須是 normal、require_deposit 或 blacklisted。');
    }

    try {
      const { data, error } = await supabase
        .from('customers')
        .update({ credit_status: creditStatus })
        .eq('id', id)
        .select('id, customer_phone, customer_name, credit_status')
        .maybeSingle();

      if (error) {
        console.error('更新客戶信用評級失敗：', error);
        return sendError(res, 500, '更新客戶信用評級失敗，請稍後再試。');
      }
      if (!data) {
        return sendError(res, 404, '找不到指定客戶。');
      }

      return res.json({
        success: true,
        data,
        message: '客戶信用評級已更新。'
      });
    } catch (error) {
      console.error('更新客戶信用評級時發生未預期錯誤：', error);
      return sendError(res, 500, '更新客戶信用評級時發生錯誤，請稍後再試。');
    }
  });

  return router;
}

module.exports = createCustomersRouter;
