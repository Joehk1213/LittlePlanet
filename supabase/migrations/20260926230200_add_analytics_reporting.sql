BEGIN;

CREATE OR REPLACE FUNCTION public.get_revenue_overview(
  p_start_date date,
  p_end_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
    RAISE EXCEPTION '日期區間無效'
      USING ERRCODE = '22023';
  END IF;
  IF p_end_date - p_start_date > 3659 THEN
    RAISE EXCEPTION '日期區間不可超過 3660 日'
      USING ERRCODE = '22023';
  END IF;

  WITH selected_orders AS (
    SELECT
      order_id,
      COALESCE(total_amount, 0)::numeric AS total_amount,
      payment_status,
      shipping_status
    FROM public.orders
    WHERE order_date >= (p_start_date::timestamp AT TIME ZONE 'Asia/Hong_Kong')
      AND order_date < ((p_end_date + 1)::timestamp AT TIME ZONE 'Asia/Hong_Kong')
  ),
  totals AS (
    SELECT
      COUNT(*)::integer AS total_orders,
      COALESCE(SUM(total_amount), 0)::numeric(14, 2) AS total_revenue,
      COUNT(*) FILTER (
        WHERE payment_status IN ('已付訂金', '已付清')
      )::integer AS paid_orders,
      COUNT(*) FILTER (
        WHERE payment_status = '未付款'
      )::integer AS unpaid_orders,
      COUNT(*) FILTER (
        WHERE shipping_status = '已出貨'
      )::integer AS shipped_orders,
      COUNT(*) FILTER (
        WHERE shipping_status <> '已出貨'
      )::integer AS unshipped_orders
    FROM selected_orders
  )
  SELECT jsonb_build_object(
    'start_date', p_start_date,
    'end_date', p_end_date,
    'total_revenue', total_revenue,
    'total_orders', total_orders,
    'paid_orders', paid_orders,
    'unpaid_orders', unpaid_orders,
    'paid_order_percentage', CASE
      WHEN total_orders = 0 THEN 0
      ELSE round(paid_orders * 100.0 / total_orders, 2)
    END,
    'unpaid_order_percentage', CASE
      WHEN total_orders = 0 THEN 0
      ELSE round(unpaid_orders * 100.0 / total_orders, 2)
    END,
    'shipped_orders', shipped_orders,
    'unshipped_orders', unshipped_orders,
    'shipped_order_percentage', CASE
      WHEN total_orders = 0 THEN 0
      ELSE round(shipped_orders * 100.0 / total_orders, 2)
    END,
    'unshipped_order_percentage', CASE
      WHEN total_orders = 0 THEN 0
      ELSE round(unshipped_orders * 100.0 / total_orders, 2)
    END
  )
  INTO v_result
  FROM totals;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_top_selling_products(
  p_start_date date,
  p_end_date date,
  p_limit integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
    RAISE EXCEPTION '日期區間無效'
      USING ERRCODE = '22023';
  END IF;
  IF p_end_date - p_start_date > 3659 THEN
    RAISE EXCEPTION '日期區間不可超過 3660 日'
      USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION '排行榜 limit 必須介乎 1 至 50'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'rank', ranked.rank,
        'product_id', ranked.product_id,
        'product_name', ranked.product_name,
        'quantity_sold', ranked.quantity_sold,
        'sales_amount', ranked.sales_amount
      )
      ORDER BY ranked.rank
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM (
    SELECT
      row_number() OVER (
        ORDER BY SUM(oi.quantity) DESC,
          SUM(oi.quantity * oi.unit_price) DESC,
          oi.product_id
      )::integer AS rank,
      oi.product_id,
      COALESCE(
        to_jsonb(p)->>'product_name',
        to_jsonb(p)->>'name',
        '未命名商品'
      ) AS product_name,
      SUM(oi.quantity)::integer AS quantity_sold,
      SUM(oi.quantity * oi.unit_price)::numeric(14, 2) AS sales_amount
    FROM public.order_items AS oi
    JOIN public.orders AS o
      ON o.order_id = oi.order_id
    LEFT JOIN public.products AS p
      ON p.id = oi.product_id
    WHERE o.order_date >= (p_start_date::timestamp AT TIME ZONE 'Asia/Hong_Kong')
      AND o.order_date < ((p_end_date + 1)::timestamp AT TIME ZONE 'Asia/Hong_Kong')
    GROUP BY
      oi.product_id,
      COALESCE(
        to_jsonb(p)->>'product_name',
        to_jsonb(p)->>'name',
        '未命名商品'
      )
    ORDER BY SUM(oi.quantity) DESC,
      SUM(oi.quantity * oi.unit_price) DESC,
      oi.product_id
    LIMIT p_limit
  ) AS ranked;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_financial_reconciliation(
  p_start_date date,
  p_end_date date,
  p_payment_status text DEFAULT NULL,
  p_shipping_status text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
    RAISE EXCEPTION '日期區間無效'
      USING ERRCODE = '22023';
  END IF;
  IF p_end_date - p_start_date > 3659 THEN
    RAISE EXCEPTION '日期區間不可超過 3660 日'
      USING ERRCODE = '22023';
  END IF;
  IF p_payment_status IS NOT NULL
     AND p_payment_status NOT IN ('未付款', '已付訂金', '已付清') THEN
    RAISE EXCEPTION '付款狀態無效'
      USING ERRCODE = '22023';
  END IF;
  IF p_shipping_status IS NOT NULL
     AND p_shipping_status NOT IN ('待到貨', '部分到貨', '可出貨', '已出貨') THEN
    RAISE EXCEPTION '出貨狀態無效'
      USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100
     OR p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'limit 或 offset 無效'
      USING ERRCODE = '22023';
  END IF;

  WITH filtered_orders AS (
    SELECT
      o.order_id,
      o.order_date,
      COALESCE(o.total_amount, 0)::numeric(14, 2) AS total_amount,
      o.payment_status,
      o.shipping_status,
      o.shipping_method,
      o.tracking_number
    FROM public.orders AS o
    WHERE o.order_date >= (p_start_date::timestamp AT TIME ZONE 'Asia/Hong_Kong')
      AND o.order_date < ((p_end_date + 1)::timestamp AT TIME ZONE 'Asia/Hong_Kong')
      AND (p_payment_status IS NULL OR o.payment_status = p_payment_status)
      AND (p_shipping_status IS NULL OR o.shipping_status = p_shipping_status)
  ),
  selected_orders AS (
    SELECT *
    FROM filtered_orders
    ORDER BY order_date DESC, order_id DESC
    LIMIT p_limit
    OFFSET p_offset
  )
  SELECT jsonb_build_object(
    'total_count', (SELECT COUNT(*)::integer FROM filtered_orders),
    'rows', COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'order_id', selected_orders.order_id,
          'order_date', selected_orders.order_date,
          'total_amount', selected_orders.total_amount,
          'payment_status', selected_orders.payment_status,
          'shipping_status', selected_orders.shipping_status,
          'shipping_method', selected_orders.shipping_method,
          'tracking_number', selected_orders.tracking_number,
          'items', (
            SELECT COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'item_id', oi.item_id,
                  'product_id', oi.product_id,
                  'product_name', COALESCE(
                    to_jsonb(p)->>'product_name',
                    to_jsonb(p)->>'name',
                    '未命名商品'
                  ),
                  'quantity', oi.quantity,
                  'unit_price', oi.unit_price,
                  'line_total', oi.quantity * oi.unit_price,
                  'item_status', oi.item_status,
                  'received_quantity', oi.received_quantity
                )
                ORDER BY oi.item_id
              ),
              '[]'::jsonb
            )
            FROM public.order_items AS oi
            LEFT JOIN public.products AS p
              ON p.id = oi.product_id
            WHERE oi.order_id = selected_orders.order_id
          )
        )
        ORDER BY selected_orders.order_date DESC, selected_orders.order_id DESC
      ),
      '[]'::jsonb
    )
  )
  INTO v_result
  FROM selected_orders;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_revenue_overview(date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_top_selling_products(date, date, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_financial_reconciliation(date, date, text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_revenue_overview(date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_top_selling_products(date, date, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_financial_reconciliation(date, date, text, text, integer, integer) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
