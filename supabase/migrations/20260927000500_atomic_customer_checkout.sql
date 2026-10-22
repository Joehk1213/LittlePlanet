BEGIN;

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS received_quantity integer NOT NULL DEFAULT 0;

UPDATE public.order_items
SET received_quantity = quantity
WHERE item_status IN ('已到貨倉', '已出貨')
  AND received_quantity = 0;

ALTER TABLE public.order_items
  ALTER COLUMN received_quantity SET NOT NULL;

ALTER TABLE public.order_items
  DROP CONSTRAINT IF EXISTS order_items_received_quantity_check;

ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_received_quantity_check
    CHECK (received_quantity >= 0 AND received_quantity <= quantity);

CREATE OR REPLACE FUNCTION public.create_customer_order(
  p_customer_phone text,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_item jsonb;
  v_product_id text;
  v_quantity integer;
  v_product record;
  v_order_id uuid := gen_random_uuid();
  v_order_items jsonb := '[]'::jsonb;
  v_total numeric(14, 2) := 0;
  v_order_date timestamptz := now();
BEGIN
  IF p_customer_phone IS NULL
     OR p_customer_phone !~ '^[0-9]{8,15}$'
     OR p_items IS NULL
     OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION '結帳資料無效' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS entry(value)
    WHERE jsonb_typeof(entry.value) <> 'object'
       OR COALESCE(entry.value->>'product_id', '') = ''
       OR COALESCE(entry.value->>'quantity', '') !~ '^[1-9][0-9]*$'
       OR CASE
         WHEN COALESCE(entry.value->>'quantity', '') ~ '^[1-9][0-9]*$'
           THEN (entry.value->>'quantity')::numeric > 1000
         ELSE false
       END
  ) THEN
    RAISE EXCEPTION '商品編號或數量無效' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS entry(value)
    GROUP BY lower(entry.value->>'product_id')
    HAVING COUNT(*) > 1
        OR SUM((entry.value->>'quantity')::numeric) > 1000
  ) THEN
    RAISE EXCEPTION '重複商品或商品數量超出限制' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_items)
    ORDER BY value->>'product_id'
  LOOP
    v_product_id := v_item->>'product_id';
    v_quantity := (v_item->>'quantity')::integer;

    SELECT
      p.id::text AS id,
      COALESCE(NULLIF(to_jsonb(p)->>'product_name', ''), NULLIF(to_jsonb(p)->>'name', ''), '未命名商品') AS product_name,
      COALESCE(NULLIF(to_jsonb(p)->>'price', '')::numeric, 0)::numeric(14, 2) AS unit_price,
      COALESCE(NULLIF(to_jsonb(p)->>'stock', '')::integer, 0) AS stock,
      COALESCE(to_jsonb(p)->>'status', 'active') AS product_status,
      COALESCE(to_jsonb(p)->>'is_active', 'true') AS is_active
    INTO v_product
    FROM public.products AS p
    WHERE lower(p.id::text) = lower(v_product_id)
    FOR UPDATE;

    IF NOT FOUND
       OR v_product.product_status IN ('inactive', 'archived', '停用', '下架', '已下架')
       OR v_product.is_active = 'false' THEN
      RAISE EXCEPTION 'PRODUCT_UNAVAILABLE' USING ERRCODE = 'P0001';
    END IF;
    IF v_product.stock < v_quantity THEN
      RAISE EXCEPTION 'STOCK_UNAVAILABLE'
        USING ERRCODE = 'P0001',
              DETAIL = jsonb_build_object(
                'product_id', v_product_id,
                'product_name', v_product.product_name,
                'requested', v_quantity,
                'available', v_product.stock
              )::text;
    END IF;
    IF v_product.unit_price < 0 THEN
      RAISE EXCEPTION '商品售價無效' USING ERRCODE = '22023';
    END IF;

    v_total := v_total + (v_product.unit_price * v_quantity);
    v_order_items := v_order_items || jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id,
      'product_name', v_product.product_name,
      'quantity', v_quantity,
      'unit_price', v_product.unit_price,
      'item_status', '待進貨',
      'is_travel_buy', false
    ));
  END LOOP;

  INSERT INTO public.orders (
    order_id,
    customer_phone,
    order_date,
    payment_status,
    shipping_status,
    total_amount
  )
  VALUES (
    v_order_id,
    p_customer_phone,
    v_order_date,
    '未付款',
    '待到貨',
    v_total
  );

  INSERT INTO public.order_items (
    order_id,
    product_id,
    quantity,
    unit_price,
    item_status,
    is_travel_buy,
    received_quantity
  )
  SELECT
    v_order_id,
    p.id,
    (entry.value->>'quantity')::integer,
    (entry.value->>'unit_price')::numeric,
    entry.value->>'item_status',
    false,
    0
  FROM jsonb_array_elements(v_order_items) AS entry(value)
  JOIN public.products AS p
    ON lower(p.id::text) = lower(entry.value->>'product_id');

  IF NOT FOUND THEN
    RAISE EXCEPTION '訂單明細建立失敗' USING ERRCODE = 'P0001';
  END IF;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_items)
    ORDER BY value->>'product_id'
  LOOP
    v_product_id := v_item->>'product_id';
    v_quantity := (v_item->>'quantity')::integer;

    UPDATE public.products AS p
    SET stock = p.stock - v_quantity
    WHERE lower(p.id::text) = lower(v_product_id);

    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRODUCT_UNAVAILABLE' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'order_date', v_order_date,
    'payment_status', '未付款',
    'shipping_status', '待到貨',
    'total_amount', v_total,
    'items', v_order_items
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_customer_order(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_customer_order(text, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
