-- 创作者大赛：视频作品 + 可复用提示词/Skill。
CREATE TABLE IF NOT EXISTS creator_contest_entries (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_storage_key TEXT NOT NULL UNIQUE REFERENCES files(storage_key) ON DELETE RESTRICT,
    cover_storage_key TEXT NOT NULL UNIQUE REFERENCES files(storage_key) ON DELETE RESTRICT,
    title             TEXT NOT NULL,
    description       TEXT NOT NULL DEFAULT '',
    recipe_type       TEXT NOT NULL CHECK (recipe_type IN ('prompt', 'skill')),
    recipe_content    TEXT NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_creator_contest_entries_time
    ON creator_contest_entries (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_creator_contest_entries_user
    ON creator_contest_entries (user_id, created_at DESC);

-- 每个账号对同一作品只有一张有效票。点赞一旦计入比赛，不支持撤销。
CREATE TABLE IF NOT EXISTS creator_contest_likes (
    entry_id   UUID NOT NULL REFERENCES creator_contest_entries(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (entry_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_creator_contest_likes_entry
    ON creator_contest_likes (entry_id, created_at DESC);
