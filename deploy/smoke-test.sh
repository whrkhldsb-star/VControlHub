#!/usr/bin/env bash
# Post-deploy smoke test — run after every code/config change.
#
# Usage:
#   bash deploy/smoke-test.sh [EXTERNAL_IP_OR_DOMAIN] [APP_SLUG]
#   SMOKE_SCOPE=systemd bash deploy/smoke-test.sh "" vcontrolhub
#   SMOKE_SCOPE=http bash deploy/smoke-test.sh whrkhldsb.qzz.io vcontrolhub
#
# Scopes:
#   full    — systemd/local checks + public HTTP checks (default, backwards-compatible)
#   systemd — local host checks only; no public reverse-proxy assumptions
#   http    — black-box public HTTP checks only; no systemd/PostgreSQL/port assumptions
set -euo pipefail

TARGET="${1:-}"
APP_SLUG="${2:-${SERVICE_PREFIX:-vcontrolhub}}"
SMOKE_SCOPE="${SMOKE_SCOPE:-full}"
NEXT_PORT="${NEXT_PORT:-3000}"
SSH_WS_PORT="${SSH_WS_PORT:-3001}"

case "${SMOKE_SCOPE}" in
  full|systemd|http) ;;
  *)
    printf 'Invalid SMOKE_SCOPE=%s (expected full, systemd, or http)\n' "${SMOKE_SCOPE}" >&2
    exit 2
    ;;
esac

run_systemd_checks() { [ "${SMOKE_SCOPE}" = "full" ] || [ "${SMOKE_SCOPE}" = "systemd" ]; }
run_http_checks() { [ "${SMOKE_SCOPE}" = "full" ] || [ "${SMOKE_SCOPE}" = "http" ]; }

# Allow APP_DIR override via env (defaults to /opt/${APP_SLUG} for standard installs,
# but auto-detects from systemd service if available).
if [ -z "${APP_DIR:-}" ]; then
    SMOKE_APP_DIR="$(systemctl show "${APP_SLUG}-next.service" -p WorkingDirectory --value 2>/dev/null || true)"
    : "${SMOKE_APP_DIR:=/opt/${APP_SLUG}}"
else
    SMOKE_APP_DIR="${APP_DIR}"
fi

ENV_FILE="${ENV_FILE:-}"
if [ -z "${ENV_FILE}" ]; then
    if [ -f "${SMOKE_APP_DIR}/.env.runtime" ]; then
        ENV_FILE="${SMOKE_APP_DIR}/.env.runtime"
    else
        ENV_FILE="${SMOKE_APP_DIR}/.env.local"
    fi
fi
if [ -f "${ENV_FILE}" ]; then
    # Load install-time port/origin overrides so smoke tests match customized installs.
    set -a
    # shellcheck disable=SC1090
    source "${ENV_FILE}"
    set +a
fi
NEXT_PORT="${NEXT_PORT:-3000}"
SSH_WS_PORT="${SSH_WS_PORT:-3001}"

if [ -z "${TARGET}" ] && [ -n "${SMOKE_TARGET:-}" ]; then
    TARGET="${SMOKE_TARGET}"
fi
if [ -z "${TARGET}" ] && [ -n "${SSH_WS_ALLOWED_ORIGINS:-}" ]; then
    TARGET="$(printf '%s' "${SSH_WS_ALLOWED_ORIGINS}" | tr ',' '\n' | grep -E '^https?://[^/]+\.[^/]+' | grep -Ev '^https?://(localhost|127\.|0\.0\.0\.0|\[?::1)' | head -1 | sed -E 's#^https?://([^/]+).*#\1#')"
fi
if [ -z "${TARGET}" ] && run_systemd_checks; then
    TARGET="$(ip -4 addr show scope global 2>/dev/null | grep -oP 'inet \K[0-9.]+' | head -1)" || true
fi
[ -z "${TARGET}" ] && TARGET="localhost"

