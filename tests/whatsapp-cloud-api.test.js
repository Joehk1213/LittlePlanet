'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createWhatsAppSender = require('../utils/whatsapp-cloud-api');

const CONFIG = {
  apiVersion: 'v23.0',
  phoneNumberId: '123456789012345',
  accessToken: 'secure-test-token'
};

test('returns no sender when WhatsApp Cloud API is not configured', () => {
  assert.equal(createWhatsAppSender({}), null);
  assert.equal(createWhatsAppSender({
    apiVersion: 'vXX.0',
    phoneNumberId: 'your-phone-number-id',
    accessToken: 'your-access-token'
  }), null);
});

test('rejects partial or malformed WhatsApp Cloud API configuration', () => {
  assert.throws(() => createWhatsAppSender({
    ...CONFIG,
    accessToken: ''
  }), /設定不完整/);
  assert.throws(() => createWhatsAppSender({
    ...CONFIG,
    apiVersion: '23'
  }), /版本或電話號碼 ID 格式無效/);
});

test('sends a text message using the configured Cloud API and confirms delivery', async () => {
  let request;
  const sendWhatsApp = createWhatsAppSender({
    ...CONFIG,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        async json() {
          return { messages: [{ id: 'wamid.outbound-1' }] };
        }
      };
    }
  });

  const result = await sendWhatsApp({ to: '85291234567', text: '訂單預覽' });
  assert.equal(result, 'wamid.outbound-1');
  assert.equal(
    request.url,
    'https://graph.facebook.com/v23.0/123456789012345/messages'
  );
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.Authorization, 'Bearer secure-test-token');
  assert.deepEqual(JSON.parse(request.options.body), {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: '85291234567',
    type: 'text',
    text: { preview_url: false, body: '訂單預覽' }
  });
});

test('rejects invalid recipient, empty text, and provider failures explicitly', async () => {
  const sendWhatsApp = createWhatsAppSender({
    ...CONFIG,
    fetchImpl: async () => ({
      ok: false,
      status: 401
    })
  });

  await assert.rejects(
    sendWhatsApp({ to: '+85291234567', text: '測試' }),
    /收件電話格式無效/
  );
  await assert.rejects(
    sendWhatsApp({ to: '85291234567', text: '' }),
    /訊息內容無效/
  );
  await assert.rejects(
    sendWhatsApp({ to: '85291234567', text: '測試' }),
    /HTTP 401/
  );
});

test('downloads only allowlisted WhatsApp media URLs and enforces the image-size limit', async () => {
  const calls = [];
  const sendWhatsApp = createWhatsAppSender({
    ...CONFIG,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (String(url).startsWith('https://graph.facebook.com/')) {
        return new Response(JSON.stringify({
          url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/media-1',
          mime_type: 'image/png',
          file_size: PNG.length
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(PNG, {
        status: 200,
        headers: { 'Content-Type': 'image/png', 'Content-Length': String(PNG.length) }
      });
    }
  });

  const result = await sendWhatsApp.downloadMedia('media-1');
  assert.deepEqual(result, { media: PNG, mimeType: 'image/png' });
  assert.equal(calls.length, 2);
  assert.ok(calls[0].options.headers.Authorization.startsWith('Bearer '));

  const unsafeSender = createWhatsAppSender({
    ...CONFIG,
    fetchImpl: async () => new Response(JSON.stringify({
      url: 'https://127.0.0.1/internal',
      mime_type: 'image/png',
      file_size: PNG.length
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  });
  await assert.rejects(unsafeSender.downloadMedia('media-1'), /下載網址無效/);

  const oversizedSender = createWhatsAppSender({
    ...CONFIG,
    fetchImpl: async () => new Response(JSON.stringify({
      url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/large',
      mime_type: 'image/png',
      file_size: 5 * 1024 * 1024 + 1
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  });
  await assert.rejects(oversizedSender.downloadMedia('media-large'), /不可超過 5 MB/);
});

test('uploads and sends a WhatsApp image with the provided caption', async () => {
  const requests = [];
  const sendWhatsApp = createWhatsAppSender({
    ...CONFIG,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (String(url).endsWith('/media')) {
        return new Response(JSON.stringify({ id: 'media-uploaded' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.image-1' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  });

  const messageId = await sendWhatsApp.sendImage({
    to: '85291234567',
    media: PNG,
    mimeType: 'image/png',
    caption: '待審核付款憑證'
  });
  assert.equal(messageId, 'wamid.image-1');
  assert.equal(requests.length, 2);
  assert.ok(requests[0].options.body instanceof FormData);
  assert.deepEqual(JSON.parse(requests[1].options.body).image, {
    id: 'media-uploaded',
    caption: '待審核付款憑證'
  });
});

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
