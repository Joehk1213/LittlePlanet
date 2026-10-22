const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const test = require('node:test');
const express = require('express');

const createProductsRouter = require('../routes/products');
const createOrdersRouter = require('../routes/orders');
const createReminderRouter = require('../routes/reminders');
const createInboundRouter = require('../routes/inbound');
const createShippingRouter = require('../routes/shipping');
const createCustomerRouter = require('../routes/customer');
const createAnalyticsRouter = require('../routes/analytics');
const createWebhookRouter = require('../routes/webhook');

const TOKENS = {
  reminder: 'r'.repeat(40),
  inbound: 'i'.repeat(40),
  shipping: 's'.repeat(40),
  lookup: 'l'.repeat(40),
  analytics: 'a'.repeat(40),
  webhookVerify: 'w'.repeat(40),
  webhookAppSecret: 'meta-app-secret-for-integration-tests'
};

function createStore() {
  const cutoff = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const store = {
    products: [{
      id: 51,
      name: 'LittlePlanet 月亮公仔',
      price: 25,
      stock: 2,
      is_active: true,
      status: '旅購中',
      category: '公仔',
      cutoff_datetime: cutoff,
      remind_status: '未提示',
      remind_claimed_at: null,
      remind_sent_at: null
    }],
    orders: [],
    orderItems: [],
    nextOrderId: 700,
    nextItemId: 900,
    failNextOrderInsert: false,
    failNextOrderItemsInsert: false,
    notifications: new Map(),
    whatsappMessages: [],
    paymentReports: new Map(),
    reminderClaims: 0,
    queryCount: 0
  };

  store.supabase = {
    from(table) {
      return new QueryBuilder(store, table);
    },
    async rpc(name, args) {
      store.queryCount += 1;

      if (name === 'create_customer_order') {
        if (store.failNextOrderInsert) {
          store.failNextOrderInsert = false;
          return { data: null, error: { code: 'PGRST202', message: 'Function is not available.' } };
        }
        if (store.failNextOrderItemsInsert) {
          store.failNextOrderItemsInsert = false;
          return { data: null, error: { code: 'XX000', message: 'Simulated atomic transaction failure.' } };
        }

        const requestedItems = args.p_items.map(item => ({
          product: store.products.find(candidate => String(candidate.id) === String(item.product_id)),
          quantity: item.quantity
        }));
        const missingProduct = requestedItems.find(item => !item.product);
        if (missingProduct) {
          return { data: null, error: { code: 'P0001', message: 'PRODUCT_UNAVAILABLE' } };
        }
        const shortStock = requestedItems.find(item => item.product.stock < item.quantity);
        if (shortStock) {
          return {
            data: null,
            error: {
              code: 'P0001',
              message: 'STOCK_UNAVAILABLE',
              details: JSON.stringify({
                product_id: shortStock.product.id,
                requested: shortStock.quantity,
                available: shortStock.product.stock
              })
            }
          };
        }

        const orderId = crypto.randomUUID();
        const orderNumber = `LP-E2E-${orderId.slice(0, 8).toUpperCase()}`;
        const order = {
          order_id: orderId,
          order_number: orderNumber,
          customer_phone: args.p_customer_phone,
          order_date: new Date().toISOString(),
          total_amount: requestedItems.reduce(
            (total, item) => total + Number(item.product.price) * item.quantity,
            0
          ),
          payment_status: '未付款',
          shipping_status: '待到貨'
        };
        const createdItems = requestedItems.map(({ product, quantity }) => ({
          item_id: crypto.randomUUID(),
          order_id: orderId,
          product_id: product.id,
          product_name: product.name,
          quantity,
          unit_price: product.price,
          received_quantity: 0,
          item_status: '待進貨',
          is_travel_buy: false
        }));
        store.orders.push(order);
        store.orderItems.push(...createdItems);
        for (const { product, quantity } of requestedItems) {
          product.stock -= quantity;
        }
        return {
          data: {
            order_id: orderId,
            order_number: orderNumber,
            order_date: order.order_date,
            payment_status: order.payment_status,
            shipping_status: order.shipping_status,
            total_amount: order.total_amount,
            items: createdItems
          },
          error: null
        };
      }

      if (name === 'record_product_receipt') {
        const product = store.products.find(item => item.id === args.p_product_id);
        if (!product) {
          return { data: null, error: { code: 'P0002' } };
        }

        product.stock += args.p_quantity;
        if (['預購中', '旅購中'].includes(product.status)) {
          product.status = '已到貨';
        }

        let remaining = args.p_quantity;
        let allocated = 0;
        const allocations = [];
        const matchingItems = store.orderItems
          .filter(item => item.product_id === product.id && item.item_status === '待進貨')
          .sort((left, right) => {
            const leftOrder = store.orders.find(order => order.order_id === left.order_id);
            const rightOrder = store.orders.find(order => order.order_id === right.order_id);
            return new Date(leftOrder.order_date) - new Date(rightOrder.order_date) ||
              left.item_id - right.item_id;
          });

        for (const item of matchingItems) {
          if (remaining === 0) break;
          const amount = Math.min(remaining, item.quantity - item.received_quantity);
          item.received_quantity += amount;
          if (item.received_quantity >= item.quantity) {
            item.item_status = '已到貨倉';
          }
          remaining -= amount;
          allocated += amount;
          allocations.push({ item_id: item.item_id, received_quantity: item.received_quantity });
        }

        for (const order of store.orders) {
          const items = store.orderItems.filter(item => item.order_id === order.order_id);
          if (items.length > 0) {
            const ready = items.every(item => (
              item.item_status === '已出貨' ||
              item.item_status === '已到貨倉' ||
              item.received_quantity >= item.quantity
            ));
            const anyReceived = items.some(item => item.received_quantity > 0);
            order.shipping_status = ready ? '可出貨' : anyReceived ? '部分到貨' : '待到貨';
          }
        }

        return {
          data: {
            success: true,
            product_id: product.id,
            stock: product.stock,
            allocated_quantity: allocated,
            unallocated_quantity: remaining,
            allocations
          },
          error: null
        };
      }

      if (name === 'reconcile_inbound_orders') {
        const result = store.orders
          .filter(order => args.p_order_id === null || order.order_id === args.p_order_id)
          .map(order => ({
            order_id: order.order_id,
            shipping_status: order.shipping_status,
            items: store.orderItems
              .filter(item => item.order_id === order.order_id)
              .map(item => ({
                item_id: item.item_id,
                item_status: item.item_status,
                received_quantity: item.received_quantity,
                reconciliation_status: item.received_quantity >= item.quantity ? '已齊貨' : '缺貨',
                shortage_quantity: Math.max(0, item.quantity - item.received_quantity)
              }))
          }));
        return { data: result, error: null };
      }

      if (name === 'get_shipping_pick_list') {
        const readyItems = store.orderItems.filter(item => {
          const order = store.orders.find(candidate => candidate.order_id === item.order_id);
          return order && order.shipping_status === '可出貨' && item.item_status === '已到貨倉';
        });

        if (args.p_group_by === 'product') {
          const result = new Map();
          for (const item of readyItems) {
            const product = store.products.find(candidate => candidate.id === item.product_id);
            let row = result.get(item.product_id);
            if (!row) {
              row = {
                product_id: item.product_id,
                product_name: product.name,
                total_quantity: 0,
                orders: []
              };
              result.set(item.product_id, row);
            }
            row.total_quantity += item.quantity;
            row.orders.push({ order_id: item.order_id, item_id: item.item_id, quantity: item.quantity });
          }
          return { data: [...result.values()], error: null };
        }

        const grouped = new Map();
        for (const item of readyItems) {
          const order = store.orders.find(candidate => candidate.order_id === item.order_id);
          let row = grouped.get(order.order_id);
          if (!row) {
            row = { order_id: order.order_id, items: [] };
            grouped.set(order.order_id, row);
          }
          const product = store.products.find(candidate => candidate.id === item.product_id);
          row.items.push({
            item_id: item.item_id,
            product_id: item.product_id,
            product_name: product.name,
            quantity: item.quantity,
            item_status: item.item_status
          });
        }
        return { data: [...grouped.values()], error: null };
      }

      if (name === 'ship_order') {
        const order = store.orders.find(candidate => String(candidate.order_id) === String(args.p_order_id));
        if (!order) return { data: null, error: { code: 'P0002' } };
        if (order.shipping_status !== '可出貨') {
          return { data: null, error: { code: '55000', message: '訂單未齊貨。' } };
        }

        order.shipping_status = '已出貨';
        order.shipping_method = args.p_shipping_method;
        order.tracking_number = args.p_tracking_number;
        for (const item of store.orderItems.filter(candidate => candidate.order_id === order.order_id)) {
          item.item_status = '已出貨';
        }
        for (const item of store.orderItems.filter(candidate => candidate.order_id === order.order_id)) {
          const product = store.products.find(candidate => candidate.id === item.product_id);
          product.stock -= item.quantity;
        }
        store.notifications.set(String(order.order_id), {
          status: 'pending',
          customer_phone: args.p_customer_phone || order.customer_phone,
          shipping_method: order.shipping_method,
          tracking_number: order.tracking_number
        });
        return { data: { success: true, shipment: { order_id: order.order_id } }, error: null };
      }

      if (name === 'claim_shipping_notification') {
        const notification = store.notifications.get(String(args.p_order_id));
        if (!notification) return { data: null, error: { code: 'P0002' } };
        if (notification.status !== 'pending' && notification.status !== 'failed') {
          return { data: { claimed: false, status: notification.status }, error: null };
        }
        notification.status = 'sending';
        return { data: { claimed: true, ...notification }, error: null };
      }

      if (name === 'finish_shipping_notification') {
        const notification = store.notifications.get(String(args.p_order_id));
        if (!notification) return { data: null, error: { code: 'P0002' } };
        notification.status = args.p_success ? 'sent' : 'failed';
        return { data: { status: notification.status }, error: null };
      }

      if (name === 'lookup_customer_orders') {
        const orders = store.orders
          .filter(order => (
            args.p_customer_phone === null ||
            order.customer_phone === args.p_customer_phone
          ) && (
            args.p_order_id === null ||
            order.order_id === args.p_order_id
          ))
          .sort((left, right) => new Date(right.order_date) - new Date(left.order_date))
          .slice(0, 20)
          .map(order => ({
            order_id: order.order_id,
            order_date: order.order_date,
            total_amount: order.total_amount,
            payment_status: order.payment_status,
            shipping_status: order.shipping_status,
            shipping_method: order.shipping_method || null,
            tracking_number: order.tracking_number || null,
            whatsapp_notification_status: store.notifications.has(String(order.order_id))
              ? store.notifications.get(String(order.order_id)).status
              : 'not_created',
            items: store.orderItems
              .filter(item => item.order_id === order.order_id)
              .map(item => ({
                item_id: item.item_id,
                product_id: item.product_id,
                product_name: store.products.find(product => product.id === item.product_id).name,
                quantity: item.quantity,
                received_quantity: item.received_quantity,
                item_status: item.item_status,
                reconciliation_status: item.item_status === '已出貨'
                  ? '已齊貨'
                  : item.received_quantity >= item.quantity
                    ? '已齊貨'
                    : item.received_quantity > 0
                      ? '部分到貨'
                      : '待到貨'
              }))
          }));
        return { data: { rate_limited: false, orders }, error: null };
      }

      if (name === 'get_revenue_overview') {
        const totalRevenue = store.orders.reduce((sum, order) => sum + order.total_amount, 0);
        const totalOrders = store.orders.length;
        const paidOrders = store.orders.filter(order => order.payment_status !== '未付款').length;
        const shippedOrders = store.orders.filter(order => order.shipping_status === '已出貨').length;
        return {
          data: {
            total_revenue: totalRevenue,
            total_orders: totalOrders,
            paid_orders: paidOrders,
            unpaid_orders: totalOrders - paidOrders,
            paid_order_percentage: totalOrders ? paidOrders * 100 / totalOrders : 0,
            unpaid_order_percentage: totalOrders ? (totalOrders - paidOrders) * 100 / totalOrders : 0,
            shipped_orders: shippedOrders,
            unshipped_orders: totalOrders - shippedOrders,
            shipped_order_percentage: totalOrders ? shippedOrders * 100 / totalOrders : 0,
            unshipped_order_percentage: totalOrders ? (totalOrders - shippedOrders) * 100 / totalOrders : 0
          },
          error: null
        };
      }

      if (name === 'get_top_selling_products') {
        const aggregate = new Map();
        for (const item of store.orderItems) {
          const product = store.products.find(candidate => candidate.id === item.product_id);
          const existing = aggregate.get(product.id) || {
            product_id: product.id,
            product_name: product.name,
            quantity_sold: 0,
            sales_amount: 0
          };
          existing.quantity_sold += item.quantity;
          existing.sales_amount += item.quantity * item.unit_price;
          aggregate.set(product.id, existing);
        }
        const result = [...aggregate.values()]
          .sort((left, right) => right.quantity_sold - left.quantity_sold)
          .slice(0, args.p_limit)
          .map((item, index) => ({ rank: index + 1, ...item }));
        return { data: result, error: null };
      }

      if (name === 'get_financial_reconciliation') {
        return {
          data: {
            total_count: store.orders.length,
            rows: store.orders.slice(args.p_offset, args.p_offset + args.p_limit).map(order => ({
              order_id: order.order_id,
              order_date: order.order_date,
              total_amount: order.total_amount,
              payment_status: order.payment_status,
              shipping_status: order.shipping_status,
              shipping_method: order.shipping_method || null,
              tracking_number: order.tracking_number || null,
              items: store.orderItems.filter(item => item.order_id === order.order_id)
            }))
          },
          error: null
        };
      }

      if (name === 'lookup_whatsapp_order') {
        const order = store.orders.find(candidate => (
          candidate.order_id === args.p_order_id &&
          candidate.customer_phone === args.p_customer_phone
        ));
        return {
          data: order ? { found: true, order_id: order.order_id } : { found: false },
          error: null
        };
      }

      if (name === 'record_whatsapp_payment_report') {
        const order = store.orders.find(candidate => (
          candidate.order_id === args.p_order_id &&
          candidate.customer_phone === args.p_customer_phone
        ));
        if (!order) return { data: { found: false, duplicate: false }, error: null };
        if (store.paymentReports.has(args.p_provider_message_id)) {
          return { data: { found: true, duplicate: true }, error: null };
        }
        store.paymentReports.set(args.p_provider_message_id, {
          order_id: args.p_order_id,
          payment_reference: args.p_payment_reference,
          status: '待核實'
        });
        return { data: { found: true, duplicate: false, status: '待核實' }, error: null };
      }

      throw new Error(`Unexpected Supabase RPC: ${name}`);
    }
  };

  return store;
}

