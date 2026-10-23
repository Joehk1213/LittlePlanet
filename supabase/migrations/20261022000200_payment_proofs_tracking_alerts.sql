BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_proof_url text,
  ADD COLUMN IF NOT EXISTS payment_proof_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS shipping_carrier text;

COMMENT ON COLUMN public.orders.payment_proof_url IS
  'Private payment-proofs bucket object path; issue short-lived signed URLs for admin previews.';

UPDATE public.orders
SET payment_proof_status = 'pending'
WHERE payment_proof_status IS NULL
   OR payment_proof_status NOT IN ('pending', 'verified', 'rejected');

UPDATE public.orders
SET shipping_carrier = CASE shipping_method
  WHEN '順豐' THEN 'SF Express'
  WHEN '京東' THEN 'Jump Point'
  ELSE shipping_carrier
END
WHERE tracking_number IS NOT NULL
  AND shipping_method IN ('順豐', '京東');

ALTER TABLE public.orders
  ALTER COLUMN payment_proof_status SET DEFAULT 'pending',
  ALTER COLUMN payment_proof_status SET NOT NULL,
  DROP CONSTRAINT IF EXISTS orders_payment_proof_status_check,
  ADD CONSTRAINT orders_payment_proof_status_check
    CHECK (payment_proof_status IN ('pending', 'verified', 'rejected'));

CREATE OR REPLACE FUNCTION public.set_order_shipping_carrier()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF NEW.tracking_number IS NULL OR btrim(NEW.tracking_number) = '' THEN
    NEW.shipping_carrier := NULL;
  ELSIF NEW.shipping_method = '順豐' THEN
    NEW.shipping_carrier := 'SF Express';
  ELSIF NEW.shipping_method = '京東' THEN
    NEW.shipping_carrier := 'Jump Point';
  ELSE
    NEW.shipping_carrier := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS orders_set_shipping_carrier ON public.orders;
CREATE TRIGGER orders_set_shipping_carrier
BEFORE INSERT OR UPDATE OF shipping_method, tracking_number
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.set_order_shipping_carrier();

REVOKE ALL ON FUNCTION public.set_order_shipping_carrier() FROM PUBLIC, anon, authenticated;

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'payment-proofs',
  'payment-proofs',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

NOTIFY pgrst, 'reload schema';

COMMIT;
