#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$ROOT_DIR"

if ! command -v docker >/dev/null 2>&1; then
    echo "docker 未安装，请先安装 Docker Engine / Docker Desktop。" >&2
    exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
    echo "docker compose 不可用，请安装 Docker Compose v2。" >&2
    exit 1
fi

random_hex() {
    od -An -N "$1" -tx1 /dev/urandom | tr -d ' \n'
}

random_secret() {
    random_hex 48
}

if [ ! -f .env ]; then
    cat > .env <<EOF
WEB_PORT=3000
POSTGRES_USER=canvas
POSTGRES_PASSWORD=$(random_secret)
POSTGRES_DB=canvas
REDIS_PASSWORD=$(random_secret)
REDIS_DB=0
JWT_SECRET=$(random_secret)
CHANNEL_ENC_KEY=$(random_hex 32)
ACCESS_TOKEN_TTL=1h
REFRESH_TOKEN_TTL=720h
CORS_ORIGINS=http://localhost:3000
ALLOW_REGISTRATION=true
ANALYTICS_GA4_ID=
ANALYTICS_BAIDU_ID=
EOF
    chmod 600 .env
    echo "已生成 .env，随机密钥已写入并设置为仅当前用户可读。"
else
    echo "检测到现有 .env，保留当前数据库和密钥配置。"
fi

echo "正在启动 PostgreSQL 和 Redis..."
docker compose up -d postgres redis

attempt=0
until docker compose exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 60 ]; then
        echo "PostgreSQL 在 120 秒内未就绪，最近日志如下：" >&2
        docker compose logs --tail=100 postgres >&2
        exit 1
    fi
    sleep 2
done

# POSTGRES_PASSWORD 只在首次初始化数据卷时生效。旧数据卷配合新生成的 .env 时，
# 需要通过本地 Unix socket 同步角色密码，否则 API 会因 SASL 认证失败不断重启。
echo "正在同步 PostgreSQL 角色密码..."
docker compose exec -T postgres sh -c '
    psql -v ON_ERROR_STOP=1 \
        -U "$POSTGRES_USER" \
        -d "$POSTGRES_DB" \
        -v new_password="$POSTGRES_PASSWORD"
' <<'SQL'
SELECT format('ALTER ROLE %I WITH PASSWORD %L', current_user, :'new_password') \gexec
SQL

echo "正在构建并启动 API 和 Web..."
docker compose up --build -d api app
docker compose ps
echo "部署完成： http://localhost:${WEB_PORT:-3000}"
