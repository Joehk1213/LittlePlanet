'use strict';

function normalizePhone(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().replace(/^\+/, '');
  return /^\d{8,15}$/.test(normalized) ? normalized : null;
}

module.exports = normalizePhone;
