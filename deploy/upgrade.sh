#!/usr/bin/env bash
# Portable upgrade helper for VControlHub.
# Prepare a complete release on the installation filesystem before taking units offline.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
APP_NAME="${APP_NAME:-${APP_SLUG:-VControlHub}}"
ENV_FILE="${ENV_FILE:-${APP_DIR}/.env.local}"
BACKUP_DIR="${BACKUP_DIR:-${APP_DIR}/backups}"
SKIP_PRE_BACKUP="${SKIP_PRE_BACKUP:-0}"
SKIP_POST_CHECK="${SKIP_POST_CHECK:-0}"
SKIP_PULL="${SKIP_PULL:-0}"
UPGRADE_REF="${UPGRADE_REF:-main}"
CHECK_PUBLIC_URL="${CHECK_PUBLIC_URL:-}"

log() { printf '\033[1;32m[upgrade]\033[0m %s\n' "$*"; }
# install.sh hands the checkout to the service user, while upgrades are run with
# sudo as the installer documents; git then refuses the repository as having
# "dubious ownership". Declare the checkout safe for this invocation only.
git_app() { git -c "safe.directory=${APP_DIR}" -C "${APP_DIR}" "$@"; }
warn() { printf '\033[1;33m[upgrade]\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31m[upgrade]\033[0m %s\n' "$*" >&2; exit 1; }

