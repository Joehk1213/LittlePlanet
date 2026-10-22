BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';

UPDATE public.orders
SET status = CASE
  WHEN shipping_status = '已出貨' THEN 'shipping'
  ELSE 'pending'
END
WHERE status IS NULL
   OR status NOT IN ('pending', 'shipping', 'completed');

ALTER TABLE public.orders
  ALTER COLUMN status SET DEFAULT 'pending',
  ALTER COLUMN status SET NOT NULL;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check
    CHECK (status IN ('pending', 'shipping', 'completed'));

CREATE OR REPLACE FUNCTION public.lookup_customer_orders(
  p_customer_phone text,
  p_order_id uuid,
  p_rate_limit_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_request_count integer;
  v_orders jsonb;
BEGIN
  IF (p_customer_phone IS NULL) = (p_order_id IS NULL) THEN
    RAISE EXCEPTION '必須且只可提供一種查詢條件'
      USING ERRCODE = '22023';
  END IF;

  IF p_customer_phone IS NOT NULL
     AND p_customer_phone !~ '^[0-9]{8,15}$' THEN
    RAISE EXCEPTION 'customer_phone 必須是 8 至 15 位數字'
      USING ERRCODE = '22023';
  END IF;

  IF p_rate_limit_key IS NULL
     OR p_rate_limit_key !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'rate limit key 無效'
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.customer_lookup_rate_limits
  WHERE updated_at < now() - interval '1 day';

  INSERT INTO public.customer_lookup_rate_limits AS current_limit (
    rate_limit_key,
    window_started_at,
    request_count,
    updated_at
  )
  VALUES (
    p_rate_limit_key,
    now(),
    1,
    now()
  )
  ON CONFLICT (rate_limit_key) DO UPDATE
  SET window_started_at = CASE
        WHEN current_limit.window_started_at <= now() - interval '15 minutes' THEN now()
        ELSE current_limit.window_started_at
      END,
      request_count = CASE
        WHEN current_limit.window_started_at <= now() - interval '15 minutes' THEN 1
        ELSE current_limit.request_count + 1
      END,
      updated_at = now()
  RETURNING request_count INTO v_request_count;

  IF v_request_count > 10 THEN
    RETURN jsonb_build_object('rate_limited', true);
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'order_id', matching_orders.order_id,
        'order_date', matching_orders.order_date,
        'status', matching_orders.status,
        'total_amount', matching_orders.total_amount,
        'payment_status', matching_orders.payment_status,
        'shipping_status', matching_orders.shipping_status,
        'shipping_method', matching_orders.shipping_method,
        'tracking_number', matching_orders.tracking_number,
        'whatsapp_notification_status', matching_orders.whatsapp_notification_status,
        'items', matching_orders.items
      )
      ORDER BY matching_orders.order_date DESC, matching_orders.order_id DESC
    ),
    '[]'::jsonb
  )
  INTO v_orders
  FROM (
    SELECT
      o.order_id,
      o.order_date,
      o.status,
      o.total_amount,
      o.payment_status,
      o.shipping_status,
      o.shipping_method,
      o.tracking_number,
      COALESCE(sn.status, 'not_created') AS whatsapp_notification_status,
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'product_name', COALESCE(
                to_jsonb(p)->>'product_name',
                to_jsonb(p)->>'name',
                '未命名商品'
              ),
              'quantity', oi.quantity,
              'received_quantity', oi.received_quantity,
              'item_status', oi.item_status,
              'reconciliation_status', CASE
                WHEN oi.item_status = '已出貨'
                  OR oi.received_quantity >= oi.quantity THEN '已齊貨'
                WHEN oi.received_quantity > 0 THEN '部分到貨'
                ELSE '待到貨'
              END,
              'shortage_quantity', GREATEST(oi.quantity - oi.received_quantity, 0)
            )
            ORDER BY oi.item_id
          )
          FROM public.order_items AS oi
          LEFT JOIN public.products AS p ON p.id = oi.product_id
          WHERE oi.order_id = o.order_id
        ),
        '[]'::jsonb
      ) AS items
    FROM public.orders AS o
    LEFT JOIN public.shipping_notifications AS sn ON sn.order_id = o.order_id
    WHERE (
        p_customer_phone IS NULL
        OR regexp_replace(o.customer_phone, '^\+', '') = p_customer_phone
      )
      AND (p_order_id IS NULL OR o.order_id = p_order_id)
    ORDER BY o.order_date DESC, o.order_id DESC
    LIMIT 20
  ) AS matching_orders;

  RETURN jsonb_build_object(
    'rate_limited', false,
    'orders', v_orders
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.lookup_customer_orders(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_customer_orders(text, uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