class QueryBuilder {
  constructor(store, table) {
    this.store = store;
    this.table = table;
    this.operation = 'select';
    this.filters = [];
    this.sorts = [];
    this.payload = null;
    this.selectedColumns = '*';
    this.singleResult = false;
    this.rangeStart = 0;
    this.rangeEnd = Infinity;
    this.countRequested = false;
  }

  select(columns = '*', options) {
    this.selectedColumns = columns;
    this.countRequested = Boolean(options && options.count === 'exact');
    return this;
  }

  in(column, values) {
    this.filters.push(row => values.includes(row[column]));
    return this;
  }

  eq(column, value) {
    this.filters.push(row => row[column] === value);
    return this;
  }

  gte(column, value) {
    this.filters.push(row => String(row[column]) >= String(value));
    return this;
  }

  lte(column, value) {
    this.filters.push(row => String(row[column]) <= String(value));
    return this;
  }

  or() {
    return this;
  }

  order(column, options = {}) {
    this.sorts.push({ column, ascending: options.ascending !== false });
    return this;
  }

  range(start, end) {
    this.rangeStart = start;
    this.rangeEnd = end;
    return this;
  }

  update(values) {
    this.operation = 'update';
    this.payload = values;
    return this;
  }

  insert(values) {
    this.operation = 'insert';
    this.payload = values;
    return this;
  }