load_env_for_defaults() {
  [ -f "${ENV_FILE}" ] || return 0
  # shellcheck disable=SC1090
  set -a; source "${ENV_FILE}"; set +a

  # DOMAIN was not persisted by installers released before the lifecycle menu.
  # Recover it from the first configured public SSH WebSocket origin so those
  # existing installations can use Update without falling into IP/Apache mode.
  local public_origin="" authority=""
  if [ -z "${DOMAIN:-}" ]; then
    public_origin="${SSH_WS_ALLOWED_ORIGINS:-}"
    public_origin="${public_origin%%,*}"
  fi
  if [ -z "${DOMAIN:-}" ] && { [ -z "${public_origin}" ] || [[ "${public_origin}" == http://localhost* ]] || [[ "${public_origin}" == http://127.0.0.1* ]]; }; then
    local caddy_file="${CADDY_FILE:-${DESTDIR:-}/etc/caddy/Caddyfile}"
    if [ -f "${caddy_file}" ] && grep -Fq "# Managed by VControlHub installer:" "${caddy_file}"; then
      public_origin="$(sed -nE 's|^[[:space:]]*(https?://[^, {]+).*|\1|p' "${caddy_file}" | head -1)"
    fi
  fi
  # A loopback origin is the IP-only/Apache install talking to itself, not a
  # public domain: deriving DOMAIN=localhost from it would hand install.sh a
  # domain and flip the installation into Caddy mode next to the running Apache.
  case "${public_origin}" in
    http://localhost*|http://127.0.0.1*|https://localhost*|https://127.0.0.1*) public_origin="" ;;
  esac
  if [ -z "${DOMAIN:-}" ] && [ -n "${public_origin}" ]; then
    case "${public_origin}" in
      http://*|https://*)
        authority="${public_origin#*://}"
        authority="${authority%%/*}"
        DOMAIN="${authority%%:*}"
        export DOMAIN
        log "Recovered installed domain from existing public configuration: ${DOMAIN}"
        ;;
    esac
  fi
  if [ -z "${CHECK_PUBLIC_URL}" ] && [ -n "${APP_PUBLIC_URL:-}" ]; then
    CHECK_PUBLIC_URL="${APP_PUBLIC_URL}"
  fi
  if [ -z "${CHECK_PUBLIC_URL}" ] && [ -n "${DOMAIN:-}" ]; then
    CHECK_PUBLIC_URL="https://${DOMAIN}"
  fi
}

run_pre_upgrade_backup() {
  [ "${SKIP_PRE_BACKUP}" = "1" ] && { warn "Skipping pre-upgrade backup"; return; }
  mkdir -p "${BACKUP_DIR}"
  local stamp output
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  output="${BACKUP_DIR}/pre-upgrade-${stamp}.sql.gz"
  log "Creating pre-upgrade database backup at ${output}"
  APP_DIR="${APP_DIR}" ENV_FILE="${ENV_FILE}" BACKUP_DIR="${BACKUP_DIR}" "${backup_script}" "${output}"
}

is_shared_env_path() {
  [[ $1 == .env* && $1 != .env.example ]]
}

prepare_source() {
  local source_dir="${SOURCE_DIR:-${APP_DIR}}" remote sha dirty
  if [[ ${SKIP_PULL} != 1 && -d ${APP_DIR}/.git ]]; then
    dirty="$(git_app status --porcelain -- . ':(exclude)docs/route-catalog.json')"
    [[ -z ${dirty} ]] || fail "Working tree has local changes. Commit/stash them or run with SKIP_PULL=1."
    git_app fetch origin "${UPGRADE_REF}"
    sha="$(git_app rev-parse --verify 'FETCH_HEAD^{commit}')"
    git_app merge-base --is-ancestor HEAD "${sha}" || fail "Upgrade must fast-forward the installed commit"
    remote="$(git_app remote get-url origin)"
    git clone --quiet --no-checkout --no-local --branch "${UPGRADE_REF}" -- "${remote}" "${candidate}"
    git -C "${candidate}" reset --hard "${sha}"
  else
    # Archive installs may supply the unpacked release via SOURCE_DIR.
    local excludes=(--exclude='./.next*' --exclude='./node_modules*' --exclude='./dist*' --no-wildcards)
    local path name
    for path in "${source_dir}"/.env*; do
      name="${path##*/}"
      if is_shared_env_path "${name}"; then excludes+=("--exclude=./${name}"); fi
    done
    for name in "${shared[@]}"; do excludes+=("--exclude=./${name}"); done
    tar -C "${source_dir}" "${excludes[@]}" -cf - . | tar -C "${candidate}" -xf -
  fi
}

prepare_release() {
  prepare_source
  local env_name
  for env_name in .env .env.local .env.runtime .env.production; do
    if [[ -f ${APP_DIR}/${env_name} ]]; then
      install -m 600 "${APP_DIR}/${env_name}" "${candidate}/${env_name}"
    fi
  done
  (
    cd "${candidate}"
    if [[ ${SKIP_BUILD:-0} != 1 ]]; then
      npm ci --include=dev
      npm run prisma:generate
      VCONTROLHUB_ALLOW_BUILD=1 NEXT_TELEMETRY_DISABLED=1 npm run build
      npm run build:runtime
      rm -rf -- .next/cache
    else
      # Only an explicitly supplied prebuilt release can skip building.
      [[ -n ${SOURCE_DIR:-} && ! ${SOURCE_DIR} -ef ${APP_DIR} ]] || fail "SKIP_BUILD needs a separate prebuilt SOURCE_DIR"
      cp -a -- "${SOURCE_DIR}/.next" "${SOURCE_DIR}/dist" "${SOURCE_DIR}/node_modules" .
    fi
    local file
    for file in .next/BUILD_ID dist/server.js dist/worker.js dist/ssh-ws-proxy.js; do
      [[ -s ${file} ]] || fail "Missing release artifact: ${file}"
    done
    if [[ ${SKIP_DB_SETUP:-0} != 1 ]]; then node deploy/check-upgrade-migrations.mjs; fi
  )
  # The application owns its runtime tree and the DynamicUser gateway reads its bundles.
  chown -R --reference="${APP_DIR}" "${candidate}"
  chmod --reference="${APP_DIR}" "${candidate}"
  chmod o+x "${candidate}"
  chmod -R o+rX "${candidate}/dist" "${candidate}/node_modules" "${candidate}/scripts"
  chmod o+r "${candidate}/package.json"
}

plan_shared_paths() {
  # Move mutable state by rename while quiesced. It stays at the installed path
  # and remains a real directory for backups, restores and confined services.
  local name path
  shopt -s nullglob dotglob
  for path in "${APP_DIR}"/*; do
    name="${path##*/}"
    case "${name}" in
      node_modules|dist|.next|.git|.restore.lock) continue ;;
    esac
    # Keep deployment-local files and custom top-level storage directories.
    if is_shared_env_path "${name}"; then
      shared+=("${name}")
    elif [[ ! -e ${candidate}/${name} && ! -L ${candidate}/${name} ]]; then
      if [[ -d ${APP_DIR}/.git && -n "$(git_app ls-files -- "${name}")" ]]; then continue; fi
      shared+=("${name}")
    fi
  done
  declare -A planned=()
  for name in "${shared[@]}"; do
    [[ -e ${APP_DIR}/${name} || -L ${APP_DIR}/${name} ]] || continue
    [[ ! -v 'planned[$name]' ]] || continue
    planned["${name}"]=1
    path="${candidate}/${name}"
    if [[ -L ${path} ]]; then
      fail "Release collides with persistent path: ${name}"
    elif [[ -d ${path} ]]; then
      [[ ! -f ${path}/.gitkeep ]] || rm -- "${path}/.gitkeep"
      rmdir -- "${path}" || fail "Nonempty release directory collides with persistent path: ${name}"
    elif [[ -e ${path} ]]; then
      case "${name}" in
        .env|.env.local|.env.runtime|.env.production) rm -- "${path}" ;;
        *) fail "Release collides with persistent file: ${name}" ;;
      esac
    fi
    [[ "$(stat -c %d "${APP_DIR}/${name}")" == "${device}" ]] || fail "Mounted data needs a manual upgrade: ${name}"
    persistent+=("${name}")
  done
}

