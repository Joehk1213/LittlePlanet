# Security Audit — DT F-prep

**Scope:** static review of route mounts/guards, order access, error/logging patterns, browser code, plus `npm audit` on base `3d46aa7`. No database connection, migration application, or live exploit testing was performed.

## Findings

| ID | Severity | Evidence | Finding and impact | Recommended action |
|---|---|---|---|---|
| SEC-01 | HIGH (dependency advisory) | `npm audit`; `xlsx` is used by `src/routes/shipping.js` for `/api/shipping/bulk-tracking`. | npm reports two high-severity SheetJS advisories: prototype pollution (`GHSA-4r6h-8v6p-xvw6`) and ReDoS (`GHSA-5pgg-2g8v-p4x9`); npm reports no available fix. The parser is reached by an authenticated shipping-admin upload and is bounded to 2 MB / 100 rows, but those limits do not remove parser risk. | Replace with a maintained, patched parser when available; until then accept only trusted files, retain size/row caps, and keep the route behind shipping authorization. |
| SEC-02 | MEDIUM (privacy) | `src/routes/customer.js`, `POST /api/customer/orders/forgot`. | A phone alone returns up to 10 order numbers, dates, totals, and payment statuses. The route is rate-limited, but there is no second factor or official order-number check before revealing order metadata. This is an order-enumeration/privacy risk when a phone number is known. | Require an additional verification factor (for example, an order-specific proof or a verified customer session) before returning order metadata. |
| SEC-03 | MEDIUM (policy mismatch) | `src/routes/customer.js`, `POST /api/customer/member/session`. | The session flow accepts either an official order number or an internal UUID in `order_id`, plus phone. The phone must match, but accepting the internal UUID conflicts with the project rule that customer verification uses the official order number, not the internal UUID. | Restrict customer verification to official `order_number` plus normalized phone; preserve UUID use for admin-only APIs. |
| SEC-04 | LOW (defense in depth) | `src/routes/orders.js`, `PATCH /api/orders/update-info`; client setup in `index.js`. | The public self-service route updates `orders` through `adminSupabase` after phone AND official order-number matching, but it does not explicitly check `serviceRoleAvailable`. With no service-role key the client falls back to anon and RLS should reject the update; with the key configured the server performs the privileged update. | Add an explicit server service-role availability guard and keep the AND identity match. This is not evidence of a browser-side anon write. |
| SEC-05 | LOW (operational/error detail) | `src/routes/products/handlers.js`, `inbound.js`, `shipping.js`, and `Routes-Analytics-Fixed.js`. | Several guarded admin handlers return raw `error.message` for selected database error codes. This can expose constraint/schema wording to an authenticated admin client. The global error middleware is generic, but route-local catches bypass it. | Map expected database errors to stable business messages; keep raw diagnostics server-side only. |
| SEC-06 | LOW (logging consistency) | Route logging scan below. | Pino HTTP middleware is installed globally, but route error handlers are inconsistent: multiple modules use `console.error`/`console.warn`, often with raw Supabase error objects, instead of structured `req.log`. This reduces consistent redaction/searchability and may put database diagnostics in unstructured logs. | Migrate route logging incrementally to Pino with allow-listed fields/codes; avoid logging raw request, phone, credential, or DB error objects. |

## Route logging and error handling scan

`req.log` and `console.error|warn|log` match counts are static grep counts, not route or incident counts. Global `pino-http` exists in `index.js`, and `src/middleware/error-handler.js` returns generic messages for uncaught request errors.

The requested combined `Select-String` scan over top-level `src/routes/*.js` returned 20 matching lines. It does not recurse into `src/routes/products/`; the module counts below use a recursive route-directory scan.

| Module | `req.log` matches | Console matches | Review note |
|---|---:|---:|---|
| `src/routes/orders.js` | 11 | 25 | Partial Pino use; checkout uses structured logging, while legacy query/update/admin handlers still log raw errors. |
| `src/routes/products/handlers.js` | 1 | 39 | Pino use is minimal; two stock RPC paths return raw database `error.message` for constraint errors. |
| `src/routes/reviews.js` | 7 | 15 | Admin moderation uses Pino; customer/public handlers still use console logging. |
| `src/routes/payments.js` | 0 | 10 | Generic client errors, but route diagnostics use console. |
| `src/routes/Routes-Analytics-Fixed.js` | 0 | 12 | Console logging; some expected-error paths return database/transport messages. |
| `src/routes/reminders.js` | 0 | 6 | Console logging; caller responses are generally generic. |
| `src/routes/webhooks.js` | 0 | 7 | Console logging; webhook body/signature handling is guarded, but structured Pino is not used. |
| `src/routes/customers.js` | 0 | 9 | Console logging; caller messages are generally generic. |
| `src/routes/customer.js` | 0 | 21 | Console logging; customer/order privacy concerns are listed separately. |
| `src/routes/inbound.js` | 0 | 17 | Console logging; selected database validation messages are returned to the admin client. |
| `src/routes/shipping.js` | 0 | 18 | Console logging; selected RPC messages are returned to the shipping admin client. |

## Access-control checks

- No browser-side `orders` table write or service-role key was found under `public/`. `public/customer.html` creates a Supabase client with the public anon key only.
- Checkout uses the backend `create_customer_order` RPC with a service-role availability guard; the migration history grants that RPC to `service_role` only. No `anon`/`authenticated` execute grant or direct browser insert was found.
- Admin writes in products, reviews, payment moderation, inbound, shipping, customer management, and order administration use their configured admin/session/token checks and/or service-role availability flags. The `PATCH /api/orders/update-info` exception is documented as SEC-04.
- `src/routes/reminders.js` uses a cron Bearer token and the anon Supabase client passed by route registration; it does not have a service-role availability guard. Its claim/update operations are therefore subject to database RLS. Sender and recipients are currently unconfigured, so the route does not send reminders.
- `src/routes/orders.js` declares `GET /admin/orders` twice; both declarations require an orders-scoped admin session, but the first response makes the second handler unreachable.

## npm audit result

`npm audit` exited with code 1: **1 high-severity vulnerability**, package `xlsx`, with the two advisories listed in SEC-01 and no npm-provided fix. Full command output is retained in `SECURITY_AUDIT_DT.log`.

No finding was changed or tested against a live database in this audit-only task.
