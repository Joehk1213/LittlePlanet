BEGIN;

CREATE TABLE IF NOT EXISTS public.whatsapp_payment_proof_receipts (
  message_id text PRIMARY KEY,
  customer_phone text NOT NULL,
  order_id uuid NOT NULL REFERENCES public.orders(order_id) ON DELETE CASCADE,
  order_number text NOT NULL,
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'pending_review', 'failed')),
  object_path text,
  notification_status text NOT NULL DEFAULT 'pending'
    CHECK (notification_status IN ('pending', 'not_configured', 'sent', 'failed')),
  notification_error text,
  processing_error text,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_payment_proof_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.whatsapp_payment_proof_receipts FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS whatsapp_payment_proof_receipts_order_id_idx
  ON public.whatsapp_payment_proof_receipts (order_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.claim_whatsapp_payment_proof(
  p_message_id text,
  p_customer_phone text,
  p_order_number text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_phone text;
  v_local_phone text;
  v_phones text[];
  v_order_id public.orders.order_id%TYPE;
  v_order_number text;
  v_proof_status text;
  v_match_count integer;
  v_receipt public.whatsapp_payment_proof_receipts%ROWTYPE;
  v_inserted boolean := false;
BEGIN
  v_phone := regexp_replace(COALESCE(p_customer_phone, ''), '[^0-9]', '', 'g');
  v_order_number := upper(btrim(COALESCE(p_order_number, '')));
  IF p_message_id IS NULL
     OR p_message_id !~ '^[A-Za-z0-9._:-]{1,256}$'
     OR v_phone !~ '^[0-9]{8,15}$'
     OR v_order_number !~ '^LP-[A-Z0-9][A-Z0-9-]{0,96}$' THEN
    RETURN jsonb_build_object(
      'success', false,
      'data', NULL,
      'message', '付款憑證資料格式無效。',
      'code', 'INVALID_INPUT'
    );
  END IF;

  v_local_phone := CASE
    WHEN length(v_phone) = 11 AND left(v_phone, 3) = '852' THEN substr(v_phone, 4)
    ELSE v_phone
  END;
  v_phones := ARRAY[v_phone, v_local_phone, '852' || v_local_phone];

  SELECT count(*)
    INTO v_match_count
  FROM public.orders AS o
  WHERE upper(o.order_number) = upper(btrim(p_order_number))
    AND regexp_replace(COALESCE(o.customer_phone, ''), '[^0-9]', '', 'g') = ANY(v_phones);

  IF v_match_count = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'data', NULL,
      'message', '找不到符合此電話及訂單編號的訂單。',
      'code', 'ORDER_NOT_FOUND'
    );
  END IF;
  IF v_match_count <> 1 THEN
    RETURN jsonb_build_object(
      'success', false,
      'data', NULL,
      'message', '訂單資料無法唯一識別，請聯絡管理員。',
      'code', 'AMBIGUOUS_ORDER'
    );
  END IF;

  SELECT o.order_id, o.order_number, o.payment_proof_status
    INTO v_order_id, v_order_number, v_proof_status
  FROM public.orders AS o
  WHERE upper(o.order_number) = upper(btrim(p_order_number))
    AND regexp_replace(COALESCE(o.customer_phone, ''), '[^0-9]', '', 'g') = ANY(v_phones);

  IF v_proof_status = 'verified' THEN
    RETURN jsonb_build_object(
      'success', false,
      'data', NULL,
      'message', '此訂單付款憑證已核實，不能重新提交。',
      'code', 'PROOF_ALREADY_VERIFIED'
    );
  END IF;

  INSERT INTO public.whatsapp_payment_proof_receipts (
    message_id, customer_phone, order_id, order_number
  )
  VALUES (p_message_id, v_phone, v_order_id, upper(btrim(p_order_number)))
  ON CONFLICT (message_id) DO NOTHING
  RETURNING true INTO v_inserted;

  IF NOT COALESCE(v_inserted, false) THEN
    SELECT *
      INTO v_receipt
    FROM public.whatsapp_payment_proof_receipts
    WHERE message_id = p_message_id
    FOR UPDATE;

    IF v_receipt.customer_phone <> v_phone
       OR upper(v_receipt.order_number) <> upper(btrim(p_order_number)) THEN
      RETURN jsonb_build_object(
        'success', false,
        'data', NULL,
        'message', 'WhatsApp 訊息 ID 已被其他資料使用。',
        'code', 'MESSAGE_ID_CONFLICT'
      );
    END IF;
    IF v_receipt.status = 'pending_review'
       OR (v_receipt.status = 'processing' AND v_receipt.claimed_at > now() - interval '5 minutes') THEN
      RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
          'order_id', v_receipt.order_id,
          'order_number', v_receipt.order_number,
          'duplicate', true
        ),
        'message', '此 WhatsApp 訊息已處理。'
      );
    END IF;

    UPDATE public.whatsapp_payment_proof_receipts
    SET status = 'processing',
        processing_error = NULL,
        claimed_at = now(),
        updated_at = now()
    WHERE message_id = p_message_id
    RETURNING * INTO v_receipt;
    v_order_id := v_receipt.order_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'data', jsonb_build_object(
      'order_id', v_order_id,
      'order_number', upper(btrim(p_order_number)),
      'duplicate', false
    ),
    'message', '付款憑證訂單已驗證。'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_whatsapp_payment_proof(
  p_message_id text,
  p_object_path text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_receipt public.whatsapp_payment_proof_receipts%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_old_path text;
BEGIN
  IF p_message_id IS NULL OR p_object_path IS NULL OR length(p_object_path) > 512 THEN
    RETURN jsonb_build_object('success', false, 'data', NULL, 'message', '付款憑證路徑無效。');
  END IF;

  SELECT *
    INTO v_receipt
  FROM public.whatsapp_payment_proof_receipts
  WHERE message_id = p_message_id
  FOR UPDATE;
  IF NOT FOUND OR v_receipt.status <> 'processing' THEN
    RETURN jsonb_build_object('success', false, 'data', NULL, 'message', '付款憑證處理狀態無效。');
  END IF;
  IF split_part(p_object_path, '/', 1) <> v_receipt.order_id::text THEN
    RETURN jsonb_build_object('success', false, 'data', NULL, 'message', '付款憑證未能連結至指定訂單。');
  END IF;

  SELECT *
    INTO v_order
  FROM public.orders
  WHERE order_id = v_receipt.order_id
  FOR UPDATE;
  IF NOT FOUND OR v_order.payment_proof_status = 'verified' THEN
    RETURN jsonb_build_object('success', false, 'data', NULL, 'message', '訂單不存在或憑證已核實。');
  END IF;

  v_old_path := v_order.payment_proof_url;
  UPDATE public.orders
  SET payment_proof_url = p_object_path,
      payment_proof_status = 'pending'
  WHERE order_id = v_order.order_id;

  UPDATE public.whatsapp_payment_proof_receipts
  SET status = 'pending_review',
      object_path = p_object_path,
      processing_error = NULL,
      updated_at = now()
  WHERE message_id = p_message_id;

  RETURN jsonb_build_object(
    'success', true,
    'data', jsonb_build_object(
      'order_number', v_order.order_number,
      'old_proof_path', v_old_path,
      'payment_proof_status', 'pending'
    ),
    'message', '付款憑證已儲存並等待管理員審核。'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.fail_whatsapp_payment_proof(
  p_message_id text,
  p_error text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  UPDATE public.whatsapp_payment_proof_receipts
  SET status = 'failed',
      processing_error = left(COALESCE(NULLIF(btrim(p_error), ''), '付款憑證處理失敗'), 500),
      updated_at = now()
  WHERE message_id = p_message_id
    AND status = 'processing';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'data', NULL, 'message', '付款憑證目前不可標記失敗。');
  END IF;
  RETURN jsonb_build_object('success', true, 'data', NULL, 'message', '付款憑證處理失敗已記錄。');
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_whatsapp_payment_proof_notification(
  p_message_id text,
  p_status text,
  p_error text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('not_configured', 'sent', 'failed') THEN
    RETURN jsonb_build_object('success', false, 'data', NULL, 'message', '內部通知狀態無效。');
  END IF;
  UPDATE public.whatsapp_payment_proof_receipts
  SET notification_status = p_status,
      notification_error = CASE
        WHEN p_status = 'failed' THEN left(COALESCE(p_error, '內部通知失敗'), 500)
        ELSE NULL
      END,
      updated_at = now()
  WHERE message_id = p_message_id
    AND status = 'pending_review';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'data', NULL, 'message', '付款憑證審核記錄不存在。');
  END IF;
  RETURN jsonb_build_object('success', true, 'data', jsonb_build_object('status', p_status), 'message', '內部通知狀態已更新。');
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_whatsapp_payment_proof(text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_whatsapp_payment_proof(text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_whatsapp_payment_proof(text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_whatsapp_payment_proof_notification(text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_whatsapp_payment_proof(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_whatsapp_payment_proof(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_whatsapp_payment_proof(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_whatsapp_payment_proof_notification(text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_paid_before_shipment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF NEW.shipping_status = '已出貨'
     AND NEW.payment_status IS DISTINCT FROM '已付清' THEN
    RAISE EXCEPTION '訂單必須已付清才可出貨'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS orders_require_paid_before_shipment ON public.orders;
CREATE TRIGGER orders_require_paid_before_shipment
BEFORE INSERT OR UPDATE OF shipping_status, payment_status
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.enforce_paid_before_shipment();

REVOKE ALL ON FUNCTION public.enforce_paid_before_shipment() FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';

COMMIT;