remember_units() {
  local unit state load
  for unit in "${prefix}-backup.timer" "${core_units[@]}" "${prefix}-aria2.service"; do
    load="$(systemctl show "${unit}" -p LoadState --value)" || [[ ${load} == not-found ]] || fail "Cannot query ${unit}"
    case "${load}" in
      loaded) ;;
      not-found) [[ ${unit} == "${prefix}-aria2.service" || ${unit} == "${prefix}-backup.timer" ]] && continue ;;
    esac
    [[ ${load} == loaded ]] || fail "Cannot determine installed unit: ${unit} (${load})"
    state="$(systemctl show "${unit}" -p ActiveState --value)"
    case "${state}" in
      active) active_units+=("${unit}") ;;
      inactive|failed) ;;
      *) fail "Unit ${unit} is in a transitional state: ${state}" ;;
    esac
    managed_units+=("${unit}")
  done
}

restore_release() {
  local name
  if [[ -d ${old} ]]; then
    if [[ ! -d ${candidate} ]]; then mv -T -- "${APP_DIR}" "${candidate}" || return 1; fi
    mv -T -- "${old}" "${APP_DIR}" || return 1
  fi
  for name in "${persistent[@]}"; do
    if [[ ! -e ${APP_DIR}/${name} && ! -L ${APP_DIR}/${name} ]]; then
      mv -T -- "${candidate}/${name}" "${APP_DIR}/${name}" || return 1
    fi
  done
}

