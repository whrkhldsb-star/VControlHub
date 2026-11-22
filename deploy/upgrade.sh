#!/usr/bin/env bash
# Portable upgrade helper for VControlHub.
# Prepare a complete release on the installation filesystem before taking units offline.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
APP_NAME="${APP_NAME:-${APP_SLUG:-VControlHub}}"
ENV_FILE="$(realpath -ms -- "${ENV_FILE:-${APP_DIR}/.env.local}")"
BACKUP_DIR="${BACKUP_DIR:-${APP_DIR}/backups}"
SKIP_PRE_BACKUP="${SKIP_PRE_BACKUP:-0}"
SKIP_POST_CHECK="${SKIP_POST_CHECK:-0}"
SKIP_PULL="${SKIP_PULL:-0}"
UPGRADE_REF="${UPGRADE_REF:-main}"
readonly pinned_commit="${UPGRADE_COMMIT:-}"
CHECK_PUBLIC_URL="${CHECK_PUBLIC_URL:-}"

log() { printf '\033[1;32m[upgrade]\033[0m %s\n' "$*"; }
git_app() { git -C "${APP_DIR}" "$@"; }
warn() { printf '\033[1;33m[upgrade]\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31m[upgrade]\033[0m %s\n' "$*" >&2; exit 1; }

load_env_for_defaults() {
  [ -f "${ENV_FILE}" ] || return 0
  # shellcheck disable=SC1090
  # Keep configuration local to the upgrader; only migration/seed steps export
  # installation secrets via with_install_env.
  load_install_settings "${ENV_FILE}"

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

# Prisma, npm and the migration preflight do not use Next's environment
# loader. Keep the selected installation environment for these commands.
with_install_env() (
  set -a
  load_install_settings "${ENV_FILE}"
  set +a
  "$@"
)

if [[ ! -f ${SCRIPT_DIR}/lib/release-paths.sh ]]; then
  # Previously installed bootstraps extracted only upgrade.sh into a temporary
  # directory. Recover its companion files from the same authenticated fetch.
  [[ -d ${APP_DIR}/.git && ${SKIP_PULL} != 1 ]] || fail "Missing upgrade driver libraries"
  driver_commit="$(git_app rev-parse --verify "${pinned_commit:-FETCH_HEAD}^{commit}")"
  [[ "$(git_app rev-parse "${driver_commit}:deploy/upgrade.sh")" == "$(git_app hash-object --stdin < "${BASH_SOURCE[0]}")" ]] ||
    fail "Fetched commit does not match the upgrade driver"
  driver_bundle="$(mktemp -d)"
  trap 'rm -rf -- "${driver_bundle}"' EXIT
  git_app archive "${driver_commit}" deploy | tar -C "${driver_bundle}" -xf -
  [[ -f ${driver_bundle}/deploy/lib/release-paths.sh ]] || fail "Missing libraries in the fetched release"
  APP_DIR="${APP_DIR}" UPGRADE_COMMIT="${driver_commit}" bash "${driver_bundle}/deploy/upgrade.sh" "$@"
  exit
fi
source "${SCRIPT_DIR}/lib/release-paths.sh"
source "${SCRIPT_DIR}/lib/listen-address.sh"

discover_archive_state() {
  local path name
  [[ ${SOURCE_DIR:-${APP_DIR}} -ef ${APP_DIR} ]] || return 0
  for path in "${APP_DIR}"/* "${APP_DIR}"/.[!.]* "${APP_DIR}"/..?*; do
    [[ -d ${path} || -L ${path} ]] || continue
    name=${path##*/}
    case "${name}" in .git|.next*|dist|node_modules*) continue ;; esac
    if [[ -d ${APP_DIR}/.git ]]; then
      [[ -z "$(git_app ls-files -- "${name}")" ]] || continue
    elif grep -Fxq -- "${name}" "${SCRIPT_DIR}/lib/release-directories.txt"; then
      continue
    fi
    shared+=("${name}")
  done
}

