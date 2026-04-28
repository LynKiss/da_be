-- Run this manually if TypeORM synchronize is disabled.
ALTER TABLE users
  ADD COLUMN full_name VARCHAR(150) NULL AFTER email,
  ADD COLUMN phone_number VARCHAR(30) NULL AFTER full_name;
