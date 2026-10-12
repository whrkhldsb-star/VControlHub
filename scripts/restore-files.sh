#!/usr/bin/env bash

set -euo pipefail

# The installation whose restores are serialized (see acquireRestoreLock in
# scripts/lib/backup-common.mjs — same lock directory and owner format).
INSTALL_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ARCHIVE="${1:-}"
APP_DIR="${2:-${APP_DIR:-}}"

fail() { printf '[restore-files] %s\n' "$*" >&2; exit 1; }

LOCK_DIR="${INSTALL_DIR}/.restore.lock"
STAGE_DIR=""
cleanup() {
  [ -z "${STAGE_DIR}" ] || rm -rf -- "${STAGE_DIR}"
  [ "${LOCK_HELD:-0}" != 1 ] || rm -rf -- "${LOCK_DIR}"
}
trap cleanup EXIT
acquire_lock() {
  local attempt owner_pid owner_host
  for attempt in 1 2; do
    if mkdir -- "${LOCK_DIR}" 2>/dev/null; then
      LOCK_HELD=1
      printf 'pid=%s\nhost=%s\nstartedAt=%s\n' "$$" "$(hostname)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "${LOCK_DIR}/owner"
      return 0
    fi
    owner_pid="$(sed -n 's/^pid=//p' "${LOCK_DIR}/owner" 2>/dev/null || true)"
    owner_host="$(sed -n 's/^host=//p' "${LOCK_DIR}/owner" 2>/dev/null || true)"
    if [ "${attempt}" = 1 ] && [ "${owner_host}" = "$(hostname)" ] && [ -n "${owner_pid}" ] && ! kill -0 "${owner_pid}" 2>/dev/null; then
      rm -rf -- "${LOCK_DIR}"
      continue
    fi
    fail "another restore is already running for ${INSTALL_DIR} (lock ${LOCK_DIR}, pid ${owner_pid:-unknown} on ${owner_host:-unknown host})"
  done
  fail "could not acquire restore lock ${LOCK_DIR}"
}

[ -n "${ARCHIVE}" ] || fail "archive path is required"
[ -f "${ARCHIVE}" ] || fail "archive not found: ${ARCHIVE}"
[ -n "${APP_DIR}" ] || fail "application directory is required"
[ -d "${APP_DIR}" ] || fail "application directory not found: ${APP_DIR}"

while IFS= read -r member; do
  case "${member}" in
    /*|../*|*/../*|*/..) fail "unsafe archive member: ${member}" ;;
  esac
done < <(tar -tzf "${ARCHIVE}")

# A staging directory does not make archive links harmless: a symlink or
# hardlink can redirect a later member outside the stage during extraction.
while IFS= read -r detail; do
  [ -n "${detail}" ] || continue
  case "${detail:0:1}" in
    -|d) ;;
    *) fail "archive links and special files are not supported" ;;
  esac
done < <(tar -tvzf "${ARCHIVE}")

acquire_lock
STAGE_DIR="$(mktemp -d)"
tar -xzf "${ARCHIVE}" -C "${STAGE_DIR}" --no-same-owner --no-same-permissions --exclude=database.sql.gz
[ -z "$(find "${STAGE_DIR}" -type l -print -quit)" ] || fail "archive contains a symbolic link"
cp -a "${STAGE_DIR}/." "${APP_DIR}/"
