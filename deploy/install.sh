#!/usr/bin/env bash
# Portable one-command installer/deployer for whrkhldsb.
# Tested target: Debian/Ubuntu systemd host. Re-runnable and safe for upgrades.

set -euo pipefail

APP_NAME="${APP_NAME:-whrkhldsb}"
APP_DIR="${APP_DIR:-/opt/${APP_NAME}}"
APP_USER="${APP_USER:-${APP_NAME}}"
DOMAIN="${DOMAIN:-}"
NODE_VERSION_MAJOR="${NODE_VERSION_MAJOR:-22}"
NEXT_HOST="${NEXT_HOST:-127.0.0.1}"
NEXT_PORT="${NEXT_PORT:-3000}"
SSH_WS_HOST="${SSH_WS_HOST:-127.0.0.1}"
SSH_WS_PORT="${SSH_WS_PORT:-3001}"
ENV_FILE="${ENV_FILE:-${APP_DIR}/.env.local}"
ENV_TEMPLATE="${ENV_TEMPLATE:-${APP_DIR}/deploy/env.production.example}"
SKIP_PACKAGES="${SKIP_PACKAGES:-0}"
SKIP_CADDY="${SKIP_CADDY:-0}"
SKIP_DB_SETUP="${SKIP_DB_SETUP:-0}"
SKIP_RESTART="${SKIP_RESTART:-0}"
REPO_URL="${REPO_URL:-}"
SOURCE_DIR="${SOURCE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

log() { printf '\033[1;32m[%s]\033[0m %s\n' "$(date -Iseconds)" "$*"; }
warn() { printf '\033[1;33m[%s]\033[0m %s\n' "$(date -Iseconds)" "$*" >&2; }
fail() { printf '\033[1;31m[%s]\033[0m %s\n' "$(date -Iseconds)" "$*" >&2; exit 1; }
need_root() { [ "$(id -u)" -eq 0 ] || fail "Please run as root (or via sudo)."; }
have_cmd() { command -v "$1" >/dev/null 2>&1; }

shell_escape_sed_replacement() {
  printf '%s' "$1" | sed -e 's/[\&]/\\&/g'
}

is_placeholder_value() {
  local value="${1:-}"
  case "${value}" in
    ""|*REPLACE_WITH*|*CHANGE_ME*|*CHANGE_THIS*|*your-domain.example*|*example.com*|*'***'*|*\*\*\**)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

install_packages() {
  [ "${SKIP_PACKAGES}" = "1" ] && { warn "Skipping OS package installation"; return; }
  log "Installing required OS packages"
  apt-get update
  apt-get install -y ca-certificates curl gnupg git openssh-client sshpass rsync postgresql-client build-essential
  if ! have_cmd node || [ "$(node -p 'process.versions.node.split(`.`)[0]' 2>/dev/null || echo 0)" -lt "${NODE_VERSION_MAJOR}" ]; then
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION_MAJOR}.x | bash -
    apt-get install -y nodejs
  fi
  if [ "${SKIP_CADDY}" != "1" ] && ! have_cmd caddy; then
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
    curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update
    apt-get install -y caddy
  fi
}

prepare_app_user() {
  if ! id "${APP_USER}" >/dev/null 2>&1; then
    useradd --system --home "${APP_DIR}" --shell /usr/sbin/nologin "${APP_USER}"
  fi
  mkdir -p "${APP_DIR}"
}

