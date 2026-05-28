#!/usr/bin/env bash
# Portable upgrade helper for VControlHub.
# Performs a pre-upgrade backup, delegates to install.sh, then runs health checks.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
APP_NAME="${APP_NAME:-${APP_SLUG:-app}}"
ENV_FILE="${ENV_FILE:-${APP_DIR}/.env.local}"
BACKUP_DIR="${BACKUP_DIR:-${APP_DIR}/backups}"
SKIP_PRE_BACKUP="${SKIP_PRE_BACKUP:-0}"
SKIP_POST_CHECK="${SKIP_POST_CHECK:-0}"
CHECK_PUBLIC_URL="${CHECK_PUBLIC_URL:-}"

log() { printf '\033[1;32m[upgrade]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[upgrade]\033[0m %s\n' "$*" >&2; }

run_pre_upgrade_backup() {
  [ "${SKIP_PRE_BACKUP}" = "1" ] && { warn "Skipping pre-upgrade backup"; return; }
  mkdir -p "${BACKUP_DIR}"
  local stamp output
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  output="${BACKUP_DIR}/pre-upgrade-${stamp}.dump"
  log "Creating pre-upgrade database backup at ${output}"
  APP_DIR="${APP_DIR}" ENV_FILE="${ENV_FILE}" BACKUP_DIR="${BACKUP_DIR}" "${SCRIPT_DIR}/backup.sh" "${output}"
}

run_post_upgrade_check() {
  [ "${SKIP_POST_CHECK}" = "1" ] && { warn "Skipping post-upgrade checks"; return; }
  log "Running post-upgrade health checks"
  APP_DIR="${APP_DIR}" ENV_FILE="${ENV_FILE}" APP_NAME="${APP_NAME}" CHECK_PUBLIC_URL="${CHECK_PUBLIC_URL}" "${SCRIPT_DIR}/check.sh"
}

export SKIP_PACKAGES="${SKIP_PACKAGES:-1}"
run_pre_upgrade_backup
"${SCRIPT_DIR}/install.sh" "$@"
run_post_upgrade_check
log "Upgrade completed"
