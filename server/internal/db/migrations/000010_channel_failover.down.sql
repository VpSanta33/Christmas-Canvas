DROP INDEX IF EXISTS idx_channels_enabled_priority;
ALTER TABLE platform_model_settings DROP COLUMN IF EXISTS failover_enabled;
ALTER TABLE channels DROP COLUMN IF EXISTS priority;
