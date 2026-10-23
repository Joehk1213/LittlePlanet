BEGIN;

CREATE TABLE IF NOT EXISTS public.whatsapp_order_intents (
  intent_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  source_message_id text NOT NULL UNIQUE,
  confirmation_message_id text UNIQUE,
  customer_phone text NOT NULL,
  items jsonb NOT NULL,
  total_amount numeric(14, 2) NOT NULL CHECK (total_amount >= 0),
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  order_id uuid REFERENCES public.orders(order_id) ON DELETE SET NULL,
  order_number text,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  CONSTRAINT whatsapp_order_intents_phone_check
    CHECK (customer_phone ~ '^[0-9]{8,15}$'),
  CONSTRAINT whatsapp_order_intents_items_check
    CHECK (
      CASE
        WHEN jsonb_typeof(items) = 'array'
          THEN jsonb_array_length(items) BETWEEN 1 AND 100
        ELSE false
      END
    ),
  CONSTRAINT whatsapp_order_intents_status_check
    CHECK (status IN ('pending', 'confirmed', 'expired'))
);

CREATE INDEX IF NOT EXISTS whatsapp_order_intents_phone_pending_idx
  ON public.whatsapp_order_intents (customer_phone, created_at DESC)
  WHERE status = 'pending';

ALTER TABLE public.whatsapp_order_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.whatsapp_order_intents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.whatsapp_order_intents TO service_role;

CREATE OR REPLACE FUNCTION public.list_whatsapp_order_catalog()
RETURNS SETOF jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT jsonb_build_object(
    'id', product.id::text,
    'product_code', to_jsonb(product)->>'product_code',
    'product_name', COALESCE(
      NULLIF(to_jsonb(product)->>'product_name', ''),
      NULLIF(to_jsonb(product)->>'name', ''),
      '未命名商品'
    ),
    'price', COALESCE(NULLIF(to_jsonb(product)->>'price', '')::numeric, 0),
    'stock', COALESCE(NULLIF(to_jsonb(product)->>'stock', '')::integer, 0),
    'status', COALESCE(to_jsonb(product)->>'status', 'active'),
    'is_active', COALESCE(to_jsonb(product)->>'is_active', 'true')::boolean,
    'tier_prices', COALESCE(NULLIF(to_jsonb(product)->>'tier_prices', '')::jsonb, '[]'::jsonb),
    'preorder_deadline', NULLIF(to_jsonb(product)->>'preorder_deadline', '')
  )
  FROM public.products AS product
  WHERE NULLIF(btrim(to_jsonb(product)->>'product_code'), '') IS NOT NULL
  ORDER BY product.id;
$function$;

