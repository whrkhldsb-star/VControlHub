#!/usr/bin/env bash
# Completely remove VControlHub and its application-managed data.
# Shared OS packages and unrelated Docker resources are intentionally retained.

set -euo pipefail

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
Usage: sudo deploy/uninstall.sh [--yes] [--dry-run] [--force-paths]

This is always a complete uninstall. It removes application services, source,
configuration/secrets, the app system user and installer-managed proxy configuration.
Database objects, data directories and Docker resources require instance ownership.

Options:
  --yes       Skip the interactive confirmation (for explicit automation).
  --dry-run   Print the resolved removal scope without changing the host.
  --force-paths  Accepted for compatibility. Directory ownership is always verified.
  -h, --help  Show this help.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --yes) ASSUME_YES=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --force-paths) : ;;
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

[[ ! -L ${APP_DIR} ]] || fail "Refusing symlink APP_DIR=${APP_DIR}"
APP_DIR="$(normalize_path "${APP_DIR}")"
case "${APP_DIR}" in
  /opt/*|/srv/*|/home/*|/root/*) ;;
  *) fail "Refusing unsafe APP_DIR=${APP_DIR}; expected a child of /opt, /srv, /home, or /root." ;;
esac

instance_key="$(printf '%s\0%s' "${APP_SLUG}" "${APP_DIR}" | sha256sum | cut -d' ' -f1)"
INSTANCE_STATE_DIR="/etc/vcontrolhub/instances/${instance_key}"
for dir in /etc/vcontrolhub /etc/vcontrolhub/instances "${INSTANCE_STATE_DIR}"; do
  [[ -e ${dir} || -L ${dir} ]] || continue
  [[ -d ${dir} && ! -L ${dir} && "$(stat -c %u -- "${dir}")" == "${EUID}" ]] ||
    fail "Untrusted installer state directory: ${dir}"
  mode="$(stat -c %a -- "${dir}")"
  (( (8#${mode} & 0022) == 0 )) || fail "Writable installer state directory: ${dir}"
done
docker_instance_label=""
if [[ -f ${INSTANCE_STATE_DIR}/docker-instance && ! -L ${INSTANCE_STATE_DIR}/docker-instance ]]; then
  docker_id="$(< "${INSTANCE_STATE_DIR}/docker-instance")"
  if [[ ${docker_id} =~ ^[0-9a-f]{32}$ ]]; then docker_instance_label="com.vcontrolhub.instance=${docker_id}"; fi
fi
if [[ -e ${APP_DIR} && ( ! -f ${APP_DIR}/deploy/install.sh || ! -f ${APP_DIR}/deploy/systemd/vcontrolhub-next.service.example ) ]]; then
  fail "Refusing to remove an unrecognized application directory: ${APP_DIR}"
fi

# URL checks are read-only. Only the installer-generated loopback endpoint is
# eligible. Check the recorded service and migration environments before postgres
# is even contacted; never source an application-writable environment file here.
load_owned_database() {
  local record_file="${INSTANCE_STATE_DIR}/database" mode extra
  local -a record
  [[ -f ${record_file} && ! -L ${record_file} ]] || return 1
  mapfile -t record < "${record_file}"
  [[ ${#record[@]} == 3 ]] || return 1
  read -r mode db_port db_name db_role db_cluster db_oid role_oid extra <<< "${record[0]}"
  [[ ${mode} == local && ${db_port} == 5432 && -z ${extra} &&
     ${db_name} =~ ^[a-z_][a-z0-9_]{0,62}$ && ${db_role} =~ ^[a-z_][a-z0-9_]{0,62}$ &&
     ${db_cluster} =~ ^[0-9]+$ && ${db_oid} =~ ^[0-9]+$ && ${role_oid} =~ ^[0-9]+$ &&
     ( ${db_oid} != 0 || ${role_oid} != 0 ) ]] || return 1
  VCH_DB_URL="${DATABASE_URL:-}" python3 - "${db_name}" "${db_role}" "${db_port}" "${record[1]}" "${record[2]}" "${ENV_FILE}" "${RUNTIME_ENV_FILE:-${APP_DIR}/.env.runtime}" <<'PY'
import os, re, sys
from pathlib import Path
from urllib.parse import unquote, urlsplit
db, role, port, env_file, runtime_file, *additional = sys.argv[1:]

def matches(value):
    # The installer URL has escaped credentials. Shell expansion and multiline
    # systemd quoting cannot establish a literal endpoint.
    if any(c.isspace() or c in ("\\", "'", '"', "$", "`") for c in value):
        return False
    url = urlsplit(value)
    return (url.scheme in ("postgres", "postgresql") and url.hostname in ("127.0.0.1", "::1", "localhost")
            and (url.port if url.port is not None else 5432) == int(port) and unquote(url.username or "") == role
            and unquote(url.path) == "/" + db and not url.fragment
            and (not url.query or re.fullmatch(r"schema=[A-Za-z_][A-Za-z0-9_]*", url.query)))

def file_matches(path):
    value = ""
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if not line or line.startswith(("#", ";")):
            continue
        # Accept the installer's one-assignment-per-line format. A line that
        # looks like DATABASE_URL inside a multiline value is not an assignment.
        match = re.fullmatch(r"(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)", line)
        if not match:
            return False
        key, field = match.groups()
        if field.startswith(("'", '"')):
            quote = field[0]
            if not field.endswith(quote) or field.count(quote) != 2 or field.endswith("\\" + quote):
                return False
            field = field[1:-1]
        elif field.endswith("\\") or any(c in field for c in ("'", '"', ";")):
            return False
        if key == "DATABASE_URL":
            value = field
    return matches(value)

try:
    paths = {env_file, runtime_file, *(p for p in additional if p and Path(p).exists())}
    supplied = os.environ["VCH_DB_URL"]
    valid = (not supplied or matches(supplied)) and all(file_matches(p) for p in paths)
except (OSError, UnicodeError, ValueError):
    valid = False
sys.exit(0 if valid else 1)
PY
}

local_admin_psql() {
  (cd / && sudo -u postgres env -i PATH="/usr/bin:/bin" PGHOST=/var/run/postgresql PGPORT="${db_port}" PGDATABASE=postgres \
    psql -X -w -Atq -v ON_ERROR_STOP=1 "$@")
}

plan_database_cleanup() {
  remove_local_db=0
  if load_owned_database; then
    remove_local_db=1
    log "Local PostgreSQL cluster ${db_cluster} on port ${db_port}; database ${db_name} (owned OID ${db_oid}), role ${db_role} (owned OID ${role_oid}); 0 means retained."
  else
    warn "External or unverified DATABASE_URL/ownership. Preserving PostgreSQL data and roles for manual handling by the operator."
  fi
}

check_database_cluster() {
  if [[ ${remove_local_db} == 1 ]]; then
    local current_cluster
    current_cluster="$(local_admin_psql -c 'SELECT system_identifier FROM pg_control_system()')" ||
      fail "Cannot verify the installer-created local PostgreSQL cluster."
    if [[ ${current_cluster} != "${db_cluster}" ]]; then
      warn "The local PostgreSQL cluster has changed. Preserving database and role for manual handling."
      remove_local_db=0
    fi
  fi
}

remove_owned_database() {
  [[ ${remove_local_db} == 1 ]] || return 0
  # The operator may have changed the effective URL while confirmation was open.
  local approved="${db_port} ${db_name} ${db_role} ${db_cluster} ${db_oid} ${role_oid}"
  if ! load_owned_database || [[ "${approved}" != "${db_port} ${db_name} ${db_role} ${db_cluster} ${db_oid} ${role_oid}" ]]; then
    warn "Database configuration or ownership changed. Preserving PostgreSQL objects for manual handling."
    return 0
  fi
  # Check cluster and OIDs in the same session that executes the drops. A
  # recreated database/role with the old name has a different OID. Zero means
  # the resource predated installation. Either case leaves it to the operator.
  local_admin_psql -v cluster="${db_cluster}" -v db="${db_name}" -v role="${db_role}" -v db_oid="${db_oid}" -v role_oid="${role_oid}" <<'SQL'
SELECT format('DROP DATABASE %I WITH (FORCE)', datname)
  FROM pg_database, pg_control_system()
  WHERE system_identifier = :'cluster' AND oid = :'db_oid' AND datname = :'db' \gexec
SELECT format('DROP ROLE %I', rolname)
  FROM pg_roles, pg_control_system()
  WHERE system_identifier = :'cluster' AND oid = :'role_oid' AND rolname = :'role' \gexec
SQL
}

safe_data_path() {
  case "$1" in
    /var/lib/docker|/var/lib/docker/*|/var/lib/containerd|/var/lib/containerd/*|/var/lib/postgresql|/var/lib/postgresql/*|/var/lib/mysql|/var/lib/mysql/*|/var/lib/apt|/var/lib/apt/*|/var/lib/dpkg|/var/lib/dpkg/*|/var/lib/systemd|/var/lib/systemd/*|/opt/containerd|/opt/containerd/*|*/.ssh|*/.ssh/*) return 1 ;;
    /var/lib/*|/var/backups/*|/opt/*/*|/srv/*/*|/home/*/*/*|/root/*/*|/mnt/*/*|/data/*) ;;
    *) return 1 ;;
  esac
  [[ "$1" == "$(normalize_path "$1")" && "$1" != "${APP_DIR}" && "${APP_DIR}" != "$1/"* ]]
}

# Pin the directory before checking the receipt again and traversing its contents.
# The caller retains anything that is still present, including a concurrent replacement.
remove_recorded_directory() (
  local kind="$1" identity="$2" path="$3"
  cd -P -- "${path}" || return 0
  [[ ${PWD} == "${path}" && "$(TZ=UTC stat -c '%d:%i:%w' .)" == "${identity}" ]] || return 0
  refuse_mounted_paths "${path}"
  if [[ ${kind} == tree ]]; then
    find . -xdev -depth -mindepth 1 -delete
  fi
  if [[ . -ef ${path} ]]; then rmdir --ignore-fail-on-non-empty -- "${path}"; fi
)

retained_data_paths=()
contains_retained_data() {
  local retained
  for retained in "${retained_data_paths[@]}"; do
    [[ ${retained} != "$1" && ${retained} != "$1/"* ]] || return 0
  done
  return 1
}

visit_owned_directories() {
  local action="$1" kind identity path ordered
  local -A kinds=() identities=()
  if [[ ! -f ${INSTANCE_STATE_DIR}/directories ]]; then
    warn "No installer data directory inventory. Review pre-existing runtime and Quick Service directories manually."
    return 0
  fi
  while IFS=$'\t' read -r kind identity path; do
    [[ ${path} == /* ]] || fail "Invalid path in installer directory inventory"
    kinds["${path}"]="${kind}"
    identities["${path}"]="${identity}"
  done < "${INSTANCE_STATE_DIR}/directories"
  [[ ${#kinds[@]} -gt 0 ]] || return 0
  # Reverse lexical order visits each child before its parent. A surviving
  # child protects the parent from recursive deletion, even after a reinstall.
  ordered="$(printf '%s\n' "${!kinds[@]}" | LC_ALL=C sort -r)"
  while IFS= read -r path; do
    [[ -e ${path} || -L ${path} ]] || continue
    kind="${kinds["${path}"]}"
    identity="${identities["${path}"]}"
    if [[ ${kind} != tree && ${kind} != empty ]] || ! safe_data_path "${path}" ||
       [[ ! -d ${path} || ${identity} == *:- || "$(TZ=UTC stat -c '%d:%i:%w' -- "${path}")" != "${identity}" ]] ||
       contains_retained_data "${path}"; then
      warn "Preserving unverified or shared data directory: ${path}"
      retained_data_paths+=("${path}" "$(normalize_path "${path}")")
    elif [[ ${action} == plan ]]; then
      refuse_mounted_paths "${path}"
      log "  - ${path} (${kind})"
    else
      remove_recorded_directory "${kind}" "${identity}" "${path}"
      if [[ -e ${path} || -L ${path} ]]; then
        warn "Preserving remaining data at ${path}"
        retained_data_paths+=("${path}")
      fi
    fi
  done <<< "${ordered}"
}

refuse_mounted_paths() {
  local path="$1" mounts mount
  mounts="$(findmnt --noheadings --raw --output TARGET)"
  while IFS= read -r mount; do
    printf -v mount '%b' "${mount}"
    if [[ ${mount} == "${path}" || ${mount} == "${path}/"* ]]; then
      fail "Refusing to remove mounted data at ${mount}; unmount it first."
    fi
  done <<< "${mounts}"
}

# Every unit install.sh writes (next, worker, ssh-ws, aria2, the nightly backup
# timer and its service), plus the direct gateway. aria2 was missing: its
# Restart=always relay kept running against deleted paths and its unit stayed
# enabled. The backup timer was missing too and went on firing every night.
units=(
  "${SERVICE_PREFIX}-backup.timer"
  "${SERVICE_PREFIX}-backup.service"
  "${SERVICE_PREFIX}-next.service"
  "${SERVICE_PREFIX}-worker.service"
  "${SERVICE_PREFIX}-ssh-ws.service"
  "${SERVICE_PREFIX}-aria2.service"
  "${SERVICE_PREFIX}-direct.service"
)

log "Removing application and verified instance resources."
log "Application directory: ${APP_DIR}"
log "Source, configuration and build output will be removed. Unregistered data under the application directory will be retained."
log "Services: ${units[*]}"
plan_database_cleanup
if [[ -n ${docker_instance_label} ]]; then
  log "Docker cleanup requires the instance label ${docker_instance_label}. Review legacy containers manually."
else
  warn "No verified Docker instance label. Review containers, volumes and networks manually."
fi
log "Registered data directories:"
visit_owned_directories plan

if [ "${DRY_RUN}" = "1" ]; then
  log "Dry run complete; no changes made."
  exit 0
fi

check_database_cluster
if [[ -n ${docker_instance_label} ]] && command -v docker >/dev/null 2>&1; then
  docker info >/dev/null 2>&1 || fail "Docker is installed but unavailable; cannot guarantee complete Quick Service removal."
fi

refuse_mounted_paths "${APP_DIR}"

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
  [[ -n ${docker_instance_label} ]] || return 0
  command -v docker >/dev/null 2>&1 || return 0
  local id ids
  local filter="label=${docker_instance_label}"
  ids="$(docker ps -aq --no-trunc --filter "${filter}")"
  while IFS= read -r id; do
    [[ -z ${id} ]] || docker rm -f "${id}" >/dev/null
  done <<< "${ids}"
  ids="$(docker volume ls -q --filter "${filter}")"
  while IFS= read -r id; do
    [[ -z ${id} ]] || docker volume rm "${id}" >/dev/null
  done <<< "${ids}"
  ids="$(docker network ls -q --filter "${filter}")"
  while IFS= read -r id; do
    [[ -z ${id} ]] || docker network rm "${id}" >/dev/null
  done <<< "${ids}"
}

cleanup_app_directory() (
  [[ -d ${APP_DIR} ]] || return 0
  cd -P -- "${APP_DIR}"
  [[ ${PWD} == "${APP_DIR}" && -f deploy/install.sh && -f deploy/systemd/vcontrolhub-next.service.example ]] ||
    fail "Application directory changed during uninstall: ${APP_DIR}"
  refuse_mounted_paths "${APP_DIR}"
  local path absolute name raw setting file line
  local -a values=()
  local settings='STORAGE_ROOT|DOWNLOAD_ROOT|BACKUP_DIR|ARIA2_RPC_DIR|FILE_VERSION_DIR|MEDIA_UPLOAD_TMP_DIR|MEDIA_THUMB_CACHE_DIR'
  local assignment="^[[:space:]]*(export[[:space:]]+)?(${settings})[[:space:]]*=[[:space:]]*(.*)$"
  # A legacy install can put configured data below a source directory. Read
  # its paths as data, even when there is no installer ownership inventory.
  for setting in ${settings//|/ }; do values+=("${!setting:-}"); done
  for file in "${ENV_FILE}" "${RUNTIME_ENV_FILE:-.env.runtime}" .env.local .env .env.production; do
    [[ -f ${file} ]] || continue
    while IFS= read -r line || [[ -n ${line} ]]; do
      if [[ ${line} =~ ${assignment} ]]; then values+=("${BASH_REMATCH[3]}"); fi
    done < "${file}"
  done
  for raw in "${values[@]}"; do
    raw="${raw%$'\r'}"
    case "${raw}" in
      \"*) raw="${raw#\"}"; raw="${raw%%\"*}" ;;
      \'*) raw="${raw#\'}"; raw="${raw%%\'*}" ;;
      *) raw="${raw%%[[:space:]]#*}" ;;
    esac
    case "${raw}" in
      '') continue ;;
      '$APP_DIR'|'${APP_DIR}') raw="${APP_DIR}" ;;
      '$APP_DIR/'*|'${APP_DIR}/'*) raw="${APP_DIR}/${raw#*/}" ;;
    esac
    if [[ -d ${raw} ]]; then retained_data_paths+=("$(normalize_path "${raw}")"); fi
  done
  for path in "${retained_data_paths[@]}"; do
    if [[ ${path} == "${APP_DIR}" ]]; then
      warn "Retaining application directory configured as a data root: ${path}"
      return 0
    fi
  done

  shopt -s dotglob nullglob
  for path in ./*; do
    name="${path#./}"
    absolute="${PWD}/${name}"
    if contains_retained_data "${absolute}"; then
      warn "Retaining application path with operator data: ${absolute}"
      continue
    fi
    case "${name}" in
      .git|.githooks|.github|agent-files|deploy|docker|docs|e2e|prisma|public|scripts|src|.next|dist|node_modules)
        find "${path}" -xdev -depth -delete ;;
      .dockerignore|.env|.env.local|.env.runtime|.env.production|.env.example|.gitattributes|.gitignore|\
      AGENTS.md|CHANGELOG.md|Dockerfile|Makefile|README.md|deploy.sh|docker-compose.yml|docker-entrypoint.sh|\
      eslint.config.mjs|install.sh|knip.json|next.config.ts|next-env.d.ts|package-lock.json|package.json|\
      playwright.config.ts|postcss.config.mjs|prisma.config.ts|tsconfig.json|tsconfig.tsbuildinfo|vitest.config.ts)
        if [[ -d ${path} && ! -L ${path} ]]; then
          warn "Retaining unexpected directory: ${absolute}"
        else
          unlink -- "${path}"
        fi ;;
      *)
        warn "Retaining unregistered application path: ${absolute}" ;;
    esac
  done
  if [[ . -ef ${APP_DIR} ]]; then rmdir --ignore-fail-on-non-empty -- "${APP_DIR}"; fi
)

remove_quick_service_containers

remove_owned_database
cd /

visit_owned_directories remove

cleanup_app_directory

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
if [[ -d ${APP_DIR} ]]; then warn "Review retained files in ${APP_DIR}."; fi
if id "${APP_USER}" >/dev/null 2>&1; then
  fail "Residual application user remains: ${APP_USER}"
fi
if [[ -n ${docker_instance_label} ]] && command -v docker >/dev/null 2>&1; then
  remaining="$(docker ps -aq --filter "label=${docker_instance_label}")"
  [ -z "${remaining}" ] || fail "Residual instance-labeled containers remain."
fi
if [[ -d ${INSTANCE_STATE_DIR} ]]; then
  rm -f -- "${INSTANCE_STATE_DIR}/database" "${INSTANCE_STATE_DIR}/directories" "${INSTANCE_STATE_DIR}/docker-instance"
  rmdir -- "${INSTANCE_STATE_DIR}"
fi

log "Complete uninstall verified for installer-owned resources."