PASS=0
FAIL=0
PROXY_SERVICE="apache2"
PROXY_LABEL="Apache"
PROXY_PUBLIC_URL="http://${TARGET}"
SMOKE_PUBLIC_URL="${SMOKE_PUBLIC_URL:-}"
SMOKE_READY_TIMEOUT_SECONDS="${SMOKE_READY_TIMEOUT_SECONDS:-30}"

if [ -n "${SMOKE_PUBLIC_URL}" ]; then
    PROXY_PUBLIC_URL="${SMOKE_PUBLIC_URL%/}"
    PROXY_LABEL="public HTTP"
elif systemctl list-unit-files caddy.service >/dev/null 2>&1; then
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

wait_for_systemd_readiness() {
    local deadline=$((SECONDS + SMOKE_READY_TIMEOUT_SECONDS))
    local local_code="000"

    while [ "${SECONDS}" -le "${deadline}" ]; do
        local_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 2 "http://localhost:${NEXT_PORT}/login" 2>/dev/null || true)"
        if [ "${local_code}" = "200" ]; then
            return 0
        fi
        sleep 1
    done

    printf "Timed out after %ss (local /login=%s)" "${SMOKE_READY_TIMEOUT_SECONDS}" "${local_code}"
    return 1
}

wait_for_public_readiness() {
    local deadline=$((SECONDS + SMOKE_READY_TIMEOUT_SECONDS))
    local public_status=""

    while [ "${SECONDS}" -le "${deadline}" ]; do
        public_status="$(curl -sSk --max-time 2 "${PROXY_PUBLIC_URL}/api/status" 2>/dev/null || true)"
        # TR-053 之后公开 /api/status 只返 {generatedAt, service, summary:{overall}}, 不再含 "healthy" 字面量
        # 检查 overall 字段是 healthy / warning / critical 之一 (即服务在跑, 不是 5xx / 502 之类的 dead 响应)
        if printf '%s' "${public_status}" | grep -qE '"overall"\s*:\s*"(healthy|warning|critical)"'; then
            return 0
        fi
        sleep 1
    done

    printf "Timed out after %ss (public /api/status=%s)" "${SMOKE_READY_TIMEOUT_SECONDS}" "${public_status:-empty}"
    return 1
}