CREATE OR REPLACE FUNCTION public.create_whatsapp_order_intent(
  p_customer_phone text,
  p_source_message_id text,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_existing public.whatsapp_order_intents%ROWTYPE;
  v_intent public.whatsapp_order_intents%ROWTYPE;
  v_input jsonb;
  v_product record;
  v_tier jsonb;
  v_items jsonb := '[]'::jsonb;
  v_product_id text;
  v_product_code text;
  v_quantity integer;
  v_unit_price numeric(14, 2);
  v_total numeric(14, 2) := 0;
BEGIN
  IF p_customer_phone IS NULL
     OR p_customer_phone !~ '^[0-9]{8,15}$'
     OR p_source_message_id IS NULL
     OR length(btrim(p_source_message_id)) NOT BETWEEN 1 AND 255
     OR p_items IS NULL
     OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'WhatsApp 訂單意圖資料無效'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_items) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'WhatsApp 訂單意圖商品數量無效'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.whatsapp_order_intents
  WHERE source_message_id = p_source_message_id;

  IF FOUND THEN
    IF v_existing.customer_phone <> p_customer_phone THEN
      RETURN jsonb_build_object(
        'success', false,
        'data', NULL,
        'message', '訊息 ID 已被其他客戶使用。',
        'code', 'MESSAGE_ID_CONFLICT'
      );
    END IF;
    RETURN jsonb_build_object(
      'success', true,
      'data', jsonb_build_object(
        'duplicate', true,
        'status', v_existing.status,
        'intent_token', v_existing.intent_token,
        'items', v_existing.items,
        'total_amount', v_existing.total_amount,
        'expires_at', v_existing.expires_at
      ),
      'message', '此 WhatsApp 訊息已處理。'
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS entry(value)
    WHERE jsonb_typeof(entry.value) <> 'object'
       OR COALESCE(entry.value->>'product_id', '') = ''
       OR COALESCE(entry.value->>'product_code', '') = ''
       OR COALESCE(entry.value->>'quantity', '') !~ '^[1-9][0-9]*$'
       OR CASE
         WHEN COALESCE(entry.value->>'quantity', '') ~ '^[1-9][0-9]*$'
           THEN (entry.value->>'quantity')::numeric > 1000
         ELSE false
       END
  ) THEN
    RAISE EXCEPTION 'WhatsApp 訂單商品或數量無效'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS entry(value)
    GROUP BY lower(entry.value->>'product_id')
    HAVING COUNT(*) > 1
        OR SUM((entry.value->>'quantity')::numeric) > 1000
  ) THEN
    RAISE EXCEPTION 'WhatsApp 訂單包含重複商品或超量商品'
      USING ERRCODE = '22023';
  END IF;

  FOR v_input IN
    SELECT value
    FROM jsonb_array_elements(p_items)
    ORDER BY value->>'product_id'
  LOOP
    v_product_id := v_input->>'product_id';
    v_product_code := v_input->>'product_code';
    v_quantity := (v_input->>'quantity')::integer;

    SELECT
      product.id::text AS id,
      to_jsonb(product)->>'product_code' AS product_code,
      COALESCE(
        NULLIF(to_jsonb(product)->>'product_name', ''),
        NULLIF(to_jsonb(product)->>'name', ''),
        '未命名商品'
      ) AS product_name,
      COALESCE(NULLIF(to_jsonb(product)->>'price', '')::numeric, 0)::numeric(14, 2) AS price,
      COALESCE(NULLIF(to_jsonb(product)->>'stock', '')::integer, 0) AS stock,
      COALESCE(to_jsonb(product)->>'status', 'active') AS product_status,
      COALESCE(to_jsonb(product)->>'is_active', 'true')::boolean AS is_active,
      COALESCE(NULLIF(to_jsonb(product)->>'tier_prices', '')::jsonb, '[]'::jsonb) AS tier_prices,
      NULLIF(to_jsonb(product)->>'preorder_deadline', '')::timestamptz AS preorder_deadline
    INTO v_product
    FROM public.products AS product
    WHERE product.id::text = v_product_id
    FOR SHARE;

    IF NOT FOUND
       OR v_product.product_code IS DISTINCT FROM v_product_code
       OR v_product.product_status IN ('inactive', 'archived', '停用', '下架', '已下架')
       OR NOT v_product.is_active
       OR v_product.preorder_deadline IS NOT NULL
          AND v_product.preorder_deadline <= now() THEN
      RETURN jsonb_build_object(
        'success', false,
        'data', NULL,
        'message', '商品已下架、截單或資料已變更，請重新提交。',
        'code', 'PRODUCT_UNAVAILABLE'
      );
    END IF;

    IF v_product.stock < v_quantity THEN
      RETURN jsonb_build_object(
        'success', false,
        'data', jsonb_build_object(
          'product_code', v_product.product_code,
          'available', v_product.stock,
          'requested', v_quantity
        ),
        'message', '商品庫存不足，請調整數量後再試。',
        'code', 'STOCK_UNAVAILABLE'
      );
    END IF;
    IF v_product.price < 0 THEN
      RAISE EXCEPTION '商品售價無效'
        USING ERRCODE = '22023';
    END IF;

    v_unit_price := v_product.price;
    FOR v_tier IN
      SELECT value FROM jsonb_array_elements(v_product.tier_prices)
    LOOP
      IF (v_tier->>'min_qty')::integer <= v_quantity THEN
        v_unit_price := (v_tier->>'price')::numeric(14, 2);
      END IF;
    END LOOP;

    v_total := v_total + (v_unit_price * v_quantity);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id,
      'product_code', v_product.product_code,
      'product_name', v_product.product_name,
      'quantity', v_quantity,
      'unit_price', v_unit_price,
      'subtotal', v_unit_price * v_quantity
    ));
  END LOOP;

  INSERT INTO public.whatsapp_order_intents (
    source_message_id,
    customer_phone,
    items,
    total_amount
  )
  VALUES (
    p_source_message_id,
    p_customer_phone,
    v_items,
    v_total
  )
  ON CONFLICT (source_message_id) DO NOTHING
  RETURNING * INTO v_intent;

  IF NOT FOUND THEN
    SELECT *
    INTO v_existing
    FROM public.whatsapp_order_intents
    WHERE source_message_id = p_source_message_id;

    IF NOT FOUND OR v_existing.customer_phone <> p_customer_phone THEN
      RETURN jsonb_build_object(
        'success', false,
        'data', NULL,
        'message', '訊息 ID 已被其他客戶使用。',
        'code', 'MESSAGE_ID_CONFLICT'
      );
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'data', jsonb_build_object(
        'duplicate', true,
        'status', v_existing.status,
        'intent_token', v_existing.intent_token,
        'items', v_existing.items,
        'total_amount', v_existing.total_amount,
        'expires_at', v_existing.expires_at
      ),
      'message', '此 WhatsApp 訊息已處理。'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'data', jsonb_build_object(
      'duplicate', false,
      'status', v_intent.status,
      'intent_token', v_intent.intent_token,
      'items', v_intent.items,
      'total_amount', v_intent.total_amount,
      'expires_at', v_intent.expires_at
    ),
    'message', '訂單預覽已建立，等待客戶確認。'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_whatsapp_order_intent(
  p_customer_phone text,
  p_intent_token uuid,
  p_confirmation_message_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_intent public.whatsapp_order_intents%ROWTYPE;
  v_existing public.whatsapp_order_intents%ROWTYPE;
  v_order jsonb;
  v_order_id uuid;
  v_order_number text;
BEGIN
  IF p_customer_phone IS NULL
     OR p_customer_phone !~ '^[0-9]{8,15}$'
     OR p_intent_token IS NULL
     OR p_confirmation_message_id IS NULL
     OR length(btrim(p_confirmation_message_id)) NOT BETWEEN 1 AND 255 THEN
    RAISE EXCEPTION 'WhatsApp 訂單確認資料無效'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.whatsapp_order_intents
  WHERE confirmation_message_id = p_confirmation_message_id;

  IF FOUND THEN
    IF v_existing.customer_phone <> p_customer_phone THEN
      RETURN jsonb_build_object(
        'success', false,
        'data', NULL,
        'message', '確認訊息 ID 已被其他客戶使用。',
        'code', 'MESSAGE_ID_CONFLICT'
      );
    END IF;
    RETURN jsonb_build_object(
      'success', true,
      'data', jsonb_build_object(
        'duplicate', true,
        'status', v_existing.status,
        'order_number', v_existing.order_number
      ),
      'message', '此確認訊息已處理。'
    );
  END IF;

  SELECT *
  INTO v_intent
  FROM public.whatsapp_order_intents
  WHERE customer_phone = p_customer_phone
    AND intent_token = p_intent_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'data', NULL,
      'message', '找不到此電話號碼對應的待確認訂單。',
      'code', 'INTENT_NOT_FOUND'
    );
  END IF;

  IF v_intent.status = 'confirmed' THEN
    RETURN jsonb_build_object(
      'success', true,
      'data', jsonb_build_object(
        'duplicate', true,
        'status', v_intent.status,
        'order_number', v_intent.order_number
      ),
      'message', '此訂單已確認。'
    );
  END IF;

  IF v_intent.status = 'expired' OR v_intent.expires_at <= now() THEN
    UPDATE public.whatsapp_order_intents
    SET status = 'expired'
    WHERE intent_id = v_intent.intent_id
      AND status = 'pending';
    RETURN jsonb_build_object(
      'success', false,
      'data', NULL,
      'message', '訂單預覽已過期，請重新提交商品。',
      'code', 'INTENT_EXPIRED'
    );
  END IF;

  SELECT public.create_customer_order(
    p_customer_phone,
    (
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', item.value->>'product_id',
        'quantity', (item.value->>'quantity')::integer
      ))
      FROM jsonb_array_elements(v_intent.items) AS item(value)
    ),
    NULL,
    NULL,
    NULL
  )
  INTO v_order;

  v_order_id := NULLIF(v_order->>'order_id', '')::uuid;
  IF v_order_id IS NULL THEN
    RAISE EXCEPTION '結帳 RPC 未回傳有效訂單識別碼'
      USING ERRCODE = 'P0001';
  END IF;

  v_order_number := v_order->>'order_number';
  IF v_order_number IS NULL
     OR v_order_number !~* '^LP-[0-9]{8}-[A-F0-9]{8}$'
     OR v_order_number ~* '^[0-9a-f]{8}-[0-9a-f-]{27}$' THEN
    v_order_number := 'LP-' ||
      to_char(now() AT TIME ZONE 'Asia/Hong_Kong', 'YYYYMMDD') ||
      '-' || upper(substr(md5(gen_random_uuid()::text), 1, 8));
  END IF;

  UPDATE public.orders
  SET order_number = v_order_number
  WHERE order_id = v_order_id
    AND (
      order_number IS NULL
      OR btrim(order_number) = ''
      OR order_number !~* '^LP-[0-9]{8}-[A-F0-9]{8}$'
    )
  RETURNING order_number INTO v_order_number;

  IF NOT FOUND THEN
    SELECT order_number
    INTO v_order_number
    FROM public.orders
    WHERE order_id = v_order_id;
  END IF;

  IF v_order_number IS NULL
     OR v_order_number !~* '^LP-[0-9]{8}-[A-F0-9]{8}$' THEN
    RAISE EXCEPTION '無法產生有效正式訂單編號'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.whatsapp_order_intents
  SET status = 'confirmed',
      confirmation_message_id = p_confirmation_message_id,
      order_id = v_order_id,
      order_number = v_order_number,
      confirmed_at = now()
  WHERE intent_id = v_intent.intent_id
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION '訂單意圖狀態已變更，無法完成確認'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'data', jsonb_build_object(
      'duplicate', false,
      'status', 'confirmed',
      'order_number', v_order_number,
      'total_amount', v_order->'total_amount'
    ),
    'message', '訂單已建立，付款狀態為未付款。'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.list_whatsapp_order_catalog() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_whatsapp_order_intent(text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.confirm_whatsapp_order_intent(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_whatsapp_order_catalog() TO service_role;
GRANT EXECUTE ON FUNCTION public.create_whatsapp_order_intent(text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_whatsapp_order_intent(text, uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
