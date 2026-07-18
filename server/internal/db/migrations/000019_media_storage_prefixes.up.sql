-- 000018 可能已经在旧版本部署中执行，目录分流字段必须使用新的增量迁移补齐。
ALTER TABLE storage_settings
    ADD COLUMN IF NOT EXISTS image_path_prefix TEXT NOT NULL DEFAULT 'image';

ALTER TABLE storage_settings
    ADD COLUMN IF NOT EXISTS video_path_prefix TEXT NOT NULL DEFAULT 'Video';
