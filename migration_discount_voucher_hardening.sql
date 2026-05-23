-- Voucher hardening migration - idempotent for MySQL 8+
-- Goal:
--   1. Prevent a customer from using the same voucher more than once.
--   2. Prevent duplicate usage rows for the same voucher/order.
--   3. Keep existing data by deleting exact duplicate historical rows first.

START TRANSACTION;

DELETE cu1
FROM coupon_usage cu1
JOIN coupon_usage cu2
  ON cu1.discount_id = cu2.discount_id
 AND cu1.user_id = cu2.user_id
 AND cu1.usage_id > cu2.usage_id;

DELETE cu1
FROM coupon_usage cu1
JOIN coupon_usage cu2
  ON cu1.discount_id = cu2.discount_id
 AND cu1.order_id = cu2.order_id
 AND cu1.usage_id > cu2.usage_id;

SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'coupon_usage'
    AND index_name = 'uq_coupon_usage_discount_user'
);
SET @sql := IF(
  @idx_exists = 0,
  'ALTER TABLE coupon_usage ADD UNIQUE KEY uq_coupon_usage_discount_user (discount_id, user_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'coupon_usage'
    AND index_name = 'uq_coupon_usage_discount_order'
);
SET @sql := IF(
  @idx_exists = 0,
  'ALTER TABLE coupon_usage ADD UNIQUE KEY uq_coupon_usage_discount_order (discount_id, order_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

COMMIT;