check_static_assets() {
    local first_js
    first_js="$(curl -sSk "${PROXY_PUBLIC_URL}/login" | grep -oP '"/_next/static/chunks/[^"]*\.js"' | head -1 | tr -d '"')"
    if [ -n "${first_js}" ]; then
        check "JS chunk ${first_js:0:40}..." "curl -sSk -o /dev/null -w '%{http_code}' ${PROXY_PUBLIC_URL}${first_js} | grep 200" 0
    else
        printf "  ⚠️  No JS chunks found in HTML\n"
    fi
}

echo "═══════════════════════════════════════════════"
echo " 🚀 Post-Deploy Smoke Test — Scope: ${SMOKE_SCOPE} — Target: ${TARGET}"
echo "═══════════════════════════════════════════════"
echo ""

if run_systemd_checks; then
    echo "── 1. System Services ──"
    check "${APP_SLUG}-next service"   "systemctl is-active ${APP_SLUG}-next" 0
    check "${APP_SLUG}-ssh-ws service" "systemctl is-active ${APP_SLUG}-ssh-ws" 0
    if run_http_checks && [ -z "${SMOKE_PUBLIC_URL}" ]; then
        check "${PROXY_LABEL} service" "systemctl is-active ${PROXY_SERVICE}" 0
    elif run_http_checks; then
        printf "  ⚠️  Explicit SMOKE_PUBLIC_URL set; skipping local reverse-proxy service check\n"
    fi
    if systemctl list-unit-files postgresql.service >/dev/null 2>&1; then
        check "PostgreSQL service" "systemctl is-active postgresql" 0
    else
        printf "  ⚠️  PostgreSQL service not installed locally; assuming external database\n"
    fi

    echo ""
    echo "── 1b. Local Readiness Wait ──"
    check "Next.js local login ready" "wait_for_systemd_readiness" 0

    echo ""
    echo "── 2. Port Binding ──"
    check "Next.js on 127.0.0.1:${NEXT_PORT}" "ss -tlnp | grep '127.0.0.1:${NEXT_PORT}'" 0
    check "SSH-WS on 127.0.0.1:${SSH_WS_PORT}" "ss -tlnp | grep '127.0.0.1:${SSH_WS_PORT}'" 0
    if run_http_checks; then
        check "${PROXY_LABEL} on *:80" "ss -tlnp | grep ':80 '" 0
    fi

    echo ""
    echo "── 3. Local HTTP Response ──"
    check "Login page (localhost)" "curl -sS -o /dev/null -w '%{http_code}' http://localhost:${NEXT_PORT}/login | grep 200" 0

    echo ""
    echo "── 4. Local Security ──"
    check "No direct public Next.js access" "! ss -tlnp | grep -q '0.0.0.0:${NEXT_PORT}'" 0

    echo ""
    echo "── 5. SSH-WS Proxy ──"
    check "SSH-WS service running" "systemctl is-active ${APP_SLUG}-ssh-ws" 0
    check "SSH-WS on 127.0.0.1:${SSH_WS_PORT}" "ss -tlnp | grep '127.0.0.1:${SSH_WS_PORT}'" 0
    check "SSH_WS_SECRET configured" "grep -q 'SSH_WS_SECRET=..' \"${ENV_FILE}\"" 0
    if [ -n "${TARGET}" ] && [ -f "${ENV_FILE}" ]; then
        check "SSH_WS_ALLOWED_ORIGINS has target" "grep SSH_WS_ALLOWED_ORIGINS \"${ENV_FILE}\" | grep -q \"${TARGET}\"" 0
    fi
fi

if run_http_checks; then
    echo ""
    echo "── 6. Public HTTP Readiness ──"
    check "Public API /api/status ready" "wait_for_public_readiness" 0

    echo ""
    echo "── 7. Public HTTP Response ──"
    check "Login page (via ${PROXY_LABEL})" "curl -sSk -o /dev/null -w '%{http_code}' ${PROXY_PUBLIC_URL}/login | grep 200" 0
    check "API /api/status" "curl -sSk ${PROXY_PUBLIC_URL}/api/status | grep -qE '\"overall\"\\s*:\\s*\"(healthy|warning|critical)\"'" 0
    check "API auth blocks unauth" "curl -sSk -o /tmp/vch-smoke-api-users.json -w '%{http_code}' ${PROXY_PUBLIC_URL}/api/users | grep 401 && grep -qE 'Not logged in|session expired|Not authenticated' /tmp/vch-smoke-api-users.json" 0
    check "Root redirects to login" "curl -sSk -o /dev/null -w '%{http_code}' ${PROXY_PUBLIC_URL}/ | grep 307" 0

    echo ""
    echo "── 8. Static Assets ──"
    check_static_assets

    echo ""
    echo "── 9. Public Security Headers ──"
    SECURITY_HEADERS="$(mktemp)"
    trap 'rm -f "${SECURITY_HEADERS:-}"' EXIT
    curl -sSk -D "${SECURITY_HEADERS}" -o /dev/null "${PROXY_PUBLIC_URL}/login" || true
    check "Security headers present" "grep -i X-Content-Type-Options \"${SECURITY_HEADERS}\"" 0
    check "Frame header is not DENY" "! grep -iq '^x-frame-options:.*DENY' \"${SECURITY_HEADERS}\"" 0
    check "Preview CSP allows same-origin media" "grep -i '^content-security-policy:' \"${SECURITY_HEADERS}\" | grep -q \"media-src 'self' blob:\"" 0
    check "Preview CSP allows frames" "grep -i '^content-security-policy:' \"${SECURITY_HEADERS}\" | grep -q \"frame-src 'self'\"" 0
    check "Preview CSP avoids external Office frames" "! grep -iq 'view.officeapps.live.com' \"${SECURITY_HEADERS}\"" 0
fi

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
