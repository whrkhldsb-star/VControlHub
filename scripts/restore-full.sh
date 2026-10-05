#!/usr/bin/env bash
# Keep the Linux argv contract; all restore paths use the same safety checks.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${3:-${APP_DIR:-}}"
if [ -z "${APP_DIR}" ]; then
  printf '[restore-full] application directory is required\n' >&2
  exit 1
fi
export APP_DIR
exec node "${SCRIPT_DIR}/restore.mjs" full "${1:-}" "${2:-all}" "${APP_DIR}"
