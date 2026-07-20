# 圣诞AI画布

基于 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas) 进行二次开发的 BYOK 多媒体 AI 创作画布。

圣诞AI画布把无限画布、图片/视频/音频创作台、个人模型配置、素材库和团队工作空间放在一个可自托管的应用中。用户在浏览器中自行填写模型调用 URL、API Key 和模型名称，浏览器直接调用用户选择的上游服务；平台只负责账号、画布、媒体存储、任务记录、分享、模板、协作与可选的邮箱/S3 配置。

## 设计边界

- **用户自己配置模型**：个人 API URL、Key 和模型保存在当前浏览器，服务端不代理模型请求，也不保存个人 AI Key。
- **平台不做计费**：已移除平台渠道、积分、注册赠送、AI 配额、失败退款和管理员渠道管理接口。
- **不部署 MinIO**：Docker 只启动 Web、Go API、PostgreSQL 和 Redis。对象存储是可选能力，由管理员登录后台后配置任意 S3 兼容服务。
- **保留业务能力**：账号注册、邮箱验证、画布/资产、任务中心、版本、分享复制、模板、通知、团队、创作者社区和后台审计继续保留。

## 功能

### 创作与模型

- 无限画布：节点、连线、分组、缩放、框选、撤销/重做、图片/视频/音频/文本/配置节点。
- 图片工作台：文生图、图像编辑、参考图、批量生成、历史记录和结果对比。
- 视频创作台：异步任务创建与轮询、参考图片/视频/音频、任务失败重试。
- 兼容 OpenAI 风格、Gemini 风格以及 `viraldance431`、`viraldance900` 等自定义模型接口，保留历史参数兼容性。
- 多个人 API 配置：每个渠道单独填写 Base URL、Key、格式和模型能力。

### 工作空间

- 统一任务中心：图片/视频任务历史、关键词和状态筛选、视频结果预览、一键复用和多任务对比。
- 画布版本：保存快照、查看历史版本、恢复版本。
- 分享与复制：公开查看/复制链接；分享页面直接预览快照里的图片、视频和音频。
- 工作流模板：私有、团队和公开可见性，搜索、复用和媒体访问授权。
- 团队空间：`owner`、`editor`、`viewer` 三种角色；编辑者可以保存团队画布，查看者只读。
- 通知中心、素材标签/收藏、媒体回收站、创作者社区和作品审核。

### 管理后台

- 用户、角色、禁用状态、会话撤销和安全审计。
- 站点名称、Logo、注册开关和公告维护。
- SMTP 邮箱配置：后台保存，敏感密码使用加密密钥加密入库。
- S3 兼容对象存储配置：后台保存和连接测试，支持图片、视频、音频等媒体持久化。
- 创作者社区审核、精选、作品媒体预览和创作配方展示。

## 运行模式

| 模式 | 适合场景 | 数据位置 | AI 调用 |
| --- | --- | --- | --- |
| `local` | 个人使用、快速体验、离线工作 | 浏览器 localForage | 浏览器直连用户填写的 API |
| `backend` | 自托管、多设备、团队协作 | PostgreSQL + 可选 S3 | 浏览器直连用户填写的 API |

backend 模式不会把个人 API Key 同步到 PostgreSQL、WebDAV 或任务记录。任务中心只保存提示词、模型、配置摘要、状态和媒体 `storageKey`。

## Docker 一键部署

环境要求：Docker Engine 或 Docker Desktop，以及 Docker Compose v2。

```bash
git clone https://github.com/VpSanta33/Christmas-Canvas.git
cd Christmas-Canvas
./deploy.sh
```

脚本会在没有 `.env` 时生成随机的 PostgreSQL、Redis、JWT 和后台敏感配置加密密钥，然后构建并启动容器。对于已有 PostgreSQL 数据卷，脚本会在启动 API 前把数据库角色密码同步为当前 `.env` 中的值，避免升级后出现 SASL 密码认证失败。访问 <http://localhost:3000>，健康检查为 <http://localhost:3000/healthz>。

也可以手动执行：

```bash
cp .env.example .env
# 编辑 .env，填写随机密码和密钥
docker compose up --build -d
docker compose ps
```

首次部署时，数据库为空的第一个注册用户会自动成为管理员。登录后进入管理后台，按需配置邮箱和 S3 兼容对象存储；不配置这两项也不影响账号、画布和用户直连 AI。Docker Compose 不包含 MinIO，也不会因为没有 S3 服务而启动失败。

已有部署升级：

```bash
git pull --ff-only origin main
./deploy.sh
docker compose logs -f --tail=100 api
```

`docker compose down` 不会删除数据卷。除非确认数据已备份，否则不要使用 `docker compose down -v`。升级前建议备份 PostgreSQL 卷和已配置的 S3 数据。

如果旧版脚本已经导致 API 报 `password authentication failed`，请拉取最新代码后重新执行 `./deploy.sh`。脚本会保留现有数据并修正数据库角色密码，不需要删除 `pgdata`。

## 个人 API 配置

登录或进入应用后，打开右上角设置：

