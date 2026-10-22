BEGIN;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS status text;

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_status_check;

ALTER TABLE public.products
  ALTER COLUMN status DROP DEFAULT;

ALTER TABLE public.products
  ALTER COLUMN status TYPE text
  USING status::text;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'products'
      AND column_name = 'is_active'
  ) THEN
    EXECUTE $backfill$
      UPDATE public.products
      SET status = CASE
        WHEN is_active IS FALSE THEN '已下架'
        ELSE '預購中'
      END
      WHERE status IS NULL
         OR status NOT IN ('預購中', '旅購中', '已到貨', '已下架')
    $backfill$;
  ELSE
    UPDATE public.products
    SET status = '預購中'
    WHERE status IS NULL
       OR status NOT IN ('預購中', '旅購中', '已到貨', '已下架');
  END IF;
END
$migration$;

ALTER TABLE public.products
  ALTER COLUMN status SET DEFAULT '預購中',
  ALTER COLUMN status SET NOT NULL;

ALTER TABLE public.products
  ADD CONSTRAINT products_status_check
  CHECK (status IN ('預購中', '旅購中', '已到貨', '已下架'));

COMMIT;