finish() {
  local status=$?
  trap - EXIT
  trap '' INT TERM HUP
  if (( cutover )); then
    warn "Upgrade failed. Restoring previous code and service state. Database migrations are retained."
    if (( started_new )) && ! systemctl stop "${managed_units[@]}"; then
      warn "Could not quiesce the candidate; recovery files retained in ${work}"
      exit 1
    fi
    restore_release || { warn "Directory recovery incomplete; releases retained in ${work}"; exit 1; }
    if (( ${#active_units[@]} )); then
      systemctl start "${active_units[@]}" || { warn "Old code restored; service recovery failed (${active_units[*]})"; exit 1; }
    fi
  fi
  if [[ -n ${work} && ! -d ${old:-} ]]; then rm -rf -- "${work}"; fi
  : > "${lock}"
  exit "${status}"
}

main() {
  [[ $# == 0 ]] || fail "Usage: deploy/upgrade.sh"
  load_env_for_defaults
  backup_script="${APP_DIR}/deploy/backup.sh"
  # The installer's isolated packaging fixture renders host configuration only.
  if [[ -n ${DESTDIR:-} ]]; then
    [[ ${SKIP_RESTART:-0} == 1 && ${SKIP_DB_SETUP:-0} == 1 && ${SKIP_BUILD:-0} == 1 ]] || fail "DESTDIR upgrades require an offline render"
    backup_script="${SCRIPT_DIR}/backup.sh"
    run_pre_upgrade_backup
    SKIP_PACKAGES=1 "${SCRIPT_DIR}/install.sh"
    return
  fi
  [[ -d ${APP_DIR} && ! -L ${APP_DIR} && ${APP_DIR} == /* && ${APP_DIR} != / ]] || fail "Expected an absolute installation directory"
  [[ -f ${ENV_FILE} ]] || fail "Missing installed environment file: ${ENV_FILE}"
  local install_db_url="${DATABASE_URL:-}"
  if [[ -f ${RUNTIME_ENV_FILE:-${APP_DIR}/.env.runtime} ]]; then
    # Compare without printing credentials. The service and Prisma must target the same database.
    ( set -a; source "${RUNTIME_ENV_FILE:-${APP_DIR}/.env.runtime}"; [[ ${DATABASE_URL:-} == "${install_db_url}" ]] ) ||
      fail "Runtime and installation DATABASE_URL differ; reconcile the configuration before upgrading"
  fi
  prefix="${SERVICE_PREFIX:-${APP_SLUG:-${APP_NAME,,}}}"
  [[ ${prefix} =~ ^[a-zA-Z0-9][a-zA-Z0-9_.@-]*$ ]] || fail "Invalid service prefix"
  lock="${DEPLOY_LOCK:-/run/lock/vcontrolhub-deploy.lock}"
  mkdir -p -- "$(dirname "${lock}")"
  exec 9>>"${lock}"
  flock -n 9 || fail "Another deployment is running"
  printf '%s\n' "$$" > "${lock}"
  work="" cutover=0 started_new=0
  core_units=("${prefix}-next.service" "${prefix}-worker.service" "${prefix}-ssh-ws.service")
  managed_units=() active_units=() persistent=()
  shared=(storage uploads downloads backups logs tmp dist.releases .ssh .config .local .npm .cache)
  trap finish EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM HUP
  [[ ! -e ${APP_DIR}/.restore.lock ]] || fail "An installation restore is in progress"
  work="$(mktemp -d "$(dirname "${APP_DIR}")/.vch-upgrade.XXXXXXXX")"
  candidate="${work}/new" old="${work}/old"
  mkdir -- "${candidate}"
  device="$(stat -c %d "${APP_DIR}")"
  [[ "${device}" == "$(stat -c %d "${work}")" ]] || fail "Release and installation must be on the same filesystem"
  [[ ! -L ${APP_DIR}/dist.releases ]] || fail "Release archive must be a local directory"
  local setting configured relative top
  for setting in STORAGE_ROOT DOWNLOAD_ROOT BACKUP_DIR ARIA2_RPC_DIR FILE_VERSION_DIR MEDIA_UPLOAD_TMP_DIR MEDIA_THUMB_CACHE_DIR ENV_FILE RUNTIME_ENV_FILE; do
    configured="${!setting:-}"
    [[ ${configured} == "${APP_DIR}/"* ]] || continue
    relative="${configured#"${APP_DIR}/"}"
    top="${relative%%/*}"
    [[ -n ${top} && ${top} != . && ${top} != .. ]] || fail "Invalid installed path in ${setting}"
    shared+=("${top}")
  done
  prepare_release
  run_pre_upgrade_backup
  plan_shared_paths
  remember_units
  if [[ ${SKIP_RESTART:-0} == 1 && ${#active_units[@]} != 0 ]]; then fail "SKIP_RESTART requires stopped services"; fi
  # Arm recovery before the first stop, which can itself partially succeed.
  cutover=1
  if (( ${#active_units[@]} )); then systemctl stop "${active_units[@]}"; fi
  local backup_state
  backup_state="$(systemctl show "${prefix}-backup.service" -p ActiveState --value)"
  [[ ${backup_state} == inactive || ${backup_state} == failed ]] || fail "Backup service is busy"
  if [[ ${SKIP_DB_SETUP:-0} != 1 ]]; then
    (cd "${candidate}" && npm run prisma:deploy)
    if [[ ${SKIP_SEED:-0} != 1 ]]; then (cd "${candidate}" && npm run db:seed); fi
  fi
  for name in "${persistent[@]}"; do mv -T -- "${APP_DIR}/${name}" "${candidate}/${name}"; done
  mv -T -- "${APP_DIR}" "${old}"
  mv -T -- "${candidate}" "${APP_DIR}"
  if [[ ${SKIP_RESTART:-0} != 1 ]]; then
    started_new=1
    systemctl start "${core_units[@]}"
    for unit in "${active_units[@]}"; do
      [[ ${unit} != "${prefix}-aria2.service" ]] || systemctl start "${unit}"
    done
    curl --retry 15 --retry-delay 2 --retry-connrefused --max-time 5 -fsS "http://${NEXT_HOST:-127.0.0.1}:${NEXT_PORT:-3000}/login" >/dev/null
    if [[ ${SKIP_POST_CHECK} != 1 ]]; then
      APP_DIR="${APP_DIR}" ENV_FILE="${ENV_FILE}" SERVICE_PREFIX="${prefix}" CHECK_PUBLIC_URL="${CHECK_PUBLIC_URL}" "${APP_DIR}/deploy/check.sh"
    fi
    for unit in "${core_units[@]}"; do systemctl is-active --quiet "${unit}"; done
    for unit in "${active_units[@]}"; do
      [[ ${unit} != "${prefix}-backup.timer" ]] || systemctl start "${unit}"
    done
  fi
  cutover=0
  mkdir -p -- "${APP_DIR}/dist.releases"
  local archive="${APP_DIR}/dist.releases/${work##*/}"
  mv -T -- "${old}" "${archive}"
  log "Upgrade completed. Previous release: ${archive}"
}
main "$@"