sync_source() {
  log "Syncing application to ${APP_DIR}"
  if [ -n "${REPO_URL}" ]; then
    if [ -d "${APP_DIR}/.git" ]; then
      git -C "${APP_DIR}" fetch --all --prune
      git -C "${APP_DIR}" pull --ff-only
    else
      rm -rf "${APP_DIR:?}"/*
      git clone "${REPO_URL}" "${APP_DIR}"
    fi
  else
    rsync -a --delete \
      --exclude .git --exclude node_modules --exclude .next --exclude backups --exclude storage --exclude tmp --exclude uploads --exclude downloads --exclude logs --exclude .env.local \
      "${SOURCE_DIR}/" "${APP_DIR}/"
  fi
  mkdir -p \
    "${APP_DIR}/storage" \
    "${APP_DIR}/tmp" \
    "${APP_DIR}/uploads" \
    "${APP_DIR}/downloads" \
    "${APP_DIR}/backups" \
    "${APP_DIR}/logs"
  chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
}

write_env_if_missing() {
  if [ ! -f "${ENV_FILE}" ]; then
    [ -f "${ENV_TEMPLATE}" ] || ENV_TEMPLATE="${APP_DIR}/.env.example"
    [ -f "${ENV_TEMPLATE}" ] || fail "No environment template found at ${ENV_TEMPLATE} or ${APP_DIR}/.env.example"
    log "Creating ${ENV_FILE} from ${ENV_TEMPLATE}"
    cp "${ENV_TEMPLATE}" "${ENV_FILE}"
    chmod 600 "${ENV_FILE}"
    warn "Edit ${ENV_FILE} and set DATABASE_URL, AUTH_SESSION_SECRET, ADMIN_INITIAL_PASSWORD, public domain/origin values before production use."
    fail "Environment file created but not yet customized. Re-run this installer after editing ${ENV_FILE}."
  fi
}

validate_env() {
  [ -f "${ENV_FILE}" ] || fail "Missing ${ENV_FILE}. Create it from deploy/env.production.example first."
  # shellcheck disable=SC1090
  set -a; source "${ENV_FILE}"; set +a
  local required
  for required in DATABASE_URL AUTH_SESSION_SECRET ADMIN_INITIAL_PASSWORD; do
    [ -n "${!required:-}" ] || fail "${required} is required in ${ENV_FILE}."
    if is_placeholder_value "${!required:-}"; then
      fail "${required} still contains a placeholder in ${ENV_FILE}."
    fi
  done
  if [ "${#AUTH_SESSION_SECRET}" -lt 32 ]; then
    fail "AUTH_SESSION_SECRET must be at least 32 characters. Generate one with: openssl rand -base64 48"
  fi
  if [ -n "${SSH_WS_ALLOWED_ORIGINS:-}" ] && is_placeholder_value "${SSH_WS_ALLOWED_ORIGINS}"; then
    fail "SSH_WS_ALLOWED_ORIGINS still contains a placeholder in ${ENV_FILE}."
  fi
  if [ -n "${NEXT_PUBLIC_APP_PUBLIC_LABEL:-}" ] && is_placeholder_value "${NEXT_PUBLIC_APP_PUBLIC_LABEL}"; then
    fail "NEXT_PUBLIC_APP_PUBLIC_LABEL still contains a placeholder in ${ENV_FILE}."
  fi
  if [ -n "${ENABLE_DEMO_FALLBACK:-}" ] && [ "${ENABLE_DEMO_FALLBACK}" = "true" ]; then
    fail "ENABLE_DEMO_FALLBACK=true is not allowed for this production installer. Use an isolated local setup for demos."
  fi
}

create_runtime_dirs() {
  log "Creating runtime directories"
  mkdir -p \
    "${APP_DIR}/storage" \
    "${APP_DIR}/tmp" \
    "${APP_DIR}/uploads" \
    "${APP_DIR}/downloads" \
    "${APP_DIR}/backups" \
    "${APP_DIR}/logs" \
    "${STORAGE_ROOT:-/var/lib/${APP_NAME}/storage}" \
    "${DOWNLOAD_ROOT:-/var/lib/${APP_NAME}/downloads}" \
    "${BACKUP_DIR:-/var/backups/${APP_NAME}}"
  chown -R "${APP_USER}:${APP_USER}" \
    "${APP_DIR}/storage" \
    "${APP_DIR}/tmp" \
    "${APP_DIR}/uploads" \
    "${APP_DIR}/downloads" \
    "${APP_DIR}/backups" \
    "${APP_DIR}/logs" \
    "${STORAGE_ROOT:-/var/lib/${APP_NAME}/storage}" \
    "${DOWNLOAD_ROOT:-/var/lib/${APP_NAME}/downloads}" \
    "${BACKUP_DIR:-/var/backups/${APP_NAME}}"
}

build_app() {
  log "Installing dependencies and building application"
  cd "${APP_DIR}"
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
  npm ci
  npm run prisma:generate
  if [ "${SKIP_DB_SETUP}" != "1" ]; then
    npm run prisma:deploy
  fi
  npm run build
  chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
}

install_systemd() {
  log "Installing systemd units"
  install -m 0644 "${APP_DIR}/deploy/systemd/whrkhldsb-next.service.example" "/etc/systemd/system/${APP_NAME}-next.service"
  install -m 0644 "${APP_DIR}/deploy/systemd/whrkhldsb-ssh-ws.service.example" "/etc/systemd/system/${APP_NAME}-ssh-ws.service"
  sed -i \
    -e "s#WorkingDirectory=.*#WorkingDirectory=${APP_DIR}#" \
    -e "s#EnvironmentFile=.*#EnvironmentFile=${ENV_FILE}#" \
    -e "s#User=.*#User=${APP_USER}#" \
    -e "s#Group=.*#Group=${APP_USER}#" \
    "/etc/systemd/system/${APP_NAME}-next.service" "/etc/systemd/system/${APP_NAME}-ssh-ws.service"
  systemctl daemon-reload
  systemctl enable "${APP_NAME}-next.service" "${APP_NAME}-ssh-ws.service"
}

install_caddy() {
  [ "${SKIP_CADDY}" = "1" ] && { warn "Skipping Caddy setup"; return; }
  [ -n "${DOMAIN}" ] || { warn "DOMAIN is empty; skipping Caddy config"; return; }
  log "Installing Caddy reverse proxy for ${DOMAIN}"
  install -m 0644 "${APP_DIR}/deploy/Caddyfile.example" /etc/caddy/Caddyfile
  local escaped_domain escaped_next escaped_ssh_ws
  escaped_domain="$(shell_escape_sed_replacement "${DOMAIN}")"
  escaped_next="$(shell_escape_sed_replacement "${NEXT_HOST}:${NEXT_PORT}")"
  escaped_ssh_ws="$(shell_escape_sed_replacement "${SSH_WS_HOST}:${SSH_WS_PORT}")"
  sed -i \
    -e "s#your-domain.example#${escaped_domain}#g" \
    -e "s#127.0.0.1:3000#${escaped_next}#g" \
    -e "s#127.0.0.1:3001#${escaped_ssh_ws}#g" \
    /etc/caddy/Caddyfile
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  systemctl enable caddy
}

restart_services() {
  [ "${SKIP_RESTART}" = "1" ] && { warn "Skipping service restart"; return; }
  log "Restarting services"
  systemctl restart "${APP_NAME}-next.service" "${APP_NAME}-ssh-ws.service"
  [ "${SKIP_CADDY}" = "1" ] || systemctl reload caddy || systemctl restart caddy
  sleep 2
  systemctl --no-pager --lines=20 status "${APP_NAME}-next.service" "${APP_NAME}-ssh-ws.service" || true
  curl -fsS "http://${NEXT_HOST}:${NEXT_PORT}/login" >/dev/null || warn "Local login page did not return 2xx; check logs."
}

main() {
  need_root
  install_packages
  prepare_app_user
  sync_source
  write_env_if_missing
  validate_env
  create_runtime_dirs
  build_app
  install_systemd
  install_caddy
  restart_services
  log "Done. App directory: ${APP_DIR}"
}

main "$@"
