# Infinite Canvas 后端（Part B）

Go + Gin 后端，为前端提供：用户认证、AI 调用代理（第三方 key 服务端持有）、画布/资产数据入库、媒体对象存储、配额与限流。

设计原则：前端保持 **local / backend 双模式**。本后端只服务 backend 模式；local 模式下前端完全离线可用，行为零变化。

## 技术栈
- **Gin** HTTP 框架
- **PostgreSQL**（pgx v5）— 用户、画布(JSONB)、资产(JSONB)、渠道、用量
- **MinIO / S3**（minio-go）— 媒体二进制
- **Redis**（go-redis）— 限流固定窗口
- **golang-migrate**（库 + go:embed）— 启动自动迁移，无需 CLI
- **JWT**（golang-jwt v5）+ bcrypt — 认证

## 快速开始

一键起全套（含 api）：
```bash
cd server
docker compose up --build
```

本地开发（依赖用容器，api 本地跑，便于热改）：
```bash
cd server
docker compose up -d postgres redis minio mailpit
cp .env.example .env      # 按需改
export $(grep -v '^#' .env | xargs)
go run ./cmd/api
```

健康检查：`curl localhost:8080/healthz`

开发邮件收件箱：`http://localhost:8025`。Docker Compose 默认要求新注册账号完成邮箱验证；Mailpit 只用于本地拦截测试邮件，不会向公网投递。

## 目录
```
cmd/api            入口 + 路由装配
internal/config    环境变量配置（敏感项仅来自 env）
internal/db        pgx 连接池 + 内嵌迁移
internal/db/migrations  SQL 迁移
internal/auth      注册/登录/刷新/me + JWT + bcrypt
internal/middleware     RequireAuth / RequireAdmin / UserIDFrom
internal/canvas    /projects CRUD（JSONB）
internal/asset     /assets CRUD（JSONB）
internal/file      /files 上传下载（映射 storageKey → 对象存储，按用户隔离）
internal/proxy     /ai/:channelId/*path 透明反代（注入渠道密钥，含 SSE）
internal/storage   对象存储客户端 + 渠道密钥 AES-GCM 加解密
internal/quota     用量记录 + 限流 + 日配额
internal/httpx     统一响应
```

## API 概览
| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | /api/auth/register | 公开 | 注册（可关闭） |
| POST | /api/auth/verify-email | 公开 | 使用 6 位验证码完成邮箱验证 |
| POST | /api/auth/resend-verification | 公开 | 重新发送邮箱验证码 |
| POST | /api/auth/login | 公开 | 登录，返回 access+refresh |
| POST | /api/auth/refresh | 公开 | 刷新 access |
| GET  | /api/auth/me | 需登录 | 当前用户 |
| GET/PUT/POST | /api/projects | 需登录 | 画布列表/全量替换/单条 upsert |
| DELETE | /api/projects/:id | 需登录 | 删除画布 |
| GET/PUT/POST | /api/assets | 需登录 | 资产同上 |
| DELETE | /api/assets/:id | 需登录 | 删除资产 |
| POST | /api/files | 需登录 | 上传媒体（multipart，带 storageKey） |
| GET  | /api/files/:key | 需登录 | 下载媒体 |
| GET  | /api/channels | 需登录 | 可用 AI 渠道（不含 key） |
| ANY  | /api/ai/:channelId/*path | 需登录 | AI 反向代理（限流+配额） |
| POST | /api/admin/channels | admin | 新建渠道 |

## AI 代理的关键点
前端 backend 模式只需把某渠道的 baseUrl 指向 `/api/ai/<channelId>`，其余请求构造（`/v1/images/generations`、`/v1/responses` SSE、`/v1/videos` 轮询、`/v1/audio/speech` 等）**完全不变**。后端剥掉前端可能带的鉴权头，按渠道 `apiFormat` 注入 `Authorization: Bearer` 或 `x-goog-api-key`，透明转发，`FlushInterval` 保证 SSE 逐块下推。第三方 key 以 AES-256-GCM 加密存于 `channels` 表，前端永不接触。

## 安全提示
- 生产务必替换 `JWT_SECRET` 与 `CHANNEL_ENC_KEY`（`openssl rand -hex 32`）。
- 生产建议启用 `EMAIL_VERIFICATION_ENABLED=true`，并配置真实 SMTP。`SMTP_MODE` 应使用 `starttls`（通常 587）或 `tls`（通常 465）；`none` 仅供本地 Mailpit 使用。
- 邮箱验证码默认 10 分钟过期、60 秒重发冷却、最多尝试 5 次；单邮箱每小时最多发送 5 封。数据库只保存带服务端密钥的 HMAC 摘要，不保存验证码明文。
- 历史账号在迁移时自动标记为已验证；新账号只有验证成功后才会签发 JWT 并领取注册积分。
- 所有 `/api/*`（除 auth 公开端点）均需 Bearer token；文件下载也受鉴权保护，故前端 `<img>` 需走 fetch+objectURL（见前端 backend 适配器）。
- CORS 默认只放行 `CORS_ORIGINS`；限流默认 30 次/分/用户，日配额默认 50 次（`user_quotas` 可调）。
