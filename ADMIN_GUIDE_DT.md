# Admin Orders Guide — E-final workflow

## Availability and branch boundary

The E-final order-status/profit feature is on `origin/pj1/dev-next` at `ab2ea5a`. This F-prep branch is deliberately based on `3d46aa7` and does not include that code or migration. The endpoints below become available only after the E commit is merged/deployed and migration `20261030000100_admin_order_status_profit.sql` has been applied. This task did not apply migrations or write database data.

## Sign in

1. Sign in through the same-origin `POST /api/admin-auth/login` flow with an admin credential that includes the `orders` scope.
2. The browser receives a signed HttpOnly, SameSite=Strict session cookie. Keep it in the browser; do not copy service-role credentials into client code.

## List and review orders

`GET /api/admin/orders` accepts:

| Query | Meaning |
|---|---|
| `phone` | Optional customer phone filter; server normalizes it. |
| `status` | Optional status filter. |
| `from`, `to` | Optional ISO calendar-date range. |
| `limit`, `offset` | Pagination; page size is capped by the API. |

Each order includes `profit_total` and `items_count`. `items_count` is the sum of ordered quantities. `profit_total` is calculated from `order_items.quantity`, `order_items.unit_price`, and the current `products.cost_price`. If any item has an unknown/missing cost, profit is returned as `null`; it must not be interpreted as zero. The schema has no per-order cost snapshot, so changing a product's cost can change historical report values.

`order_id` is an internal UUID used by the admin status endpoint. Customer-facing lookup and messages must continue to use the official `order_number`, together with the normalized phone where required.

## Status transitions

Use `PATCH /api/admin/orders/:order_id/status` with JSON `{ "status": "..." }`.

| Current | Allowed next status |
|---|---|
| `pending` | `paid`, `cancelled` |
| `paid` | `shipped`, `picked_up`, `cancelled` |
| `shipped` | `completed` |
| `picked_up` | `completed` |
| `completed`, `cancelled` | Terminal |

The database RPC locks the order row and rejects invalid jumps with HTTP 409. It updates only `orders.status`; payment and logistics fields remain separate:

- Moving to `paid`, `shipped`, or `picked_up` requires `payment_status = '已付清'`, which must already have been verified through the existing payment-proof review flow.
- Moving to `shipped` additionally requires `shipping_status = '已出貨'`; complete the existing shipping workflow first.
- Moving to `picked_up` requires `shipping_method` to be `面交` or `自取`.
- Cancellation does not trigger a refund or change payment fields. Refund handling remains a separate operational action.

The migration normalizes existing `orders.status = 'shipping'` rows to `shipped`, requires non-empty customer phone values, and then tightens the status constraint. Review those preconditions before deployment; do not apply the migration blindly.

## Data/security boundaries

- Admin routes require an orders-scoped session and run through backend service-role access.
- The `order_profit` view and transition RPC are granted to `service_role`, not `anon` or `authenticated`.
- Do not expose the service-role key, cost details, internal UUIDs, or private payment-proof object paths to public pages.
- Pino order-list logs use only the last four phone digits; list and transition errors are sanitized for the caller.
