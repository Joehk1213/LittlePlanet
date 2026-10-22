BEGIN;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS stock integer NOT NULL DEFAULT 0;

ALTER TABLE public.products
  ALTER COLUMN stock SET DEFAULT 0;

UPDATE public.products
SET stock = 0
WHERE stock IS NULL;

ALTER TABLE public.products
  ALTER COLUMN stock SET NOT NULL;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_stock_nonnegative_check'
      AND conrelid = 'public.products'::regclass
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_stock_nonnegative_check
      CHECK (stock >= 0);
  END IF;
END
$migration$;

CREATE OR REPLACE FUNCTION public.set_product_stock(
  p_product_id text,
  p_stock integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_product public.products%ROWTYPE;
BEGIN
  IF p_product_id IS NULL OR length(btrim(p_product_id)) = 0 THEN
    RAISE EXCEPTION 'product_id 不可為空'
      USING ERRCODE = '22023';
  END IF;

  IF p_stock IS NULL OR p_stock < 0 THEN
    RAISE EXCEPTION 'stock 必須是非負整數'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_product
  FROM public.products
  WHERE id::text = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到產品 %', p_product_id
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.products
  SET stock = p_stock
  WHERE id::text = p_product_id
  RETURNING * INTO v_product;

  RETURN jsonb_build_object(
    'success', true,
    'product_id', v_product.id::text,
    'stock', v_product.stock,
    'status', v_product.status
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.set_product_stock(text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_product_stock(text, integer)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
