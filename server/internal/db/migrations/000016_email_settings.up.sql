-- SMTP 密码使用 CHANNEL_ENC_KEY 对应的 AES-256-GCM 密钥加密保存。
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS email_configured BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS email_verification_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS smtp_host TEXT NOT NULL DEFAULT '';
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS smtp_port INT NOT NULL DEFAULT 587 CHECK (smtp_port BETWEEN 1 AND 65535);
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS smtp_mode TEXT NOT NULL DEFAULT 'starttls';
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS smtp_username TEXT NOT NULL DEFAULT '';
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS smtp_password_cipher BYTEA;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS smtp_from_email TEXT NOT NULL DEFAULT '';
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS smtp_from_name TEXT NOT NULL DEFAULT '圣诞画布';
