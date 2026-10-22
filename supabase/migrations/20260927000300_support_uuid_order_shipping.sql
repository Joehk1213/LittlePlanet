BEGIN;

CREATE OR REPLACE FUNCTION public.ship_order(
  p_order_id text,
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
  v_product_id public.products.id%TYPE;
  v_product public.products%ROWTYPE;
  v_required_quantity integer;
  v_phone text;
  v_item_count integer;
  v_result jsonb;
BEGIN
  IF p_order_id IS NULL OR length(btrim(p_order_id)) = 0 THEN
    RAISE EXCEPTION 'order_id 不可為空'
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
  WHERE order_id::text = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到訂單 %', p_order_id
      USING ERRCODE = 'P0002';
  END IF;

  FOR v_product_id IN
    SELECT DISTINCT p.id
    FROM public.products AS p
    JOIN public.order_items AS oi
      ON oi.product_id = p.id
    WHERE oi.order_id = v_order.order_id
    ORDER BY p.id
  LOOP
    SELECT *
    INTO v_product
    FROM public.products
    WHERE id = v_product_id
    FOR UPDATE;

    SELECT COALESCE(SUM(quantity), 0)::integer
    INTO v_required_quantity
    FROM public.order_items
    WHERE order_id = v_order.order_id
      AND product_id = v_product_id;

    IF v_product.stock < v_required_quantity THEN
      RAISE EXCEPTION '產品 % 庫存不足，不能出貨', v_product_id
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE order_id::text = p_order_id
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
  WHERE order_id = v_order.order_id;

  IF v_item_count = 0 OR EXISTS (
    SELECT 1
    FROM public.order_items
    WHERE order_id = v_order.order_id
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

  FOR v_product_id IN
    SELECT DISTINCT p.id
    FROM public.products AS p
    JOIN public.order_items AS oi
      ON oi.product_id = p.id
    WHERE oi.order_id = v_order.order_id
    ORDER BY p.id
  LOOP
    SELECT COALESCE(SUM(quantity), 0)::integer
    INTO v_required_quantity
    FROM public.order_items
    WHERE order_id = v_order.order_id
      AND product_id = v_product_id;

    UPDATE public.products
    SET stock = stock - v_required_quantity
    WHERE id = v_product_id;
  END LOOP;

  UPDATE public.orders
  SET shipping_status = '已出貨',
      shipping_method = p_shipping_method,
      tracking_number = btrim(p_tracking_number),
      customer_phone = v_phone
  WHERE order_id = v_order.order_id;

  UPDATE public.order_items
  SET item_status = '已出貨'
  WHERE order_id = v_order.order_id
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
    v_order.order_id,
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
    'order_id', v_order.order_id,
    'shipping_status', '已出貨',
    'shipping_method', p_shipping_method,
    'tracking_number', btrim(p_tracking_number),
    'item_count', v_item_count
  )
  INTO v_result;

  RETURN jsonb_build_object('success', true, 'shipment', v_result);
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_shipping_notification(p_order_id text)
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
  WHERE order_id::text = p_order_id
    AND (
      status IN ('pending', 'failed')
      OR (status = 'sending' AND claimed_at < now() - interval '5 minutes')
    )
  RETURNING * INTO v_notification;

  IF NOT FOUND THEN
    SELECT *
    INTO v_notification
    FROM public.shipping_notifications
    WHERE order_id::text = p_order_id;

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
      SELECT shipping_method
      FROM public.orders
      WHERE order_id::text = p_order_id
    ),
    'tracking_number', (
      SELECT tracking_number
      FROM public.orders
      WHERE order_id::text = p_order_id
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.finish_shipping_notification(
  p_order_id text,
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
  WHERE order_id::text = p_order_id
    AND status = 'sending'
  RETURNING status INTO v_status;

  IF NOT FOUND THEN
    RAISE EXCEPTION '出貨通知未處於發送中狀態'
      USING ERRCODE = '55000';
  END IF;

  RETURN jsonb_build_object('status', v_status);
END;
$function$;

REVOKE ALL ON FUNCTION public.ship_order(text, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_shipping_notification(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_shipping_notification(text, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ship_order(text, text, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_shipping_notification(text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_shipping_notification(text, boolean, text)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
