#!/usr/bin/env bash
# Convenience wrapper around scripts/backup-db.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/${APP_NAME:-${APP_SLUG:-app}}}"
BACKUP_SCRIPT="${APP_DIR}/scripts/backup-db.sh"
if [ ! -x "${BACKUP_SCRIPT}" ]; then
  BACKUP_SCRIPT="$(cd "${SCRIPT_DIR}/.." && pwd)/scripts/backup-db.sh"
fi
[ -x "${BACKUP_SCRIPT}" ] || { printf '[backup] Missing executable backup script: %s\n' "${BACKUP_SCRIPT}" >&2; exit 1; }

MODE="database"
case "${1:-}" in
  --files)
    MODE="files"
    shift
    ;;
  --full)
    MODE="full"
    shift
    ;;
  --database)
    shift
    ;;
esac

OUTPUT_PATH="${1:-}"

case "${MODE}" in
  database)
    export APP_DIR BACKUP_DIR
    exec "${BACKUP_SCRIPT}" ${OUTPUT_PATH:+"${OUTPUT_PATH}"}
    ;;
  files|full)
    if [ -z "${OUTPUT_PATH}" ]; then
      STAMP="$(date +%Y%m%d_%H%M%S)"
      OUTPUT_PATH="${BACKUP_DIR}/${APP_NAME:-${APP_SLUG:-app}}_${MODE}_${STAMP}.tar.gz"
    fi
    case "${OUTPUT_PATH}" in
      /*) ;;
      *) OUTPUT_PATH="${APP_DIR}/${OUTPUT_PATH}" ;;
    esac
    mkdir -p "$(dirname "${OUTPUT_PATH}")"
    printf '[backup] Starting %s backup: %s\n' "${MODE}" "${OUTPUT_PATH}"
    TAR_PATHS=(storage uploads downloads logs)
    if [ "${MODE}" = "full" ]; then
      TAR_PATHS=(storage uploads downloads logs backups public prisma package.json package-lock.json)
    fi
    EXISTING_PATHS=()
    for path in "${TAR_PATHS[@]}"; do
      if [ -e "${APP_DIR}/${path}" ]; then
        EXISTING_PATHS+=("${path}")
      fi
    done
    if [ "${#EXISTING_PATHS[@]}" -eq 0 ]; then
      printf '[backup] No files found for %s backup under %s\n' "${MODE}" "${APP_DIR}" >&2
      exit 1
    fi
    tar -C "${APP_DIR}" -czf "${OUTPUT_PATH}" "${EXISTING_PATHS[@]}"
    SIZE="$(du -sh "${OUTPUT_PATH}" | cut -f1)"
    printf '[backup] Completed %s backup: %s (%s)\n' "${MODE}" "${OUTPUT_PATH}" "${SIZE}"
    ;;
esac
