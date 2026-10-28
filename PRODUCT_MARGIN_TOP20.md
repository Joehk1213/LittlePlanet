# Product Margin Top 20 (Dry Run)

- Source: `source\products.csv`
- Product records: 27
- Database access/writes: none
- Formula: `(selling price - cost_price) / cost_price`
- `retail_price` is not treated as `cost_price`.

## Data availability

No margins can be calculated: the CSV does not contain a `cost_price` column. No other column was substituted.
