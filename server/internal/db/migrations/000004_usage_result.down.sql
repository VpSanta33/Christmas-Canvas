DROP INDEX IF EXISTS idx_usage_records_user_status;
ALTER TABLE usage_records DROP COLUMN IF EXISTS error_message;
ALTER TABLE usage_records DROP COLUMN IF EXISTS http_status;
ALTER TABLE usage_records DROP COLUMN IF EXISTS status;
ALTER TABLE usage_records DROP COLUMN IF EXISTS model;
