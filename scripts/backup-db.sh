#!/usr/bin/env bash
# PostgreSQL backup script for VControlHub-compatible deployments.
# Portable usage:
#   APP_DIR=/opt/VControlHub ENV_FILE=/opt/VControlHub/.env.local BACKUP_DIR=/var/backups/vcontrolhub \
#     /opt/VControlHub/scripts/backup-db.sh
# Cron example:
#   0 3 * * * APP_DIR=/opt/VControlHub /opt/VControlHub/scripts/backup-db.sh >> /var/log/vcontrolhub-backup.log 2>&1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
ENV_FILE="${ENV_FILE:-${APP_DIR}/.env.local}"

if [ -f "${ENV_FILE}" ]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

if [ -n "${DATABASE_URL:-}" ]; then
  PG_CONN_ARGS=("${DATABASE_URL}")
else
  DB_NAME="${DATABASE_NAME:-${APP_SLUG:-vcontrolhub}}"
  DB_HOST="${DATABASE_HOST:-127.0.0.1}"
  DB_PORT="${DATABASE_PORT:-5432}"
  DB_USER="${DATABASE_USER:-postgres}"
  PG_CONN_ARGS=(-h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}")
  if [ -n "${DATABASE_PASSWORD:-}" ]; then
    export PGPASSWORD="${DATABASE_PASSWORD}"
  fi
fi

BACKUP_DIR="${BACKUP_DIR:-${APP_DIR}/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
if [ "${1:-}" != "" ]; then
  BACKUP_FILE="$1"
  case "${BACKUP_FILE}" in
    /*) ;;
    *) BACKUP_FILE="${APP_DIR}/${BACKUP_FILE}" ;;
  esac
else
  BACKUP_FILE="${BACKUP_DIR}/${APP_SLUG:-vcontrolhub}_${TIMESTAMP}.sql.gz"
fi

mkdir -p "${BACKUP_DIR}" "$(dirname "${BACKUP_FILE}")"

echo "[$(date -Iseconds)] Starting backup: ${BACKUP_FILE}"

pg_dump "${PG_CONN_ARGS[@]}" \
  --no-owner \
  --no-privileges \
  --clean \
  --if-exists \
  2> >(sed -E 's#(postgres(ql)?://)[^ @]+(:[^ @]+)?@#\1[REDACTED]@#g' >&2) \
  | gzip > "${BACKUP_FILE}"

SIZE=$(du -sh "${BACKUP_FILE}" | cut -f1)
echo "[$(date -Iseconds)] Backup completed: ${BACKUP_FILE} (${SIZE})"

DELETED=$(find "${BACKUP_DIR}" -name "${APP_SLUG:-vcontrolhub}_*.sql.gz" -mtime +"${RETENTION_DAYS}" -delete -print | wc -l)
if [ "${DELETED}" -gt 0 ]; then
  echo "[$(date -Iseconds)] Cleaned up ${DELETED} backup(s) older than ${RETENTION_DAYS} days"
fi