  delete() {
    this.operation = 'delete';
    return this;
  }

  single() {
    this.singleResult = true;
    return this.execute().then(result => ({
      data: Array.isArray(result.data) ? result.data[0] || null : result.data,
      error: result.error
    }));
  }

  maybeSingle() {
    return this.execute().then(result => ({
      data: Array.isArray(result.data) ? result.data[0] || null : result.data,
      error: result.error
    }));
  }

  async execute() {
    const { store, table } = this;
    if (table === 'products') {
      if (this.operation === 'update') {
        const updated = store.products.filter(row => this.filters.every(filter => filter(row)));
        for (const row of updated) {
          if (this.payload.remind_claimed_at) {
            store.reminderClaims += 1;
          }
          Object.assign(row, this.payload);
        }
        return { data: updated.map(row => ({ ...row })), error: null };
      }
      let selected = store.products.filter(row => this.filters.every(filter => filter(row)));
      for (const sort of this.sorts) {
        selected = selected.slice().sort((left, right) => {
          const leftValue = left[sort.column];
          const rightValue = right[sort.column];
          const comparison = typeof leftValue === 'number' && typeof rightValue === 'number'
            ? leftValue - rightValue
            : String(leftValue || '').localeCompare(String(rightValue || ''));
          return sort.ascending ? comparison : -comparison;
        });
      }
      const count = selected.length;
      selected = selected.slice(this.rangeStart, this.rangeEnd + 1);
      return {
        data: selected.map(row => ({ ...row })),
        count: this.countRequested ? count : null,
        error: null
      };
    }

    if (table === 'orders') {
      if (this.operation === 'insert') {
        if (store.failNextOrderInsert) {
          store.failNextOrderInsert = false;
          return {
            data: null,
            error: { code: '42703', message: 'Missing order column.' }
          };
        }
        const inserted = this.payload.map(record => ({
          order_id: store.nextOrderId++,
          ...record
        }));
        store.orders.push(...inserted);
        return { data: inserted.map(row => ({ ...row })), error: null };
      }
      if (this.operation === 'delete') {
        const deleted = store.orders.filter(row => this.filters.every(filter => filter(row)));
        store.orders = store.orders.filter(row => !deleted.includes(row));
        const deletedIds = new Set(deleted.map(row => row.order_id));
        store.orderItems = store.orderItems.filter(row => !deletedIds.has(row.order_id));
        return { data: deleted, error: null };
      }
      return {
        data: store.orders.filter(row => this.filters.every(filter => filter(row))).map(row => ({ ...row })),
        error: null
      };
    }

    if (table === 'order_items') {
      if (this.operation === 'insert') {
        if (store.failNextOrderItemsInsert) {
          store.failNextOrderItemsInsert = false;
          return { data: null, error: { code: 'XX000', message: 'Simulated detail insert failure.' } };
        }
        const inserted = this.payload.map(record => ({
          item_id: store.nextItemId++,
          received_quantity: 0,
          ...record
        }));
        store.orderItems.push(...inserted);
        return { data: inserted.map(row => ({ ...row })), error: null };
      }
      return {
        data: store.orderItems.filter(row => this.filters.every(filter => filter(row))).map(row => ({ ...row })),
        error: null
      };
    }

    throw new Error(`Unexpected Supabase table: ${table}`);
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }
}

