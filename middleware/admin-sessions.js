'use strict';

const crypto = require('node:crypto');
const express = require('express');

const COOKIE_NAME = 'littleplanet_admin_session';
const DEFAULT_SESSION_TTL_SECONDS = 8 * 60 * 60;
const SESSION_SCOPES = new Set(['shipping', 'orders', 'products', 'analytics', 'inbound', 'reviews']);

function sendError(res, status, message) {
  return res.status(status).json({
    success: false,
    data: null,
    message
  });
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function readCookie(req, cookieName) {
  const header = req.get('cookie');
  if (typeof header !== 'string') {
    return null;
  }

  for (const item of header.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0 || item.slice(0, separator).trim() !== cookieName) {
      continue;
    }
    try {
      return decodeURIComponent(item.slice(separator + 1).trim());
    } catch (error) {
      return null;
    }
  }
  return null;
}

function isSameOriginRequest(req) {
  const origin = req.get('origin');
  if (!origin) {
    return false;
  }

  try {
    return new URL(origin).origin === `${req.protocol}://${req.get('host')}`;
  } catch (error) {
    return false;
  }
}

function createAdminSessions(options = {}) {
  const router = express.Router();
  const sessionSecret = options.sessionSecret;
  const secureCookie = options.secureCookie === true;
  const ttlSeconds = Number.isSafeInteger(options.ttlSeconds) && options.ttlSeconds > 0
    ? options.ttlSeconds
    : DEFAULT_SESSION_TTL_SECONDS;
  const credentials = (options.credentials || [])
    .filter(credential => (
      credential &&
      typeof credential.token === 'string' &&
      credential.token.length >= 32 &&
      !credential.token.startsWith('replace-with-') &&
      Array.isArray(credential.scopes)
    ))
    .map(credential => ({
      token: credential.token,
      scopes: [...new Set(credential.scopes.filter(scope => SESSION_SCOPES.has(scope)))]
    }))
    .filter(credential => credential.scopes.length > 0);

  if (
    !Buffer.isBuffer(sessionSecret) &&
    (typeof sessionSecret !== 'string' || Buffer.byteLength(sessionSecret) < 32)
  ) {
    throw new Error('管理員 session signing secret 必須至少 32 bytes。');
  }

  const signingKey = Buffer.isBuffer(sessionSecret)
    ? sessionSecret
    : Buffer.from(sessionSecret);
  if (signingKey.length < 32) {
    throw new Error('管理員 session signing secret 必須至少 32 bytes。');
  }

  function sign(payload) {
    return crypto.createHmac('sha256', signingKey).update(payload).digest('base64url');
  }

  function createCookieValue(scopes) {
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(JSON.stringify({
      version: 1,
      issuedAt: now,
      expiresAt: now + ttlSeconds,
      scopes
    })).toString('base64url');
    return `${payload}.${sign(payload)}`;
  }

  function getSession(req) {
    const value = readCookie(req, COOKIE_NAME);
    if (typeof value !== 'string') {
      return null;
    }
    const separator = value.lastIndexOf('.');
    if (separator <= 0) {
      return null;
    }

    const payload = value.slice(0, separator);
    const suppliedSignature = value.slice(separator + 1);
    if (!safeEqual(sign(payload), suppliedSignature)) {
      return null;
    }

    try {
      const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      const now = Math.floor(Date.now() / 1000);
      if (
        !session ||
        session.version !== 1 ||
        !Number.isSafeInteger(session.issuedAt) ||
        !Number.isSafeInteger(session.expiresAt) ||
        session.issuedAt > now ||
        session.expiresAt <= now ||
        session.expiresAt - session.issuedAt > ttlSeconds ||
        !Array.isArray(session.scopes) ||
        session.scopes.length === 0 ||
        session.scopes.some(scope => !SESSION_SCOPES.has(scope))
      ) {
        return null;
      }
      return session;
    } catch (error) {
      return null;
    }
  }

  function cookieOptions() {
    return {
      httpOnly: true,
      secure: secureCookie,
      sameSite: 'strict',
      path: '/api',
      maxAge: ttlSeconds * 1000
    };
  }

  function clearCookie(res) {
    res.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      secure: secureCookie,
      sameSite: 'strict',
      path: '/api'
    });
  }

  router.post('/login', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!isSameOriginRequest(req)) {
      return sendError(res, 403, '登入要求必須來自同一網站。');
    }
    if (credentials.length === 0) {
      return sendError(res, 503, '管理員登入尚未設定有效的管理 Token。');
    }

    const token = req.body && !Array.isArray(req.body) && typeof req.body.token === 'string'
      ? req.body.token
      : '';
    if (token.length === 0 || token.length > 512) {
      return sendError(res, 400, '請提供有效的管理員密鑰。');
    }

    const scopes = new Set();
    let matched = false;
    for (const credential of credentials) {
      if (safeEqual(token, credential.token)) {
        matched = true;
        credential.scopes.forEach(scope => scopes.add(scope));
      }
    }

    if (!matched) {
      return sendError(res, 401, '管理員密鑰錯誤或無權限。');
    }

    res.cookie(COOKIE_NAME, createCookieValue([...scopes]), cookieOptions());
    res.set('Cache-Control', 'no-store');
    return res.json({
      success: true,
      data: { authenticated: true, scopes: [...scopes] },
      message: '管理員登入成功。'
    });
  });

  router.get('/session', (req, res) => {
    const session = getSession(req);
    res.set('Cache-Control', 'no-store');
    return res.json({
      success: true,
      data: session
        ? { authenticated: true, scopes: session.scopes }
        : { authenticated: false, scopes: [] },
      message: session ? '管理員 session 有效。' : '尚未登入。'
    });
  });

  router.post('/logout', (req, res) => {
    if (!isSameOriginRequest(req)) {
      return sendError(res, 403, '登出要求必須來自同一網站。');
    }
    clearCookie(res);
    res.set('Cache-Control', 'no-store');
    return res.json({
      success: true,
      data: { authenticated: false },
      message: '已安全登出。'
    });
  });

  function isAuthorized(req, expectedToken, scope) {
    const authorization = req.get('authorization') || '';
    if (authorization.startsWith('Bearer ')) {
      return safeEqual(authorization.slice('Bearer '.length), expectedToken);
    }

    const session = getSession(req);
    if (!session || !session.scopes.includes(scope)) {
      return false;
    }

    return ['GET', 'HEAD', 'OPTIONS'].includes(req.method) || isSameOriginRequest(req);
  }

  function isSessionAuthorized(req, scope) {
    const session = getSession(req);
    if (!session || !session.scopes.includes(scope)) {
      return false;
    }
    return ['GET', 'HEAD', 'OPTIONS'].includes(req.method) || isSameOriginRequest(req);
  }

  return {
    router,
    isAuthorized,
    isSessionAuthorized,
    getSession,
    cookieName: COOKIE_NAME
  };
}

module.exports = createAdminSessions;
