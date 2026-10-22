BEGIN;

CREATE TABLE IF NOT EXISTS public.whatsapp_payment_reports (
  provider_message_id varchar(255) PRIMARY KEY,
  order_id uuid NOT NULL
    REFERENCES public.orders(order_id)
    ON DELETE CASCADE,
  customer_phone varchar(20) NOT NULL,
  payment_reference varchar(100) NOT NULL,
  status text NOT NULL DEFAULT '待核實',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_payment_reports_status_check
    CHECK (status IN ('待核實', '已核實', '不成立')),
  CONSTRAINT whatsapp_payment_reports_phone_check
    CHECK (customer_phone ~ '^[0-9]{8,15}$')
);

ALTER TABLE public.whatsapp_payment_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.whatsapp_payment_reports FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.whatsapp_payment_reports TO service_role;

CREATE INDEX IF NOT EXISTS whatsapp_payment_reports_order_idx
  ON public.whatsapp_payment_reports (order_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.lookup_whatsapp_order(
  p_customer_phone text,
  p_order_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_order jsonb;
BEGIN
  IF p_customer_phone IS NULL
     OR p_customer_phone !~ '^[0-9]{8,15}$'
     OR p_order_id IS NULL
     OR p_order_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'WhatsApp 訂單查詢參數無效'
      USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object(
    'found', true,
    'order_id', o.order_id,
    'payment_status', o.payment_status,
    'shipping_status', o.shipping_status,
    'shipping_method', o.shipping_method,
    'tracking_number', o.tracking_number,
    'items', COALESCE(
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
            END
          )
          ORDER BY oi.item_id
        )
        FROM public.order_items AS oi
        LEFT JOIN public.products AS p
          ON p.id = oi.product_id
        WHERE oi.order_id = o.order_id
      ),
      '[]'::jsonb
    )
  )
  INTO v_order
  FROM public.orders AS o
  WHERE o.order_id::text = lower(p_order_id)
    AND regexp_replace(o.customer_phone, '^\+', '') = p_customer_phone;

  RETURN COALESCE(v_order, jsonb_build_object('found', false));
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_whatsapp_payment_report(
  p_customer_phone text,
  p_order_id text,
  p_payment_reference text,
  p_provider_message_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_inserted_message_id varchar(255);
  v_existing public.whatsapp_payment_reports%ROWTYPE;
BEGIN
  IF p_customer_phone IS NULL
     OR p_customer_phone !~ '^[0-9]{8,15}$'
     OR p_order_id IS NULL
     OR p_order_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR p_payment_reference IS NULL
     OR length(btrim(p_payment_reference)) NOT BETWEEN 1 AND 100
     OR p_provider_message_id IS NULL
     OR length(p_provider_message_id) NOT BETWEEN 1 AND 255 THEN
    RAISE EXCEPTION 'WhatsApp 付款回報資料無效'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.orders AS o
  WHERE o.order_id::text = lower(p_order_id)
    AND regexp_replace(o.customer_phone, '^\+', '') = p_customer_phone
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false, 'duplicate', false);
  END IF;

  INSERT INTO public.whatsapp_payment_reports (
    provider_message_id,
    order_id,
    customer_phone,
    payment_reference
  )
  VALUES (
    p_provider_message_id,
    p_order_id::uuid,
    p_customer_phone,
    btrim(p_payment_reference)
  )
  ON CONFLICT (provider_message_id) DO NOTHING
  RETURNING provider_message_id INTO v_inserted_message_id;

  IF v_inserted_message_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'found', true,
      'duplicate', false,
      'status', '待核實'
    );
  END IF;

  SELECT *
  INTO v_existing
  FROM public.whatsapp_payment_reports
  WHERE provider_message_id = p_provider_message_id;

  IF NOT FOUND
     OR v_existing.order_id <> p_order_id::uuid
     OR v_existing.customer_phone <> p_customer_phone THEN
    RETURN jsonb_build_object('found', false, 'duplicate', false);
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'duplicate', true,
    'status', v_existing.status
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.lookup_whatsapp_order(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_whatsapp_payment_report(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_whatsapp_order(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_whatsapp_payment_report(text, text, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
