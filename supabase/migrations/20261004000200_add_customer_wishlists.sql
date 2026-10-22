BEGIN;

DO $migration$
DECLARE
  product_id_type text;
BEGIN
  SELECT format_type(attribute.atttypid, attribute.atttypmod)
    INTO product_id_type
  FROM pg_attribute AS attribute
  WHERE attribute.attrelid = 'public.products'::regclass
    AND attribute.attname = 'id'
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped;

  IF product_id_type IS NULL THEN
    RAISE EXCEPTION 'public.products.id is required before adding customer wishlists';
  END IF;

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS public.customer_wishlists (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_phone text NOT NULL CHECK (customer_phone ~ ''^[0-9]{8,15}$''),
      product_id %s NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT customer_wishlists_customer_product_unique UNIQUE (customer_phone, product_id)
    )',
    product_id_type
  );
END
$migration$;

CREATE INDEX IF NOT EXISTS customer_wishlists_customer_created_idx
  ON public.customer_wishlists (customer_phone, created_at DESC, id DESC);

ALTER TABLE public.customer_wishlists ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.customer_wishlists FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.customer_wishlists TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
