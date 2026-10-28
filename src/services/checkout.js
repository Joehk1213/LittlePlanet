(function (root) {
  const CONTACT_MEMORY_KEY = 'littleplanet_checkout_profiles';

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
    getContactProfile,
    rememberContactProfile
  });
})(globalThis.window);
