<p align="center">
  <img src="web/public/logo.svg" width="96" alt="圣诞AI画布 logo">
</p>

<h1 align="center">圣诞AI画布</h1>

<p align="center">
  面向 AI 图片、视频与多媒体创作的开源 AI 画布工作台
</p>

圣诞AI画布是基于 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas) 进行二次开发的 AI 创作工作台。项目把模型调用、素材管理和可视化工作流放进同一个创作空间，既可以作为无需账号的浏览器本地工具运行，也可以接入仓库内置的 Go 后端，获得账号、积分、服务端 AI 渠道、对象存储、创作者社区和管理后台能力。

当前仓库默认面向自托管部署，执行 `docker compose up --build -d` 即可启动完整的 Web、API 和数据服务。

> [!IMPORTANT]
> 项目仍在快速迭代，数据结构和部署配置可能发生变化。升级前请备份 PostgreSQL 数据卷、已配置的对象存储以及浏览器本地数据。

## 功能概览

### 无限画布

- 多画布项目管理，支持节点拖拽、缩放、连线、框选、分组、小地图、撤销与重做。
- 内置文本、图片、视频、音频、生成配置和组节点。
- 图片裁剪、切图、蒙版编辑、放大和角度调整等画布内工具。
- 画布、素材和媒体文件的导入导出，以及 WebDAV 数据同步。

### AI 创作

- 独立的图片与视频工作台，以及画布节点内的图片、视频、音频和文本生成。
- 支持参考图片、参考视频、参考音频、生成参数和历史记录。
- 支持 OpenAI 兼容格式与 Gemini 格式渠道，并允许通过自定义请求脚本适配其他服务。
- backend 模式由服务端注入第三方 API Key，支持 SSE、渠道优先级、故障转移、健康检测和自动暂停。

### 平台与社区

- 邮箱注册、验证码、JWT 登录、刷新令牌、会话撤销和登录防爆破。
- 注册赠送积分、按模型/能力计费、积分流水、每日配额和失败退款。
- 创作者主页、关注、作品流、收藏、点赞和创作大赛投稿。
- 大赛审核、精选、积分结算，以及作品画布快照和创作配方展示。

### 管理后台

- `operator`：查看平台概览、调用记录、渠道健康、用量统计和大赛审核。
- `admin`：在 operator 能力之外管理用户、角色、积分、模型渠道、平台设置、公告、邮件、对象存储、安全审计和文件清理。
- 渠道密钥与后台保存的 SMTP/S3 密钥使用 `CHANNEL_ENC_KEY` 加密后入库，不向前端返回明文。

### 节点插件

- 支持从 URL 安装、启用、更新和卸载第三方画布节点插件。
- 提供 TypeScript SDK、构建工具和插件模板。
- 仓库包含 Markdown、SVG、HTML、3D 全景和便利贴等示例插件。

插件开发说明见 [`plugins/canvas/README.md`](plugins/canvas/README.md)。第三方插件会在页面上下文中执行，只应安装可信来源。

## 运行模式

| 模式 | 适用场景 | 数据与密钥 | 后端能力 |
| --- | --- | --- | --- |
| `local` | 个人使用、快速体验、离线画布 | 画布、素材和模型配置保存在浏览器；浏览器直接请求配置的模型服务 | 不需要账号；无积分、社区和管理后台 |
| `backend` | 自托管平台、多人使用 | 业务数据进入 PostgreSQL；媒体对象存储可选，第三方 API Key 由服务端保存 | 账号、积分、配额、代理、社区、赛事和后台管理 |

前端通过 `APP_MODE`（容器运行时）或 `VITE_APP_MODE`（构建/开发时）选择模式。backend 模式默认使用同源 `/api`，也可以通过 `API_BASE_URL` 或 `VITE_API_BASE_URL` 指向独立后端。

## 系统架构

```text
Browser
  |
  v
Nginx :3000  ---- static files ----> React / Vite application
  |
  +---- /api/* ----> Go / Gin API :8080
                         |---- PostgreSQL: users, projects, assets, credits, settings
                         |---- Redis: rate limits and login protection
                         |---- Optional S3-compatible storage: images, videos and uploaded files
                         +---- AI providers: server-side proxy and credential injection
```

