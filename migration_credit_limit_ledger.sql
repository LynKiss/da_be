-- Credit limit ledger for wholesale customer debt collection.
-- Idempotent and safe to re-run.

CREATE TABLE IF NOT EXISTS customer_credit_transactions (
  transaction_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  order_id CHAR(36) NULL,
  type ENUM('payment_received', 'sync_adjustment', 'order_payment_allocated') NOT NULL,
  amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  balance_before DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  balance_after DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  reference_no VARCHAR(120) NULL,
  note VARCHAR(500) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (transaction_id),
  KEY idx_credit_tx_user_created (user_id, created_at),
  KEY idx_credit_tx_order (order_id),
  KEY idx_credit_tx_type (type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

