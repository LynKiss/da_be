-- Profitability COGS diagnostics and safe backfill.
-- Safe to re-run. It only fills missing/zero unit_cost_at_time from existing batch/product cost data.

SET SQL_SAFE_UPDATES = 0;

-- 1) Diagnose sales lines that may not have reliable COGS.
SELECT
  oi.product_id,
  oi.product_name,
  SUM(CASE
    WHEN o.order_status = 'partial_delivered' THEN oi.quantity_delivered
    ELSE oi.quantity
  END) AS fulfilled_qty,
  COALESCE(SUM(CASE
    WHEN tx.transaction_type = 'export' THEN ABS(tx.quantity_change)
    WHEN tx.transaction_type = 'return_in' THEN -ABS(tx.quantity_change)
    ELSE 0
  END), 0) AS transaction_qty,
  COALESCE(SUM(CASE
    WHEN tx.unit_cost_at_time > 0 AND tx.transaction_type = 'export' THEN ABS(tx.quantity_change)
    WHEN tx.unit_cost_at_time > 0 AND tx.transaction_type = 'return_in' THEN -ABS(tx.quantity_change)
    ELSE 0
  END), 0) AS qty_with_positive_cost,
  MAX(COALESCE(p.avg_cost, 0)) AS product_avg_cost,
  MAX(COALESCE(p.cost_price, 0)) AS product_cost_price
FROM order_items oi
JOIN orders o ON o.order_id = oi.order_id
LEFT JOIN inventory_transactions tx
  ON tx.related_order_id = oi.order_id
 AND tx.product_id = oi.product_id
 AND tx.transaction_type IN ('export', 'return_in')
LEFT JOIN products p ON p.product_id = oi.product_id
WHERE o.order_status IN ('delivered', 'partial_delivered', 'partial_returned')
GROUP BY oi.product_id, oi.product_name
HAVING fulfilled_qty > qty_with_positive_cost
ORDER BY fulfilled_qty - qty_with_positive_cost DESC;

-- 2) Diagnose batches with missing cost.
SELECT
  b.batch_id,
  b.product_id,
  p.product_name,
  b.batch_code,
  b.qty_remaining,
  b.unit_cost
FROM product_batches b
LEFT JOIN products p ON p.product_id = b.product_id
WHERE COALESCE(b.unit_cost, 0) <= 0
ORDER BY b.created_at DESC;

-- 3) Backfill transaction cost from the exact batch when available.
UPDATE inventory_transactions tx
JOIN product_batches b ON b.batch_id = tx.batch_id
SET tx.unit_cost_at_time = b.unit_cost
WHERE tx.transaction_type IN ('export', 'return_in')
  AND (tx.unit_cost_at_time IS NULL OR tx.unit_cost_at_time <= 0)
  AND b.unit_cost > 0;

-- 4) Backfill remaining legacy transactions from product avgCost/costPrice.
-- This is less precise than batch cost, so the profitability report still marks these rows as fallback.
UPDATE inventory_transactions tx
JOIN products p ON p.product_id = tx.product_id
SET tx.unit_cost_at_time = COALESCE(NULLIF(p.avg_cost, 0), NULLIF(p.cost_price, 0))
WHERE tx.transaction_type IN ('export', 'return_in')
  AND (tx.unit_cost_at_time IS NULL OR tx.unit_cost_at_time <= 0)
  AND COALESCE(NULLIF(p.avg_cost, 0), NULLIF(p.cost_price, 0)) IS NOT NULL;

-- 5) Remaining rows after this SELECT need real business data, not automatic guessed cost.
SELECT
  tx.transaction_id,
  tx.related_order_id,
  tx.product_id,
  p.product_name,
  tx.transaction_type,
  tx.quantity_change,
  tx.batch_id,
  tx.unit_cost_at_time,
  p.avg_cost,
  p.cost_price,
  tx.created_at
FROM inventory_transactions tx
LEFT JOIN products p ON p.product_id = tx.product_id
WHERE tx.transaction_type IN ('export', 'return_in')
  AND tx.related_order_id IS NOT NULL
  AND (tx.unit_cost_at_time IS NULL OR tx.unit_cost_at_time <= 0)
ORDER BY tx.created_at DESC;
