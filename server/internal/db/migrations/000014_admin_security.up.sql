-- 角色分级、会话代际吊销与管理员操作审计。
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id           BIGSERIAL PRIMARY KEY,
    actor_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_email  TEXT NOT NULL DEFAULT '',
    actor_role   TEXT NOT NULL DEFAULT '',
    action       TEXT NOT NULL,
    target       TEXT NOT NULL DEFAULT '',
    request_id   TEXT NOT NULL DEFAULT '',
    http_status  INT NOT NULL DEFAULT 0,
    ip_address   TEXT NOT NULL DEFAULT '',
    user_agent   TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_time ON admin_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_actor ON admin_audit_logs (actor_id, created_at DESC);
