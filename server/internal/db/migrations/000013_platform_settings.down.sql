ALTER TABLE creator_contest_entries DROP COLUMN IF EXISTS featured_at;
ALTER TABLE creator_contest_entries DROP COLUMN IF EXISTS featured;
DROP TABLE IF EXISTS platform_settings;
