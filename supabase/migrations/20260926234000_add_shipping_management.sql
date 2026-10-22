BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS customer_phone varchar(20);

CREATE TABLE IF NOT EXISTS public.shipping_notifications (
  order_id uuid PRIMARY KEY
    REFERENCES public.orders(order_id)
    ON DELETE CASCADE,
  customer_phone varchar(20) NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  claimed_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shipping_notifications_status_check
    CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  CONSTRAINT shipping_notifications_attempts_check
    CHECK (attempts >= 0),
  CONSTRAINT shipping_notifications_phone_check
    CHECK (customer_phone ~ '^[0-9]{8,15}$')
);

ALTER TABLE public.shipping_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shipping_notifications FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.shipping_notifications TO service_role;

CREATE INDEX IF NOT EXISTS shipping_notifications_pending_idx
  ON public.shipping_notifications (status, claimed_at)
  WHERE status IN ('pending', 'failed', 'sending');

CREATE OR REPLACE FUNCTION public.get_shipping_pick_list(p_group_by text DEFAULT 'order')
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF p_group_by NOT IN ('order', 'product') THEN
    RAISE EXCEPTION 'group_by 只接受 order 或 product'
      USING ERRCODE = '22023';
  END IF;

  IF p_group_by = 'order' THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'order_id', ready.order_id,
          'order_date', ready.order_date,
          'shipping_method', ready.shipping_method,
          'tracking_number', ready.tracking_number,
          'items', ready.items
        )
        ORDER BY ready.order_date, ready.order_id
      ),
      '[]'::jsonb
    )
    INTO v_result
    FROM (
      SELECT
        o.order_id,
        o.order_date,
        o.shipping_method,
        o.tracking_number,
        jsonb_agg(
          jsonb_build_object(
            'item_id', oi.item_id,
            'product_id', oi.product_id,
            'product_name', COALESCE(
              to_jsonb(p)->>'product_name',
              to_jsonb(p)->>'name',
              '未命名商品'
            ),
            'quantity', oi.quantity,
            'item_status', oi.item_status
          )
          ORDER BY oi.item_id
        ) AS items
      FROM public.orders AS o
      JOIN public.order_items AS oi
        ON oi.order_id = o.order_id
      JOIN public.products AS p
        ON p.id = oi.product_id
      WHERE o.shipping_status = '可出貨'
        AND oi.item_status = '已到貨倉'
      GROUP BY
        o.order_id,
        o.order_date,
        o.shipping_method,
        o.tracking_number
    ) AS ready;
  ELSE
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'product_id', ready.product_id,
          'product_name', ready.product_name,
          'total_quantity', ready.total_quantity,
          'orders', ready.orders
        )
        ORDER BY ready.product_name, ready.product_id
      ),
      '[]'::jsonb
    )
    INTO v_result
    FROM (
      SELECT
        oi.product_id,
        COALESCE(
          to_jsonb(p)->>'product_name',
          to_jsonb(p)->>'name',
          '未命名商品'
        ) AS product_name,
        SUM(oi.quantity)::integer AS total_quantity,
        jsonb_agg(
          jsonb_build_object(
            'order_id', o.order_id,
            'item_id', oi.item_id,
            'quantity', oi.quantity
          )
          ORDER BY o.order_date, o.order_id, oi.item_id
        ) AS orders
      FROM public.orders AS o
      JOIN public.order_items AS oi
        ON oi.order_id = o.order_id
      JOIN public.products AS p
        ON p.id = oi.product_id
      WHERE o.shipping_status = '可出貨'
        AND oi.item_status = '已到貨倉'
      GROUP BY
        oi.product_id,
        COALESCE(
          to_jsonb(p)->>'product_name',
          to_jsonb(p)->>'name',
          '未命名商品'
        )
    ) AS ready;
  END IF;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ship_order(
  p_order_id integer,
  p_shipping_method text,
  p_tracking_number text,
  p_customer_phone text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_phone text;
  v_item_count integer;
  v_result jsonb;
BEGIN
  IF p_order_id IS NULL OR p_order_id <= 0 THEN
    RAISE EXCEPTION 'order_id 必須是正整數'
      USING ERRCODE = '22023';
  END IF;
  IF p_shipping_method IS NULL
     OR p_shipping_method NOT IN ('面交', '自取', '順豐', '京東') THEN
    RAISE EXCEPTION 'shipping_method 無效'
      USING ERRCODE = '22023';
  END IF;
  IF p_tracking_number IS NULL
     OR length(btrim(p_tracking_number)) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'tracking_number 必須是 1 至 100 個字元'
      USING ERRCODE = '22023';
  END IF;
  IF p_customer_phone IS NOT NULL
     AND p_customer_phone !~ '^[0-9]{8,15}$' THEN
    RAISE EXCEPTION 'customer_phone 必須是 8 至 15 位數字'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE order_id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到訂單 %', p_order_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_order.shipping_status <> '可出貨' THEN
    RAISE EXCEPTION '訂單必須處於可出貨狀態才可出貨'
      USING ERRCODE = '55000';
  END IF;

  SELECT COUNT(*)
  INTO v_item_count
  FROM public.order_items
  WHERE order_id = p_order_id;

  IF v_item_count = 0 OR EXISTS (
    SELECT 1
    FROM public.order_items
    WHERE order_id = p_order_id
      AND item_status <> '已到貨倉'
  ) THEN
    RAISE EXCEPTION '訂單明細尚未全部齊貨，不能出貨'
      USING ERRCODE = '55000';
  END IF;

  v_phone := COALESCE(p_customer_phone, v_order.customer_phone);
  IF v_phone IS NULL OR v_phone !~ '^[0-9]{8,15}$' THEN
    RAISE EXCEPTION '訂單缺少有效 WhatsApp 聯絡電話'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.orders
  SET shipping_status = '已出貨',
      shipping_method = p_shipping_method,
      tracking_number = btrim(p_tracking_number),
      customer_phone = v_phone
  WHERE order_id = p_order_id;

  UPDATE public.order_items
  SET item_status = '已出貨'
  WHERE order_id = p_order_id
    AND item_status = '已到貨倉';

  INSERT INTO public.shipping_notifications (
    order_id,
    customer_phone,
    status,
    attempts,
    claimed_at,
    sent_at,
    last_error,
    updated_at
  )
  VALUES (
    p_order_id,
    v_phone,
    'pending',
    0,
    NULL,
    NULL,
    NULL,
    now()
  )
  ON CONFLICT (order_id) DO UPDATE
  SET customer_phone = EXCLUDED.customer_phone,
      status = 'pending',
      claimed_at = NULL,
      sent_at = NULL,
      last_error = NULL,
      updated_at = now()
  WHERE public.shipping_notifications.status <> 'sent';

  SELECT jsonb_build_object(
    'order_id', p_order_id,
    'shipping_status', '已出貨',
    'shipping_method', p_shipping_method,
    'tracking_number', btrim(p_tracking_number),
    'item_count', v_item_count
  )
  INTO v_result;

  RETURN jsonb_build_object('success', true, 'shipment', v_result);
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_shipping_notification(p_order_id integer)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_notification public.shipping_notifications%ROWTYPE;
BEGIN
  UPDATE public.shipping_notifications
  SET status = 'sending',
      attempts = attempts + 1,
      claimed_at = now(),
      updated_at = now()
  WHERE order_id = p_order_id
    AND (
      status IN ('pending', 'failed')
      OR (status = 'sending' AND claimed_at < now() - interval '5 minutes')
    )
  RETURNING * INTO v_notification;

  IF NOT FOUND THEN
    SELECT *
    INTO v_notification
    FROM public.shipping_notifications
    WHERE order_id = p_order_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION '找不到出貨通知工作'
        USING ERRCODE = 'P0002';
    END IF;

    RETURN jsonb_build_object(
      'claimed', false,
      'status', v_notification.status
    );
  END IF;

  RETURN jsonb_build_object(
    'claimed', true,
    'status', v_notification.status,
    'customer_phone', v_notification.customer_phone,
    'shipping_method', (
      SELECT shipping_method FROM public.orders WHERE order_id = p_order_id
    ),
    'tracking_number', (
      SELECT tracking_number FROM public.orders WHERE order_id = p_order_id
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.finish_shipping_notification(
  p_order_id integer,
  p_success boolean,
  p_error_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_status text;
BEGIN
  IF p_success IS NULL THEN
    RAISE EXCEPTION 'success 必須有布林值'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.shipping_notifications
  SET status = CASE WHEN p_success THEN 'sent' ELSE 'failed' END,
      sent_at = CASE WHEN p_success THEN now() ELSE NULL END,
      claimed_at = NULL,
      last_error = CASE
        WHEN p_success THEN NULL
        ELSE left(COALESCE(p_error_message, 'WhatsApp 發送失敗'), 500)
      END,
      updated_at = now()
  WHERE order_id = p_order_id
    AND status = 'sending'
  RETURNING status INTO v_status;

  IF NOT FOUND THEN
    RAISE EXCEPTION '出貨通知未處於發送中狀態'
      USING ERRCODE = '55000';
  END IF;

  RETURN jsonb_build_object('status', v_status);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_shipping_pick_list(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ship_order(integer, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_shipping_notification(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_shipping_notification(integer, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_shipping_pick_list(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ship_order(integer, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_shipping_notification(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_shipping_notification(integer, boolean, text) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