| 目录 | 主要职责 | 技术 |
| --- | --- | --- |
| `web/` | 画布、创作台、社区和管理后台 | React 19、Vite 7、React Router 7、Zustand、Ant Design 6、Tailwind CSS 4、localForage |
| `server/cmd/api/` | API 入口、依赖装配和优雅停机 | Go 1.26 |
| `server/internal/` | auth、credits、proxy、storage、contest、admin 等领域模块 | Gin、pgx、JWT、bcrypt、go-redis、minio-go |
| `server/internal/db/migrations/` | 启动时自动执行的数据库迁移 | PostgreSQL、golang-migrate |
| `plugins/canvas/` | 节点插件、SDK、模板和官方插件注册表 | TypeScript、esbuild |

## Docker 一键部署

根目录 Compose 默认以 backend 模式启动完整环境：前端、API、PostgreSQL 和 Redis。SMTP 与对象存储不是启动前置条件，首次部署默认关闭；第一个注册用户自动成为管理员，登录后台后再按需配置邮箱服务和 S3 兼容对象存储。默认开发配置内置了可运行的示例密钥，因此不创建 `.env` 也可以直接启动；生产环境必须先创建 `.env` 并替换所有默认凭据。

```bash
docker compose up --build -d
docker compose ps
```

生产或自定义部署使用：

```bash
cp .env.example .env
# 编辑 .env，至少替换 JWT_SECRET、CHANNEL_ENC_KEY、数据库和 Redis 凭据
docker compose up --build -d
```

启动后可访问：

| 服务 | 地址 | 说明 |
| --- | --- | --- |
| Web | <http://localhost:3000> | 主应用与管理后台 |
| Health | <http://localhost:3000/healthz> | 应返回 `{"ok":true}` |

首次部署默认关闭邮箱验证和对象存储，注册不需要邮箱验证码或 S3 凭据。第一个注册用户会自动成为 `admin`，可从 `/admin` 配置 AI 渠道、平台参数、SMTP 邮箱和 S3 兼容对象存储。后台配置会保存到 PostgreSQL，并使用 `CHANNEL_ENC_KEY` 加密敏感密钥。

对象存储关闭时，账号、画布、资产和 AI 代理仍可使用；需要上传或持久化媒体文件时，再在后台启用并测试 S3/MinIO/其他兼容服务。

### 已有数据库的首次部署

如果复用了旧的 `pgdata` 数据卷，数据库中已经保存的 `platform_settings` 会优先于 `.env`。这意味着旧部署曾关闭注册或开启邮箱验证时，仅修改 Docker 配置不会覆盖已保存的平台策略。优先使用管理员账号进入“平台设置”和“邮箱服务”页面调整；如果还没有任何可登录的管理员账号，可先检查：

```bash
docker compose exec postgres psql -U canvas -d canvas -c "SELECT configured, allow_registration, email_configured, email_verification_enabled FROM platform_settings WHERE id = 1;"
```

确认是遗留的引导配置后，可恢复首次注册入口（不会删除用户、画布或媒体数据）：

```bash
docker compose exec postgres psql -U canvas -d canvas -c "UPDATE platform_settings SET allow_registration = true, email_configured = true, email_verification_enabled = false, updated_at = now() WHERE id = 1;"
docker compose up -d --build api app
```

上面的 `canvas` 用户名和数据库名需与 `.env` 中的 `POSTGRES_USER`、`POSTGRES_DB` 一致。注册接口本身不需要 AI API Key；如页面仍显示旧的鉴权提示，请先重新构建 Web 和 API 容器并查看 `docker compose logs -f api app`。

查看日志和停止服务：

```bash
docker compose logs -f api app
docker compose down
```

`docker compose down` 保留 PostgreSQL 和 Redis 数据卷；后台配置的对象存储不由 Compose 管理。确认不再需要数据时才使用 `docker compose down -v`。

### 仅运行本地模式

纯前端模式不启动 API 和基础设施，适合个人使用：

```bash
docker compose -f docker-compose.local.yml up --build -d
```

打开 <http://localhost:3000> 后，在应用配置中填写自己的模型 Base URL 和 API Key。数据默认保存在当前浏览器中。

## 本地开发

### 环境要求

- 前端：Bun 1.3+（也可使用兼容的 Node.js 包管理流程）
- 后端：Go 1.26+
- 基础设施：Docker Engine 与 Docker Compose

### 启动后端依赖

```bash
cd server
docker compose up -d postgres redis
cp .env.example .env
go run ./cmd/api
```

后端默认监听 <http://localhost:8080>，启动时会自动执行 `server/internal/db/migrations/` 中的迁移。此开发流程默认不启动 SMTP 或对象存储服务；需要时直接在管理员后台配置外部服务。

### 启动前端

```bash
cd web
cp .env.example .env
bun install
bun run dev
```

`web/.env` 的典型配置：

