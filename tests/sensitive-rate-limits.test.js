'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const createSensitiveRateLimiters = require('../middleware/sensitive-rate-limits');

async function withServer(app, run) {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
}

test('sensitive checkout limiter returns a structured 429 response', async () => {
  const app = express();
  app.set('trust proxy', false);
  const limiters = createSensitiveRateLimiters({ windowMs: 60000, checkoutMax: 1 });
  app.post('/api/orders', limiters.checkout, (req, res) => {
    res.json({ success: true, data: null, message: 'ok' });
  });

  await withServer(app, async baseUrl => {
    const url = `${baseUrl}/api/orders`;
    const first = await fetch(url, { method: 'POST' });
    const second = await fetch(url, { method: 'POST' });
    const body = await second.json();
    assert.equal(first.status, 200);
    assert.equal(second.status, 429);
    assert.equal(body.success, false);
    assert.equal(body.data, null);
    assert.equal(typeof body.message, 'string');
    assert.notEqual(second.headers.get('retry-after'), null);
  });
});

test('customer review limiter returns the standard structured 429 response', async () => {
  const app = express();
  app.set('trust proxy', false);
  const limiters = createSensitiveRateLimiters({ windowMs: 60000, customerReviewMax: 1 });
  app.post('/api/products/:productId/reviews', limiters.customerReview, (req, res) => {
    res.json({ success: true, data: null, message: 'ok' });
  });

  await withServer(app, async baseUrl => {
    const endpoint = `${baseUrl}/api/products/7/reviews`;
    const first = await fetch(endpoint, { method: 'POST' });
    const second = await fetch(endpoint, { method: 'POST' });
    const body = await second.json();
    assert.equal(first.status, 200);
    assert.equal(second.status, 429);
    assert.equal(body.success, false);
    assert.equal(body.data, null);
    assert.equal(typeof body.message, 'string');
  });
});

test('wishlist read and write limiters return structured 429 responses', async () => {
  const app = express();
  app.set('trust proxy', false);
  const limiters = createSensitiveRateLimiters({
    windowMs: 60000,
    customerWishlistReadMax: 1,
    customerWishlistWriteMax: 1
  });
  app.get('/api/customer/wishlist', limiters.customerWishlistRead, (req, res) => {
    res.json({ success: true, data: null, message: 'ok' });
  });
  app.post('/api/customer/wishlist', limiters.customerWishlistWrite, (req, res) => {
    res.json({ success: true, data: null, message: 'ok' });
  });

  await withServer(app, async baseUrl => {
    const endpoint = `${baseUrl}/api/customer/wishlist`;
    const readFirst = await fetch(endpoint);
    const readLimited = await fetch(endpoint);
    const readBody = await readLimited.json();
    assert.equal(readFirst.status, 200);
    assert.equal(readLimited.status, 429);
    assert.equal(readBody.success, false);
    assert.equal(readBody.data, null);

    const writeFirst = await fetch(endpoint, { method: 'POST' });
    const writeLimited = await fetch(endpoint, { method: 'POST' });
    const writeBody = await writeLimited.json();
    assert.equal(writeFirst.status, 200);
    assert.equal(writeLimited.status, 429);
    assert.equal(writeBody.success, false);
    assert.equal(writeBody.data, null);
  });
});
