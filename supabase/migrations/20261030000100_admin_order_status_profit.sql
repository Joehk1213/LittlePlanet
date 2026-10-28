BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_status_check;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.orders
    WHERE customer_phone IS NULL OR btrim(customer_phone) = ''
  ) THEN
    RAISE EXCEPTION 'orders.customer_phone contains missing values; resolve phone-only identity data before this migration';
  END IF;
END
$migration$;

ALTER TABLE public.orders
  ALTER COLUMN customer_phone SET NOT NULL;

UPDATE public.orders
SET status = 'shipped'
WHERE status = 'shipping';

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.orders
    WHERE status IS NULL
       OR status NOT IN ('pending', 'paid', 'shipped', 'picked_up', 'completed', 'cancelled')
  ) THEN
    RAISE EXCEPTION 'orders.status contains unsupported values; resolve them before this migration';
  END IF;
END
$migration$;

ALTER TABLE public.orders
  ALTER COLUMN status SET DEFAULT 'pending',
  ALTER COLUMN status SET NOT NULL,
  ADD CONSTRAINT orders_status_check
    CHECK (status IN ('pending', 'paid', 'shipped', 'picked_up', 'completed', 'cancelled'));

CREATE INDEX IF NOT EXISTS orders_phone_status_order_date_idx
  ON public.orders (customer_phone, status, order_date DESC);

CREATE OR REPLACE VIEW public.order_profit AS
SELECT
  orders.order_id,
  COALESCE(SUM(order_item.quantity), 0)::integer AS items_count,
  CASE
    WHEN COUNT(order_item.item_id) = 0 THEN 0::numeric
    WHEN COUNT(*) FILTER (
      WHERE product.id IS NULL OR product.cost_price IS NULL
    ) > 0 THEN NULL
    ELSE SUM(
      (order_item.unit_price - product.cost_price) * order_item.quantity
    )
  END AS profit_total
FROM public.orders AS orders
LEFT JOIN public.order_items AS order_item
  ON order_item.order_id = orders.order_id
LEFT JOIN public.products AS product
  ON product.id = order_item.product_id
GROUP BY orders.order_id;

REVOKE ALL ON TABLE public.order_profit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.order_profit TO service_role;

CREATE OR REPLACE FUNCTION public.transition_admin_order_status(
  p_order_id uuid,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_allowed boolean := false;
BEGIN
  IF p_status IS NULL
     OR p_status NOT IN ('pending', 'paid', 'shipped', 'picked_up', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'INVALID_ORDER_STATUS'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_order
  FROM public.orders
  WHERE order_id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  v_allowed := CASE v_order.status
    WHEN 'pending' THEN p_status IN ('paid', 'cancelled')
    WHEN 'paid' THEN p_status IN ('shipped', 'picked_up', 'cancelled')
    WHEN 'shipped' THEN p_status = 'completed'
    WHEN 'picked_up' THEN p_status = 'completed'
    ELSE false
  END;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'INVALID_ORDER_STATUS_TRANSITION'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_status IN ('paid', 'shipped', 'picked_up')
     AND v_order.payment_status IS DISTINCT FROM '已付清' THEN
    RAISE EXCEPTION 'ORDER_PAYMENT_NOT_VERIFIED'
      USING ERRCODE = '55000';
  END IF;

  IF p_status = 'shipped'
     AND v_order.shipping_status IS DISTINCT FROM '已出貨' THEN
    RAISE EXCEPTION 'ORDER_SHIPMENT_NOT_CONFIRMED'
      USING ERRCODE = '55000';
  END IF;

  IF p_status = 'picked_up'
     AND (
       v_order.shipping_method IS NULL
       OR v_order.shipping_method NOT IN ('面交', '自取')
     ) THEN
    RAISE EXCEPTION 'ORDER_PICKUP_METHOD_NOT_CONFIRMED'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.orders
  SET status = p_status
  WHERE order_id = p_order_id;

  RETURN jsonb_build_object(
    'order_id', v_order.order_id,
    'status', p_status
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.transition_admin_order_status(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_admin_order_status(uuid, text)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