prepare_source() {
  local source_dir="${SOURCE_DIR:-${APP_DIR}}" sha dirty
  if [[ ${SKIP_PULL} != 1 && -d ${APP_DIR}/.git ]]; then
    dirty="$(git_app status --porcelain -- . ':(exclude)docs/route-catalog.json' ':(top,exclude,glob).env*')$(git_app status --porcelain -- .env.example)"
    [[ -z ${dirty} ]] || fail "Working tree has local changes. Commit/stash them or run with SKIP_PULL=1."
    if [[ -n ${pinned_commit} ]]; then
      [[ ${pinned_commit} =~ ^([a-f0-9]{40}|[a-f0-9]{64})$ ]] || fail "Invalid pinned upgrade commit"
      sha="$(git_app rev-parse --verify "${pinned_commit}^{commit}")"
      [[ ${sha} == "${pinned_commit}" ]] || fail "Pinned upgrade commit mismatch"
    else
      git_app fetch origin "${UPGRADE_REF}"
      sha="$(git_app rev-parse --verify 'FETCH_HEAD^{commit}')"
    fi
    git_app merge-base --is-ancestor HEAD "${sha}" || fail "Upgrade must fast-forward the installed commit"
    # Keep the authenticated fetch, including shallow history and repository-local
    # transport settings. All checkout writes target the private candidate.
    cp -a --no-preserve=ownership -- "${APP_DIR}/.git" "${candidate}/.git"
    local repo=(git --git-dir="${candidate}/.git" --work-tree="${candidate}")
    "${repo[@]}" reset --hard "${sha}"
    [[ "$("${repo[@]}" rev-parse HEAD)" == "${sha}" ]] || fail "Candidate commit mismatch"
  else
    discover_archive_state
    local excludes=(--exclude='./.next*' --exclude='./node_modules*' --exclude='./dist*')
    local name
    tar_env_excludes "${source_dir}" excludes
    for name in "${shared[@]}"; do excludes+=("--exclude=./${name}"); done
    tar -C "${source_dir}" "${excludes[@]}" -cf - . | tar -C "${candidate}" -xf -
  fi
}

clear_candidate_env() {
  local path
  for path in "${candidate}"/.env*; do
    if is_shared_env_path "${path##*/}"; then rm -rf -- "${path}"; fi
  done
}

