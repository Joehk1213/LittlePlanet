BEGIN;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS tier_prices jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS preorder_deadline timestamptz;

CREATE OR REPLACE FUNCTION public.valid_product_tier_prices(
  p_tier_prices jsonb,
  p_base_price numeric
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
DECLARE
  v_tier jsonb;
  v_min_qty integer;
  v_previous_min_qty integer := 1;
  v_tier_price numeric;
  v_previous_price numeric := p_base_price;
  v_min_text text;
  v_price_text text;
BEGIN
  IF p_tier_prices IS NULL
     OR jsonb_typeof(p_tier_prices) <> 'array'
     OR jsonb_array_length(p_tier_prices) > 20 THEN
    RETURN false;
  END IF;

  FOR v_tier IN SELECT value FROM jsonb_array_elements(p_tier_prices)
  LOOP
    IF jsonb_typeof(v_tier) <> 'object' THEN
      RETURN false;
    END IF;
    v_min_text := v_tier->>'min_qty';
    v_price_text := v_tier->>'price';
    IF v_min_text IS NULL
       OR v_min_text !~ '^[2-9][0-9]*$'
       OR v_price_text IS NULL
       OR v_price_text !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$' THEN
      RETURN false;
    END IF;
    v_min_qty := v_min_text::integer;
    v_tier_price := v_price_text::numeric;
    IF v_min_qty > 1000
       OR v_min_qty <= v_previous_min_qty
       OR v_tier_price > v_previous_price THEN
      RETURN false;
    END IF;
    v_previous_min_qty := v_min_qty;
    v_previous_price := v_tier_price;
  END LOOP;
  RETURN true;
END;
$function$;

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_tier_prices_valid_check;
ALTER TABLE public.products
  ADD CONSTRAINT products_tier_prices_valid_check
    CHECK (public.valid_product_tier_prices(tier_prices, price));

ALTER TABLE public.product_reviews
  ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES public.orders(order_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_name text NOT NULL DEFAULT '已驗證買家',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';

UPDATE public.product_reviews
SET status = 'approved'
WHERE status = 'pending';

ALTER TABLE public.product_reviews
  DROP CONSTRAINT IF EXISTS product_reviews_status_check;
ALTER TABLE public.product_reviews
  ADD CONSTRAINT product_reviews_status_check
    CHECK (status IN ('pending', 'approved', 'rejected')),
  ADD CONSTRAINT product_reviews_customer_name_check
    CHECK (char_length(btrim(customer_name)) BETWEEN 1 AND 50);

CREATE INDEX IF NOT EXISTS product_reviews_status_created_idx
  ON public.product_reviews (status, created_at DESC, review_id DESC);

REVOKE UPDATE ON TABLE public.product_reviews FROM PUBLIC, anon, authenticated;
GRANT UPDATE ON TABLE public.product_reviews TO service_role;

CREATE OR REPLACE FUNCTION public.get_product_reviews(
  p_product_id text,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT jsonb_build_object(
    'average_rating',
    COALESCE(
      (SELECT round(avg(review.rating)::numeric, 2)::double precision
       FROM public.product_reviews AS review
       WHERE review.product_id::text = p_product_id
         AND review.status = 'approved'),
      0
    ),
    'review_count',
    (SELECT count(*)::integer
     FROM public.product_reviews AS review
     WHERE review.product_id::text = p_product_id
       AND review.status = 'approved'),
    'reviews',
    COALESCE(
      (SELECT jsonb_agg(
        jsonb_build_object(
          'review_id', page.review_id,
          'product_id', page.product_id::text,
          'rating', page.rating,
          'comment', page.comment,
          'customer_name', page.customer_name,
          'created_at', page.created_at
        )
        ORDER BY page.created_at DESC, page.review_id DESC
      )
       FROM (
         SELECT review.review_id, review.product_id, review.rating,
                review.comment, review.customer_name, review.created_at
         FROM public.product_reviews AS review
         WHERE review.product_id::text = p_product_id
           AND review.status = 'approved'
         ORDER BY review.created_at DESC, review.review_id DESC
         LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100)
         OFFSET GREATEST(COALESCE(p_offset, 0), 0)
       ) AS page),
      '[]'::jsonb
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.get_product_review_summaries(p_product_ids text[])
RETURNS TABLE (
  product_id text,
  average_rating double precision,
  review_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT
    review.product_id::text,
    round(avg(review.rating)::numeric, 2)::double precision,
    count(*)::bigint
  FROM public.product_reviews AS review
  WHERE review.status = 'approved'
    AND review.product_id::text = ANY(p_product_ids)
  GROUP BY review.product_id;
$function$;

DROP FUNCTION IF EXISTS public.create_customer_order(text, jsonb, text, text, text);

CREATE OR REPLACE FUNCTION public.create_customer_order(
  p_customer_phone text,
  p_items jsonb,
  p_customer_name text DEFAULT NULL,
  p_shipping_method text DEFAULT NULL,
  p_shipping_address text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_item jsonb;
  v_tier jsonb;
  v_product_id text;
  v_quantity integer;
  v_product record;
  v_order_id uuid := gen_random_uuid();
  v_order_items jsonb := '[]'::jsonb;
  v_total numeric(14, 2) := 0;
  v_order_date timestamptz := now();
  v_unit_price numeric(14, 2);
BEGIN
  IF p_customer_phone IS NULL
     OR p_customer_phone !~ '^[0-9]{8,15}$'
     OR p_items IS NULL
     OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION '結帳資料無效' USING ERRCODE = '22023';
  END IF;

  IF p_customer_name IS NOT NULL
     AND (length(p_customer_name) > 100 OR p_customer_name ~ '[[:cntrl:]]') THEN
    RAISE EXCEPTION '收件人姓名無效' USING ERRCODE = '22023';
  END IF;
  IF p_shipping_method IS NOT NULL
     AND p_shipping_method NOT IN ('順豐', '自取', '面交', '京東') THEN
    RAISE EXCEPTION '取貨方式無效' USING ERRCODE = '22023';
  END IF;
  IF p_shipping_address IS NOT NULL
     AND (length(p_shipping_address) > 200 OR p_shipping_address ~ '[[:cntrl:]]') THEN
    RAISE EXCEPTION '取貨地點或地址無效' USING ERRCODE = '22023';
  END IF;
  IF p_shipping_method = '順豐'
     AND p_shipping_address IS NOT NULL
     AND p_shipping_address !~ '^(順豐站|順豐智能櫃)：.+' THEN
    RAISE EXCEPTION '順豐站或智能櫃取貨資料無效' USING ERRCODE = '22023';
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
      COALESCE(to_jsonb(p)->>'is_active', 'true') AS is_active,
      COALESCE(NULLIF(to_jsonb(p)->>'tier_prices', '')::jsonb, '[]'::jsonb) AS tier_prices,
      NULLIF(to_jsonb(p)->>'preorder_deadline', '')::timestamptz AS preorder_deadline
    INTO v_product
    FROM public.products AS p
    WHERE lower(p.id::text) = lower(v_product_id)
    FOR UPDATE;

    IF NOT FOUND
       OR v_product.product_status IN ('inactive', 'archived', '停用', '下架', '已下架')
       OR v_product.is_active = 'false'
       OR v_product.preorder_deadline IS NOT NULL
          AND v_product.preorder_deadline <= now() THEN
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

    v_unit_price := v_product.unit_price;
    FOR v_tier IN SELECT value FROM jsonb_array_elements(v_product.tier_prices)
    LOOP
      IF (v_tier->>'min_qty')::integer <= v_quantity THEN
        v_unit_price := (v_tier->>'price')::numeric(14, 2);
      END IF;
    END LOOP;

    v_total := v_total + (v_unit_price * v_quantity);
    v_order_items := v_order_items || jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id,
      'product_name', v_product.product_name,
      'quantity', v_quantity,
      'unit_price', v_unit_price,
      'item_status', '待進貨',
      'is_travel_buy', false
    ));
  END LOOP;

  INSERT INTO public.orders (
    order_id,
    customer_phone,
    customer_name,
    order_date,
    payment_status,
    shipping_status,
    shipping_method,
    shipping_address,
    total_amount
  )
  VALUES (
    v_order_id,
    p_customer_phone,
    NULLIF(btrim(p_customer_name), ''),
    v_order_date,
    '未付款',
    '待到貨',
    p_shipping_method,
    NULLIF(btrim(p_shipping_address), ''),
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
    UPDATE public.products AS p
    SET stock = p.stock - (v_item->>'quantity')::integer
    WHERE lower(p.id::text) = lower(v_item->>'product_id');

    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRODUCT_UNAVAILABLE' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  IF NULLIF(btrim(p_customer_name), '') IS NOT NULL
     OR p_shipping_method IS NOT NULL
     OR NULLIF(btrim(p_shipping_address), '') IS NOT NULL THEN
    INSERT INTO public.customers (
      customer_phone,
      customer_name,
      default_shipping_method,
      default_shipping_address
    )
    VALUES (
      p_customer_phone,
      NULLIF(btrim(p_customer_name), ''),
      p_shipping_method,
      NULLIF(btrim(p_shipping_address), '')
    )
    ON CONFLICT (customer_phone) DO UPDATE
    SET customer_name = COALESCE(
          EXCLUDED.customer_name,
          public.customers.customer_name
        ),
        default_shipping_method = COALESCE(
          EXCLUDED.default_shipping_method,
          public.customers.default_shipping_method
        ),
        default_shipping_address = COALESCE(
          EXCLUDED.default_shipping_address,
          public.customers.default_shipping_address
        );
  END IF;

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'order_date', v_order_date,
    'customer_name', NULLIF(btrim(p_customer_name), ''),
    'shipping_method', p_shipping_method,
    'shipping_address', NULLIF(btrim(p_shipping_address), ''),
    'payment_status', '未付款',
    'shipping_status', '待到貨',
    'total_amount', v_total,
    'items', v_order_items
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_product_review_summaries(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_product_review_summaries(text[]) TO service_role;
REVOKE ALL ON FUNCTION public.get_product_reviews(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_product_reviews(text, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.create_customer_order(text, jsonb, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_customer_order(text, jsonb, text, text, text)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
