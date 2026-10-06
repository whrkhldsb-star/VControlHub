#!/usr/bin/env bash
# Preserve the database-backup entrypoint; publish only complete dumps and
# pass credentials through the child environment on every platform.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "${SCRIPT_DIR}/backup.mjs" --database "$@"
