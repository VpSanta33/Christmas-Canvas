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

docker compose up --build -d
docker compose ps
echo "部署完成： http://localhost:${WEB_PORT:-3000}"
