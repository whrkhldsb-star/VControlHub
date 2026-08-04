#!/usr/bin/env bash
# Completely remove VControlHub and its application-managed data.
# Shared OS packages and unrelated Docker resources are intentionally retained.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_SLUG="${APP_SLUG:-vcontrolhub}"
SERVICE_PREFIX="${SERVICE_PREFIX:-${APP_SLUG}}"
APP_DIR="${APP_DIR:-/opt/VControlHub}"
APP_USER="${APP_USER:-${APP_SLUG}}"
ENV_FILE="${ENV_FILE:-${APP_DIR}/.env.local}"
ASSUME_YES=0
DRY_RUN=0

log() { printf '\033[1;32m[uninstall]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[uninstall]\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31m[uninstall]\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: sudo deploy/uninstall.sh [--yes] [--dry-run]

This is always a complete uninstall. It removes application services, source,
configuration/secrets, PostgreSQL database and role, runtime data, the app
system user, installer-managed proxy configuration, and local Quick Service
containers/data. It does not remove shared OS packages or unrelated Docker
resources.

Options:
  --yes       Skip the interactive confirmation (for explicit automation).
  --dry-run   Print the resolved removal scope without changing the host.
  -h, --help  Show this help.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
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

QUICK_SERVICE_PATHS_LIB="${SCRIPT_DIR}/lib/quick-service-paths.sh"
[ -r "${QUICK_SERVICE_PATHS_LIB}" ] || fail "Missing Quick Service path inventory: ${QUICK_SERVICE_PATHS_LIB}"
# shellcheck disable=SC1090
source "${QUICK_SERVICE_PATHS_LIB}"

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

units=(
  "${SERVICE_PREFIX}-next.service"
  "${SERVICE_PREFIX}-worker.service"
  "${SERVICE_PREFIX}-ssh-ws.service"
  "${SERVICE_PREFIX}-direct.service"
)

log "Complete uninstall selected; no application information will be retained."
log "Application directory: ${APP_DIR}"
log "Services: ${units[*]}"
log "Database: ${PG_DB_NAME}; role: ${PG_DB_USER}; user: ${APP_USER}"
log "Runtime paths: ${STORAGE_ROOT}, ${DOWNLOAD_ROOT}, ${BACKUP_DIR}, ${ARIA2_RPC_DIR}"
log "Local Quick Service containers and catalog data paths will be removed."
warn "Shared OS packages and unrelated Docker resources will remain installed."

if [ "${DRY_RUN}" = "1" ]; then
  log "Dry run complete; no changes made."
  exit 0
fi

command -v psql >/dev/null 2>&1 || fail "PostgreSQL tools are unavailable; cannot guarantee complete database removal."
id postgres >/dev/null 2>&1 || fail "PostgreSQL system user is unavailable; cannot guarantee complete database removal."
(cd / && sudo -u postgres psql -tAc 'SELECT 1' >/dev/null) || fail "PostgreSQL is not reachable; start it before uninstalling."
if command -v docker >/dev/null 2>&1; then
  docker info >/dev/null 2>&1 || fail "Docker is installed but unavailable; cannot guarantee complete Quick Service removal."
fi

while IFS= read -r candidate_path; do
  candidate_path="$(normalize_path "${candidate_path}")"
  if command -v mountpoint >/dev/null 2>&1 && mountpoint -q "${candidate_path}"; then
    fail "Refusing to delete mounted application path ${candidate_path}; unmount it first."
  fi
done <<EOF
${APP_DIR}
${STORAGE_ROOT}
${DOWNLOAD_ROOT}
${BACKUP_DIR}
${ARIA2_RPC_DIR}
$(quick_service_removable_data_paths)
EOF

if [ "${ASSUME_YES}" != "1" ]; then
  [ -r /dev/tty ] && [ -w /dev/tty ] || fail "No interactive terminal. Re-run with --yes after reviewing --dry-run."
  expected="uninstall ${APP_SLUG}"
  printf 'Type "%s" to permanently delete all application data: ' "${expected}" > /dev/tty
  IFS= read -r answer < /dev/tty
  [ "${answer}" = "${expected}" ] || fail "Confirmation did not match; nothing was removed."
fi

for unit in "${units[@]}"; do
  systemctl disable --now "${unit}" >/dev/null 2>&1 || true
done

for unit in "${units[@]}"; do
  unit_path="/etc/systemd/system/${unit}"
  dropin_path="${unit_path}.d"
  [ ! -e "${unit_path}" ] && [ ! -L "${unit_path}" ] || unlink "${unit_path}"
  [ ! -d "${dropin_path}" ] || find "${dropin_path}" -depth -delete
done
systemctl daemon-reload
systemctl reset-failed >/dev/null 2>&1 || true

managed_marker="# Managed by VControlHub installer: ${APP_SLUG}"
caddy_file="/etc/caddy/Caddyfile"
if [ -f "${caddy_file}" ] && grep -Fxq "${managed_marker}" "${caddy_file}"; then
  systemctl stop caddy >/dev/null 2>&1 || true
  unlink "${caddy_file}"
  log "Removed installer-managed Caddy configuration"
elif [ -f "${caddy_file}" ]; then
  warn "Preserving unrelated Caddy configuration: ${caddy_file}"
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

remove_quick_service_containers() {
  command -v docker >/dev/null 2>&1 || return 0
  local id name
  declare -A container_ids=()
  while IFS= read -r id; do
    [ -n "${id}" ] && container_ids["${id}"]=1
  done < <(docker ps -aq --filter "label=com.vcontrolhub.quick-service=true")
  while IFS='|' read -r id name; do
    [[ "${name}" == qs-* ]] && container_ids["${id}"]=1
  done < <(docker ps -a --format '{{.ID}}|{{.Names}}')
  for id in "${!container_ids[@]}"; do
    docker rm -f "${id}" >/dev/null
    log "Removed VControlHub Quick Service container ${id}"
  done
  while IFS= read -r id; do
    [ -n "${id}" ] && docker volume rm -f "${id}" >/dev/null
  done < <(docker volume ls -q --filter "label=com.vcontrolhub.quick-service=true")
  while IFS= read -r id; do
    [ -n "${id}" ] && docker network rm "${id}" >/dev/null
  done < <(docker network ls -q --filter "label=com.vcontrolhub.quick-service=true")
}

remove_quick_service_containers

cd /
sudo -u postgres psql -v ON_ERROR_STOP=1 -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${PG_DB_NAME}' AND pid <> pg_backend_pid();" >/dev/null
sudo -u postgres dropdb --if-exists "${PG_DB_NAME}"
sudo -u postgres dropuser --if-exists "${PG_DB_USER}"

declare -A seen_paths=()
while IFS= read -r data_path; do
  data_path="$(safe_data_path "${data_path}")"
  [ -z "${seen_paths[${data_path}]+x}" ] || continue
  seen_paths["${data_path}"]=1
  [ ! -e "${data_path}" ] || find "${data_path}" -xdev -depth -delete
  parent_path="$(dirname "${data_path}")"
  case "${parent_path}" in /opt/*|/srv/*) rmdir "${parent_path}" 2>/dev/null || true ;; esac
done <<EOF
${STORAGE_ROOT}
${DOWNLOAD_ROOT}
${BACKUP_DIR}
${ARIA2_RPC_DIR}
/var/lib/${APP_SLUG}
/var/backups/${APP_SLUG}
$(quick_service_removable_data_paths)
EOF

if [ -e "${APP_DIR}" ]; then
  find "${APP_DIR}" -xdev -depth -delete
fi

if id "${APP_USER}" >/dev/null 2>&1; then
  user_record="$(getent passwd "${APP_USER}")"
  user_uid="$(printf '%s' "${user_record}" | cut -d: -f3)"
  user_home="$(printf '%s' "${user_record}" | cut -d: -f6)"
  if [ "${user_uid}" -lt 1000 ] && [ "$(normalize_path "${user_home}")" = "${APP_DIR}" ]; then
    userdel "${APP_USER}"
  else
    fail "APP_USER=${APP_USER} is not an installer-owned system user with home ${APP_DIR}; refusing to delete it."
  fi
fi

for unit in "${units[@]}"; do
  if systemctl list-unit-files "${unit}" --no-legend 2>/dev/null | grep -q .; then
    fail "Residual systemd unit remains: ${unit}"
  fi
done
[ ! -e "${APP_DIR}" ] || fail "Residual application directory remains: ${APP_DIR}"
[ ! -e "/var/lib/${APP_SLUG}" ] || fail "Residual runtime data remains: /var/lib/${APP_SLUG}"
[ ! -e "/var/backups/${APP_SLUG}" ] || fail "Residual backup data remains: /var/backups/${APP_SLUG}"
if id "${APP_USER}" >/dev/null 2>&1; then
  fail "Residual application user remains: ${APP_USER}"
fi
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${PG_DB_NAME}'" | grep -q 1; then
  fail "Residual PostgreSQL database remains: ${PG_DB_NAME}"
fi
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${PG_DB_USER}'" | grep -q 1; then
  fail "Residual PostgreSQL role remains: ${PG_DB_USER}"
fi
if command -v docker >/dev/null 2>&1; then
  [ -z "$(docker ps -aq --filter 'label=com.vcontrolhub.quick-service=true')" ] || fail "Residual labeled Quick Service containers remain."
  if docker ps -a --format '{{.Names}}' | grep -Eq '^qs-'; then
    fail "Residual legacy Quick Service containers remain."
  fi
fi

log "Complete uninstall verified. No VControlHub application data was retained."
