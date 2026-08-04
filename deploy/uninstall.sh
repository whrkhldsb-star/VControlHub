#!/usr/bin/env bash
# Remove a VControlHub installation without removing shared OS packages.
# Runtime data and PostgreSQL objects are preserved unless --purge-data is set.

set -euo pipefail

APP_SLUG="${APP_SLUG:-vcontrolhub}"
SERVICE_PREFIX="${SERVICE_PREFIX:-${APP_SLUG}}"
APP_DIR="${APP_DIR:-/opt/VControlHub}"
APP_USER="${APP_USER:-${APP_SLUG}}"
ENV_FILE="${ENV_FILE:-${APP_DIR}/.env.local}"
PERSISTED_ENV_FILE="${PERSISTED_ENV_FILE:-/var/lib/${APP_SLUG}/installer/.env.local}"
PURGE_DATA=0
ASSUME_YES=0
DRY_RUN=0

log() { printf '\033[1;32m[uninstall]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[uninstall]\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31m[uninstall]\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: sudo deploy/uninstall.sh [--purge-data] [--yes] [--dry-run]

Options:
  --purge-data  Also remove the application database, database role, runtime
                storage/download/backup directories, and system user.
  --yes         Skip the interactive confirmation (required for automation).
  --dry-run     Print the resolved removal scope without changing the host.
  -h, --help    Show this help.

Shared packages (Node.js, PostgreSQL, Caddy, Apache and Docker) and Quick
Service containers/data are never removed.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --purge-data) PURGE_DATA=1 ;;
    --yes) ASSUME_YES=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Unknown argument: $1. Use --help for usage." ;;
  esac
  shift
done

[ "$(id -u)" = "0" ] || fail "Please run as root (or via sudo)."
[[ "${APP_SLUG}" =~ ^[a-z0-9][a-z0-9-]*$ ]] || fail "Unsafe APP_SLUG=${APP_SLUG}"
[[ "${SERVICE_PREFIX}" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.@-]*$ ]] || fail "Unsafe SERVICE_PREFIX=${SERVICE_PREFIX}"
[[ "${APP_USER}" =~ ^[a-z_][a-z0-9_-]*$ ]] || fail "Unsafe APP_USER=${APP_USER}"

normalize_path() {
  realpath -m -- "$1"
}

APP_DIR="$(normalize_path "${APP_DIR}")"
case "${APP_DIR}" in
  /opt/*|/srv/*|/home/*|/root/*) ;;
  *) fail "Refusing unsafe APP_DIR=${APP_DIR}; expected a child of /opt, /srv, /home, or /root." ;;
esac

read_env_value() {
  local key="$1" value=""
  [ -f "${ENV_FILE}" ] || return 0
  value="$(awk -v wanted="${key}" '
    $0 ~ "^[[:space:]]*" wanted "[[:space:]]*=" {
      sub("^[[:space:]]*" wanted "[[:space:]]*=[[:space:]]*", "")
      print
      exit
    }
  ' "${ENV_FILE}")"
  value="${value%$'\r'}"
  if [[ "${value}" == \"*\" ]] || [[ "${value}" == \'*\' ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "${value}"
}

PG_DB_NAME="${PG_DB_NAME:-$(read_env_value PG_DB_NAME)}"
PG_DB_USER="${PG_DB_USER:-$(read_env_value PG_DB_USER)}"
STORAGE_ROOT="${STORAGE_ROOT:-$(read_env_value STORAGE_ROOT)}"
DOWNLOAD_ROOT="${DOWNLOAD_ROOT:-$(read_env_value DOWNLOAD_ROOT)}"
BACKUP_DIR="${BACKUP_DIR:-$(read_env_value BACKUP_DIR)}"
ARIA2_RPC_DIR="${ARIA2_RPC_DIR:-$(read_env_value ARIA2_RPC_DIR)}"
PG_DB_NAME="${PG_DB_NAME:-${APP_SLUG//-/_}}"
PG_DB_USER="${PG_DB_USER:-${APP_SLUG//-/_}}"
STORAGE_ROOT="${STORAGE_ROOT:-/var/lib/${APP_SLUG}/storage}"
DOWNLOAD_ROOT="${DOWNLOAD_ROOT:-/var/lib/${APP_SLUG}/downloads}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/${APP_SLUG}}"
ARIA2_RPC_DIR="${ARIA2_RPC_DIR:-/var/lib/${APP_SLUG}/aria2}"

[[ "${PG_DB_NAME}" =~ ^[a-z_][a-z0-9_]*$ ]] || fail "Unsafe PG_DB_NAME=${PG_DB_NAME}"
[[ "${PG_DB_USER}" =~ ^[a-z_][a-z0-9_]*$ ]] || fail "Unsafe PG_DB_USER=${PG_DB_USER}"

safe_data_path() {
  local value
  value="$(normalize_path "$1")"
  case "${value}" in
    /var/lib/*|/var/backups/*|/opt/*/*|/srv/*/*|/home/*/*/*|/root/*/*) printf '%s' "${value}" ;;
    *) fail "Refusing unsafe data path: ${value}" ;;
  esac
}

STORAGE_ROOT="$(safe_data_path "${STORAGE_ROOT}")"
DOWNLOAD_ROOT="$(safe_data_path "${DOWNLOAD_ROOT}")"
BACKUP_DIR="$(safe_data_path "${BACKUP_DIR}")"
ARIA2_RPC_DIR="$(safe_data_path "${ARIA2_RPC_DIR}")"
PERSISTED_ENV_FILE="$(safe_data_path "${PERSISTED_ENV_FILE}")"

units=(
  "${SERVICE_PREFIX}-next.service"
  "${SERVICE_PREFIX}-worker.service"
  "${SERVICE_PREFIX}-ssh-ws.service"
  "${SERVICE_PREFIX}-direct.service"
)

