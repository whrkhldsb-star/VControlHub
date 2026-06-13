#!/usr/bin/env bash
# VControlHub 热部署脚本
# - 跑 next build
# - 修正 .next 目录 owner (systemd service User=vcontrolhub)
# - 重启生产服务
# - 跑 smoke test
#
# 用法: sudo bash deploy.sh
set -euo pipefail

APP_USER="vcontrolhub"
APP_DIR="/opt/VControlHub"
SERVICE_NAME="vcontrolhub-next"

cd "$APP_DIR"

echo "==> [1/6] 修正源文件 owner (避免 root-owned 阻塞 vcontrolhub 读)"
chown -R "$APP_USER:$APP_USER" "$APP_DIR/src" "$APP_DIR/public" "$APP_DIR/scripts" "$APP_DIR/prisma" "$APP_DIR/package.json" "$APP_DIR/package-lock.json" "$APP_DIR/next.config.*" "$APP_DIR/tsconfig.json" 2>/dev/null || true
chown -R "$APP_USER:$APP_USER" "$APP_DIR/.next" 2>/dev/null || rm -rf "$APP_DIR/.next"

echo "==> [2/6] 跑 build"
sudo -u "$APP_USER" npm run build

echo "==> [3/6] 修正 .next owner"
chown -R "$APP_USER:$APP_USER" "$APP_DIR/.next" "$APP_DIR/.next/cache" 2>/dev/null || true

echo "==> [4/6] 重启服务"
systemctl restart "$SERVICE_NAME" vcontrolhub-ssh-ws caddy
sleep 2

echo "==> [5/6] 验证服务 active"
for svc in "$SERVICE_NAME" vcontrolhub-ssh-ws caddy; do
  if ! systemctl is-active --quiet "$svc"; then
    echo "  FAIL: $svc 未 active"
    systemctl status "$svc" --no-pager -l | tail -20
    exit 1
  fi
done

echo "==> [6/6] 跑 smoke test"
if [ -x "$APP_DIR/deploy/smoke-test.sh" ]; then
  "$APP_DIR/deploy/smoke-test.sh"
else
  echo "  跳过 (deploy/smoke-test.sh 不存在或不可执行)"
fi

echo "==> 部署完成"
