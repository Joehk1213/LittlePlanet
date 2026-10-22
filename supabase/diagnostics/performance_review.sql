SELECT
  schemaname,
  tablename,
  indexname,
  indexdef,
  pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND tablename IN (
    'orders',
    'order_items',
    'products',
    'customers',
    'shipping_notifications',
    'whatsapp_payment_reports'
  )
ORDER BY tablename, indexname;

SELECT
  schemaname,
  relname AS table_name,
  seq_scan,
  seq_tup_read,
  idx_scan,
  n_live_tup AS estimated_live_rows,
  pg_size_pretty(pg_total_relation_size(relid)) AS total_size
FROM pg_stat_user_tables
WHERE schemaname = 'public'
  AND relname IN (
    'orders',
    'order_items',
    'products',
    'customers',
    'shipping_notifications',
    'whatsapp_payment_reports'
  )
ORDER BY pg_total_relation_size(relid) DESC;
