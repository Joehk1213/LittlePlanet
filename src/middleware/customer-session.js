'use strict';

const crypto = require('node:crypto');

const COOKIE_NAME = 'littleplanet_customer_session';
const SESSION_TTL_SECONDS = 24 * 60 * 60;

function readCookie(req, name) {
  const header = req.get('cookie');
  if (typeof header !== 'string') {
    return null;
  }
  for (const item of header.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0 || item.slice(0, separator).trim() !== name) {
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

function createCustomerSession(phone, secret) {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      version: 1,
      phone,
      issuedAt: now,
      expiresAt: now + SESSION_TTL_SECONDS,
    })
  ).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function getCustomerSession(req, secret) {
  if (Buffer.byteLength(secret) < 32 || secret.startsWith('replace-with-')) {
    return null;
  }
  const cookie = readCookie(req, COOKIE_NAME);
  if (typeof cookie !== 'string') {
    return null;
  }
  const separator = cookie.lastIndexOf('.');
  if (separator < 1) {
    return null;
  }
  const payload = cookie.slice(0, separator);
  const signature = cookie.slice(separator + 1);
  const expectedSignature = crypto.createHmac('sha256', secret).update(payload).digest();
  const suppliedSignature = Buffer.from(signature, 'base64url');
  if (
    expectedSignature.length !== suppliedSignature.length ||
    !crypto.timingSafeEqual(expectedSignature, suppliedSignature)
  ) {
    return null;
  }
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);

    // 💡 修正：同時允許 8-15 位純數字電話，或者包含 |google| 的 Google 身份字串
    const isPhoneValid = /^\d{8,15}$/.test(session.phone);
    const isGoogleValid = typeof session.phone === 'string' && session.phone.includes('|google|');

    if (
      !session ||
      session.version !== 1 ||
      typeof session.phone !== 'string' ||
      (!isPhoneValid && !isGoogleValid) ||
      !Number.isSafeInteger(session.issuedAt) ||
      !Number.isSafeInteger(session.expiresAt) ||
      session.issuedAt > now ||
      session.expiresAt <= now ||
      session.expiresAt - session.issuedAt > SESSION_TTL_SECONDS
    ) {
      return null;
    }
    return session;
  } catch (error) {
    return null;
  }
}

function setCustomerCookie(res, value, options = {}) {
  const maxAge = Number.isSafeInteger(options.maxAge) ? options.maxAge : SESSION_TTL_SECONDS;
  res.append(
    'Set-Cookie',
    [
      `${COOKIE_NAME}=${encodeURIComponent(value)}`,
      'Path=/api/customer',
      `Max-Age=${maxAge}`,
      'HttpOnly',
      'SameSite=Strict',
      options.secure === true ? 'Secure' : '',
    ]
      .filter(Boolean)
      .join('; ')
  );
}

module.exports = {
  COOKIE_NAME,
  SESSION_TTL_SECONDS,
  createCustomerSession,
  getCustomerSession,
  setCustomerCookie,
};
