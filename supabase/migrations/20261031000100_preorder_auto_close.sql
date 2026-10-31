BEGIN;

CREATE INDEX IF NOT EXISTS idx_products_preorder_deadline_open
  ON public.products (preorder_deadline)
  WHERE status = '預購中' AND preorder_deadline IS NOT NULL;

CREATE OR REPLACE FUNCTION public.close_expired_preorders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  UPDATE public.products
  SET status = '已下架'
  WHERE preorder_deadline < now()
    AND status = '預購中';
END;
$function$;

COMMENT ON FUNCTION public.close_expired_preorders() IS
  '將已過 preorder_deadline 的預購中商品設為既有狀態已下架；不修改訂單、付款或物流狀態。';

REVOKE ALL ON FUNCTION public.close_expired_preorders()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_expired_preorders()
  TO service_role;

COMMIT;
