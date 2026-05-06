#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-whrkhldsb}"
PACKAGE_ROOT_NAME="${PACKAGE_ROOT_NAME:-whrkhldsb-release}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${OUTPUT_DIR:-${REPO_ROOT}/dist}"
STAMP="${STAMP:-$(date +%Y%m%d-%H%M%S)}"
ARCHIVE_NAME="${ARCHIVE_NAME:-${APP_NAME}-release-${STAMP}.tar.gz}"
ARCHIVE_PATH="${ARCHIVE_PATH:-${OUTPUT_DIR}/${ARCHIVE_NAME}}"

if [ "${CHECK_SYNTAX_ONLY:-0}" = "1" ]; then
  exit 0
fi

mkdir -p "${OUTPUT_DIR}"
cd "${REPO_ROOT}"

tar --create --gzip --file "${ARCHIVE_PATH}" \
  --transform "s#^#${PACKAGE_ROOT_NAME}/#" \
  --exclude './.git' \
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
