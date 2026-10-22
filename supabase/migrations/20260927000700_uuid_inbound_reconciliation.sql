BEGIN;

DROP FUNCTION IF EXISTS public.reconcile_inbound_orders(integer);

CREATE FUNCTION public.reconcile_inbound_orders(p_order_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF p_order_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.orders
       WHERE order_id = p_order_id
     ) THEN
    RAISE EXCEPTION '找不到訂單 %', p_order_id
      USING ERRCODE = 'P0002';
  END IF;

  WITH readiness AS (
    SELECT
      oi.order_id,
      bool_and(
        oi.item_status = '已出貨'
        OR oi.item_status = '已到貨倉'
        OR oi.received_quantity >= oi.quantity
      ) AS all_ready,
      bool_or(
        oi.received_quantity > 0
        OR oi.item_status IN ('已到貨倉', '已出貨')
      ) AS any_received
    FROM public.order_items AS oi
    WHERE p_order_id IS NULL OR oi.order_id = p_order_id
    GROUP BY oi.order_id
  )
  UPDATE public.orders AS o
  SET shipping_status = CASE
    WHEN readiness.all_ready THEN '可出貨'
    WHEN readiness.any_received THEN '部分到貨'
    ELSE '待到貨'
  END
  FROM readiness
  WHERE o.order_id = readiness.order_id
    AND o.shipping_status <> '已出貨';

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'order_id', o.order_id,
        'customer_id', o.customer_id,
        'shipping_status', o.shipping_status,
        'items', (
          SELECT COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'item_id', oi.item_id,
                'product_id', oi.product_id,
                'quantity', oi.quantity,
                'received_quantity', oi.received_quantity,
                'item_status', oi.item_status,
                'reconciliation_status', CASE
                  WHEN oi.item_status = '已出貨'
                    OR oi.received_quantity >= oi.quantity THEN '已齊貨'
                  ELSE '缺貨'
                END,
                'shortage_quantity', GREATEST(oi.quantity - oi.received_quantity, 0)
              )
              ORDER BY oi.item_id
            ),
            '[]'::jsonb
          )
          FROM public.order_items AS oi
          WHERE oi.order_id = o.order_id
        )
      )
      ORDER BY o.order_date, o.order_id
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM public.orders AS o
  WHERE (p_order_id IS NULL OR o.order_id = p_order_id)
    AND EXISTS (
      SELECT 1
      FROM public.order_items AS oi
      WHERE oi.order_id = o.order_id
    );

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_product_receipt(
  p_product_id integer,
  p_quantity integer
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_product public.products%ROWTYPE;
  v_item record;
  v_remaining integer;
  v_allocation integer;
  v_new_received integer;
  v_allocated integer := 0;
  v_touched_orders uuid[] := ARRAY[]::uuid[];
  v_order_id uuid;
  v_allocations jsonb := '[]'::jsonb;
BEGIN
  IF p_product_id IS NULL OR p_product_id <= 0 THEN
    RAISE EXCEPTION 'product_id 必須是正整數'
      USING ERRCODE = '22023';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity > 100000 THEN
    RAISE EXCEPTION '入庫數量必須介乎 1 至 100000'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_product
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到商品 %', p_product_id
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.products
  SET stock = COALESCE(stock, 0) + p_quantity,
      status = CASE
        WHEN status IN ('預購中', '旅購中') THEN '已到貨'
        ELSE status
      END
  WHERE id = p_product_id
  RETURNING * INTO v_product;

  v_remaining := p_quantity;

  FOR v_item IN
    SELECT
      oi.item_id,
      oi.order_id,
      oi.quantity,
      oi.received_quantity
    FROM public.order_items AS oi
    JOIN public.orders AS o ON o.order_id = oi.order_id
    WHERE oi.product_id = p_product_id
      AND oi.item_status = '待進貨'
      AND oi.received_quantity < oi.quantity
    ORDER BY o.order_date, o.order_id, oi.item_id
    FOR UPDATE OF oi
  LOOP
    EXIT WHEN v_remaining = 0;

    v_allocation := LEAST(v_remaining, v_item.quantity - v_item.received_quantity);
    v_new_received := v_item.received_quantity + v_allocation;

    UPDATE public.order_items
    SET received_quantity = v_new_received,
        item_status = CASE
          WHEN v_new_received >= quantity THEN '已到貨倉'
          ELSE '待進貨'
        END
    WHERE item_id = v_item.item_id;

    v_remaining := v_remaining - v_allocation;
    v_allocated := v_allocated + v_allocation;
    v_touched_orders := array_append(v_touched_orders, v_item.order_id);
    v_allocations := v_allocations || jsonb_build_array(
      jsonb_build_object(
        'order_id', v_item.order_id,
        'item_id', v_item.item_id,
        'received_quantity', v_new_received,
        'ordered_quantity', v_item.quantity,
        'item_status', CASE
          WHEN v_new_received >= v_item.quantity THEN '已到貨倉'
          ELSE '待進貨'
        END
      )
    );
  END LOOP;

  FOR v_order_id IN
    SELECT DISTINCT touched.order_id
    FROM unnest(v_touched_orders) AS touched(order_id)
  LOOP
    PERFORM public.reconcile_inbound_orders(v_order_id);
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'product_id', p_product_id,
    'stock', v_product.stock,
    'product_status', v_product.status,
    'received_quantity', p_quantity,
    'allocated_quantity', v_allocated,
    'unallocated_quantity', v_remaining,
    'allocations', v_allocations
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_inbound_orders(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_product_receipt(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_inbound_orders(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_product_receipt(integer, integer) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
