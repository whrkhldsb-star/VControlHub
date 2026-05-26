#!/usr/bin/env bash
# One-line fresh-host bootstrapper for VControlHub.
# Intended usage:
#   curl -fsSL https://raw.githubusercontent.com/whrkhldsb-star/VControlHub/main/deploy/bootstrap.sh | sudo bash
# Optional overrides before `bash`:
#   curl -fsSL .../bootstrap.sh | sudo DOMAIN=example.com APP_DIR=/opt/vcontrolhub bash

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/whrkhldsb-star/VControlHub.git}"
APP_NAME="${APP_NAME:-VControlHub}"
APP_SLUG="${APP_SLUG:-vcontrolhub}"
SITE_NAME="${SITE_NAME:-${APP_NAME}}"
SERVICE_PREFIX="${SERVICE_PREFIX:-${APP_SLUG}}"
APP_DIR="${APP_DIR:-/opt/${APP_SLUG}}"
BRANCH="${BRANCH:-main}"

log() { printf '\033[1;32m[bootstrap]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[bootstrap]\033[0m %s\n' "$*" >&2; exit 1; }
need_root() {
  local uid
  uid="$(id -u 2>/dev/null || printf '1')"
  [ "${uid}" = "0" ] || fail "Please run as root, for example: curl -fsSL <url> | sudo bash"
}
have_cmd() { command -v "$1" >/dev/null 2>&1; }

ensure_git() {
  if have_cmd git; then
    return 0
  fi
  log "Installing git for repository checkout"
  if have_cmd apt-get; then
    apt-get update
    apt-get install -y git ca-certificates curl
  else
    fail "git is required and apt-get is not available. Install git first or use an archive install."
  fi
}

checkout_repo() {
  mkdir -p "$(dirname "${APP_DIR}")"
  if [ -d "${APP_DIR}/.git" ]; then
    log "Updating existing repository in ${APP_DIR}"
    git -C "${APP_DIR}" fetch origin "${BRANCH}" --prune
    git -C "${APP_DIR}" checkout "${BRANCH}"
    git -C "${APP_DIR}" pull --ff-only origin "${BRANCH}"
  elif [ -e "${APP_DIR}" ] && [ "$(find "${APP_DIR}" -mindepth 1 -maxdepth 1 2>/dev/null | head -1)" ]; then
    fail "APP_DIR=${APP_DIR} exists and is not an empty git checkout. Set APP_DIR to an empty/new directory or run deploy/install.sh from an existing source tree."
  else
    log "Cloning ${REPO_URL}#${BRANCH} to ${APP_DIR}"
    git clone --branch "${BRANCH}" --depth 1 "${REPO_URL}" "${APP_DIR}"
  fi
}

main() {
  if [ "${CHECK_SYNTAX_ONLY:-0}" = "1" ]; then
    bash -n "${BASH_SOURCE[0]}"
    return
  fi

  need_root
  ensure_git
  checkout_repo

  log "Starting one-click installer"
  APP_NAME="${APP_NAME}" \
  APP_SLUG="${APP_SLUG}" \
  SITE_NAME="${SITE_NAME}" \
  SERVICE_PREFIX="${SERVICE_PREFIX}" \
  APP_DIR="${APP_DIR}" \
  REPO_URL="${REPO_URL}" \
  "${APP_DIR}/deploy/install.sh" "$@"
}

main "$@"
