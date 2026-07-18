-- 用户禁用（封禁）标记：admin 可停用账号，禁用后无法登录/刷新。
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled BOOLEAN NOT NULL DEFAULT false;
