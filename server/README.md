# 圣诞AI画布 API

这是圣诞AI画布的 Go/Gin 后端，负责账号、画布、资产、任务记录、版本、分享、模板、通知、团队、社区和管理员配置。

## 运行边界

- 模型调用采用 BYOK：浏览器直接调用用户填写的 API URL 和 Key。
- 后端不提供平台 AI 代理、平台渠道、积分、注册赠送、AI 配额或模型计费。
- 邮箱 SMTP 和 S3 兼容对象存储可在管理员后台配置，不是启动前置依赖。
- Docker Compose 不部署 MinIO。对象存储未配置时，媒体上传接口会返回 503，但账号和画布数据仍可使用。

## 本地运行

```bash
docker compose up -d postgres redis
cp .env.example .env
# 修改 DATABASE_URL、JWT_SECRET、CHANNEL_ENC_KEY、CORS_ORIGINS
go run ./cmd/api
```

服务默认监听 `:8080`，健康检查为 `GET /healthz`。启动时会自动执行 `internal/db/migrations/` 中的迁移。

## Docker 部署

请在仓库根目录执行：

```bash
./deploy.sh
```

根目录脚本会生成随机密钥并启动前端、API、PostgreSQL 和 Redis。不要将 `.env` 提交到 Git。

## 目录

| 目录 | 职责 |
| --- | --- |
| `cmd/api` | 进程入口和依赖装配 |
| `internal/auth` | 注册、登录、邮箱验证、会话撤销 |
| `internal/canvas` | 画布项目和团队编辑权限 |
| `internal/workspace` | 任务、版本、分享、模板、通知、团队 |
| `internal/file` | 媒体上传、下载、回收站和跨用户授权 |
| `internal/storage` | S3 兼容对象存储运行时与管理员配置 |
| `internal/db/migrations` | PostgreSQL 增量迁移 |

`file_access_grants` 只允许分享复制、模板复用和团队项目为其他用户建立媒体读取授权。历史平台渠道/积分迁移文件保留用于升级兼容，新路由不会再暴露这些能力。

## 检查

```bash
GOCACHE=/tmp/christmas-canvas-go-build go test ./...
```
