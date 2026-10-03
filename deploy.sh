#!/usr/bin/env bash
# VControlHub 热部署脚本
# - 在独立目录构建，在线服务持续运行
# - 保留上一版本运行产物，再短暂切换服务
# - 验证 SSH 协议和 smoke test，失败恢复上一版本产物
#
# 用法: sudo bash deploy.sh
set -euo pipefail

# Agent shells (Hermes) often export umask 077; force a sane deploy umask so
# any root-touched helper files are not left world-unreadable.
umask 022

DEPLOY_LOCK="${DEPLOY_LOCK:-/run/lock/vcontrolhub-deploy.lock}"
mkdir -p "$(dirname "$DEPLOY_LOCK")"
# Record PID so operators can tell a live lock from a leftover empty file.
# flock still provides mutual exclusion; the PID file is diagnostic only.
exec 9>>"$DEPLOY_LOCK"
if ! flock -n 9; then
	holder="$(tr -d '\n' <"$DEPLOY_LOCK" 2>/dev/null || true)"
	echo "ERROR: another VControlHub deployment/build is already running ($DEPLOY_LOCK holder_pid=${holder:-unknown})"
	exit 75
fi
: >"$DEPLOY_LOCK"
printf '%s\n' "$$" >&9
# Keep the lock inode: unlinking it lets later deploys lock a different file.
# Clear the diagnostic PID while still holding the lock, then release it.
release_deploy_lock() {
	# best-effort: never fail the main trap path; idempotent
	if [ "${DEPLOY_LOCK_RELEASED:-0}" = "1" ]; then
		return 0
	fi
	DEPLOY_LOCK_RELEASED=1
	: >"$DEPLOY_LOCK"
	flock -u 9 2>/dev/null || true
}

APP_USER="${APP_USER:-vcontrolhub}"
APP_DIR="${APP_DIR:-/opt/VControlHub}"
SERVICE_NAME="${SERVICE_NAME:-vcontrolhub-next}"
WORKER_SERVICE_NAME="${WORKER_SERVICE_NAME:-vcontrolhub-worker}"
SSH_SERVICE_NAME="${SSH_SERVICE_NAME:-vcontrolhub-ssh-ws}"
SYSTEMD_UNIT_DIR="${SYSTEMD_UNIT_DIR:-/etc/systemd/system}"
stage_dir=""
rollback_dir=""
artifacts_promoted=0
units_saved=0
worker_was_present=0
service_stopped=0
DEPLOY_LOCK_RELEASED=0

on_exit() {
	status=$?
	if [ "$status" -ne 0 ] && [ "$artifacts_promoted" -eq 1 ]; then
		echo "==> 部署验证失败，恢复上一版本运行产物"
		systemctl stop "$SERVICE_NAME" "$WORKER_SERVICE_NAME" "$SSH_SERVICE_NAME" || true
		for artifact in .next dist node_modules; do
			if [ -e "$rollback_dir/$artifact" ]; then
				# Keep the rejected candidate for diagnosis; restore the complete
				# previous artifact instead of restarting a partial build.
				[ ! -e "$APP_DIR/$artifact" ] || mv "$APP_DIR/$artifact" "$stage_dir/rejected-${artifact#.}"
				mv "$rollback_dir/$artifact" "$APP_DIR/$artifact"
			fi
		done
	fi
	if [ "$status" -ne 0 ] && [ "$units_saved" -eq 1 ]; then
		for item in next.service worker.service workers.conf; do
			case "$item" in
				next.service) target="$SYSTEMD_UNIT_DIR/$SERVICE_NAME.service" ;;
				worker.service) target="$SYSTEMD_UNIT_DIR/$WORKER_SERVICE_NAME.service" ;;
				workers.conf) target="$SYSTEMD_UNIT_DIR/$SERVICE_NAME.service.d/10-workers.conf" ;;
			esac
			if [ -f "$rollback_dir/units/$item" ]; then cp -a "$rollback_dir/units/$item" "$target"; else rm -f "$target"; fi
		done
		[ ! -f "$rollback_dir/Caddyfile" ] || cp -a "$rollback_dir/Caddyfile" "$CADDY_FILE"
		systemctl daemon-reload || true
	fi
	if [ "$status" -ne 0 ] && [ "$service_stopped" -eq 1 ]; then
		systemctl reset-failed "$SERVICE_NAME" "$SSH_SERVICE_NAME" 2>/dev/null || true
		systemctl start "$SERVICE_NAME" "$SSH_SERVICE_NAME" || true
		if [ "$worker_was_present" -eq 1 ]; then systemctl reset-failed "$WORKER_SERVICE_NAME" 2>/dev/null || true; systemctl start "$WORKER_SERVICE_NAME" || true; fi
		if [ -f "$rollback_dir/Caddyfile" ]; then systemctl reload caddy || true; fi
		echo "==> 已恢复运行产物；数据库迁移未自动逆转，必要时按备份流程恢复"
	fi
	if [ "$status" -eq 0 ] || [ "$artifacts_promoted" -eq 0 ]; then [ -z "$stage_dir" ] || rm -rf "$stage_dir"; fi
	release_deploy_lock
	exit "$status"
}
trap on_exit EXIT

