-- 创作者社区：关注关系与大赛作品收藏。
CREATE TABLE IF NOT EXISTS creator_follows (
    follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    creator_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (follower_id, creator_id),
    CHECK (follower_id <> creator_id)
);
CREATE INDEX IF NOT EXISTS idx_creator_follows_creator
    ON creator_follows (creator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_creator_follows_follower
    ON creator_follows (follower_id, created_at DESC);

CREATE TABLE IF NOT EXISTS creator_contest_favorites (
    entry_id  UUID NOT NULL REFERENCES creator_contest_entries(id) ON DELETE CASCADE,
    user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (entry_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_creator_contest_favorites_user
    ON creator_contest_favorites (user_id, created_at DESC);
