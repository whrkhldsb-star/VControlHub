#!/usr/bin/env bash
# Keep the Linux entrypoint while sharing preflight and credential handling
# with the cross-platform Node restore runner.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "${SCRIPT_DIR}/restore.mjs" database "${1:-}"
