#!/usr/bin/env bash
# Daily Full Inspection Script for firstproject
# Runs all 7 inspection phases sequentially, outputs a summary report.
# Used by the Hermes cron job for automated daily checks.
set -euo pipefail

APP_DIR="/root/firstproject"
COOKIE_FILE="/tmp/daily_qc.txt"
REPORT="/tmp/daily_inspection_report.txt"
PASS=0
FAIL=0
WARN=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { printf "${GREEN}[✓]${NC} %s\n" "$*"; PASS=$((PASS+1)); }
warn() { printf "${YELLOW}[!]${NC} %s\n" "$*" >&2; WARN=$((WARN+1)); }
fail() { printf "${RED}[✗]${NC} %s\n" "$*" >&2; FAIL=$((FAIL+1)); }
section() { printf "\n${CYAN}═══ %s ═══${NC}\n" "$*"; }

# Helper: check HTTP status code
check_http() {
  local label="$1" url="$2" expect="$3"
  local code
  code=$(curl -s -b "$COOKIE_FILE" -o /dev/null -w '%{http_code}' --max-time 10 "$url" 2>/dev/null || echo "000")
  if [ "$code" = "$expect" ]; then
    log "$label → $code"
  else
    warn "$label → $code (expected $expect)"
  fi
}

check_http_noauth() {
  local label="$1" url="$2"
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url" 2>/dev/null || echo "000")
  case "$code" in
    307|401|403) log "$label (no auth) → $code (rejected ✓)";;
    *) warn "$label (no auth) → $code (expected 307/401/403)";;
  esac
}

check_service() {
  local svc="$1"
  if systemctl is-active --quiet "$svc" 2>/dev/null; then
    log "$svc active"
  else
    fail "$svc NOT active"
  fi
}

# ──────────────────────────────────────────────
# Login first
# ──────────────────────────────────────────────
rm -f "$COOKIE_FILE"
LOGIN_CODE=$(curl -s -c "$COOKIE_FILE" -D /tmp/daily_login_h.txt \
  -X POST http://127.0.0.1:3000/api/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin&password=Admin%402026changeMe%21" \
  -o /dev/null -w '%{http_code}' --max-time 10 2>/dev/null || echo "000")

if echo "$LOGIN_CODE" | grep -qE "302|303|307"; then
  log "Admin login → $LOGIN_CODE (redirect ✓)"
else
  fail "Admin login → $LOGIN_CODE (expected redirect)"
  # Try restarting service to clear lockout
  systemctl restart whrkhldsb-next 2>/dev/null || true
  sleep 5
  LOGIN_CODE=$(curl -s -c "$COOKIE_FILE" -D /tmp/daily_login_h.txt \
    -X POST http://127.0.0.1:3000/api/login \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "username=admin&password=Admin%402026changeMe%21" \
    -o /dev/null -w '%{http_code}' --max-time 10 2>/dev/null || echo "000")
  if echo "$LOGIN_CODE" | grep -qE "302|303|307"; then
    log "Admin login (after restart) → $LOGIN_CODE ✓"
  else
    fail "Admin login failed even after restart — aborting"
    exit 1
  fi
fi

# ═══════════════════════════════════════════════
section "Phase 1: 核心基础与认证系统"
# ═══════════════════════════════════════════════

# Server resources
MEM_AVAIL=$(free -m | awk '/Mem:/{print $7}')
[ "$MEM_AVAIL" -gt 200 ] 2>/dev/null && log "Available memory: ${MEM_AVAIL}MB" || warn "Low memory: ${MEM_AVAIL}MB"

DISK_PCT=$(df / | awk 'NR==2{print $5}' | tr -d '%')
[ "$DISK_PCT" -lt 85 ] 2>/dev/null && log "Disk usage: ${DISK_PCT}%" || warn "Disk usage high: ${DISK_PCT}%"

LOAD=$(uptime | awk -F'load average:' '{print $2}' | awk '{print $1}' | tr -d ',')
log "Load average: $LOAD"

# Services
for svc in whrkhldsb-next whrkhldsb-ssh-ws apache2 postgresql docker; do
  check_service "$svc"
done

