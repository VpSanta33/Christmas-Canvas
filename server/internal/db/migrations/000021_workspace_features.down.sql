ALTER TABLE canvas_projects DROP CONSTRAINT IF EXISTS canvas_projects_team_id_fkey;
ALTER TABLE canvas_projects DROP COLUMN IF EXISTS team_id;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS workflow_templates;
DROP TABLE IF EXISTS canvas_shares;
DROP TABLE IF EXISTS canvas_versions;
DROP TABLE IF EXISTS team_members;
DROP TABLE IF EXISTS teams;
DROP INDEX IF EXISTS idx_generation_logs_user_client_key;
ALTER TABLE generation_logs
    DROP COLUMN IF EXISTS completed_at,
    DROP COLUMN IF EXISTS updated_at,
    DROP COLUMN IF EXISTS error_message,
    DROP COLUMN IF EXISTS model,
    DROP COLUMN IF EXISTS prompt,
    DROP COLUMN IF EXISTS title,
    DROP COLUMN IF EXISTS client_key;
DROP INDEX IF EXISTS idx_assets_favorite;
DROP INDEX IF EXISTS idx_assets_tags;
ALTER TABLE assets
    DROP COLUMN IF EXISTS favorite,
    DROP COLUMN IF EXISTS tags;
