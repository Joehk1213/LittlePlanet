'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const createReminderRouter = require('../src/routes/reminders');

const CRON_TOKEN = 'r'.repeat(40);
const NOW = new Date('2026-10-23T08:00:00.000Z');

async function withReminderServer(supabase, sendWhatsApp, run) {
  const app = express();
  app.use(express.json());
  app.use('/api/reminders', createReminderRouter(supabase, {
    cronToken: CRON_TOKEN,
    recipients: ['85290899546'],
    sendWhatsApp
  }));

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

function createSupabase(products, options = {}) {
  return {
    from(table) {
      assert.equal(table, 'products');
      let operation = 'select';
      let payload = null;
      let selectedColumns = '*';
      const filters = [];
      let claimFilter = null;

      const query = {
        select(columns = '*') {
          selectedColumns = columns;
          return query;
        },
        eq(field, value) {
          filters.push(product => product[field] === value);
          return query;
        },
        gte(field, value) {
          filters.push(product => Date.parse(product[field]) >= Date.parse(value));
          return query;
        },
        lte(field, value) {
          filters.push(product => Date.parse(product[field]) <= Date.parse(value));
          return query;
        },
        order() {
          return query;
        },
        update(values) {
          operation = 'update';
          payload = values;
          return query;
        },
        or(expression) {
          const separator = ',remind_claimed_at.lt.';
          const separatorIndex = expression.indexOf(separator);
          assert.notEqual(separatorIndex, -1);
          const staleClaimBefore = expression.slice(separatorIndex + separator.length);
          claimFilter = product => (
            product.remind_claimed_at == null ||
            Date.parse(product.remind_claimed_at) < Date.parse(staleClaimBefore)
          );
          return query;
        },
        then(resolve, reject) {
          if (options.queryError) {
            return Promise.resolve({ data: null, error: options.queryError })
              .then(resolve, reject);
          }

          const matchingProducts = products.filter(product => (
            filters.every(filter => filter(product)) &&
            (!claimFilter || claimFilter(product))
          ));

          if (operation === 'update') {
            for (const product of matchingProducts) {
              Object.assign(product, payload);
            }
          }

          const data = matchingProducts.map(product => {
            if (selectedColumns === '*') {
              return { ...product };
            }
            return Object.fromEntries(
              selectedColumns
                .split(',')
                .map(column => [column, product[column]])
            );
          });
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        }
      };

      return query;
    }
  };
}

async function postReminderRun(baseUrl) {
  const response = await fetch(`${baseUrl}/api/reminders/run`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CRON_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ hours: 24 })
  });
  return { status: response.status, body: await response.json() };
}

function createProduct(cutoffOffsetMs, overrides = {}) {
  return {
    id: 1,
    name: '小行星曲奇',
    cutoff_datetime: new Date(NOW.getTime() + cutoffOffsetMs).toISOString(),
    remind_status: '未提示',
    remind_claimed_at: null,
    is_active: true,
    status: '預購中',
    ...overrides
  };
}

test('提醒在截單前剛好 24 小時時成功發送並更新狀態', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const products = [createProduct(24 * 60 * 60 * 1000)];
  const sentMessages = [];
  const supabase = createSupabase(products);

  await withReminderServer(supabase, async message => {
    sentMessages.push(message);
  }, async baseUrl => {
    const result = await postReminderRun(baseUrl);

    assert.equal(result.status, 200);
    assert.equal(result.body.success, true);
    assert.equal(result.body.data.length, 1);
    assert.equal(result.body.data[0].success, true);
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].to, '85290899546');
    assert.match(sentMessages[0].text, /小行星曲奇/);
    assert.equal(products[0].remind_status, '已發送提醒');
    assert.equal(products[0].remind_claimed_at, null);
  });
});

test('截單時間超出 24 小時窗口時不會發送提醒', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const products = [createProduct(24 * 60 * 60 * 1000 + 1)];
  let sendCount = 0;

  await withReminderServer(createSupabase(products), async () => {
    sendCount += 1;
  }, async baseUrl => {
    const result = await postReminderRun(baseUrl);

    assert.equal(result.status, 200);
    assert.equal(result.body.success, true);
    assert.deepEqual(result.body.data, []);
    assert.equal(sendCount, 0);
    assert.equal(products[0].remind_status, '未提示');
  });
});

test('成功發送後重跑不會重複發送同一商品提醒', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const products = [createProduct(24 * 60 * 60 * 1000)];
  let sendCount = 0;

  await withReminderServer(createSupabase(products), async () => {
    sendCount += 1;
  }, async baseUrl => {
    const firstRun = await postReminderRun(baseUrl);
    const secondRun = await postReminderRun(baseUrl);

    assert.equal(firstRun.status, 200);
    assert.equal(firstRun.body.data[0].success, true);
    assert.equal(secondRun.status, 200);
    assert.equal(secondRun.body.success, true);
    assert.deepEqual(secondRun.body.data, []);
    assert.equal(sendCount, 1);
    assert.equal(products[0].remind_status, '已發送提醒');
  });
});

test('Supabase 查詢失敗時回傳標準 JSON 錯誤格式', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const supabase = createSupabase([], {
    queryError: { code: 'XX000', message: 'private database detail' }
  });

  await withReminderServer(supabase, async () => {
    assert.fail('資料庫查詢失敗時不應發送提醒。');
  }, async baseUrl => {
    const result = await postReminderRun(baseUrl);

    assert.equal(result.status, 500);
    assert.deepEqual(result.body, {
      success: false,
      data: null,
      message: '執行截單提醒時發生錯誤。'
    });
    assert.doesNotMatch(result.body.message, /private database detail/);
  });
});