log "Application directory: ${APP_DIR}"
log "Services: ${units[*]}"
log "Purge application data: $([ "${PURGE_DATA}" = "1" ] && printf yes || printf no)"
if [ "${PURGE_DATA}" = "1" ]; then
  log "Database: ${PG_DB_NAME}; role: ${PG_DB_USER}"
  log "Runtime paths: ${STORAGE_ROOT}, ${DOWNLOAD_ROOT}, ${BACKUP_DIR}, ${ARIA2_RPC_DIR}"
fi
warn "Quick Service containers and their host data directories are intentionally preserved."
if [ "${PURGE_DATA}" != "1" ]; then
  log "Configuration backup: ${PERSISTED_ENV_FILE}"
fi

if [ "${DRY_RUN}" = "1" ]; then
  log "Dry run complete; no changes made."
  exit 0
fi

if [ "${ASSUME_YES}" != "1" ]; then
  [ -r /dev/tty ] && [ -w /dev/tty ] || fail "No interactive terminal. Re-run with --yes after reviewing --dry-run."
  expected="uninstall ${APP_SLUG}"
  printf 'Type "%s" to continue: ' "${expected}" > /dev/tty
  IFS= read -r answer < /dev/tty
  [ "${answer}" = "${expected}" ] || fail "Confirmation did not match; nothing was removed."
fi

for unit in "${units[@]}"; do
  systemctl disable --now "${unit}" >/dev/null 2>&1 || true
done

for unit in "${units[@]}"; do
  unit_path="/etc/systemd/system/${unit}"
  dropin_path="${unit_path}.d"
  if [ -e "${unit_path}" ] || [ -L "${unit_path}" ]; then
    unlink "${unit_path}"
  fi
  if [ -d "${dropin_path}" ]; then
    find "${dropin_path}" -depth -delete
  fi
done
systemctl daemon-reload
systemctl reset-failed >/dev/null 2>&1 || true

managed_marker="# Managed by VControlHub installer: ${APP_SLUG}"
caddy_file="/etc/caddy/Caddyfile"
if [ -f "${caddy_file}" ]; then
  if grep -Fxq "${managed_marker}" "${caddy_file}"; then
    systemctl stop caddy >/dev/null 2>&1 || true
    unlink "${caddy_file}"
    log "Removed installer-managed Caddy configuration"
  else
    warn "Preserving unmarked Caddy configuration: ${caddy_file}"
  fi
fi

apache_available="/etc/apache2/sites-available/next-proxy.conf"
apache_enabled="/etc/apache2/sites-enabled/next-proxy.conf"
if [ -f "${apache_available}" ] && grep -Fxq "${managed_marker}" "${apache_available}"; then
  a2dissite next-proxy >/dev/null 2>&1 || true
  [ ! -e "${apache_enabled}" ] && [ ! -L "${apache_enabled}" ] || unlink "${apache_enabled}"
  unlink "${apache_available}"
  systemctl reload apache2 >/dev/null 2>&1 || true
  log "Removed installer-managed Apache configuration"
fi

if [ "${PURGE_DATA}" != "1" ] && [ -f "${ENV_FILE}" ]; then
  mkdir -p "$(dirname "${PERSISTED_ENV_FILE}")"
  install -m 0600 "${ENV_FILE}" "${PERSISTED_ENV_FILE}"
  log "Preserved application configuration for a future reinstall"
fi

cd /
if [ -e "${APP_DIR}" ]; then
  find "${APP_DIR}" -depth -delete
fi

if [ "${PURGE_DATA}" = "1" ]; then
  if command -v psql >/dev/null 2>&1 && id postgres >/dev/null 2>&1; then
    sudo -u postgres psql -v ON_ERROR_STOP=1 -c \
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${PG_DB_NAME}' AND pid <> pg_backend_pid();" >/dev/null
    sudo -u postgres dropdb --if-exists "${PG_DB_NAME}"
    sudo -u postgres dropuser --if-exists "${PG_DB_USER}"
  else
    warn "PostgreSQL tools/user unavailable; database objects were not removed."
  fi

  declare -A seen_paths=()
  for data_path in "${STORAGE_ROOT}" "${DOWNLOAD_ROOT}" "${BACKUP_DIR}" "${ARIA2_RPC_DIR}" \
    "/var/lib/${APP_SLUG}" "/var/backups/${APP_SLUG}"; do
    data_path="$(safe_data_path "${data_path}")"
    [ -z "${seen_paths[${data_path}]+x}" ] || continue
    seen_paths["${data_path}"]=1
    if [ -e "${data_path}" ]; then
      find "${data_path}" -depth -delete
    fi
  done

  if id "${APP_USER}" >/dev/null 2>&1; then
    user_record="$(getent passwd "${APP_USER}")"
    user_uid="$(printf '%s' "${user_record}" | cut -d: -f3)"
    user_home="$(printf '%s' "${user_record}" | cut -d: -f6)"
    if [ "${user_uid}" -lt 1000 ] && [ "$(normalize_path "${user_home}")" = "${APP_DIR}" ]; then
      userdel "${APP_USER}"
    else
      warn "Preserving APP_USER=${APP_USER}; it is not an installer-owned system user with home ${APP_DIR}."
    fi
  fi
fi

for unit in "${units[@]}"; do
  if systemctl list-unit-files "${unit}" --no-legend 2>/dev/null | grep -q .; then
    fail "Residual systemd unit remains: ${unit}"
  fi
done
[ ! -e "${APP_DIR}" ] || fail "Residual application directory remains: ${APP_DIR}"
log "Uninstall completed. Shared OS packages and Quick Service data were preserved."
