BEGIN;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS google_email text;

CREATE UNIQUE INDEX IF NOT EXISTS customers_google_email_lower_uidx
  ON public.customers (lower(google_email))
  WHERE google_email IS NOT NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
