-- 调用链与渠道自动暂停：只记录排障元数据，不保存提示词或请求正文。
ALTER TABLE usage_records ADD COLUMN IF NOT EXISTS request_id TEXT NOT NULL DEFAULT '';
ALTER TABLE usage_records ADD COLUMN IF NOT EXISTS latency_ms BIGINT NOT NULL DEFAULT 0;
ALTER TABLE usage_records ADD COLUMN IF NOT EXISTS credits BIGINT NOT NULL DEFAULT 0;
ALTER TABLE usage_records ADD COLUMN IF NOT EXISTS refunded BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_usage_records_request_id ON usage_records (request_id);
CREATE INDEX IF NOT EXISTS idx_usage_records_channel_time ON usage_records (channel_id, created_at DESC);

ALTER TABLE channels ADD COLUMN IF NOT EXISTS auto_paused BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS paused_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE channels ADD COLUMN IF NOT EXISTS health_updated_at TIMESTAMPTZ;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS key_updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE channels ADD COLUMN IF NOT EXISTS key_expires_at TIMESTAMPTZ;
