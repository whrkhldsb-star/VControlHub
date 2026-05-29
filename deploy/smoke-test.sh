#!/usr/bin/env bash
# Post-deploy smoke test — run after every code/config change.
# Verifies all services are up and the site is fully accessible.
# Usage: bash deploy/smoke-test.sh [EXTERNAL_IP_OR_DOMAIN] [APP_SLUG]
set -euo pipefail

TARGET="${1:-}"
APP_SLUG="${2:-${SERVICE_PREFIX:-vcontrolhub}}"
NEXT_PORT="${NEXT_PORT:-3000}"
SSH_WS_PORT="${SSH_WS_PORT:-3001}"

[ -z "${TARGET}" ] && TARGET="$(ip -4 addr show scope global 2>/dev/null | grep -oP 'inet \K[0-9.]+' | head -1)" || true
[ -z "${TARGET}" ] && TARGET="localhost"

# Allow APP_DIR override via env (defaults to /opt/${APP_SLUG} for standard installs,
# but auto-detects from systemd service if available)
if [ -z "${APP_DIR:-}" ]; then
	SMOKE_APP_DIR="$(systemctl show "${APP_SLUG}-next.service" -p WorkingDirectory --value 2>/dev/null || true)"
	: "${SMOKE_APP_DIR:=/opt/${APP_SLUG}}"
else
	SMOKE_APP_DIR="${APP_DIR}"
fi
ENV_FILE="${ENV_FILE:-${SMOKE_APP_DIR}/.env.local}"
if [ -f "${ENV_FILE}" ]; then
    # Load install-time port overrides so smoke tests match customized fresh installs.
    set -a
    # shellcheck disable=SC1090
    source "${ENV_FILE}"
    set +a
fi
NEXT_PORT="${NEXT_PORT:-3000}"
SSH_WS_PORT="${SSH_WS_PORT:-3001}"

PASS=0
FAIL=0
PROXY_SERVICE="apache2"
PROXY_LABEL="Apache"
PROXY_PUBLIC_URL="http://${TARGET}"
if systemctl list-unit-files caddy.service >/dev/null 2>&1; then
    PROXY_SERVICE="caddy"
    PROXY_LABEL="Caddy"
    PROXY_PUBLIC_URL="https://${TARGET}"
fi

check() {
    local label="$1" cmd="$2" expect="${3:-0}"
    local result
    result="$(eval "$cmd" 2>&1)" || result="FAILED"
    if [ "${expect}" -eq 0 ] && [ "${result}" != "FAILED" ]; then
        printf "  ✅ %s\n" "${label}"
        PASS=$((PASS + 1))
    elif [ "${expect}" -ne 0 ] && [ "${result}" = "FAILED" ]; then
        printf "  ✅ %s (expected failure)\n" "${label}"
        PASS=$((PASS + 1))
    else
        printf "  ❌ %s — output: %s\n" "${label}" "${result}"
        FAIL=$((FAIL + 1))
    fi
}

echo "═══════════════════════════════════════════════"
echo " 🚀 Post-Deploy Smoke Test — Target: ${TARGET}"
echo "═══════════════════════════════════════════════"
echo ""

echo "── 1. System Services ──"
check "${APP_SLUG}-next service"   "systemctl is-active ${APP_SLUG}-next" 0
check "${APP_SLUG}-ssh-ws service" "systemctl is-active ${APP_SLUG}-ssh-ws" 0
check "${PROXY_LABEL} service"      "systemctl is-active ${PROXY_SERVICE}" 0
check "PostgreSQL service"         "systemctl is-active postgresql" 0

echo ""
echo "── 2. Port Binding ──"
check "Next.js on 127.0.0.1:${NEXT_PORT}"  "ss -tlnp | grep '127.0.0.1:${NEXT_PORT}'" 0
check "SSH-WS on 127.0.0.1:${SSH_WS_PORT}"   "ss -tlnp | grep '127.0.0.1:${SSH_WS_PORT}'" 0
check "${PROXY_LABEL} on *:80"       "ss -tlnp | grep ':80 '" 0

echo ""
echo "── 3. HTTP Response ──"
check "Login page (localhost)"     "curl -sS -o /dev/null -w '%{http_code}' http://localhost:${NEXT_PORT}/login | grep 200" 0
check "Login page (via ${PROXY_LABEL})" "curl -sSk -o /dev/null -w '%{http_code}' ${PROXY_PUBLIC_URL}/login | grep 200" 0
check "API /api/status"            "curl -sSk ${PROXY_PUBLIC_URL}/api/status | grep healthy" 0
check "API auth blocks unauth"     "curl -sSk ${PROXY_PUBLIC_URL}/api/users | grep '未登录'" 0
check "Root redirects to login"    "curl -sSk -o /dev/null -w '%{http_code}' ${PROXY_PUBLIC_URL}/ | grep 307" 0

echo ""
echo "── 4. Static Assets ──"
FIRST_JS="$(curl -sSk ${PROXY_PUBLIC_URL}/login | grep -oP '"/_next/static/chunks/[^"]*\.js"' | head -1 | tr -d '"')"
if [ -n "${FIRST_JS}" ]; then
    check "JS chunk ${FIRST_JS:0:40}..." "curl -sSk -o /dev/null -w '%{http_code}' ${PROXY_PUBLIC_URL}${FIRST_JS} | grep 200" 0
else
    printf "  ⚠️  No JS chunks found in HTML\n"
fi

echo ""
echo "── 5. Security ──"
check "No direct public Next.js access"      "ss -tlnp | grep '0.0.0.0:${NEXT_PORT}' ; echo missing" 0
check "Security headers present"   "curl -sSk -D- ${PROXY_PUBLIC_URL}/login | grep -i X-Content-Type-Options" 0

echo ""
echo "── 6. SSH-WS Proxy ──"
check "SSH-WS service running"     "systemctl is-active ${APP_SLUG}-ssh-ws" 0
check "SSH-WS on 127.0.0.1:${SSH_WS_PORT}"   "ss -tlnp | grep '127.0.0.1:${SSH_WS_PORT}'" 0
check "SSH_WS_SECRET configured"   "grep -q 'SSH_WS_SECRET=..' \"${SMOKE_APP_DIR}/.env.local\"" 0
check "SSH_WS_ALLOWED_ORIGINS has target" "grep SSH_WS_ALLOWED_ORIGINS \"${SMOKE_APP_DIR}/.env.local\" | grep -q \"${TARGET}\"" 0

echo ""
echo "═══════════════════════════════════════════════"
if [ "${FAIL}" -eq 0 ]; then
    echo " ✅ ALL ${PASS} CHECKS PASSED"
else
    echo " ❌ ${FAIL} FAILED, ${PASS} PASSED"
    echo " ⚠️  Do NOT proceed — fix failures above first!"
    exit 1
fi
echo "═══════════════════════════════════════════════"