cd "$APP_DIR"

echo "==> [1/8] 在独立目录准备候选版本（在线服务继续运行）"
stage_dir="$(mktemp -d "$(dirname "$APP_DIR")/.vcontrolhub-build.XXXXXX")"
# Include current working-tree edits, while excluding data and generated trees.
# Credentials are copied separately with private permissions.
tar -C "$APP_DIR" --exclude='./.git' --exclude='./node_modules*' --exclude='./.next*' \
	--exclude='./dist*' --exclude='./.env*' --exclude='./storage' --exclude='./uploads' \
	--exclude='./downloads' --exclude='./backups' --exclude='./logs' --exclude='./tmp' \
	--exclude='./coverage' --exclude='./test-results' --exclude='./playwright-report' -cf - . | tar -C "$stage_dir" -xf -
for secret in .env .env.local .env.runtime .env.production; do
	if [ -f "$APP_DIR/$secret" ]; then install -m 600 "$APP_DIR/$secret" "$stage_dir/$secret"; fi
done
chown -R "$APP_USER:$APP_USER" "$stage_dir"
chmod 700 "$stage_dir"
cd "$stage_dir"

echo "==> [2/8] 安装依赖、生成客户端并构建候选运行产物"
sudo -u "$APP_USER" env NODE_ENV=development bash -lc 'umask 022; npm ci'
sudo -u "$APP_USER" bash -lc 'umask 022; npx prisma generate'
sudo -u "$APP_USER" env NODE_OPTIONS="--max-old-space-size=4096" bash -lc 'umask 022; npm run build'
sudo -u "$APP_USER" bash -lc 'umask 022; npm run build:runtime; npm run verify:deploy-assets'
for artifact in .next/BUILD_ID dist/server.js dist/worker.js dist/ssh-ws-proxy.js dist/upload-recovery-backup.js; do
	[ -f "$stage_dir/$artifact" ] || { echo "FAIL: 候选产物缺失: $artifact"; exit 1; }
done

echo "==> [3/8] 候选构建通过后应用迁移并同步角色权限"
sudo -u "$APP_USER" npx prisma migrate deploy
sudo -u "$APP_USER" bash -lc 'set -e; set -a; if [ -f .env.runtime ]; then source .env.runtime; else source .env.local; fi; set +a; node dist/seed.js'
cd "$APP_DIR"
rollback_dir="$(mktemp -d "$(dirname "$APP_DIR")/.vcontrolhub-rollback.XXXXXX")"
chmod 700 "$rollback_dir"
mkdir "$rollback_dir/units"
NEXT_UNIT="$SYSTEMD_UNIT_DIR/$SERVICE_NAME.service"
WORKER_UNIT="$SYSTEMD_UNIT_DIR/$WORKER_SERVICE_NAME.service"
[ -f "$NEXT_UNIT" ] || { echo "找不到 $NEXT_UNIT"; exit 1; }
cp -a "$NEXT_UNIT" "$rollback_dir/units/next.service"
if [ -f "$WORKER_UNIT" ]; then worker_was_present=1; cp -a "$WORKER_UNIT" "$rollback_dir/units/worker.service"; fi
if [ -f "$SYSTEMD_UNIT_DIR/$SERVICE_NAME.service.d/10-workers.conf" ]; then cp -a "$SYSTEMD_UNIT_DIR/$SERVICE_NAME.service.d/10-workers.conf" "$rollback_dir/units/workers.conf"; fi
CADDY_FILE="${CADDY_FILE:-/etc/caddy/Caddyfile}"
[ ! -f "$CADDY_FILE" ] || cp -a "$CADDY_FILE" "$rollback_dir/Caddyfile"
units_saved=1

