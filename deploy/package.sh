#!/usr/bin/env bash
set -euo pipefail

slugify() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//'
}

APP_NAME="${APP_NAME:-VControlHub}"
APP_SLUG="${APP_SLUG:-$(slugify "${APP_NAME}")}"
[ -n "${APP_SLUG}" ] || APP_SLUG="vcontrolhub"
PACKAGE_ROOT_NAME="${PACKAGE_ROOT_NAME:-${APP_SLUG}-release}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${OUTPUT_DIR:-${REPO_ROOT}/dist}"
STAMP="${STAMP:-$(date +%Y%m%d-%H%M%S)}"
ARCHIVE_NAME="${ARCHIVE_NAME:-${APP_SLUG}-release-${STAMP}.tar.gz}"
ARCHIVE_PATH="${ARCHIVE_PATH:-${OUTPUT_DIR}/${ARCHIVE_NAME}}"

case "${PACKAGE_ROOT_NAME}" in
  ""|/*|*..*|*//*|*/*) printf 'Invalid PACKAGE_ROOT_NAME: %s\n' "${PACKAGE_ROOT_NAME}" >&2; exit 1 ;;
esac

if [ "${CHECK_SYNTAX_ONLY:-0}" = "1" ]; then
  exit 0
fi

mkdir -p "${OUTPUT_DIR}"
cd "${REPO_ROOT}"

tar --create --gzip --file "${ARCHIVE_PATH}" \
  --transform "s#^#${PACKAGE_ROOT_NAME}/#" \
  --exclude './.git' \
  --exclude './.github' \
  --exclude './node_modules' \
  --exclude './.next' \
  --exclude './.env.local' \
  --exclude './.env.*.local' \
  --exclude './storage/*' \
  --exclude './tmp/*' \
  --exclude './uploads/*' \
  --exclude './downloads/*' \
  --exclude './backups/*' \
  --exclude './logs/*' \
  --exclude './dist' \
  --exclude './dist/*' \
  --exclude './_test_*.js' \
  --exclude './_test_*.ts' \
  --exclude './check_*.py' \
  --exclude './make_*.py' \
  --exclude './*.tsbuildinfo' \
  --exclude './*.pem' \
  --exclude './*.key' \
  --exclude './*.ppk' \
  --exclude './*.sqlite' \
  --exclude './*.db' \
  --exclude './*.dump' \
  --exclude './*.sql' \
  --exclude './*.sql.gz' \
  .

printf '%s\n' "${ARCHIVE_PATH}"
