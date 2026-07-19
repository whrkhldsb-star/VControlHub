#!/usr/bin/env bash
# DAST baseline scan for VControlHub public surfaces.
# Uses nuclei when available; otherwise falls back to a lightweight curl surface probe.
#
# Usage:
#   BASE_URL=https://example.com bash scripts/dast-baseline.sh
#   bash scripts/dast-baseline.sh http://127.0.0.1:3000
#
# Exit codes:
#   0 = no high/critical findings (or baseline probe passed)
#   1 = findings / probe failures
#   2 = misconfiguration

set -euo pipefail

BASE_URL="${1:-${BASE_URL:-http://127.0.0.1:3000}}"
BASE_URL="${BASE_URL%/}"
OUT_DIR="${DAST_OUT_DIR:-.dast-output}"
mkdir -p "$OUT_DIR"

echo "==> DAST baseline against ${BASE_URL}"

if command -v nuclei >/dev/null 2>&1; then
  echo "==> Running nuclei (tags: tech,misconfig,exposure,cve severity:medium,high,critical)"
  # Focused public surface templates; exclude intrusive/DoS by default.
  set +e
  nuclei \
    -u "${BASE_URL}" \
    -severity medium,high,critical \
    -tags tech,misconfig,exposure,cve \
    -exclude-tags dos,fuzz \
    -rate-limit 50 \
    -timeout 10 \
    -retries 1 \
    -silent \
    -json-export "${OUT_DIR}/nuclei.json" \
    -markdown-export "${OUT_DIR}/nuclei.md" \
    | tee "${OUT_DIR}/nuclei.log"
  code=$?
  set -e
  if [[ $code -ne 0 ]]; then
    echo "nuclei reported findings (exit ${code}); see ${OUT_DIR}/"
    # nuclei exits non-zero when findings exist — treat medium+ as fail
    exit 1
  fi
  echo "✅ nuclei baseline clean"
  exit 0
fi

echo "⚠ nuclei not installed — running lightweight surface probe fallback"
fail=0

probe() {
  local path="$1"
  local expect_min="${2:-200}"
  local expect_max="${3:-399}"
  local url="${BASE_URL}${path}"
  local code
  code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 10 "$url" || echo "000")
  if [[ "$code" =~ ^[0-9]+$ ]] && (( code >= expect_min && code <= expect_max )); then
    echo "  OK  ${path} -> ${code}"
  else
    echo "  FAIL ${path} -> ${code} (expected ${expect_min}-${expect_max})"
    fail=1
  fi
}

# Public pages should render
probe "/login" 200 399
probe "/status" 200 399
probe "/offline" 200 399

# Protected APIs should not leak open access
probe "/api/servers" 401 403
probe "/api/monitoring/observability" 401 403
probe "/api/jobs/backlog" 401 403

# Health may allow bearer/session — accept 200 or 401
probe "/api/health" 200 401

# Common sensitive paths should not be world-readable dumps
for p in "/.env" "/.git/config" "/package.json" "/server.js" "/.next/BUILD_ID"; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 10 "${BASE_URL}${p}" || echo "000")
  if [[ "$code" == "200" ]]; then
    echo "  FAIL exposed path ${p} returned 200"
    fail=1
  else
    echo "  OK  ${p} not exposed (${code})"
  fi
done

if [[ $fail -ne 0 ]]; then
  echo "❌ DAST baseline probe failed"
  exit 1
fi

echo "✅ DAST baseline probe passed (install nuclei for deeper scans)"
exit 0
