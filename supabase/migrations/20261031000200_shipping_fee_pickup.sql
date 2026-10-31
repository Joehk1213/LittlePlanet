BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS shipping_fee numeric(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pickup_location_id text,
  ADD COLUMN IF NOT EXISTS pickup_slot timestamptz,
  ADD COLUMN IF NOT EXISTS shipping_details_initialized boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.orders.shipping_fee IS
  '由後端根據商品重量與自取地點計算的運費；重量資料不足時依應用程式規則使用 0。';
COMMENT ON COLUMN public.orders.pickup_location_id IS
  '顧客選擇的自取地點識別碼。';
COMMENT ON COLUMN public.orders.pickup_slot IS
  '顧客選擇的自取時段。';
COMMENT ON COLUMN public.orders.shipping_details_initialized IS
  '標記運費與自取資料已由結帳 RPC 初始化，用於冪等重試。';

CREATE INDEX IF NOT EXISTS idx_orders_pickup_location
  ON public.orders (pickup_location_id)
  WHERE pickup_location_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_customer_order(
  p_customer_phone text,
  p_items jsonb,
  p_customer_name text,
  p_shipping_method text,
  p_shipping_address text,
  p_idempotency_key text,
  p_pickup_location_id text,
  p_pickup_slot timestamptz,
  p_shipping_fee numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_result jsonb;
  v_order public.orders%ROWTYPE;
  v_shipping_fee numeric(10, 2);
  v_order_id uuid;
BEGIN
  IF p_shipping_fee IS NULL OR p_shipping_fee < 0 OR p_shipping_fee > 99999999.99 THEN
    RAISE EXCEPTION 'INVALID_SHIPPING_FEE' USING ERRCODE = '22023';
  END IF;
  IF p_pickup_location_id IS NOT NULL AND btrim(p_pickup_location_id) = '' THEN
    RAISE EXCEPTION 'INVALID_PICKUP_LOCATION' USING ERRCODE = '22023';
  END IF;
  IF p_pickup_slot IS NOT NULL AND p_pickup_location_id IS NULL THEN
    RAISE EXCEPTION 'PICKUP_SLOT_REQUIRES_LOCATION' USING ERRCODE = '22023';
  END IF;
  IF p_pickup_location_id IS NOT NULL AND p_shipping_fee <> 0 THEN
    RAISE EXCEPTION 'PICKUP_FEE_MUST_BE_ZERO' USING ERRCODE = '22023';
  END IF;

  v_shipping_fee := round(p_shipping_fee, 2);

  IF p_idempotency_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(p_customer_phone || ':' || lower(p_idempotency_key), 0)
    );
  END IF;

  v_result := public.create_customer_order(
    p_customer_phone,
    p_items,
    p_customer_name,
    p_shipping_method,
    p_shipping_address,
    p_idempotency_key
  );
  v_order_id := (v_result->>'order_id')::uuid;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE order_id = v_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CHECKOUT_ORDER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_order.shipping_details_initialized THEN
    IF v_order.shipping_fee IS DISTINCT FROM v_shipping_fee
       OR v_order.pickup_location_id IS DISTINCT FROM p_pickup_location_id
       OR v_order.pickup_slot IS DISTINCT FROM p_pickup_slot THEN
      RAISE EXCEPTION 'SHIPPING_IDEMPOTENCY_MISMATCH' USING ERRCODE = '22023';
    END IF;
  ELSE
    UPDATE public.orders
    SET shipping_fee = v_shipping_fee,
        pickup_location_id = p_pickup_location_id,
        pickup_slot = p_pickup_slot,
        shipping_details_initialized = true,
        total_amount = total_amount + v_shipping_fee
    WHERE order_id = v_order_id
    RETURNING * INTO v_order;
  END IF;

  RETURN v_result || jsonb_build_object(
    'total_amount', v_order.total_amount,
    'shipping_fee', v_order.shipping_fee,
    'pickup_location_id', v_order.pickup_location_id,
    'pickup_slot', v_order.pickup_slot
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_customer_order(
  text, jsonb, text, text, text, text, text, timestamptz, numeric
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_customer_order(
  text, jsonb, text, text, text, text, text, timestamptz, numeric
) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
