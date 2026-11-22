# Top-level installation environments stay with the installation. Only the
# public example belongs to the release. Nested fixtures are source files.
release_env_template=.env.example
local_env_glob='.env*'
is_shared_env_path() { [[ $1 == ${local_env_glob} && $1 != "${release_env_template}" ]]; }

tar_env_excludes() {
  local dir=$1 path name
  local -n excludes_out=$2
  excludes_out+=(--no-wildcards)
  for path in "${dir}"/.env*; do
    name=${path##*/}
    if is_shared_env_path "${name}"; then excludes_out+=("--exclude=./${name}"); fi
  done
}

# Use a separate non-login identity for package scripts and builds.
prepare_build_directory() {
  local dir=$1
  [[ ${EUID} == 0 ]] || return 0
  if ! id -u vch-release-build >/dev/null 2>&1; then
    useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin vch-release-build
  fi
  chown -hR vch-release-build:vch-release-build -- "${dir}"
}

as_release_builder() {
  if [[ ${EUID} == 0 ]]; then
    runuser -u vch-release-build -- env HOME="${PWD}/.build-home" "$@"
  else
    "$@"
  fi
}

require_release_source() {
  [[ ${EUID} == 0 && -d $1 ]] || return 0
  local root=$1 dir unsafe
  require_maintenance_path "${root}"
  # Installed data has separate ownership. Privileged drivers, build inputs,
  # repository metadata and top-level configuration belong to the maintainer.
  local paths=()
  while IFS= read -r dir; do
    [[ ! -e ${root}/${dir} && ! -L ${root}/${dir} ]] || paths+=("${root}/${dir}")
  done < "${SCRIPT_DIR}/lib/release-directories.txt"
  [[ ! -e ${root}/.git ]] || paths+=("${root}/.git")
  while IFS= read -r -d '' dir; do paths+=("${dir}"); done < <(find "${root}" -maxdepth 1 \( -type f -o -type l \) -print0)
  if (( ${#paths[@]} )); then
    unsafe="$(find "${paths[@]}" \( -type l -o ! -uid 0 -o -perm /022 \) -print -quit)" || fail "Cannot inspect release source"
    [[ -z ${unsafe} ]] || fail "Maintenance source requires a protected administrator-owned checkout: ${unsafe}"
  fi
}

# Copy build inputs into a private scratch directory. Never hand the privileged
# drivers or repository metadata destined for publication to the build account.
copy_build_inputs() {
  local source=$1 stage=$2 name file
  while IFS= read -r name; do
    [[ ! -d ${source}/${name} ]] || cp -a -- "${source}/${name}" "${stage}/"
  done < "${SCRIPT_DIR}/lib/release-directories.txt"
  for file in "${source}"/* "${source}"/.[!.]*; do
    [[ -f ${file} && ! -L ${file} ]] || continue
    if is_shared_env_path "${file##*/}"; then continue; fi
    cp --preserve=mode -- "${file}" "${stage}/"
  done
  prepare_build_directory "${stage}"
}

with_public_build_env() (
  local root=$1 primary=${2:-} env_file var
  for env_file in "${root}/.env" "${root}/.env.production" "${root}/.env.local" "${root}/.env.production.local"; do
    [[ -f ${env_file} ]] && load_install_settings "${env_file}"
  done
  if [[ -n ${primary} && -f ${primary} ]]; then
    case "${primary}" in
      "${root}/.env"|"${root}/.env.production"|"${root}/.env.local"|"${root}/.env.production.local") ;;
      *) load_install_settings "${primary}" ;;
    esac
  fi
  for var in ${!NEXT_PUBLIC_*}; do
    export "${var}"
  done
  shift 2
  "$@"
)

copy_build_artifacts() {
  local stage=$1 target=$2 name
  for name in node_modules .next dist; do
    [[ -d ${stage}/${name} && ! -L ${stage}/${name} ]] || fail "Missing build directory: ${name}"
    rm -rf -- "${target}/${name}"
    cp -a --no-preserve=ownership,xattr -- "${stage}/${name}" "${target}/"
    chmod -R a+rX,go-w,a-s -- "${target}/${name}"
  done
}
