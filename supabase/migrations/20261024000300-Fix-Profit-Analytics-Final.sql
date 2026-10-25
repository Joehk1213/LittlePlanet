BEGIN;

-- Final fix for analytics: ensure cost_price exists, add indexes, and reload schema
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS cost_price numeric(14,2);

DO $m$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'public.products'::regclass AND conname = 'products_cost_price_nonnegative_check'
  ) THEN
    ALTER TABLE public.products ADD CONSTRAINT products_cost_price_nonnegative_check CHECK (cost_price IS NULL OR cost_price >= 0);
  END IF;
END
$m$;

-- Helpful indexes for analytics fallback path
CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON public.order_items (order_id);
CREATE INDEX IF NOT EXISTS order_items_product_id_idx ON public.order_items (product_id);
CREATE INDEX IF NOT EXISTS orders_order_date_idx ON public.orders (order_date DESC);

-- Ensure profit dashboard can read
COMMENT ON COLUMN public.products.cost_price IS 'Internal per-unit cost used by admin profit analytics; NULL means cost is unknown (treated as 0 in fallback).';

NOTIFY pgrst, 'reload schema';
COMMIT;