function createApplication(store) {
  const app = express();
  app.use(express.json({
    limit: '50kb',
    verify(req, res, buffer) {
      if (req.originalUrl.startsWith('/api/webhook/whatsapp')) {
        req.rawBody = Buffer.from(buffer);
      }
    }
  }));

  app.use('/api/products', createProductsRouter(store.supabase));
  app.use('/api/orders', createOrdersRouter(store.supabase));
  app.use('/api/reminders', createReminderRouter(store.supabase, {
    cronToken: TOKENS.reminder,
    recipients: ['85212345678'],
    sendWhatsApp: async message => store.whatsappMessages.push(message)
  }));
  app.use('/api/inbound', createInboundRouter(store.supabase, {
    adminToken: TOKENS.inbound,
    writeEnabled: true
  }));
  app.use('/api/shipping', createShippingRouter(store.supabase, {
    adminToken: TOKENS.shipping,
    writeEnabled: true,
    sendWhatsApp: async message => store.whatsappMessages.push(message)
  }));
  app.use('/api/customer', createCustomerRouter(store.supabase, {
    rateLimitSecret: TOKENS.lookup,
    readEnabled: true
  }));
  app.use('/api/analytics', createAnalyticsRouter(store.supabase, {
    adminToken: TOKENS.analytics,
    readEnabled: true
  }));
  app.use('/api/webhook', createWebhookRouter(store.supabase, {
    verifyToken: TOKENS.webhookVerify,
    appSecret: TOKENS.webhookAppSecret,
    writeEnabled: true,
    sendWhatsApp: async message => store.whatsappMessages.push(message)
  }));
  return app;
}

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