echo "==> [4/8] 安装独立 Worker unit，并关闭 Next 进程内 Worker"
NEXT_UNIT="$SYSTEMD_UNIT_DIR/${SERVICE_NAME}.service"
WORKER_UNIT="$SYSTEMD_UNIT_DIR/${WORKER_SERVICE_NAME}.service"
[ -f "$NEXT_UNIT" ] || { echo "  FAIL: 找不到 $NEXT_UNIT"; exit 1; }
if [ ! -f "$WORKER_UNIT" ]; then
cp "$NEXT_UNIT" "$WORKER_UNIT"
sed -i \
	-e 's/^Description=.*/Description=VControlHub background worker/' \
	-e '/^Environment=PORT=/d' \
	-e '/^Environment=VCONTROLHUB_WORKERS_DISABLED=/d' \
	-e 's|/dist/server\.js|/dist/worker.js|' \
	-e 's/SyslogIdentifier=vcontrolhub-next/SyslogIdentifier=vcontrolhub-worker/' \
	"$WORKER_UNIT"
fi
mkdir -p "$SYSTEMD_UNIT_DIR/${SERVICE_NAME}.service.d"
printf '[Service]\nEnvironment=VCONTROLHUB_WORKERS_DISABLED=true\n' \
	> "$SYSTEMD_UNIT_DIR/${SERVICE_NAME}.service.d/10-workers.conf"
chmod 0644 "$WORKER_UNIT" "$SYSTEMD_UNIT_DIR/${SERVICE_NAME}.service.d/10-workers.conf"
systemctl daemon-reload
systemctl enable "$WORKER_SERVICE_NAME"

echo "==> [5/8] 检测并更新 Caddy /direct 反代（写入前后校验 + 备份轮转）"
CADDY_FILE="${CADDY_FILE:-/etc/caddy/Caddyfile}"
if [ -f "$CADDY_FILE" ]; then
	if ! grep -q 'reverse_proxy /direct' "$CADDY_FILE"; then
		# R2: 多版本 backup 轮转 (保留最近 5 个 .bak.TS, 删旧的)
		# 命名格式: Caddyfile.bak.YYYYMMDDHHMMSS (跟旧 deploy.sh 兼容)
		BACKUP="${CADDY_FILE}.bak.$(date +%Y%m%d%H%M%S)"
		cp "$CADDY_FILE" "$BACKUP"
		# 轮转: 只留最近 5 个 .bak.* 备份
		ls -1t "${CADDY_FILE}".bak.* 2>/dev/null | tail -n +6 | xargs -r rm -f
		# R2: 先注入到 .new 文件, validate 通过才覆盖 (避免写一半的 Caddyfile 残留)
		NEW_FILE="${CADDY_FILE}.new.$$"
		awk '
			/reverse_proxy 127\.0\.0\.1:3000/ && !done {
				print "\n	# TR-002: Direct Gateway 反代 (本机 SFTP node 用)"
				print "	# 远端 server 的 direct gateway 由各自反向代理/VPN/防火墙保护"
				print "	reverse_proxy /direct 127.0.0.1:31888"
				print "	reverse_proxy /direct/* 127.0.0.1:31888"
				done=1
			}
			{ print }
		' "$BACKUP" > "$NEW_FILE"
		# R2: validate-before-replace: 失败时 .new 不覆盖, 立即回滚到 backup
		if caddy validate --config "$NEW_FILE" --adapter caddyfile >/dev/null 2>&1; then
			mv "$NEW_FILE" "$CADDY_FILE"
			echo "  注入 /direct 反代段 (backup: $BACKUP, 验证通过后原子替换)"
		else
			validate_exit=$?
			echo "  FAIL: caddy validate 退出码 $validate_exit, 保留 backup: $BACKUP"
			echo "  详细: caddy validate --config $NEW_FILE --adapter caddyfile"
			caddy validate --config "$NEW_FILE" --adapter caddyfile 2>&1 | head -20
			rm -f "$NEW_FILE"
			exit 1
		fi
	else
		echo "  /direct 反代已存在, 跳过"
	fi
	# Final validation prevents a concurrent edit from reaching the later restart.
	if caddy validate --config "$CADDY_FILE" --adapter caddyfile >/dev/null 2>&1; then
		echo "  caddy validate OK（将在服务启动阶段统一 restart）"
	else
		validate_exit=$?
		echo "  FAIL: caddy validate 退出码 $validate_exit, 恢复最新 backup"
		latest_backup=$(ls -1t "${CADDY_FILE}".bak.* 2>/dev/null | head -1)
		if [ -n "$latest_backup" ]; then
			cp "$latest_backup" "$CADDY_FILE"
			echo "  已恢复 $latest_backup"
		fi
		exit 1
	fi
