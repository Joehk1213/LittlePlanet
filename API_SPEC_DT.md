# LittlePlanet API Spec (DT F-prep)

Generated from `src/routes/index.js` on base `3d46aa7` (`pj1/dev-next-f-prep`). This is a route inventory, not an OpenAPI contract; request/response fields remain defined by the handlers and tests.

## Global behavior

- `index.js` applies API origin/rate protection and Pino HTTP request logging to `/api/*`; JSON bodies are limited to 50 KB. Sensitive routes also have endpoint-specific rate limits.
- `GET /health` is outside the `/api` prefix and returns service health.
- Admin session login uses a same-origin request and sets an HttpOnly, SameSite=Strict cookie scoped to `/api`. Admin write requests require a same-origin request and the corresponding session scope unless the route documents a separate token/signature.
- The browser must use the public anon key only. Service-role access stays in backend routes.

## Admin authentication — `/api/admin-auth`

| Method | Path | Authorization |
|---|---|---|
| POST | `/api/admin-auth/login` | Same-origin request plus a configured admin token; creates scoped session cookie. |
| GET | `/api/admin-auth/session` | Public session-status check; reports no scopes when logged out. |
| POST | `/api/admin-auth/logout` | Same-origin request; clears session cookie. |

## Products — `/api/products`

| Method | Path | Authorization |
|---|---|---|
| POST | `/api/products/images` | Products admin session/token and server service-role configuration. |
| GET | `/api/products/categories` | Public read; server database configuration required. |
| POST | `/api/products/categories` | Products admin session/token and service-role configuration. |
| GET | `/api/products` | Public product listing; inactive/admin-only fields depend on an authorized products session. |
| GET | `/api/products/inventory-alerts` | Products admin session/token and service-role configuration. |
| GET | `/api/products/adjustments` | Products admin session/token and service-role configuration. |
| POST | `/api/products/:productId/adjustments` | Products admin session/token and service-role configuration. |
| PATCH | `/api/products/:productId/stock` | Products admin session/token and service-role configuration. |
| POST | `/api/products` | Products admin session/token and service-role configuration. |
| PATCH | `/api/products/:productId` | Products admin session/token and service-role configuration. |
| DELETE | `/api/products/:productId` | Products admin session/token and service-role configuration. |

## Orders and payment proof

| Method | Path | Authorization |
|---|---|---|
| GET | `/api/orders/admin/orders` | Orders-scoped admin session. The base router declares this GET twice; the first matching handler responds, so the later duplicate is unreachable. |
| PATCH | `/api/orders/admin/orders/:orderId/status` | Orders-scoped admin session. |
| POST | `/api/orders` | Guest checkout; backend service-role availability guard, validated order input and idempotency key. |
| POST | `/api/orders/checkout` | Guest checkout; backend service-role availability guard, validated order input and idempotency key. |
| POST | `/api/orders/query-order` | Guest lookup; normalized phone and official `order_number` must both match. |
| PATCH | `/api/orders/update-info` | Guest self-service; original phone and official order number must both match; only supported contact/shipping fields are updated. |
| POST | `/api/orders/:id/payment-proof` | Guest upload; official order number plus customer phone header, validated image bytes/type, and backend service-role availability. |
| PATCH | `/api/admin/orders/:orderId/payment-status` | Orders-scoped admin session; reviews submitted payment-proof status. |

## Reviews

Mounted at `/api`.

| Method | Path | Authorization |
|---|---|---|
| GET | `/api/products/:productId/reviews` | Public read; only public/approved review data is returned. |
| GET | `/api/reviews/summary` | Public read. |
| POST | `/api/reviews` | Same-origin guest submission; phone and official order number are checked against the purchased product. |
| POST | `/api/products/:productId/reviews` | Same-origin guest submission; phone and official order number are checked against the purchased product. |
| GET | `/api/admin/reviews` | Reviews-scoped admin session. |
| PATCH | `/api/admin/reviews/:reviewId/status` | Reviews-scoped admin session. |
| DELETE | `/api/admin/reviews/:reviewId` | Reviews-scoped admin session. |

