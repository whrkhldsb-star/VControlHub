#!/usr/bin/env bash
set -euo pipefail

slugify() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//'
}

APP_NAME="${APP_NAME:-VControlHub}"
APP_SLUG="${APP_SLUG:-$(slugify "${APP_NAME}")}"
[ -n "${APP_SLUG}" ] || APP_SLUG="vcontrolhub"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${OUTPUT_DIR:-${REPO_ROOT}/dist}"
APP_VERSION="${APP_VERSION:-$(node -p "require('${REPO_ROOT}/package.json').version")}"
PACKAGE_ROOT_NAME="${PACKAGE_ROOT_NAME:-${APP_SLUG}-v${APP_VERSION}}"
ARCHIVE_NAME="${ARCHIVE_NAME:-${APP_SLUG}-v${APP_VERSION}.tar.gz}"
ARCHIVE_PATH="${ARCHIVE_PATH:-${OUTPUT_DIR}/${ARCHIVE_NAME}}"

case "${PACKAGE_ROOT_NAME}" in
  ""|/*|*..*|*//*|*/*) printf 'Invalid PACKAGE_ROOT_NAME: %s\n' "${PACKAGE_ROOT_NAME}" >&2; exit 1 ;;
esac

if [ "${CHECK_SYNTAX_ONLY:-0}" = "1" ]; then
  exit 0
fi

mkdir -p "${OUTPUT_DIR}"
cd "${REPO_ROOT}"

git archive --format=tar --prefix="${PACKAGE_ROOT_NAME}/" HEAD | gzip -n > "${ARCHIVE_PATH}"

printf '%s\n' "${ARCHIVE_PATH}"
