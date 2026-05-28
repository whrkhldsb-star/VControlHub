#!/usr/bin/env bash
# Portable upgrade helper for VControlHub.
# Pulls the latest code when installed from git, creates a pre-upgrade backup,
# delegates to install.sh, then runs health checks.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
APP_NAME="${APP_NAME:-${APP_SLUG:-app}}"
ENV_FILE="${ENV_FILE:-${APP_DIR}/.env.local}"
BACKUP_DIR="${BACKUP_DIR:-${APP_DIR}/backups}"
SKIP_PRE_BACKUP="${SKIP_PRE_BACKUP:-0}"
SKIP_POST_CHECK="${SKIP_POST_CHECK:-0}"
SKIP_PULL="${SKIP_PULL:-0}"
UPGRADE_REF="${UPGRADE_REF:-main}"
CHECK_PUBLIC_URL="${CHECK_PUBLIC_URL:-}"

log() { printf '\033[1;32m[upgrade]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[upgrade]\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31m[upgrade]\033[0m %s\n' "$*" >&2; exit 1; }

load_env_for_defaults() {
  [ -f "${ENV_FILE}" ] || return 0
  # shellcheck disable=SC1090
  set -a; source "${ENV_FILE}"; set +a
  if [ -z "${CHECK_PUBLIC_URL}" ] && [ -n "${APP_PUBLIC_URL:-}" ]; then
    CHECK_PUBLIC_URL="${APP_PUBLIC_URL}"
  fi
  if [ -z "${CHECK_PUBLIC_URL}" ] && [ -n "${DOMAIN:-}" ]; then
    CHECK_PUBLIC_URL="https://${DOMAIN}"
  fi
}

pull_latest_code() {
  [ "${SKIP_PULL}" = "1" ] && { warn "Skipping git pull (SKIP_PULL=1)"; return; }
  [ -d "${APP_DIR}/.git" ] || { warn "${APP_DIR} is not a git checkout; using local files only"; return; }
  command -v git >/dev/null 2>&1 || fail "git is required to pull updates"

  log "Fetching latest code for ${UPGRADE_REF}"
  git -C "${APP_DIR}" fetch --prune origin

  if [ -n "$(git -C "${APP_DIR}" status --porcelain)" ]; then
    fail "Working tree has local changes. Commit/stash them or run with SKIP_PULL=1."
  fi

  local remote_ref remote_sha current_sha
  remote_ref="origin/${UPGRADE_REF}"
  remote_sha="$(git -C "${APP_DIR}" rev-parse "${remote_ref}" 2>/dev/null || true)"
  [ -n "${remote_sha}" ] || fail "Remote ref not found: ${remote_ref}"
  current_sha="$(git -C "${APP_DIR}" rev-parse HEAD)"
  if [ "${current_sha}" = "${remote_sha}" ]; then
    log "Already at latest ${UPGRADE_REF}: ${current_sha}"
  else
    log "Updating ${current_sha} -> ${remote_sha}"
    git -C "${APP_DIR}" checkout -q "${UPGRADE_REF}"
    git -C "${APP_DIR}" merge --ff-only "${remote_ref}"
  fi
}

run_pre_upgrade_backup() {
  [ "${SKIP_PRE_BACKUP}" = "1" ] && { warn "Skipping pre-upgrade backup"; return; }
  mkdir -p "${BACKUP_DIR}"
  local stamp output
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  output="${BACKUP_DIR}/pre-upgrade-${stamp}.dump"
  log "Creating pre-upgrade database backup at ${output}"
  APP_DIR="${APP_DIR}" ENV_FILE="${ENV_FILE}" BACKUP_DIR="${BACKUP_DIR}" "${SCRIPT_DIR}/backup.sh" "${output}"
}

run_post_upgrade_check() {
  [ "${SKIP_POST_CHECK}" = "1" ] && { warn "Skipping post-upgrade checks"; return; }
  log "Running post-upgrade health checks"
  APP_DIR="${APP_DIR}" ENV_FILE="${ENV_FILE}" APP_NAME="${APP_NAME}" CHECK_PUBLIC_URL="${CHECK_PUBLIC_URL}" "${SCRIPT_DIR}/check.sh"
  if [ -d "${APP_DIR}/.git" ]; then
    local head remote
    head="$(git -C "${APP_DIR}" rev-parse HEAD)"
    remote="$(git -C "${APP_DIR}" rev-parse "origin/${UPGRADE_REF}" 2>/dev/null || true)"
    [ -z "${remote}" ] || [ "${head}" = "${remote}" ] || fail "Upgrade completed but HEAD ${head} does not match origin/${UPGRADE_REF} ${remote}"
    log "Code version verified: ${head}"
  fi
}

export SKIP_PACKAGES="${SKIP_PACKAGES:-1}"
load_env_for_defaults
pull_latest_code
run_pre_upgrade_backup
"${SCRIPT_DIR}/install.sh" "$@"
run_post_upgrade_check
log "Upgrade completed"
