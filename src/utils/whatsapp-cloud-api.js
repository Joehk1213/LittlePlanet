'use strict';

function hasRealConfiguration(value) {
  return (
    typeof value === 'string' &&
    value.trim() !== '' &&
    !/^(?:your-|replace-with-|vXX)/i.test(value.trim())
  );
}

function createWhatsAppSender(options = {}) {
  const apiVersion = options.apiVersion;
  const phoneNumberId = options.phoneNumberId;
  const accessToken = options.accessToken;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const configuredValues = [apiVersion, phoneNumberId, accessToken];
  const configuredCount = configuredValues.filter(hasRealConfiguration).length;

  if (configuredCount === 0) {
    return null;
  }
  if (configuredCount !== configuredValues.length) {
    throw new Error('WhatsApp Cloud API 設定不完整，請檢查版本、電話號碼 ID 及 API Token。');
  }
  if (!/^v\d+\.\d+$/.test(apiVersion) || !/^\d+$/.test(phoneNumberId)) {
    throw new Error('WhatsApp Cloud API 版本或電話號碼 ID 格式無效。');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('目前 Node.js 環境未提供可用的 fetch。');
  }

  return async function sendWhatsApp({ to, text }) {
    if (typeof to !== 'string' || !/^[0-9]{8,15}$/.test(to)) {
      throw new Error('WhatsApp 收件電話格式無效。');
    }
    if (typeof text !== 'string' || text.trim() === '' || text.length > 4096) {
      throw new Error('WhatsApp 訊息內容無效。');
    }

    const response = await fetchImpl(
      `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'text',
          text: { preview_url: false, body: text },
        }),
      }
    );

    if (!response || response.ok !== true) {
      const status = response && Number.isInteger(response.status) ? response.status : 'unknown';
      throw new Error(`WhatsApp Cloud API 發送失敗（HTTP ${status}）。`);
    }

    let result;
    try {
      result = await response.json();
    } catch (error) {
      throw new Error('WhatsApp Cloud API 回應格式無效。', { cause: error });
    }
    if (!result || !Array.isArray(result.messages) || typeof result.messages[0]?.id !== 'string') {
      throw new Error('WhatsApp Cloud API 未確認訊息已接收。');
    }
    return result.messages[0].id;
  };
}

function parseJsonResponse(response, failureMessage) {
  return response.json().catch((error) => {
    throw new Error(failureMessage, { cause: error });
  });
}

function isAllowedMediaUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.port &&
      !url.username &&
      !url.password &&
      ['graph.facebook.com', 'lookaside.fbsbx.com', 'lookaside.facebook.com'].includes(url.hostname)
    );
  } catch (error) {
    return false;
  }
}

function createMediaMethods({ apiVersion, phoneNumberId, accessToken, fetchImpl }) {
  async function downloadMedia(mediaId) {
    if (typeof mediaId !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(mediaId)) {
      throw new Error('WhatsApp 媒體 ID 格式無效。');
    }

    const metadataResponse = await fetchImpl(
      `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(mediaId)}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        redirect: 'error',
      }
    );
    if (!metadataResponse || metadataResponse.ok !== true) {
      const status =
        metadataResponse && Number.isInteger(metadataResponse.status)
          ? metadataResponse.status
          : 'unknown';
      throw new Error(`WhatsApp 媒體資料讀取失敗（HTTP ${status}）。`);
    }

    const metadata = await parseJsonResponse(metadataResponse, 'WhatsApp 媒體資料格式無效。');
    if (!metadata || typeof metadata.url !== 'string' || !isAllowedMediaUrl(metadata.url)) {
      throw new Error('WhatsApp 媒體下載網址無效。');
    }
    if (
      typeof metadata.mime_type !== 'string' ||
      !['image/jpeg', 'image/png', 'image/webp'].includes(metadata.mime_type.toLowerCase())
    ) {
      throw new Error('只接受 JPG、PNG 或 WEBP 付款憑證。');
    }
    if (Number(metadata.file_size) > 5 * 1024 * 1024) {
      throw new Error('付款憑證圖片不可超過 5 MB。');
    }

    const mediaResponse = await fetchImpl(metadata.url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      redirect: 'error',
    });
    if (!mediaResponse || mediaResponse.ok !== true) {
      const status =
        mediaResponse && Number.isInteger(mediaResponse.status) ? mediaResponse.status : 'unknown';
      throw new Error(`WhatsApp 付款憑證下載失敗（HTTP ${status}）。`);
    }
    const contentType = (mediaResponse.headers.get('content-type') || '')
      .split(';', 1)[0]
      .trim()
      .toLowerCase();
    const contentLength = Number(mediaResponse.headers.get('content-length'));
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(contentType) ||
      (Number.isFinite(contentLength) && contentLength > 5 * 1024 * 1024)
    ) {
      throw new Error('WhatsApp 下載的付款憑證格式或大小無效。');
    }

    let media;
    if (mediaResponse.body && typeof mediaResponse.body.getReader === 'function') {
      const reader = mediaResponse.body.getReader();
      const chunks = [];
      let totalBytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          totalBytes += value.byteLength;
          if (totalBytes > 5 * 1024 * 1024) {
            await reader.cancel();
            throw new Error('付款憑證圖片不可超過 5 MB。');
          }
          chunks.push(Buffer.from(value));
        }
      } finally {
        reader.releaseLock();
      }
      media = Buffer.concat(chunks, totalBytes);
    } else {
      media = Buffer.from(await mediaResponse.arrayBuffer());
      if (media.length > 5 * 1024 * 1024) {
        throw new Error('付款憑證圖片不可超過 5 MB。');
      }
    }

    if (media.length === 0) {
      throw new Error('WhatsApp 下載的付款憑證圖片為空。');
    }
    return { media, mimeType: contentType };
  }

  async function sendImage({ to, media, mimeType, caption }) {
    if (
      typeof to !== 'string' ||
      !/^[0-9]{8,15}$/.test(to) ||
      !Buffer.isBuffer(media) ||
      media.length === 0 ||
      media.length > 5 * 1024 * 1024 ||
      !['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)
    ) {
      throw new Error('WhatsApp 圖片收件人或媒體資料無效。');
    }
    if (typeof Blob !== 'function' || typeof FormData !== 'function') {
      throw new Error('目前 Node.js 環境未提供 WhatsApp 圖片上傳所需功能。');
    }

    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', mimeType);
    form.append('file', new Blob([media], { type: mimeType }), 'payment-proof');
    const uploadResponse = await fetchImpl(
      `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/media`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      }
    );
    if (!uploadResponse || uploadResponse.ok !== true) {
      const status =
        uploadResponse && Number.isInteger(uploadResponse.status)
          ? uploadResponse.status
          : 'unknown';
      throw new Error(`WhatsApp 圖片上傳失敗（HTTP ${status}）。`);
    }
    const uploaded = await parseJsonResponse(uploadResponse, 'WhatsApp 圖片上傳回應格式無效。');
    if (!uploaded || typeof uploaded.id !== 'string' || uploaded.id.length === 0) {
      throw new Error('WhatsApp 未確認圖片已上傳。');
    }

    const imageMessage = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'image',
      image: { id: uploaded.id },
    };
    if (typeof caption === 'string' && caption.trim()) {
      imageMessage.image.caption = caption.slice(0, 1024);
    }
    const sendResponse = await fetchImpl(
      `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(imageMessage),
      }
    );
    if (!sendResponse || sendResponse.ok !== true) {
      const status =
        sendResponse && Number.isInteger(sendResponse.status) ? sendResponse.status : 'unknown';
      throw new Error(`WhatsApp 收據轉發失敗（HTTP ${status}）。`);
    }
    const result = await parseJsonResponse(sendResponse, 'WhatsApp 收據轉發回應格式無效。');
    if (!result || !Array.isArray(result.messages) || typeof result.messages[0]?.id !== 'string') {
      throw new Error('WhatsApp 未確認收據已轉發。');
    }
    return result.messages[0].id;
  }

  return { downloadMedia, sendImage };
}

const createConfiguredSender = createWhatsAppSender;
module.exports = function createWhatsAppSenderWithMedia(options = {}) {
  const sender = createConfiguredSender(options);
  if (!sender) {
    return null;
  }
  const mediaMethods = createMediaMethods({
    apiVersion: options.apiVersion,
    phoneNumberId: options.phoneNumberId,
    accessToken: options.accessToken,
    fetchImpl: options.fetchImpl || globalThis.fetch,
  });
  sender.downloadMedia = mediaMethods.downloadMedia;
  sender.sendImage = mediaMethods.sendImage;
  return sender;
};
