#!/usr/bin/env bash

set -euo pipefail

ARCHIVE="${1:-}"
APP_DIR="${2:-${APP_DIR:-}}"

fail() { printf '[restore-files] %s\n' "$*" >&2; exit 1; }

[ -n "${ARCHIVE}" ] || fail "archive path is required"
[ -f "${ARCHIVE}" ] || fail "archive not found: ${ARCHIVE}"
[ -n "${APP_DIR}" ] || fail "application directory is required"
[ -d "${APP_DIR}" ] || fail "application directory not found: ${APP_DIR}"

while IFS= read -r member; do
  case "${member}" in
    /*|../*|*/../*|*/..) fail "unsafe archive member: ${member}" ;;
  esac
done < <(tar -tzf "${ARCHIVE}")

STAGE_DIR="$(mktemp -d)"
trap 'rm -rf -- "${STAGE_DIR}"' EXIT
tar -xzf "${ARCHIVE}" -C "${STAGE_DIR}" --no-same-owner --no-same-permissions --exclude=database.sql.gz
cp -a "${STAGE_DIR}/." "${APP_DIR}/"
