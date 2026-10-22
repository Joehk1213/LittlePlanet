BEGIN;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name = 'id'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name = 'order_id'
  ) THEN
    ALTER TABLE public.orders RENAME COLUMN id TO order_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'order_items'
      AND column_name = 'id'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'order_items'
      AND column_name = 'item_id'
  ) THEN
    ALTER TABLE public.order_items RENAME COLUMN id TO item_id;
  END IF;
END
$migration$;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS customer_id integer,
  ADD COLUMN IF NOT EXISTS order_date timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT '未付款',
  ADD COLUMN IF NOT EXISTS shipping_status text NOT NULL DEFAULT '待到貨',
  ADD COLUMN IF NOT EXISTS shipping_method text,
  ADD COLUMN IF NOT EXISTS tracking_number varchar(100);

ALTER TABLE public.orders
  ALTER COLUMN order_date SET DEFAULT now(),
  ALTER COLUMN payment_status SET DEFAULT '未付款',
  ALTER COLUMN shipping_status SET DEFAULT '待到貨';

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name = 'status'
  ) THEN
    EXECUTE $backfill$
      UPDATE public.orders
      SET status = 'pending'
      WHERE status IS NULL
    $backfill$;
    ALTER TABLE public.orders
      ALTER COLUMN status SET DEFAULT 'pending';
  END IF;
END
$migration$;

UPDATE public.orders
SET payment_status = '未付款'
WHERE payment_status IS NULL
   OR payment_status NOT IN ('未付款', '已付訂金', '已付清');

UPDATE public.orders
SET shipping_status = '待到貨'
WHERE shipping_status IS NULL
   OR shipping_status NOT IN ('待到貨', '部分到貨', '可出貨', '已出貨');

ALTER TABLE public.orders
  ALTER COLUMN payment_status SET NOT NULL,
  ALTER COLUMN shipping_status SET NOT NULL;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_payment_status_check,
  DROP CONSTRAINT IF EXISTS orders_shipping_status_check,
  DROP CONSTRAINT IF EXISTS orders_shipping_method_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_payment_status_check
    CHECK (payment_status IN ('未付款', '已付訂金', '已付清')),
  ADD CONSTRAINT orders_shipping_status_check
    CHECK (shipping_status IN ('待到貨', '部分到貨', '可出貨', '已出貨')),
  ADD CONSTRAINT orders_shipping_method_check
    CHECK (shipping_method IS NULL OR shipping_method IN ('面交', '自取', '順豐', '京東'));

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS item_status text NOT NULL DEFAULT '待進貨',
  ADD COLUMN IF NOT EXISTS is_travel_buy boolean NOT NULL DEFAULT false;

UPDATE public.order_items
SET item_status = '待進貨'
WHERE item_status IS NULL
   OR item_status NOT IN ('待進貨', '已到貨倉', '已出貨');

ALTER TABLE public.order_items
  ALTER COLUMN item_status SET NOT NULL,
  ALTER COLUMN is_travel_buy SET NOT NULL;

ALTER TABLE public.order_items
  DROP CONSTRAINT IF EXISTS order_items_item_status_check;

ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_item_status_check
  CHECK (item_status IN ('待進貨', '已到貨倉', '已出貨'));

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'order_items_order_id_fkey'
      AND conrelid = 'public.order_items'::regclass
  ) THEN
    ALTER TABLE public.order_items
      ADD CONSTRAINT order_items_order_id_fkey
      FOREIGN KEY (order_id)
      REFERENCES public.orders(order_id)
      ON DELETE CASCADE;
  END IF;

  IF to_regclass('public.customers') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'customers'
         AND column_name = 'customer_id'
     )
     AND NOT EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conname = 'orders_customer_id_fkey'
         AND conrelid = 'public.orders'::regclass
     ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_customer_id_fkey
      FOREIGN KEY (customer_id)
      REFERENCES public.customers(customer_id)
      ON DELETE SET NULL;
  END IF;
END
$migration$;

NOTIFY pgrst, 'reload schema';

COMMIT;