# Auth
check_http_noauth "GET /api/users" "http://127.0.0.1:3000/api/users"
check_http "GET /api/users (auth)" "http://127.0.0.1:3000/api/users" "200"
check_http "GET /api/audit (auth)" "http://127.0.0.1:3000/api/audit" "200"
check_http "GET /api/api-tokens (auth)" "http://127.0.0.1:3000/api/api-tokens" "200"

# Service errors in last 24h
ERR_COUNT=$(journalctl -u whrkhldsb-next --no-pager --since "24 hours ago" 2>/dev/null | grep -ci "error\|crash\|fatal" || true)
if [ "$ERR_COUNT" -lt 10 ]; then
  log "Service errors (24h): $ERR_COUNT"
else
  warn "Service errors (24h): $ERR_COUNT — check logs"
fi

# Node process memory
NODE_MEM=$(ps aux | grep "node.*server" | grep -v grep | awk '{sum+=$6}END{printf "%.0f", sum/1024}')
log "Node.js memory: ${NODE_MEM}MB"

# ═══════════════════════════════════════════════
section "Phase 2: API端点全面扫描"
# ═══════════════════════════════════════════════

# Core APIs
for ep in /api/settings /api/preferences /api/dashboard/analytics /api/health /api/status /api/system-health /api/announcements /api/snippets /api/tickets /api/operation-tasks /api/alert-rules /api/scheduled-tasks /api/deployments /api/deploy-export /api/notifications /api/commands /api/command-templates /api/backups /api/share-links; do
  check_http "GET $ep" "http://127.0.0.1:3000$ep" "200"
done

# Auth endpoints
check_http "GET /api/auth/ws-token" "http://127.0.0.1:3000/api/auth/ws-token" "200"
check_http_noauth "GET /api/settings (no auth)" "http://127.0.0.1:3000/api/settings"

# ═══════════════════════════════════════════════
section "Phase 3: 前端页面与安全"
# ═══════════════════════════════════════════════

# Pages
for page in /login /servers /files /storage /downloads /media /quick-services /settings /users /audit /docker /ai /monitoring /status /health; do
  check_http "Page $page" "http://127.0.0.1:3000$page" "200"
done

# Security headers via Apache
SEC_COUNT=$(curl -sS -D- http://127.0.0.1:80/login 2>/dev/null | grep -ci "X-Content-Type-Options\|X-Frame-Options\|X-XSS-Protection\|Referrer-Policy" || true)
if [ "$SEC_COUNT" -ge 4 ]; then
  log "Security headers: $SEC_COUNT present"
else
  warn "Security headers: only $SEC_COUNT/4 present"
fi

# Port exposure
if ss -tlnp 2>/dev/null | grep -q "0.0.0.0:3000"; then
  warn "Port 3000 bound on 0.0.0.0 (should be 127.0.0.1 only)"
else
  log "Port 3000 bound on 127.0.0.1 only ✓"
fi

# Apache config
if apache2ctl configtest 2>&1 | grep -q "Syntax OK"; then
  log "Apache config syntax OK"
else
  fail "Apache config error"
fi

# Static assets
FIRST_JS=$(curl -s -b "$COOKIE_FILE" http://127.0.0.1:3000/login 2>/dev/null | grep -oP '"/_next/static/chunks/[^"]*\.js"' | head -1 | tr -d '"')
if [ -n "$FIRST_JS" ]; then
  check_http "JS chunk ${FIRST_JS:0:40}..." "http://127.0.0.1:3000${FIRST_JS}" "200"
else
  warn "No JS chunks found in login page"
fi

# ═══════════════════════════════════════════════
section "Phase 4: 服务器/SSH/文件/监控/Docker"
# ═══════════════════════════════════════════════

# SSH-WS
check_service "whrkhldsb-ssh-ws"
if ss -tlnp 2>/dev/null | grep -q "127.0.0.1:3001"; then
  log "SSH-WS on 127.0.0.1:3001 ✓"
else
  fail "SSH-WS not on 127.0.0.1:3001"
fi

# File APIs
check_http "GET /api/files/list" "http://127.0.0.1:3000/api/files/list" "200"
# archive-list may need query params, 400 is acceptable
ARCHIVE_CODE=$(curl -s -b "$COOKIE_FILE" -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:3000/api/files/archive-list" 2>/dev/null || echo "000")
case "$ARCHIVE_CODE" in 200|400) log "GET /api/files/archive-list → $ARCHIVE_CODE";; *) warn "GET /api/files/archive-list → $ARCHIVE_CODE";; esac

# Monitoring & Docker
check_http "GET /api/monitoring/stats" "http://127.0.0.1:3000/api/monitoring/stats" "200"
check_http "GET /api/docker/containers" "http://127.0.0.1:3000/api/docker/containers" "200"

# ═══════════════════════════════════════════════
section "Phase 5: 存储/下载/图床/媒体/分享"
# ═══════════════════════════════════════════════

# Storage APIs — many require body params, 400/405 is acceptable for GET without params
for ep in /api/storage/sftp /api/storage/local; do
  CODE=$(curl -s -b "$COOKIE_FILE" -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:3000$ep" 2>/dev/null || echo "000")
  case "$CODE" in 200|400) log "GET $ep → $CODE";; *) warn "GET $ep → $CODE";; esac
