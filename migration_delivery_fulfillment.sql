-- Delivery / pickup normalization for checkout.
-- Run once on the target MySQL database when TYPEORM_SYNC is disabled.

ALTER TABLE delivery_methods
  ADD COLUMN free_shipping_threshold DECIMAL(15, 2) NULL AFTER min_order_amount,
  ADD COLUMN eta_min_days INT NULL AFTER free_shipping_threshold,
  ADD COLUMN eta_max_days INT NULL AFTER eta_min_days;

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

ALTER TABLE orders
  ADD COLUMN fulfillment_type VARCHAR(20) NOT NULL DEFAULT 'delivery' AFTER delivery_cost,
  ADD COLUMN delivery_method_name_snapshot VARCHAR(150) NULL AFTER fulfillment_type,
  ADD COLUMN free_shipping_applied TINYINT(1) NOT NULL DEFAULT 0 AFTER delivery_method_name_snapshot,
  ADD COLUMN pickup_contact_name VARCHAR(150) NULL AFTER free_shipping_applied,
  ADD COLUMN pickup_contact_phone VARCHAR(20) NULL AFTER pickup_contact_name;

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
