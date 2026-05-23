-- Order money, return quantity and refund ledger hardening.
-- MySQL 8.0.29+ / 9.x. Apply after migration_delivery_fulfillment.sql.

SET @add_return_quantity := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'returns'
      AND column_name = 'return_quantity'
  ) = 0,
  'ALTER TABLE returns ADD COLUMN return_quantity INT NULL AFTER order_item_id',
  'SELECT ''returns.return_quantity already exists'''
);
PREPARE add_return_quantity_stmt FROM @add_return_quantity;
EXECUTE add_return_quantity_stmt;
DEALLOCATE PREPARE add_return_quantity_stmt;

UPDATE returns AS r
JOIN order_items AS oi ON oi.order_item_id = r.order_item_id
SET r.return_quantity = oi.quantity
WHERE r.return_quantity IS NULL OR r.return_quantity <= 0;

ALTER TABLE returns
  MODIFY COLUMN return_quantity INT NOT NULL DEFAULT 1;

SET @add_gross_line_total := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'order_items'
      AND column_name = 'gross_line_total'
  ) = 0,
  'ALTER TABLE order_items ADD COLUMN gross_line_total DECIMAL(15, 2) NOT NULL DEFAULT 0 AFTER line_total',
  'SELECT ''order_items.gross_line_total already exists'''
);
PREPARE add_gross_line_total_stmt FROM @add_gross_line_total;
EXECUTE add_gross_line_total_stmt;
DEALLOCATE PREPARE add_gross_line_total_stmt;

SET @add_discount_allocated := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'order_items'
      AND column_name = 'discount_allocated'
  ) = 0,
  'ALTER TABLE order_items ADD COLUMN discount_allocated DECIMAL(15, 2) NOT NULL DEFAULT 0 AFTER gross_line_total',
  'SELECT ''order_items.discount_allocated already exists'''
);
PREPARE add_discount_allocated_stmt FROM @add_discount_allocated;
EXECUTE add_discount_allocated_stmt;
DEALLOCATE PREPARE add_discount_allocated_stmt;

SET @add_net_line_total := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'order_items'
      AND column_name = 'net_line_total'
  ) = 0,
  'ALTER TABLE order_items ADD COLUMN net_line_total DECIMAL(15, 2) NOT NULL DEFAULT 0 AFTER discount_allocated',
  'SELECT ''order_items.net_line_total already exists'''
);
PREPARE add_net_line_total_stmt FROM @add_net_line_total;
EXECUTE add_net_line_total_stmt;
DEALLOCATE PREPARE add_net_line_total_stmt;

UPDATE order_items
SET gross_line_total = line_total
WHERE gross_line_total = 0 AND line_total <> 0;

UPDATE order_items
SET net_line_total = GREATEST(0, gross_line_total - discount_allocated)
WHERE net_line_total = 0 AND gross_line_total <> 0;

CREATE TABLE IF NOT EXISTS order_refunds (
  refund_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id CHAR(36) NOT NULL,
  return_id BIGINT UNSIGNED NULL,
  reason ENUM('return', 'cancel_paid_order', 'short_delivery', 'manual_adjustment') NOT NULL,
  amount DECIMAL(15, 2) NOT NULL,
  refund_status ENUM('pending', 'approved', 'completed', 'failed') NOT NULL DEFAULT 'pending',
  payment_provider VARCHAR(50) NULL,
  manual_reference VARCHAR(120) NULL,
  created_by CHAR(36) NULL,
  note VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (refund_id),
  KEY idx_order_refunds_order_status (order_id, refund_status),
  KEY idx_order_refunds_return (return_id),
  CONSTRAINT fk_order_refunds_order
    FOREIGN KEY (order_id) REFERENCES orders (order_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_order_refunds_return
    FOREIGN KEY (return_id) REFERENCES returns (return_id)
    ON DELETE SET NULL
);

SELECT
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'returns'
        AND column_name = 'return_quantity'
    )
    AND (
      SELECT COUNT(*)
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'order_items'
        AND column_name IN (
          'gross_line_total',
          'discount_allocated',
          'net_line_total'
        )
    ) = 3
    AND EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = 'order_refunds'
    )
    THEN 'READY'
    ELSE 'MISSING_ORDER_REVENUE_INVENTORY_SCHEMA'
  END AS order_revenue_inventory_schema_status;
