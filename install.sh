#!/usr/bin/env bash
set -euo pipefail

# 解压压缩包后可直接运行的入口脚本。
# 用法：sudo DOMAIN=your.example.com APP_DIR=/opt/vcontrolhub ./install.sh
# 首次运行会从生产模板创建 APP_DIR/.env.local，自动生成密钥/管理员密码，
# 并继续完成依赖安装、数据库迁移、双构建、systemd/反代与服务启动。

if [ "${CHECK_SYNTAX_ONLY:-0}" = "1" ]; then
  bash -n "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy/install.sh"
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export SOURCE_DIR="${SOURCE_DIR:-${SCRIPT_DIR}}"
exec "${SCRIPT_DIR}/deploy/install.sh" "$@"
