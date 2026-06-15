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

echo "==> [2.5/6] 应用 prisma migration (P-001-N: deploy.sh 此前缺此步, 部署后 30 秒 worker 报列不存在)"
sudo -u "$APP_USER" npx prisma migrate deploy 2>&1 | tail -20

echo "==> [2.6/7] TR-002: 检测 + patch /etc/caddy/Caddyfile 的 /direct 反代"
CADDY_FILE="/etc/caddy/Caddyfile"
if [ -f "$CADDY_FILE" ]; then
	if ! grep -q 'reverse_proxy /direct' "$CADDY_FILE"; then
		# 在最后一行 reverse_proxy 127.0.0.1:3000 之前注入 /direct 反代段
		BACKUP="${CADDY_FILE}.bak.$(date +%Y%m%d%H%M%S)"
		cp "$CADDY_FILE" "$BACKUP"
		awk '
			/reverse_proxy 127\.0\.0\.1:3000/ && !done {
				print "\n	# TR-002: Direct Gateway 反代 (本机 SFTP node 用)"
				print "	# 远端 server 的 direct gateway 由各自反向代理/VPN/防火墙保护"
				print "	reverse_proxy /direct 127.0.0.1:31888"
				print "	reverse_proxy /direct/* 127.0.0.1:31888"
				done=1
			}
			{ print }
		' "$BACKUP" > "$CADDY_FILE"
		echo "  注入 /direct 反代段 (备份: $BACKUP)"
	else
		echo "  /direct 反代已存在, 跳过"
	fi
	# caddy 自动 reload Caddyfile, 验证语法 (Caddyfile 需显式 --adapter caddyfile)
	caddy validate --config "$CADDY_FILE" --adapter caddyfile >/dev/null 2>&1
	validate_exit=$?
	if [ "$validate_exit" -eq 0 ]; then
		systemctl reload caddy || true
		echo "  caddy validate OK + reload"
	else
		echo "  FAIL: caddy validate 退出码 $validate_exit, 恢复备份"
		cp "$BACKUP" "$CADDY_FILE"
		exit 1
	fi
else
	echo "  跳过 ($CADDY_FILE 不存在)"
fi

echo "==> [2.7/7] TR-002: 验证 vcontrolhub-direct.service DIRECT_BIND=127.0.0.1 (如已装)"
if systemctl list-unit-files vcontrolhub-direct.service >/dev/null 2>&1; then
	if ! systemctl show vcontrolhub-direct.service -p Environment 2>/dev/null | grep -q DIRECT_BIND; then
		echo "  WARNING: vcontrolhub-direct.service 未显式声明 DIRECT_BIND. 建议在 /etc/vcontrolhub-direct.env 加 DIRECT_BIND=127.0.0.1 然后 systemctl restart vcontrolhub-direct.service"
	else
		echo "  DIRECT_BIND 已声明"
	fi
else
	echo "  跳过 (服务未安装)"
fi

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

echo "==> [6/7] 跑 smoke test"
if [ -x "$APP_DIR/deploy/smoke-test.sh" ]; then
  "$APP_DIR/deploy/smoke-test.sh"
else
  echo "  跳过 (deploy/smoke-test.sh 不存在或不可执行)"
fi

# 部署成功后清理 webpack 持久化缓存 (deploy 后留 429M+ 没用, 下次 build 重建)
# 保留 swc cache (12K, 加快 next build 编译)
echo "==> [7/7] 清理 .next/cache/webpack (deploy 后 429M 残留)"
if [ -d "$APP_DIR/.next/cache/webpack" ]; then
  size_before=$(du -sm "$APP_DIR/.next/cache/webpack" 2>/dev/null | awk '{print $1}')
  rm -rf "$APP_DIR/.next/cache/webpack"
  chown -R "$APP_USER:$APP_USER" "$APP_DIR/.next/cache" 2>/dev/null || true
  echo "  释放 ${size_before}M"
else
  echo "  跳过 (无 webpack cache)"
fi

echo "==> 部署完成"