else
	echo "  跳过 ($CADDY_FILE 不存在)"
fi

echo "==> [6/8] 验证 vcontrolhub-direct.service 的 loopback 绑定（如已安装）"
if systemctl list-unit-files vcontrolhub-direct.service >/dev/null 2>&1; then
	if ! systemctl show vcontrolhub-direct.service -p Environment 2>/dev/null | grep -q DIRECT_BIND; then
		echo "  WARNING: vcontrolhub-direct.service 未显式声明 DIRECT_BIND. 建议在 /etc/vcontrolhub-direct.env 加 DIRECT_BIND=127.0.0.1 然后 systemctl restart vcontrolhub-direct.service"
	else
		echo "  DIRECT_BIND 已声明"
	fi
else
	echo "  跳过 (服务未安装)"
fi

echo "==> [7/8] 短暂停止服务，切换完整运行产物"
service_stopped=1
systemctl stop "$SERVICE_NAME" "$WORKER_SERVICE_NAME" "$SSH_SERVICE_NAME"
artifacts_promoted=1
for artifact in .next dist node_modules; do
	[ ! -e "$APP_DIR/$artifact" ] || mv "$APP_DIR/$artifact" "$rollback_dir/$artifact"
	mv "$stage_dir/$artifact" "$APP_DIR/$artifact"
done
systemctl reset-failed "$SERVICE_NAME" "$WORKER_SERVICE_NAME" "$SSH_SERVICE_NAME" 2>/dev/null || true
systemctl start "$SERVICE_NAME" "$WORKER_SERVICE_NAME" "$SSH_SERVICE_NAME"
if [ -f "$CADDY_FILE" ]; then systemctl reload caddy; fi

echo "==> [8/8] 验证服务及 SSH 协议，再执行 smoke test"
for svc in "$SERVICE_NAME" "$WORKER_SERVICE_NAME" "$SSH_SERVICE_NAME"; do
	if ! systemctl is-active --quiet "$svc"; then echo "FAIL: $svc 未 active"; exit 1; fi
done
# Run the candidate helper, even when a source-only deploy has not updated it
# in the live tree yet. The environment is injected without reading sandboxed
# files as the gateway's dynamic user.
if [ -f "$APP_DIR/.env.runtime" ]; then probe_env="$APP_DIR/.env.runtime"; else probe_env="$APP_DIR/.env.local"; fi
(set -a; source "$probe_env"; set +a; node "$APP_DIR/scripts/check-ssh-gateway.mjs")
[ -f "$stage_dir/deploy/smoke-test.sh" ] || { echo "FAIL: smoke test 缺失"; exit 1; }
APP_DIR="$APP_DIR" bash "$stage_dir/deploy/smoke-test.sh"
service_stopped=0
echo "==> 运行产物回滚目录: $rollback_dir"

# 部署成功后清理 webpack 持久化缓存 (deploy 后留 429M+ 没用, 下次 build 重建)
# 保留 swc cache (12K, 加快 next build 编译)
echo "==> [cleanup] 清理 .next/cache/webpack（下次构建会按需重建）"
if [ -d "$APP_DIR/.next/cache/webpack" ]; then
  size_before=$(du -sm "$APP_DIR/.next/cache/webpack" 2>/dev/null | awk '{print $1}')
  rm -rf "$APP_DIR/.next/cache/webpack"
  chown -R "$APP_USER:$APP_USER" "$APP_DIR/.next/cache" 2>/dev/null || true
  echo "  释放 ${size_before}M"
else
  echo "  跳过 (无 webpack cache)"
fi

echo "==> 部署完成"