## Customers — `/api/admin/customers`

| Method | Path | Authorization |
|---|---|---|
| GET | `/api/admin/customers` | Customers-scoped admin session and service-role configuration. |
| POST | `/api/admin/customers/:customerPhone/bind-google` | Customers-scoped admin session and service-role configuration. |
| PATCH | `/api/admin/customers/:id/credit-status` | Customers-scoped admin session and service-role configuration. |

## Customer account and order lookup — `/api/customer`

| Method | Path | Authorization |
|---|---|---|
| GET | `/api/customer/config` | Public; returns only the Supabase URL and anon key. |
| GET | `/api/customer/wishlist` | Signed customer session cookie. |
| POST | `/api/customer/wishlist` | Signed customer session cookie and same-origin request. |
| DELETE | `/api/customer/wishlist/:productId` | Signed customer session cookie and same-origin request. |
| POST | `/api/customer/member/link-phone` | Same-origin request and Google-authenticated customer session. |
| POST | `/api/customer/member/google-session` | Same-origin request and Supabase Google bearer token. |
| POST | `/api/customer/member/session` | Same-origin request; phone and order reference are verified before issuing a customer session. |
| GET | `/api/customer/member/session` | Public session-status check; reads the signed customer cookie. |
| POST | `/api/customer/member/logout` | Same-origin request; clears customer session cookie. |
| GET | `/api/customer/orders` | Signed customer session cookie. |
| POST | `/api/customer/orders/forgot` | Guest phone lookup; rate-limited. See security report: current response returns recent order metadata using phone alone. |
| POST | `/api/customer/orders/lookup` | Guest lookup; normalized phone and official `order_number` must both match. |

## Analytics

Both prefixes expose the same report handlers.

| Method | Path suffix | Authorization |
|---|---|---|
| GET | `/summary` | Admin-scoped session at `/api/admin/analytics`; configured analytics token/session at `/api/analytics`. |
| GET | `/profit` | Same as above. |
| GET | `/overview` | Same as above. |
| GET | `/sales-trend` | Same as above. |
| GET | `/top-products` | Same as above. |
| GET | `/reconciliation` | Same as above. |

Thus, for example, `/summary` is available at both `/api/admin/analytics/summary` and `/api/analytics/summary`.

## Inbound — `/api/inbound`

All paths require the inbound admin token/session and service-role write configuration.

| Method | Path |
|---|---|
| POST | `/api/inbound/receipt` |
| GET | `/api/inbound/expiring` |
| GET | `/api/inbound/batches` |
| PATCH | `/api/inbound/batches/:batchId` |
| POST | `/api/inbound/reconcile` |

## Webhook — `/api/webhook`

| Method | Path | Authorization |
|---|---|---|
| GET | `/api/webhook/whatsapp` | WhatsApp verification token/challenge. |
| POST | `/api/webhook/whatsapp` | Valid WhatsApp HMAC signature and server service-role configuration. |

## Shipping — `/api/shipping`

All paths require the shipping admin token/session. Writes also require service-role configuration; pick-list reads require database read configuration.

| Method | Path |
|---|---|
| GET | `/api/shipping/pick-list` |
| POST | `/api/shipping/bulk-tracking` |
| POST | `/api/shipping/:orderId/ship` |
| POST | `/api/shipping/:orderId/notification/retry` |

## Cutoff reminders — `/api/reminders`

All paths require a configured Bearer cron token.

| Method | Path | Authorization / configuration |
|---|---|---|
| GET | `/api/reminders/upcoming` | Cron Bearer token. |
| POST | `/api/reminders/run` | Cron Bearer token; also requires configured recipients and sender. The current route registration supplies neither, so sending is not enabled. |

## Branch scope note

This spec describes the requested F-prep base `3d46aa7`. The E-final commit currently on `origin/pj1/dev-next` (`ab2ea5a`) adds `GET /api/admin/orders` and `PATCH /api/admin/orders/:order_id/status`; those E endpoints are not present in this base branch. See [ADMIN_GUIDE_DT.md](./ADMIN_GUIDE_DT.md) for the E-final workflow and deployment caveat.
