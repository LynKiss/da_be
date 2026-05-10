-- Migration: Add membership tier and total_spent to users table
-- Run this script manually (TYPEORM_SYNC=false)

ALTER TABLE `users`
  ADD COLUMN `membership_tier` ENUM('none','silver','gold','diamond') NOT NULL DEFAULT 'none'
    AFTER `is_active`,
  ADD COLUMN `total_spent` DECIMAL(15,2) NOT NULL DEFAULT 0.00
    AFTER `membership_tier`;
