#!/usr/bin/env bash

set -euo pipefail

ARCHIVE="${1:-}"
COMPONENT="${2:-all}"
APP_DIR="${3:-${APP_DIR:-}}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

fail() { printf '[restore-full] %s\n' "$*" >&2; exit 1; }

[ -n "${ARCHIVE}" ] || fail "archive path is required"
[ -f "${ARCHIVE}" ] || fail "archive not found: ${ARCHIVE}"
[ -n "${APP_DIR}" ] || fail "application directory is required"
case "${COMPONENT}" in all|database|files) ;; *) fail "invalid component: ${COMPONENT}" ;; esac

HAS_DATABASE=0
if tar -tzf "${ARCHIVE}" | grep -Fxq database.sql.gz; then
  HAS_DATABASE=1
fi
if [ "${COMPONENT}" != "files" ] && [ "${HAS_DATABASE}" -ne 1 ]; then
  fail "legacy FULL archive does not contain database.sql.gz; choose files-only restore"
fi

if [ "${COMPONENT}" = "files" ] || [ "${COMPONENT}" = "all" ]; then
  bash "${SCRIPT_DIR}/restore-files.sh" "${ARCHIVE}" "${APP_DIR}"
fi

if [ "${COMPONENT}" = "database" ] || [ "${COMPONENT}" = "all" ]; then
  TEMP_DIR="$(mktemp -d)"
  trap 'rm -rf -- "${TEMP_DIR}"' EXIT
  tar -xOzf "${ARCHIVE}" database.sql.gz > "${TEMP_DIR}/database.sql.gz"
  APP_DIR="${APP_DIR}" CONFIRM_RESTORE="${CONFIRM_RESTORE:-0}" \
    bash "${SCRIPT_DIR}/restore-db.sh" "${TEMP_DIR}/database.sql.gz"
fi

