ALTER TABLE storage_settings DROP COLUMN IF EXISTS trash_retention_days;
DROP INDEX IF EXISTS idx_files_deleted_at;
ALTER TABLE files DROP COLUMN IF EXISTS last_accessed_at;
ALTER TABLE files DROP COLUMN IF EXISTS deleted_at;
