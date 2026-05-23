-- Delivery / pickup normalization for checkout.
-- MySQL 8.0.29+ / 9.x: safe to re-run when TYPEORM_SYNC is disabled.
-- Verify the final schema check at the bottom returns READY before restarting API.

SET @add_free_shipping_threshold := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'delivery_methods'
      AND column_name = 'free_shipping_threshold'
  ) = 0,
  'ALTER TABLE delivery_methods ADD COLUMN free_shipping_threshold DECIMAL(15, 2) NULL AFTER min_order_amount',
  'SELECT ''delivery_methods.free_shipping_threshold already exists'''
);
PREPARE add_free_shipping_threshold_stmt FROM @add_free_shipping_threshold;
EXECUTE add_free_shipping_threshold_stmt;
DEALLOCATE PREPARE add_free_shipping_threshold_stmt;

SET @add_eta_min_days := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'delivery_methods'
      AND column_name = 'eta_min_days'
  ) = 0,
  'ALTER TABLE delivery_methods ADD COLUMN eta_min_days INT NULL AFTER free_shipping_threshold',
  'SELECT ''delivery_methods.eta_min_days already exists'''
);
PREPARE add_eta_min_days_stmt FROM @add_eta_min_days;
EXECUTE add_eta_min_days_stmt;
DEALLOCATE PREPARE add_eta_min_days_stmt;

SET @add_eta_max_days := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'delivery_methods'
      AND column_name = 'eta_max_days'
  ) = 0,
  'ALTER TABLE delivery_methods ADD COLUMN eta_max_days INT NULL AFTER eta_min_days',
  'SELECT ''delivery_methods.eta_max_days already exists'''
);
PREPARE add_eta_max_days_stmt FROM @add_eta_max_days;
EXECUTE add_eta_max_days_stmt;
DEALLOCATE PREPARE add_eta_max_days_stmt;

CREATE TABLE IF NOT EXISTS delivery_method_areas (
  delivery_area_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  delivery_id BIGINT UNSIGNED NOT NULL,
  province VARCHAR(120) NOT NULL,
  district VARCHAR(120) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (delivery_area_id),
  KEY idx_delivery_method_areas_delivery (delivery_id),
  CONSTRAINT fk_delivery_method_areas_delivery
    FOREIGN KEY (delivery_id) REFERENCES delivery_methods (delivery_id)
    ON DELETE CASCADE
);

SET @add_fulfillment_type := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'orders'
      AND column_name = 'fulfillment_type'
  ) = 0,
  'ALTER TABLE orders ADD COLUMN fulfillment_type VARCHAR(20) NOT NULL DEFAULT ''delivery'' AFTER delivery_cost',
  'SELECT ''orders.fulfillment_type already exists'''
);
PREPARE add_fulfillment_type_stmt FROM @add_fulfillment_type;
EXECUTE add_fulfillment_type_stmt;
DEALLOCATE PREPARE add_fulfillment_type_stmt;

SET @add_delivery_method_name_snapshot := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'orders'
      AND column_name = 'delivery_method_name_snapshot'
  ) = 0,
  'ALTER TABLE orders ADD COLUMN delivery_method_name_snapshot VARCHAR(150) NULL AFTER fulfillment_type',
  'SELECT ''orders.delivery_method_name_snapshot already exists'''
);
PREPARE add_delivery_method_name_snapshot_stmt FROM @add_delivery_method_name_snapshot;
EXECUTE add_delivery_method_name_snapshot_stmt;
DEALLOCATE PREPARE add_delivery_method_name_snapshot_stmt;

SET @add_free_shipping_applied := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'orders'
      AND column_name = 'free_shipping_applied'
  ) = 0,
  'ALTER TABLE orders ADD COLUMN free_shipping_applied TINYINT(1) NOT NULL DEFAULT 0 AFTER delivery_method_name_snapshot',
  'SELECT ''orders.free_shipping_applied already exists'''
);
PREPARE add_free_shipping_applied_stmt FROM @add_free_shipping_applied;
EXECUTE add_free_shipping_applied_stmt;
DEALLOCATE PREPARE add_free_shipping_applied_stmt;

SET @add_pickup_contact_name := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'orders'
      AND column_name = 'pickup_contact_name'
  ) = 0,
  'ALTER TABLE orders ADD COLUMN pickup_contact_name VARCHAR(150) NULL AFTER free_shipping_applied',
  'SELECT ''orders.pickup_contact_name already exists'''
);
PREPARE add_pickup_contact_name_stmt FROM @add_pickup_contact_name;
EXECUTE add_pickup_contact_name_stmt;
DEALLOCATE PREPARE add_pickup_contact_name_stmt;

SET @add_pickup_contact_phone := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'orders'
      AND column_name = 'pickup_contact_phone'
  ) = 0,
  'ALTER TABLE orders ADD COLUMN pickup_contact_phone VARCHAR(20) NULL AFTER pickup_contact_name',
  'SELECT ''orders.pickup_contact_phone already exists'''
);
PREPARE add_pickup_contact_phone_stmt FROM @add_pickup_contact_phone;
EXECUTE add_pickup_contact_phone_stmt;
DEALLOCATE PREPARE add_pickup_contact_phone_stmt;

UPDATE delivery_methods
SET is_pickup = 1,
    base_price = 0,
    free_shipping_threshold = NULL,
    eta_min_days = NULL,
    eta_max_days = NULL,
    is_default = 0
WHERE LOWER(name) LIKE '%nhận tại cửa hàng%'
   OR LOWER(name) LIKE '%nhan tai cua hang%';

UPDATE delivery_methods AS default_delivery
JOIN (
  SELECT min_order_amount
  FROM delivery_methods
  WHERE LOWER(name) LIKE '%miễn phí đơn lớn%'
     OR LOWER(name) LIKE '%mien phi don lon%'
  ORDER BY delivery_id ASC
  LIMIT 1
) AS free_delivery
SET default_delivery.free_shipping_threshold = free_delivery.min_order_amount
WHERE default_delivery.is_default = 1
  AND default_delivery.is_pickup = 0
  AND default_delivery.free_shipping_threshold IS NULL;

UPDATE delivery_methods
SET is_active = 0,
    is_default = 0
WHERE LOWER(name) LIKE '%miễn phí đơn lớn%'
   OR LOWER(name) LIKE '%mien phi don lon%';

UPDATE orders AS o
LEFT JOIN delivery_methods AS d ON d.delivery_id = o.delivery_id
SET o.fulfillment_type = CASE WHEN d.is_pickup = 1 THEN 'pickup' ELSE 'delivery' END,
    o.delivery_method_name_snapshot = COALESCE(o.delivery_method_name_snapshot, d.name),
    o.free_shipping_applied = CASE
      WHEN o.delivery_cost = 0 AND d.is_pickup = 0 THEN 1
      ELSE o.free_shipping_applied
    END
WHERE o.delivery_id IS NOT NULL;

SELECT
  CASE
    WHEN (
      SELECT COUNT(*)
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND (
          (table_name = 'delivery_methods' AND column_name IN (
            'free_shipping_threshold',
            'eta_min_days',
            'eta_max_days'
          ))
          OR
          (table_name = 'orders' AND column_name IN (
            'fulfillment_type',
            'delivery_method_name_snapshot',
            'free_shipping_applied',
            'pickup_contact_name',
            'pickup_contact_phone'
          ))
        )
    ) = 8
    AND EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = 'delivery_method_areas'
    )
    THEN 'READY'
    ELSE 'MISSING_DELIVERY_FULFILLMENT_SCHEMA'
  END AS delivery_fulfillment_schema_status;
