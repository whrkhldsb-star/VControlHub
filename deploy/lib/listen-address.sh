# A privileged reader may import process settings only from a protected path.
# A sticky directory such as /tmp protects an existing root-owned child.
require_maintenance_path() {
  [[ ${EUID} == 0 ]] || return 0
  local path mode owner protected_child=0
  path="$(realpath -ms -- "$1")" || return 1
  while [[ ${path} != / ]]; do
    if [[ -e ${path} || -L ${path} ]]; then
      read -r owner mode < <(stat -c '%u %a' -- "${path}") || return 1
      if [[ -L ${path} || ${owner} != 0 ]] ||
         { (( (8#${mode} & 0022) != 0 )) &&
           ! { [[ -d ${path} ]] && (( protected_child && (8#${mode} & 01000) )); }; }; then
        printf 'Maintenance requires a root-controlled path: %s\n' "${path}" >&2
        return 1
      fi
      protected_child=1
    else
      protected_child=0
    fi
    path="${path%/*}"
    path="${path:-/}"
  done
}

# Parse installed single-line KEY=value records without evaluating shell code.
# When a key is requested, print its last value without changing the environment.
load_install_settings() {
  if [[ -z ${2:-} ]]; then require_maintenance_path "$1" || return 1; fi
  local config_line config_key config_value config_last="" slug_token='${APP_SLUG:-vcontrolhub}'
  local app_ref='${APP_DIR}'
  local quoted_double='^"([^"]*)"[[:space:]]*(#.*)?$' quoted_single="^'([^']*)'[[:space:]]*(#.*)?$"
  while IFS= read -r config_line || [[ -n ${config_line} ]]; do
    config_line="${config_line%$'\r'}"
    [[ ${config_line} =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z_0-9]*)[[:space:]]*=[[:space:]]*(.*)$ ]] || continue
    config_key="${BASH_REMATCH[2]}"; config_value="${BASH_REMATCH[3]}"
    [[ -z ${2:-} || ${config_key} == "$2" ]] || continue
    local expand=1
    if [[ ${config_value} =~ ${quoted_single} ]]; then
      config_value="${BASH_REMATCH[1]}"
      expand=0
    elif [[ ${config_value} =~ ${quoted_double} ]]; then
      config_value="${BASH_REMATCH[1]}"
    else
      config_value="${config_value%%[[:space:]]#*}"
      config_value="${config_value%"${config_value##*[![:space:]]}"}"
    fi
    case "${config_key}" in
      STORAGE_ROOT|DOWNLOAD_ROOT|BACKUP_DIR|ARIA2_RPC_DIR|FILE_VERSION_DIR|MEDIA_UPLOAD_TMP_DIR|MEDIA_THUMB_CACHE_DIR|IMAGE_UPLOAD_DIR|VCH_STORAGE_ROOT)
        if (( expand )); then
          config_value="${config_value//"${slug_token}"/"${APP_SLUG:-vcontrolhub}"}"
          case "${config_value}" in
            '$APP_DIR'|"${app_ref}") config_value="${APP_DIR:?}" ;;
            '$APP_DIR/'*|"${app_ref}/"*) config_value="${APP_DIR:?}/${config_value#*/}" ;;
          esac
        fi
        ;;
    esac
    if [[ -n ${2:-} ]]; then config_last="${config_value}"; else printf -v "${config_key}" '%s' "${config_value}"; fi
  done < "$1"
  if [[ -n ${2:-} ]]; then printf '%s' "${config_last}"; fi
}

listen_setting() {
  [[ -f $1 ]] || return 0
  load_install_settings "$1" "$2"
}

web_health_url() {
  local app=$1 runtime=$2 host port
  host="${NEXT_HOST:-$(listen_setting "${runtime}" NEXT_HOST)}"
  host="${host:-$(listen_setting "${app}/.env.local" NEXT_HOST)}"
  port="${NEXT_PORT:-$(listen_setting "${runtime}" NEXT_PORT)}"
  port="${port:-$(listen_setting "${app}/.env.local" NEXT_PORT)}"
  case "${host}" in ''|0.0.0.0) host=127.0.0.1 ;; ::) host='[::1]' ;; \[*\]) ;; *:*) host="[${host}]" ;; esac
  printf 'http://%s:%s/login' "${host}" "${port:-3000}"
}