```dotenv
# 纯前端模式
VITE_APP_MODE=local
VITE_API_BASE_URL=/api

# 接入本地 Go 后端时改为：
# VITE_APP_MODE=backend
# VITE_API_BASE_URL=http://localhost:8080/api
```

开发服务器地址为 <http://localhost:3000>。使用独立后端地址时，应确保后端 `CORS_ORIGINS` 包含该前端来源。

### 常用检查

```bash
cd web
bun run typecheck
bun run lint
bun run build

cd ../server
go test ./...
```

## 关键配置

| 变量 | 默认值/要求 | 作用 |
| --- | --- | --- |
| `JWT_SECRET` | 必填；启用邮箱验证时至少 32 字节 | 签发 JWT，并参与验证码摘要计算 |
| `CHANNEL_ENC_KEY` | 必填；64 位 hex（32 字节） | AES-256-GCM 加密渠道、SMTP 和对象存储密钥 |
| `DATABASE_URL` | PostgreSQL DSN | 后端业务数据与迁移目标 |
| `REDIS_ADDR` | `redis:6379`（Compose） | 限流、每日配额与登录保护；不可用时相关限流会 fail-open |
| `S3_*` / `STORAGE_*` | 可选；默认关闭 | 仅作为管理员后台尚未配置时的对象存储回退值，通常不需要写入 Docker 配置 |
| `ALLOW_REGISTRATION` | `true` | 是否开放用户自助注册 |
| `REGISTER_GRANT_CREDITS` | `100` | 新用户完成注册后赠送积分 |
| `EMAIL_VERIFICATION_ENABLED` | Compose 默认为 `false` | 仅作为后台尚未配置时的邮箱验证回退值；正式配置请使用管理员后台 |
| `SMTP_*` | 可选 | 仅作为后台尚未配置时的 SMTP 回退值；邮箱密码不需要写入 Docker 配置 |
| `CORS_ORIGINS` | `http://localhost:3000` | 允许访问 API 的前端来源，多个值用逗号分隔 |
| `ANALYTICS_GA4_ID` / `ANALYTICS_BAIDU_ID` | 空 | 可选统计 ID，留空不会加载对应统计脚本 |

后端完整变量模板见 [`server/.env.example`](server/.env.example)。多数平台设置可由超级管理员在后台修改；环境变量仍作为首次启动和数据库未配置时的回退值。

## 生产部署注意事项

1. 使用密码管理器或密钥服务生成并保存独立的 `JWT_SECRET` 与 `CHANNEL_ENC_KEY`；`CHANNEL_ENC_KEY` 可用 `openssl rand -hex 32` 生成，已加密数据不能在丢失旧密钥后恢复。
2. 替换 PostgreSQL 和 Redis 的默认凭据，不要将数据库或 Redis 直接暴露到公网。
3. 使用 HTTPS 反向代理公开 Web 服务，并把 `CORS_ORIGINS` 限制为实际站点来源。
4. 首次登录后，在管理员后台配置真实 SMTP 和对象存储；启用邮箱验证前先使用“发送测试邮件”验证 SMTP，启用对象存储前先执行连接测试。
5. 为 PostgreSQL 和已启用的对象存储建立备份策略；升级前先备份数据卷并阅读 [`CHANGELOG.md`](CHANGELOG.md)。
6. 插件代码拥有页面上下文权限，平台运营方应控制官方插件源并审核第三方插件。

## API 概览

所有业务接口位于 `/api`。除公开平台信息、作品展示和认证端点外，其余接口均要求 Bearer Token。

| 路径 | 说明 |
| --- | --- |
| `/api/auth/*` | 注册、邮箱验证、登录、刷新、当前用户和退出 |
| `/api/projects` | 用户画布项目列表、替换、写入和删除 |
| `/api/assets` | 用户素材列表、替换、写入和删除 |
| `/api/files/*` | 鉴权媒体上传、下载和回收站删除 |
| `/api/channels` | 前端可用渠道、默认模型和计费目录，不返回 API Key |
| `/api/ai/:channelId/*` | AI 请求代理、密钥注入、限流、计费和故障转移 |
| `/api/credits/*` | 用户积分余额与流水 |
| `/api/contest/*`、`/api/creators/*` | 大赛、作品、关注、收藏和创作者页面 |
| `/api/admin/*` | 渠道、用户、平台、存储、安全、审计和运营管理 |

健康检查不在 `/api` 下：`GET /healthz`。

## 开源协议

本项目采用 [GNU Affero General Public License v3.0](LICENSE)。通过网络向用户提供修改后的版本时，请遵守 AGPL-3.0 对源代码公开的要求。