prepare_release() {
  prepare_source
  clear_candidate_env
  if [[ ${SKIP_BUILD:-0} == 1 && ( -z ${SOURCE_DIR:-} || ${SOURCE_DIR} -ef ${APP_DIR} ) ]]; then
    fail "SKIP_BUILD needs a separate prebuilt SOURCE_DIR"
  fi
  if [[ ${SKIP_BUILD:-0} != 1 || ${SKIP_DB_SETUP:-0} != 1 ]]; then
    # Keep the private build tree until migration/seed finish. The published
    # candidate and its environment files stay under administrator ownership.
    stage_dir="$(mktemp -d /var/tmp/vch-build.XXXXXXXX)"
    if [[ ${SKIP_BUILD:-0} == 1 ]]; then
      cp -a -- "${SOURCE_DIR}/node_modules" "${stage_dir}/"
    fi
    copy_build_inputs "${candidate}" "${stage_dir}"
  fi
  if [[ ${SKIP_BUILD:-0} != 1 ]]; then
    (
      cd "${stage_dir}"
      unset DATABASE_URL PG_DB_PASSWORD AUTH_SESSION_SECRET ADMIN_INITIAL_PASSWORD SSH_WS_SECRET STORAGE_DIRECT_ACCESS_SECRET ARIA2_RPC_SECRET ENCRYPTION_KEY
      as_release_builder npm ci --include=dev
      DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build" as_release_builder npm run prisma:generate
      VCONTROLHUB_ALLOW_BUILD=1 NEXT_TELEMETRY_DISABLED=1 with_public_build_env "${APP_DIR}" "${ENV_FILE}" as_release_builder npm run build
      as_release_builder npm run build:runtime
      rm -rf -- .next/cache
      copy_build_artifacts "${stage_dir}" "${candidate}"
    )
  else
    cp -a -- "${SOURCE_DIR}/.next" "${SOURCE_DIR}/dist" "${SOURCE_DIR}/node_modules" "${candidate}/"
  fi
  local file
  for file in .next/BUILD_ID dist/server.js dist/worker.js dist/ssh-ws-proxy.js; do
    [[ -s ${candidate}/${file} ]] || fail "Missing release artifact: ${file}"
  done
  if [[ ${SKIP_DB_SETUP:-0} != 1 ]]; then
    (cd "${stage_dir}" && with_install_env as_release_builder node deploy/check-upgrade-migrations.mjs)
  fi
  if [[ ${EUID} == 0 ]]; then chown -hR root:root "${candidate}"; fi
  chmod -R go-w "${candidate}"
  chmod --reference="${APP_DIR}" "${candidate}"
  chmod o+x "${candidate}"
  chmod -R o+rX "${candidate}/dist" "${candidate}/node_modules" "${candidate}/scripts"
  chmod o+r "${candidate}/package.json"
  mkdir -p -- "${candidate}/.next/cache"
  if [[ ${EUID} == 0 && -d ${APP_DIR}/storage && ! -L ${APP_DIR}/storage ]]; then
    chown --reference="${APP_DIR}/storage" "${candidate}/.next/cache"
  fi
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
    if is_shared_env_path "${name}"; then
      : # temporary build copies are removed together immediately before cutover
    elif [[ -L ${path} ]]; then
      fail "Release collides with persistent path: ${name}"
    elif [[ -d ${path} ]]; then
      [[ ! -f ${path}/.gitkeep ]] || rm -- "${path}/.gitkeep"
      rmdir -- "${path}" || fail "Nonempty release directory collides with persistent path: ${name}"
    elif [[ -e ${path} ]]; then
      fail "Release collides with persistent file: ${name}"
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
  if [[ -n ${stage_dir:-} ]]; then rm -rf -- "${stage_dir}"; fi
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
  if [[ -z ${DESTDIR:-} ]]; then
    require_maintenance_path "${APP_DIR}"
    require_maintenance_path "${ENV_FILE}"
    require_maintenance_path "${RUNTIME_ENV_FILE:-${APP_DIR}/.env.runtime}"
    require_release_source "${APP_DIR}"
    [[ -z ${SOURCE_DIR:-} ]] || require_release_source "${SOURCE_DIR}"
  fi
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
    ( set -a; unset DATABASE_URL; load_install_settings "${RUNTIME_ENV_FILE:-${APP_DIR}/.env.runtime}"; [[ ${DATABASE_URL:-} == "${install_db_url}" ]] ) ||
      fail "Runtime and installation DATABASE_URL differ; reconcile the configuration before upgrading"
  fi
  prefix="${SERVICE_PREFIX:-${APP_SLUG:-${APP_NAME,,}}}"
  [[ ${prefix} =~ ^[a-zA-Z0-9][a-zA-Z0-9_.@-]*$ ]] || fail "Invalid service prefix"
  lock="${DEPLOY_LOCK:-/run/lock/vcontrolhub-deploy.lock}"
  mkdir -p -- "$(dirname "${lock}")"
  exec 9>>"${lock}"
  flock -n 9 || fail "Another deployment is running"
  printf '%s\n' "$$" > "${lock}"
  work="" stage_dir="" cutover=0 started_new=0
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
  for setting in STORAGE_ROOT DOWNLOAD_ROOT BACKUP_DIR ARIA2_RPC_DIR FILE_VERSION_DIR MEDIA_UPLOAD_TMP_DIR MEDIA_THUMB_CACHE_DIR IMAGE_UPLOAD_DIR VCH_STORAGE_ROOT ENV_FILE RUNTIME_ENV_FILE; do
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
    (cd "${stage_dir}" && with_install_env as_release_builder npm run prisma:deploy && with_install_env as_release_builder npm exec --no -- tsx deploy/prepare-cost-ledger.ts)
    if [[ ${SKIP_SEED:-0} != 1 ]]; then (cd "${stage_dir}" && with_install_env as_release_builder npm run db:seed); fi
  fi
  clear_candidate_env
  # A pre-upgrade unit keeps its local overrides. The drop-in also tolerates
  # rolling back to a release that predates the preflight module.
  if [[ -f ${candidate}/deploy/check-aria2-secret.mjs ]]; then
    local unit_dir="${SYSTEMD_UNIT_DIR:-/etc/systemd/system}" role dropin
    for role in next worker; do
      dropin="${unit_dir}/${prefix}-${role}.service.d"
      install -d -m 755 -- "${dropin}"
      cat > "${dropin}/25-vcontrolhub-aria2-check.conf" <<'UNIT'
[Service]
ExecStartPre=/usr/bin/env node --input-type=module -e "import fs from 'node:fs'; if (fs.existsSync('deploy/check-aria2-secret.mjs')) await import('./deploy/check-aria2-secret.mjs')"
UNIT
    done
    systemctl daemon-reload
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
    curl --retry 15 --retry-delay 2 --retry-connrefused --max-time 5 -fsS "$(web_health_url "${APP_DIR}" "${ENV_FILE}")" >/dev/null
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
