-- 媒体删除采用带保留期的回收站，避免误删仍需恢复的生成结果。
ALTER TABLE files ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE files ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_files_deleted_at ON files (deleted_at) WHERE deleted_at IS NOT NULL;

ALTER TABLE storage_settings
    ADD COLUMN IF NOT EXISTS trash_retention_days INT NOT NULL DEFAULT 7
    CHECK (trash_retention_days BETWEEN 1 AND 90);
