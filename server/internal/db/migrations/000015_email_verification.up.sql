-- 邮箱验证：历史账号视为已验证，避免升级后锁死现有用户。
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
UPDATE users SET email_verified_at = COALESCE(email_verified_at, created_at);

-- 待验证注册不提前创建用户，避免邮箱预注册劫持。浏览器还必须持有 challenge token；
-- 验证码和 token 均只保存 HMAC 摘要，不保存明文。
CREATE TABLE IF NOT EXISTS email_verification_challenges (
    email                TEXT PRIMARY KEY,
    password_hash        TEXT NOT NULL,
    display_name         TEXT NOT NULL DEFAULT '',
    code_hash            BYTEA NOT NULL,
    challenge_hash       BYTEA NOT NULL,
    expires_at           TIMESTAMPTZ NOT NULL,
    attempts             INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    send_window_start    TIMESTAMPTZ NOT NULL DEFAULT now(),
    send_count           INT NOT NULL DEFAULT 1 CHECK (send_count > 0),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_verification_expiry
    ON email_verification_challenges (expires_at);
