#!/usr/bin/env bash
set -euo pipefail

# 解压压缩包后可直接运行的入口脚本。
# 用法：sudo DOMAIN=your.example.com APP_DIR=/opt/vcontrolhub ./install.sh
# 首次运行会生成 APP_DIR/.env.local 并停止；编辑后重新运行同一命令。

if [ "${CHECK_SYNTAX_ONLY:-0}" = "1" ]; then
  bash -n "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy/install.sh"
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export SOURCE_DIR="${SOURCE_DIR:-${SCRIPT_DIR}}"
exec "${SCRIPT_DIR}/deploy/install.sh" "$@"
