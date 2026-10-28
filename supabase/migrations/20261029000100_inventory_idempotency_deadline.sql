BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS orders_phone_idem_key
  ON public.orders (customer_phone, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_customer_order(
  p_customer_phone text,
  p_items jsonb,
  p_customer_name text,
  p_shipping_method text,
  p_shipping_address text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_idempotency_key text;
  v_existing_order public.orders%ROWTYPE;
  v_existing_items jsonb;
  v_result jsonb;
  v_item jsonb;
  v_preorder_deadline timestamptz;
BEGIN
  IF p_idempotency_key IS NOT NULL
     AND p_idempotency_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'INVALID_IDEMPOTENCY_KEY' USING ERRCODE = '22023';
  END IF;

  v_idempotency_key := lower(p_idempotency_key);

  IF v_idempotency_key IS NOT NULL
     AND p_customer_phone ~ '^[0-9]{8,15}$' THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(p_customer_phone || ':' || v_idempotency_key, 0)
    );

    SELECT *
      INTO v_existing_order
    FROM public.orders
    WHERE customer_phone = p_customer_phone
      AND idempotency_key = v_idempotency_key;

    IF FOUND THEN
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'product_id', order_item.product_id::text,
            'product_name', COALESCE(
              NULLIF(to_jsonb(product)->>'product_name', ''),
              NULLIF(to_jsonb(product)->>'name', ''),
              '未命名商品'
            ),
            'quantity', order_item.quantity,
            'unit_price', order_item.unit_price,
            'item_status', order_item.item_status,
            'is_travel_buy', order_item.is_travel_buy
          )
          ORDER BY order_item.product_id
        ),
        '[]'::jsonb
      )
        INTO v_existing_items
      FROM public.order_items AS order_item
      LEFT JOIN public.products AS product
        ON product.id = order_item.product_id
      WHERE order_item.order_id = v_existing_order.order_id;

      RETURN jsonb_build_object(
        'order_id', v_existing_order.order_id,
        'order_number', v_existing_order.order_number,
        'order_date', v_existing_order.order_date,
        'customer_name', v_existing_order.customer_name,
        'shipping_method', v_existing_order.shipping_method,
        'shipping_address', v_existing_order.shipping_address,
        'payment_status', v_existing_order.payment_status,
        'shipping_status', v_existing_order.shipping_status,
        'total_amount', v_existing_order.total_amount,
        'items', v_existing_items
      );
    END IF;
  END IF;

  IF p_items IS NOT NULL AND jsonb_typeof(p_items) = 'array' THEN
    FOR v_item IN
      SELECT value
      FROM jsonb_array_elements(p_items)
      ORDER BY value->>'product_id'
    LOOP
      IF jsonb_typeof(v_item) = 'object'
         AND COALESCE(v_item->>'product_id', '') ~ '^[1-9][0-9]{0,18}$' THEN
        SELECT NULLIF(to_jsonb(product)->>'preorder_deadline', '')::timestamptz
          INTO v_preorder_deadline
        FROM public.products AS product
        WHERE product.id::text = v_item->>'product_id'
        FOR UPDATE;

        IF FOUND
           AND v_preorder_deadline IS NOT NULL
           AND v_preorder_deadline <= now() THEN
          RAISE EXCEPTION 'PREORDER_DEADLINE_PASSED' USING ERRCODE = 'P0001';
        END IF;
      END IF;
    END LOOP;
  END IF;

  BEGIN
    v_result := public.create_customer_order(
      p_customer_phone,
      p_items,
      p_customer_name,
      p_shipping_method,
      p_shipping_address
    );
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF p_items IS NOT NULL
         AND jsonb_typeof(p_items) = 'array'
         AND EXISTS (
           SELECT 1
           FROM jsonb_array_elements(p_items) AS entry(value)
           JOIN public.products AS product
             ON product.id::text = entry.value->>'product_id'
           WHERE NULLIF(to_jsonb(product)->>'preorder_deadline', '')::timestamptz <= now()
         ) THEN
        RAISE EXCEPTION 'PREORDER_DEADLINE_PASSED' USING ERRCODE = 'P0001';
      END IF;
      RAISE;
  END;

  IF v_idempotency_key IS NOT NULL THEN
    UPDATE public.orders
    SET idempotency_key = v_idempotency_key
    WHERE order_id = (v_result->>'order_id')::uuid
      AND customer_phone = p_customer_phone
      AND idempotency_key IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'IDEMPOTENCY_PERSISTENCE_FAILED' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_customer_order(text, jsonb, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_customer_order(text, jsonb, text, text, text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.create_customer_order(text, jsonb, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_customer_order(text, jsonb, text, text, text)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
