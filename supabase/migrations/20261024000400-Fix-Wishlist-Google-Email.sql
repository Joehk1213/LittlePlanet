BEGIN;

-- 修復 wishlist 支援 Google 登入 email
ALTER TABLE public.customer_wishlists
  ADD COLUMN IF NOT EXISTS customer_email text;

-- 簡單 email 格式 check，允許 NULL
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conrelid = 'public.customer_wishlists'::regclass 
    AND conname = 'customer_wishlists_email_check'
  ) THEN
    ALTER TABLE public.customer_wishlists
      ADD CONSTRAINT customer_wishlists_email_check
      CHECK (customer_email IS NULL OR customer_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');
  END IF;
END
$$;

-- 至少 phone 或 email 其中一個要有
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conrelid = 'public.customer_wishlists'::regclass 
    AND conname = 'customer_wishlists_identity_check'
  ) THEN
    ALTER TABLE public.customer_wishlists
      ADD CONSTRAINT customer_wishlists_identity_check
      CHECK (
        (customer_phone IS NOT NULL AND customer_phone ~ '^[0-9]{8,15}$')
        OR (customer_email IS NOT NULL AND btrim(customer_email) <> '')
      );
  END IF;
END
$$;

-- phone 之前是 NOT NULL，改成可空以支援純 email 登入
ALTER TABLE public.customer_wishlists
  ALTER COLUMN customer_phone DROP NOT NULL;

CREATE INDEX IF NOT EXISTS customer_wishlists_customer_email_created_idx
  ON public.customer_wishlists (customer_email, created_at DESC, id DESC);

CREATE UNIQUE INDEX IF NOT EXISTS customer_wishlists_email_product_unique
  ON public.customer_wishlists (customer_email, product_id)
  WHERE customer_email IS NOT NULL;

NOTIFY pgrst, 'reload schema';
COMMIT;
