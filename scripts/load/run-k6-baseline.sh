#!/usr/bin/env bash
# Wrapper around k6 baseline with clear install guidance.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"

if ! command -v k6 >/dev/null 2>&1; then
  cat <<'EOF'
❌ k6 is not installed.

Install options:
  # Debian/Ubuntu (official)
  sudo gpg -k
  sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
  echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
  sudo apt-get update && sudo apt-get install k6

  # or: https://grafana.com/docs/k6/latest/set-up/install-k6/
EOF
  exit 2
fi

echo "==> k6 baseline against ${BASE_URL}"
exec k6 run \
  -e "BASE_URL=${BASE_URL}" \
  -e "SESSION_COOKIE=${SESSION_COOKIE:-}" \
  -e "CSRF_TOKEN=${CSRF_TOKEN:-}" \
  -e "VUS=${VUS:-5}" \
  -e "DURATION=${DURATION:-30s}" \
  "${ROOT}/scripts/load/k6-baseline.js"
