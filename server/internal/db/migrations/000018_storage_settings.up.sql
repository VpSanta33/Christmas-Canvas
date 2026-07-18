-- 对象存储由后台动态维护。AccessKey/SecretKey 使用 CHANNEL_ENC_KEY
-- 对应的 AES-256-GCM 密钥加密保存，管理接口永不返回明文。
CREATE TABLE IF NOT EXISTS storage_settings (
    id                        SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    configured                BOOLEAN NOT NULL DEFAULT false,
    enabled                   BOOLEAN NOT NULL DEFAULT false,
    provider                  TEXT NOT NULL DEFAULT 'minio',
    endpoint                  TEXT NOT NULL DEFAULT '',
    bucket                    TEXT NOT NULL DEFAULT '',
    region                    TEXT NOT NULL DEFAULT 'us-east-1',
    use_ssl                   BOOLEAN NOT NULL DEFAULT true,
    public_base_url           TEXT NOT NULL DEFAULT '/api/files/',
    path_prefix               TEXT NOT NULL DEFAULT '',
    image_path_prefix         TEXT NOT NULL DEFAULT 'image',
    video_path_prefix         TEXT NOT NULL DEFAULT 'Video',
    access_key_cipher         BYTEA,
    secret_key_cipher         BYTEA,
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO storage_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
