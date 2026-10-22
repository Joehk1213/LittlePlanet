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
    RAISE EXCEPTION 'public.products.id is required before adding product reviews';
  END IF;

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS public.product_reviews (
      review_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id %s NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
      customer_phone text NOT NULL CHECK (customer_phone ~ ''^[0-9]{8,15}$''),
      rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment text NOT NULL CHECK (char_length(btrim(comment)) BETWEEN 1 AND 1000),
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT product_reviews_customer_product_unique UNIQUE (product_id, customer_phone)
    )',
    product_id_type
  );
END
$migration$;

CREATE INDEX IF NOT EXISTS product_reviews_product_created_idx
  ON public.product_reviews (product_id, created_at DESC, review_id DESC);

CREATE INDEX IF NOT EXISTS product_reviews_product_text_created_idx
  ON public.product_reviews ((product_id::text), created_at DESC, review_id DESC);

CREATE INDEX IF NOT EXISTS order_items_review_product_text_order_idx
  ON public.order_items ((product_id::text), order_id);

ALTER TABLE public.product_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.product_reviews FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.product_reviews TO service_role;

CREATE OR REPLACE FUNCTION public.get_product_reviews(
  p_product_id text,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT jsonb_build_object(
    'average_rating',
    COALESCE(
      (SELECT round(avg(review.rating)::numeric, 2)::double precision
       FROM public.product_reviews AS review
       WHERE review.product_id::text = p_product_id),
      0
    ),
    'review_count',
    (SELECT count(*)::integer
     FROM public.product_reviews AS review
     WHERE review.product_id::text = p_product_id),
    'reviews',
    COALESCE(
      (SELECT jsonb_agg(
        jsonb_build_object(
          'review_id', page.review_id,
          'product_id', page.product_id::text,
          'rating', page.rating,
          'comment', page.comment,
          'created_at', page.created_at
        )
        ORDER BY page.created_at DESC, page.review_id DESC
      )
       FROM (
         SELECT review.review_id, review.product_id, review.rating, review.comment, review.created_at
         FROM public.product_reviews AS review
         WHERE review.product_id::text = p_product_id
         ORDER BY review.created_at DESC, review.review_id DESC
         LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100)
         OFFSET GREATEST(COALESCE(p_offset, 0), 0)
       ) AS page),
      '[]'::jsonb
    )
  );
$function$;

REVOKE ALL ON FUNCTION public.get_product_reviews(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_product_reviews(text, integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.has_customer_purchased_product(
  p_customer_phone text,
  p_product_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.orders AS customer_order
    JOIN public.order_items AS purchased_item
      ON purchased_item.order_id = customer_order.order_id
    WHERE customer_order.customer_phone IN (p_customer_phone, '+' || p_customer_phone)
      AND purchased_item.product_id::text = p_product_id
  );
$function$;

REVOKE ALL ON FUNCTION public.has_customer_purchased_product(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_customer_purchased_product(text, text) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
