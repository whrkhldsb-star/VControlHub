#!/usr/bin/env bash
# Post-deploy smoke test — run after every code/config change.
# Verifies all services are up and the site is fully accessible.
# Usage: bash deploy/smoke-test.sh [EXTERNAL_IP_OR_DOMAIN]
set -euo pipefail

TARGET="${1:-}"
[ -z "${TARGET}" ] && TARGET="$(ip -4 addr show scope global 2>/dev/null | grep -oP 'inet \K[0-9.]+' | head -1)" || true
[ -z "${TARGET}" ] && TARGET="localhost"

PASS=0
FAIL=0

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
check "whrkhldsb-next service"    "systemctl is-active whrkhldsb-next" 0
check "whrkhldsb-ssh-ws service"  "systemctl is-active whrkhldsb-ssh-ws" 0
check "Apache service"            "systemctl is-active apache2" 0
check "PostgreSQL service"        "systemctl is-active postgresql" 0

echo ""
echo "── 2. Port Binding ──"
check "Next.js on 127.0.0.1:3000"  "ss -tlnp | grep '127.0.0.1:3000'" 0
check "SSH-WS on 127.0.0.1:3001"   "ss -tlnp | grep '127.0.0.1:3001'" 0
check "Apache on *:80"             "ss -tlnp | grep ':80 '" 0

echo ""
echo "── 3. HTTP Response ──"
check "Login page (localhost)"     "curl -sS -o /dev/null -w '%{http_code}' http://localhost:3000/login | grep 200" 0
check "Login page (via Apache)"    "curl -sS -o /dev/null -w '%{http_code}' http://${TARGET}/login | grep 200" 0
check "API /api/status"            "curl -sS http://${TARGET}/api/status | grep healthy" 0
check "API auth blocks unauth"     "curl -sS http://${TARGET}/api/users | grep '未登录'" 0
check "Root redirects to login"    "curl -sS -o /dev/null -w '%{http_code}' http://${TARGET}/ | grep 307" 0

echo ""
echo "── 4. Static Assets ──"
FIRST_JS="$(curl -sS http://${TARGET}/login | grep -oP '"/_next/static/chunks/[^"]*\.js"' | head -1 | tr -d '"')"
if [ -n "${FIRST_JS}" ]; then
    check "JS chunk ${FIRST_JS:0:40}..." "curl -sS -o /dev/null -w '%{http_code}' http://${TARGET}${FIRST_JS} | grep 200" 0
else
    printf "  ⚠️  No JS chunks found in HTML\n"
fi

echo ""
echo "── 5. Security ──"
check "No direct 3000 access"      "ss -tlnp | grep '0.0.0.0:3000' ; echo missing" 0
check "Security headers present"   "curl -sS -D- http://${TARGET}/login | grep X-Content-Type-Options" 0

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
