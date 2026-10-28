# F API Reference (PJ1)

This is a route-mount inventory from `src/routes/index.js` and the route handlers present on the F branch. It documents the current Express API shape, not an OpenAPI contract. All request/response details remain subject to the source implementation.

## Route mounts

| Base path | Handler | Main routes |
|---|---|---|
| `/health` | `index.js` | `GET /health` liveness |
| `/api/admin-auth` | `src/middleware/admin-sessions.js` | `POST /login`, `GET /session`, `POST /logout` |
| `/api/products` | `src/routes/products/` | `GET /`, `GET /categories`, `POST /categories`, `GET /inventory-alerts`, `GET /adjustments`, `POST /:productId/adjustments`, `PATCH /:productId/stock`, `POST /`, `PATCH /:productId`, `DELETE /:productId` |
| `/api` | `src/routes/reviews.js` | `GET /products/:productId/reviews`, `GET /reviews/summary`, `POST /reviews`, `POST /products/:productId/reviews`, admin list/status/delete review routes |
| `/api/orders` | `src/routes/orders.js` | `POST /`, `POST /checkout`, `POST /query-order`, `PATCH /update-info`, `GET /admin/orders`, `PATCH /admin/orders/:orderId/status` |
| `/api/admin/orders` | `src/routes/admin/orders.js` | `GET /`, `PATCH /:order_id/status` |
| `/api/orders` and `/api/admin/orders` | `src/routes/payments.js` | Payment-proof submission and admin payment-status routes, gated by router options |
| `/api/admin/customers` | `src/routes/customers.js` | `GET /`, `POST /:customerPhone/bind-google`, `PATCH /:id/credit-status` |
| `/api/customer` | `src/routes/customer.js` | Customer config, wishlist, member session, order lookup/forgot flows |
| `/api/admin/analytics` | `src/routes/Routes-Analytics-Fixed.js` | `GET /summary`, `/profit`, `/overview`, `/sales-trend`, `/top-products`, `/reconciliation` |
| `/api/analytics` | `src/routes/Routes-Analytics-Fixed.js` | Analytics compatibility mount; same handler family with separate authorization/configuration |
| `/api/inbound` | `src/routes/inbound.js` | Receipt, expiring, batches, batch update, reconciliation |
| `/api/webhook` | `src/routes/webhooks.js` | WhatsApp webhook verification and event receiver |
| `/api/shipping` | `src/routes/shipping.js` | Pick list, shipment and notification retry routes |
| `/api/reminders` | `src/routes/reminders.js` | Upcoming reminders and authorized reminder run |

## Admin order E/F endpoints

- `GET /api/admin/orders?phone=&status=&from=&to=&limit=&offset=` requires an admin session with the `orders` scope and backend service-role access. Phone filtering is normalized and logs only its last four digits.
- `PATCH /api/admin/orders/:order_id/status` requires the same scope and a valid state-machine transition. It calls `transition_admin_order_status`; payment and shipping state are not inferred from the requested order state.
- The `order_profit` view is restricted to `service_role`. Unknown/missing product cost yields unknown profit (`NULL`), not a fabricated zero-cost margin.
- No CSV import endpoint exists. The F scripts in this branch are local read-only analysis and synthetic fixture tools.