1. 新建个人渠道。
2. 填写上游 API URL、API Key、请求格式和模型名称。
3. 为模型选择 `image`、`video`、`text` 或 `audio` 能力。
4. 在工作台选择对应模型并开始生成。

模型服务必须允许部署站点的浏览器 Origin、对应 HTTP 方法和 `Authorization` / `x-goog-api-key` 请求头。HTTPS 页面不能调用 HTTP 上游。模型 API Key 不会发送到圣诞AI画布后端。

## 架构

```text
Browser
  | \
  |  +---- personal API URL + Key ----> 用户选择的模型服务（需要 CORS）
  |
  +---- Nginx :3000 ---- React/Vite
              |
              +---- /api/* ---- Go/Gin :8080
                                  |---- PostgreSQL：账号、画布、任务、团队、设置
                                  |---- Redis：登录防爆破和请求限流
                                  +---- 可选 S3：媒体文件
```

| 目录 | 内容 |
| --- | --- |
| `web/` | React 前端、无限画布、创作台、工作空间和管理页面 |
| `server/cmd/api/` | Go API 入口和依赖装配 |
| `server/internal/auth/` | 注册、登录、邮箱验证、会话管理 |
| `server/internal/canvas/` | 画布项目和团队项目权限 |
| `server/internal/workspace/` | 任务、版本、分享、模板、通知、团队 |
| `server/internal/storage/` | S3 兼容对象存储和后台配置 |
| `server/internal/db/migrations/` | 启动时自动执行的 PostgreSQL 迁移 |

旧版本的平台渠道、积分和用量迁移文件会保留用于升级兼容，但新版本运行时不再挂载对应 API；媒体跨用户访问由 `file_access_grants` 进行最小授权。

## 本地开发

```bash
cd web
bun install
bun run dev
```

纯前端模式使用 `VITE_APP_MODE=local`。接入本地 Go API 时设置 `VITE_APP_MODE=backend` 和 `VITE_API_BASE_URL=http://localhost:8080/api`。

```bash
cd server
docker compose up -d postgres redis
cp .env.example .env
# 修改 DATABASE_URL、JWT_SECRET、CHANNEL_ENC_KEY 和 CORS_ORIGINS
go run ./cmd/api
```

常用检查：

```bash
cd server && GOCACHE=/tmp/christmas-canvas-go-build go test ./...
cd ../web && bun run typecheck && bun run build
```

## 关键环境变量

| 变量 | 说明 |
| --- | --- |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Compose 数据库账号；生产环境必须使用随机密码 |
| `REDIS_PASSWORD` | Redis 密码；Compose 会用同一密码启动 Redis 和 API |
| `JWT_SECRET` | 至少 32 字节的随机 JWT 密钥 |
| `CHANNEL_ENC_KEY` | 64 位 hex；用于加密后台 SMTP/S3 密钥，不能丢失 |
| `CORS_ORIGINS` | 允许访问 API 的前端 Origin，多个值用逗号分隔 |
| `ALLOW_REGISTRATION` | 数据库尚未保存站点设置时的注册回退值 |
| `WEB_PORT` | Web 暴露端口，默认 `3000` |
| `ANALYTICS_GA4_ID` / `ANALYTICS_BAIDU_ID` | 可选统计 ID，留空关闭统计 |

邮箱和对象存储的业务配置不需要写入 Compose `.env`，由超级管理员登录后台配置。`CHANNEL_ENC_KEY` 只是数据库加密密钥，不是模型 API Key。

## API 概览

公开接口：`/healthz`、`/api/platform`、`/api/showcase`、`/api/shared/:token` 和分享媒体端点。

登录后接口：

- `/api/auth/*`：注册、验证、登录、刷新和退出。
- `/api/projects`、`/api/assets`、`/api/files/*`：画布、资产和媒体。
- `/api/tasks`：任务历史和状态同步。
- `/api/projects/:id/versions`、`/api/projects/:id/shares`：版本和分享。
- `/api/templates`、`/api/notifications`、`/api/teams`：模板、通知和团队。
- `/api/contest/*`、`/api/creators/*`：创作者社区。
- `/api/admin/*`：管理员用户、站点、邮箱、S3、审计和社区审核。

平台不提供 `/api/channels`、`/api/ai/*`、`/api/credits/*`、平台 AI 用量和积分接口。模型请求不会经过本项目后端。

## 安全提示

- 使用 HTTPS 和实际域名配置 `CORS_ORIGINS`，不要在公网暴露 PostgreSQL 或 Redis。
- 不要提交 `.env`、个人 API Key、SMTP 密码或 S3 SecretKey。
- 第一个注册用户自动成为管理员，部署后应立即登录并确认管理员账号安全。
- 第三方画布插件在页面上下文执行，只有在信任插件来源时才安装。
- `CHANNEL_ENC_KEY` 丢失后无法解密后台已经保存的 SMTP/S3 密钥。

## 开源协议

本项目采用 [GNU Affero General Public License v3.0](LICENSE)。本项目基于 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas) 进行二次开发。
