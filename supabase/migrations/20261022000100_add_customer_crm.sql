BEGIN;

CREATE TABLE IF NOT EXISTS public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_phone text NOT NULL,
  customer_name text,
  credit_status text NOT NULL DEFAULT 'normal',
  default_shipping_method text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customers_credit_status_check
    CHECK (credit_status IN ('normal', 'require_deposit', 'blacklisted'))
);

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS customer_phone text,
  ADD COLUMN IF NOT EXISTS customer_name text,
  ADD COLUMN IF NOT EXISTS credit_status text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS default_shipping_method text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.customers
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN id SET NOT NULL,
  ALTER COLUMN customer_phone SET NOT NULL,
  ALTER COLUMN credit_status SET DEFAULT 'normal',
  ALTER COLUMN credit_status SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN created_at SET NOT NULL;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'customers_credit_status_check'
      AND conrelid = 'public.customers'::regclass
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_credit_status_check
      CHECK (credit_status IN ('normal', 'require_deposit', 'blacklisted'));
  END IF;
END
$migration$;

CREATE UNIQUE INDEX IF NOT EXISTS customers_customer_phone_uidx
  ON public.customers (customer_phone);
CREATE UNIQUE INDEX IF NOT EXISTS customers_id_uidx
  ON public.customers (id);

CREATE INDEX IF NOT EXISTS customers_name_search_idx
  ON public.customers (lower(customer_name));

INSERT INTO public.customers (customer_phone)
SELECT DISTINCT btrim(o.customer_phone)
FROM public.orders AS o
WHERE o.customer_phone IS NOT NULL
  AND btrim(o.customer_phone) <> ''
ON CONFLICT (customer_phone) DO NOTHING;

CREATE OR REPLACE FUNCTION public.sync_customer_from_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.customer_phone IS NOT NULL AND btrim(NEW.customer_phone) <> '' THEN
    INSERT INTO public.customers (customer_phone)
    VALUES (btrim(NEW.customer_phone))
    ON CONFLICT (customer_phone) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS orders_sync_customer ON public.orders;
CREATE TRIGGER orders_sync_customer
AFTER INSERT ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.sync_customer_from_order();

CREATE OR REPLACE FUNCTION public.list_admin_customers(
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  customer_phone text,
  customer_name text,
  credit_status text,
  default_shipping_method text,
  notes text,
  created_at timestamptz,
  total_orders bigint,
  total_spent numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    c.id,
    c.customer_phone,
    c.customer_name,
    c.credit_status,
    c.default_shipping_method,
    c.notes,
    c.created_at,
    COUNT(o.order_id)::bigint AS total_orders,
    COALESCE(SUM(o.total_amount), 0)::numeric AS total_spent
  FROM public.customers AS c
  LEFT JOIN public.orders AS o
    ON o.customer_phone = c.customer_phone
  WHERE p_search IS NULL
     OR c.customer_phone ILIKE '%' || p_search || '%'
     OR COALESCE(c.customer_name, '') ILIKE '%' || p_search || '%'
  GROUP BY
    c.id,
    c.customer_phone,
    c.customer_name,
    c.credit_status,
    c.default_shipping_method,
    c.notes,
    c.created_at
  ORDER BY c.created_at DESC, c.id
  LIMIT p_limit
  OFFSET p_offset;
$function$;

REVOKE ALL ON TABLE public.customers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.customers TO service_role;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON FUNCTION public.sync_customer_from_order() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_admin_customers(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_admin_customers(text, integer, integer) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
