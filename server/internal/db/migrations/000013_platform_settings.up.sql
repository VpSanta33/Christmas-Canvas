-- 可在后台动态维护的公开平台信息。敏感运行期配置仍只来自环境变量。
CREATE TABLE IF NOT EXISTS platform_settings (
    id                     SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    site_name              TEXT NOT NULL DEFAULT '圣诞画布',
    logo_url               TEXT NOT NULL DEFAULT '/logo.svg',
    allow_registration     BOOLEAN NOT NULL DEFAULT true,
    register_grant_credits BIGINT NOT NULL DEFAULT 100,
    announcement           TEXT NOT NULL DEFAULT '',
    maintenance_enabled    BOOLEAN NOT NULL DEFAULT false,
    maintenance_notice     TEXT NOT NULL DEFAULT '',
    auto_pause_enabled     BOOLEAN NOT NULL DEFAULT true,
    auto_pause_failures    INT NOT NULL DEFAULT 5 CHECK (auto_pause_failures BETWEEN 2 AND 20),
    configured             BOOLEAN NOT NULL DEFAULT false,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO platform_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 首页与 Skill/作品广场的人工推荐位。
ALTER TABLE creator_contest_entries ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE creator_contest_entries ADD COLUMN IF NOT EXISTS featured_at TIMESTAMPTZ;
