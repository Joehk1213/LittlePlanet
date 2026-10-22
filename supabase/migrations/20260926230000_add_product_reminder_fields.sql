BEGIN;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS cutoff_datetime timestamptz,
  ADD COLUMN IF NOT EXISTS remind_status text,
  ADD COLUMN IF NOT EXISTS remind_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS remind_sent_at timestamptz;

ALTER TABLE public.products
  ALTER COLUMN remind_status DROP DEFAULT;

ALTER TABLE public.products
  ALTER COLUMN remind_status TYPE text
  USING remind_status::text;

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_remind_status_check;

UPDATE public.products
SET remind_status = '未提示'
WHERE remind_status IS NULL
   OR remind_status NOT IN ('未提示', '已發送提醒');

ALTER TABLE public.products
  ALTER COLUMN remind_status SET DEFAULT '未提示',
  ALTER COLUMN remind_status SET NOT NULL;

ALTER TABLE public.products
  ADD CONSTRAINT products_remind_status_check
  CHECK (remind_status IN ('未提示', '已發送提醒'));

CREATE INDEX IF NOT EXISTS products_reminder_due_idx
  ON public.products (cutoff_datetime)
  WHERE remind_status = '未提示';

NOTIFY pgrst, 'reload schema';

COMMIT;
