#!/usr/bin/env bash
# One-line lifecycle entrypoint for VControlHub.
# Intended usage:
#   curl -fsSL https://raw.githubusercontent.com/whrkhldsb-star/VControlHub/main/deploy/bootstrap.sh | sudo bash
# Optional overrides before `bash`:
#   curl -fsSL .../bootstrap.sh | sudo DOMAIN=example.com APP_DIR=/opt/VControlHub bash

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/whrkhldsb-star/VControlHub.git}"
APP_NAME="${APP_NAME:-VControlHub}"
APP_SLUG="${APP_SLUG:-vcontrolhub}"
SITE_NAME="${SITE_NAME:-${APP_NAME}}"
SERVICE_PREFIX="${SERVICE_PREFIX:-${APP_SLUG}}"
# Match the production install path used by the live host: /opt/VControlHub.
if [ -z "${APP_DIR:-}" ]; then
  if [ "${APP_SLUG}" = "vcontrolhub" ]; then
    APP_DIR="/opt/VControlHub"
  else
    APP_DIR="/opt/${APP_SLUG}"
  fi
fi
BRANCH="${BRANCH:-main}"
DOMAIN="${DOMAIN:-}"
NEXT_PORT="${NEXT_PORT:-3000}"
SSH_WS_PORT="${SSH_WS_PORT:-3001}"
VCONTROLHUB_ASSUME_DEFAULTS="${VCONTROLHUB_ASSUME_DEFAULTS:-0}"
VCONTROLHUB_ACTION="${VCONTROLHUB_ACTION:-}"
VCONTROLHUB_UNINSTALL_CONFIRM="${VCONTROLHUB_UNINSTALL_CONFIRM:-0}"

log() { printf '\033[1;32m[bootstrap]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[bootstrap]\033[0m %s\n' "$*" >&2; exit 1; }
can_prompt() {
  [ "${VCONTROLHUB_ASSUME_DEFAULTS}" != "1" ] && [ -r /dev/tty ] && [ -w /dev/tty ]
}
choose_action() {
  if [ -z "${VCONTROLHUB_ACTION}" ] && can_prompt; then
    cat > /dev/tty <<'EOF'

VControlHub lifecycle menu
  1) Install / reinstall
  2) Update (backup, pull, migrate, rebuild, verify)
  3) Completely uninstall (delete all application data)
  4) Health check
  5) Show generated credentials
  0) Exit
EOF
    printf 'Select an action [1]: ' > /dev/tty
    local selection=""
    IFS= read -r selection < /dev/tty || selection=""
    case "${selection:-1}" in
      1) VCONTROLHUB_ACTION="install" ;;
      2) VCONTROLHUB_ACTION="update" ;;
      3) VCONTROLHUB_ACTION="uninstall" ;;
      4) VCONTROLHUB_ACTION="check" ;;
      5) VCONTROLHUB_ACTION="credentials" ;;
      0) VCONTROLHUB_ACTION="exit" ;;
      *) fail "Invalid menu selection: ${selection}" ;;
    esac
  fi
  VCONTROLHUB_ACTION="${VCONTROLHUB_ACTION:-install}"
  case "${VCONTROLHUB_ACTION}" in
    install|update|uninstall|check|credentials|exit) ;;
    *) fail "Invalid VCONTROLHUB_ACTION=${VCONTROLHUB_ACTION}; expected install, update, uninstall, check, credentials, or exit." ;;
  esac
}
prompt_with_default() {
  local var_name="$1" label="$2" default_value="$3" input_value=""
  if can_prompt; then
    printf '\033[1;32m[bootstrap]\033[0m %s [%s]: ' "${label}" "${default_value:-<empty>}" > /dev/tty
    IFS= read -r input_value < /dev/tty || input_value=""
  fi
  [ -n "${input_value}" ] || input_value="${default_value}"
  printf -v "${var_name}" '%s' "${input_value}"
}
prompt_config() {
  if can_prompt; then
    log "Interactive setup: press Enter to accept defaults. Set VCONTROLHUB_ASSUME_DEFAULTS=1 for unattended defaults."
  else
    log "Using bootstrap defaults/env overrides (no interactive TTY or VCONTROLHUB_ASSUME_DEFAULTS=1)."
  fi

  prompt_with_default APP_NAME "Application name" "${APP_NAME}"
  prompt_with_default APP_SLUG "Application slug" "${APP_SLUG}"
  [ -n "${APP_SLUG}" ] || APP_SLUG="vcontrolhub"
  prompt_with_default SITE_NAME "Site/display name" "${SITE_NAME:-${APP_NAME}}"
  prompt_with_default SERVICE_PREFIX "Systemd service prefix" "${SERVICE_PREFIX:-${APP_SLUG}}"
  prompt_with_default APP_DIR "Install directory" "${APP_DIR}"
  prompt_with_default DOMAIN "Domain / public hostname" "${DOMAIN}"
  prompt_with_default NEXT_PORT "Next.js service port" "${NEXT_PORT}"
  prompt_with_default SSH_WS_PORT "SSH WebSocket service port" "${SSH_WS_PORT}"
  prompt_with_default REPO_URL "Git repository URL" "${REPO_URL}"
  prompt_with_default BRANCH "Git branch" "${BRANCH}"
}
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

