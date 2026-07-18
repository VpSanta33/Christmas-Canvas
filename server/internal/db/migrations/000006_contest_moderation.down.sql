DROP INDEX IF EXISTS idx_creator_contest_entries_status;
ALTER TABLE creator_contest_entries
    DROP COLUMN IF EXISTS settled_at,
    DROP COLUMN IF EXISTS reviewed_at,
    DROP COLUMN IF EXISTS review_note,
    DROP COLUMN IF EXISTS status;
