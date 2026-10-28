(function (root) {
  const CONTACT_MEMORY_KEY = 'littleplanet_checkout_profiles';
  const IDEMPOTENCY_KEY = 'lp_last_idem_key';
  const UUID_V4_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function generateIdempotencyKey() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') {
      return root.crypto.randomUUID().toLowerCase();
    }

    let seed = Date.now();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
      const randomValue = (seed + Math.random() * 16) % 16 | 0;
      seed = Math.floor(seed / 16);
      return (character === 'x' ? randomValue : (randomValue & 0x3) | 0x8).toString(16);
    });
  }

  function normalizePhoneForKey(phone) {
    const normalizedPhone = String(phone || '').replace(/\D/g, '');
    return /^\d{8,15}$/.test(normalizedPhone) ? normalizedPhone : null;
  }

  function getIdempotencyKey(phone, storage = root.localStorage) {
    const normalizedPhone = normalizePhoneForKey(phone);
    if (!normalizedPhone) {
      throw new TypeError('熟客電話格式無效。');
    }

    const saved = JSON.parse(storage.getItem(IDEMPOTENCY_KEY) || 'null');
    if (
      saved &&
      saved.phone === normalizedPhone &&
      typeof saved.key === 'string' &&
      UUID_V4_PATTERN.test(saved.key)
    ) {
      return saved.key;
    }

    const key = generateIdempotencyKey();
    storage.setItem(IDEMPOTENCY_KEY, JSON.stringify({
      phone: normalizedPhone,
      key
    }));
    return key;
  }

  function clearIdempotencyKey(phone, key, storage) {
    const normalizedPhone = normalizePhoneForKey(phone);
    const saved = JSON.parse(storage.getItem(IDEMPOTENCY_KEY) || 'null');
    if (saved && saved.phone === normalizedPhone && saved.key === key) {
      storage.removeItem(IDEMPOTENCY_KEY);
    }
  }

  async function submit(payload, storage = root.localStorage) {
    const phone = payload.customer
      ? payload.customer.phone
      : payload.customer_phone;
    const idempotencyKey = payload.idempotency_key || getIdempotencyKey(phone, storage);
    if (typeof idempotencyKey !== 'string' || !UUID_V4_PATTERN.test(idempotencyKey)) {
      throw new TypeError('結帳請求識別碼格式無效。');
    }

    const response = await root.fetch('/api/orders/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ...payload, idempotency_key: idempotencyKey })
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
    if (response.ok && result.success === true && result.data) {
      clearIdempotencyKey(phone, idempotencyKey, storage);
    }
    return { response, result };
  }

  function getContactProfile(phone, storage = root.localStorage) {
    const normalizedPhone = String(phone || '').replace(/\D/g, '');
    if (!/^\d{8,15}$/.test(normalizedPhone)) {
      return null;
    }

    const profiles = JSON.parse(storage.getItem(CONTACT_MEMORY_KEY) || '[]');
    if (!Array.isArray(profiles)) {
      throw new Error('熟客資料格式無效。');
    }
    return profiles.find(profile =>
      profile &&
      profile.phone === normalizedPhone &&
      typeof profile.customer_name === 'string' &&
      typeof profile.shipping_method === 'string' &&
      typeof profile.shipping_address === 'string'
    ) || null;
  }

  function rememberContactProfile(profile, storage = root.localStorage) {
    const phone = String(profile && profile.phone || '').replace(/\D/g, '');
    if (!/^\d{8,15}$/.test(phone)) {
      throw new TypeError('熟客電話格式無效。');
    }
    if (
      typeof profile.customer_name !== 'string' ||
      typeof profile.shipping_method !== 'string' ||
      typeof profile.shipping_address !== 'string'
    ) {
      throw new TypeError('熟客收件資料格式無效。');
    }

    const profiles = JSON.parse(storage.getItem(CONTACT_MEMORY_KEY) || '[]');
    if (!Array.isArray(profiles)) {
      throw new Error('熟客資料格式無效。');
    }
    const savedProfile = {
      phone,
      customer_name: profile.customer_name,
      shipping_method: profile.shipping_method,
      shipping_address: profile.shipping_address,
      updated_at: new Date().toISOString()
    };
    const nextProfiles = profiles.filter(item => !item || item.phone !== phone);
    nextProfiles.unshift(savedProfile);
    storage.setItem(CONTACT_MEMORY_KEY, JSON.stringify(nextProfiles.slice(0, 10)));
    return savedProfile;
  }

  root.LittlePlanetCheckout = Object.freeze({
    submit,
    generateIdempotencyKey,
    getIdempotencyKey,
    getContactProfile,
    rememberContactProfile
  });
})(globalThis.window);
