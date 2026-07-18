-- 平台默认模型：按能力保存 channelId::model，模型上下架与排序继续存于 channels.models JSONB。
CREATE TABLE IF NOT EXISTS platform_model_settings (
    id         SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    defaults   JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO platform_model_settings (id, defaults)
VALUES (1, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;
