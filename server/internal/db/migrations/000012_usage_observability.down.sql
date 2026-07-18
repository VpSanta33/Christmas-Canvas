ALTER TABLE channels DROP COLUMN IF EXISTS key_expires_at;
ALTER TABLE channels DROP COLUMN IF EXISTS key_updated_at;
ALTER TABLE channels DROP COLUMN IF EXISTS health_updated_at;
ALTER TABLE channels DROP COLUMN IF EXISTS paused_reason;
ALTER TABLE channels DROP COLUMN IF EXISTS auto_paused;

DROP INDEX IF EXISTS idx_usage_records_channel_time;
DROP INDEX IF EXISTS idx_usage_records_request_id;
ALTER TABLE usage_records DROP COLUMN IF EXISTS refunded;
ALTER TABLE usage_records DROP COLUMN IF EXISTS credits;
ALTER TABLE usage_records DROP COLUMN IF EXISTS latency_ms;
ALTER TABLE usage_records DROP COLUMN IF EXISTS request_id;
