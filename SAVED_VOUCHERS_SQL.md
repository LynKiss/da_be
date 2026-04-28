# Saved Vouchers Table

If `TYPEORM_SYNC` is not enabled, create the voucher wallet table manually:

```sql
CREATE TABLE `saved_vouchers` (
  `saved_voucher_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` CHAR(36) NOT NULL,
  `discount_id` BIGINT UNSIGNED NOT NULL,
  `saved_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`saved_voucher_id`),
  UNIQUE KEY `uq_saved_vouchers_user_discount` (`user_id`, `discount_id`),
  KEY `idx_saved_vouchers_user_id` (`user_id`),
  KEY `idx_saved_vouchers_discount_id` (`discount_id`)
);
```
