-- 用量记录补充调用结果：模型、成败状态与错误信息，供 admin 排障。
-- 旧行 status 默认 'ok'（历史数据无从判断成败，按成功兜底）。
ALTER TABLE usage_records ADD COLUMN IF NOT EXISTS model TEXT NOT NULL DEFAULT '';
ALTER TABLE usage_records ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ok'; -- ok | error
ALTER TABLE usage_records ADD COLUMN IF NOT EXISTS http_status INT NOT NULL DEFAULT 0;
ALTER TABLE usage_records ADD COLUMN IF NOT EXISTS error_message TEXT NOT NULL DEFAULT '';

-- 便于按用户 + 状态筛错误记录。
CREATE INDEX IF NOT EXISTS idx_usage_records_user_status ON usage_records (user_id, status, created_at DESC);
