DROP TABLE IF EXISTS admin_audit_logs;
ALTER TABLE users DROP COLUMN IF EXISTS session_version;
