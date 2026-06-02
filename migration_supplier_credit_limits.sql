-- Supplier credit limit for procurement debt control.
-- Idempotent and safe to re-run.

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE suppliers ADD COLUMN credit_limit DECIMAL(15,2) NOT NULL DEFAULT 0.00 AFTER payment_terms',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'suppliers'
    AND COLUMN_NAME = 'credit_limit'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE suppliers ADD COLUMN current_debt DECIMAL(15,2) NOT NULL DEFAULT 0.00 AFTER credit_limit',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'suppliers'
    AND COLUMN_NAME = 'current_debt'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'CREATE INDEX idx_suppliers_current_debt ON suppliers (current_debt)',
    'SELECT 1'
  )
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'suppliers'
    AND INDEX_NAME = 'idx_suppliers_current_debt'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET SQL_SAFE_UPDATES = 0;

UPDATE suppliers s
LEFT JOIN (
  SELECT
    supplier_id,
    SUM(GREATEST(CAST(total_amount AS DECIMAL(15,2)) - CAST(paid_amount AS DECIMAL(15,2)), 0)) AS debt
  FROM purchase_orders
  WHERE status IN ('ordered', 'partial', 'received')
  GROUP BY supplier_id
) po_debt ON po_debt.supplier_id = s.supplier_id
SET s.current_debt = COALESCE(po_debt.debt, 0)
WHERE s.supplier_id IS NOT NULL;
