-- 用户表：email + 密码（bcrypt）
CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL DEFAULT '',
    avatar_url    TEXT NOT NULL DEFAULT '',
    role          TEXT NOT NULL DEFAULT 'user',   -- user | admin
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 画布项目：整个前端 CanvasProject 结构存 JSONB。
-- id 用 TEXT 直接存前端 nanoid，这样前端 store 生成 id 的逻辑无需改动。
CREATE TABLE IF NOT EXISTS canvas_projects (
    id         TEXT PRIMARY KEY,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL DEFAULT '未命名画布',
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_canvas_projects_user ON canvas_projects (user_id, updated_at DESC);

-- 资产：元数据 + 前端 Asset 结构存 JSONB，二进制走对象存储（object_key）。id 用 TEXT 存前端 nanoid。
CREATE TABLE IF NOT EXISTS assets (
    id         TEXT PRIMARY KEY,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,                     -- text | image | video
    title      TEXT NOT NULL DEFAULT '',
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assets_user ON assets (user_id, updated_at DESC);

-- 对象存储元数据：storageKey(前端协议 image:/video:/... ) → 对象存储 object_key + 归属用户
CREATE TABLE IF NOT EXISTS files (
    storage_key TEXT PRIMARY KEY,                 -- 前端语义键，如 image:xxxx
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    object_key  TEXT NOT NULL,                    -- 对象存储中的真实 key（含 user 前缀）
    mime_type   TEXT NOT NULL DEFAULT 'application/octet-stream',
    bytes       BIGINT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_files_user ON files (user_id);

-- 生成记录
CREATE TABLE IF NOT EXISTS generation_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    capability  TEXT NOT NULL,                    -- image | video | text | audio
    status      TEXT NOT NULL DEFAULT 'pending',  -- pending | running | done | failed
    request     JSONB NOT NULL DEFAULT '{}'::jsonb,
    result      JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_generation_logs_user ON generation_logs (user_id, created_at DESC);

-- 平台 AI 渠道：第三方 key AES-GCM 加密存储，仅 admin 可写
CREATE TABLE IF NOT EXISTS channels (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name           TEXT NOT NULL,
    base_url       TEXT NOT NULL,
    api_key_cipher BYTEA NOT NULL,
    api_format     TEXT NOT NULL DEFAULT 'openai',  -- openai | gemini
    models         JSONB NOT NULL DEFAULT '[]'::jsonb,
    enabled        BOOLEAN NOT NULL DEFAULT true,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 用户配额
CREATE TABLE IF NOT EXISTS user_quotas (
    user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    daily_limit   INT NOT NULL DEFAULT 50,
    monthly_limit INT NOT NULL DEFAULT 500
);

-- 用量流水
CREATE TABLE IF NOT EXISTS usage_records (
    id         BIGSERIAL PRIMARY KEY,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    capability TEXT NOT NULL,
    channel_id UUID,
    tokens     INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_usage_records_user_time ON usage_records (user_id, created_at);
