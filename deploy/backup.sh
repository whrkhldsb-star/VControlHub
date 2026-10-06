#!/usr/bin/env bash
# Preserve the Linux backup CLI and output-directory default while sharing
# atomic publication, validation and retention with the Node runner.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/${APP_NAME:-${APP_SLUG:-app}}}"
export APP_DIR BACKUP_DIR
exec node "${SCRIPT_DIR}/../scripts/backup.mjs" "$@"
