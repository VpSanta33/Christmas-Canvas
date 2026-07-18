-- 创作者大赛：先审核后公开 + 管理员手动结算。
-- status 控制作品是否公开；settled_at 记录是否已发放过积分，防重复结算。
ALTER TABLE creator_contest_entries
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
    ADD COLUMN IF NOT EXISTS review_note TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_creator_contest_entries_status
    ON creator_contest_entries (status, created_at DESC);
