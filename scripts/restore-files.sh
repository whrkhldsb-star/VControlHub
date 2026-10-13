#!/usr/bin/env bash
# Keep the Linux argv contract (archive, target directory); all restore paths
# share the Node runner's archive vetting, host lock and offline checks.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${2:-${APP_DIR:-}}"
if [ -z "${TARGET_DIR}" ]; then
  printf '[restore-files] application directory is required\n' >&2
  exit 1
fi
exec node "${SCRIPT_DIR}/restore.mjs" files "${1:-}" "${TARGET_DIR}"
