'use strict';

require('express-async-errors');

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const { apiNotFound, errorHandler } = require('../src/middleware/error-handler');

async function withServer(app, run) {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
}

function responseShape(body) {
  assert.deepEqual(Object.keys(body).sort(), ['data', 'message', 'success']);
  assert.equal(body.success, false);
  assert.equal(body.data, null);
  assert.equal(typeof body.message, 'string');
}

test('central handler returns a structured error for rejected async route handlers', async () => {
  const app = express();
  app.set('env', 'production');
  app.get('/api/failure', async (req, res) => {
    await Promise.resolve();
    throw new Error('private database detail');
  });
  app.use('/api', apiNotFound);
  app.use(errorHandler);

  await withServer(app, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/failure`);
    const body = await response.json();
    assert.equal(response.status, 500);
    responseShape(body);
    assert.equal(JSON.stringify(body).includes('private database detail'), false);
    assert.equal(JSON.stringify(body).includes('stack'), false);
  });
});

test('central handler formats malformed JSON and unknown API routes consistently', async () => {
  const app = express();
  app.use(express.json());
  app.post('/api/echo', (req, res) => res.json({ success: true, data: req.body, message: 'ok' }));
  app.use('/api', apiNotFound);
  app.use(errorHandler);

  await withServer(app, async baseUrl => {
    const malformed = await fetch(`${baseUrl}/api/echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"incomplete":'
    });
    assert.equal(malformed.status, 400);
    responseShape(await malformed.json());

    const missing = await fetch(`${baseUrl}/api/not-found`);
    assert.equal(missing.status, 404);
    responseShape(await missing.json());
  });
});

test('central handler returns safe client errors without exposing parser details', async () => {
  const app = express();
  app.get('/api/unsupported', (req, res, next) => {
    const error = new Error('private encoding detail');
    error.status = 415;
    next(error);
  });
  app.use(errorHandler);

  await withServer(app, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/unsupported`);
    const body = await response.json();
    assert.equal(response.status, 415);
    responseShape(body);
    assert.equal(JSON.stringify(body).includes('private encoding detail'), false);
  });
});