done
# POST-only endpoints — 405 (Method Not Allowed) for GET is expected
for ep in /api/storage/sftp-ops /api/storage/sftp-sync /api/storage/sftp-download /api/storage/direct-access /api/images/batch; do
  CODE=$(curl -s -b "$COOKIE_FILE" -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:3000$ep" 2>/dev/null || echo "000")
  case "$CODE" in 200|400|405) log "GET $ep → $CODE (POST-only OK)";; *) warn "GET $ep → $CODE";; esac
done
# Standard GET APIs
for ep in /api/downloads /api/images/list /api/images/stats /api/media /api/share-links; do
  check_http "GET $ep" "http://127.0.0.1:3000$ep" "200"
done

# Runtime dirs
for d in storage tmp uploads downloads backups logs; do
  if [ -d "$APP_DIR/$d" ]; then
    log "Runtime dir $d exists"
  else
    fail "Missing runtime dir: $d"
  fi
done

# ═══════════════════════════════════════════════
section "Phase 6: AI/快捷服务/应用商店/告警"
# ═══════════════════════════════════════════════

for ep in /api/ai/providers /api/ai/conversations /api/ai/hosted-actions; do
  check_http "GET $ep" "http://127.0.0.1:3000$ep" "200"
done
# ai/models needs provider param, 400 is acceptable
AI_MODELS_CODE=$(curl -s -b "$COOKIE_FILE" -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:3000/api/ai/models" 2>/dev/null || echo "000")
case "$AI_MODELS_CODE" in 200|400) log "GET /api/ai/models → $AI_MODELS_CODE";; *) warn "GET /api/ai/models → $AI_MODELS_CODE";; esac
for ep in /api/quick-services /api/quick-services/check-port?port=9999 /api/app-sources /api/alert-rules /api/scheduled-tasks /api/operation-tasks /api/announcements /api/snippets /api/notifications; do
  check_http "GET $ep" "http://127.0.0.1:3000$ep" "200"
done

