#!/usr/bin/env bash
# Portable database restore helper for VControlHub-compatible deployments.
# Usage: APP_DIR=/opt/vcontrolhub scripts/restore-db.sh /path/to/backup.sql.gz

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
ENV_FILE="${ENV_FILE:-${APP_DIR}/.env.local}"
BACKUP_FILE="${1:-}"
CONFIRM_RESTORE="${CONFIRM_RESTORE:-0}"

fail() { printf '\033[1;31m[restore]\033[0m %s\n' "$*" >&2; exit 1; }
log() { printf '\033[1;32m[restore]\033[0m %s\n' "$*"; }

[ -n "${BACKUP_FILE}" ] || fail "Usage: $0 /path/to/backup.sql[.gz]"
[ -f "${BACKUP_FILE}" ] || fail "Backup file not found: ${BACKUP_FILE}"
[ -f "${ENV_FILE}" ] || fail "Missing env file: ${ENV_FILE}"
[ "${CONFIRM_RESTORE}" = "1" ] || fail "Restore is destructive. Re-run with CONFIRM_RESTORE=1 after taking a fresh backup."

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

if [ -n "${DATABASE_URL:-}" ]; then
  PSQL_ARGS=("${DATABASE_URL}")
else
  DB_NAME="${DATABASE_NAME:-${APP_SLUG:-vcontrolhub}}"
  DB_HOST="${DATABASE_HOST:-127.0.0.1}"
  DB_PORT="${DATABASE_PORT:-5432}"
  DB_USER="${DATABASE_USER:-postgres}"
  PSQL_ARGS=(-h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}")
  if [ -n "${DATABASE_PASSWORD:-}" ]; then
    export PGPASSWORD="${DATABASE_PASSWORD}"
  fi
fi

log "Restoring ${BACKUP_FILE} into configured database"
case "${BACKUP_FILE}" in
  *.gz) gzip -dc "${BACKUP_FILE}" | psql "${PSQL_ARGS[@]}" ;;
  *) psql "${PSQL_ARGS[@]}" < "${BACKUP_FILE}" ;;
esac
log "Restore completed"
