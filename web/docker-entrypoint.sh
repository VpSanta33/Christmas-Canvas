#!/bin/sh
set -e

# 由 nginx 官方镜像的入口在启动前自动执行（/docker-entrypoint.d/*.sh），随后 nginx 正常拉起。
# 从环境变量生成运行期配置 config.js。除统计 ID 外，还可在同一镜像启动时切换
# local / backend 模式及后端 API 地址，无需重新构建前端。

# GA4 / 百度 ID 只含字母、数字和连字符；过滤掉其它字符，
# 避免值里的引号等破坏 config.js 的 JS 字符串（纵深防御）。
sanitize_id() {
    printf '%s' "$1" | tr -cd 'A-Za-z0-9-'
}

sanitize_api_url() {
    printf '%s' "$1" | tr -cd 'A-Za-z0-9._~:/?#@!$&()*+,;=%-'
}

GA4_ID=$(sanitize_id "${ANALYTICS_GA4_ID:-}")
BAIDU_ID=$(sanitize_id "${ANALYTICS_BAIDU_ID:-}")
API_URL=$(sanitize_api_url "${API_BASE_URL:-/api}")

case "${APP_MODE:-backend}" in
    backend) APP_MODE_VALUE="backend" ;;
    *) APP_MODE_VALUE="local" ;;
esac

if [ -z "$API_URL" ]; then
    API_URL="/api"
fi

cat > /usr/share/nginx/html/config.js <<EOF
window.__RUNTIME_CONFIG__ = {
  ANALYTICS_GA4_ID: "${GA4_ID}",
  ANALYTICS_BAIDU_ID: "${BAIDU_ID}",
  APP_MODE: "${APP_MODE_VALUE}",
  API_BASE_URL: "${API_URL}"
};
EOF
