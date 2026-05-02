CREATE TABLE IF NOT EXISTS user_permission_overrides (
  override_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id CHAR(36) NOT NULL,
  permission_id BIGINT UNSIGNED NULL,
  source_project_id VARCHAR(120) NULL,
  synced_by VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (override_id),
  KEY idx_user_permission_overrides_user_id (user_id),
  KEY idx_user_permission_overrides_permission_id (permission_id),
  CONSTRAINT fk_user_permission_overrides_permission
    FOREIGN KEY (permission_id) REFERENCES permissions(permission_id)
    ON DELETE CASCADE
);
