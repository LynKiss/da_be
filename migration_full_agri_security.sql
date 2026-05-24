-- Security hardening fields for password reset OTP.
-- MySQL 8.0.29+ / 9.x. Safe to re-run.

SET @add_reset_password_request_count := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'users'
      AND column_name = 'reset_password_request_count'
  ) = 0,
  'ALTER TABLE users ADD COLUMN reset_password_request_count INT NOT NULL DEFAULT 0 AFTER reset_password_expires_at',
  'SELECT ''users.reset_password_request_count already exists'''
);
PREPARE add_reset_password_request_count_stmt FROM @add_reset_password_request_count;
EXECUTE add_reset_password_request_count_stmt;
DEALLOCATE PREPARE add_reset_password_request_count_stmt;

SET @add_reset_password_last_requested_at := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'users'
      AND column_name = 'reset_password_last_requested_at'
  ) = 0,
  'ALTER TABLE users ADD COLUMN reset_password_last_requested_at DATETIME NULL AFTER reset_password_request_count',
  'SELECT ''users.reset_password_last_requested_at already exists'''
);
PREPARE add_reset_password_last_requested_at_stmt FROM @add_reset_password_last_requested_at;
EXECUTE add_reset_password_last_requested_at_stmt;
DEALLOCATE PREPARE add_reset_password_last_requested_at_stmt;

SET @add_reset_password_attempt_count := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'users'
      AND column_name = 'reset_password_attempt_count'
  ) = 0,
  'ALTER TABLE users ADD COLUMN reset_password_attempt_count INT NOT NULL DEFAULT 0 AFTER reset_password_last_requested_at',
  'SELECT ''users.reset_password_attempt_count already exists'''
);
PREPARE add_reset_password_attempt_count_stmt FROM @add_reset_password_attempt_count;
EXECUTE add_reset_password_attempt_count_stmt;
DEALLOCATE PREPARE add_reset_password_attempt_count_stmt;

SELECT
  CASE
    WHEN (
      SELECT COUNT(*)
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'users'
        AND column_name IN (
          'reset_password_request_count',
          'reset_password_last_requested_at',
          'reset_password_attempt_count'
        )
    ) = 3 THEN 'READY'
    ELSE 'MISSING_COLUMNS'
  END AS migration_full_agri_security_status;

