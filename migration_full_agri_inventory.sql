-- Inventory hardening for transfer transaction semantics.
-- MySQL 8.0.29+ / 9.x. Safe to re-run.

SET @alter_inventory_transaction_type := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'inventory_transactions'
      AND column_name = 'transaction_type'
      AND column_type LIKE '%transfer_out%'
      AND column_type LIKE '%transfer_in%'
  ) = 0,
  'ALTER TABLE inventory_transactions MODIFY COLUMN transaction_type ENUM(''import'', ''export'', ''transfer_out'', ''transfer_in'', ''adjustment'', ''return_in'', ''return_out'', ''damage'') NOT NULL',
  'SELECT ''inventory_transactions.transaction_type already supports transfer values'''
);
PREPARE alter_inventory_transaction_type_stmt FROM @alter_inventory_transaction_type;
EXECUTE alter_inventory_transaction_type_stmt;
DEALLOCATE PREPARE alter_inventory_transaction_type_stmt;

UPDATE inventory_transactions
SET related_order_id = NULL
WHERE reference_type IN ('TR', 'SR')
  AND related_order_id = reference_id;

SELECT
  CASE
    WHEN (
      SELECT COUNT(*)
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'inventory_transactions'
        AND column_name = 'transaction_type'
        AND column_type LIKE '%transfer_out%'
        AND column_type LIKE '%transfer_in%'
    ) = 1 THEN 'READY'
    ELSE 'MISSING_TRANSFER_TYPES'
  END AS migration_full_agri_inventory_status;