async function jsonRequest(baseUrl, path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

function createSignature(rawBody) {
  return `sha256=${crypto
    .createHmac('sha256', TOKENS.webhookAppSecret)
    .update(rawBody)
    .digest('hex')}`;
}

test('E2E business flow: products, checkout rollback, reminders, inbound, shipping, customer lookup, analytics', async () => {
  const store = createStore();
  const app = createApplication(store);

  await withServer(app, async baseUrl => {
    const products = await jsonRequest(baseUrl, '/api/products?category=%E5%85%AC%E4%BB%94');
    assert.equal(products.status, 200);
    assert.equal(products.body.success, true);
    assert.equal(products.body.data.products[0].id, 51);

    const checkoutBody = {
      customer_phone: '+85212345678',
      totalAmount: 50,
      items: [{ product_id: 51, quantity: 2 }]
    };
    store.failNextOrderItemsInsert = true;
    const rolledBack = await jsonRequest(baseUrl, '/api/orders', {
      method: 'POST',
      body: checkoutBody
    });
    assert.equal(rolledBack.status, 500);
    assert.equal(rolledBack.body.success, false);
    assert.equal(store.orders.length, 0);
    assert.equal(store.orderItems.length, 0);
    assert.equal(store.products[0].stock, 2);

    const checkout = await jsonRequest(baseUrl, '/api/orders', {
      method: 'POST',
      body: checkoutBody
    });
    assert.equal(checkout.status, 201);
    assert.equal(checkout.body.success, true);
    assert.match(checkout.body.data.order_number, /^LP-E2E-[0-9A-F]{8}$/);
    assert.equal(Object.hasOwn(checkout.body.data, 'order_id'), false);
    const orderId = store.orders[0].order_id;
    assert.equal(store.orders.length, 1);
    assert.equal(store.orderItems.length, 1);
    assert.equal(store.products[0].stock, 0);

    const reminderAuth = TOKENS.reminder;
    const upcoming = await jsonRequest(
      baseUrl,
      '/api/reminders/upcoming?hours=24',
      { token: reminderAuth }
    );
    assert.equal(upcoming.status, 200);
    assert.equal(upcoming.body.data.length, 1);

    const reminderRun = await jsonRequest(baseUrl, '/api/reminders/run', {
      method: 'POST',
      token: reminderAuth,
      body: { hours: 24 }
    });
    assert.equal(reminderRun.status, 200);
    assert.equal(reminderRun.body.data[0].success, true);
    assert.equal(store.reminderClaims, 1);
    assert.equal(store.products[0].remind_status, '已發送提醒');
    assert.equal(store.whatsappMessages.some(message => message.text.includes('截單提醒')), true);

    const receipt = await jsonRequest(baseUrl, '/api/inbound/receipt', {
      method: 'POST',
      token: TOKENS.inbound,
      body: { product_id: 51, quantity: 2 }
    });
    assert.equal(receipt.status, 200);
    assert.equal(receipt.body.data.allocated_quantity, 2);
    assert.equal(store.orderItems[0].item_status, '已到貨倉');
    assert.equal(store.orders[0].shipping_status, '可出貨');
    assert.equal(store.products[0].stock, 2);

    const reconciliation = await jsonRequest(baseUrl, '/api/inbound/reconcile', {
      method: 'POST',
      token: TOKENS.inbound,
      body: { order_id: orderId }
    });
    assert.equal(reconciliation.status, 200);
    assert.equal(reconciliation.body.data[0].items[0].reconciliation_status, '已齊貨');

    const pickList = await jsonRequest(
      baseUrl,
      '/api/shipping/pick-list?group_by=order',
      { token: TOKENS.shipping }
    );
    assert.equal(pickList.status, 200);
    assert.equal(pickList.body.data[0].order_id, orderId);

    const productPickList = await jsonRequest(
      baseUrl,
      '/api/shipping/pick-list?group_by=product',
      { token: TOKENS.shipping }
    );
    assert.equal(productPickList.status, 200);
    assert.equal(productPickList.body.data[0].total_quantity, 2);

    const shipped = await jsonRequest(baseUrl, `/api/shipping/${orderId}/ship`, {
      method: 'POST',
      token: TOKENS.shipping,
      body: { shipping_method: '順豐', tracking_number: 'SF-E2E-700' }
    });
    assert.equal(shipped.status, 200);
    assert.equal(shipped.body.data.notification.success, true);
    assert.equal(store.orders[0].shipping_status, '已出貨');
    assert.equal(store.orderItems[0].item_status, '已出貨');
    assert.equal(store.notifications.get(String(orderId)).status, 'sent');
    assert.equal(store.products[0].stock, 0);
    assert.equal(store.whatsappMessages.some(message => message.text.includes('SF-E2E-700')), true);

    const customerLookup = await jsonRequest(baseUrl, '/api/customer/orders/lookup', {
      method: 'POST',
      body: {
        customer_phone: '85212345678',
        order_number: checkout.body.data.order_number
      }
    });
    assert.equal(customerLookup.status, 200);
    assert.equal(customerLookup.body.data[0].order_id, orderId);
    assert.equal(customerLookup.body.data[0].shipping_status, '已出貨');
    assert.equal(customerLookup.body.data[0].tracking_number, 'SF-E2E-700');
    assert.equal(customerLookup.body.data[0].whatsapp_notification_status, 'sent');
    assert.equal(customerLookup.body.data[0].items[0].reconciliation_status, '已齊貨');

    const reportDate = new Date();
    const rangeStart = new Date(Date.UTC(
      reportDate.getUTCFullYear(),
      reportDate.getUTCMonth(),
      1
    )).toISOString().slice(0, 10);
    const rangeEnd = new Date(Date.UTC(
      reportDate.getUTCFullYear(),
      reportDate.getUTCMonth() + 1,
      0
    )).toISOString().slice(0, 10);
    const range = `start_date=${rangeStart}&end_date=${rangeEnd}`;
    const overview = await jsonRequest(
      baseUrl,
      `/api/analytics/overview?${range}`,
      { token: TOKENS.analytics }
    );
    assert.equal(overview.status, 200);
    assert.equal(overview.body.data.total_orders, 1);
    assert.equal(overview.body.data.total_revenue, 50);
    assert.equal(overview.body.data.shipped_orders, 1);

    const topProducts = await jsonRequest(
      baseUrl,
      `/api/analytics/top-products?${range}&limit=5`,
      { token: TOKENS.analytics }
    );
    assert.equal(topProducts.status, 200);
    assert.equal(topProducts.body.data[0].quantity_sold, 2);
    assert.equal(topProducts.body.data[0].sales_amount, 50);

    const financialRows = await jsonRequest(
      baseUrl,
      `/api/analytics/reconciliation?${range}&payment_status=%E6%9C%AA%E4%BB%98%E6%AC%BE&shipping_status=%E5%B7%B2%E5%87%BA%E8%B2%A8`,
      { token: TOKENS.analytics }
    );
    assert.equal(financialRows.status, 200);
    assert.equal(financialRows.body.data.rows[0].order_id, orderId);
  });
});

test('checkout reports unapplied database migrations as service unavailable', async () => {
  const store = createStore();
  store.failNextOrderInsert = true;

  await withServer(createApplication(store), async baseUrl => {
    const response = await jsonRequest(baseUrl, '/api/orders', {
      method: 'POST',
      body: {
        customer_phone: '85212345678',
        totalAmount: 25,
        items: [{ product_id: 51, quantity: 1 }]
      }
    });

    assert.equal(response.status, 503);
    assert.equal(response.body.success, false);
    assert.match(response.body.message, /結帳庫存 migration/);
    assert.equal(store.orders.length, 0);
    assert.equal(store.orderItems.length, 0);
  });
});

test('WhatsApp webhook verifies Meta challenge and signature before processing messages', async () => {
  const store = createStore();
  const orderId = 'e1da0bac-9021-4e87-920b-2f5bf5381f32';
  const order = {
    order_id: orderId,
    customer_phone: '85212345678',
    order_date: new Date().toISOString(),
    total_amount: 50,
    payment_status: '未付款',
    shipping_status: '待到貨'
  };
  store.orders.push(order);
  const app = createApplication(store);

  await withServer(app, async baseUrl => {
    const verification = await fetch(
      `${baseUrl}/api/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=${TOKENS.webhookVerify}&hub.challenge=challenge-abc`
    );
    assert.equal(verification.status, 200);
    assert.equal(await verification.text(), 'challenge-abc');

    const invalidVerification = await fetch(
      `${baseUrl}/api/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=challenge-abc`
    );
    assert.equal(invalidVerification.status, 403);

    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          value: {
            messages: [{
              id: 'wamid.lookup-1',
              from: '+85212345678',
              type: 'text',
              text: { body: `查詢訂單 ${orderId}` }
            }]
          }
        }]
      }]
    };
    const rawBody = JSON.stringify(payload);
    const unauthorized = await fetch(`${baseUrl}/api/webhook/whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': 'sha256=invalid' },
      body: rawBody
    });
    assert.equal(unauthorized.status, 401);

    const accepted = await fetch(`${baseUrl}/api/webhook/whatsapp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': createSignature(rawBody)
      },
      body: rawBody
    });
    const result = await accepted.json();
    assert.equal(accepted.status, 200);
    assert.equal(result.success, true);
    assert.equal(result.data.processed_count, 1);
    assert.equal(store.whatsappMessages.at(-1).to, '85212345678');
    assert.match(store.whatsappMessages.at(-1).text, new RegExp(`訂單 #${orderId}`));
  });
});

