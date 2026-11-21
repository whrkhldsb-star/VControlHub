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