# Verify remote catalog
REMOTE_COUNT=$(curl -s -b "$COOKIE_FILE" "http://127.0.0.1:3000/api/quick-services" 2>/dev/null | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(len(d.get('remoteCatalog',[])))" 2>/dev/null || echo "0")
if [ "$REMOTE_COUNT" -gt 100 ]; then
  log "Remote catalog: $REMOTE_COUNT apps"
else
  warn "Remote catalog low: $REMOTE_COUNT apps (expected ~187)"
fi

LOCAL_COUNT=$(curl -s -b "$COOKIE_FILE" "http://127.0.0.1:3000/api/quick-services" 2>/dev/null | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(len(d.get('catalog',[])))" 2>/dev/null || echo "0")
log "Local catalog: $LOCAL_COUNT apps"

# ═══════════════════════════════════════════════
section "Phase 7: 部署脚本/数据库/安全/依赖"
# ═══════════════════════════════════════════════

# Install script syntax
if CHECK_SYNTAX_ONLY=1 bash "$APP_DIR/install.sh" 2>/dev/null; then
  log "install.sh syntax OK"
else
  fail "install.sh syntax error"
fi

# Preflight & check
if APP_DIR="$APP_DIR" ENV_FILE="$APP_DIR/.env.local" bash "$APP_DIR/deploy/preflight.sh" >/dev/null 2>&1; then
  log "preflight.sh passed"
else
  warn "preflight.sh failed"
fi

if APP_DIR="$APP_DIR" bash "$APP_DIR/deploy/check.sh" >/dev/null 2>&1; then
  log "check.sh passed"
else
  warn "check.sh failed"
fi

# Database
DB_SIZE=$(sudo -u postgres psql -d whrkhldsb -t -c "SELECT pg_database_size('whrkhldsb')/1024/1024;" 2>/dev/null | xargs || echo "?")
log "Database size: ${DB_SIZE}MB"

MIG_COUNT=$(sudo -u postgres psql -d whrkhldsb -t -c "SELECT count(*) FROM _prisma_migrations;" 2>/dev/null | xargs || echo "?")
log "Prisma migrations: $MIG_COUNT"

USER_COUNT=$(sudo -u postgres psql -d whrkhldsb -t -c 'SELECT count(*) FROM "User";' 2>/dev/null | xargs || echo "?")
log "Users in DB: $USER_COUNT"

REMOTE_APP_COUNT=$(sudo -u postgres psql -d whrkhldsb -t -c "SELECT count(*) FROM app_source_apps;" 2>/dev/null | xargs || echo "?")
log "Remote apps in DB: $REMOTE_APP_COUNT"

# npm audit (high/critical only)
VULN_HIGH=$(cd "$APP_DIR" && npm audit --production 2>/dev/null | grep -oE '[0-9]+ high' | grep -oE '[0-9]+' || echo "0")
VULN_CRIT=$(cd "$APP_DIR" && npm audit --production 2>/dev/null | grep -oE '[0-9]+ critical' | grep -oE '[0-9]+' || echo "0")
TOTAL_VULN=$((VULN_HIGH + VULN_CRIT))
if [ "$TOTAL_VULN" = "0" ]; then
  log "npm audit: no high/critical vulnerabilities"
else
  warn "npm audit: $VULN_HIGH high + $VULN_CRIT critical vulnerabilities"
fi

# Disk
log "Disk: $(df -h / | awk 'NR==2{print $5 " used, " $4 " free"}')"
log "Memory: $(free -h | awk '/Mem:/{print $3 " used, " $2 " total"}')"

# Docker disk usage
if command -v docker >/dev/null 2>&1; then
  DOCKER_DISK=$(docker system df 2>/dev/null | head -2 | tail -1 | awk '{print $3}' || echo "?")
  log "Docker disk: $DOCKER_DISK"
fi

# ═══════════════════════════════════════════════
# Final Summary
# ═══════════════════════════════════════════════
printf "\n${CYAN}═══════════════════════════════════════${NC}\n"
printf "${CYAN} 📊 每日巡检报告 — $(date '+%Y-%m-%d %H:%M')${NC}\n"
printf "${CYAN}═══════════════════════════════════════${NC}\n"
printf " ✅ 正常: %d\n" "$PASS"
printf " ⚠️  警告: %d\n" "$WARN"
printf " ❌ 异常: %d\n" "$FAIL"
printf "${CYAN}═══════════════════════════════════════${NC}\n"

# Save report
{
  echo "=== 每日巡检报告 $(date '+%Y-%m-%d %H:%M') ==="
  echo "✅ 正常: $PASS  ⚠️ 警告: $WARN  ❌ 异常: $FAIL"
  echo "磁盘: $(df -h / | awk 'NR==2{print $5}')  内存: $(free -h | awk '/Mem:/{print $3"/"$2}')  负载: $LOAD"
  echo "服务: next=$(systemctl is-active whrkhldsb-next) ssh-ws=$(systemctl is-active whrkhldsb-ssh-ws) apache=$(systemctl is-active apache2) pg=$(systemctl is-active postgresql)"
  echo "DB: ${DB_SIZE}MB  迁移: $MIG_COUNT  用户: $USER_COUNT  远程应用: $REMOTE_APP_COUNT"
  echo "24h错误: $ERR_COUNT  npm高危: $VULN_HIGH"
} > "$REPORT"

# Exit with failure if any critical issues
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