test('WhatsApp payment reports remain pending manual verification and are idempotent', async () => {
  const store = createStore();
  const orderId = '8aaf1bf3-57a6-4ed4-bc77-5ea46dfc72f2';
  store.orders.push({
    order_id: orderId,
    customer_phone: '85212345678',
    order_date: new Date().toISOString(),
    total_amount: 50,
    payment_status: '未付款',
    shipping_status: '待到貨'
  });
  const app = createApplication(store);

  await withServer(app, async baseUrl => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          value: {
            messages: [{
              id: 'wamid.payment-1',
              from: '85212345678',
              type: 'text',
              text: { body: `付款回報 ${orderId} TX-REF-880` }
            }]
          }
        }]
      }]
    };
    const rawBody = JSON.stringify(payload);
    const response = await fetch(`${baseUrl}/api/webhook/whatsapp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': createSignature(rawBody)
      },
      body: rawBody
    });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.data.results[0].action, 'payment_report');
    assert.equal(store.paymentReports.get('wamid.payment-1').status, '待核實');
    assert.equal(store.orders[0].payment_status, '未付款');
    assert.match(store.whatsappMessages.at(-1).text, /仍待管理員核實/);
  });
});

test('WhatsApp webhook catches Supabase failures and accepts status callbacks without outbound config', async () => {
  const app = express();
  app.use(express.json({
    verify(req, res, buffer) {
      req.rawBody = Buffer.from(buffer);
    }
  }));
  app.use('/api/webhook', createWebhookRouter({
    rpc: async () => ({ data: null, error: { code: 'XX000' } })
  }, {
    verifyToken: TOKENS.webhookVerify,
    appSecret: TOKENS.webhookAppSecret,
    writeEnabled: true,
    sendWhatsApp: async () => {}
  }));

  await withServer(app, async baseUrl => {
    const messagePayload = {
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          value: {
            messages: [{
              id: 'wamid.db-error',
              from: '85212345678',
              type: 'text',
              text: { body: '查詢訂單 e1da0bac-9021-4e87-920b-2f5bf5381f32' }
            }]
          }
        }]
      }]
    };
    const messageBody = JSON.stringify(messagePayload);
    const failed = await fetch(`${baseUrl}/api/webhook/whatsapp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': createSignature(messageBody)
      },
      body: messageBody
    });
    const failedBody = await failed.json();
    assert.equal(failed.status, 500);
    assert.equal(failedBody.success, false);
    assert.equal(typeof failedBody.message, 'string');

  });

  const statusApp = express();
  statusApp.use(express.json({
    verify(req, res, buffer) {
      req.rawBody = Buffer.from(buffer);
    }
  }));
  statusApp.use('/api/webhook', createWebhookRouter({
    rpc: async () => {
      throw new Error('Status callbacks must not query the database.');
    }
  }, {
    verifyToken: TOKENS.webhookVerify,
    appSecret: TOKENS.webhookAppSecret,
    writeEnabled: true
  }));

  await withServer(statusApp, async baseUrl => {
    const statusPayload = {
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          value: {
            statuses: [{ id: 'wamid.status-update', status: 'delivered' }]
          }
        }]
      }]
    };
    const statusBody = JSON.stringify(statusPayload);
    const accepted = await fetch(`${baseUrl}/api/webhook/whatsapp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': createSignature(statusBody)
      },
      body: statusBody
    });
    const acceptedBody = await accepted.json();
    assert.equal(accepted.status, 200);
    assert.equal(acceptedBody.data.processed_count, 0);
  });
});
