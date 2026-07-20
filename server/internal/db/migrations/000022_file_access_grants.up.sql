-- 跨用户协作媒体授权。
-- 文件仍归原用户所有，授权只允许通过分享复制、模板复用和团队项目产生。
CREATE TABLE IF NOT EXISTS file_access_grants (
    id              BIGSERIAL PRIMARY KEY,
    storage_key     TEXT NOT NULL REFERENCES files(storage_key) ON DELETE CASCADE,
    grantee_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id      TEXT REFERENCES canvas_projects(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_file_access_grants_unique
    ON file_access_grants (storage_key, grantee_user_id, COALESCE(project_id, ''));
CREATE INDEX IF NOT EXISTS idx_file_access_grants_user
    ON file_access_grants (grantee_user_id, storage_key);
