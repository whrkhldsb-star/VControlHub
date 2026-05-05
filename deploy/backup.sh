#!/usr/bin/env bash
# Convenience wrapper around scripts/backup-db.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/whrkhldsb}"

export APP_DIR BACKUP_DIR
exec "${APP_DIR}/scripts/backup-db.sh" "$@"
