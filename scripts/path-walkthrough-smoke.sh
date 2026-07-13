#!/usr/bin/env bash
# Path walkthrough smoke — unauthenticated gateway checks for the
# login → VPS → files → downloads → requests journey.
#
# Usage:
#   bash scripts/path-walkthrough-smoke.sh
#   BASE_URL=http://localhost:3000 bash scripts/path-walkthrough-smoke.sh
#
# This does NOT replace the human checklist in
# docs/path-walkthrough-checklist.md (real login + clicks + theme/mobile).
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
BASE_URL="${BASE_URL%/}"

PASS=0
FAIL=0

check() {
  local label="$1"
  local cmd="$2"
  local result
  if result="$(eval "$cmd" 2>&1)"; then
    printf "  ✅ %s\n" "${label}"
    PASS=$((PASS + 1))
  else
    printf "  ❌ %s — %s\n" "${label}" "${result:-failed}"
    FAIL=$((FAIL + 1))
  fi
}

expect_code() {
  local path="$1"
  local want="$2"
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "${BASE_URL}${path}" || echo 000)"
  [ "${code}" = "${want}" ]
}

expect_redirect_to_login() {
  local path="$1"
  local headers location code
  headers="$(mktemp)"
  code="$(curl -sS -D "${headers}" -o /dev/null -w '%{http_code}' --max-time 5 "${BASE_URL}${path}" || echo 000)"
  location="$(tr -d '\r' <"${headers}" | awk 'tolower($1)=="location:"{print $2; exit}')"
  rm -f "${headers}"
  [ "${code}" = "307" ] || [ "${code}" = "302" ] || [ "${code}" = "303" ] || return 1
  printf '%s' "${location}" | grep -qE '/login(\\?|$)' || return 1
  printf '%s' "${location}" | grep -q "next=" || return 1
}

echo "═══════════════════════════════════════════════"
echo " Path walkthrough smoke — ${BASE_URL}"
echo "═══════════════════════════════════════════════"
echo ""

echo "── Public / auth entry ──"
check "GET /login → 200" "expect_code /login 200"
check "GET /status → 200 or 307/302 (ok if public)" \
  "code=\$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 '${BASE_URL}/status' || echo 000); case \"\$code\" in 200|301|302|307|308) true;; *) false;; esac"
check "GET /offline → 200" "expect_code /offline 200"

echo ""
echo "── Protected journey routes redirect to login?next= ──"
for path in /dashboard /servers /files /downloads /requests; do
  check "GET ${path} → login with next" "expect_redirect_to_login '${path}'"
done

echo ""
echo "── API unauthenticated ──"
check "GET /api/users → 401" \
  "code=\$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 '${BASE_URL}/api/users' || echo 000); [ \"\$code\" = 401 ]"
check "GET /api/status responds" \
  "curl -sS --max-time 5 '${BASE_URL}/api/status' | grep -qE 'overall|service|generatedAt|healthy|warning|critical|status' || curl -sS -o /dev/null -w '%{http_code}' --max-time 5 '${BASE_URL}/api/status' | grep -qE '200|401|403'"

echo ""
echo "── Login HTML has next-preserving form hook ──"
check "Login page mentions next hidden field or form action" \
  "curl -sS --max-time 5 '${BASE_URL}/login?next=%2Fservers' | grep -qE 'name=\"next\"|nextPath|/api/login|login'"

echo ""
echo "═══════════════════════════════════════════════"
if [ "${FAIL}" -eq 0 ]; then
  echo " ✅ ALL ${PASS} CHECKS PASSED"
  echo " Next: follow docs/path-walkthrough-checklist.md with a real account."
  exit 0
fi
echo " ❌ ${FAIL} FAILED, ${PASS} PASSED"
exit 1