require_installed_script() {
  local relative_path="$1"
  [ -x "${APP_DIR}/${relative_path}" ] || fail "VControlHub is not installed at ${APP_DIR}; missing ${relative_path}. Choose install first."
}

run_install() {
  prompt_config
  ensure_git
  checkout_repo
  log "Starting one-click installer"
  APP_NAME="${APP_NAME}" \
  APP_SLUG="${APP_SLUG}" \
  SITE_NAME="${SITE_NAME}" \
  SERVICE_PREFIX="${SERVICE_PREFIX}" \
  APP_DIR="${APP_DIR}" \
  DOMAIN="${DOMAIN}" \
  NEXT_PORT="${NEXT_PORT}" \
  SSH_WS_PORT="${SSH_WS_PORT}" \
  REPO_URL="${REPO_URL}" \
  "${APP_DIR}/deploy/install.sh" "$@"
}

run_update() {
  require_installed_script deploy/upgrade.sh
  log "Starting backup-first update"
  APP_NAME="${APP_NAME}" APP_SLUG="${APP_SLUG}" SERVICE_PREFIX="${SERVICE_PREFIX}" \
    APP_DIR="${APP_DIR}" UPGRADE_REF="${BRANCH}" "${APP_DIR}/deploy/upgrade.sh" "$@"
}

run_uninstall() {
  require_installed_script deploy/uninstall.sh
  log "Starting complete uninstall"
  local confirmation_args=()
  if ! can_prompt; then
    [ "${VCONTROLHUB_UNINSTALL_CONFIRM}" = "1" ] || fail "Non-interactive complete uninstall requires VCONTROLHUB_UNINSTALL_CONFIRM=1."
    confirmation_args+=(--yes)
  fi
  APP_SLUG="${APP_SLUG}" SERVICE_PREFIX="${SERVICE_PREFIX}" APP_DIR="${APP_DIR}" \
    "${APP_DIR}/deploy/uninstall.sh" "${confirmation_args[@]}" "$@"
}

run_check() {
  require_installed_script deploy/check.sh
  APP_NAME="${APP_NAME}" APP_SLUG="${APP_SLUG}" SERVICE_PREFIX="${SERVICE_PREFIX}" APP_DIR="${APP_DIR}" \
    "${APP_DIR}/deploy/check.sh" "$@"
}

show_credentials() {
  require_installed_script deploy/install.sh
  APP_SLUG="${APP_SLUG}" APP_DIR="${APP_DIR}" "${APP_DIR}/deploy/install.sh" --show-credentials
}

main() {
  if [ "${CHECK_SYNTAX_ONLY:-0}" = "1" ]; then
    bash -n "${BASH_SOURCE[0]}"
    return
  fi

  need_root
  choose_action
  case "${VCONTROLHUB_ACTION}" in
    install) run_install "$@" ;;
    update) run_update "$@" ;;
    uninstall) run_uninstall "$@" ;;
    check) run_check "$@" ;;
    credentials) show_credentials ;;
    exit) log "No changes made." ;;
  esac
}

main "$@"
