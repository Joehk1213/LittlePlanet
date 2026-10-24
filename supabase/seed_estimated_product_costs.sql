-- Estimates are assumptions, not verified supplier costs.
-- Run this preview first. After reviewing it, uncomment and run the update block.
SELECT
  id,
  name,
  price,
  ROUND(price * 0.70, 2) AS estimated_cost_price
FROM public.products
WHERE (cost_price IS NULL OR cost_price = 0)
  AND price IS NOT NULL
  AND price > 0
ORDER BY id;

-- BEGIN;
-- UPDATE public.products
-- SET cost_price = ROUND(price * 0.70, 2)
-- WHERE (cost_price IS NULL OR cost_price = 0)
--   AND price IS NOT NULL
--   AND price > 0
-- RETURNING id, name, price, cost_price;
-- COMMIT;
