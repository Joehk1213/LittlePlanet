'use strict';

const createProductsRouter = require('./products/index');
const createOrdersRouter = require('./orders');
const createCustomersRouter = require('./customers');
const createReminderRouter = require('./reminders');
const createInboundRouter = require('./inbound');
const createShippingRouter = require('./shipping');
const createCustomerRouter = require('./customer');
const createReviewsRouter = require('./reviews');
const createAnalyticsRouter = require('./Routes-Analytics-Fixed');
const createWebhookRouter = require('./webhooks');
const createPaymentProofRouter = require('./payments');
const createAdminOrdersRouter = require('./admin/orders');

function registerRoutes(app, dependencies) {
  const {
    adminSessions,
    adminSupabase,
    supabase,
    supabaseAnonKey,
    supabaseServiceRoleKey,
    shippingAdminToken,
    productAdminToken,
    analyticsAdminToken,
    inboundAdminToken,
    paymentProofReceiptRecipients,
    whatsappSender,
    customerLookupRateSecret,
    customerSessionSecret,
    reminderCronToken,
  } = dependencies;
  const serviceRoleAvailable = supabaseServiceRoleKey.length > 0;
  const readEnabled = Boolean(supabaseAnonKey);

  app.use('/api/admin-auth', adminSessions.router);

  app.use(
    '/api/products',
    createProductsRouter(adminSupabase, {
      adminToken: productAdminToken,
      isSessionAuthorized: adminSessions.isAuthorized,
      stockWriteEnabled: serviceRoleAvailable,
    })
  );

  app.use(
    '/api',
    createReviewsRouter(adminSupabase, {
      customerSessionSecret,
      isSessionAuthorized: adminSessions.isSessionAuthorized,
      readEnabled: serviceRoleAvailable,
      writeEnabled: serviceRoleAvailable,
    })
  );
  app.use(
    '/api/orders',
    createOrdersRouter(adminSupabase, {
      serviceRoleAvailable,
      isSessionAuthorized: adminSessions.isSessionAuthorized,
    })
  );
  app.use(
    '/api/admin/orders',
    createAdminOrdersRouter(adminSupabase, {
      serviceRoleAvailable,
      isSessionAuthorized: adminSessions.isSessionAuthorized,
    })
  );
  app.use(
    '/api/orders',
    createPaymentProofRouter(adminSupabase, {
      serviceRoleAvailable,
      isSessionAuthorized: adminSessions.isSessionAuthorized,
      enableAdmin: false,
    })
  );
  app.use(
    '/api/admin/orders',
    createPaymentProofRouter(adminSupabase, {
      serviceRoleAvailable,
      isSessionAuthorized: adminSessions.isSessionAuthorized,
      enableUpload: false,
    })
  );
  app.use(
    '/api/admin/customers',
    createCustomersRouter(adminSupabase, {
      serviceRoleAvailable,
      isSessionAuthorized: adminSessions.isSessionAuthorized,
    })
  );
  app.use(
    '/api/customer',
    createCustomerRouter(adminSupabase, {
      rateLimitSecret: customerLookupRateSecret,
      sessionSecret: customerSessionSecret,
      secureCookie: app.get('env') === 'production',
      readEnabled: serviceRoleAvailable,
    })
  );
  app.use(
    '/api/admin/analytics',
    createAnalyticsRouter(adminSupabase, {
      adminToken: analyticsAdminToken,
      isSessionAuthorized: adminSessions.isSessionAuthorized,
      requireSession: true,
      readEnabled,
      profitDetailsEnabled: process.env.ANALYTICS_PROFIT_DETAILS_ENABLED === 'true',
    })
  );
  app.use(
    '/api/analytics',
    createAnalyticsRouter(adminSupabase, {
      adminToken: analyticsAdminToken,
      isSessionAuthorized: adminSessions.isAuthorized,
      readEnabled,
      useTableFallback: !serviceRoleAvailable,
      profitDetailsEnabled: process.env.ANALYTICS_PROFIT_DETAILS_ENABLED === 'true',
    })
  );
  app.use(
    '/api/inbound',
    createInboundRouter(adminSupabase, {
      adminToken: inboundAdminToken,
      isSessionAuthorized: adminSessions.isAuthorized,
      writeEnabled: serviceRoleAvailable,
    })
  );
  app.use(
    '/api/webhook',
    createWebhookRouter(adminSupabase, {
      verifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
      appSecret: process.env.WHATSAPP_APP_SECRET,
      writeEnabled: serviceRoleAvailable,
      sendWhatsApp: whatsappSender,
      receiptRecipients: paymentProofReceiptRecipients,
    })
  );
  app.use(
    '/api/shipping',
    createShippingRouter(adminSupabase, {
      adminToken: shippingAdminToken,
      isSessionAuthorized: adminSessions.isAuthorized,
      writeEnabled: serviceRoleAvailable,
      readEnabled,
      sendWhatsApp: null,
    })
  );
  app.use(
    '/api/reminders',
    createReminderRouter(supabase, {
      cronToken: reminderCronToken,
      recipients: [],
      sendWhatsApp: null,
    })
  );
}

module.exports = registerRoutes;
