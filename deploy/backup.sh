#!/usr/bin/env bash
# Convenience wrapper around scripts/backup-db.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/whrkhldsb}"
BACKUP_SCRIPT="${APP_DIR}/scripts/backup-db.sh"
if [ ! -x "${BACKUP_SCRIPT}" ]; then
  BACKUP_SCRIPT="$(cd "${SCRIPT_DIR}/.." && pwd)/scripts/backup-db.sh"
fi
[ -x "${BACKUP_SCRIPT}" ] || { printf '[backup] Missing executable backup script: %s\n' "${BACKUP_SCRIPT}" >&2; exit 1; }

export APP_DIR BACKUP_DIR
exec "${BACKUP_SCRIPT}" "$@"
