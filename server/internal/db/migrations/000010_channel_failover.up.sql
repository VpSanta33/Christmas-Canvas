-- 渠道故障切换：数字越小优先级越高；全局开关放在平台模型设置单行表中。
ALTER TABLE channels
    ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 100;

ALTER TABLE platform_model_settings
    ADD COLUMN IF NOT EXISTS failover_enabled BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_channels_enabled_priority
    ON channels (enabled, priority, created_at);
